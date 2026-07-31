import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vozzaSettings', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  signup: (email: string, password: string) => ipcRenderer.invoke('signup', email, password),
  login: (email: string, password: string) => ipcRenderer.invoke('login', email, password),
  logout: () => ipcRenderer.invoke('logout'),
  subscribe: (cycle: 'monthly' | 'annual' = 'monthly') => ipcRenderer.invoke('subscribe', cycle),
  setPreferences: (partial: { tone?: string; dictionary?: string }) =>
    ipcRenderer.invoke('set-preferences', partial),
  setMode: (id: string) => ipcRenderer.invoke('set-mode', id),
  /** Modo trocado pela bandeja enquanto esta janela está aberta. */
  onModeChanged: (cb: (id: string) => void) =>
    ipcRenderer.on('mode-changed', (_e, id: string) => cb(id)),
  setShortcut: (accelerator: string) => ipcRenderer.invoke('set-shortcut', accelerator),
});
