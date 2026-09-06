import { Parser } from 'htmlparser2';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export type Bookmark = {
  id: string;
  url: string;
  title: string;
  importedAt: number;
  sourceAddedAt: number | null;
  seen: number;
  hidden: number;
  rating: number | null;
};
export type Sort = 'alphabetical' | 'imported' | 'rating';
export type SeenFilter = 'all' | 'unseen' | 'seen';
export type Preferences = {
  sort: Sort;
  seenFilter: SeenFilter;
  showHidden: boolean;
  fontSize: number;
  browser: string | null;
};
export const defaultPreferences: Preferences = {
  sort: 'imported', seenFilter: 'all', showHidden: false, fontSize: 26, browser: null,
};
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export function urlHash(url: string): string {
  return bytesToHex(sha256(utf8ToBytes(url)));
}

export function parseBookmarks(html: string, importedAt = Date.now()) {
  if (utf8ToBytes(html).length > MAX_IMPORT_BYTES) {
    throw new Error('Il file supera il limite di 20 MB. Esporta una cartella di segnalibri più piccola.');
  }
  const bookmarks: Bookmark[] = [];
  const ids = new Set<string>();
  let skipped = 0;
  let duplicates = 0;
  let current: { url: string; title: string; added: string } | null = null;
  let ignored = 0;
  const finish = () => {
    if (!current) return;
    const { url, title, added } = current;
    current = null;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
        skipped++;
        return;
      }
    } catch { skipped++; return; }
    const id = urlHash(url);
    if (ids.has(id)) { duplicates++; return; }
    ids.add(id);
    const addedSeconds = Number(added);
    bookmarks.push({
      id, url, title: title.replace(/\s+/g, ' ').trim() || 'Segnalibro senza titolo',
      importedAt,
      sourceAddedAt: added && Number.isFinite(addedSeconds) && addedSeconds > 0 && addedSeconds < 8640000000000
        ? Math.floor(addedSeconds * 1000) : null,
      seen: 0, hidden: 0, rating: null,
    });
  };
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'script' || name === 'style') { ignored++; return; }
      if (ignored) return;
      if (name === 'a') {
        finish();
        current = { url: (attrs.href ?? '').trim(), title: '', added: attrs.add_date ?? '' };
      }
    },
    ontext(text) { if (current && !ignored) current.title += text; },
    onclosetag(name) {
      if (name === 'script' || name === 'style') ignored = Math.max(0, ignored - 1);
      if (name === 'a') finish();
    },
  }, { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true });
  parser.write(html);
  parser.end();
  finish();
  return { bookmarks, skipped, duplicates };
}

const alphabet = new Intl.Collator('it', { sensitivity: 'base', numeric: true });
export function selectBookmarks(bookmarks: Bookmark[], prefs: Preferences) {
  return bookmarks.filter(b => (prefs.showHidden || !b.hidden)
    && (prefs.seenFilter === 'all' || Boolean(b.seen) === (prefs.seenFilter === 'seen')))
    .sort((a, b) => {
      let result = 0;
      if (prefs.sort === 'imported') result = b.importedAt - a.importedAt;
      if (prefs.sort === 'rating') result = (b.rating ?? 0) - (a.rating ?? 0);
      return result || alphabet.compare(a.title, b.title) || a.id.localeCompare(b.id);
    });
}

export function readPreferences(value: unknown): Preferences {
  const p = (value && typeof value === 'object' ? value : {}) as Partial<Preferences>;
  return {
    sort: ['alphabetical', 'imported', 'rating'].includes(p.sort!) ? p.sort! : 'imported',
    seenFilter: ['all', 'unseen', 'seen'].includes(p.seenFilter!) ? p.seenFilter! : 'all',
    showHidden: p.showHidden === true,
    fontSize: Number.isFinite(p.fontSize) ? Math.min(38, Math.max(20, Math.round(p.fontSize!))) : 26,
    browser: typeof p.browser === 'string' && p.browser.length > 0 ? p.browser : null,
  };
}
