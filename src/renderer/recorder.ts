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

async function startRecording(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    cancelled = false;
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e: BlobEvent) => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled) return;
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const buffer = await blob.arrayBuffer();
      (window as any).vozza.sendAudio(arrayBufferToBase64(buffer));
    };
    mediaRecorder.start();
  } catch (err) {
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
