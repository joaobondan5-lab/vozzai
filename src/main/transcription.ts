export async function transcribeAudio(audioBase64: string): Promise<string> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY não configurada. Edite o arquivo .env.');

  const audioBuffer = Buffer.from(audioBase64, 'base64');

  const response = await fetch(
    'https://api.deepgram.com/v1/listen?model=nova-3&language=pt&smart_format=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'audio/webm',
      },
      body: audioBuffer,
    },
  );

  if (!response.ok) {
    throw new Error(`Falha na transcrição (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as {
    results: { channels: { alternatives: { transcript: string }[] }[] };
  };
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
}
