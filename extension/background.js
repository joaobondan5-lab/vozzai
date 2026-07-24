// TODO: trocar para o domínio de produção do servidor quando publicar
const API_BASE = 'http://localhost:3000';

let recording = false;

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

async function insertIntoActiveTab(text) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'vozza-insert-text', text });
}

async function notifyActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'vozza-toast', text: message });
}
