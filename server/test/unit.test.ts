import { describe, expect, it } from 'vitest';
import { countWords, planOf, PLANS } from '../src/quota';
import { normalizeEmail, hashPassword, verifyPassword } from '../src/auth';
import { isValidEmail } from '../src/validation';

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
