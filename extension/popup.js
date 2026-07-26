const API_BASE = 'https://vozzai-production.up.railway.app';

const loggedOutEl = document.getElementById('loggedOut');
const loggedInEl = document.getElementById('loggedIn');
const statusEl = document.getElementById('status');
const usageEl = document.getElementById('usage');
const msgEl = document.getElementById('msg');
const toggleModeEl = document.getElementById('toggleMode');
const submitBtn = document.getElementById('submitBtn');
const subscribeBtn = document.getElementById('subscribeBtn');
const subMsgEl = document.getElementById('subMsg');

let mode = 'login';

init();

async function init() {
  const { vozzaToken, vozzaEmail } = await chrome.storage.local.get(['vozzaToken', 'vozzaEmail']);
  if (vozzaToken) await showLoggedIn(vozzaToken, vozzaEmail);
}

toggleModeEl.addEventListener('click', () => {
  mode = mode === 'login' ? 'signup' : 'login';
  submitBtn.textContent = mode === 'login' ? 'Entrar' : 'Criar conta';
  toggleModeEl.textContent =
    mode === 'login' ? 'Ainda não tem conta? Criar conta' : 'Já tem conta? Entrar';
  msgEl.textContent = '';
});

submitBtn.addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const route = mode === 'login' ? '/auth/login' : '/auth/signup';

  msgEl.style.color = '#5B606B';
  msgEl.textContent = mode === 'login' ? 'Entrando…' : 'Criando conta…';

  let res, data;
  try {
    res = await fetch(`${API_BASE}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    data = await res.json();
  } catch {
    msgEl.style.color = '#D93A1D';
    msgEl.textContent = 'Não consegui falar com o servidor do Vozza.';
    return;
  }

  if (!res.ok) {
    msgEl.style.color = '#D93A1D';
    msgEl.textContent = data.error || 'Algo deu errado.';
    return;
  }

  await chrome.storage.local.set({ vozzaToken: data.token, vozzaEmail: email });
  await showLoggedIn(data.token, email);
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['vozzaToken', 'vozzaEmail']);
  loggedOutEl.style.display = 'block';
  loggedInEl.style.display = 'none';
});

subscribeBtn.addEventListener('click', async () => {
  const { vozzaToken } = await chrome.storage.local.get('vozzaToken');
  subscribeBtn.disabled = true;
  subMsgEl.textContent = 'Abrindo checkout…';

  let res, data;
  try {
    res = await fetch(`${API_BASE}/billing/subscribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vozzaToken}` },
    });
    data = await res.json();
  } catch {
    subMsgEl.textContent = 'Não consegui falar com o servidor do Vozza.';
    subscribeBtn.disabled = false;
    return;
  }

  if (!res.ok) {
    subMsgEl.textContent = data.error || 'Não consegui iniciar a assinatura.';
    subscribeBtn.disabled = false;
    return;
  }

  chrome.tabs.create({ url: data.checkoutUrl });
  subMsgEl.textContent = '';
  subscribeBtn.disabled = false;
});

async function showLoggedIn(token, email) {
  loggedOutEl.style.display = 'none';
  loggedInEl.style.display = 'block';
  statusEl.textContent = `Conectado como ${email}`;
  usageEl.textContent = 'Carregando uso…';

  try {
    const res = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (res.ok) {
      const { used, limit, period } = data.usage;
      const janela = period === 'week' ? 'semana' : 'mês';
      usageEl.textContent = `${used.toLocaleString('pt-BR')} / ${limit.toLocaleString('pt-BR')} palavras nesta ${janela}`;
      subscribeBtn.style.display = data.plan === 'pro' ? 'none' : 'block';
    } else {
      usageEl.textContent = '';
    }
  } catch {
    usageEl.textContent = '';
  }
}
