import type express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pool } from './db';

/**
 * Métricas internas do negócio, protegidas por um token estático em env.
 * Fail-closed: sem ADMIN_TOKEN configurado, a rota nem responde dados.
 * Só números agregados — nunca e-mail, texto ditado ou qualquer dado pessoal.
 */

const PRO_PRICE_CENTS = 2990;

function tokenMatches(candidate: string, expected: string): boolean {
  // sha256 dos dois lados iguala o tamanho, permitindo timingSafeEqual.
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function requireAdmin(req: express.Request, res: express.Response): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'Painel não configurado neste ambiente.' });
    return false;
  }
  const candidate = req.header('x-admin-token') || '';
  if (!candidate || !tokenMatches(candidate, expected)) {
    res.status(401).json({ error: 'Token inválido.' });
    return false;
  }
  return true;
}

export interface Metrics {
  totalUsers: number;
  freeUsers: number;
  proUsers: number;
  mrrCents: number;
  mrrFormatted: string;
  signups7d: number;
  signups30d: number;
  waitlistCount: number;
  words7d: number;
  words30d: number;
  dictations7d: number;
  activeUsers7d: number;
}

export async function collectMetrics(): Promise<Metrics> {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS total_users,
      (SELECT COUNT(*)::int FROM users WHERE plan = 'pro') AS pro_users,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= now() - interval '7 days') AS signups_7d,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= now() - interval '30 days') AS signups_30d,
      (SELECT COUNT(*)::int FROM waitlist) AS waitlist_count,
      (SELECT COALESCE(SUM(words), 0)::int FROM usage WHERE created_at >= now() - interval '7 days') AS words_7d,
      (SELECT COALESCE(SUM(words), 0)::int FROM usage WHERE created_at >= now() - interval '30 days') AS words_30d,
      (SELECT COUNT(*)::int FROM usage WHERE created_at >= now() - interval '7 days') AS dictations_7d,
      (SELECT COUNT(DISTINCT user_id)::int FROM usage WHERE created_at >= now() - interval '7 days') AS active_users_7d
  `);
  const r = rows[0];
  const mrrCents = r.pro_users * PRO_PRICE_CENTS;
  return {
    totalUsers: r.total_users,
    freeUsers: r.total_users - r.pro_users,
    proUsers: r.pro_users,
    mrrCents,
    mrrFormatted: (mrrCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    signups7d: r.signups_7d,
    signups30d: r.signups_30d,
    waitlistCount: r.waitlist_count,
    words7d: r.words_7d,
    words30d: r.words_30d,
    dictations7d: r.dictations_7d,
    activeUsers7d: r.active_users_7d,
  };
}

export interface LeadUser {
  email: string;
  plan: string;
  createdAt: string;
  lastDictationAt: string | null;
  words30d: number;
}

export interface LeadWaitlist {
  email: string;
  createdAt: string;
}

export interface Leads {
  users: LeadUser[];
  waitlist: LeadWaitlist[];
}

/**
 * Diferente de collectMetrics (só agregados), aqui tem PII de propósito:
 * é a lista de contato para outreach. Vive numa rota separada para a
 * fronteira ficar explícita — métricas nunca vazam e-mail, leads sempre têm.
 */
export async function collectLeads(): Promise<Leads> {
  const users = await pool.query<{
    email: string;
    plan: string;
    created_at: string;
    last_dictation_at: string | null;
    words_30d: number;
  }>(`
    SELECT u.email, u.plan, u.created_at,
           MAX(us.created_at) AS last_dictation_at,
           COALESCE(SUM(us.words) FILTER (WHERE us.created_at >= now() - interval '30 days'), 0)::int AS words_30d
      FROM users u
      LEFT JOIN usage us ON us.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT 500
  `);

  const waitlist = await pool.query<{ email: string; created_at: string }>(
    'SELECT email, created_at FROM waitlist ORDER BY created_at DESC LIMIT 500',
  );

  return {
    users: users.rows.map((r) => ({
      email: r.email,
      plan: r.plan,
      createdAt: r.created_at,
      lastDictationAt: r.last_dictation_at,
      words30d: r.words_30d,
    })),
    waitlist: waitlist.rows.map((r) => ({ email: r.email, createdAt: r.created_at })),
  };
}

// A página do painel vive em adminPage.ts — HTML grande num arquivo só dele,
// para este ficar sobre dados e autorização.
export { ADMIN_PAGE } from './adminPage';
