function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

let mediaRecorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
// Cancelar (Esc) para o gravador do mesmo jeito, mas descarta o áudio em vez
// de enviar — sem isso, todo "deixa pra lá" viraria uma transcrição cobrada.
let cancelled = false;

/* ---- Medidor de volume ----
 * Alimenta as barras do painel flutuante. O ponto não é decorar: é provar que
 * o microfone está captando ESTA pessoa. Um indicador que só diz "gravando"
 * mente quando o microfone está mudo, no dispositivo errado ou sem permissão —
 * e o usuário só descobre depois de falar um minuto à toa.
 *
 * Vive aqui porque é aqui que o MediaStream existe. Só sai daqui um número
 * de 0 a 1; áudio nenhum atravessa o IPC.
 */
let audioContext: AudioContext | null = null;
let levelTimer: number | null = null;

function startLevelMeter(stream: MediaStream): void {
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser); // sem connect ao destination: não devolve o som pro alto-falante
  const buffer = new Uint8Array(analyser.frequencyBinCount);

  levelTimer = window.setInterval(() => {
    analyser.getByteTimeDomainData(buffer);
    // RMS em torno de 128 (o silêncio no domínio do tempo em 8 bits).
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = (buffer[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buffer.length);
    (window as any).vozza.sendLevel(Math.min(rms * 3.2, 1)); // ×3.2: fala normal enche a barra sem gritar
  }, 60); // ~16 fps: suave ao olho, irrelevante pra CPU
}

function stopLevelMeter(): void {
  if (levelTimer !== null) {
    clearInterval(levelTimer);
    levelTimer = null;
  }
  void audioContext?.close();
  audioContext = null;
}

async function startRecording(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    cancelled = false;
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e: BlobEvent) => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stopLevelMeter();
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled) return;
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const buffer = await blob.arrayBuffer();
      (window as any).vozza.sendAudio(arrayBufferToBase64(buffer));
    };
    mediaRecorder.start();
    startLevelMeter(stream);
  } catch (err) {
    stopLevelMeter();
    (window as any).vozza.reportError(`Não consegui acessar o microfone: ${String(err)}`);
  }
}

function stopRecording(): void {
  mediaRecorder?.stop();
}

function cancelRecording(): void {
  cancelled = true;
  mediaRecorder?.stop();
}

(window as any).vozza.onStart(startRecording);
(window as any).vozza.onStop(stopRecording);
(window as any).vozza.onCancel(cancelRecording);
