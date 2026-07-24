export async function transcribeAudio(audioBase64: string, apiKey: string, language = 'pt'): Promise<string> {
  if (!apiKey) throw new Error('Chave da OpenAI não configurada. Abra Configurações e cole sua chave.');

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('language', language);

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
