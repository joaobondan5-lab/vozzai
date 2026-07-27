/**
 * Chamadas à OpenAI feitas SEMPRE aqui no servidor. A chave nunca sai daqui —
 * é isso que permite cobrar assinatura em vez de pedir que cada usuário traga
 * a própria chave.
 */
import { DEFAULT_MODE_ID, Mode, MODES, UNIVERSAL_RULES } from './modes';

const KEY = () => process.env.OPENAI_API_KEY || '';

export interface Transcription {
  text: string;
  seconds: number;
}

export async function transcribe(
  audio: Buffer,
  language = 'pt',
  dictionary = '',
): Promise<Transcription> {
  if (!KEY()) throw new Error('OPENAI_API_KEY não configurada no servidor.');

  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/webm' }), 'audio.webm');
  form.append('model', process.env.VOZZA_STT_MODEL || 'whisper-1');
  form.append('language', language);
  // O Whisper aceita um "prompt" curto como dica de vocabulário — é assim que
  // o dicionário pessoal ajuda a acertar nomes e termos específicos, sem
  // precisar treinar nenhum modelo. Só os ~200 primeiros caracteres importam.
  if (dictionary.trim()) form.append('prompt', dictionary.slice(0, 800));

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Falha na transcrição (${res.status}): ${await res.text()}`);

  const data = (await res.json()) as { text: string; usage?: { seconds?: number } };
  return { text: data.text, seconds: data.usage?.seconds ?? 0 };
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  informal: 'Mantenha um tom natural e conversacional, como a pessoa realmente falou.',
  formal:
    'Troque só as gírias e expressões muito casuais ("cara", "tipo", "beleza?", "e aí") por palavras mais neutras, mantendo exatamente as mesmas frases, na mesma ordem, sem tirar nem adicionar conteúdo. Isto NÃO é uma carta nem um e-mail: é proibido escrever "Prezado", "Atenciosamente", qualquer saudação, despedida ou placeholder como "[Nome]". A saída deve ter o mesmo tamanho do texto original, só com palavras mais formais.',
};

export async function cleanup(rawText: string, tone = 'informal', mode?: Mode): Promise<string> {
  if (!rawText.trim()) return rawText;

  const base = mode?.instruction ?? MODES[DEFAULT_MODE_ID].instruction;
  // A preferência de tom só entra no modo Padrão — os outros modos já
  // definem o próprio tom (WhatsApp informal, Jurídico formal, etc.).
  const toneInstruction =
    !mode || mode.id === DEFAULT_MODE_ID
      ? ` ${TONE_INSTRUCTIONS[tone] ?? TONE_INSTRUCTIONS.informal}`
      : '';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content:
            `${base}${toneInstruction}${UNIVERSAL_RULES} Responda apenas com o texto final, sem comentários.\n\n` +
            rawText,
        },
      ],
    }),
  });

  if (!res.ok) return rawText;
  const data = (await res.json()) as { choices?: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content ?? rawText;
}
