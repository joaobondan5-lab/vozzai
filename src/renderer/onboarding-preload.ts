import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vozzaOnboarding', {
  login: (email: string, password: string) => ipcRenderer.invoke('login', email, password),
  signup: (email: string, password: string) => ipcRenderer.invoke('signup', email, password),
  micStatus: () => ipcRenderer.invoke('ob-mic-status'),
  micRequest: () => ipcRenderer.invoke('ob-mic-request'),
  accessibilityStatus: () => ipcRenderer.invoke('ob-accessibility-status'),
  accessibilityRequest: () => ipcRenderer.invoke('ob-accessibility-request'),
  shortcut: () => ipcRenderer.invoke('ob-shortcut'),
  finish: () => ipcRenderer.invoke('ob-finish'),
  onDictationDone: (cb: (text: string) => void) =>
    ipcRenderer.on('ob-dictation-done', (_e, text: string) => cb(text)),
  onDictationFailed: (cb: (message: string) => void) =>
    ipcRenderer.on('ob-dictation-failed', (_e, message: string) => cb(message)),
});
