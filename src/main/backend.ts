export const API_BASE = 'https://vozzai-production.up.railway.app';

export interface AuthResult {
  token: string;
  email?: string;
  error?: string;
}

export async function signup(email: string, password: string): Promise<AuthResult> {
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { token?: string; email?: string; error?: string };
  if (!res.ok) return { token: '', error: data.error || 'Não foi possível criar a conta.' };
  return { token: data.token as string, email: data.email };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok) return { token: '', error: data.error || 'E-mail ou senha incorretos.' };
  return { token: data.token as string, email };
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
  usage: UsageStatus;
}

export async function fetchMe(token: string): Promise<MeResult | null> {
  const res = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return (await res.json()) as MeResult;
}

export async function transcribeViaBackend(
  token: string,
  audioBase64: string,
  language: string,
): Promise<{ text?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ audio: audioBase64, language }),
  });
  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) return { error: data.error || 'Não consegui transcrever agora.' };
  return { text: data.text };
}
