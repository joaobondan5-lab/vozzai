import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vozzaHistory', {
  list: () => ipcRenderer.invoke('history-list'),
  copy: (id: string) => ipcRenderer.invoke('history-copy', id),
  insert: (id: string) => ipcRenderer.invoke('history-insert', id),
  remove: (id: string) => ipcRenderer.invoke('history-delete', id),
  clear: () => ipcRenderer.invoke('history-clear'),
  toggle: (enabled: boolean) => ipcRenderer.invoke('history-toggle', enabled),
  onChanged: (cb: () => void) => ipcRenderer.on('history-changed', cb),
});
