/**
 * E-mails transacionais via Resend (https://resend.com), por HTTP direto —
 * sem SDK, mesmo padrão da integração com o Mercado Pago.
 *
 * Regra de ouro: e-mail NUNCA quebra o fluxo que o disparou. Sem
 * RESEND_API_KEY, ou com a API fora do ar, o envio vira um log e a vida
 * segue — cadastro e webhooks não podem falhar por causa de e-mail.
 *
 * Enquanto o domínio vozzai.com.br não estiver verificado no painel do
 * Resend, use EMAIL_FROM com o remetente de teste deles (onboarding@resend.dev),
 * que só entrega para o dono da conta — bom para validar, inútil em produção.
 */

const RESEND_URL = 'https://api.resend.com/emails';
const WHATSAPP_URL = 'https://wa.me/5551980902571';

function apiKey(): string {
  return process.env.RESEND_API_KEY || '';
}

function from(): string {
  return process.env.EMAIL_FROM || 'VozzAI <onboarding@resend.dev>';
}

export interface SendResult {
  sent: boolean;
  reason?: string;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  if (!apiKey()) {
    console.log(`[vozza] e-mail pulado (sem RESEND_API_KEY): "${subject}" para ${to}`);
    return { sent: false, reason: 'RESEND_API_KEY não configurada' };
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: from(), to: [to], subject, html }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[vozza] Resend recusou (${res.status}): ${body}`);
      return { sent: false, reason: `Resend ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('[vozza] falha ao enviar e-mail:', err);
    return { sent: false, reason: String(err) };
  }
}

/* ============ Templates ============ */

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#F1F0EC;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:36px 24px;">
    <div style="font-size:22px;font-weight:700;letter-spacing:-0.4px;color:#111319;margin-bottom:26px;">VozzAI</div>
    <div style="background:#FFFFFF;border:1px solid #DBD9D2;border-radius:16px;padding:28px 26px;">
      <h1 style="margin:0 0 14px;font-size:20px;letter-spacing:-0.3px;color:#111319;">${title}</h1>
      ${bodyHtml}
    </div>
    <p style="font-size:12px;color:#8B909B;margin-top:20px;line-height:1.5;">
      Você recebeu este e-mail porque tem uma conta no VozzAI (vozzai.com.br).<br>
      Dúvidas? <a href="${WHATSAPP_URL}" style="color:#1B34C4;">Chama no WhatsApp</a>.
    </p>
  </div>
</body>
</html>`;
}

const P_STYLE = 'margin:0 0 14px;font-size:15px;line-height:1.6;color:#5B606B;';
const BTN_STYLE =
  'display:inline-block;padding:12px 22px;border-radius:999px;background:#1B34C4;color:#FFFFFF;' +
  'text-decoration:none;font-weight:600;font-size:14px;margin-top:6px;';

export function sendWelcomeEmail(to: string): Promise<SendResult> {
  return sendEmail(
    to,
    'Bem-vindo ao VozzAI — seu primeiro ditado em 2 minutos',
    layout(
      'Bem-vindo ao VozzAI 👋',
      `<p style="${P_STYLE}">Sua conta está pronta. Do que você precisa pra começar:</p>
       <p style="${P_STYLE}"><strong style="color:#111319;">1.</strong> Abra o VozzAI no Mac (ícone 🎙️ na barra de menu)<br>
       <strong style="color:#111319;">2.</strong> Clique em qualquer campo de texto e aperte <strong style="color:#111319;">⌘ ⇧ Espaço</strong><br>
       <strong style="color:#111319;">3.</strong> Fale do seu jeito — o texto aparece pronto, pontuado, no tom certo</p>
       <p style="${P_STYLE}">Seu plano grátis renova <strong style="color:#111319;">2.000 palavras toda semana</strong>, sem cartão. E no menu da barra você troca o modo de escrita: WhatsApp, E-mail, Objetivo…</p>
       <a href="${WHATSAPP_URL}" style="${BTN_STYLE}">Precisa de ajuda? WhatsApp</a>`,
    ),
  );
}

export function sendProActivatedEmail(to: string): Promise<SendResult> {
  return sendEmail(
    to,
    'Seu VozzAI Pro está ativo ✓',
    layout(
      'Pagamento confirmado — Pro ativo',
      `<p style="${P_STYLE}">Obrigado por assinar! Seu plano Pro já está valendo, sem precisar fazer nada no app:</p>
       <p style="${P_STYLE}">• <strong style="color:#111319;">120.000 palavras por mês</strong> (≈ 13 horas de fala)<br>
       • Todos os 10 modos de escrita, incluindo Jurídico e Desenvolvedor<br>
       • Tom de escrita e dicionário pessoal</p>
       <p style="${P_STYLE}">A cobrança é mensal e você pode cancelar quando quiser — pela sua conta no Mercado Pago ou falando com a gente.</p>
       <a href="${WHATSAPP_URL}" style="${BTN_STYLE}">Qualquer coisa, WhatsApp</a>`,
    ),
  );
}

export function sendProEndedEmail(to: string): Promise<SendResult> {
  return sendEmail(
    to,
    'Seu VozzAI Pro foi encerrado',
    layout(
      'Seu plano Pro foi encerrado',
      `<p style="${P_STYLE}">A assinatura Pro desta conta não está mais ativa — pode ter sido um cancelamento seu ou um problema com o cartão na renovação.</p>
       <p style="${P_STYLE}">Sua conta continua funcionando no plano grátis (2.000 palavras por semana), e nada do que você configurou se perde: dicionário, tom e histórico ficam guardados.</p>
       <p style="${P_STYLE}"><strong style="color:#111319;">Foi sem querer?</strong> É só assinar de novo dentro do app (Configurações → Assinar Pro). Se acha que isso é um erro, me chama que resolvemos rápido.</p>
       <a href="${WHATSAPP_URL}" style="${BTN_STYLE}">Falar com a gente</a>`,
    ),
  );
}
