/**
 * Chamadas à OpenAI feitas SEMPRE aqui no servidor. A chave nunca sai daqui —
 * é isso que permite cobrar assinatura em vez de pedir que cada usuário traga
 * a própria chave.
 */
const KEY = () => process.env.OPENAI_API_KEY || '';

export interface Transcription {
  text: string;
  seconds: number;
}

export async function transcribe(audio: Buffer, language = 'pt'): Promise<Transcription> {
  if (!KEY()) throw new Error('OPENAI_API_KEY não configurada no servidor.');

  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/webm' }), 'audio.webm');
  form.append('model', process.env.VOZZA_STT_MODEL || 'whisper-1');
  form.append('language', language);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Falha na transcrição (${res.status}): ${await res.text()}`);

  const data = (await res.json()) as { text: string; usage?: { seconds?: number } };
  return { text: data.text, seconds: data.usage?.seconds ?? 0 };
}

export async function cleanup(rawText: string): Promise<string> {
  if (!rawText.trim()) return rawText;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content:
            'Corrija pontuação, maiúsculas e formatação do texto ditado abaixo, mantendo o sentido e o idioma originais. Responda apenas com o texto corrigido, sem comentários.\n\n' +
            rawText,
        },
      ],
    }),
  });

  if (!res.ok) return rawText;
  const data = (await res.json()) as { choices?: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content ?? rawText;
}
