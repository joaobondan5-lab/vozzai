let mediaRecorder = null;
let chunks = [];
let activeStream = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start-recording') start();
  if (msg.type === 'stop-recording') stop();
});

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

async function start() {
  try {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'audio-error',
      message: `Não consegui acessar o microfone: ${String(err)}`,
    });
    return;
  }

  chunks = [];
  mediaRecorder = new MediaRecorder(activeStream);
  mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
  mediaRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const buffer = await blob.arrayBuffer();
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'audio-recorded',
      audioBase64: arrayBufferToBase64(buffer),
    });
    activeStream.getTracks().forEach((t) => t.stop());
  };
  mediaRecorder.start();
}

function stop() {
  mediaRecorder?.stop();
}
