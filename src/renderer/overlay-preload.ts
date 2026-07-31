import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vozzaOverlay', {
  onState: (cb: (state: string) => void) =>
    ipcRenderer.on('overlay-state', (_e, state: string) => cb(state)),
  onLevel: (cb: (level: number) => void) =>
    ipcRenderer.on('overlay-level', (_e, level: number) => cb(level)),
  onMode: (cb: (name: string) => void) =>
    ipcRenderer.on('overlay-mode', (_e, name: string) => cb(name)),
  onDiff: (cb: (diff: { raw: string; final: string }) => void) =>
    ipcRenderer.on('overlay-diff', (_e, diff) => cb(diff)),
});
