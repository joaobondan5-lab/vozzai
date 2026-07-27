export const API_BASE = 'https://vozzai-production.up.railway.app';

export interface AuthResult {
  token: string;
  email?: string;
  error?: string;
}

/** Um fetch que não pendura pra sempre e transforma falha de rede em erro legível. */
async function api(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
      throw new Error('O servidor demorou demais para responder. Tente de novo.');
    }
    throw new Error('Sem conexão com o servidor do VozzAI. Confira sua internet.');
  }
}

export async function signup(email: string, password: string): Promise<AuthResult> {
  try {
    const res = await api('/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }, 15_000);
    const data = (await res.json()) as { token?: string; email?: string; error?: string };
    if (!res.ok) return { token: '', error: data.error || 'Não foi possível criar a conta.' };
    return { token: data.token as string, email: data.email };
  } catch (err) {
    return { token: '', error: (err as Error).message };
  }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  try {
    const res = await api('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }, 15_000);
    const data = (await res.json()) as { token?: string; error?: string };
    if (!res.ok) return { token: '', error: data.error || 'E-mail ou senha incorretos.' };
    return { token: data.token as string, email };
  } catch (err) {
    return { token: '', error: (err as Error).message };
  }
}

export interface UsageStatus {
  used: number;
  limit: number;
  remaining: number;
  period: string;
}

export interface MeResult {
  email: string;
  plan: string;
  tone: string;
  dictionary: string;
  usage: UsageStatus;
}

export async function fetchMe(token: string): Promise<MeResult | null> {
  try {
    const res = await api('/me', { headers: { Authorization: `Bearer ${token}` } }, 15_000);
    if (!res.ok) return null;
    return (await res.json()) as MeResult;
  } catch {
    return null;
  }
}

export async function updatePreferences(
  token: string,
  partial: { tone?: string; dictionary?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await api('/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(partial),
    }, 15_000);
    const data = (await res.json()) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error || 'Não consegui salvar.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function createSubscription(
  token: string,
  cycle: 'monthly' | 'annual' = 'monthly',
): Promise<{ checkoutUrl?: string; error?: string }> {
  try {
    const res = await api('/billing/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cycle }),
    }, 20_000);
    const data = (await res.json()) as { checkoutUrl?: string; error?: string };
    if (!res.ok) return { error: data.error || 'Não consegui iniciar a assinatura.' };
    return { checkoutUrl: data.checkoutUrl };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Manda um evento de funil. Fire-and-forget de propósito: telemetria não pode
 * atrasar nem quebrar nada do ditado, e o servidor descarta o que não conhece.
 * Só nome do passo e metadados fechados — nunca o texto ditado.
 */
export function trackEvent(
  token: string,
  name: string,
  props?: Record<string, string>,
): void {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  fetch(`${API_BASE}/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, platform: 'mac', props }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    /* telemetria é best-effort: se falhar, segue a vida */
  });
}

export interface TranscribeResult {
  text?: string;
  error?: string;
  /** true = erro de rede/servidor; vale a pena tentar de novo com o mesmo áudio. */
  retryable?: boolean;
  /** true = cota do plano estourada (HTTP 402). */
  quotaExceeded?: boolean;
  usage?: UsageStatus;
}

export async function transcribeViaBackend(
  token: string,
  audioBase64: string,
  language: string,
  mode: string,
): Promise<TranscribeResult> {
  let res: Response;
  try {
    // Transcrição é a chamada longa: áudio sobe e a OpenAI processa.
    res = await api('/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ audio: audioBase64, language, mode }),
    }, 90_000);
  } catch (err) {
    return { error: (err as Error).message, retryable: true };
  }

  const data = (await res.json()) as { text?: string; error?: string; usage?: UsageStatus };
  if (res.status === 402) {
    return { error: data.error || 'Você atingiu o limite do plano.', quotaExceeded: true, usage: data.usage };
  }
  if (!res.ok) {
    return { error: data.error || 'Não consegui transcrever agora.', retryable: res.status >= 500 };
  }
  return { text: data.text, usage: data.usage };
}
