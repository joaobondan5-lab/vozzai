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

/** Página estática mínima: pede o token uma vez, guarda em localStorage e mostra cards. */
export const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>VozzAI — Métricas</title>
<style>
  :root { --bg:#0B0C10; --surface:#15171E; --line:#262A33; --ink:#EFEFEC; --muted:#9CA2AE; --accent:#7089FF; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:32px 20px; }
  .wrap { max-width:860px; margin:0 auto; }
  h1 { font-size:22px; letter-spacing:-0.02em; display:flex; justify-content:space-between; align-items:baseline; }
  h1 button { font:inherit; font-size:13px; background:none; border:1px solid var(--line); color:var(--muted); border-radius:8px; padding:6px 12px; cursor:pointer; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:14px; margin-top:24px; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:18px; }
  .card .v { font-size:28px; font-weight:700; letter-spacing:-0.03em; }
  .card .v.hi { color:var(--accent); }
  .card .l { font-size:12.5px; color:var(--muted); margin-top:6px; }
  .msg { color:var(--muted); margin-top:24px; }
  form { margin-top:24px; display:flex; gap:10px; }
  input { flex:1; font:inherit; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--surface); color:var(--ink); }
  form button { font:inherit; font-weight:650; padding:11px 18px; border-radius:10px; border:none; background:var(--accent); color:var(--bg); cursor:pointer; }
</style>
</head>
<body>
<div class="wrap">
  <h1>VozzAI — Métricas <button id="logout" style="display:none">Sair</button></h1>
  <form id="tokenForm" style="display:none">
    <input id="tokenInput" type="password" placeholder="Token de admin" autocomplete="off" />
    <button type="submit">Entrar</button>
  </form>
  <p class="msg" id="msg"></p>
  <div class="grid" id="grid"></div>
</div>
<script>
(function () {
  var KEY = 'vozzai_admin_token';
  var form = document.getElementById('tokenForm');
  var msg = document.getElementById('msg');
  var grid = document.getElementById('grid');
  var logout = document.getElementById('logout');

  function askToken(text) {
    form.style.display = 'flex';
    logout.style.display = 'none';
    grid.innerHTML = '';
    msg.textContent = text || '';
  }

  function card(value, label, hi) {
    return '<div class="card"><div class="v' + (hi ? ' hi' : '') + '">' + value + '</div><div class="l">' + label + '</div></div>';
  }

  function load() {
    var token = localStorage.getItem(KEY);
    if (!token) return askToken('');
    msg.textContent = 'Carregando…';
    fetch('/admin/metrics', { headers: { 'x-admin-token': token } })
      .then(function (res) {
        if (res.status === 401) { localStorage.removeItem(KEY); return askToken('Token inválido — tenta de novo.'); }
        if (!res.ok) { msg.textContent = 'Erro ao carregar (' + res.status + ').'; return; }
        return res.json().then(function (m) {
          form.style.display = 'none';
          logout.style.display = 'inline-block';
          msg.textContent = 'Atualizado agora · só números agregados, nenhum dado pessoal.';
          grid.innerHTML =
            card(m.mrrFormatted, 'MRR estimado', true) +
            card(m.proUsers, 'Assinantes Pro', true) +
            card(m.totalUsers, 'Usuários no total') +
            card(m.freeUsers, 'No plano grátis') +
            card(m.signups7d, 'Cadastros — 7 dias') +
            card(m.signups30d, 'Cadastros — 30 dias') +
            card(m.activeUsers7d, 'Usuários ativos — 7 dias') +
            card(m.dictations7d, 'Ditados — 7 dias') +
            card(m.words7d.toLocaleString('pt-BR'), 'Palavras — 7 dias') +
            card(m.words30d.toLocaleString('pt-BR'), 'Palavras — 30 dias') +
            card(m.waitlistCount, 'Lista de espera');
        });
      })
      .catch(function () { msg.textContent = 'Não consegui falar com o servidor.'; });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = document.getElementById('tokenInput').value.trim();
    if (!v) return;
    localStorage.setItem(KEY, v);
    load();
  });
  logout.addEventListener('click', function () { localStorage.removeItem(KEY); askToken(''); });

  load();
})();
</script>
</body>
</html>`;
