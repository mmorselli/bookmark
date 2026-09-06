import { requireNativeModule } from 'expo-modules-core';
import config from '../../app.json';

export type AppInfo = { version: string; build: string; device: string };
export type LogSnapshot = AppInfo & { text: string; filePath: string; truncated: string; writeError: string };
const native = requireNativeModule('StreamMarkTV');
export const appInfo: AppInfo = native.getAppInfo();
export function diagnostic(event: string, details: unknown = '') {
  try {
    const text = details instanceof Error ? `${details.name}: ${details.message}\n${details.stack ?? ''}`
      : typeof details === 'string' ? details : JSON.stringify(details);
    native.writeDiagnostic(event, text ?? 'undefined');
  } catch { /* Diagnostics must never prevent the operation being observed. */ }
}
export const readDiagnostics = (): Promise<LogSnapshot> => native.readDiagnostics();
export const exportDiagnostics = (): Promise<string> => native.exportDiagnostics();

let installed = false;
export function installDiagnostics() {
  if (installed) return;
  installed = true;
  diagnostic('runtime.start', { installed: appInfo, bundleVersion: config.expo.version, bundleBuild: config.expo.android.versionCode, builtAt: (config.expo as { extra?: { builtAt?: string } }).extra?.builtAt });
  const utils = (globalThis as typeof globalThis & { ErrorUtils?: {
    getGlobalHandler(): (error: Error, fatal?: boolean) => void;
    setGlobalHandler(handler: (error: Error, fatal?: boolean) => void): void;
  } }).ErrorUtils;
  if (utils) {
    const previous = utils.getGlobalHandler();
    utils.setGlobalHandler((error, fatal) => { diagnostic(fatal ? 'uncaught.fatal' : 'uncaught', error); previous(error, fatal); });
  }
  for (const level of ['warn', 'error'] as const) {
    const previous = console[level];
    console[level] = (...args: unknown[]) => {
      diagnostic(`console.${level}`, args.map(arg => arg instanceof Error ? arg.stack : String(arg)).join(' '));
      previous(...args);
    };
  }
}
