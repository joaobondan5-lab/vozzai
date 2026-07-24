import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Notification, Tray, nativeImage } from 'electron';
import * as path from 'path';
import { loadEnv } from './env';
import { transcribeAudio } from './transcription';
import { cleanupText } from './cleanup';

loadEnv();

const SHORTCUT = 'CommandOrControl+Shift+Space';

let recorderWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isRecording = false;

function createRecorderWindow(): void {
  recorderWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  recorderWindow.loadFile(path.join(__dirname, '../renderer/recorder.html'));
}

function updateTrayTitle(): void {
  tray?.setTitle(isRecording ? '🔴 Vozza' : '🎙️ Vozza');
}

function toggleRecording(): void {
  if (!recorderWindow) return;
  isRecording = !isRecording;
  recorderWindow.webContents.send(isRecording ? 'start-recording' : 'stop-recording');
  updateTrayTitle();
}

app.whenReady().then(() => {
  createRecorderWindow();

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip(`Vozza — ditado por voz (${SHORTCUT})`);
  updateTrayTitle();

  globalShortcut.register(SHORTCUT, toggleRecording);

  ipcMain.on('audio-recorded', async (_event, audioBase64: string) => {
    isRecording = false;
    updateTrayTitle();
    try {
      const rawText = await transcribeAudio(audioBase64);
      const finalText = await cleanupText(rawText);
      clipboard.writeText(finalText);
      new Notification({ title: 'Vozza', body: 'Texto copiado para a área de transferência ✅' }).show();
    } catch (err) {
      new Notification({ title: 'Vozza — erro', body: String(err) }).show();
    }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
