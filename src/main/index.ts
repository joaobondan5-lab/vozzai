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
import { pasteAtCursor, captureFrontmostApp, activateApp, undoInsertion } from './paste';
import { DictationMachine } from './state';
import { HistoryStore } from './history';
import { CLIENT_MODES } from './modes';
import {
  initOverlay,
  syncOverlay,
  setOverlayLevel,
  setOverlayMode,
  showOverlayDiff,
  destroyOverlay,
} from './overlay';

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
/**
 * Inserção que ainda pode ser desfeita.
 *
 * Zera assim que é usada e a cada ditado novo: a contagem de caracteres só
 * vale enquanto ninguém digitou nada depois. Oferecer "desfazer" com contagem
 * velha apagaria texto que a pessoa escreveu — pior que não ter o recurso.
 */
let undoable: { chars: number; app: string | null } | null = null;
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

/** Nome legível do modo em vigor — cai no id se for um modo que o cliente não conhece. */
function currentModeName(): string {
  return CLIENT_MODES.find((m) => m.id === config.mode)?.name || config.mode;
}

/**
 * Ponto único de troca de modo.
 *
 * A bandeja e a tela de Configurações mexem na MESMA preferência. Quando cada
 * uma salvava por conta própria, a outra continuava exibindo o valor velho até
 * ser reaberta — e quem trocasse pela janela via a bandeja discordar dela.
 * Tudo que precisa saber da troca é notificado aqui, em vez de em cada
 * chamador.
 */
function applyMode(id: string): void {
  if (!CLIENT_MODES.some((m) => m.id === id)) return;
  config = saveConfig({ mode: id });
  trackEvent(config.authToken, 'mode_changed', { mode: id });
  updateTray();
  setOverlayMode(currentModeName());
  // A janela pode nem estar aberta: o `?.` cobre isso sem exigir checagem.
  settingsWindow?.webContents.send('mode-changed', id);
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
        click: () => applyMode(m.id),
      })),
    },
    { type: 'separator' },
    {
      label: undoable ? `Desfazer inserção (${undoable.chars} caracteres)` : 'Desfazer inserção',
      enabled: Boolean(undoable),
      click: undoLastInsertion,
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
    // Ditado novo invalida o desfazer anterior: a contagem de caracteres só
    // vale enquanto nada mais foi escrito depois dela.
    undoable = null;
    // Capturado ANTES de iniciar porque é aqui que o app de destino ainda é,
    // com certeza, o que a pessoa estava usando. O painel em si não tira mais
    // o foco de ninguém (ver overlay.ts), mas quem recebe o Cmd+V no fim
    // continua sendo este app — e entre o início e o fim do ditado ela pode
    // ter clicado em outro lugar.
    dictationTargetApp = await captureFrontmostApp();
    capturingTarget = false;
    if (machine.current !== 'idle') return; // mudou de estado enquanto capturava (ex.: cancelado)

    if (!machine.to('recording')) return;
    // Antes de gravar: o painel já sobe dizendo com que modo vai escrever,
    // enquanto ainda dá tempo de cancelar no esc.
    setOverlayMode(currentModeName());
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
  // O destino guardado é de quando o ditado começou — muitas vezes há
  // bastante tempo, já que o retry é manual. Trazer o Chrome de volta pra
  // frente porque a pessoa ditou lá vinte minutos atrás, enquanto ela agora
  // escreve no Notion, é pior do que não fazer nada: cola no lugar errado.
  // Sem destino, o texto vai pra onde o cursor estiver agora.
  dictationTargetApp = null;
  updateTray();
  void handleAudio(audio);
}

/**
 * Envelope de segurança do ditado.
 *
 * Tudo aqui dentro pode falhar (rede, disco, permissão, resposta estranha do
 * servidor), e uma exceção que escape deixa a máquina presa em "processing"
 * PARA SEMPRE — com o painel congelado por cima de tudo, sem poder fechar
 * (ele é alwaysOnTop e atravessa clique), atalho morto e o ditado perdido.
 * A única saída seria sair pela bandeja e reabrir.
 *
 * Por isso o `finally`: aconteça o que acontecer, a máquina volta ao repouso.
 */
async function handleAudio(audioBase64: string): Promise<void> {
  try {
    await runDictation(audioBase64);
  } catch (err) {
    console.error('[vozza] falha inesperada ao processar o ditado:', err);
    // O áudio não se perde: fica guardado pro "Tentar transcrever de novo".
    pendingAudio = audioBase64;
    tellOnboarding('ob-dictation-failed', 'Erro inesperado.');
    notify(
      'VozzAI — algo deu errado',
      'Seu ditado está guardado. Use "Tentar transcrever de novo" no menu 🎙️.',
    );
  } finally {
    machine.reset();
    updateTray();
  }
}

async function runDictation(audioBase64: string): Promise<void> {
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

  // Só é desfazível o que de fato entrou no app de destino. Se o texto ficou
  // na área de transferência, não há nada inserido para apagar — e oferecer
  // "desfazer" nesse caso apagaria o que a pessoa tinha escrito antes.
  undoable = pasteResult === 'pasted' ? { chars: text.length, app: dictationTargetApp } : null;

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

async function undoLastInsertion(): Promise<void> {
  const pending = undoable;
  if (!pending) return;
  undoable = null; // uma vez só: depois disso a contagem não vale mais
  updateTray();

  const ok = await undoInsertion(pending.chars, pending.app);
  trackEvent(config.authToken, ok ? 'undo_ok' : 'undo_failed');
  notify(
    'VozzAI',
    ok
      ? 'Inserção desfeita. O texto continua em "Copiar última transcrição".'
      : 'Não consegui desfazer daqui. Use Cmd+Z no aplicativo.',
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
      // O modo é preferência LOCAL (fica no config.json), diferente de tom e
      // dicionário, que moram no servidor. Vai no `base` de propósito: quem
      // ainda não conectou a conta também escolhe modo.
      mode: config.mode,
      modes: CLIENT_MODES,
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

  // Separado do set-preferences porque o destino é outro: modo é local e vale
  // na hora; tom e dicionário vão para o servidor e podem falhar por rede.
  // Juntar os dois faria a troca de modo depender de uma chamada HTTP.
  ipcMain.handle('set-mode', (_event, id: string) => {
    if (!CLIENT_MODES.some((m) => m.id === id)) return { ok: false, error: 'Modo desconhecido.' };
    applyMode(id);
    return { ok: true, mode: id, name: currentModeName() };
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

  // A pessoa apertou o atalho de novo enquanto o microfone ainda abria.
  // Não é erro nem ditado: só volta ao repouso, em silêncio.
  ipcMain.on('recording-aborted', () => {
    clearRecordingTimer();
    machine.reset();
    updateTray();
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
