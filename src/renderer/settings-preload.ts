import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vozzaSettings', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveKey: (key: string) => ipcRenderer.invoke('save-key', key),
});
