const API_BASE = 'https://vozzai-production.up.railway.app';

/**
 * Evento de funil. Fire-and-forget: telemetria não pode atrasar o ditado nem
 * quebrar nada. Só nome do passo e metadados fechados — nunca o texto ditado.
 */
async function trackEvent(name, props) {
  try {
    const { vozzaToken } = await chrome.storage.local.get('vozzaToken');
    const headers = { 'content-type': 'application/json' };
    if (vozzaToken) headers.Authorization = `Bearer ${vozzaToken}`;
    await fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, platform: 'extension', props }),
    });
  } catch {
    /* best-effort */
  }
}

let recording = false;
/**
 * Trava do atalho enquanto a gravação está NASCENDO.
 *
 * `recording` só virava true no fim de `startRecording()`, depois de três
 * awaits (consultar a aba, injetar o script, criar o offscreen). Dois
 * disparos do atalho dentro dessa janela — que é justamente quando a pessoa
 * acha que não funcionou e aperta de novo — rodavam `startRecording()` duas
 * vezes em paralelo: dois `createDocument`, com o segundo estourando
 * "Only a single offscreen document may be created", e dois microfones
 * abertos, sendo que só um era fechado depois.
 */
let starting = false;
// Aba em que o ditado começou — capturada com activeTab no momento do
// atalho, pra inserir o texto sempre no lugar certo mesmo se o usuário
// trocar de aba enquanto fala.
let dictationTabId = null;
/**
 * A aba do ditado aceita mensagens? Páginas internas (chrome://, Web Store,
 * visualizador de PDF) não deixam injetar o content script — e como é ele
 * que insere o texto E mostra os avisos, sem ele o ditado sumia calado:
 * a pessoa falava, a cota era cobrada e nada aparecia. Ver deliver().
 */
let canReachTab = false;

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-dictation') return;
  if (recording) {
    stopRecording();
  } else if (!starting) {
    startRecording().catch((err) => {
      starting = false;
      recording = false;
      console.error('[vozza]', err);
      notifyActiveTab('Não consegui iniciar o ditado. Tente de novo.');
    });
  }
});

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Gravar áudio do microfone para ditado por voz',
  });
}

async function startRecording() {
  starting = true;
  try {
    // Usa o gesto do atalho (activeTab) pra injetar o content script só na
    // aba ativa, em vez de pedir acesso permanente a todos os sites.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    dictationTabId = tab?.id ?? null;
    canReachTab = false;
    if (dictationTabId) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: dictationTabId }, files: ['content.js'] });
        canReachTab = true;
      } catch {
        // Páginas internas do navegador (chrome://, Web Store, visualizador
        // de PDF) não aceitam injeção. Sem o content script não há como
        // inserir NEM avisar nada nessa aba — ver deliver().
      }
    }

    await ensureOffscreen();
    const { vozzaMode } = await chrome.storage.local.get('vozzaMode');
    void trackEvent('dictation_started', { mode: vozzaMode || 'padrao' });
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'start-recording' });
    recording = true;
  } finally {
    starting = false;
  }
}

function stopRecording() {
  recording = false;
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop-recording' });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'background') return false;
  if (msg.type === 'audio-recorded') {
    handleAudio(msg.audioBase64).catch((err) => console.error('[vozza]', err));
  }
  if (msg.type === 'audio-error') {
    recording = false;
    starting = false;
    notifyActiveTab(msg.message);
  }
  return false;
});

async function handleAudio(audioBase64) {
  const { vozzaToken, vozzaMode } = await chrome.storage.local.get(['vozzaToken', 'vozzaMode']);
  if (!vozzaToken) {
    deliver(null, 'Faça login na extensão do VozzAI primeiro (clique no ícone).');
    return;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${vozzaToken}` },
      body: JSON.stringify({ audio: audioBase64, language: 'pt', mode: vozzaMode || 'padrao' }),
    });
  } catch {
    deliver(null, 'Não consegui falar com o servidor do VozzAI.');
    return;
  }

  // Nem toda resposta é JSON: quando o servidor está reiniciando, o Railway
  // devolve HTML. Sem esta proteção o res.json() lançava, a rejeição morria
  // no console e a pessoa não recebia nem o texto nem um aviso.
  let data;
  try {
    data = await res.json();
  } catch {
    deliver(null, 'O servidor respondeu de um jeito inesperado. Tente de novo.');
    return;
  }

  if (!res.ok) {
    deliver(null, data.error || 'Erro ao transcrever.');
    return;
  }

  deliver(data.text, null);
}

/**
 * Entrega o resultado do ditado — texto ou aviso de erro.
 *
 * Quando a aba não aceita content script, não há como inserir nem avisar
 * nela. Em vez de perder um texto que a pessoa já pagou, guarda no
 * armazenamento da extensão e marca o ícone: ela abre o popup e copia de lá.
 */
function deliver(text, errorMessage) {
  if (canReachTab && dictationTabId) {
    if (text) {
      void trackEvent('insertion_ok');
      chrome.tabs.sendMessage(dictationTabId, { type: 'vozza-insert-text', text }).catch(() => {
        stashForPopup(text);
      });
    } else {
      chrome.tabs.sendMessage(dictationTabId, { type: 'vozza-toast', text: errorMessage }).catch(() => {});
    }
    return;
  }

  if (text) {
    void trackEvent('insertion_clipboard_only', { error_code: 'no_content_script' });
    stashForPopup(text);
  }
}

/** Guarda o texto pro popup e acende o ícone, pra ele não se perder. */
function stashForPopup(text) {
  void chrome.storage.local.set({ vozzaPendingText: text });
  void chrome.action.setBadgeText({ text: '1' });
  void chrome.action.setBadgeBackgroundColor({ color: '#7089FF' });
}

function notifyActiveTab(message) {
  if (!dictationTabId || !canReachTab) return;
  // .catch: a aba pode ter sido fechada ou navegada durante o ditado.
  chrome.tabs.sendMessage(dictationTabId, { type: 'vozza-toast', text: message }).catch(() => {});
}
