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

/** Página estática mínima: pede o token uma vez, guarda em localStorage e mostra as abas. */
export const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>VozzAI — Métricas e Leads</title>
<style>
  :root { --bg:#0B0C10; --surface:#15171E; --line:#262A33; --ink:#EFEFEC; --muted:#9CA2AE; --accent:#7089FF; --warn:#F5B646; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:32px 20px; }
  .wrap { max-width:960px; margin:0 auto; }
  h1 { font-size:22px; letter-spacing:-0.02em; display:flex; justify-content:space-between; align-items:baseline; }
  h1 button { font:inherit; font-size:13px; background:none; border:1px solid var(--line); color:var(--muted); border-radius:8px; padding:6px 12px; cursor:pointer; }
  .tabs { display:flex; gap:8px; margin-top:18px; }
  .tabs button { font:inherit; font-size:13.5px; font-weight:650; padding:8px 16px; border-radius:999px; border:1px solid var(--line); background:none; color:var(--muted); cursor:pointer; }
  .tabs button.on { background:var(--accent); border-color:var(--accent); color:var(--bg); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:14px; margin-top:24px; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:18px; }
  .card .v { font-size:28px; font-weight:700; letter-spacing:-0.03em; }
  .card .v.hi { color:var(--accent); }
  .card .l { font-size:12.5px; color:var(--muted); margin-top:6px; }
  .msg { color:var(--muted); margin-top:24px; }
  .pii { color:var(--warn); font-size:12.5px; margin-top:18px; }
  form { margin-top:24px; display:flex; gap:10px; }
  input { flex:1; font:inherit; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--surface); color:var(--ink); }
  form button { font:inherit; font-weight:650; padding:11px 18px; border-radius:10px; border:none; background:var(--accent); color:var(--bg); cursor:pointer; }
  h2 { font-size:15px; margin:28px 0 4px; display:flex; align-items:baseline; gap:12px; }
  h2 button { font:inherit; font-size:11.5px; background:none; border:1px solid var(--line); color:var(--muted); border-radius:999px; padding:4px 10px; cursor:pointer; }
  h2 button:hover { color:var(--ink); border-color:var(--ink); }
  table { width:100%; border-collapse:collapse; margin-top:10px; background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th, td { text-align:left; font-size:13px; padding:9px 12px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; font-size:11.5px; text-transform:uppercase; letter-spacing:.08em; }
  tr:last-child td { border-bottom:0; }
  td.pro { color:var(--accent); font-weight:650; }
  td.num { font-variant-numeric:tabular-nums; }
</style>
</head>
<body>
<div class="wrap">
  <h1>VozzAI — Métricas e Leads <button id="logout" style="display:none">Sair</button></h1>
  <div class="tabs" id="tabs" style="display:none">
    <button id="tabMetrics" class="on">Métricas</button>
    <button id="tabLeads">Leads</button>
  </div>
  <form id="tokenForm" style="display:none">
    <input id="tokenInput" type="password" placeholder="Token de admin" autocomplete="off" />
    <button type="submit">Entrar</button>
  </form>
  <p class="msg" id="msg"></p>
  <div class="grid" id="grid"></div>
  <div id="leads" style="display:none"></div>
</div>
<script>
(function () {
  var KEY = 'vozzai_admin_token';
  var form = document.getElementById('tokenForm');
  var msg = document.getElementById('msg');
  var grid = document.getElementById('grid');
  var leadsEl = document.getElementById('leads');
  var tabs = document.getElementById('tabs');
  var tabMetrics = document.getElementById('tabMetrics');
  var tabLeads = document.getElementById('tabLeads');
  var logout = document.getElementById('logout');

  function askToken(text) {
    form.style.display = 'flex';
    tabs.style.display = 'none';
    logout.style.display = 'none';
    grid.innerHTML = '';
    leadsEl.textContent = '';
    msg.textContent = text || '';
  }

  function authed(path) {
    return fetch(path, { headers: { 'x-admin-token': localStorage.getItem(KEY) || '' } })
      .then(function (res) {
        if (res.status === 401) { localStorage.removeItem(KEY); askToken('Token inválido — tenta de novo.'); return null; }
        if (!res.ok) { msg.textContent = 'Erro ao carregar (' + res.status + ').'; return null; }
        return res.json();
      });
  }

  /* ---- Métricas: só números agregados, nunca dado pessoal ---- */
  function card(value, label, hi) {
    return '<div class="card"><div class="v' + (hi ? ' hi' : '') + '">' + value + '</div><div class="l">' + label + '</div></div>';
  }

  function loadMetrics() {
    msg.textContent = 'Carregando…';
    authed('/admin/metrics').then(function (m) {
      if (!m) return;
      form.style.display = 'none';
      tabs.style.display = 'flex';
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
    }).catch(function () { msg.textContent = 'Não consegui falar com o servidor.'; });
  }

  /* ---- Leads: e-mails de verdade (PII), montados só via textContent ---- */
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' });
  }

  function copyToClipboard(text, btn) {
    function done(label) {
      btn.textContent = label;
      setTimeout(function () { btn.textContent = 'Copiar e-mails'; }, 1600);
    }
    // execCommand é o caminho que funciona sem permissão especial; a API
    // moderna fica como primeira tentativa e cai pro fallback se negar.
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok ? 'Copiado ✓' : 'Não consegui copiar');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done('Copiado ✓'); }, fallback);
    } else {
      fallback();
    }
  }

  function sectionHeader(title, emails) {
    var h = el('h2', title + ' (' + emails.length + ')');
    var copy = el('button', 'Copiar e-mails');
    copy.addEventListener('click', function () { copyToClipboard(emails.join(', '), copy); });
    h.appendChild(copy);
    return h;
  }

  function table(headers, rows) {
    var t = el('table');
    var trh = el('tr');
    headers.forEach(function (htxt) { trh.appendChild(el('th', htxt)); });
    t.appendChild(trh);
    rows.forEach(function (cells) {
      var tr = el('tr');
      cells.forEach(function (c) { tr.appendChild(el('td', c.text, c.cls)); });
      t.appendChild(tr);
    });
    return t;
  }

  function loadLeads() {
    msg.textContent = 'Carregando…';
    authed('/admin/leads').then(function (data) {
      if (!data) return;
      msg.textContent = '';
      leadsEl.textContent = '';

      var pii = el('p', 'Esta aba contém dados pessoais (e-mails) — trate com o cuidado que a LGPD pede.', 'pii');
      leadsEl.appendChild(pii);

      var userEmails = data.users.map(function (u) { return u.email; });
      leadsEl.appendChild(sectionHeader('Contas', userEmails));
      leadsEl.appendChild(table(
        ['E-mail', 'Plano', 'Cadastro', 'Último ditado', 'Palavras 30d'],
        data.users.map(function (u) {
          return [
            { text: u.email },
            { text: u.plan === 'pro' ? 'Pro' : 'Grátis', cls: u.plan === 'pro' ? 'pro' : '' },
            { text: fmtDate(u.createdAt) },
            { text: fmtDate(u.lastDictationAt) },
            { text: u.words30d.toLocaleString('pt-BR'), cls: 'num' },
          ];
        })
      ));

      var wlEmails = data.waitlist.map(function (w) { return w.email; });
      leadsEl.appendChild(sectionHeader('Lista de espera', wlEmails));
      leadsEl.appendChild(table(
        ['E-mail', 'Entrou em'],
        data.waitlist.map(function (w) {
          return [{ text: w.email }, { text: fmtDate(w.createdAt) }];
        })
      ));
    }).catch(function () { msg.textContent = 'Não consegui falar com o servidor.'; });
  }

  function showTab(which) {
    tabMetrics.className = which === 'metrics' ? 'on' : '';
    tabLeads.className = which === 'leads' ? 'on' : '';
    grid.style.display = which === 'metrics' ? 'grid' : 'none';
    leadsEl.style.display = which === 'leads' ? 'block' : 'none';
    if (which === 'metrics') loadMetrics(); else loadLeads();
  }

  tabMetrics.addEventListener('click', function () { showTab('metrics'); });
  tabLeads.addEventListener('click', function () { showTab('leads'); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = document.getElementById('tokenInput').value.trim();
    if (!v) return;
    localStorage.setItem(KEY, v);
    loadMetrics();
  });
  logout.addEventListener('click', function () { localStorage.removeItem(KEY); askToken(''); });

  if (localStorage.getItem(KEY)) loadMetrics(); else askToken('');
})();
</script>
</body>
</html>`;
