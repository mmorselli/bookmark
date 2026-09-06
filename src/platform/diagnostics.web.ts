import config from '../../app.json';
import type { AppInfo, LogSnapshot } from './diagnostics';

export const appInfo: AppInfo = { version: config.expo.version, build: String(config.expo.android.versionCode), device: 'Anteprima web' };
const key = 'bookmark-diagnostics';
let fallback = '';
function contents() { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
export function diagnostic(event: string, details: unknown = '') {
  try {
    const value = details instanceof Error ? details.stack ?? details.message : typeof details === 'string' ? details : JSON.stringify(details);
    fallback = `${contents()}${new Date().toISOString()} js.${event} ${value}\n`.slice(-250000);
    localStorage.setItem(key, fallback);
  } catch { /* The preview remains usable without localStorage. */ }
}
export async function readDiagnostics(): Promise<LogSnapshot> {
  const text = contents();
  return { ...appInfo, text: text.slice(-60000), filePath: 'Archivio locale del browser', truncated: String(text.length > 60000), writeError: '' };
}
export async function exportDiagnostics() {
  const name = `Bookmark-${appInfo.version}-build-${appInfo.build}.log.txt`;
  const url = URL.createObjectURL(new Blob([`Bookmark ${appInfo.version} · build ${appInfo.build}\n${contents()}`], { type: 'text/plain' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
let installed = false;
export function installDiagnostics() {
  if (installed) return;
  installed = true;
  diagnostic('runtime.start', appInfo);
  window.addEventListener('error', e => diagnostic('uncaught', e.error ?? e.message));
  window.addEventListener('unhandledrejection', e => diagnostic('unhandledRejection', e.reason));
}
