import { pool } from './db';
import { sendProActivatedEmail, sendProEndedEmail } from './email';

/** Integração com assinaturas (preapproval) do Mercado Pago. */
const TOKEN = () => process.env.MP_ACCESS_TOKEN || '';
const PRICE_BRL = 29.9;

interface PreapprovalCreated {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
}

/**
 * Cria uma assinatura "pendente" e devolve o link de checkout do Mercado
 * Pago pro usuário preencher o cartão. Nada é cobrado até ele confirmar lá.
 */
export async function createSubscription(userId: number, email: string): Promise<string> {
  if (!TOKEN()) throw new Error('MP_ACCESS_TOKEN não configurado no servidor.');

  const res = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      reason: 'VozzAI Pro — assinatura mensal',
      external_reference: String(userId),
      payer_email: email,
      back_url: process.env.APP_URL || 'https://vozzai.vercel.app',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: PRICE_BRL,
        currency_id: 'BRL',
      },
      status: 'pending',
    }),
  });

  if (!res.ok) {
    throw new Error(`Mercado Pago recusou criar a assinatura (${res.status}): ${await res.text()}`);
  }

  const sub = (await res.json()) as PreapprovalCreated;
  // Com token de teste (TEST-...), o checkout de sandbox é o único que funciona de verdade.
  const checkoutUrl = TOKEN().startsWith('TEST-')
    ? sub.sandbox_init_point ?? sub.init_point
    : sub.init_point;

  if (!checkoutUrl) throw new Error('Mercado Pago não retornou um link de checkout.');
  return checkoutUrl;
}

interface Notification {
  type?: string;
  action?: string;
  data?: { id?: string };
}

interface Preapproval {
  id: string;
  status: string; // authorized | paused | cancelled | pending
  payer_email?: string;
  external_reference?: string;
}

/** Busca o estado real da assinatura na API do Mercado Pago. */
async function fetchPreapproval(id: string): Promise<Preapproval | null> {
  if (!TOKEN()) throw new Error('MP_ACCESS_TOKEN não configurado.');

  const res = await fetch(`https://api.mercadopago.com/preapproval/${id}`, {
    headers: { Authorization: `Bearer ${TOKEN()}` },
  });
  if (!res.ok) {
    console.error(`[vozza] Mercado Pago respondeu ${res.status} para preapproval ${id}`);
    return null;
  }
  return (await res.json()) as Preapproval;
}

/** Aplica o estado real de uma assinatura MP ao usuário dono dela. Compartilhado
 * pelo webhook (evento único) e pela reconciliação periódica (varredura). */
async function applySubscriptionStatus(sub: Preapproval): Promise<void> {
  // external_reference é onde guardamos o id do usuário ao criar a assinatura.
  const userId = Number(sub.external_reference);
  const byId = Number.isFinite(userId) && userId > 0;

  const result = await pool.query<{ id: number; plan: string; email: string }>(
    byId
      ? 'SELECT id, plan, email FROM users WHERE id = $1'
      : 'SELECT id, plan, email FROM users WHERE email = $1',
    [byId ? userId : (sub.payer_email ?? '')],
  );
  const user = result.rows[0];

  if (!user) {
    console.error(`[vozza] assinatura ${sub.id} sem usuário correspondente`);
    return;
  }

  const plan = sub.status === 'authorized' ? 'pro' : 'free';
  if (user.plan === plan) return; // já está correto — evita update e log à toa

  await pool.query('UPDATE users SET plan = $1, mp_customer = $2 WHERE id = $3', [
    plan,
    sub.id,
    user.id,
  ]);
  console.log(`[vozza] usuário ${user.id} agora está no plano ${plan} (assinatura ${sub.status})`);

  // sendEmail nunca lança — falha de e-mail não pode quebrar webhook/reconciliação.
  if (plan === 'pro') await sendProActivatedEmail(user.email);
  else if (user.plan === 'pro') await sendProEndedEmail(user.email);
}

export async function syncSubscription(notification: Notification): Promise<void> {
  const id = notification?.data?.id;
  if (!id) return;
  // Só assinaturas interessam aqui; pagamentos avulsos têm outro fluxo.
  if (notification.type && !notification.type.includes('preapproval')) return;

  const sub = await fetchPreapproval(id);
  if (!sub) return;
  await applySubscriptionStatus(sub);
}

/**
 * Rede de segurança para quando o webhook nunca chega (Railway fora do ar no
 * instante da notificação, falha transitória na API do MP etc.): varre todo
 * mundo com assinatura MP conhecida e resincroniza o plano com o estado real.
 * Uma falha numa assinatura não derruba as outras — cada uma é isolada.
 */
export async function reconcileAllSubscriptions(): Promise<{ checked: number; failed: number }> {
  const { rows } = await pool.query<{ mp_customer: string }>(
    'SELECT DISTINCT mp_customer FROM users WHERE mp_customer IS NOT NULL',
  );

  let failed = 0;
  for (const row of rows) {
    try {
      const sub = await fetchPreapproval(row.mp_customer);
      if (sub) await applySubscriptionStatus(sub);
    } catch (err) {
      failed++;
      console.error(`[vozza] reconciliação MP falhou para ${row.mp_customer}:`, err);
    }
  }
  return { checked: rows.length, failed };
}
