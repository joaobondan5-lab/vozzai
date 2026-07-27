/**
 * Integração com o Checkout hospedado da Asaas — usado especificamente pelo
 * Pix Automático, que o Mercado Pago ainda não libera pra esta conta (ver
 * mercadopago.ts). O checkout já pede o CPF do pagador na própria página
 * deles; não precisamos coletar isso no cadastro.
 */
const PRICE_BRL = 29.9;

function token(): string {
  return process.env.ASAAS_ACCESS_TOKEN || '';
}

// Chave de sandbox sempre começa com $aact_hmlg_ — assim como o TEST- do
// Mercado Pago, isso evita cobrar alguém de verdade sem querer.
function apiBase(): string {
  return token().startsWith('$aact_hmlg_') ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
}

function headers(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'User-Agent': 'VozzAI',
    access_token: token(),
  };
}

interface CheckoutCreated {
  id: string;
  link?: string;
  status?: string;
}

export async function createCheckout(userId: number, email: string): Promise<string> {
  if (!token()) throw new Error('ASAAS_ACCESS_TOKEN não configurado no servidor.');

  const appUrl = process.env.APP_URL || 'https://vozzai.vercel.app';

  const res = await fetch(`${apiBase()}/checkouts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      chargeTypes: ['RECURRENT'],
      billingTypes: ['PIX', 'CREDIT_CARD'],
      minutesToExpire: 60,
      externalReference: String(userId),
      customerData: { email },
      callback: {
        successUrl: `${appUrl}/assinatura-confirmada.html`,
        cancelUrl: `${appUrl}/#precos`,
        expiredUrl: `${appUrl}/#precos`,
      },
      items: [
        {
          name: 'VozzAI Pro — assinatura mensal',
          description: 'Ditado por voz com IA, plano Pro',
          quantity: 1,
          value: PRICE_BRL,
        },
      ],
      subscription: {
        cycle: 'MONTHLY',
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Asaas recusou criar o checkout (${res.status}): ${await res.text()}`);
  }

  const checkout = (await res.json()) as CheckoutCreated;
  if (!checkout.link) throw new Error('Asaas não retornou um link de checkout.');
  return checkout.link;
}

interface AsaasPayment {
  id: string;
  status: string; // PENDING | CONFIRMED | RECEIVED | OVERDUE | REFUNDED | ...
  externalReference?: string;
  subscription?: string;
}

interface WebhookBody {
  event?: string;
  payment?: AsaasPayment;
}

const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED']);

/** Compara o header asaas-access-token com o token que a gente mesmo configurou no painel da Asaas. */
export function isValidWebhookToken(receivedToken: string | undefined): boolean {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  return Boolean(expected) && receivedToken === expected;
}

export async function syncFromWebhook(body: WebhookBody, pool: { query: Function }): Promise<void> {
  const payment = body.payment;
  if (!payment) return;

  const userId = Number(payment.externalReference);
  if (!Number.isFinite(userId) || userId <= 0) {
    console.error(`[vozza] webhook Asaas sem externalReference válido (payment ${payment.id})`);
    return;
  }

  if (!PAID_STATUSES.has(payment.status)) return; // só nos importa quando vira pago

  await pool.query('UPDATE users SET plan = $1, mp_customer = $2 WHERE id = $3', [
    'pro',
    payment.subscription || payment.id,
    userId,
  ]);
  console.log(`[vozza] usuário ${userId} agora está no plano pro (Asaas, pagamento ${payment.status})`);
}
