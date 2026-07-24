import { db } from './db';

/**
 * Integração com assinaturas (preapproval) do Mercado Pago.
 *
 * ATENÇÃO: este módulo ainda não foi testado contra a API real — falta a conta
 * do Mercado Pago configurada. O fluxo está escrito conforme a documentação de
 * preapproval, mas precisa ser validado em sandbox antes de cobrar alguém.
 */
const TOKEN = () => process.env.MP_ACCESS_TOKEN || '';

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

export async function syncSubscription(notification: Notification): Promise<void> {
  const id = notification?.data?.id;
  if (!id) return;
  // Só assinaturas interessam aqui; pagamentos avulsos têm outro fluxo.
  if (notification.type && !notification.type.includes('preapproval')) return;

  const sub = await fetchPreapproval(id);
  if (!sub) return;

  // external_reference é onde guardamos o id do usuário ao criar a assinatura.
  const userId = Number(sub.external_reference);
  const user = Number.isFinite(userId) && userId > 0
    ? (db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: number } | undefined)
    : (db.prepare('SELECT id FROM users WHERE email = ?').get(sub.payer_email ?? '') as { id: number } | undefined);

  if (!user) {
    console.error(`[vozza] assinatura ${id} sem usuário correspondente`);
    return;
  }

  const plan = sub.status === 'authorized' ? 'pro' : 'free';
  db.prepare('UPDATE users SET plan = ?, mp_customer = ? WHERE id = ?').run(plan, sub.id, user.id);
  console.log(`[vozza] usuário ${user.id} agora está no plano ${plan} (assinatura ${sub.status})`);
}
