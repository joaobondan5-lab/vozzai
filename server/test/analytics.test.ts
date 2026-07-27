import { beforeEach, describe, expect, it } from 'vitest';
import { pool, initSchema } from '../src/db';
import { flushEvents } from '../src/events';
import {
  collectDashboard,
  estimatedCostCents,
  getFunnel,
  getOverview,
  getRetention,
  getSegments,
} from '../src/analytics';

beforeEach(async () => {
  await initSchema();
  await flushEvents();
  await pool.query('TRUNCATE events, usage, sessions, waitlist, users RESTART IDENTITY CASCADE');
});

/** Cria um usuário com atividade sintética, com datas controladas. */
async function seedUser(opts: {
  email: string;
  plan?: string;
  daysAgo?: number;
  dictations?: number;
  wordsEach?: number;
  lastDictationDaysAgo?: number;
}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, plan, created_at)
     VALUES ($1, 'x', $2, now() - ($3 || ' days')::interval) RETURNING id`,
    [opts.email, opts.plan ?? 'free', String(opts.daysAgo ?? 0)],
  );
  const id = rows[0].id;
  const n = opts.dictations ?? 0;
  for (let i = 0; i < n; i++) {
    await pool.query(
      `INSERT INTO usage (user_id, seconds, words, created_at)
       VALUES ($1, 0, $2, now() - ($3 || ' days')::interval)`,
      [id, opts.wordsEach ?? 50, String(opts.lastDictationDaysAgo ?? 0)],
    );
  }
  return id;
}

describe('custo estimado', () => {
  it('é zero sem uso e cresce com as palavras', () => {
    expect(estimatedCostCents(0, 0)).toBe(0);
    const pequeno = estimatedCostCents(100, 2);
    const grande = estimatedCostCents(10_000, 100);
    expect(pequeno).toBeGreaterThan(0);
    expect(grande).toBeGreaterThan(pequeno);
  });

  it('fica numa ordem de grandeza plausível (centavos por ditado normal)', () => {
    // 100 palavras ≈ 40 segundos de fala: deve custar bem menos de R$ 0,50.
    const cents = estimatedCostCents(100, 1);
    expect(cents).toBeLessThan(50);
  });
});

describe('visão geral', () => {
  it('não quebra com banco vazio e devolve zeros coerentes', async () => {
    const o = await getOverview();
    expect(o.totalUsers).toBe(0);
    expect(o.mrrCents).toBe(0);
    expect(o.activationRate).toBe(0);
    expect(o.grossMarginPct).toBeNull(); // sem receita, margem não existe
    expect(o.dictationsPerActiveUser7d).toBe(0);
  });

  it('calcula ativação, conversão e MRR a partir do uso real', async () => {
    await seedUser({ email: 'ativo@t.com', dictations: 4 });
    await seedUser({ email: 'pagante@t.com', plan: 'pro', dictations: 2 });
    await seedUser({ email: 'fantasma@t.com', dictations: 0 });

    const o = await getOverview();
    expect(o.totalUsers).toBe(3);
    expect(o.proUsers).toBe(1);
    expect(o.freeUsers).toBe(2);
    expect(o.mrrCents).toBe(2990);
    expect(o.arrCents).toBe(2990 * 12);
    expect(o.activationRate).toBeCloseTo(2 / 3); // 2 dos 3 ditaram
    expect(o.conversionRate).toBeCloseTo(1 / 3);
    expect(o.dictations7d).toBe(6);
    expect(o.activeUsers7d).toBe(2);
    expect(o.dictationsPerActiveUser7d).toBe(3);
  });
});

describe('funil', () => {
  it('mostra a queda entre cadastro, 1º ditado, hábito e Pro', async () => {
    await seedUser({ email: 'a@t.com', dictations: 0 }); // parou no cadastro
    await seedUser({ email: 'b@t.com', dictations: 1 }); // ativou e parou
    await seedUser({ email: 'c@t.com', dictations: 3 }); // criou hábito
    await seedUser({ email: 'd@t.com', plan: 'pro', dictations: 12 }); // engajado e pagante

    const f = await getFunnel();
    const by = Object.fromEntries(f.map((s) => [s.key, s]));

    expect(by.signup.count).toBe(4);
    expect(by.first.count).toBe(3);
    expect(by.habit.count).toBe(2);
    expect(by.power.count).toBe(1);
    expect(by.paid.count).toBe(1);

    // percentuais relativos ao topo e ao passo anterior
    expect(by.first.pctOfTop).toBeCloseTo(3 / 4);
    expect(by.habit.pctOfPrev).toBeCloseTo(2 / 3);
    expect(by.signup.pctOfPrev).toBe(1);
  });

  it('não divide por zero com banco vazio', async () => {
    const f = await getFunnel();
    expect(f.every((s) => Number.isFinite(s.pctOfTop) && Number.isFinite(s.pctOfPrev))).toBe(true);
  });
});

describe('segmentos', () => {
  it('separa quem nunca ditou, quem está perto da cota, em risco e power', async () => {
    await seedUser({ email: 'nunca@t.com', dictations: 0 });
    // grátis: 2.000 palavras/semana — 1.600 é 80% da cota
    await seedUser({ email: 'quase@t.com', dictations: 2, wordsEach: 800 });
    await seedUser({ email: 'sumiu@t.com', dictations: 3, wordsEach: 30, lastDictationDaysAgo: 20 });
    await seedUser({ email: 'power@t.com', dictations: 8, wordsEach: 120 });

    const s = await getSegments();
    expect(s.neverDictated.map((u) => u.email)).toContain('nunca@t.com');
    expect(s.nearQuota.map((u) => u.email)).toContain('quase@t.com');
    expect(s.atRisk.map((u) => u.email)).toContain('sumiu@t.com');
    expect(s.power[0].email).toBe('power@t.com'); // mais palavras primeiro

    // quem nunca ditou não pode aparecer como "em risco"
    expect(s.atRisk.map((u) => u.email)).not.toContain('nunca@t.com');
    // quem usa hoje não pode aparecer como "em risco"
    expect(s.atRisk.map((u) => u.email)).not.toContain('power@t.com');
  });
});

describe('retenção', () => {
  it('roda sem quebrar e devolve coortes com tamanho', async () => {
    await seedUser({ email: 'r1@t.com', daysAgo: 10, dictations: 2, lastDictationDaysAgo: 1 });
    await seedUser({ email: 'r2@t.com', daysAgo: 10, dictations: 1, lastDictationDaysAgo: 9 });

    const cohorts = await getRetention();
    expect(cohorts.length).toBeGreaterThan(0);
    expect(cohorts[0].size).toBeGreaterThan(0);
  });
});

describe('dashboard completo', () => {
  it('monta tudo numa chamada só, sem PII nos agregados', async () => {
    await seedUser({ email: 'privado@t.com', plan: 'pro', dictations: 3 });

    const d = await collectDashboard();
    expect(d.overview.totalUsers).toBe(1);
    expect(d.series).toHaveLength(30); // 30 dias, com zeros preenchidos
    expect(Array.isArray(d.funnel)).toBe(true);
    expect(d.generatedAt).toBeTruthy();

    // segmentos e assinantes têm e-mail de propósito (é a lista de contato),
    // mas os agregados de visão geral não podem carregar PII nenhuma.
    expect(JSON.stringify(d.overview)).not.toContain('privado@t.com');
    expect(JSON.stringify(d.series)).not.toContain('privado@t.com');
  });
});
