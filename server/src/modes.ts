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
      'o jeito de falar da própria pessoa preservado. Não adicione formalidade artificial, não adicione emojis ' +
      'que a pessoa não ditou e não invente conteúdo.',
    example: 'Oi! Vi o orçamento e podemos seguir. Me manda a versão final hoje?',
    apps: ['WhatsApp'],
    proOnly: false,
  },
  email: {
    ...V,
    id: 'email',
    name: 'E-mail profissional',
    description: 'Saudação, parágrafos organizados e fechamento cordial.',
    instruction:
      'Organize o ditado como um e-mail profissional: saudação breve quando fizer sentido, parágrafos claros e ' +
      'fechamento cordial. Não invente nome de destinatário, assunto nem qualquer informação que não foi dita.',
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
