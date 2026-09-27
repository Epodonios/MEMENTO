/**
 * MementoSetup — preload bridge.
 *
 * Exposes the minimal typed `window.setupAPI` to the wizard (the design's
 * demo script speaks through it now). contextIsolation:true,
 * nodeIntegration:false. Every channel is fixed — the renderer can pick a
 * destination, run the install, watch its progress stream, launch the app
 * or control the window; nothing else exists.
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

const api = {
  isSetup: true,

  getContext: (): Promise<unknown> => ipcRenderer.invoke("setup:ctx"),
  statPath: (p: string): Promise<unknown> => ipcRenderer.invoke("setup:statPath", { path: p }),
  chooseDir: (current: string): Promise<string | null> =>
    ipcRenderer.invoke("setup:chooseDir", { current }),
  start: (opts: { destDir: string; createDesktopShortcut: boolean }): Promise<boolean> =>
    ipcRenderer.invoke("setup:start", opts),
  cancel: (): Promise<boolean> => ipcRenderer.invoke("setup:cancel"),
  launch: (): Promise<boolean> => ipcRenderer.invoke("setup:launch"),
  close: (): Promise<boolean> => ipcRenderer.invoke("setup:close"),
  minimize: (): Promise<boolean> => ipcRenderer.invoke("setup:minimize"),
  /** Field report #3 remediation helpers (2.0.5): the error row can send
   *  the user straight to Windows Security and put the exact exclusion
   *  candidate paths on the clipboard. Read-only OS touchpoints — the
   *  setup still never modifies Defender settings itself. */
  openDefender: (): Promise<boolean> => ipcRenderer.invoke("setup:openDefender"),
  copyPayloadPaths: (): Promise<string> => ipcRenderer.invoke("setup:copyPayloadPaths"),

  /** The install event stream (log / pct / status / done / error). */
  onEvent: (cb: (ev: unknown) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("setup:event", handler);
    return () => {
      ipcRenderer.removeListener("setup:event", handler);
    };
  },
};

contextBridge.exposeInMainWorld("setupAPI", api);

export type SetupAPI = typeof api;
