import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { app } from '../src/app';
import { initSchema, pool } from '../src/db';
import { resetRateLimits } from '../src/rateLimit';
import { reconcileAllSubscriptions } from '../src/mercadopago';

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

  it('/admin/leads exige o token igual às métricas', async () => {
    expect((await get('/admin/leads')).status).toBe(401);
    expect((await get('/admin/leads', { 'x-admin-token': 'errado' })).status).toBe(401);
  });

  it('/admin/leads lista contas e lista de espera com e-mail — a única rota com PII', async () => {
    await signup('lead-conta@vozzai.com.br');
    await pool.query(`UPDATE users SET plan = 'pro' WHERE email = 'lead-conta@vozzai.com.br'`);
    await pool.query(`INSERT INTO usage (user_id, seconds, words) VALUES (1, 30, 420)`);
    await post('/waitlist', { email: 'lead-espera@vozzai.com.br' });

    const { status, data } = await get('/admin/leads', {
      'x-admin-token': process.env.ADMIN_TOKEN as string,
    });
    expect(status).toBe(200);

    expect(data.users).toHaveLength(1);
    expect(data.users[0]).toMatchObject({
      email: 'lead-conta@vozzai.com.br',
      plan: 'pro',
      words30d: 420,
    });
    expect(data.users[0].createdAt).toBeTruthy();
    expect(data.users[0].lastDictationAt).toBeTruthy();

    expect(data.waitlist).toHaveLength(1);
    expect(data.waitlist[0].email).toBe('lead-espera@vozzai.com.br');
  });
});

describe('modes', () => {
  it('GET /modes lista o catálogo sem expor instruções', async () => {
    const { status, data } = await get('/modes');
    expect(status).toBe(200);
    expect(data.modes.length).toBeGreaterThanOrEqual(10);
    expect(data.modes[0]).toHaveProperty('id');
    expect(data.modes[0]).toHaveProperty('proOnly');
    expect(JSON.stringify(data)).not.toContain('instruction');
  });

  it('free pedindo modo Pro leva 403 antes de qualquer gasto', async () => {
    const token = await signup('free-modo@vozzai.com.br');
    const { status, data } = await post(
      '/transcribe',
      { audio: 'QUFBQQ==', mode: 'juridico' },
      { authorization: `Bearer ${token}` },
    );
    expect(status).toBe(403);
    expect(data.error).toMatch(/Pro/);
  });

  it('modo desconhecido leva 400', async () => {
    const token = await signup('modo-x@vozzai.com.br');
    const { status } = await post(
      '/transcribe',
      { audio: 'QUFBQQ==', mode: 'nao-existe' },
      { authorization: `Bearer ${token}` },
    );
    expect(status).toBe(400);
  });
});

describe('hardening', () => {
  it('rejeita body acima de 1MB fora do /transcribe (413)', async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(1_200_000) }),
    });
    expect(res.status).toBe(413);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/grande/i);
  });

  it('aceita body de 2MB no /transcribe (limite maior, só ali)', async () => {
    const token = await signup('audio-grande@vozzai.com.br');
    const { status } = await post(
      '/transcribe',
      { audio: 'A'.repeat(2_000_000), mode: 'padrao' },
      { authorization: `Bearer ${token}` },
    );
    // Sem OPENAI_API_KEY no ambiente de teste a transcrição falha em 502 —
    // o que importa aqui é NÃO ser 413.
    expect(status).not.toBe(413);
  });

  it('CORS: origem desconhecida não recebe Access-Control-Allow-Origin', async () => {
    const evil = await fetch(`${base}/health`, { headers: { origin: 'https://malicioso.com' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();

    const ok = await fetch(`${base}/health`, { headers: { origin: 'https://www.vozzai.com.br' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://www.vozzai.com.br');
  });

  it('respostas carregam headers de segurança', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('rate limit por usuário no /transcribe: 429 depois de 60 chamadas', async () => {
    const token = await signup('tagarela@vozzai.com.br');
    let got429 = false;
    for (let i = 0; i < 61; i++) {
      const { status } = await post(
        '/transcribe',
        { audio: 'QUFBQQ==' },
        { authorization: `Bearer ${token}` },
      );
      if (i < 60) expect(status).not.toBe(429);
      else got429 = status === 429;
    }
    expect(got429).toBe(true);
  });

  it('webhook MP exige assinatura válida quando o secret está configurado', async () => {
    process.env.MP_WEBHOOK_SECRET = 'segredo-mp-teste';
    try {
      const semAssinatura = await post('/webhooks/mercadopago', { data: { id: '123' } });
      expect(semAssinatura.status).toBe(401);

      const { createHmac } = await import('node:crypto');
      const ts = '1742505638683';
      const requestId = 'req-teste';
      const manifest = `id:123;request-id:${requestId};ts:${ts};`;
      const v1 = createHmac('sha256', 'segredo-mp-teste').update(manifest).digest('hex');
      const assinado = await post(
        '/webhooks/mercadopago',
        { data: { id: '123' }, type: 'ignorar' },
        { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      );
      expect(assinado.status).toBe(200);
    } finally {
      delete process.env.MP_WEBHOOK_SECRET;
    }
  });

  it('webhook MP continua aberto sem secret (comportamento atual preservado)', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    const { status } = await post('/webhooks/mercadopago', { data: {} });
    expect(status).toBe(200);
  });
});

describe('reconciliação Mercado Pago (rede de segurança para webhook perdido)', () => {
  const savedMpToken = process.env.MP_ACCESS_TOKEN;

  beforeEach(() => {
    // fetchPreapproval recusa chamar a API sem token configurado — aqui o
    // valor não importa (a chamada real é mockada), só precisa existir.
    process.env.MP_ACCESS_TOKEN = 'TEST-reconciliacao-fake';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedMpToken === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = savedMpToken;
  });

  // vi.stubGlobal('fetch', ...) substitui o fetch inteiro do processo — inclusive
  // o que os helpers post()/get() deste arquivo usam pra falar com o servidor
  // local. Por isso todo mock aqui repassa pro fetch real quando a URL não é
  // da API do Mercado Pago, em vez de travar as próprias chamadas do teste.
  const realFetch = globalThis.fetch;

  it('sem nenhum mp_customer no banco, não chama a API e não falha', async () => {
    const fetchSpy = vi.fn(realFetch);
    vi.stubGlobal('fetch', fetchSpy);
    const result = await reconcileAllSubscriptions();
    expect(result).toEqual({ checked: 0, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('corrige um usuário que ficou "pro" no banco mas foi cancelado na MP', async () => {
    const token = await signup('esqueceu-de-cancelar@vozzai.com.br');
    await pool.query(
      `UPDATE users SET plan = 'pro', mp_customer = 'sub_cancelada_1' WHERE email = 'esqueceu-de-cancelar@vozzai.com.br'`,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).includes('api.mercadopago.com')) return realFetch(url, init);
        return new Response(JSON.stringify({ id: 'sub_cancelada_1', status: 'cancelled', external_reference: '1' }), {
          status: 200,
        });
      }),
    );

    const result = await reconcileAllSubscriptions();
    expect(result).toEqual({ checked: 1, failed: 0 });

    const me = await get('/me', { authorization: `Bearer ${token}` });
    expect(me.data.plan).toBe('free');
  });

  it('libera o Pro de um usuário que ficou "free" no banco por causa de um webhook perdido', async () => {
    const token = await signup('webhook-perdido@vozzai.com.br');
    await pool.query(
      `UPDATE users SET plan = 'free', mp_customer = 'sub_autorizada_1' WHERE email = 'webhook-perdido@vozzai.com.br'`,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).includes('api.mercadopago.com')) return realFetch(url, init);
        return new Response(JSON.stringify({ id: 'sub_autorizada_1', status: 'authorized', external_reference: '1' }), {
          status: 200,
        });
      }),
    );

    await reconcileAllSubscriptions();
    const me = await get('/me', { authorization: `Bearer ${token}` });
    expect(me.data.plan).toBe('pro');
  });

  it('uma assinatura com falha na consulta não impede as outras de reconciliarem', async () => {
    await signup('falha@vozzai.com.br');
    await pool.query(`UPDATE users SET plan = 'pro', mp_customer = 'sub_com_erro' WHERE email = 'falha@vozzai.com.br'`);

    const okToken = await signup('ok-junto@vozzai.com.br');
    await pool.query(`UPDATE users SET plan = 'free', mp_customer = 'sub_ok' WHERE email = 'ok-junto@vozzai.com.br'`);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).includes('api.mercadopago.com')) return realFetch(url, init);
        if (String(url).includes('sub_com_erro')) throw new Error('timeout simulado');
        return new Response(JSON.stringify({ id: 'sub_ok', status: 'authorized', external_reference: String(2) }), {
          status: 200,
        });
      }),
    );

    const result = await reconcileAllSubscriptions();
    expect(result.checked).toBe(2);
    expect(result.failed).toBe(1);

    const me = await get('/me', { authorization: `Bearer ${okToken}` });
    expect(me.data.plan).toBe('pro');
  });
});

describe('e-mails nas transições de plano', () => {
  const savedMpToken = process.env.MP_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = 'TEST-emails-fake';
    process.env.RESEND_API_KEY = 're_teste_transicao';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    if (savedMpToken === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = savedMpToken;
  });

  it('virar Pro pela reconciliação dispara o e-mail de confirmação', async () => {
    const realFetch = globalThis.fetch;
    await signup('vai-virar-pro@vozzai.com.br');
    await pool.query(
      `UPDATE users SET plan = 'free', mp_customer = 'sub_email_1' WHERE email = 'vai-virar-pro@vozzai.com.br'`,
    );

    const resendCalls: Array<{ to: string[]; subject: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('api.resend.com')) {
          resendCalls.push(JSON.parse(String(init?.body)));
          return new Response('{"id":"email_1"}', { status: 200 });
        }
        if (u.includes('api.mercadopago.com')) {
          return new Response(
            JSON.stringify({ id: 'sub_email_1', status: 'authorized', external_reference: '1' }),
            { status: 200 },
          );
        }
        return realFetch(url, init);
      }),
    );

    await reconcileAllSubscriptions();
    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0].to).toEqual(['vai-virar-pro@vozzai.com.br']);
    expect(resendCalls[0].subject).toMatch(/Pro está ativo/);
  });

  it('perder o Pro dispara o e-mail de encerramento (avisa cartão recusado)', async () => {
    const realFetch = globalThis.fetch;
    await signup('vai-perder-pro@vozzai.com.br');
    await pool.query(
      `UPDATE users SET plan = 'pro', mp_customer = 'sub_email_2' WHERE email = 'vai-perder-pro@vozzai.com.br'`,
    );

    const resendCalls: Array<{ to: string[]; subject: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('api.resend.com')) {
          resendCalls.push(JSON.parse(String(init?.body)));
          return new Response('{"id":"email_2"}', { status: 200 });
        }
        if (u.includes('api.mercadopago.com')) {
          return new Response(
            JSON.stringify({ id: 'sub_email_2', status: 'cancelled', external_reference: '1' }),
            { status: 200 },
          );
        }
        return realFetch(url, init);
      }),
    );

    await reconcileAllSubscriptions();
    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0].subject).toMatch(/encerrado/);
  });

  it('cadastro dispara o e-mail de boas-vindas sem atrasar a resposta', async () => {
    const realFetch = globalThis.fetch;
    const resendCalls: Array<{ to: string[]; subject: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('api.resend.com')) {
          resendCalls.push(JSON.parse(String(init?.body)));
          return new Response('{"id":"email_3"}', { status: 200 });
        }
        return realFetch(url, init);
      }),
    );

    await signup('recem-chegado@vozzai.com.br');
    // O envio é fire-and-forget depois da resposta — espera curta e determinística.
    for (let i = 0; i < 50 && resendCalls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0].to).toEqual(['recem-chegado@vozzai.com.br']);
    expect(resendCalls[0].subject).toMatch(/Bem-vindo/);
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
