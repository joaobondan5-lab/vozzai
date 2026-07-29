/**
 * Documento offscreen: é aqui que a extensão consegue abrir o microfone.
 *
 * A sessão vive num objeto próprio (e não em variáveis soltas do módulo)
 * porque `getUserMedia` demora — de dezenas de ms a segundos. Nessa janela
 * chegavam dois `start` seguidos e o segundo sobrescrevia `activeStream`,
 * deixando o primeiro microfone ABERTO para sempre: o ponto vermelho de
 * gravação ficava na aba até o Chrome reiniciar.
 */
let session = null;
/** `stop` que chegou antes de o microfone abrir — ver start(). */
let pendingStop = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start-recording') void start();
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

function fail(message) {
  chrome.runtime.sendMessage({ target: 'background', type: 'audio-error', message });
}

async function start() {
  if (session) return; // já gravando: ignora pedido duplicado

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    fail(`Não consegui acessar o microfone: ${String(err)}`);
    return;
  }

  // Mandaram parar enquanto o microfone abria. Encerra o stream na hora —
  // sem isso ele ficaria aberto e ninguém teria referência pra fechá-lo.
  if (pendingStop) {
    pendingStop = false;
    stream.getTracks().forEach((t) => t.stop());
    fail('Ditado cancelado antes de começar.');
    return;
  }

  const active = { recorder: new MediaRecorder(stream), stream, chunks: [] };
  session = active;

  active.recorder.ondataavailable = (e) => active.chunks.push(e.data);
  active.recorder.onstop = async () => {
    // Fecha o microfone SEMPRE, mesmo se o envio falhar depois.
    active.stream.getTracks().forEach((t) => t.stop());
    if (session === active) session = null;
    try {
      const blob = new Blob(active.chunks, { type: 'audio/webm' });
      const buffer = await blob.arrayBuffer();
      chrome.runtime.sendMessage({
        target: 'background',
        type: 'audio-recorded',
        audioBase64: arrayBufferToBase64(buffer),
      });
    } catch (err) {
      fail(`Não consegui preparar o áudio: ${String(err)}`);
    }
  };

  active.recorder.start();
}

function stop() {
  if (!session) {
    pendingStop = true; // ver start()
    return;
  }
  // `stop()` num recorder já inativo lança InvalidStateError.
  if (session.recorder.state !== 'inactive') session.recorder.stop();
}
