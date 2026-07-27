import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vozzaSettings', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  signup: (email: string, password: string) => ipcRenderer.invoke('signup', email, password),
  login: (email: string, password: string) => ipcRenderer.invoke('login', email, password),
  logout: () => ipcRenderer.invoke('logout'),
  subscribe: () => ipcRenderer.invoke('subscribe'),
  setPreferences: (partial: { tone?: string; dictionary?: string }) =>
    ipcRenderer.invoke('set-preferences', partial),
  setShortcut: (accelerator: string) => ipcRenderer.invoke('set-shortcut', accelerator),
});
