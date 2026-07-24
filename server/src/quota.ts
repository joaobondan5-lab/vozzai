import { db } from './db';

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

export function usageFor(userId: number, planName: string): UsageStatus {
  const plan = planOf(planName);
  const { words: limit, period } = PLANS[plan];
  const since = period === 'week' ? "datetime('now', '-7 days')" : "datetime('now', 'start of month')";

  const row = db
    .prepare(`SELECT COALESCE(SUM(words), 0) AS used FROM usage WHERE user_id = ? AND created_at >= ${since}`)
    .get(userId) as { used: number };

  const used = Number(row.used);
  return { plan, used, limit, remaining: Math.max(0, limit - used), period };
}

export function recordUsage(userId: number, seconds: number, words: number): void {
  db.prepare('INSERT INTO usage (user_id, seconds, words) VALUES (?, ?, ?)').run(userId, seconds, words);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
