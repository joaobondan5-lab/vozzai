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
import { syncSubscription, createSubscription } from './mercadopago';
import { initSchema, addToWaitlist } from './db';
import { isRateLimited } from './rateLimit';

const app = express();
app.use(express.json({ limit: '25mb' }));

// CORS: a landing page e a extensão de Chrome chamam esta API a partir do
// navegador, de origens diferentes. Reflete a origem em vez de usar "*"
// porque a rota usa Authorization, e navegadores não aceitam "*" nesse caso.
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
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

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post(
  '/waitlist',
  asyncRoute(async (req, res) => {
    if (isRateLimited(`waitlist:${req.ip}`)) {
      return void res.status(429).json({ error: 'Muitas tentativas. Espere um pouco e tente de novo.' });
    }

    const { email } = req.body ?? {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

    const { audio, language } = req.body ?? {};
    if (typeof audio !== 'string' || !audio) {
      return void res.status(400).json({ error: 'Áudio ausente.' });
    }

    const status = await usageFor(user.id, user.plan);
    if (status.remaining <= 0) {
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
      const finalText = await cleanup(text, user.tone);
      const words = countWords(finalText);
      await recordUsage(user.id, seconds, words);
      res.json({ text: finalText, usage: await usageFor(user.id, user.plan) });
    } catch (err) {
      console.error('[vozza] erro na transcrição:', err);
      res.status(502).json({ error: 'Não consegui transcrever agora. Tente de novo.' });
    }
  }),
);

/** Cria a assinatura Pro no Mercado Pago e devolve o link de checkout. */
app.post(
  '/billing/subscribe',
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      const checkoutUrl = await createSubscription(user.id, user.email);
      res.json({ checkoutUrl });
    } catch (err) {
      console.error('[vozza] erro ao criar assinatura:', err);
      res.status(502).json({ error: 'Não consegui iniciar a assinatura agora. Tente de novo.' });
    }
  }),
);

/**
 * Mercado Pago avisa aqui quando uma assinatura muda. Nunca confiamos no corpo
 * da notificação: consultamos a API deles para saber o estado real.
 */
app.post('/webhooks/mercadopago', (req, res) => {
  res.status(200).json({ received: true }); // responde rápido; processa depois
  syncSubscription(req.body).catch((err) => {
    console.error('[vozza] webhook Mercado Pago falhou:', err);
  });
});

// Rede de segurança: qualquer erro não tratado vira 500 em JSON em vez de
// derrubar a conexão sem explicação (ou, pior, o processo inteiro).
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[vozza] erro não tratado:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Algo deu errado no servidor. Tente de novo.' });
});

process.on('unhandledRejection', (err) => {
  console.error('[vozza] promise rejeitada sem tratamento:', err);
});

const port = Number(process.env.PORT || 3000);

initSchema()
  .then(() => {
    app.listen(port, () => console.log(`[vozza] servidor ouvindo na porta ${port}`));
  })
  .catch((err) => {
    console.error('[vozza] falha ao preparar o banco de dados:', err);
    process.exit(1);
  });
