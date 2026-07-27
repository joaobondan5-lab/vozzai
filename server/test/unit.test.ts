import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail, sendWelcomeEmail } from '../src/email';
import { countWords, planOf, PLANS } from '../src/quota';
import { normalizeEmail, hashPassword, verifyPassword } from '../src/auth';
import { isValidEmail } from '../src/validation';
import { isValidWebhookToken } from '../src/asaas';
import { isValidMpSignature, isMpSignatureCheckEnabled } from '../src/webhookSignature';
import { createHmac } from 'node:crypto';
import { MODES, resolveMode, publicModes, DEFAULT_MODE_ID } from '../src/modes';
import { cleanup } from '../src/openai';
import { BILLING_PLANS, resolveBillingCycle } from '../src/mercadopago';

describe('quota', () => {
  it('countWords conta palavras separadas por espaços', () => {
    expect(countWords('oi tudo bem')).toBe(3);
    expect(countWords('  espaços   extras \n e quebras  ')).toBe(4);
    expect(countWords('uma')).toBe(1);
  });

  it('countWords devolve 0 para vazio ou só espaços', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });

  it('planOf reconhece pro e trata o resto como free', () => {
    expect(planOf('pro')).toBe('pro');
    expect(planOf('free')).toBe('free');
    expect(planOf('qualquer-coisa')).toBe('free');
    expect(planOf('')).toBe('free');
  });

  it('limites dos planos batem com o que a landing promete', () => {
    expect(PLANS.free).toMatchObject({ words: 2_000, period: 'week' });
    expect(PLANS.pro).toMatchObject({ words: 120_000, period: 'month' });
  });
});

describe('auth helpers', () => {
  it('normalizeEmail tira espaços e baixa a caixa', () => {
    expect(normalizeEmail('  Joao@Exemplo.COM ')).toBe('joao@exemplo.com');
    expect(normalizeEmail('ja@ok.com')).toBe('ja@ok.com');
  });

  it('hash e verificação de senha fecham o ciclo', () => {
    const stored = hashPassword('senha-super-secreta');
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(verifyPassword('senha-super-secreta', stored)).toBe(true);
    expect(verifyPassword('senha-errada', stored)).toBe(false);
  });

  it('dois hashes da mesma senha diferem (salt aleatório)', () => {
    expect(hashPassword('mesma')).not.toBe(hashPassword('mesma'));
  });

  it('verificação rejeita hash armazenado malformado sem lançar', () => {
    expect(verifyPassword('qualquer', 'sem-dois-pontos')).toBe(false);
    expect(verifyPassword('qualquer', '')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('aceita e-mails plausíveis', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('nome.sobrenome+tag@sub.dominio.com.br')).toBe(true);
  });

  it('rejeita formatos quebrados e não-strings', () => {
    expect(isValidEmail('sem-arroba')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(123)).toBe(false);
  });
});

describe('ciclos de cobrança (mensal/anual)', () => {
  it('mensal e anual têm os preços e frequências certos', () => {
    expect(BILLING_PLANS.monthly).toMatchObject({ amount: 29.9, frequency: 1 });
    expect(BILLING_PLANS.annual).toMatchObject({ amount: 249, frequency: 12 });
  });

  it('o anual desconta de verdade contra 12 meses avulsos', () => {
    const dozeMeses = BILLING_PLANS.monthly.amount * 12;
    expect(BILLING_PLANS.annual.amount).toBeLessThan(dozeMeses);
    const desconto = 1 - BILLING_PLANS.annual.amount / dozeMeses;
    expect(desconto).toBeGreaterThan(0.25); // pelo menos 25% off
  });

  it('resolveBillingCycle só aceita "annual"; qualquer outra coisa é mensal', () => {
    expect(resolveBillingCycle('annual')).toBe('annual');
    expect(resolveBillingCycle('monthly')).toBe('monthly');
    expect(resolveBillingCycle('anual')).toBe('monthly'); // grafia errada não vira anual
    expect(resolveBillingCycle(undefined)).toBe('monthly');
    expect(resolveBillingCycle('grátis-pra-sempre')).toBe('monthly');
    expect(resolveBillingCycle({ cycle: 'annual' })).toBe('monthly'); // objeto não engana
  });
});

describe('VozzAI Modes', () => {
  it('todo modo do registro é coerente (id, textos, schema)', () => {
    for (const [key, mode] of Object.entries(MODES)) {
      expect(mode.id).toBe(key);
      expect(mode.name.length).toBeGreaterThan(2);
      expect(mode.description.length).toBeGreaterThan(10);
      expect(mode.instruction.length).toBeGreaterThan(40);
      expect(mode.schemaVersion).toBe(1);
    }
  });

  it('tem modos essenciais grátis e profissionais no Pro', () => {
    const free = Object.values(MODES).filter((m) => !m.proOnly).map((m) => m.id);
    const pro = Object.values(MODES).filter((m) => m.proOnly).map((m) => m.id);
    expect(free).toEqual(expect.arrayContaining(['padrao', 'whatsapp', 'email', 'objetivo', 'fiel']));
    expect(pro).toEqual(expect.arrayContaining(['atendimento', 'vendas', 'juridico', 'dev', 'conteudo']));
  });

  it('sem modo (ou vazio) cai no Padrão', () => {
    for (const requested of [undefined, '', '  ']) {
      const r = resolveMode(requested, 'free');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.mode.id).toBe(DEFAULT_MODE_ID);
    }
  });

  it('modo desconhecido é 400, não fallback silencioso', () => {
    const r = resolveMode('haiku', 'pro');
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('plano free não usa modo Pro (403), plano pro usa tudo', () => {
    const blocked = resolveMode('juridico', 'free');
    expect(blocked).toMatchObject({ ok: false, status: 403 });
    if (!blocked.ok) expect(blocked.error).toMatch(/Pro/);

    expect(resolveMode('juridico', 'pro').ok).toBe(true);
    expect(resolveMode('whatsapp', 'free').ok).toBe(true);
  });

  it('catálogo público não vaza as instruções', () => {
    const serialized = JSON.stringify(publicModes());
    expect(serialized).not.toContain('instruction');
    for (const mode of Object.values(MODES)) {
      expect(serialized).not.toContain(mode.instruction.slice(0, 30));
    }
  });

  // Um teste com áudio real pegou o modo E-mail devolvendo "[Seu Nome]" e o
  // WhatsApp inventando "Oi, tudo bem?". Ditado que volta com lacuna pra
  // preencher quebra a promessa do produto, então a regra que proíbe isso
  // precisa alcançar TODO modo — inclusive os que ainda vão ser criados.
  it('todo modo recebe as regras contra placeholder e invenção', async () => {
    const prompts: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      prompts.push(JSON.parse(init.body).messages[0].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    });

    for (const mode of Object.values(MODES)) {
      await cleanup('texto ditado qualquer', 'informal', mode);
    }
    await cleanup('texto ditado qualquer'); // sem modo: cai no Padrão
    vi.unstubAllGlobals();

    expect(prompts).toHaveLength(Object.keys(MODES).length + 1);
    for (const prompt of prompts) {
      expect(prompt).toContain('[Seu Nome]');   // citado como proibição, não como modelo
      expect(prompt).toContain('PROIBIDO usar placeholder');
      expect(prompt).toContain('Não invente saudação');
    }
  });
});

describe('e-mails transacionais (Resend)', () => {
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    vi.unstubAllGlobals();
  });

  it('sem RESEND_API_KEY: pula sem chamar rede e sem lançar', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendEmail('a@b.co', 'Assunto', '<p>oi</p>');
    expect(result.sent).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('com chave: envia pro Resend com destinatário e assunto certos', async () => {
    process.env.RESEND_API_KEY = 're_teste';
    const fetchSpy = vi.fn(async () => new Response('{"id":"email_1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendWelcomeEmail('novo@vozzai.com.br');
    expect(result.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(['novo@vozzai.com.br']);
    expect(body.subject).toMatch(/Bem-vindo/);
    expect(body.html).toContain('2.000 palavras');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_teste');
  });

  it('Resend fora do ar: devolve sent=false sem lançar (nunca quebra o fluxo)', async () => {
    process.env.RESEND_API_KEY = 're_teste';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro interno', { status: 500 })));
    const result = await sendEmail('a@b.co', 'Assunto', '<p>oi</p>');
    expect(result).toMatchObject({ sent: false });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede caiu'); }));
    const result2 = await sendEmail('a@b.co', 'Assunto', '<p>oi</p>');
    expect(result2).toMatchObject({ sent: false });
  });
});

describe('assinatura de webhook do Mercado Pago', () => {
  const secret = 'segredo-de-teste-mp';

  function sign(dataId: string, requestId: string, ts: string): string {
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    return createHmac('sha256', secret).update(manifest).digest('hex');
  }

  it('fica desligada sem MP_WEBHOOK_SECRET', () => {
    delete process.env.MP_WEBHOOK_SECRET;
    expect(isMpSignatureCheckEnabled()).toBe(false);
    expect(
      isValidMpSignature({ xSignature: 'ts=1,v1=abc', xRequestId: 'r', dataId: 'd' }),
    ).toBe(false); // sem secret, nada valida — o app nem chama neste caso
  });

  it('aceita assinatura correta e normaliza o data.id para minúsculas', () => {
    const v1 = sign('ABC123', 'req-1', '1742505638683');
    expect(
      isValidMpSignature(
        { xSignature: `ts=1742505638683,v1=${v1}`, xRequestId: 'req-1', dataId: 'ABC123' },
        secret,
      ),
    ).toBe(true);
  });

  it('rejeita assinatura de outro secret, ts adulterado e headers ausentes', () => {
    const v1 = sign('123', 'req-1', '111');
    const ok = { xSignature: `ts=111,v1=${v1}`, xRequestId: 'req-1', dataId: '123' };
    expect(isValidMpSignature(ok, secret)).toBe(true);

    expect(isValidMpSignature(ok, 'outro-secret')).toBe(false);
    expect(isValidMpSignature({ ...ok, xSignature: `ts=222,v1=${v1}` }, secret)).toBe(false);
    expect(isValidMpSignature({ ...ok, xSignature: undefined }, secret)).toBe(false);
    expect(isValidMpSignature({ ...ok, xRequestId: undefined }, secret)).toBe(false);
    expect(isValidMpSignature({ ...ok, dataId: undefined }, secret)).toBe(false);
    expect(isValidMpSignature({ ...ok, xSignature: 'sem-formato' }, secret)).toBe(false);
  });
});

describe('isValidWebhookToken (Asaas)', () => {
  afterEach(() => {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
  });

  it('nunca aceita nada sem ASAAS_WEBHOOK_TOKEN configurado', () => {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
    expect(isValidWebhookToken('qualquer-coisa')).toBe(false);
    expect(isValidWebhookToken(undefined)).toBe(false);
  });

  it('só aceita o valor exato configurado', () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'segredo-do-webhook';
    expect(isValidWebhookToken('segredo-do-webhook')).toBe(true);
    expect(isValidWebhookToken('segredo-errado')).toBe(false);
    expect(isValidWebhookToken(undefined)).toBe(false);
  });
});
