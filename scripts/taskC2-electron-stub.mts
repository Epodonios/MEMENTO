// Electron stub for the C2 functional test — extends the D4 stub with the
// `session` surface urlTest.ts needs at module level. The userData dir is
// routed through a mutable global (same trick as taskD4-electron-stub).
export const app = {
  isPackaged: false,
  getPath: (_name: string) => (globalThis as any).__STUB_USERDATA,
  setPath: (_name: string, _p: string) => {},
  getLoginItemSettings: (_opts?: unknown) => ({ openAtLogin: false }),
  setLoginItemSettings: (_opts?: unknown) => {},
  quit: () => {},
  // The core managers register module-level app listeners (xray.js does
  // `app.on("ready", ...)`); the stub must absorb them silently.
  on: (_ev: string, _cb?: (...a: any[]) => void) => {},
  once: (_ev: string, _cb?: (...a: any[]) => void) => {},
  off: (_ev: string, _cb?: (...a: any[]) => void) => {},
  emit: (_ev: string, ..._args: any[]) => false,
  isReady: true,
  whenReady: async () => true,
  // paths.resourceRoot() calls app.getAppPath() (the D4 quitclean lesson)
  getAppPath: () => (globalThis as any).__STUB_USERDATA,
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
// Phase C2: the probe's in-memory session. setProxy resolves; fetch throws
// so a stray real GET can never silently succeed inside a test.
export const session = {
  fromPartition: (_name: string) => ({
    setProxy: async (_o: unknown) => {},
    fetch: async (_url: string, _init?: unknown): Promise<Response> => {
      throw new Error("no network in stub");
    },
  }),
};
export default { app, globalShortcut, BrowserWindow, Tray, Menu, session };
