const API_BASE = 'https://vozzai-production.up.railway.app';

let recording = false;
// Aba em que o ditado começou — capturada com activeTab no momento do
// atalho, pra inserir o texto sempre no lugar certo mesmo se o usuário
// trocar de aba enquanto fala.
let dictationTabId = null;

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-dictation') return;
  if (recording) {
    stopRecording();
  } else {
    startRecording();
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
  // Usa o gesto do atalho (activeTab) pra injetar o content script só na
  // aba ativa, em vez de pedir acesso permanente a todos os sites.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  dictationTabId = tab?.id ?? null;
  if (dictationTabId) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: dictationTabId }, files: ['content.js'] });
    } catch {
      // Páginas internas do navegador (chrome://, Web Store) não aceitam injeção.
    }
  }

  await ensureOffscreen();
  recording = true;
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'start-recording' });
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
    notifyActiveTab(msg.message);
  }
  return false;
});

async function handleAudio(audioBase64) {
  const { vozzaToken } = await chrome.storage.local.get('vozzaToken');
  if (!vozzaToken) {
    notifyActiveTab('Faça login na extensão do Vozza primeiro (clique no ícone).');
    return;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${vozzaToken}` },
      body: JSON.stringify({ audio: audioBase64, language: 'pt' }),
    });
  } catch {
    notifyActiveTab('Não consegui falar com o servidor do Vozza.');
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    notifyActiveTab(data.error || 'Erro ao transcrever.');
    return;
  }

  insertIntoActiveTab(data.text);
}

function insertIntoActiveTab(text) {
  if (!dictationTabId) return;
  chrome.tabs.sendMessage(dictationTabId, { type: 'vozza-insert-text', text });
}

function notifyActiveTab(message) {
  if (!dictationTabId) return;
  chrome.tabs.sendMessage(dictationTabId, { type: 'vozza-toast', text: message });
}
