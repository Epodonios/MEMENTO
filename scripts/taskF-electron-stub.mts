// Electron stub for the taskF functional tests — the D4/C2 stub extended
// with everything updateCenter.ts touches at module level (app.getPath for
// the userData override in paths.ts, BrowserWindow.getAllWindows for the
// progress emitter). The userData dir routes through a mutable global.
export const app = {
  isPackaged: false,
  getPath: (_name: string) => (globalThis as any).__STUB_USERDATA,
  setPath: (_name: string, _p: string) => {},
  getLoginItemSettings: (_opts?: unknown) => ({ openAtLogin: false }),
  setLoginItemSettings: (_opts?: unknown) => {},
  quit: () => {},
  exit: (_code?: number) => {},
  // The core managers register module-level app listeners; absorb them.
  on: (_ev: string, _cb?: (...a: any[]) => void) => {},
  once: (_ev: string, _cb?: (...a: any[]) => void) => {},
  off: (_ev: string, _cb?: (...a: any[]) => void) => {},
  emit: (_ev: string, ..._args: any[]) => false,
  isReady: true,
  whenReady: async () => true,
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
export const session = {
  fromPartition: (_name: string) => ({
    setProxy: async (_o: unknown) => {},
    fetch: async (_url: string, _init?: unknown): Promise<Response> => {
      throw new Error("no network in stub");
    },
  }),
};
export default { app, globalShortcut, BrowserWindow, Tray, Menu, session };
