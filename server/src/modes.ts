import { PlanName } from './quota';

/**
 * VozzAI Modes — como o texto ditado é preparado, por contexto de uso.
 *
 * O registro vive no servidor por dois motivos: a instrução nunca chega ao
 * cliente (é ativo do produto) e a disponibilidade por plano é validada aqui,
 * não na interface — cliente nenhum consegue "se dar" um modo Pro.
 */
export interface Mode {
  id: string;
  name: string;
  /** Uma linha para a UI dos clientes. */
  description: string;
  /** Instrução que o modelo de limpeza recebe. Não expor em rotas públicas. */
  instruction: string;
  /** Exemplo curto de saída, para UI futura. */
  example: string;
  /** Sugestão de apps onde o modo brilha (associação automática é futura). */
  apps: string[];
  proOnly: boolean;
  schemaVersion: 1;
}

const V = { schemaVersion: 1 as const };

/**
 * Regra que vale para TODOS os modos, anexada à instrução de cada um.
 *
 * Existe porque um teste com áudio real mostrou o modo E-mail devolvendo
 * "[Seu Nome] / [Seu Cargo] / [Seu Contato]" e o WhatsApp inventando "Oi, tudo
 * bem?" e "Valeu!" — coisas que a pessoa não falou. Ditado que volta com
 * lacuna para preencher é pior que inútil: quebra justamente a promessa de
 * "texto pronto para enviar". Como é um risco de todo modo novo, a proteção
 * mora aqui e não na instrução individual, que alguém esqueceria de repetir.
 */
export const UNIVERSAL_RULES =
  ' REGRAS ABSOLUTAS, acima de qualquer instrução de formato: ' +
  '(1) É PROIBIDO usar placeholder, colchete ou lacuna para preencher — nada de ' +
  '"[Seu Nome]", "[Nome]", "[Cargo]", "[Contato]", "[assunto]" ou similar. ' +
  '(2) Não invente saudação, despedida, assinatura, elogio nem cortesia que a pessoa não falou ' +
  '(ex.: "Oi, tudo bem?", "Espero que esteja bem", "Atenciosamente", "Valeu!"). ' +
  '(3) Não invente fato, nome, número, data, prazo ou promessa que não estava no ditado. ' +
  '(4) Se o ditado não tem destinatário ou remetente, o texto final também não tem — ' +
  'escreva só o conteúdo, sem moldura. ' +
  'Prefira devolver um texto mais curto e fiel a um texto completo e inventado.';

export const MODES: Record<string, Mode> = {
  padrao: {
    ...V,
    id: 'padrao',
    name: 'Padrão',
    description: 'Texto limpo e pontuado, fiel ao seu jeito de falar.',
    instruction:
      'Corrija pontuação, maiúsculas e formatação do texto ditado, removendo hesitações e vícios de fala ' +
      '(repetições, "é…", "tipo") sem mudar o sentido nem o idioma originais.',
    example: 'Oi, Paulo! Podemos marcar a reunião amanhã às 15h?',
    apps: [],
    proOnly: false,
  },
  whatsapp: {
    ...V,
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Mensagem natural e curta, com a sua personalidade.',
    instruction:
      'Transforme o ditado em mensagem de WhatsApp natural: frases curtas, parágrafos de uma ou duas linhas, ' +
      'o jeito de falar da própria pessoa preservado. Não adicione formalidade artificial nem emojis que a ' +
      'pessoa não ditou. Comece direto pelo conteúdo — só cumprimente se ela tiver cumprimentado.',
    example: 'Oi! Vi o orçamento e podemos seguir. Me manda a versão final hoje?',
    apps: ['WhatsApp'],
    proOnly: false,
  },
  email: {
    ...V,
    id: 'email',
    name: 'E-mail profissional',
    description: 'Corpo de e-mail organizado, no tom profissional.',
    instruction:
      'Organize o ditado como o CORPO de um e-mail profissional: parágrafos claros, tom cordial e direto. ' +
      'Só escreva saudação se a pessoa tiver falado o nome de quem recebe, e só escreva despedida se ela ' +
      'tiver ditado uma. Nunca acrescente assinatura, cargo ou contato — quem envia já tem isso no cliente ' +
      'de e-mail. O resultado deve ser colável direto no campo de mensagem, sem nada para preencher.',
    example: 'Bom dia, Carlos. Confirmando nossa reunião de amanhã às 10h. Abraço,',
    apps: ['Gmail', 'Outlook'],
    proOnly: false,
  },
  objetivo: {
    ...V,
    id: 'objetivo',
    name: 'Objetivo',
    description: 'Sem redundância: frases curtas, só os fatos.',
    instruction:
      'Reescreva o ditado da forma mais direta possível: remova redundâncias, use frases curtas e mantenha todos ' +
      'os fatos citados. Não adicione nenhuma informação nova.',
    example: 'Objetivo: reduzir o tempo de carregamento e eliminar a duplicação no front-end.',
    apps: ['Slack', 'Linear'],
    proOnly: false,
  },
  fiel: {
    ...V,
    id: 'fiel',
    name: 'Transcrição fiel',
    description: 'Só pontuação e maiúsculas — nenhuma palavra alterada.',
    instruction:
      'Apenas pontue e capitalize o texto ditado. Não remova, não adicione, não reordene e não substitua nenhuma ' +
      'palavra — fidelidade máxima ao que foi falado, na ordem em que foi falado.',
    example: 'Então, assim, ó: preciso mandar o relatório pro cliente ainda hoje, sem falta.',
    apps: [],
    proOnly: false,
  },
  atendimento: {
    ...V,
    id: 'atendimento',
    name: 'Atendimento',
    description: 'Resposta cordial ao cliente, com próximos passos claros.',
    instruction:
      'Formate o ditado como resposta de atendimento ao cliente: cordial, clara e com os próximos passos quando ' +
      'houver. Preserve exatamente nomes, valores, prazos e números citados. Não prometa nada que não foi dito.',
    example: 'Oi, Ana! Já verifiquei seu pedido: ele sai amanhã. Qualquer coisa, me chama por aqui.',
    apps: ['WhatsApp', 'Gmail'],
    proOnly: true,
  },
  vendas: {
    ...V,
    id: 'vendas',
    name: 'Vendas',
    description: 'Mensagem comercial clara, com benefício e chamada para ação.',
    instruction:
      'Formate o ditado como mensagem comercial: clara, focada no benefício para o cliente, com chamada para ação ' +
      'quando fizer sentido. Não invente promessas, números, descontos nem condições que não foram ditas.',
    example: 'Com o plano anual você economiza duas mensalidades. Quer que eu envie a proposta hoje?',
    apps: ['WhatsApp', 'Gmail'],
    proOnly: true,
  },
  juridico: {
    ...V,
    id: 'juridico',
    name: 'Jurídico',
    description: 'Linguagem formal com máxima preservação de termos, números e datas.',
    instruction:
      'Formate o ditado em linguagem formal jurídica, preservando com máxima fidelidade termos técnicos, números, ' +
      'datas, valores e nomes citados. Não parafraseie termos jurídicos e não crie conteúdo novo. ' +
      'Seja conservador: em caso de dúvida, mantenha o texto como foi ditado.',
    example: 'Requer-se a juntada do comprovante de pagamento, nos termos do art. 434 do CPC.',
    apps: ['Word'],
    proOnly: true,
  },
  dev: {
    ...V,
    id: 'dev',
    name: 'Desenvolvedor',
    description: 'Preserva termos em inglês, camelCase, caminhos e comandos.',
    instruction:
      'O ditado mistura português com termos técnicos de programação. Preserve termos em inglês, nomes de ' +
      'bibliotecas, identificadores em camelCase e PascalCase, caminhos de arquivo e comandos exatamente como ' +
      'ditados — não os traduza nem os "corrija" para português. Formate como texto técnico claro.',
    example: 'Refatorei o useAuth pra ler o token do localStorage só uma vez, no mount.',
    apps: ['VS Code', 'Claude Code', 'Slack'],
    proOnly: true,
  },
  conteudo: {
    ...V,
    id: 'conteudo',
    name: 'Conteúdo',
    description: 'Legendas, roteiros e tópicos mantendo a sua voz.',
    instruction:
      'Organize o ditado como conteúdo pronto para publicar — legenda, roteiro ou tópicos, conforme o que foi ' +
      'ditado — mantendo a voz e a personalidade de quem falou. Não invente fatos, números nem estatísticas.',
    example: 'Três erros que eu cometi ao abrir minha primeira empresa (o segundo custou caro):',
    apps: ['Instagram', 'Notion'],
    proOnly: true,
  },
};

export const DEFAULT_MODE_ID = 'padrao';

export type ModeResolution =
  | { ok: true; mode: Mode }
  | { ok: false; status: 400 | 403; error: string };

/** Valida o modo pedido contra o plano — a única porta de entrada para usar um modo. */
export function resolveMode(requested: unknown, plan: PlanName): ModeResolution {
  const id = typeof requested === 'string' && requested.trim() ? requested.trim() : DEFAULT_MODE_ID;
  const mode = MODES[id];
  if (!mode) {
    return { ok: false, status: 400, error: `Modo de escrita desconhecido: "${id}".` };
  }
  if (mode.proOnly && plan !== 'pro') {
    return {
      ok: false,
      status: 403,
      error: `O modo ${mode.name} faz parte do plano Pro. Assine para usar os modos profissionais.`,
    };
  }
  return { ok: true, mode };
}

/** Versão pública do registro — sem a instrução, que é ativo do produto. */
export function publicModes(): Array<Pick<Mode, 'id' | 'name' | 'description' | 'example' | 'apps' | 'proOnly'>> {
  return Object.values(MODES).map(({ id, name, description, example, apps, proOnly }) => ({
    id,
    name,
    description,
    example,
    apps,
    proOnly,
  }));
}
