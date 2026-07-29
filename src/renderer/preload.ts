import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vozza', {
  onStart: (cb: () => void) => ipcRenderer.on('start-recording', cb),
  onStop: (cb: () => void) => ipcRenderer.on('stop-recording', cb),
  onCancel: (cb: () => void) => ipcRenderer.on('cancel-recording', cb),
  sendAudio: (base64: string) => ipcRenderer.send('audio-recorded', base64),
  /** Volume do microfone, 0…1 — alimenta as barras do painel. Nunca áudio. */
  sendLevel: (level: number) => ipcRenderer.send('mic-level', level),
  reportError: (message: string) => ipcRenderer.send('recording-error', message),
  /** Parar pedido antes de a gravação nascer: volta ao repouso, sem erro. */
  abortRecording: () => ipcRenderer.send('recording-aborted'),
});
