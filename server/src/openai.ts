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

/**
 * Tom = registro (escolha de palavras), nunca formato.
 *
 * A distinção importa porque o tom agora acompanha QUALQUER modo, e o modo é
 * quem manda no formato. Se o texto de tom disser algo sobre tamanho, estrutura
 * ou saudação, ele briga com o modo — foi assim que a versão anterior, escrita
 * pensando só no Padrão, ficou presa a ele.
 */
const TONE_INSTRUCTIONS: Record<string, string> = {
  informal:
    'REGISTRO INFORMAL: preserve o vocabulário do dia a dia e o jeito de falar da pessoa. ' +
    'Não troque palavras simples por palavras rebuscadas nem engesse o texto.',
  formal:
    'REGISTRO FORMAL: troque gírias e expressões muito casuais ("cara", "tipo", "beleza?", "e aí", ' +
    '"pra", "tá") por equivalentes neutros, e prefira "você" a "tu"/"cê". Isso muda apenas a escolha ' +
    'das palavras — o formato continua sendo o que foi pedido acima, com o mesmo conteúdo e sem ' +
    'ficar mais longo.',
};

/**
 * Junta a preferência da pessoa com a regra do modo. Ver `Mode.toneRule`:
 * a maioria respeita a escolha, Fiel ignora, Jurídico é sempre formal.
 */
function toneInstructionFor(mode: Mode, tone: string): string {
  if (mode.toneRule === 'none') return '';
  const key = mode.toneRule === 'always-formal' ? 'formal' : tone;
  return ` ${TONE_INSTRUCTIONS[key] ?? TONE_INSTRUCTIONS.informal}`;
}

export async function cleanup(rawText: string, tone = 'informal', mode?: Mode): Promise<string> {
  if (!rawText.trim()) return rawText;

  const active = mode ?? MODES[DEFAULT_MODE_ID];
  const base = active.instruction;
  const toneInstruction = toneInstructionFor(active, tone);

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
