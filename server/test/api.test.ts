import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { app } from '../src/app';
import { initSchema, pool } from '../src/db';
import { resetRateLimits } from '../src/rateLimit';

let server: Server;
let base: string;

beforeAll(async () => {
  await initSchema();
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.close();
  await pool.end();
});

beforeEach(async () => {
  resetRateLimits();
  await pool.query('TRUNCATE usage, sessions, waitlist, users RESTART IDENTITY CASCADE');
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as any };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, data: (await res.json()) as any };
}

async function signup(email = 'teste@vozzai.com.br', password = 'senha-forte-123') {
  const { status, data } = await post('/auth/signup', { email, password });
  expect(status).toBe(201);
  return data.token as string;
}

describe('health', () => {
  it('responde ok', async () => {
    const { status, data } = await get('/health');
    expect(status).toBe(200);
    expect(data).toEqual({ ok: true });
  });
});

describe('signup', () => {
  it('cria conta, devolve token e normaliza o e-mail', async () => {
    const { status, data } = await post('/auth/signup', {
      email: '  MaiUsculas@Exemplo.COM ',
      password: 'senha-forte-123',
    });
    expect(status).toBe(201);
    expect(data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(data.email).toBe('maiusculas@exemplo.com');
    expect(data.plan).toBe('free');
  });

  it('rejeita e-mail duplicado mesmo variando a caixa', async () => {
    await signup('dup@vozzai.com.br');
    const { status, data } = await post('/auth/signup', {
      email: 'DUP@vozzai.com.br',
      password: 'outra-senha-123',
    });
    expect(status).toBe(409);
    expect(data.error).toMatch(/já existe/i);
  });

  it('rejeita e-mail inválido e senha curta', async () => {
    expect((await post('/auth/signup', { email: 'nao-e-email', password: 'senha-forte-123' })).status).toBe(400);
    expect((await post('/auth/signup', { email: 'ok@ok.com', password: 'curta' })).status).toBe(400);
  });
});

describe('login', () => {
  it('senha errada dá 401, certa devolve token novo', async () => {
    await signup('login@vozzai.com.br', 'senha-correta-1');
    expect((await post('/auth/login', { email: 'login@vozzai.com.br', password: 'errada-errada' })).status).toBe(401);

    const ok = await post('/auth/login', { email: 'LOGIN@vozzai.com.br', password: 'senha-correta-1' });
    expect(ok.status).toBe(200);
    expect(ok.data.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bloqueia depois de 10 tentativas na janela', async () => {
    for (let i = 0; i < 10; i++) {
      const { status } = await post('/auth/login', { email: 'x@x.com', password: 'errada-123' });
      expect(status).toBe(401);
    }
    const { status } = await post('/auth/login', { email: 'x@x.com', password: 'errada-123' });
    expect(status).toBe(429);
  });
});

describe('/me', () => {
  it('sem token dá 401', async () => {
    expect((await get('/me')).status).toBe(401);
  });

  it('devolve padrões e uso zerado do plano grátis', async () => {
    const token = await signup();
    const { status, data } = await get('/me', { authorization: `Bearer ${token}` });
    expect(status).toBe(200);
    expect(data).toMatchObject({
      email: 'teste@vozzai.com.br',
      plan: 'free',
      tone: 'informal',
      dictionary: '',
      usage: { plan: 'free', used: 0, limit: 2000, remaining: 2000, period: 'week' },
    });
  });

  it('PATCH valida tom e tamanho do dicionário', async () => {
    const token = await signup();
    const auth = { authorization: `Bearer ${token}` };

    const badTone = await fetch(`${base}/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ tone: 'gritando' }),
    });
    expect(badTone.status).toBe(400);

    const badDict = await fetch(`${base}/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ dictionary: 'x'.repeat(2001) }),
    });
    expect(badDict.status).toBe(400);

    const ok = await fetch(`${base}/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ tone: 'formal', dictionary: 'VozzAI, Railway' }),
    });
    expect(ok.status).toBe(200);

    const me = await get('/me', auth);
    expect(me.data.tone).toBe('formal');
    expect(me.data.dictionary).toBe('VozzAI, Railway');
  });

  it('desconta uso registrado do limite, sem ficar negativo', async () => {
    const token = await signup();
    await pool.query(`INSERT INTO usage (user_id, seconds, words) VALUES (1, 30, 500)`);
    let me = await get('/me', { authorization: `Bearer ${token}` });
    expect(me.data.usage).toMatchObject({ used: 500, remaining: 1500 });

    await pool.query(`INSERT INTO usage (user_id, seconds, words) VALUES (1, 300, 5000)`);
    me = await get('/me', { authorization: `Bearer ${token}` });
    expect(me.data.usage.used).toBe(5500);
    expect(me.data.usage.remaining).toBe(0);
  });
});

describe('waitlist', () => {
  it('aceita e-mail válido e repete sem erro', async () => {
    expect((await post('/waitlist', { email: 'espera@vozzai.com.br' })).status).toBe(201);
    expect((await post('/waitlist', { email: 'espera@vozzai.com.br' })).status).toBe(201);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM waitlist');
    expect(rows[0].n).toBe(1);
  });

  it('rejeita e-mail inválido', async () => {
    expect((await post('/waitlist', { email: 'nada' })).status).toBe(400);
  });
});

describe('admin', () => {
  it('fica fechado sem ADMIN_TOKEN configurado', async () => {
    const saved = process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    try {
      expect((await get('/admin/metrics', { 'x-admin-token': 'qualquer' })).status).toBe(503);
    } finally {
      process.env.ADMIN_TOKEN = saved;
    }
  });

  it('rejeita token errado e aceita o certo, só com agregados', async () => {
    expect((await get('/admin/metrics')).status).toBe(401);
    expect((await get('/admin/metrics', { 'x-admin-token': 'errado' })).status).toBe(401);

    await signup('cliente@vozzai.com.br');
    await post('/waitlist', { email: 'fila@vozzai.com.br' });
    await pool.query(`UPDATE users SET plan = 'pro' WHERE email = 'cliente@vozzai.com.br'`);

    const { status, data } = await get('/admin/metrics', {
      'x-admin-token': process.env.ADMIN_TOKEN as string,
    });
    expect(status).toBe(200);
    expect(data).toMatchObject({
      totalUsers: 1,
      proUsers: 1,
      freeUsers: 0,
      mrrCents: 2990,
      signups7d: 1,
      waitlistCount: 1,
    });
    expect(JSON.stringify(data)).not.toContain('vozzai.com.br'); // nenhum e-mail vaza
  });

  it('serve a página do painel', async () => {
    const res = await fetch(`${base}/admin`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('VozzAI — Métricas');
  });
});

describe('webhook Asaas', () => {
  it('rejeita sem o token configurado, ignora ainda-não-pago, ativa Pro quando confirma', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'segredo-de-teste';
    const token = await signup('assinante-pix@vozzai.com.br');

    const semToken = await fetch(`${base}/webhooks/asaas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED', externalReference: '1' } }),
    });
    expect(semToken.status).toBe(401);

    await fetch(`${base}/webhooks/asaas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'asaas-access-token': 'segredo-de-teste' },
      body: JSON.stringify({ event: 'PAYMENT_CREATED', payment: { id: 'pay_1', status: 'PENDING', externalReference: '1' } }),
    });
    let me = await get('/me', { authorization: `Bearer ${token}` });
    expect(me.data.plan).toBe('free'); // pendente não vira pro

    await fetch(`${base}/webhooks/asaas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'asaas-access-token': 'segredo-de-teste' },
      body: JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED', externalReference: '1' } }),
    });
    me = await get('/me', { authorization: `Bearer ${token}` });
    expect(me.data.plan).toBe('pro');

    delete process.env.ASAAS_WEBHOOK_TOKEN;
  });
});

describe('billing', () => {
  it.skipIf(!process.env.MP_ACCESS_TOKEN)(
    'cria assinatura no sandbox e devolve link de checkout',
    async () => {
      expect(process.env.MP_ACCESS_TOKEN).toMatch(/^TEST-/); // nunca produção
      const token = await signup('assinante@gmail.com');
      const { status, data } = await post('/billing/subscribe', {}, { authorization: `Bearer ${token}` });
      expect(status).toBe(200);
      expect(data.checkoutUrl).toMatch(/^https:\/\/www\.mercadopago\.com\.br\/subscriptions\/checkout\?preapproval_id=/);
    },
  );

  it('exige login', async () => {
    expect((await post('/billing/subscribe', {})).status).toBe(401);
  });
});
