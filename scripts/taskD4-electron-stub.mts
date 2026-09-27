// Minimal Electron stub for the D4 functional test: lets the REAL
// appPrefs.ts (and its tray helpers) load under esbuild --platform=node
// without the electron binary. The userData dir is routed through a
// mutable global so the test can point it at a fresh temp directory.
export const app = {
  isPackaged: false,
  getPath: (_name: string) => (globalThis as any).__STUB_USERDATA,
  setPath: (_name: string, _p: string) => {},
  getLoginItemSettings: (_opts?: unknown) => ({ openAtLogin: false }),
  setLoginItemSettings: (_opts?: unknown) => {},
  quit: () => {},
};
export const globalShortcut = {
  register: (_accel: string, _cb: () => void) => true,
  unregister: (_accel: string) => {},
  unregisterAll: () => {},
};
export class BrowserWindow {
  static getAllWindows() {
    return [];
  }
}
export class Tray {
  constructor(_icon?: string) {}
  setToolTip(_t: string) {}
  on(_ev: string, _cb: (...a: any[]) => void) {}
  popUpContextMenu(_m?: unknown) {}
  displayBalloon(_opts?: unknown) {}
  destroy() {}
}
export const Menu = {
  buildFromTemplate: (_tpl: unknown) => ({ _tpl }),
};
export default { app, globalShortcut, BrowserWindow, Tray, Menu };
