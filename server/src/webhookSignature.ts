import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validação da assinatura dos webhooks do Mercado Pago.
 *
 * O MP assina cada notificação com HMAC-SHA256 sobre o manifesto
 * `id:{data.id};request-id:{x-request-id};ts:{ts};`, usando a "assinatura
 * secreta" do painel (Suas integrações → Webhooks → Configurar notificações).
 * O header `x-signature` chega como `ts=...,v1=...`.
 *
 * A validação é opcional de propósito: sem MP_WEBHOOK_SECRET no ambiente,
 * nada muda (o fluxo atual já não confia no corpo — consulta a API). Com o
 * secret configurado, notificação sem assinatura válida leva 401.
 */
export interface MpSignatureInput {
  /** Header `x-signature` (`ts=...,v1=...`). */
  xSignature: string | undefined;
  /** Header `x-request-id`. */
  xRequestId: string | undefined;
  /** `data.id` do corpo da notificação. */
  dataId: string | undefined;
}

export function isMpSignatureCheckEnabled(): boolean {
  return Boolean(process.env.MP_WEBHOOK_SECRET);
}

export function isValidMpSignature(
  input: MpSignatureInput,
  secret = process.env.MP_WEBHOOK_SECRET || '',
): boolean {
  if (!secret) return false;
  const { xSignature, xRequestId, dataId } = input;
  if (!xSignature || !xRequestId || !dataId) return false;

  const parts: Record<string, string> = {};
  for (const piece of xSignature.split(',')) {
    const eq = piece.indexOf('=');
    if (eq > 0) parts[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
  }
  const { ts, v1 } = parts;
  if (!ts || !v1) return false;

  // O manifesto usa o data.id em minúsculas quando for alfanumérico (doc do MP).
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');

  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(v1).digest();
  return timingSafeEqual(a, b);
}
