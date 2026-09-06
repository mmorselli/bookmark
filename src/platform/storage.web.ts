// The browser preview uses IndexedDB. Android uses the SQLite repository.
import { parseBookmarks, readPreferences } from '../core/bookmarks';
import type { Bookmark, Preferences } from '../core/bookmarks';
import type { Repository } from '../core/repository';

export async function openRepository(): Promise<Repository> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('streammark-preview', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('bookmarks', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Impossibile aprire l’archivio locale del browser.'));
  });
  const transact = <T>(name: string, mode: IDBTransactionMode, work: (store: IDBObjectStore, result: (value: T) => void) => void) =>
    new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error ?? new Error('Salvataggio locale non riuscito.'));
      tx.onabort = () => reject(tx.error ?? new Error('Salvataggio locale annullato.'));
      work(tx.objectStore(name), result => { value = result; });
    });
  return {
    async init() {},
    list: () => transact<Bookmark[]>('bookmarks', 'readonly', (store, done) => {
      const request = store.getAll(); request.onsuccess = () => done(request.result);
    }),
    async importHtml(html, now = Date.now()) {
      const parsed = parseBookmarks(html, now);
      if (!parsed.bookmarks.length) throw new Error('Nessun segnalibro HTTP o HTTPS trovato. Seleziona un’esportazione HTML di Firefox.');
      return transact('bookmarks', 'readwrite', (store, done) => {
        let inserted = 0;
        for (const b of parsed.bookmarks) {
          const request = store.get(b.id);
          request.onsuccess = () => { if (!request.result) { store.add(b); inserted++; } };
        }
        const count = store.count();
        count.onsuccess = () => done({ inserted, duplicates: parsed.duplicates + parsed.bookmarks.length - inserted, skipped: parsed.skipped });
      });
    },
    update: (id, patch) => transact<void>('bookmarks', 'readwrite', (store, done) => {
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result) { store.transaction.abort(); return; }
        store.put({ ...request.result, ...patch }); done();
      };
    }),
    getPreferences: () => transact<Preferences>('settings', 'readonly', (store, done) => {
      const request = store.get('preferences'); request.onsuccess = () => done(readPreferences(request.result));
    }),
    savePreferences: prefs => transact<void>('settings', 'readwrite', (store, done) => { store.put(prefs, 'preferences'); done(); }),
  };
}
