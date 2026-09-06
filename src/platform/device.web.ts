import { MAX_IMPORT_BYTES } from '../core/bookmarks';
import type { Browser, RemoteKey } from './device';
export const consumeImportInterruption = (): boolean => false;
export function pickHtml(_attempt: string): Promise<{ name: string; html: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm,text/html';
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        if (file.size > MAX_IMPORT_BYTES) throw new Error('Il file supera il limite di 20 MB.');
        resolve({ name: file.name, html: await file.text() });
      } catch (e) { reject(e); }
    };
    input.click();
  });
}
export async function openUrl(url: string, _browser: string | null) {
  const opened = window.open(url, '_blank');
  if (!opened) throw new Error('Consenti l’apertura di nuove schede per aprire questo segnalibro.');
  opened.opener = null;
}
export const listBrowsers = async (): Promise<Browser[]> => [];
export function subscribeRemote(listener: (key: RemoteKey) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held: string | null = null;
  let long = false;
  const reset = () => { if (timer) clearTimeout(timer); timer = null; held = null; long = false; };
  const keys: Record<string, RemoteKey> = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'select', ' ': 'select', Escape: 'back', Backspace: 'back', ContextMenu: 'menu', F2: 'menu',
  };
  const down = (event: KeyboardEvent) => {
    const key = keys[event.key];
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 'select') {
      if (!event.repeat) {
        reset(); held = event.key;
        timer = setTimeout(() => { long = true; listener('longSelect'); }, 550);
      }
    } else if (!event.repeat || ['up', 'down', 'left', 'right'].includes(key)) {
      reset(); listener(key);
    }
  };
  const up = (event: KeyboardEvent) => {
    if (keys[event.key]) { event.preventDefault(); event.stopPropagation(); }
    if (held === event.key) { if (!long) listener('select'); reset(); }
  };
  // The app owns remote navigation. Capture before a previously focused DOM
  // button can consume Enter or activate behind an open dialog.
  window.addEventListener('keydown', down, true);
  window.addEventListener('keyup', up, true);
  window.addEventListener('blur', reset);
  return () => {
    reset(); window.removeEventListener('keydown', down, true);
    window.removeEventListener('keyup', up, true); window.removeEventListener('blur', reset);
  };
}
