import { pool } from './db';
import { PLANS } from './quota';

/**
 * Analytics do negócio para o /admin.
 *
 * Tudo aqui é derivado do banco em tempo real — não existe pipeline nem job
 * de agregação. Com o volume atual (dezenas de usuários) isso é de longe o
 * mais simples e sempre correto; se um dia virar lento, o caminho é
 * materializar as views, não complicar agora.
 */

const PRO_MONTHLY_CENTS = 2990;
const PRO_ANNUAL_CENTS = 24900;

/**
 * Custo estimado da OpenAI por ditado.
 *
 * Cuidado com a precisão: o whisper-1 não devolve a duração no `usage`, então
 * `usage.seconds` fica 0 no banco. Estimamos o tempo de fala a partir das
 * palavras (~150 ppm é a média de fala em português). É estimativa, e o painel
 * diz isso — serve para ordem de grandeza e margem, não para contabilidade.
 */
const WORDS_PER_MINUTE = 150;
const WHISPER_USD_PER_MINUTE = 0.006;
const GPT_USD_PER_1M_INPUT = 0.15;
const GPT_USD_PER_1M_OUTPUT = 0.6;
const TOKENS_PER_WORD = 1.5; // português gasta mais token por palavra que inglês
const PROMPT_OVERHEAD_TOKENS = 220; // instrução do modo + dicionário, aproximado
const USD_TO_BRL = Number(process.env.USD_BRL_RATE || 5.4);

export function estimatedCostCents(words: number, dictations: number): number {
  if (words <= 0 && dictations <= 0) return 0;
  const minutes = words / WORDS_PER_MINUTE;
  const whisper = minutes * WHISPER_USD_PER_MINUTE;
  const inputTokens = words * TOKENS_PER_WORD + PROMPT_OVERHEAD_TOKENS * dictations;
  const outputTokens = words * TOKENS_PER_WORD;
  const gpt =
    (inputTokens / 1_000_000) * GPT_USD_PER_1M_INPUT +
    (outputTokens / 1_000_000) * GPT_USD_PER_1M_OUTPUT;
  return Math.round((whisper + gpt) * USD_TO_BRL * 100);
}

export const brl = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ============================ Visão geral ============================ */

export interface Overview {
  totalUsers: number;
  proUsers: number;
  freeUsers: number;
  mrrCents: number;
  arrCents: number;
  signupsToday: number;
  signups7d: number;
  signups30d: number;
  signupsPrev7d: number;
  activeUsers7d: number;
  activeUsers30d: number;
  dictations7d: number;
  dictations30d: number;
  words7d: number;
  words30d: number;
  waitlistCount: number;
  /** Quem já ditou pelo menos uma vez / total de contas. */
  activationRate: number;
  /** Assinantes Pro / total de contas. */
  conversionRate: number;
  costCents7d: number;
  costCents30d: number;
  grossMarginPct: number | null;
  /** Ditados por usuário ativo por semana — a North Star. */
  dictationsPerActiveUser7d: number;
}

export async function getOverview(): Promise<Overview> {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS total_users,
      (SELECT COUNT(*)::int FROM users WHERE plan = 'pro') AS pro_users,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= date_trunc('day', now())) AS signups_today,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= now() - interval '7 days') AS signups_7d,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= now() - interval '30 days') AS signups_30d,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= now() - interval '14 days'
                                        AND created_at <  now() - interval '7 days') AS signups_prev_7d,
      (SELECT COUNT(DISTINCT user_id)::int FROM usage WHERE created_at >= now() - interval '7 days') AS active_7d,
      (SELECT COUNT(DISTINCT user_id)::int FROM usage WHERE created_at >= now() - interval '30 days') AS active_30d,
      (SELECT COUNT(*)::int FROM usage WHERE created_at >= now() - interval '7 days') AS dictations_7d,
      (SELECT COUNT(*)::int FROM usage WHERE created_at >= now() - interval '30 days') AS dictations_30d,
      (SELECT COALESCE(SUM(words),0)::int FROM usage WHERE created_at >= now() - interval '7 days') AS words_7d,
      (SELECT COALESCE(SUM(words),0)::int FROM usage WHERE created_at >= now() - interval '30 days') AS words_30d,
      (SELECT COUNT(*)::int FROM waitlist) AS waitlist_count,
      (SELECT COUNT(DISTINCT user_id)::int FROM usage) AS ever_dictated
  `);
  const r = rows[0];

  const mrrCents = r.pro_users * PRO_MONTHLY_CENTS;
  const costCents7d = estimatedCostCents(r.words_7d, r.dictations_7d);
  const costCents30d = estimatedCostCents(r.words_30d, r.dictations_30d);
  const grossMarginPct =
    mrrCents > 0 ? Math.round(((mrrCents - costCents30d) / mrrCents) * 100) : null;

  return {
    totalUsers: r.total_users,
    proUsers: r.pro_users,
    freeUsers: r.total_users - r.pro_users,
    mrrCents,
    arrCents: mrrCents * 12,
    signupsToday: r.signups_today,
    signups7d: r.signups_7d,
    signups30d: r.signups_30d,
    signupsPrev7d: r.signups_prev_7d,
    activeUsers7d: r.active_7d,
    activeUsers30d: r.active_30d,
    dictations7d: r.dictations_7d,
    dictations30d: r.dictations_30d,
    words7d: r.words_7d,
    words30d: r.words_30d,
    waitlistCount: r.waitlist_count,
    activationRate: r.total_users > 0 ? r.ever_dictated / r.total_users : 0,
    conversionRate: r.total_users > 0 ? r.pro_users / r.total_users : 0,
    costCents7d,
    costCents30d,
    grossMarginPct,
    dictationsPerActiveUser7d: r.active_7d > 0 ? r.dictations_7d / r.active_7d : 0,
  };
}

/* ============================== Funil ============================== */

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** % em relação ao topo do funil. */
  pctOfTop: number;
  /** % que sobreviveu do passo anterior. */
  pctOfPrev: number;
  hint: string;
}

/**
 * O funil que responde "onde as pessoas pararam". Cada passo é uma condição
 * que a pessoa precisa ter cumprido em algum momento — não é sequência
 * temporal estrita, e sim quantos chegaram até ali.
 */
export async function getFunnel(): Promise<FunnelStep[]> {
  const { rows } = await pool.query(`
    WITH d AS (
      SELECT user_id, COUNT(*)::int AS n FROM usage GROUP BY user_id
    )
    SELECT
      (SELECT COUNT(*)::int FROM waitlist) AS waitlist,
      (SELECT COUNT(*)::int FROM users) AS signups,
      (SELECT COUNT(*)::int FROM d WHERE n >= 1) AS dictated_1,
      (SELECT COUNT(*)::int FROM d WHERE n >= 3) AS dictated_3,
      (SELECT COUNT(*)::int FROM d WHERE n >= 10) AS dictated_10,
      (SELECT COUNT(DISTINCT user_id)::int FROM events WHERE name = 'checkout_started') AS checkout,
      (SELECT COUNT(*)::int FROM users WHERE plan = 'pro') AS pro
  `);
  const r = rows[0];

  const raw = [
    { key: 'signup', label: 'Criou conta', count: r.signups, hint: 'Topo do funil' },
    {
      key: 'first',
      label: 'Fez o 1º ditado',
      count: r.dictated_1,
      hint: 'Ativação — provou que o produto funciona pra ela',
    },
    {
      key: 'habit',
      label: 'Chegou a 3 ditados',
      count: r.dictated_3,
      hint: 'Sinal de hábito começando',
    },
    {
      key: 'power',
      label: 'Chegou a 10 ditados',
      count: r.dictated_10,
      hint: 'Usuário engajado de verdade',
    },
    {
      key: 'checkout',
      label: 'Abriu o checkout',
      count: r.checkout,
      hint: 'Intenção de pagar (só conta a partir de hoje — evento novo)',
    },
    { key: 'paid', label: 'Virou Pro', count: r.pro, hint: 'Receita' },
  ];

  const top = raw[0].count || 1;
  return raw.map((step, i) => ({
    ...step,
    pctOfTop: step.count / top,
    pctOfPrev: i === 0 ? 1 : raw[i - 1].count > 0 ? step.count / raw[i - 1].count : 0,
  }));
}

/* ============================ Retenção ============================ */

export interface CohortRow {
  cohort: string;
  size: number;
  /** % da coorte que ditou em cada semana seguinte (0 = semana do cadastro). */
  weeks: (number | null)[];
}

/** Coortes semanais: de cada turma de cadastros, quem ainda usa nas semanas seguintes. */
export async function getRetention(): Promise<CohortRow[]> {
  const { rows } = await pool.query<{
    cohort: string;
    size: number;
    week_offset: number;
    retained: number;
  }>(`
    WITH cohorts AS (
      SELECT id, date_trunc('week', created_at) AS cohort FROM users
    ),
    sizes AS (
      SELECT cohort, COUNT(*)::int AS size FROM cohorts GROUP BY cohort
    ),
    activity AS (
      SELECT DISTINCT c.cohort,
             FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', u.created_at) - c.cohort)) / 604800)::int AS week_offset,
             c.id
        FROM cohorts c
        JOIN usage u ON u.user_id = c.id
    )
    SELECT to_char(s.cohort, 'DD/MM') AS cohort,
           s.size,
           a.week_offset,
           COUNT(DISTINCT a.id)::int AS retained
      FROM sizes s
      LEFT JOIN activity a ON a.cohort = s.cohort
     WHERE s.cohort >= now() - interval '8 weeks'
     GROUP BY s.cohort, s.size, a.week_offset
     ORDER BY s.cohort DESC
  `);

  const byCohort = new Map<string, CohortRow>();
  for (const row of rows) {
    if (!byCohort.has(row.cohort)) {
      byCohort.set(row.cohort, { cohort: row.cohort, size: row.size, weeks: [] });
    }
    const entry = byCohort.get(row.cohort)!;
    if (row.week_offset === null || row.week_offset === undefined) continue;
    while (entry.weeks.length <= row.week_offset) entry.weeks.push(null);
    entry.weeks[row.week_offset] = row.size > 0 ? row.retained / row.size : 0;
  }
  return [...byCohort.values()];
}

/* ============================ Segmentos ============================ */

export interface SegmentUser {
  email: string;
  plan: string;
  createdAt: string;
  lastDictationAt: string | null;
  dictations: number;
  words30d: number;
  quotaPct: number;
  daysSinceLast: number | null;
}

export interface Segments {
  /** Nunca ditou — o maior gargalo, e o mais acionável. */
  neverDictated: SegmentUser[];
  /** Perto do limite do plano grátis: candidatos naturais ao Pro. */
  nearQuota: SegmentUser[];
  /** Usava e sumiu — risco de churn silencioso. */
  atRisk: SegmentUser[];
  /** Os que mais usam: entrevistar, pedir depoimento, entender o valor. */
  power: SegmentUser[];
}

export async function getSegments(): Promise<Segments> {
  const { rows } = await pool.query<{
    email: string;
    plan: string;
    created_at: string;
    last_dictation_at: string | null;
    dictations: number;
    words_30d: number;
    words_window: number;
    days_since_last: number | null;
  }>(`
    SELECT u.email, u.plan, u.created_at,
           MAX(us.created_at) AS last_dictation_at,
           COUNT(us.id)::int AS dictations,
           COALESCE(SUM(us.words) FILTER (WHERE us.created_at >= now() - interval '30 days'), 0)::int AS words_30d,
           COALESCE(SUM(us.words) FILTER (
             WHERE us.created_at >= CASE WHEN u.plan = 'pro'
                                         THEN date_trunc('month', now())
                                         ELSE now() - interval '7 days' END
           ), 0)::int AS words_window,
           EXTRACT(DAY FROM now() - MAX(us.created_at))::int AS days_since_last
      FROM users u
      LEFT JOIN usage us ON us.user_id = u.id
     GROUP BY u.id
  `);

  const all: SegmentUser[] = rows.map((r) => {
    const limit = r.plan === 'pro' ? PLANS.pro.words : PLANS.free.words;
    return {
      email: r.email,
      plan: r.plan,
      createdAt: r.created_at,
      lastDictationAt: r.last_dictation_at,
      dictations: r.dictations,
      words30d: r.words_30d,
      quotaPct: limit > 0 ? Math.min(1, r.words_window / limit) : 0,
      daysSinceLast: r.days_since_last,
    };
  });

  const byWords = (a: SegmentUser, b: SegmentUser) => b.words30d - a.words30d;

  return {
    neverDictated: all
      .filter((u) => u.dictations === 0)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 50),
    nearQuota: all
      .filter((u) => u.plan !== 'pro' && u.quotaPct >= 0.6)
      .sort((a, b) => b.quotaPct - a.quotaPct)
      .slice(0, 50),
    atRisk: all
      .filter((u) => u.dictations >= 2 && (u.daysSinceLast ?? 0) >= 7)
      .sort((a, b) => (b.daysSinceLast ?? 0) - (a.daysSinceLast ?? 0))
      .slice(0, 50),
    power: all.filter((u) => u.dictations >= 3).sort(byWords).slice(0, 50),
  };
}

/* ========================= Séries e eventos ========================= */

export interface DayPoint {
  day: string;
  signups: number;
  dictations: number;
  activeUsers: number;
}

/** Série diária dos últimos 30 dias, com zeros preenchidos (senão o gráfico mente). */
export async function getDailySeries(): Promise<DayPoint[]> {
  const { rows } = await pool.query<{
    day: string;
    signups: number;
    dictations: number;
    active_users: number;
  }>(`
    WITH days AS (
      SELECT generate_series(date_trunc('day', now()) - interval '29 days',
                             date_trunc('day', now()), interval '1 day') AS day
    )
    SELECT to_char(d.day, 'DD/MM') AS day,
           (SELECT COUNT(*)::int FROM users u
             WHERE date_trunc('day', u.created_at) = d.day) AS signups,
           (SELECT COUNT(*)::int FROM usage us
             WHERE date_trunc('day', us.created_at) = d.day) AS dictations,
           (SELECT COUNT(DISTINCT us.user_id)::int FROM usage us
             WHERE date_trunc('day', us.created_at) = d.day) AS active_users
      FROM days d
     ORDER BY d.day
  `);
  return rows.map((r) => ({
    day: r.day,
    signups: r.signups,
    dictations: r.dictations,
    activeUsers: r.active_users,
  }));
}

export interface EventCount {
  name: string;
  count: number;
  users: number;
  lastAt: string | null;
}

export async function getEventCounts(): Promise<EventCount[]> {
  const { rows } = await pool.query<{
    name: string;
    count: number;
    users: number;
    last_at: string | null;
  }>(`
    SELECT name, COUNT(*)::int AS count,
           COUNT(DISTINCT user_id)::int AS users,
           MAX(created_at) AS last_at
      FROM events
     WHERE created_at >= now() - interval '30 days'
     GROUP BY name
     ORDER BY count DESC
  `);
  return rows.map((r) => ({ name: r.name, count: r.count, users: r.users, lastAt: r.last_at }));
}

export interface ErrorRow {
  code: string;
  count: number;
}

/** Erros por código, para achar o que mais quebra na mão do usuário. */
export async function getErrors(): Promise<{ rows: ErrorRow[]; failureRate: number | null }> {
  const { rows } = await pool.query<{ code: string; count: number }>(`
    SELECT COALESCE(props->>'error_code', 'desconhecido') AS code, COUNT(*)::int AS count
      FROM events
     WHERE name IN ('dictation_error', 'insertion_clipboard_only')
       AND created_at >= now() - interval '30 days'
     GROUP BY 1 ORDER BY count DESC LIMIT 15
  `);

  const totals = await pool.query<{ ok: number; err: number }>(`
    SELECT
      COUNT(*) FILTER (WHERE name = 'dictation_ok')::int AS ok,
      COUNT(*) FILTER (WHERE name = 'dictation_error')::int AS err
      FROM events WHERE created_at >= now() - interval '30 days'
  `);
  const { ok, err } = totals.rows[0];
  const total = ok + err;

  return { rows, failureRate: total > 0 ? err / total : null };
}

/* =========================== Uso por modo =========================== */

export interface ModeUsage {
  mode: string;
  count: number;
}

export async function getModeUsage(): Promise<ModeUsage[]> {
  const { rows } = await pool.query<{ mode: string; count: number }>(`
    SELECT COALESCE(props->>'mode', 'padrao') AS mode, COUNT(*)::int AS count
      FROM events
     WHERE name = 'dictation_ok' AND created_at >= now() - interval '30 days'
     GROUP BY 1 ORDER BY count DESC
  `);
  return rows;
}

/* ============================ Assinantes ============================ */

export interface Subscriber {
  email: string;
  since: string | null;
  words30d: number;
  quotaPct: number;
}

export async function getSubscribers(): Promise<Subscriber[]> {
  const { rows } = await pool.query<{
    email: string;
    since: string | null;
    words_month: number;
  }>(`
    SELECT u.email,
           (SELECT MIN(e.created_at) FROM events e
             WHERE e.user_id = u.id AND e.name = 'plan_activated') AS since,
           COALESCE(SUM(us.words) FILTER (WHERE us.created_at >= date_trunc('month', now())), 0)::int AS words_month
      FROM users u
      LEFT JOIN usage us ON us.user_id = u.id
     WHERE u.plan = 'pro'
     GROUP BY u.id
     ORDER BY u.created_at DESC
  `);
  return rows.map((r) => ({
    email: r.email,
    since: r.since,
    words30d: r.words_month,
    quotaPct: Math.min(1, r.words_month / PLANS.pro.words),
  }));
}

/** Tudo que o painel precisa, numa chamada só. */
export async function collectDashboard() {
  const [overview, funnel, retention, segments, series, events, errors, modes, subscribers] =
    await Promise.all([
      getOverview(),
      getFunnel(),
      getRetention(),
      getSegments(),
      getDailySeries(),
      getEventCounts(),
      getErrors(),
      getModeUsage(),
      getSubscribers(),
    ]);

  return {
    overview,
    funnel,
    retention,
    segments,
    series,
    events,
    errors,
    modes,
    subscribers,
    pricing: { monthlyCents: PRO_MONTHLY_CENTS, annualCents: PRO_ANNUAL_CENTS },
    generatedAt: new Date().toISOString(),
  };
}
