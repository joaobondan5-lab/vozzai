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

async function startRecording(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e: BlobEvent) => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const buffer = await blob.arrayBuffer();
      (window as any).vozza.sendAudio(arrayBufferToBase64(buffer));
      stream.getTracks().forEach((t) => t.stop());
    };
    mediaRecorder.start();
  } catch (err) {
    (window as any).vozza.reportError(`Não consegui acessar o microfone: ${String(err)}`);
  }
}

function stopRecording(): void {
  mediaRecorder?.stop();
}

(window as any).vozza.onStart(startRecording);
(window as any).vozza.onStop(stopRecording);
