import { app, BrowserWindow, globalShortcut, ipcMain, Notification, Tray, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import { loadConfig, saveConfig, clearAuth, VozzaConfig } from './config';
import { login, signup, transcribeViaBackend, fetchMe, createSubscription } from './backend';
import { pasteAtCursor } from './paste';

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
    title: 'VozzAI — Configurações',
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
  tray.setTitle(isRecording ? '🔴 VozzAI' : '🎙️ VozzAI');
  const loggedIn = Boolean(config.authToken);
  const menu = Menu.buildFromTemplate([
    { label: loggedIn ? `Conectado como ${config.userEmail}` : 'Sem conta — abra Configurações', enabled: false },
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
  if (!config.authToken) {
    new Notification({ title: 'VozzAI', body: 'Crie sua conta ou entre primeiro.' }).show();
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
  console.log(`[vozza] conta conectada: ${Boolean(config.authToken)}`);

  createRecorderWindow();

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('VozzAI — ditado por voz');
  updateTray();

  registerShortcut();

  if (!config.authToken) openSettings();

  ipcMain.handle('get-config', async () => {
    if (!config.authToken) return { loggedIn: false };
    const me = await fetchMe(config.authToken);
    return {
      loggedIn: true,
      email: config.userEmail,
      plan: me?.plan || 'free',
    };
  });

  ipcMain.handle('subscribe', async () => {
    const result = await createSubscription(config.authToken);
    if (result.error) return { ok: false, error: result.error };
    shell.openExternal(result.checkoutUrl as string);
    return { ok: true };
  });

  ipcMain.handle('signup', async (_event, email: string, password: string) => {
    const result = await signup(email, password);
    if (result.error) return { ok: false, error: result.error };
    config = saveConfig({ authToken: result.token, userEmail: result.email || email });
    updateTray();
    return { ok: true, email: config.userEmail };
  });

  ipcMain.handle('login', async (_event, email: string, password: string) => {
    const result = await login(email, password);
    if (result.error) return { ok: false, error: result.error };
    config = saveConfig({ authToken: result.token, userEmail: result.email || email });
    updateTray();
    return { ok: true, email: config.userEmail };
  });

  ipcMain.handle('logout', () => {
    config = clearAuth();
    updateTray();
    return { ok: true };
  });

  ipcMain.on('recording-error', (_event, message: string) => {
    console.log(`[vozza] erro na gravação: ${message}`);
    isRecording = false;
    updateTray();
    new Notification({ title: 'VozzAI — erro ao gravar', body: message }).show();
  });

  ipcMain.on('audio-recorded', async (_event, audioBase64: string) => {
    console.log(`[vozza] áudio recebido (${audioBase64.length} chars), transcrevendo...`);
    isRecording = false;
    updateTray();
    try {
      const result = await transcribeViaBackend(config.authToken, audioBase64, config.language);
      if (result.error) {
        new Notification({ title: 'VozzAI — erro', body: result.error }).show();
        return;
      }
      const pasteResult = await pasteAtCursor(result.text || '');
      if (pasteResult === 'clipboard-only') {
        new Notification({
          title: 'VozzAI',
          body: 'Texto copiado — Cmd+V para colar. Libere a Acessibilidade para colar sozinho.',
        }).show();
      }
    } catch (err) {
      console.log(`[vozza] erro: ${String(err)}`);
      new Notification({ title: 'VozzAI — erro', body: String(err) }).show();
    }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
// Mantém o app vivo na barra de menu mesmo sem janelas abertas.
app.on('window-all-closed', () => {});
