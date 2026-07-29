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

export function isRateLimited(key: string, max = MAX_ATTEMPTS): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > max;
}

/** Só para testes: zera as janelas para um teste não contaminar o seguinte. */
export function resetRateLimits(): void {
  attempts.clear();
}

/**
 * IP de quem realmente chamou, atrás do proxy do Railway.
 *
 * `req.ip` sozinho devolve o endereço do PROXY — o mesmo para todo mundo —
 * o que transformava cada limite "por IP" num balde único e global: 11
 * tentativas de login erradas de qualquer pessoa bloqueavam o cadastro e o
 * login de TODOS os usuários por 15 minutos. Um DoS de 11 requisições.
 *
 * Usa a ÚLTIMA entrada de `X-Forwarded-For` de propósito, e não a primeira.
 * O proxy acrescenta ao fim da lista o IP que ele mesmo enxergou, então essa
 * é a única entrada que o cliente não consegue forjar — quem mandar um
 * `X-Forwarded-For` próprio só injeta lixo ANTES dela. Confiar na primeira
 * entrada (o que `trust proxy` faria) deixaria qualquer um trocar de "IP" a
 * cada requisição e escapar do limite.
 */
export function clientIp(forwardedFor: string | undefined, socketIp: string | undefined): string {
  const chain = (forwardedFor || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return chain[chain.length - 1] || socketIp || 'desconhecido';
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
