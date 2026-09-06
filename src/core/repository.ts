import { parseBookmarks, readPreferences } from './bookmarks.ts';
import type { Bookmark, Preferences } from './bookmarks.ts';

export interface SqlConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
}
export interface SqlDatabase extends SqlConnection {
  withExclusiveTransactionAsync(task: (tx: SqlConnection) => Promise<void>): Promise<void>;
}

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    importedAt INTEGER NOT NULL,
    sourceAddedAt INTEGER,
    seen INTEGER NOT NULL DEFAULT 0 CHECK (seen IN (0, 1)),
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    rating INTEGER CHECK (rating BETWEEN 1 AND 5)
  );
  CREATE INDEX IF NOT EXISTS bookmarks_imported ON bookmarks(importedAt DESC);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  PRAGMA user_version = 1;
`;

export function createRepository(db: SqlDatabase, trace: (event: string, details?: unknown) => void = () => {}) {
  return {
    async init() {
      trace('db.init.begin');
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      const [version] = await db.getAllAsync<{ user_version: number }>('PRAGMA user_version');
      if (version.user_version > 1) throw new Error('Questo archivio richiede una versione più recente dell’app.');
      await db.execAsync(SCHEMA);
      trace('db.init.complete');
    },
    async list(): Promise<Bookmark[]> { return db.getAllAsync<Bookmark>('SELECT * FROM bookmarks'); },
    async importHtml(html: string, now = Date.now()) {
      trace('import.parse.begin', { chars: html.length });
      const parsed = parseBookmarks(html, now);
      trace('import.parse.complete', { bookmarks: parsed.bookmarks.length, duplicates: parsed.duplicates, skipped: parsed.skipped });
      if (!parsed.bookmarks.length) throw new Error('Nessun segnalibro HTTP o HTTPS trovato. Seleziona un’esportazione HTML di Firefox.');
      let inserted = 0;
      trace('import.transaction.begin');
      await db.withExclusiveTransactionAsync(async tx => {
        let processed = 0;
        for (const b of parsed.bookmarks) {
          const result = await tx.runAsync(
            'INSERT INTO bookmarks (id, url, title, importedAt, sourceAddedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
            b.id, b.url, b.title, b.importedAt, b.sourceAddedAt,
          );
          inserted += result.changes;
          processed++;
          if (processed === 1 || processed % 100 === 0) trace('import.transaction.progress', { processed, inserted });
        }
      }).catch(error => { trace('import.transaction.failed', error); throw error; });
      trace('import.transaction.committed', { inserted });
      return { inserted, duplicates: parsed.duplicates + parsed.bookmarks.length - inserted, skipped: parsed.skipped };
    },
    async update(id: string, patch: Partial<Pick<Bookmark, 'seen' | 'hidden' | 'rating'>>) {
      const entries = Object.entries(patch).filter(([key]) => ['seen', 'hidden', 'rating'].includes(key));
      for (const [key, value] of entries) {
        if (key === 'rating' ? value !== null && (!Number.isInteger(value) || value! < 1 || value! > 5) : value !== 0 && value !== 1) {
          throw new Error('Valore del segnalibro non valido.');
        }
      }
      if (!entries.length) return;
      const result = await db.runAsync(`UPDATE bookmarks SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`,
        ...entries.map(([, value]) => value as number | null), id);
      if (!result.changes) throw new Error('Il segnalibro non è più disponibile.');
    },
    async getPreferences() {
      const rows = await db.getAllAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'preferences'");
      try { return readPreferences(rows.length ? JSON.parse(rows[0].value) : null); }
      catch { return readPreferences(null); }
    },
    async savePreferences(prefs: Preferences) {
      await db.runAsync("INSERT INTO settings (key, value) VALUES ('preferences', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(prefs));
    },
  };
}
export type Repository = ReturnType<typeof createRepository>;
