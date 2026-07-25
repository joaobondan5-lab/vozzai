import { pool } from './db';

/**
 * Limites por plano, em palavras.
 *
 * O plano Pro tem um teto alto em vez de "ilimitado" de verdade: cada minuto
 * ditado custa API, então um teto protege a margem sem incomodar quem usa
 * normalmente. 120.000 palavras/mês ≈ 13 horas de fala.
 */
export const PLANS = {
  free: { label: 'Grátis', words: 2_000, period: 'week' as const },
  pro: { label: 'Pro', words: 120_000, period: 'month' as const },
};

export type PlanName = keyof typeof PLANS;

export function planOf(name: string): PlanName {
  return name === 'pro' ? 'pro' : 'free';
}

export interface UsageStatus {
  plan: PlanName;
  used: number;
  limit: number;
  remaining: number;
  period: 'week' | 'month';
}

export async function usageFor(userId: number, planName: string): Promise<UsageStatus> {
  const plan = planOf(planName);
  const { words: limit, period } = PLANS[plan];
  const since = period === 'week' ? "now() - interval '7 days'" : "date_trunc('month', now())";

  const result = await pool.query<{ used: string }>(
    `SELECT COALESCE(SUM(words), 0) AS used FROM usage WHERE user_id = $1 AND created_at >= ${since}`,
    [userId],
  );

  const used = Number(result.rows[0].used);
  return { plan, used, limit, remaining: Math.max(0, limit - used), period };
}

export async function recordUsage(userId: number, seconds: number, words: number): Promise<void> {
  await pool.query('INSERT INTO usage (user_id, seconds, words) VALUES ($1, $2, $3)', [
    userId,
    seconds,
    words,
  ]);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
