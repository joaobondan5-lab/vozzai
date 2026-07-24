import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vozza', {
  onStart: (cb: () => void) => ipcRenderer.on('start-recording', cb),
  onStop: (cb: () => void) => ipcRenderer.on('stop-recording', cb),
  sendAudio: (base64: string) => ipcRenderer.send('audio-recorded', base64),
  reportError: (message: string) => ipcRenderer.send('recording-error', message),
});
