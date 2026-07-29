function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

/**
 * Uma gravação em curso. O `cancelled` mora AQUI e não no módulo por um
 * motivo concreto: com um flag compartilhado, começar um ditado novo zerava
 * a marca do ditado anterior, e o `onstop` atrasado do que foi cancelado
 * acabava enviando o áudio assim mesmo — texto que a pessoa mandou descartar
 * aparecia colado no documento dela.
 */
interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  cancelled: boolean;
}

let session: Session | null = null;
let chunks: Blob[] = [];

/**
 * Pedido de parar/cancelar que chegou enquanto o microfone ainda abria.
 *
 * `getUserMedia` leva de 20 ms a vários SEGUNDOS (na primeira vez o macOS
 * mostra o pedido de permissão) — e é exatamente nessa janela que a pessoa
 * aperta o atalho de novo achando que não funcionou. Antes disso o `stop`
 * caía no vazio e a gravação nascia logo depois, sem ninguém pra pará-la:
 * microfone ligado indefinidamente e o app travado em "transcrevendo".
 */
let pendingStop: 'stop' | 'cancel' | null = null;

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
  if (session) return; // já há gravação em curso — ignora pedido duplicado
  pendingStop = null;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    stopLevelMeter();
    (window as any).vozza.reportError(`Não consegui acessar o microfone: ${String(err)}`);
    return;
  }

  // Mandaram parar enquanto o microfone abria: desiste sem gravar nada e
  // avisa o processo principal — senão ele fica esperando pra sempre um
  // áudio que nunca vai chegar.
  if (pendingStop) {
    pendingStop = null;
    stream.getTracks().forEach((t) => t.stop());
    (window as any).vozza.abortRecording();
    return;
  }

  const active: Session = {
    recorder: new MediaRecorder(stream),
    stream,
    cancelled: false,
  };
  session = active;
  chunks = [];

  active.recorder.ondataavailable = (e: BlobEvent) => chunks.push(e.data);
  active.recorder.onstop = async () => {
    stopLevelMeter();
    active.stream.getTracks().forEach((t) => t.stop());
    if (session === active) session = null;
    if (active.cancelled) return; // Esc: descarta em vez de transcrever (e cobrar)
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const buffer = await blob.arrayBuffer();
    (window as any).vozza.sendAudio(arrayBufferToBase64(buffer));
  };

  active.recorder.start();
  startLevelMeter(stream);
}

/** Encerra a gravação. Se ela ainda não nasceu, deixa o pedido marcado. */
function finishRecording(kind: 'stop' | 'cancel'): void {
  if (!session) {
    pendingStop = kind; // ver startRecording()
    return;
  }
  if (kind === 'cancel') session.cancelled = true;
  // `stop()` num recorder já inativo lança InvalidStateError.
  if (session.recorder.state !== 'inactive') session.recorder.stop();
}

const stopRecording = () => finishRecording('stop');
const cancelRecording = () => finishRecording('cancel');

(window as any).vozza.onStart(startRecording);
(window as any).vozza.onStop(stopRecording);
(window as any).vozza.onCancel(cancelRecording);
