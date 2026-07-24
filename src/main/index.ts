import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Notification, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { loadEnv } from './env';
import { loadConfig, saveConfig, maskKey, VozzaConfig } from './config';
import { transcribeAudio } from './transcription';
import { cleanupText } from './cleanup';

loadEnv();

let config: VozzaConfig;
let recorderWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
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

function openSettings(): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    title: 'Vozza — Configurações',
    webPreferences: {
      preload: path.join(__dirname, '../renderer/settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function updateTray(): void {
  if (!tray) return;
  tray.setTitle(isRecording ? '🔴 Vozza' : '🎙️ Vozza');
  const hasKey = Boolean(config.openaiApiKey);
  const menu = Menu.buildFromTemplate([
    { label: hasKey ? 'Chave configurada ✓' : 'Sem chave — abra Configurações', enabled: false },
    { type: 'separator' },
    { label: 'Configurações…', click: openSettings },
    { label: `Ditar (${config.shortcut})`, click: toggleRecording },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function toggleRecording(): void {
  if (!recorderWindow) return;
  if (!config.openaiApiKey) {
    new Notification({ title: 'Vozza', body: 'Configure sua chave da OpenAI primeiro.' }).show();
    openSettings();
    return;
  }
  isRecording = !isRecording;
  console.log(`[vozza] atalho — ${isRecording ? 'iniciando' : 'parando'} gravação`);
  recorderWindow.webContents.send(isRecording ? 'start-recording' : 'stop-recording');
  updateTray();
}

function registerShortcut(): void {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(config.shortcut, toggleRecording);
  console.log(`[vozza] registro do atalho ${config.shortcut}: ${ok ? 'OK' : 'FALHOU (conflito?)'}`);
}

app.whenReady().then(() => {
  config = loadConfig();
  console.log(`[vozza] chave presente: ${Boolean(config.openaiApiKey)}`);

  createRecorderWindow();

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Vozza — ditado por voz');
  updateTray();

  registerShortcut();

  if (!config.openaiApiKey) openSettings();

  ipcMain.handle('get-config', () => ({
    hasKey: Boolean(config.openaiApiKey),
    keyMasked: maskKey(config.openaiApiKey),
    shortcut: config.shortcut,
  }));

  ipcMain.handle('save-key', (_event, key: string) => {
    config = saveConfig({ openaiApiKey: key.trim() });
    updateTray();
    return { hasKey: Boolean(config.openaiApiKey), keyMasked: maskKey(config.openaiApiKey) };
  });

  ipcMain.on('recording-error', (_event, message: string) => {
    console.log(`[vozza] erro na gravação: ${message}`);
    isRecording = false;
    updateTray();
    new Notification({ title: 'Vozza — erro ao gravar', body: message }).show();
  });

  ipcMain.on('audio-recorded', async (_event, audioBase64: string) => {
    console.log(`[vozza] áudio recebido (${audioBase64.length} chars), transcrevendo...`);
    isRecording = false;
    updateTray();
    try {
      const rawText = await transcribeAudio(audioBase64, config.openaiApiKey, config.language);
      const finalText = await cleanupText(rawText, config.openaiApiKey);
      clipboard.writeText(finalText);
      new Notification({ title: 'Vozza', body: 'Texto copiado ✅ (Cmd+V para colar)' }).show();
    } catch (err) {
      console.log(`[vozza] erro: ${String(err)}`);
      new Notification({ title: 'Vozza — erro', body: String(err) }).show();
    }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
// Mantém o app vivo na barra de menu mesmo sem janelas abertas.
app.on('window-all-closed', () => {});
