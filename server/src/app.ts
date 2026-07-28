import express from 'express';
import {
  createUser,
  findUserByEmail,
  login,
  userForToken,
  createSession,
  updatePreferences,
  User,
} from './auth';
import { usageFor, recordUsage, countWords, PLANS, planOf } from './quota';
import { transcribe, cleanup } from './openai';
import { syncSubscription, createSubscription, resolveBillingCycle } from './mercadopago';
import { resolveMode, publicModes } from './modes';
import { isMpSignatureCheckEnabled, isValidMpSignature } from './webhookSignature';
import { track, isValidClientEvent, normalizePlatform, wordsBucket } from './events';
import { sendWelcomeEmail } from './email';
import { addToWaitlist, pool } from './db';
import { isRateLimited } from './rateLimit';
import { isValidEmail } from './validation';
import { requireAdmin, collectMetrics, collectLeads, ADMIN_PAGE } from './admin';
import { collectDashboard } from './analytics';

// O app fica separado do entrypoint (index.ts) para os testes montarem as
// rotas em memória sem abrir porta nem preparar o schema.
export const app = express();

// Headers de segurança em toda resposta: nada de sniffing de tipo, nada de
// abrir o site/painel dentro de iframe de terceiro.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Só o /transcribe recebe áudio; o resto das rotas é JSON pequeno. Um corpo
// de 25 MB num /auth/login não é login, é abuso.
const jsonSmall = express.json({ limit: '1mb' });
const jsonAudio = express.json({ limit: '25mb' });
app.use((req, res, next) => (req.path === '/transcribe' ? jsonAudio : jsonSmall)(req, res, next));

// CORS: a landing e a extensão de Chrome chamam esta API do navegador. A
// origem precisa estar na lista — refletir qualquer uma era mais largo do
// que o necessário. App de Mac e webhooks não mandam Origin, então não
// passam por aqui.
const CORS_ALLOWED = [
  /^https:\/\/(www\.)?vozzai\.com\.br$/,
  /^https:\/\/vozzai[a-z0-9.-]*\.vercel\.app$/, // previews do deploy
  /^http:\/\/localhost(:\d+)?$/, // desenvolvimento local
  /^chrome-extension:\/\/[a-p]{32}$/, // extensão (id é sempre a-p, 32 chars)
];

app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && CORS_ALLOWED.some((re) => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

/** Express 4 não captura erro de handler async sozinho — isso evita repetir try/catch em cada rota. */
function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function bearer(req: express.Request): string | undefined {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : undefined;
}

async function requireUser(req: express.Request, res: express.Response): Promise<User | null> {
  const user = await userForToken(bearer(req));
  if (!user) {
    res.status(401).json({ error: 'Faça login para continuar.' });
    return null;
  }
  return user;
}

/**
 * Vivo? E rodando qual código?
 *
 * O `commit` existe porque, sem ele, "já subiu?" só dá pra responder no olho —
 * e olhar não é conferir: um deploy que ainda não trocou devolve a resposta
 * antiga com cara de sucesso. Isso já produziu dois falsos positivos aqui
 * (o plano anual e o conserto dos modos). O SHA curto é opaco e o repositório
 * é privado, então não conta nada que interesse a quem não deveria saber.
 */
app.get('/health', (_req, res) =>
  res.json({ ok: true, commit: (process.env.RAILWAY_GIT_COMMIT_SHA || 'dev').slice(0, 7) }),
);

/** Catálogo público de modos (sem as instruções, que são ativo do produto). */
app.get('/modes', (_req, res) => res.json({ modes: publicModes() }));

/**
 * Eventos de produto vindos do app e da extensão — passos que só o cliente
 * conhece (permissões, onboarding, falha ao colar). O nome precisa estar na
 * allowlist de events.ts e as props são filtradas lá; conteúdo nunca entra.
 * Responde 204 sempre que o formato é aceitável: telemetria não é caminho
 * crítico e não deve gerar erro visível pro usuário.
 */
app.post(
  '/events',
  asyncRoute(async (req, res) => {
    const { name, platform } = req.body ?? {};
    if (!isValidClientEvent(name)) return void res.sendStatus(204);

    // Rate limit generoso por IP: evita flood sem atrapalhar uso normal.
    if (isRateLimited(`events:${req.ip}`, 300)) return void res.sendStatus(204);

    const user = await userForToken(bearer(req));
    void track(name, {
      userId: user?.id ?? null,
      platform: normalizePlatform(platform),
      props: (req.body ?? {}).props,
    });
    res.sendStatus(204);
  }),
);

app.post(
  '/waitlist',
  asyncRoute(async (req, res) => {
    if (isRateLimited(`waitlist:${req.ip}`)) {
      return void res.status(429).json({ error: 'Muitas tentativas. Espere um pouco e tente de novo.' });
    }

    const rawEmail = (req.body ?? {}).email;
    // Teclado de celular adora colar um espaço no fim — não pode custar um 400.
    const email = typeof rawEmail === 'string' ? rawEmail.trim() : rawEmail;
    if (!isValidEmail(email)) {
      return void res.status(400).json({ error: 'E-mail inválido.' });
    }

    await addToWaitlist(email);
    res.status(201).json({ ok: true });
  }),
);

app.post(
  '/auth/signup',
  asyncRoute(async (req, res) => {
    if (isRateLimited(`signup:${req.ip}`)) {
      return void res.status(429).json({ error: 'Muitas tentativas. Espere um pouco e tente de novo.' });
    }

    const { email: rawEmail, password } = req.body ?? {};
    const email = typeof rawEmail === 'string' ? rawEmail.trim() : rawEmail;
    if (!isValidEmail(email)) {
      return void res.status(400).json({ error: 'E-mail inválido.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return void res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres.' });
    }
    if (await findUserByEmail(email)) {
      return void res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
    }

    const user = await createUser(email, password);
    const token = await createSession(user.id);
    res.status(201).json({ token, email: user.email, plan: user.plan });
    // Depois da resposta, sem bloquear o cadastro — e sendEmail nunca lança.
    void sendWelcomeEmail(user.email);
    void track('signup', { userId: user.id, platform: normalizePlatform(req.body?.platform) });
  }),
);

app.post(
  '/auth/login',
  asyncRoute(async (req, res) => {
    if (isRateLimited(`login:${req.ip}`)) {
      return void res.status(429).json({ error: 'Muitas tentativas. Espere um pouco e tente de novo.' });
    }

    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return void res.status(400).json({ error: 'Informe e-mail e senha.' });
    }
    const token = await login(email, password);
    if (!token) return void res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    res.json({ token });
  }),
);

app.get(
  '/me',
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({
      email: user.email,
      plan: user.plan,
      tone: user.tone,
      dictionary: user.dictionary,
      usage: await usageFor(user.id, user.plan),
    });
  }),
);

/** Preferências do Premium: tom de voz (formal/informal) e dicionário pessoal. */
app.patch(
  '/me',
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const { tone, dictionary } = req.body ?? {};
    if (tone !== undefined && tone !== 'formal' && tone !== 'informal') {
      return void res.status(400).json({ error: 'Tom precisa ser "formal" ou "informal".' });
    }
    if (dictionary !== undefined && (typeof dictionary !== 'string' || dictionary.length > 2000)) {
      return void res.status(400).json({ error: 'Dicionário precisa ter até 2.000 caracteres.' });
    }

    await updatePreferences(user.id, { tone, dictionary });
    res.json({ ok: true });
  }),
);

/** O app manda o áudio; o servidor transcreve com a chave dele e cobra a cota. */
app.post(
  '/transcribe',
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    // Além da cota de palavras: um teto de chamadas por usuário. Áudio longo
    // de silêncio custa Whisper por minuto e quase não desconta palavras —
    // sem isso, uma conta grátis conseguiria queimar dinheiro de API.
    if (isRateLimited(`transcribe:${user.id}`, 60)) {
      return void res.status(429).json({ error: 'Muitos ditados em sequência. Espere alguns minutos.' });
    }

    const { audio, language, mode: modeId } = req.body ?? {};
    if (typeof audio !== 'string' || !audio) {
      return void res.status(400).json({ error: 'Áudio ausente.' });
    }

    // Valida o modo ANTES de cota e de qualquer chamada paga — cliente nenhum
    // usa modo Pro sem plano Pro, não importa o que a UI dele mostre.
    const resolution = resolveMode(modeId, planOf(user.plan));
    if (!resolution.ok) {
      void track('mode_denied', {
        userId: user.id,
        props: { mode: String(modeId), plan: user.plan },
      });
      return void res.status(resolution.status).json({ error: resolution.error });
    }

    const status = await usageFor(user.id, user.plan);
    if (status.remaining <= 0) {
      void track('quota_blocked', { userId: user.id, props: { plan: user.plan } });
      const limite = PLANS[status.plan].label;
      return void res.status(402).json({
        error:
          planOf(user.plan) === 'free'
            ? `Você usou as ${status.limit.toLocaleString('pt-BR')} palavras da semana no plano ${limite}. Assine o Pro para continuar.`
            : 'Você atingiu o limite do mês. Fale com a gente para liberar mais.',
        usage: status,
      });
    }

    try {
      const { text, seconds } = await transcribe(
        Buffer.from(audio, 'base64'),
        language || 'pt',
        user.dictionary,
      );
      const finalText = await cleanup(text, user.tone, resolution.mode);
      const words = countWords(finalText);
      await recordUsage(user.id, seconds, words);
      res.json({ text: finalText, usage: await usageFor(user.id, user.plan) });
      void track('dictation_ok', {
        userId: user.id,
        props: { mode: resolution.mode.id, words_bucket: wordsBucket(words) },
      });
    } catch (err) {
      console.error('[vozza] erro na transcrição:', err);
      void track('dictation_error', {
        userId: user.id,
        props: { mode: resolution.mode.id, error_code: 'transcribe_failed' },
      });
      res.status(502).json({ error: 'Não consegui transcrever agora. Tente de novo.' });
    }
  }),
);

/**
 * Cria a assinatura Pro no Mercado Pago e devolve o link de checkout.
 * `cycle` no corpo: "monthly" (padrão) ou "annual". Qualquer outro valor
 * cai em mensal — o cliente nunca escolhe um preço que o servidor não conhece.
 */
app.post(
  '/billing/subscribe',
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const cycle = resolveBillingCycle((req.body ?? {}).cycle);
    try {
      const checkoutUrl = await createSubscription(user.id, user.email, cycle);
      res.json({ checkoutUrl });
      void track('checkout_started', { userId: user.id, props: { cycle } });
    } catch (err) {
      console.error('[vozza] erro ao criar assinatura:', err);
      res.status(502).json({ error: 'Não consegui iniciar a assinatura agora. Tente de novo.' });
    }
  }),
);

/**
 * Mercado Pago avisa aqui quando uma assinatura muda. Nunca confiamos no corpo
 * da notificação: consultamos a API deles para saber o estado real. Com
 * MP_WEBHOOK_SECRET configurado, a assinatura x-signature também é exigida.
 */
app.post('/webhooks/mercadopago', (req, res) => {
  if (isMpSignatureCheckEnabled()) {
    const valid = isValidMpSignature({
      xSignature: req.header('x-signature'),
      xRequestId: req.header('x-request-id'),
      dataId: req.body?.data?.id,
    });
    if (!valid) return void res.status(401).json({ error: 'Assinatura do webhook inválida.' });
  }
  res.status(200).json({ received: true }); // responde rápido; processa depois
  syncSubscription(req.body).catch((err) => {
    console.error('[vozza] webhook Mercado Pago falhou:', err);
  });
});

app.get('/admin', (_req, res) => {
  res.type('html').send(ADMIN_PAGE);
});

app.get(
  '/admin/metrics',
  asyncRoute(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(await collectMetrics());
  }),
);

/** Tudo que o painel mostra, numa chamada — só agregados, sem e-mail. */
app.get(
  '/admin/dashboard',
  asyncRoute(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(await collectDashboard());
  }),
);

/**
 * Lista de contatos para outreach — a ÚNICA rota que expõe e-mails de
 * propósito. Separada de /admin/metrics para a fronteira de PII ficar
 * explícita e testável (métricas nunca vazam e-mail; leads sempre têm).
 */
app.get(
  '/admin/leads',
  asyncRoute(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(await collectLeads());
  }),
);

// Rede de segurança: qualquer erro não tratado vira JSON com o status certo
// em vez de derrubar a conexão sem explicação (ou, pior, o processo inteiro).
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  const status = (err as { statusCode?: number })?.statusCode ?? (err as { status?: number })?.status;
  if (status === 413) {
    return void res.status(413).json({ error: 'Conteúdo grande demais para esta rota.' });
  }
  if (status && status >= 400 && status < 500) {
    // Erros do body-parser (JSON malformado etc.) são culpa do cliente.
    return void res.status(status).json({ error: 'Requisição inválida.' });
  }
  console.error('[vozza] erro não tratado:', err);
  res.status(500).json({ error: 'Algo deu errado no servidor. Tente de novo.' });
});
