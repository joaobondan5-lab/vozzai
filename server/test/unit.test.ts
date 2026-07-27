import { afterEach, describe, expect, it } from 'vitest';
import { countWords, planOf, PLANS } from '../src/quota';
import { normalizeEmail, hashPassword, verifyPassword } from '../src/auth';
import { isValidEmail } from '../src/validation';
import { isValidWebhookToken } from '../src/asaas';
import { MODES, resolveMode, publicModes, DEFAULT_MODE_ID } from '../src/modes';

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
