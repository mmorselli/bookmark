import { requireNativeModule } from 'expo-modules-core';
export type RemoteKey = 'up' | 'down' | 'left' | 'right' | 'select' | 'longSelect' | 'menu' | 'back';
export type Browser = { id: string; name: string };
const native = requireNativeModule('StreamMarkTV');
export const pickHtml = (attempt: string): Promise<{ name: string; html: string } | null> => native.pickHtml(attempt);
export const consumeImportInterruption = (): boolean => native.consumeImportInterruption();
export const openUrl = (url: string, browser: string | null): Promise<void> => native.openUrl(url, browser);
export const listBrowsers = (): Promise<Browser[]> => native.listBrowsers();
export function subscribeRemote(listener: (key: RemoteKey) => void) {
  const sub = native.addListener('onRemoteKey', ({ key }: { key: RemoteKey }) => listener(key));
  native.setInputEnabled(true);
  return () => { native.setInputEnabled(false); sub.remove(); };
}
