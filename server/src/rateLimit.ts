/**
 * Limitador simples em memória, por IP, para rotas sensíveis (login/cadastro).
 *
 * Suficiente para uma instância única. Se um dia o servidor rodar em mais de
 * uma instância ao mesmo tempo, isso precisa virar algo compartilhado (ex.:
 * Redis) — não é o caso agora.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

// Evita crescer pra sempre: limpa entradas expiradas de tempos em tempos.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (now > entry.resetAt) attempts.delete(key);
    }
  },
  10 * 60 * 1000,
).unref();
