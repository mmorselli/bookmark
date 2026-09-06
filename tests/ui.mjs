import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.STREAMMARK_CHROMIUM || undefined,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const baseURL = process.env.STREAMMARK_TEST_URL || 'http://localhost:8082';
const settle = () => page.waitForTimeout(180);
const rows = () => page.getByTestId(/^bookmark-\d+$/);
const dbRows = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('streammark-preview', 1);
  open.onsuccess = () => {
    const tx = open.result.transaction('bookmarks');
    const request = tx.objectStore('bookmarks').getAll();
    request.onsuccess = () => { resolve(request.result); open.result.close(); };
    request.onerror = () => reject(request.error);
  };
}));
const dismissNotice = async () => {
  const notice = page.getByRole('alert');
  if (await notice.count()) await notice.click();
};
const importFile = async file => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('toolbar-0').click();
  await (await chooser).setFiles(file);
  await page.getByRole('alert').waitFor();
  await dismissNotice();
};

try {
  await page.goto(baseURL);
  await page.getByText('Nessun segnalibro', { exact: true }).waitFor({ timeout: 120000 });
  await mkdir('dist/screenshots', { recursive: true });
  await page.screenshot({ path: 'dist/screenshots/empty.png' });
  const cancelledPicker = page.waitForEvent('filechooser');
  await page.getByTestId('toolbar-0').click();
  const pendingFile = await cancelledPicker;
  await page.keyboard.press('F2');
  await page.getByTestId('log-viewer').waitFor();
  assert.match(await page.getByTestId('log-text').textContent(), /import.picker.call/);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pendingFile.setFiles([]);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').textContent(), /nessun file ricevuto/);
  await page.waitForTimeout(7000);
  assert.equal(await page.getByRole('alert').count(), 1, 'a notice must not expire while the file manager covers the app');
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle();
  assert.equal(await page.getByRole('alert').count(), 1, 'the notice remains readable when the app returns to foreground');
  await dismissNotice();
  await importFile('sample/demo.html');
  assert.equal((await dbRows()).length, 6);
  await importFile('sample/demo.html');
  assert.equal((await dbRows()).length, 6, 'reimport must not duplicate rows');

  await page.getByTestId('toolbar-7').click();
  await page.getByTestId('log-text').waitFor();
  assert.match(await page.getByTestId('log-text').textContent(), /import.picker.return/);
  assert.match(await page.getByTestId('log-text').textContent(), /import.database.complete/);
  const logDownload = page.waitForEvent('download');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const downloaded = await logDownload;
  assert.match(downloaded.suggestedFilename(), /^Bookmark-\d+\.\d+\.\d+-build-\d+\.log\.txt$/);
  assert.match(await readFile(await downloaded.path(), 'utf8'), /js.import.database.complete/);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('log-viewer').count(), 0);
  await page.reload();
  await page.getByTestId('bookmark-0').waitFor();
  await page.getByTestId('toolbar-7').click();
  assert.match(await page.getByTestId('log-text').textContent(), /import.database.complete/);
  await page.keyboard.press('Escape');
  // Restore collection focus after checking that logs survive a reload.
  await page.keyboard.press('ArrowDown');

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.down('Enter');
  await page.waitForTimeout(650);
  await page.keyboard.up('Enter');
  await page.getByText('Gestisci segnalibro', { exact: true }).waitFor();
  assert.equal((await dbRows()).filter(b => b.seen).length, 0, 'holding OK must not open the browser');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight'); await settle();
  await page.keyboard.press('ArrowRight'); await settle();
  assert.equal((await dbRows()).filter(b => b.rating === 2).length, 1);
  await page.getByRole('button', { name: 'Assegna 5 stelle', exact: true }).click(); await settle();
  await page.getByTestId('action-0').click(); await settle();
  assert.equal((await dbRows()).filter(b => b.seen).length, 1);
  await page.screenshot({ path: 'dist/screenshots/context-menu.png' });
  await page.keyboard.press('Escape');

  await page.getByTestId('toolbar-4').click(); await settle();
  await page.getByTestId('toolbar-4').click(); await settle();
  await page.reload();
  await page.getByTestId('bookmark-0').waitFor();
  assert.ok(await page.getByLabel('Dimensione testo 30').count());
  assert.equal((await dbRows()).filter(b => b.rating === 5 && b.seen).length, 1);
  await page.getByTestId('menu-0').click();
  await page.getByTestId('action-2').click(); await settle();
  await page.keyboard.press('Escape');
  assert.equal((await dbRows()).filter(b => b.hidden).length, 1);
  await page.getByTestId('toolbar-5').click(); await settle();
  await page.getByText('Nascosto', { exact: true }).first().waitFor();
  await page.getByTestId('menu-0').click();
  await page.getByTestId('action-2').click(); await settle();
  await page.keyboard.press('Escape');
  assert.equal((await dbRows()).filter(b => b.hidden).length, 0);

  await page.getByTestId('toolbar-2').click();
  await page.getByRole('radio', { name: 'Già visti', exact: true }).click(); await settle();
  assert.equal(await rows().count(), 1);
  await page.getByTestId('toolbar-2').click();
  await page.getByRole('radio', { name: 'Da vedere', exact: true }).click(); await settle();
  assert.equal(await rows().count(), 5);
  await page.getByTestId('toolbar-2').click();
  await page.getByRole('radio', { name: 'Tutti', exact: true }).click(); await settle();
  await page.getByTestId('toolbar-1').click();
  await page.getByRole('radio', { name: 'Valutazione', exact: true }).click(); await settle();
  assert.match(await page.getByTestId('bookmark-0').getAttribute('aria-label'), /5 stelle/);

  // Exercise browser success/failure without visiting any external website.
  await page.evaluate(() => { window.open = () => null; });
  await page.getByTestId('bookmark-1').click();
  await page.getByRole('alert').waitFor();
  assert.equal((await dbRows()).filter(b => b.seen).length, 1, 'failed browser launch must not mark seen');
  await dismissNotice();
  await page.evaluate(() => { window.open = () => ({ opener: null }); });
  await page.getByTestId('bookmark-1').click(); await settle();
  assert.equal((await dbRows()).filter(b => b.seen).length, 2);
  await page.screenshot({ path: 'dist/screenshots/library.png' });

  await page.setViewportSize({ width: 960, height: 540 });
  await settle();
  await page.screenshot({ path: 'dist/screenshots/tv-960.png' });
  const bar = await page.getByTestId('appbar').boundingBox();
  const version = await page.getByTestId('app-version').boundingBox();
  assert.ok(version.x + version.width <= 960 && version.y + version.height <= bar.y + bar.height, 'version and log button fit the TV appbar');
  await page.getByTestId('menu-0').click();
  await page.keyboard.press('ArrowDown');
  await page.screenshot({ path: 'dist/screenshots/tv-context-960.png' });
  await page.keyboard.press('Escape');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'TV layout must fit landscape viewport');

  // Exercise virtualized scrolling with wrapping, variable-height titles.
  const many = Array.from({ length: 160 }, (_, index) => `<DT><A HREF="https://example.org/${index}">Elemento ${String(index).padStart(3, '0')} ${index % 4 === 0 ? 'con un titolo molto lungo che deve andare a capo e restare leggibile per intero sul televisore'.repeat(index === 0 ? 14 : 2) : 'di prova'}</A>`).join('\n');
  await importFile({ name: 'many.html', mimeType: 'text/html', buffer: Buffer.from(`<DL>${many}</DL>`) });
  await page.getByTestId('toolbar-1').click();
  await page.getByRole('radio', { name: 'Titolo A–Z', exact: true }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); await settle();
  await page.keyboard.press('ArrowDown'); await settle();
  const longRow = page.getByTestId('bookmark-2');
  assert.equal(await longRow.getAttribute('aria-selected'), 'true');
  const before = await longRow.boundingBox();
  await page.keyboard.press('ArrowDown'); await settle();
  assert.equal(await longRow.getAttribute('aria-selected'), 'true', 'scroll all lines before leaving a tall title');
  const after = await longRow.boundingBox();
  assert.ok(after.y < before.y, 'down must reveal remaining lines of an oversized title');
  for (let i = 0; i < 500 && !await page.getByTestId('bookmark-165').and(page.locator('[aria-selected="true"]')).count(); i++) {
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1000);
  const finalRow = page.getByTestId('bookmark-165');
  await finalRow.waitFor();
  assert.equal(await finalRow.getAttribute('aria-selected'), 'true');
  const box = await finalRow.boundingBox();
  assert.ok(box && box.y < 540 && box.y + box.height > 0, 'last item must scroll into view');
  assert.deepEqual(errors, [], 'no runtime errors');
  console.log('UI OK: import, deduplication, long OK, ratings, seen, hidden/reactivation, filters, sorting, persistence, browser errors, TV layout, 166-row keyboard navigation.');
} catch (error) {
  await mkdir('dist/screenshots', { recursive: true });
  await page.screenshot({ path: 'dist/screenshots/failure.png' });
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
}
