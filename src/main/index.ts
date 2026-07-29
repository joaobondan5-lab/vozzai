import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Notification,
  Tray,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  shell,
  clipboard,
  systemPreferences,
} from 'electron';
import * as path from 'path';
import { loadConfig, saveConfig, clearAuth, VozzaConfig } from './config';
import {
  login,
  signup,
  transcribeViaBackend,
  fetchMe,
  createSubscription,
  updatePreferences,
  trackEvent,
  TranscribeResult,
  UsageStatus,
} from './backend';
import { pasteAtCursor, captureFrontmostApp, activateApp } from './paste';
import { DictationMachine } from './state';
import { HistoryStore } from './history';
import { CLIENT_MODES } from './modes';
import { initOverlay, syncOverlay, setOverlayLevel, showOverlayDiff, destroyOverlay } from './overlay';

let config: VozzaConfig;
let recorderWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let historyWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const machine = new DictationMachine();
let history: HistoryStore;

/** Última transcrição em memória — existe mesmo com o histórico desativado. */
let lastTranscription: string | null = null;
/** Original do último ditado, quando a limpeza mudou alguma coisa. */
let lastRaw: string | null = null;
/** App em primeiro plano quando o ditado começou — ver captureFrontmostApp(). */
let dictationTargetApp: string | null = null;
let capturingTarget = false;
/** Áudio do último ditado que falhou por rede/servidor, guardado só em memória para "tentar de novo". */
let pendingAudio: string | null = null;
/** Índice do último aviso de cota mostrado (0 = nenhum), para não repetir a cada ditado. */
let lastWarnedBucket = 0;
let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

// Acima disso o body estoura o limite do servidor depois de o usuário já ter
// falado tudo — melhor parar e transcrever do que perder o ditado inteiro.
const MAX_RECORDING_MS = 10 * 60 * 1000;
const QUOTA_THRESHOLDS = [0.7, 0.85, 0.95];

function windowOptions(preload: string, size: { width: number; height: number }) {
  return {
    ...size,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, `../renderer/${preload}`),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}

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
    ...windowOptions('settings-preload.js', { width: 480, height: 640 }),
    title: 'VozzAI — Configurações',
  });
  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function openHistory(): void {
  if (historyWindow) {
    historyWindow.focus();
    return;
  }
  historyWindow = new BrowserWindow({
    ...windowOptions('history-preload.js', { width: 500, height: 620 }),
    title: 'VozzAI — Histórico',
  });
  historyWindow.loadFile(path.join(__dirname, '../renderer/history.html'));
  historyWindow.on('closed', () => {
    historyWindow = null;
  });
}

function openOnboarding(): void {
  if (onboardingWindow) {
    onboardingWindow.focus();
    return;
  }
  onboardingWindow = new BrowserWindow({
    ...windowOptions('onboarding-preload.js', { width: 580, height: 660 }),
    title: 'Bem-vindo ao VozzAI',
  });
  onboardingWindow.loadFile(path.join(__dirname, '../renderer/onboarding.html'));
  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });
}

/** Avisa a janela de onboarding (se aberta) sobre o andamento do ditado de teste. */
function tellOnboarding(channel: string, payload?: unknown): void {
  onboardingWindow?.webContents.send(channel, payload);
}

function notify(title: string, body: string, onClick?: () => void): void {
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
}

/* ============ Tray ============ */

function prettyShortcut(): string {
  return config.shortcut
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', '⌃')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace('Space', 'Espaço')
    .replace(/\+/g, ' ');
}

function statusLine(): string {
  if (!config.authToken) return 'Sem conta — abra Configurações';
  switch (machine.current) {
    case 'recording':
      return 'Gravando — fale à vontade';
    case 'processing':
      return 'Transcrevendo…';
    case 'inserting':
      return 'Inserindo o texto…';
    default:
      return `Conectado como ${config.userEmail}`;
  }
}

function updateTray(): void {
  if (!tray) return;
  const icon = { idle: '🎙️', recording: '🔴', processing: '⏳', inserting: '⏳' }[machine.current];
  tray.setTitle(`${icon} VozzAI`);

  const state = machine.current;
  const items: MenuItemConstructorOptions[] = [
    { label: statusLine(), enabled: false },
    { type: 'separator' },
  ];

  if (state === 'idle') {
    items.push({ label: `Ditar (${prettyShortcut()})`, click: toggleRecording });
    if (pendingAudio) {
      items.push({ label: 'Tentar transcrever de novo', click: retryPendingAudio });
    }
  } else if (state === 'recording') {
    items.push({ label: 'Parar e transcrever', click: toggleRecording });
    items.push({ label: 'Cancelar ditado (Esc)', click: cancelRecording });
  } else {
    items.push({ label: 'Transcrevendo…', enabled: false });
  }

  items.push(
    { type: 'separator' },
    {
      label: 'Modo de escrita',
      submenu: CLIENT_MODES.map((m) => ({
        label: m.proOnly ? `${m.name} · Pro` : m.name,
        type: 'radio' as const,
        checked: config.mode === m.id,
        click: () => {
          config = saveConfig({ mode: m.id });
          trackEvent(config.authToken, 'mode_changed', { mode: m.id });
          updateTray();
        },
      })),
    },
    { type: 'separator' },
    { label: 'Copiar última transcrição', enabled: Boolean(lastTranscription), click: copyLast },
    {
      label: 'Copiar original (sem edição)',
      enabled: Boolean(lastRaw),
      click: copyLastRaw,
    },
    { label: 'Inserir última de novo', enabled: Boolean(lastTranscription), click: insertLastAgain },
    { label: 'Histórico…', click: openHistory },
    { type: 'separator' },
    { label: 'Configurações…', click: openSettings },
    { label: 'Sair', click: () => app.quit() },
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

/* ============ Fluxo do ditado ============ */

async function toggleRecording(): Promise<void> {
  if (!recorderWindow) return;
  if (!config.authToken) {
    notify('VozzAI', 'Crie sua conta ou entre primeiro.');
    if (config.onboardingDone) openSettings();
    else openOnboarding();
    return;
  }

  if (machine.current === 'idle') {
    if (capturingTarget) return; // atalho apertado 2x rápido demais — ignora o repique
    capturingTarget = true;
    // Precisa capturar ANTES de iniciar: mostrar o painel ativa o VozzAI de
    // verdade (ver overlay.ts), o que tira o foco de quem for o app de
    // destino. Sem isso, o Cmd+V do fim tenta colar no próprio VozzAI.
    dictationTargetApp = await captureFrontmostApp();
    capturingTarget = false;
    if (machine.current !== 'idle') return; // mudou de estado enquanto capturava (ex.: cancelado)

    if (!machine.to('recording')) return;
    trackEvent(config.authToken, 'dictation_started', { mode: config.mode });
    recorderWindow.webContents.send('start-recording');
    maxDurationTimer = setTimeout(() => {
      if (machine.current === 'recording') {
        notify('VozzAI', 'Ditado chegou a 10 minutos — transcrevendo o que você falou até aqui.');
        stopAndProcess();
      }
    }, MAX_RECORDING_MS);
    return;
  }

  if (machine.current === 'recording') {
    stopAndProcess();
    return;
  }

  // processing/inserting: um ditado por vez — avisa em vez de engolir o atalho.
  notify('VozzAI', 'Ainda estou transcrevendo o ditado anterior. Um instante…');
}

function stopAndProcess(): void {
  if (!machine.to('processing')) return;
  clearRecordingTimer();
  recorderWindow?.webContents.send('stop-recording');
}

function cancelRecording(): void {
  if (machine.current !== 'recording') return;
  clearRecordingTimer();
  recorderWindow?.webContents.send('cancel-recording');
  machine.reset();
  trackEvent(config.authToken, 'dictation_cancelled');
  notify('VozzAI', 'Ditado cancelado — nada foi enviado.');
}

function clearRecordingTimer(): void {
  if (maxDurationTimer) {
    clearTimeout(maxDurationTimer);
    maxDurationTimer = null;
  }
}

function retryPendingAudio(): void {
  const audio = pendingAudio;
  if (!audio || !machine.to('processing')) return;
  pendingAudio = null;
  updateTray();
  void handleAudio(audio);
}

async function handleAudio(audioBase64: string): Promise<void> {
  // Toque acidental no atalho: um webm de fração de segundo tem ~1-2 KB.
  // Não vale uma chamada paga à API pra transcrever silêncio.
  if (audioBase64.length < 4_000) {
    machine.reset();
    tellOnboarding('ob-dictation-failed', 'Gravação muito curta.');
    notify('VozzAI', 'Não ouvi nada — a gravação ficou curta demais. Tente de novo.');
    return;
  }

  let result = await transcribeViaBackend(config.authToken, audioBase64, config.language, config.mode);
  if (result.error && result.retryable) {
    // Uma nova tentativa resolve a maioria das falhas passageiras de rede.
    await new Promise((r) => setTimeout(r, 1_500));
    result = await transcribeViaBackend(config.authToken, audioBase64, config.language, config.mode);
  }

  if (result.error) {
    machine.reset();
    tellOnboarding('ob-dictation-failed', result.error);
    if (result.quotaExceeded) {
      notify('VozzAI — limite atingido', result.error, openSettings);
    } else if (result.retryable) {
      // O ditado não se perde: o áudio fica em memória até dar certo ou o app fechar.
      pendingAudio = audioBase64;
      notify(
        'VozzAI — sem conexão',
        'Seu ditado está guardado. Quando a internet voltar, use "Tentar transcrever de novo" no menu.',
      );
    } else {
      notify('VozzAI — erro', result.error);
    }
    updateTray();
    return;
  }

  const text = result.text || '';
  const raw = (result.raw || '').trim();
  machine.to('inserting');
  updateTray();

  lastTranscription = text;
  lastRaw = raw && raw !== text.trim() ? raw : null;
  // Devolve o foco pro app de destino antes de colar — ver captureFrontmostApp().
  if (dictationTargetApp) await activateApp(dictationTargetApp);
  const pasteResult = await pasteAtCursor(text);
  if (config.historyEnabled) {
    history.add(text, countWords(text), pasteResult === 'pasted', raw);
    historyWindow?.webContents.send('history-changed');
  }
  // O painel mostra o antes → depois no fim: é a única hora em que a pessoa
  // vê o que o VozzAI fez por ela — e a única chance de ela perceber, na
  // hora, se a limpeza mudou o sentido de alguma coisa.
  showOverlayDiff(lastRaw, text);
  if (pasteResult === 'clipboard-only') {
    // Sinal importante: a transcrição funcionou, mas o texto não entrou no
    // app de destino. É o tipo de falha que o usuário sente e não reporta.
    trackEvent(config.authToken, 'insertion_clipboard_only', { error_code: 'no_accessibility' });
    notify('VozzAI', 'Texto copiado — Cmd+V para colar. Libere a Acessibilidade para colar sozinho.');
  } else {
    trackEvent(config.authToken, 'insertion_ok');
  }
  tellOnboarding('ob-dictation-done', text);

  if (result.usage) warnAboutQuota(result.usage);
  machine.reset();
  updateTray();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function warnAboutQuota(usage: UsageStatus): void {
  const ratio = usage.limit > 0 ? usage.used / usage.limit : 0;
  let bucket = 0;
  QUOTA_THRESHOLDS.forEach((t, i) => {
    if (ratio >= t) bucket = i + 1;
  });

  // Período novo (uso caiu): libera os avisos de novo.
  if (bucket < lastWarnedBucket) lastWarnedBucket = bucket;
  if (bucket === 0 || bucket === lastWarnedBucket) return;
  lastWarnedBucket = bucket;

  const percent = Math.floor(ratio * 100);
  const janela = usage.period === 'week' ? 'da semana' : 'do mês';
  notify(
    'VozzAI — uso do plano',
    `Você já usou ${percent}% das palavras ${janela} (restam ${usage.remaining.toLocaleString('pt-BR')}). ` +
      'Dá para acompanhar e assinar o Pro nas Configurações.',
    openSettings,
  );
}

function copyLast(): void {
  if (!lastTranscription) return;
  clipboard.writeText(lastTranscription);
  notify('VozzAI', 'Última transcrição copiada.');
}

/**
 * Copia a transcrição crua. Existe para os casos em que o original é que
 * vale: citação literal, ata, "foi exatamente isso que ele disse".
 */
function copyLastRaw(): void {
  if (!lastRaw) return;
  clipboard.writeText(lastRaw);
  notify('VozzAI', 'Original copiado — sem nenhuma edição.');
}

function insertLastAgain(): void {
  const text = lastTranscription;
  if (!text) return;
  // Pequena pausa para o menu fechar e o app anterior recuperar o foco.
  setTimeout(() => void pasteAtCursor(text), 350);
}

/* ============ Esc global só enquanto grava ============ */

function syncEscapeShortcut(): void {
  if (machine.current === 'recording') {
    globalShortcut.register('Escape', cancelRecording);
  } else {
    globalShortcut.unregister('Escape');
  }
}

/* ============ Atalho principal ============ */

function registerShortcut(accelerator: string): boolean {
  try {
    return globalShortcut.register(accelerator, toggleRecording);
  } catch {
    return false;
  }
}

app.whenReady().then(() => {
  config = loadConfig();
  history = new HistoryStore(path.join(app.getPath('userData'), 'vozza-history.json'));

  createRecorderWindow();
  initOverlay(); // carrega o painel escondido: o 1º ditado não espera nada

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('VozzAI — ditado por voz');

  machine.onChange((state) => {
    syncEscapeShortcut();
    updateTray();
    syncOverlay(state); // painel flutuante: o retorno visual que a bandeja não dá
  });
  updateTray();

  if (!registerShortcut(config.shortcut)) {
    notify(
      'VozzAI — atalho em conflito',
      `Não consegui registrar ${prettyShortcut()} (outro app deve estar usando). Troque nas Configurações.`,
      openSettings,
    );
  }

  trackEvent(config.authToken, 'app_opened');
  if (!config.onboardingDone) {
    trackEvent(config.authToken, 'onboarding_started');
    openOnboarding();
  } else if (!config.authToken) openSettings();

  /* ---- IPC: conta e preferências ---- */

  ipcMain.handle('get-config', async () => {
    const base = {
      shortcut: config.shortcut,
      prettyShortcut: prettyShortcut(),
      historyEnabled: config.historyEnabled,
    };
    if (!config.authToken) return { ...base, loggedIn: false };
    const me = await fetchMe(config.authToken);
    return {
      ...base,
      loggedIn: true,
      email: config.userEmail,
      plan: me?.plan || 'free',
      tone: me?.tone || 'informal',
      dictionary: me?.dictionary || '',
      usage: me?.usage || null,
    };
  });

  ipcMain.handle('subscribe', async (_event, cycle: 'monthly' | 'annual' = 'monthly') => {
    const result = await createSubscription(config.authToken, cycle);
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

  ipcMain.handle('set-preferences', async (_event, partial: { tone?: string; dictionary?: string }) => {
    return updatePreferences(config.authToken, partial);
  });

  ipcMain.handle('set-shortcut', (_event, accelerator: string) => {
    if (typeof accelerator !== 'string' || !accelerator.trim()) {
      return { ok: false, error: 'Atalho vazio.' };
    }
    const previous = config.shortcut;
    globalShortcut.unregister(previous);
    if (!registerShortcut(accelerator)) {
      // Conflito ou combinação inválida: volta ao que funcionava.
      registerShortcut(previous);
      return { ok: false, error: 'Esse atalho não pôde ser registrado — outro app já deve usá-lo. Tente outra combinação.' };
    }
    config = saveConfig({ shortcut: accelerator });
    updateTray();
    return { ok: true, prettyShortcut: prettyShortcut() };
  });

  /* ---- IPC: histórico ---- */

  ipcMain.handle('history-list', () => ({
    enabled: config.historyEnabled,
    entries: history.list(),
  }));

  ipcMain.handle('history-copy', (_event, id: string) => {
    const entry = history.find(id);
    if (entry) clipboard.writeText(entry.text);
    return { ok: Boolean(entry) };
  });

  ipcMain.handle('history-insert', (_event, id: string) => {
    const entry = history.find(id);
    if (!entry) return { ok: false };
    // Esconde a janela para o app anterior voltar ao foco antes do Cmd+V.
    historyWindow?.hide();
    setTimeout(() => {
      void pasteAtCursor(entry.text).then(() => historyWindow?.show());
    }, 450);
    return { ok: true };
  });

  ipcMain.handle('history-delete', (_event, id: string) => {
    history.remove(id);
    return { ok: true };
  });

  ipcMain.handle('history-clear', () => {
    history.clear();
    return { ok: true };
  });

  ipcMain.handle('history-toggle', (_event, enabled: boolean) => {
    config = saveConfig({ historyEnabled: Boolean(enabled) });
    return { ok: true, enabled: config.historyEnabled };
  });

  /* ---- IPC: onboarding ---- */

  ipcMain.handle('ob-mic-status', () => systemPreferences.getMediaAccessStatus('microphone'));

  ipcMain.handle('ob-mic-request', async () => {
    // No macOS isso abre o pedido do sistema; a resposta vem quando o usuário decide.
    const granted = await systemPreferences.askForMediaAccess('microphone');
    trackEvent(config.authToken, granted ? 'mic_permission_granted' : 'mic_permission_denied');
    return granted;
  });

  ipcMain.handle('ob-accessibility-status', () => {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (trusted) trackEvent(config.authToken, 'accessibility_granted');
    return trusted;
  });

  ipcMain.handle('ob-accessibility-request', () =>
    // prompt: true faz o macOS abrir o painel pedindo a permissão.
    systemPreferences.isTrustedAccessibilityClient(true),
  );

  ipcMain.handle('ob-shortcut', () => prettyShortcut());

  ipcMain.handle('ob-finish', () => {
    config = saveConfig({ onboardingDone: true });
    trackEvent(config.authToken, 'onboarding_completed');
    onboardingWindow?.close();
    return { ok: true };
  });

  /* ---- IPC: gravador ---- */

  ipcMain.on('recording-error', (_event, message: string) => {
    console.log(`[vozza] erro na gravação: ${message}`);
    clearRecordingTimer();
    machine.reset();
    tellOnboarding('ob-dictation-failed', message);
    notify('VozzAI — erro ao gravar', message);
  });

  ipcMain.on('mic-level', (_event, level: number) => {
    setOverlayLevel(typeof level === 'number' ? level : 0);
  });

  ipcMain.on('audio-recorded', (_event, audioBase64: string) => {
    // A máquina já está em 'processing' (stopAndProcess) — aqui só processa.
    void handleAudio(audioBase64);
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyOverlay();
});
// Mantém o app vivo na barra de menu mesmo sem janelas abertas.
app.on('window-all-closed', () => {});
