import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseBookmarks, selectBookmarks, defaultPreferences, readPreferences, urlHash } from '../src/core/bookmarks.ts';
import { createRepository } from '../src/core/repository.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  const driver = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...params) { return sqlite.prepare(sql).run(...params); },
    async getAllAsync(sql, ...params) { return sqlite.prepare(sql).all(...params); },
    async withExclusiveTransactionAsync(task) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(driver); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, repository: createRepository(driver), driver };
}

test('Firefox HTML: folders, Unicode, entities, multiple attribute styles, and duplicate URLs', () => {
  const parsed = parseBookmarks(`<DL><p><DT><H3>Cartella</H3><DL><p>
    <DT><A ICON="data:unneeded" HREF='https://example.org/a?x=1&amp;y=2' ADD_DATE="1700000000">L&#39;arte &amp; la città &#x1f3ac; <b>in TV</b></A>
    <DT><a href=https://example.org/b> Secondo\n titolo </a>
    <DT><A HREF="https://example.org/a?x=1&amp;y=2">Duplicato</A>
    <DT><A HREF="https://example.org/C">Maiuscolo</A>
    <DT><A HREF="https://example.org/c">Minuscolo</A>
    </DL></DL>`, 1234);
  assert.equal(parsed.bookmarks.length, 4);
  assert.equal(parsed.duplicates, 1);
  assert.equal(parsed.bookmarks[0].url, 'https://example.org/a?x=1&y=2');
  assert.equal(parsed.bookmarks[0].title, "L'arte & la città 🎬 in TV");
  assert.equal(parsed.bookmarks[0].importedAt, 1234);
  assert.equal(parsed.bookmarks[0].sourceAddedAt, 1700000000000);
  assert.equal(parsed.bookmarks[1].title, 'Secondo titolo');
});

test('only web URLs are accepted and HTML never executes', () => {
  const parsed = parseBookmarks(`<script>"<a href='https://evil.test'>fake</a>"</script>
    <a href="javascript:alert(1)">bad</a><a href="file:///data/local">bad</a>
    <a href="data:text/html,a">bad</a><a href="/relative">bad</a><a>bad</a>
    <a href="https://example.org">Title<script>alert(1)</script><style>bad</style> safe</a>`);
  assert.equal(parsed.bookmarks.length, 1);
  assert.equal(parsed.skipped, 5);
  assert.equal(parsed.bookmarks[0].title, 'Title safe');
});

test('SHA-256 hash agrees with node crypto for UTF-8 URLs', () => {
  const url = 'https://example.org/città?x=🎬';
  assert.equal(urlHash(url), createHash('sha256').update(url).digest('hex'));
});

test('long titles remain complete; missing title and invalid source date have sensible fallbacks', () => {
  const title = 'Un titolo molto lungo '.repeat(100);
  const parsed = parseBookmarks(`<a href="https://example.org/a">${title}</a><a href="https://example.org/b" ADD_DATE="no"></a>`);
  assert.equal(parsed.bookmarks[0].title, title.trim());
  assert.equal(parsed.bookmarks[1].title, 'Segnalibro senza titolo');
  assert.equal(parsed.bookmarks[1].sourceAddedAt, null);
});

test('SQLite reimport preserves first import date, title, seen, rating, and hidden flag', async () => {
  const { repository: repo, sqlite } = database();
  await repo.init();
  const html = '<a href="https://example.org/a" ADD_DATE="1500000000">Titolo</a>';
  assert.deepEqual(await repo.importHtml(html, 1000), { inserted: 1, duplicates: 0, skipped: 0 });
  const [first] = await repo.list();
  await repo.update(first.id, { seen: 1, rating: 5, hidden: 1 });
  assert.deepEqual(await repo.importHtml(html.replace('Titolo', 'Nuovo titolo'), 2000), { inserted: 0, duplicates: 1, skipped: 0 });
  const [saved] = await repo.list();
  assert.deepEqual({ ...saved }, { ...first, seen: 1, rating: 5, hidden: 1 });
  await repo.update(first.id, { seen: 0, hidden: 0, rating: 1 });
  assert.equal((await repo.list())[0].hidden, 0);
  sqlite.close();
});

test('imports are atomic if any insertion fails', async () => {
  const { repository: repo, sqlite, driver } = database();
  await repo.init();
  const run = driver.runAsync;
  driver.runAsync = async (sql, ...args) => {
    if (args.includes('https://example.org/b')) throw new Error('disk full');
    return run(sql, ...args);
  };
  await assert.rejects(repo.importHtml('<a href="https://example.org/a">A</a><a href="https://example.org/b">B</a>'), /disk full/);
  assert.equal((await repo.list()).length, 0);
  sqlite.close();
});

test('rating validation and settings survive repository recreation', async () => {
  const { repository: repo, sqlite, driver } = database();
  await repo.init();
  await repo.importHtml('<a href="https://example.org">A</a>');
  const [b] = await repo.list();
  for (const rating of [0, 6, 1.5, NaN]) await assert.rejects(repo.update(b.id, { rating }));
  const settings = { ...defaultPreferences, fontSize: 34, sort: 'rating', showHidden: true, browser: 'org.example.browser' };
  await repo.savePreferences(settings);
  assert.deepEqual(await createRepository(driver).getPreferences(), settings);
  assert.equal(readPreferences({ fontSize: 999 }).fontSize, 38);
  sqlite.close();
});

test('sorting and seen/hidden filters combine correctly without mutating source data', () => {
  const items = parseBookmarks('<a href="https://example.org/z">Zeta</a><a href="https://example.org/a">Alfa</a><a href="https://example.org/b">Beta</a>', 1000).bookmarks;
  items[0].rating = 5; items[0].seen = 1; items[1].hidden = 1; items[2].importedAt = 2000;
  assert.deepEqual(selectBookmarks(items, defaultPreferences).map(b => b.title), ['Beta', 'Zeta']);
  assert.deepEqual(selectBookmarks(items, { ...defaultPreferences, sort: 'rating' }).map(b => b.title), ['Zeta', 'Beta']);
  assert.deepEqual(selectBookmarks(items, { ...defaultPreferences, showHidden: true, sort: 'alphabetical' }).map(b => b.title), ['Alfa', 'Beta', 'Zeta']);
  assert.deepEqual(selectBookmarks(items, { ...defaultPreferences, seenFilter: 'unseen' }).map(b => b.title), ['Beta']);
  assert.deepEqual(selectBookmarks(items, { ...defaultPreferences, seenFilter: 'seen' }).map(b => b.title), ['Zeta']);
  assert.equal(items[0].title, 'Zeta');
});

test('invalid imports leave the existing archive intact', async () => {
  const { repository: repo, sqlite } = database();
  await repo.init();
  await repo.importHtml('<a href="https://example.org">A</a>');
  await assert.rejects(repo.importHtml('<html>Not a bookmark export</html>'), /Nessun segnalibro/);
  assert.equal((await repo.list()).length, 1);
  sqlite.close();
});

test('provided Firefox sample imports without exposing its contents in test output', { skip: !existsSync('sample/bookmarks.html') }, async () => {
  const { repository: repo, sqlite } = database();
  await repo.init();
  const html = readFileSync('sample/bookmarks.html', 'utf8');
  const result = await repo.importHtml(html);
  assert.ok(result.inserted > 0);
  const again = await repo.importHtml(html);
  assert.equal(again.inserted, 0);
  assert.equal((await repo.list()).length, result.inserted);
  sqlite.close();
});
