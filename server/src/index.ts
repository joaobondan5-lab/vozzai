import express from 'express';
import { createUser, findUserByEmail, login, userForToken, createSession, User } from './auth';
import { usageFor, recordUsage, countWords, PLANS, planOf } from './quota';
import { transcribe, cleanup } from './openai';
import { syncSubscription } from './mercadopago';

const app = express();
app.use(express.json({ limit: '25mb' }));

function bearer(req: express.Request): string | undefined {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : undefined;
}

function requireUser(req: express.Request, res: express.Response): User | null {
  const user = userForToken(bearer(req));
  if (!user) {
    res.status(401).json({ error: 'Faça login para continuar.' });
    return null;
  }
  return user;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/auth/signup', (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres.' });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
  }

  const user = createUser(email, password);
  res.status(201).json({ token: createSession(user.id), email: user.email, plan: user.plan });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Informe e-mail e senha.' });
  }
  const token = login(email, password);
  if (!token) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  res.json({ token });
});

app.get('/me', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ email: user.email, plan: user.plan, usage: usageFor(user.id, user.plan) });
});

/** O app manda o áudio; o servidor transcreve com a chave dele e cobra a cota. */
app.post('/transcribe', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { audio, language } = req.body ?? {};
  if (typeof audio !== 'string' || !audio) {
    return res.status(400).json({ error: 'Áudio ausente.' });
  }

  const status = usageFor(user.id, user.plan);
  if (status.remaining <= 0) {
    const limite = PLANS[status.plan].label;
    return res.status(402).json({
      error:
        planOf(user.plan) === 'free'
          ? `Você usou as ${status.limit.toLocaleString('pt-BR')} palavras da semana no plano ${limite}. Assine o Pro para continuar.`
          : 'Você atingiu o limite do mês. Fale com a gente para liberar mais.',
      usage: status,
    });
  }

  try {
    const { text, seconds } = await transcribe(Buffer.from(audio, 'base64'), language || 'pt');
    const finalText = await cleanup(text);
    const words = countWords(finalText);
    recordUsage(user.id, seconds, words);
    res.json({ text: finalText, usage: usageFor(user.id, user.plan) });
  } catch (err) {
    console.error('[vozza] erro na transcrição:', err);
    res.status(502).json({ error: 'Não consegui transcrever agora. Tente de novo.' });
  }
});

/**
 * Mercado Pago avisa aqui quando uma assinatura muda. Nunca confiamos no corpo
 * da notificação: consultamos a API deles para saber o estado real.
 */
app.post('/webhooks/mercadopago', async (req, res) => {
  res.status(200).json({ received: true }); // responde rápido; processa depois
  try {
    await syncSubscription(req.body);
  } catch (err) {
    console.error('[vozza] webhook Mercado Pago falhou:', err);
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`[vozza] servidor ouvindo na porta ${port}`));
