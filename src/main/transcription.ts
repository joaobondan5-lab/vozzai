export async function transcribeAudio(audioBase64: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada. Edite o arquivo .env.');

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Falha na transcrição (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}
