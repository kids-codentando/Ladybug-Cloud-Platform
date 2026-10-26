/* Ladybug Cloud — frontend SPA */

const state = { user: null, bots: [], limit: 1, adminTab: 'overview', logTimer: null };

/* ---------------------------------------------------------------- utils */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = 'toast'), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (res.status === 401 && state.user && !path.startsWith('/api/auth/')) {
    // account no longer exists server-side (e.g. data reset) - send to login cleanly
    state.user = null;
    location.hash = '#/login';
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

function fmtLeft(ms) {
  if (ms <= 0) return '0m';
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

/* ---------------------------------------------------------------- wallet */
function walletHTML(b) {
  const c = b.config;
  const now = Date.now();
  let planTitle, planSub, pct = 0, tone = 'ok';
  if (b.mode === 'admin') {
    planTitle = 'Admin'; planSub = 'Unlimited hosting, no coins needed.'; pct = 100;
  } else if (b.mode === 'subscription') {
    planTitle = `Unlimited`;
    planSub = `Active for <b data-left="${b.subscriptionUntil}">${fmtLeft(b.subscriptionUntil - now)}</b>. Your bot runs without spending coins.`;
    pct = Math.min(100, ((b.subscriptionUntil - now) / (c.subscriptionDays * 86400000)) * 100);
  } else if (b.mode === 'trial') {
    planTitle = `Free trial`;
    planSub = `<b data-left="${b.trialEndsAt}">${fmtLeft(b.trialEndsAt - now)}</b> left. After that a bot costs ${c.botCoinCost} coins ${c.botPeriodDays === 1 ? 'per day' : 'per ' + c.botPeriodDays + ' days'}, or subscribe for $${c.priceUsd}/month.`;
    pct = Math.max(0, Math.min(100, ((b.trialEndsAt - now) / (c.trialDays * 86400000)) * 100));
  } else {
    planTitle = 'Daily coins';
    planSub = `Your bot costs <b>${c.botCoinCost} coins</b> ${c.botPeriodDays === 1 ? 'per day' : 'per ' + c.botPeriodDays + ' days'}. Claim ${c.claimCoins} free coins every day to keep it online, or subscribe for $${c.priceUsd}/month.`;
    pct = Math.min(100, (b.coins / c.botCoinCost) * 100); tone = b.coins >= c.botCoinCost ? 'ok' : 'warn';
  }
  const claimBtn = b.canClaim
    ? `<button class="btn btn-primary btn-claim" id="claimBtn">Claim ${c.claimCoins} free coins</button>`
    : `<button class="btn btn-claim" disabled id="claimBtn">Next claim in&nbsp;<span data-left="${b.nextClaimAt}">${fmtLeft(b.nextClaimAt - now)}</span></button>`;
  const sub = b.mode === 'subscription' || b.mode === 'admin' ? '' : (c.paymentUrl
    ? `<a class="btn" href="${esc(c.paymentUrl)}${c.paymentUrl.includes('?') ? '&' : '?'}client_reference_id=${encodeURIComponent(state.user.username)}" target="_blank" rel="noopener">Subscribe for $${c.priceUsd}/month</a>`
    : `<button class="btn" id="subBtn">Subscribe for $${c.priceUsd}/month</button>`);
  const log = (b.log || []).map((l) => `<div class="log-row"><span>${esc(l.reason)}</span><b class="${l.delta >= 0 ? 'plus' : 'minus'}">${l.delta >= 0 ? '+' : ''}${l.delta}</b></div>`).join('');
  return `
  <div class="wallet">
    <div class="wallet-plan">
      <div class="k">Plan</div>
      <div class="wallet-title">${planTitle}</div>
      <div class="wallet-sub">${planSub}</div>
      <div class="meter ${tone}"><span style="width:${pct}%"></span></div>
    </div>
    <div class="wallet-coins">
      <div class="k">Coins</div>
      <div class="coin-big"><i class="coin-dot"></i>${b.coins}<small>of ${c.maxCoins} max</small></div>
      <div class="wallet-actions">${claimBtn}${sub}</div>
      ${log ? `<details class="coin-log"><summary>Recent activity</summary>${log}</details>` : ''}
    </div>
  </div>`;
}

async function loadWallet() {
  const el = $('#wallet');
  if (!el) return;
  try {
    const b = await api('/api/billing');
    state.billing = b;
    el.innerHTML = walletHTML(b);
    renderNavCoins();
    const cb = $('#claimBtn');
    if (cb && !cb.disabled) cb.onclick = async () => {
      cb.disabled = true; cb.innerHTML = '<span class="spin"></span>';
      try {
        const r = await api('/api/coins/claim', { method: 'POST' });
        toast(`+${r.added} coins claimed`);
      } catch (e) { toast(e.message, 'err'); }
      loadWallet();
    };
    const sb = $('#subBtn');
    if (sb) sb.onclick = () => toast('Subscriptions are activated by the admin - contact them to subscribe.', 'ok');
  } catch (e) { /* ignore */ }
}

function renderNavCoins() {
  const n = $('#navCoinsN');
  if (n && state.billing) n.textContent = state.billing.coins;
}

// live countdowns
setInterval(() => {
  document.querySelectorAll('[data-left]').forEach((el) => {
    el.textContent = fmtLeft(Number(el.dataset.left) - Date.now());
  });
}, 30000);

/* ---------------------------------------------------------------- router */
const routes = {
  '/': renderLanding,
  '/pricing': renderLanding,
  '/login': renderLogin,
  '/register': renderRegister,
  '/dashboard': renderDashboard,
  '/status': renderStatus,
  '/admin': renderAdmin,
};

async function navigate() {
  const hash = location.hash.replace('#', '') || '/';
  const path = hash.split('?')[0];
  if (state.logTimer) { clearInterval(state.logTimer); state.logTimer = null; }

  // refresh session
  try {
    const r = await api('/api/auth/me');
    state.user = r.user;
  } catch (e) { state.user = null; }

  renderNav();

  const fn = routes[path] || renderLanding;
  await fn();
  if (path === '/pricing' && $('#pricing')) $('#pricing').scrollIntoView();
  else window.scrollTo(0, 0);
}

function renderNav() {
  const el = $('#navLinks');
  if (state.user) {
    const coins = state.billing ? state.billing.coins : state.user.coins || 0;
    el.innerHTML = `
      <a href="#/dashboard" class="nav-link hide-sm">Dashboard</a>
      <a href="#/status" class="nav-link hide-sm">Status</a>
      ${state.user.isAdmin ? '<a href="#/admin" class="nav-link hide-sm">Admin</a>' : ''}
      <span class="nav-sep hide-sm"></span>
      <a href="#/dashboard" class="coin-chip" id="navCoins" title="Your coins"><i class="coin-dot"></i><span id="navCoinsN">${coins}</span></a>
      <button class="btn btn-sm btn-ghost" id="logoutBtn" title="Signed in as ${esc(state.user.username)}">Log out</button>`;
    $('#logoutBtn').onclick = async () => {
      await api('/api/auth/logout', { method: 'POST' });
      state.billing = null;
      toast('Logged out');
      location.hash = '#/';
    };
  } else {
    el.innerHTML = `
      <a href="#/pricing" class="nav-link hide-sm">Pricing</a>
      <a href="#/status" class="nav-link hide-sm">Status</a>
      <a href="#/login" class="nav-link">Log in</a>
      <a href="#/register" class="btn btn-primary btn-sm">Start free trial</a>`;
  }
}

/* ---------------------------------------------------------------- landing */
async function renderLanding() {
  const price = 3;
  $('#view').innerHTML = `
  <section class="hero">
    <div class="wrap hero-grid">
      <div>
        <h1>Your WhatsApp bot, online in two minutes.</h1>
        <p class="lead">Link your number, press start, and Ladybug Cloud keeps your bot running around the clock. <b>The first 7 days are free.</b> After that, claim 20 coins a day to stay online at no cost, or pay $${price} a month and forget about it.</p>
        <div class="hero-cta">
          <a href="#/register" class="btn btn-primary btn-lg">Start your free trial</a>
          <a href="#/pricing" class="btn btn-lg">See pricing</a>
        </div>
        <p class="hero-note">No card needed. One bot per account.</p>
      </div>

      <div class="botwin" aria-hidden="true">
        <div class="botwin-bar">
          <div class="botwin-spots"><i></i><i></i><i></i></div>
          <div class="botwin-title">ladybug-mini</div>
          <span class="badge badge-starting" id="demoBadge">Starting</span>
        </div>
        <div class="botwin-body">
          <div class="botwin-stats">
            <div><span>Uptime</span><b id="demoUp">0m</b></div>
            <div><span>Restarts</span><b>0</b></div>
            <div><span>Plan</span><b>Trial</b></div>
          </div>
          <div class="botwin-log" id="demoLog"></div>
        </div>
        <div class="botwin-foot">
          <span>Trial ends in <b>7 days</b></span>
          <span>Balance <b><i class="coin-dot"></i> 20</b></span>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap section-split">
      <div class="section-head">
        <h2>Online in three steps</h2>
        <p>No server, no terminal, no config files.</p>
      </div>
      <ol class="steps">
        <li><div><h3>Link your WhatsApp number</h3><p>Enter your phone number and we show an 8-digit code. Type it into WhatsApp under Linked devices. Already have a Ladybug session ID? Paste it instead.</p></div></li>
        <li><div><h3>Press Start</h3><p>Your bot gets its own private process and connects in seconds. Watch the live log to see exactly what it is doing.</p></div></li>
        <li><div><h3>Keep it running</h3><p>Claim 20 free coins each day, which covers a bot for 24 hours. Prefer not to think about it? Subscribe and the bot runs without using coins.</p></div></li>
      </ol>
    </div>
  </section>

  <section class="section">
    <div class="wrap section-split">
      <div class="section-head">
        <h2>What you get</h2>
        <p>Everything needed to run Ladybug Mini reliably.</p>
      </div>
      <dl class="deflist">
        <div><dt>Pairing in the browser</dt><dd>Generate a session without installing anything on your computer.</dd></div>
        <div><dt>Live logs</dt><dd>Your bot's console streams into the dashboard, so problems are easy to spot and fix.</dd></div>
        <div><dt>Automatic restarts</dt><dd>If the bot crashes, it comes back on its own with a growing delay between attempts.</dd></div>
        <div><dt>Private by default</dt><dd>Every bot runs in its own process with its own session folder. Session IDs are never shown publicly.</dd></div>
        <div><dt>Always the latest bot</dt><dd>The bot code is maintained centrally, so you do not update anything yourself.</dd></div>
        <div><dt>Public status page</dt><dd>See platform health and uptime at a glance on the <a href="#/status" style="text-decoration:underline">status page</a>.</dd></div>
      </dl>
    </div>
  </section>

  <section class="section" id="pricing">
    <div class="wrap">
      <div class="section-title">
        <h2>Pricing that starts at zero</h2>
        <p>Try it free for a week. After that, pick whichever way suits you.</p>
      </div>
      <div class="pricing">
        <div class="plan">
          <div class="plan-name">Free trial</div>
          <div class="plan-price">$0<small>for 7 days</small></div>
          <p class="plan-desc">Everything works from day one. No card required.</p>
          <ul><li>1 bot, hosted for you</li><li>Live logs and auto-restart</li><li>Browser pairing</li></ul>
          <a href="#/register" class="btn btn-block">Start free trial</a>
        </div>
        <div class="plan featured">
          <div class="plan-name">Daily coins <span class="plan-tag">Stays free</span></div>
          <div class="plan-price">20<small>coins a day, free</small></div>
          <p class="plan-desc">Claim once a day. 20 coins keeps one bot online for 24 hours.</p>
          <ul><li>Claim every 24 hours</li><li>Balance holds up to 140 coins</li><li>If coins run out, the bot pauses and nothing is deleted</li></ul>
          <a href="#/register" class="btn btn-primary btn-block">Create free account</a>
        </div>
        <div class="plan">
          <div class="plan-name">Unlimited</div>
          <div class="plan-price">$${price}<small>per month</small></div>
          <p class="plan-desc">For bots you never want to think about.</p>
          <ul><li>Runs 24/7 without coins</li><li>No daily claiming</li><li>Your coins stay in your balance</li></ul>
          <a href="#/register" class="btn btn-block">Get started</a>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap section-split">
      <div class="section-head"><h2>Questions</h2><p>The short answers.</p></div>
      <div class="faq">
        <details><summary>What happens when my trial ends?</summary><p>Your bot keeps running as long as you have coins or a subscription. Each day of hosting costs 20 coins, which is exactly what one daily claim gives you.</p></details>
        <details><summary>What if I forget to claim?</summary><p>If your balance cannot cover the next day, the bot pauses and shows a notice on your dashboard. Claim your coins and press Start to bring it back. Your settings and session stay saved.</p></details>
        <details><summary>Can I stack coins?</summary><p>Yes, up to 140. That is a week of hosting if you want to claim less often.</p></details>
        <details><summary>How do I pay the $${price} a month?</summary><p>Use the Subscribe button on your dashboard. Once your payment is confirmed, your account switches to Unlimited.</p></details>
        <details><summary>Will I lose my account if the site restarts?</summary><p>No. Accounts, bots, coins and logins are backed up continuously and restored automatically.</p></details>
      </div>
    </div>
  </section>

  <section class="cta-band">
    <div class="wrap">
      <div class="cta-inner">
        <h2>Get your bot online today.</h2>
        <a href="#/register" class="btn btn-lg">Start your free trial</a>
      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="wrap">
      <span><b>Ladybug Cloud</b> by Ntandomods</span>
      <span>Not affiliated with WhatsApp Inc. Use at your own risk.</span>
    </div>
  </footer>`;
  runDemo();
}

// one-time "bot coming online" sequence in the hero window
function runDemo() {
  const log = $('#demoLog'); if (!log) return;
  const lines = [
    ['host', 'Starting ladybug-mini'],
    ['bot', 'Session loaded'],
    ['bot', 'Connecting to WhatsApp...'],
    ['ok', 'Connected. 42 commands ready'],
    ['bot', 'Listening for messages'],
  ];
  const t = (i) => `<span class="t">12:0${i}</span>`;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = 0;
  const step = () => {
    if (!$('#demoLog')) return; // navigated away
    const [kind, text] = lines[i];
    log.insertAdjacentHTML('beforeend', `<div class="l">${t(i)}${kind === 'ok' ? `<span class="g">${text}</span>` : text}</div>`);
    i++;
    if (i === 4) {
      $('#demoBadge').className = 'badge badge-running'; $('#demoBadge').textContent = 'Running';
      $('#demoUp').textContent = '3d 4h';
    }
    if (i < lines.length) setTimeout(step, reduce ? 0 : 650);
  };
  step();
}

/* ---------------------------------------------------------------- auth */
function authForm(mode) {
  const isLogin = mode === 'login';
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <img src="/img/logo.png" alt="Ladybug" />
      <h2>${isLogin ? 'Welcome back' : 'Start your free trial'}</h2>
      <p class="sub">${isLogin ? 'Log in to manage your bot.' : '7 days of hosting for one bot. No card needed.'}</p>
      <div class="alert alert-error" id="err"></div>
      <form id="authForm">
        <div class="field">
          <label for="f-user">Username</label>
          <input class="input" id="f-user" name="username" autocomplete="username" required placeholder="yourname" />
        </div>
        ${isLogin ? '' : `<div class="field"><label for="f-mail">Email <span class="muted" style="font-weight:400">(optional)</span></label><input class="input" id="f-mail" name="email" type="email" placeholder="you@example.com" /></div>`}
        <div class="field">
          <label for="f-pass">Password</label>
          <input class="input" id="f-pass" name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required placeholder="${isLogin ? 'Your password' : 'At least 6 characters'}" />
        </div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" style="margin-top:6px">${isLogin ? 'Log in' : 'Create account'}</button>
      </form>
      <p style="text-align:center;margin:22px 0 0;font-size:14px;color:var(--muted)">
        ${isLogin ? `New here? <a href="#/register" style="text-decoration:underline">Create an account</a>` : `Already registered? <a href="#/login" style="text-decoration:underline">Log in</a>`}
      </p>
    </div>
  </div>`;
}

async function renderLogin() {
  if (state.user) return (location.hash = '#/dashboard');
  $('#view').innerHTML = authForm('login');
  bindAuth('login');
}

async function renderRegister() {
  if (state.user) return (location.hash = '#/dashboard');
  $('#view').innerHTML = authForm('register');
  bindAuth('register');
}

function bindAuth(mode) {
  const form = $('#authForm');
  const err = $('#err');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Please wait...';
    err.className = 'alert alert-error';
    try {
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      await api(`/api/auth/${mode}`, { method: 'POST', body });
      toast(mode === 'login' ? 'Welcome back!' : 'Account created!');
      location.hash = '#/dashboard';
    } catch (ex) {
      err.textContent = ex.message;
      err.className = 'alert alert-error show';
      btn.disabled = false;
      btn.textContent = mode === 'login' ? 'Log in' : 'Create account';
    }
  };
}

/* ---------------------------------------------------------------- dashboard */
async function renderDashboard() {
  if (!state.user) return (location.hash = '#/login');

  const data = await api('/api/bots');
  state.bots = data.bots;
  state.limit = data.limit;

  const running = state.bots.filter((b) => b.running).length;

  $('#view').innerHTML = `
  <div class="app">
    <div class="wrap">
      <div class="app-head">
        <div>
          <h1>Your bot</h1>
          <p>Start, stop and watch your Ladybug Mini.</p>
        </div>
        <button class="btn btn-primary" id="newBotBtn">New bot</button>
      </div>

      <div id="wallet"><div class="wallet skeleton"></div></div>

      <div class="stats-row">
        <div class="stat"><div class="k">Bots</div><div class="v">${state.bots.length}<span style="font-size:15px;color:var(--muted);font-weight:500"> of ${state.limit}</span></div></div>
        <div class="stat"><div class="k">Running</div><div class="v" style="color:var(--ok)">${running}</div></div>
        <div class="stat"><div class="k">Stopped</div><div class="v">${state.bots.length - running}</div></div>
        <div class="stat"><div class="k">Billing</div><div class="v" style="font-size:22px;text-transform:capitalize">${esc(({ trial: 'Free trial', subscription: 'Unlimited', coins: 'Daily coins', admin: 'Admin' })[state.user.billingMode] || state.user.plan)}</div></div>
      </div>

      <div id="botsGrid" class="grid grid-3">
        ${state.bots.length ? state.bots.map(botCard).join('') : `
          <div class="empty" style="grid-column:1/-1">
            <img src="/img/logo.png" alt="" />
            <h3>Set up your first bot</h3>
            <p>Link your WhatsApp number and your bot is online in about two minutes.</p>
            <button class="btn btn-primary btn-lg" onclick="openNewBot()">Create bot</button>
          </div>`}
      </div>
    </div>
  </div>`;

  $('#newBotBtn').onclick = openNewBot;
  bindBotActions();
  startStatusPolling();
  loadWallet();
}

function badge(status) {
  const map = { running: 'Running', stopped: 'Stopped', crashed: 'Crashed', starting: 'Starting', stopping: 'Stopping' };
  return `<span class="badge badge-${status}">${map[status] || status}</span>`;
}

function botCard(b) {
  const paid = b.coinPaidUntil && b.coinPaidUntil > Date.now() && b.running;
  return `
  <div class="bot-card" data-id="${b.id}">
    <div class="bot-top">
      <div>
        <div class="bot-name">${esc(b.name)}</div>
        <div class="bot-meta">${b.hasSession ? esc(b.sessionIdMasked) : 'No session linked'}</div>
      </div>
      ${badge(b.status)}
    </div>
    <div class="bot-info">
      <div><span>${b.running ? 'Uptime' : 'Last stopped'}</span><b>${b.running ? (b.startedAt ? timeAgo(b.startedAt).replace(' ago', '') : '-') : (b.stoppedAt ? timeAgo(b.stoppedAt) : 'Never started')}</b></div>
      <div><span>Auto-restart</span><b>${b.autoRestart ? 'On' : 'Off'}${b.restarts ? ` (${b.restarts} restarts)` : ''}</b></div>
      ${paid ? `<div><span>Coins cover</span><b data-left="${b.coinPaidUntil}">${fmtLeft(b.coinPaidUntil - Date.now())}</b></div>` : ''}
    </div>
    ${b.suspendedReason && !b.running ? `<div class="suspended">${esc(b.suspendedReason)}</div>` : ''}
    ${b.lastError ? `<div class="suspended" style="color:#ff8f86;background:var(--red-soft);border-color:rgba(226,59,46,.35)">${esc(b.lastError)}</div>` : ''}
    <div class="bot-actions">
      ${b.running
        ? `<button class="btn btn-sm btn-danger" data-act="stop">Stop</button>
           <button class="btn btn-sm" data-act="restart">Restart</button>`
        : `<button class="btn btn-sm btn-primary" data-act="start">Start</button>`}
      <button class="btn btn-sm" data-act="logs">Logs</button>
      <button class="btn btn-sm btn-ghost" data-act="edit">Edit</button>
      <button class="btn btn-sm btn-ghost btn-danger" data-act="delete">Delete</button>
    </div>
  </div>`;
}

function bindBotActions() {
  $$('.bot-card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = () => handleBotAction(id, btn.dataset.act, btn);
    });
  });
}

async function handleBotAction(id, act, btn) {
  const bot = state.bots.find((b) => b.id === id);
  if (!bot) return;

  if (act === 'logs') return openLogs(bot);
  if (act === 'edit') return openEditBot(bot);

  if (act === 'delete') {
    if (!confirm(`Delete bot "${bot.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/bots/${id}`, { method: 'DELETE' });
      toast('Bot deleted');
      renderDashboard();
    } catch (e) { toast(e.message, 'err'); }
    return;
  }

  btn.disabled = true;
  const original = btn.textContent;
  btn.innerHTML = '<span class="spin"></span>';
  try {
    await api(`/api/bots/${id}/${act}`, { method: 'POST' });
    toast(act === 'start' ? 'Bot starting...' : act === 'stop' ? 'Bot stopping...' : 'Restarting...');
    setTimeout(renderDashboard, 700);
  } catch (e) {
    toast(e.message, 'err');
    loadWallet();
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ---------------------------------------------------------------- modals */
function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalBack').classList.add('show');
}
function closeModal() {
  $('#modalBack').classList.remove('show');
  $('#modal').innerHTML = '';
}
$('#modalBack') && ($('#modalBack').onclick = (e) => { if (e.target.id === 'modalBack') closeModal(); });

function openNewBot() {
  if (state.bots.length >= state.limit) {
    return toast(`Bot limit reached (${state.limit}). Contact the admin to upgrade.`, 'err');
  }
  openModal(`
    <h3>Create your bot</h3>
    <p class="sub">Pair a number in the browser, or paste an existing session ID.</p>
    <div class="alert alert-error" id="mErr"></div>
    <div class="field"><label>Bot Name</label><input class="input" id="mName" placeholder="My Ladybug" maxlength="40" /></div>

    <div class="pair-box">
      <div class="pair-head">Link your WhatsApp number</div>
      <div class="pair-row">
        <input class="input" id="mPhone" placeholder="Phone with country code e.g. 27821234567" inputmode="numeric" />
        <button class="btn btn-primary btn-sm" id="mPair">Get code</button>
      </div>
      <div id="mPairOut" class="pair-out"></div>
      <div class="hint">Open WhatsApp → <b>Linked devices</b> → <b>Link with phone number</b> and enter the code.</div>
    </div>

    <div class="field">
      <label>Session ID</label>
      <textarea class="input" id="mSession" placeholder="Ladybug!H4sIA..."></textarea>
      <div class="hint">Filled automatically after pairing, or paste one that starts with <code>Ladybug!</code>.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="mCreate">Create Bot</button>
    </div>`);

  let pairTimer = null;
  let pairJob = null;

  const stopPolling = () => {
    if (pairTimer) { clearInterval(pairTimer); pairTimer = null; }
  };
  // stop polling if the modal is dismissed
  const back = $('#modalBack');
  const prevClick = back.onclick;
  back.onclick = (e) => {
    if (e.target.id === 'modalBack') { stopPolling(); pairJob && api(`/api/session/pair/${pairJob}`, { method: 'DELETE' }).catch(() => {}); }
    prevClick && prevClick(e);
  };

  $('#mPair').onclick = async () => {
    const phone = $('#mPhone').value.replace(/[^0-9]/g, '');
    const out = $('#mPairOut');
    if (phone.length < 7) {
      out.innerHTML = '<div class="pair-err">Enter a valid number with country code.</div>';
      return;
    }
    stopPolling();
    const btn = $('#mPair');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    out.innerHTML = '<div class="pair-wait">Starting WhatsApp pairing…</div>';
    try {
      const { job } = await api('/api/session/pair', { method: 'POST', body: { phone } });
      pairJob = job.id;
      renderPair(job);
      pairTimer = setInterval(async () => {
        try {
          const r = await api(`/api/session/pair/${job.id}`);
          renderPair(r.job);
          if (r.job.status === 'ready' || r.job.status === 'error') {
            stopPolling();
            btn.disabled = false;
            btn.textContent = 'Get code';
          }
        } catch (e) {
          stopPolling();
          btn.disabled = false;
          btn.textContent = 'Get code';
          out.innerHTML = `<div class="pair-err">${esc(e.message)}</div>`;
        }
      }, 2000);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Get code';
      out.innerHTML = `<div class="pair-err">${esc(e.message)}</div>`;
    }
  };

  function renderPair(job) {
    const out = $('#mPairOut');
    if (!out) return;
    if (job.status === 'ready') {
      $('#mSession').value = job.sessionId;
      const who = job.me && job.me.id ? String(job.me.id).split(':')[0].split('@')[0] : job.phone;
      out.innerHTML = `<div class="pair-ok">Paired as <b>${esc(who)}</b>. The session is filled in below.</div>`;
      toast('Session generated!');
    } else if (job.status === 'error') {
      out.innerHTML = `<div class="pair-err">${esc(job.message || 'Pairing failed.')}</div>`;
    } else if (job.code) {
      out.innerHTML = `
        <div class="pair-code-label">Your pairing code</div>
        <div class="pair-code">${esc(String(job.code).replace(/(.{4})(?=.)/g, '$1 '))}</div>
        <div class="pair-wait">${esc(job.message || 'Waiting for you to enter the code…')}</div>`;
    } else {
      out.innerHTML = `<div class="pair-wait">${esc(job.message || 'Connecting…')}</div>`;
    }
  }

  $('#mCreate').onclick = async () => {
    const name = $('#mName').value.trim();
    const sessionId = $('#mSession').value.trim();
    const err = $('#mErr');
    err.className = 'alert alert-error';
    if (!name || !sessionId) {
      err.textContent = 'Both fields are required.';
      err.className = 'alert alert-error show';
      return;
    }
    const btn = $('#mCreate');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    try {
      await api('/api/bots', { method: 'POST', body: { name, sessionId } });
      stopPolling();
      closeModal();
      toast('Bot created!');
      renderDashboard();
    } catch (e) {
      err.textContent = e.message;
      err.className = 'alert alert-error show';
      btn.disabled = false;
      btn.textContent = 'Create Bot';
    }
  };
}

function openEditBot(bot) {
  openModal(`
    <h3>Edit bot</h3>
    <p class="sub">Update the name, session ID or auto-restart setting.</p>
    <div class="alert alert-error" id="mErr"></div>
    <div class="field"><label>Bot Name</label><input class="input" id="mName" value="${esc(bot.name)}" maxlength="40" /></div>
    <div class="field"><label>New Session ID <span style="text-transform:none;font-weight:400">(leave blank to keep)</span></label><textarea class="input" id="mSession" placeholder="Leave empty to keep current session"></textarea></div>
    <div class="field">
      <label>Auto-restart</label>
      <select class="input" id="mAuto"><option value="true" ${bot.autoRestart ? 'selected' : ''}>Enabled</option><option value="false" ${!bot.autoRestart ? 'selected' : ''}>Disabled</option></select>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save changes</button>
    </div>`);

  $('#mSave').onclick = async () => {
    const body = {
      name: $('#mName').value.trim(),
      autoRestart: $('#mAuto').value === 'true',
    };
    const s = $('#mSession').value.trim();
    if (s) body.sessionId = s;
    const btn = $('#mSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    try {
      await api(`/api/bots/${bot.id}`, { method: 'PATCH', body });
      closeModal();
      toast('Saved');
      renderDashboard();
    } catch (e) {
      const err = $('#mErr');
      err.textContent = e.message;
      err.className = 'alert alert-error show';
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  };
}

function openLogs(bot) {
  openModal(`
    <h3>${esc(bot.name)} — Live logs</h3>
    <p class="sub">Streaming console output from your bot process.</p>
    <div class="console" id="console"><div class="ln out">Loading...</div></div>
    <div class="modal-actions">
      <button class="btn btn-sm" id="clearLogs">Clear</button>
      <button class="btn" onclick="closeModal()">Close</button>
    </div>`);

  const consoleEl = $('#console');
  const load = async () => {
    try {
      const r = await api(`/api/bots/${bot.id}/logs?limit=300`);
      if (!r.logs.length) {
        consoleEl.innerHTML = '<div class="ln out">No logs yet. Start the bot to see output.</div>';
        return;
      }
      const atBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 60;
      consoleEl.innerHTML = r.logs
        .map((l) => `<div class="ln ${l.stream === 'stderr' ? 'err' : 'out'}"><span class="ts">${new Date(l.t).toLocaleTimeString()}</span>${esc(l.line)}</div>`)
        .join('');
      if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
    } catch (e) {
      consoleEl.innerHTML = `<div class="ln err">${esc(e.message)}</div>`;
    }
  };
  load();
  if (state.logTimer) clearInterval(state.logTimer);
  state.logTimer = setInterval(load, 2500);

  $('#clearLogs').onclick = async () => {
    await api(`/api/bots/${bot.id}/logs`, { method: 'DELETE' });
    load();
  };
}

/* ---------------------------------------------------------------- polling */
function startStatusPolling() {
  clearInterval(window._poll);
  window._poll = setInterval(async () => {
    if (location.hash !== '#/dashboard' || $('#modalBack').classList.contains('show')) return;
    try {
      const data = await api('/api/bots');
      const changed = JSON.stringify(data.bots.map((b) => [b.id, b.status, b.restarts])) !==
                      JSON.stringify(state.bots.map((b) => [b.id, b.status, b.restarts]));
      if (changed) {
        state.bots = data.bots;
        const grid = $('#botsGrid');
        if (grid) {
          grid.innerHTML = state.bots.map(botCard).join('');
          bindBotActions();
        }
      }
    } catch (e) { /* ignore */ }
  }, 5000);
}

/* ---------------------------------------------------------------- status */
async function renderStatus() {
  $('#view').innerHTML = `
  <section class="section" style="padding-top:48px">
    <div class="wrap">
      <div class="status-head">
        <div>
          <h2 style="margin-bottom:6px">Platform status</h2>
          <p class="sub" style="margin:0">Live view of Ladybug Cloud and the bots running on it.</p>
        </div>
        <div id="statusPill" class="pill"><span class="dot"></span> Checking...</div>
      </div>
      <div class="stats-grid" id="statusStats"></div>
      <div class="card" style="margin-top:24px">
        <div class="card-head">
          <h3>Running bots</h3>
          <span class="muted" id="statusUpdated" style="font-size:12.5px"></span>
        </div>
        <div id="statusBots"><div class="muted" style="padding:16px 0">Loading…</div></div>
      </div>
      <p class="muted" style="text-align:center;margin-top:22px;font-size:12.5px">
        Bot names are shown publicly; session IDs are never exposed.
      </p>
    </div>
  </section>`;

  async function load() {
    let d;
    try {
      d = await api('/api/status');
    } catch (e) {
      $('#statusPill').innerHTML = '<span class="dot" style="background:#ff2d55"></span> Unreachable';
      $('#statusBots').innerHTML = `<div class="pair-err">${esc(e.message)}</div>`;
      return;
    }
    const healthy = d.ok;
    $('#statusPill').innerHTML = `<span class="dot" style="background:${healthy ? '#22c55e' : '#ff2d55'}"></span> ${healthy ? 'All systems operational' : 'Degraded'}`;
    $('#statusStats').innerHTML = `
      <div class="stat"><div class="stat-label">Running</div><div class="stat-value" style="color:var(--ok)">${d.stats.running}</div></div>
      <div class="stat"><div class="stat-label">Total bots</div><div class="stat-value">${d.stats.bots}</div></div>
      <div class="stat"><div class="stat-label">Users</div><div class="stat-value">${d.stats.users}</div></div>
      <div class="stat"><div class="stat-label">Host uptime</div><div class="stat-value">${fmtUptime(d.uptime)}</div></div>`;

    const rows = (d.bots || []).map((b) => `
      <div class="status-row">
        <div class="status-name">${esc(b.name)}</div>
        <div class="status-mid">${b.running ? `Up ${fmtUptime(b.uptime)}` : 'Offline'}</div>
        ${badge(b.status)}
      </div>`).join('');

    $('#statusBots').innerHTML = rows || '<div class="muted" style="padding:16px 0">No bots yet — be the first to host one.</div>';
    $('#statusUpdated').textContent = `updated ${new Date(d.generatedAt).toLocaleTimeString()}`;
  }

  await load();
  if (state.logTimer) clearInterval(state.logTimer);
  state.logTimer = setInterval(load, 10000);
}

/* ---------------------------------------------------------------- admin */
async function renderAdmin() {
  if (!state.user) return (location.hash = '#/login');
  if (!state.user.isAdmin) return (location.hash = '#/dashboard');

  $('#view').innerHTML = `
  <div class="app">
    <div class="wrap">
      <div class="app-head">
        <div><h1>Admin Panel</h1><p>Manage users, bots and the bot codebase.</p></div>
        <span class="badge badge-running">Admin</span>
      </div>
      <div class="tabs">
        <button class="tab" data-tab="overview">Overview</button>
        <button class="tab" data-tab="users">Users</button>
        <button class="tab" data-tab="bots">All Bots</button>
        <button class="tab" data-tab="installer">Bot Installer</button>
      </div>
      <div id="adminBody"></div>
    </div>
  </div>`;

  $$('.tab').forEach((t) => {
    t.onclick = () => { state.adminTab = t.dataset.tab; adminTabs(); };
  });
  adminTabs();
}

function adminTabs() {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.adminTab));
  const body = $('#adminBody');
  if (state.adminTab === 'overview') adminOverview(body);
  if (state.adminTab === 'users') adminUsers(body);
  if (state.adminTab === 'bots') adminBots(body);
  if (state.adminTab === 'installer') adminInstaller(body);
}

async function adminOverview(el) {
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const s = await api('/api/admin/stats');
    el.innerHTML = `
      <div class="stats-row">
        <div class="stat"><div class="k">Users</div><div class="v">${s.users}</div></div>
        <div class="stat"><div class="k">Bots</div><div class="v">${s.bots}</div></div>
        <div class="stat"><div class="k">Running</div><div class="v" style="color:#6ee7a0">${s.running}</div></div>
        <div class="stat"><div class="k">Uptime</div><div class="v" style="font-size:20px">${fmtUptime(s.uptime)}</div></div>
      </div>
      <div class="grid grid-3" style="margin-top:18px">
        <div class="card"><h3>System</h3><p>Node ${esc(s.node)}<br/>${esc(s.platform)}<br/>${s.cpus} CPUs · Load ${s.loadavg.join(' / ')}</p></div>
        <div class="card"><h3>Memory</h3><p>RSS ${s.memory.rss} MB<br/>Heap ${s.memory.heap} MB</p></div>
        <div class="card"><h3>Database backup</h3><p>${!s.backup.enabled ? 'Not configured<br/><span style="font-size:12px">Set MONGODB_URI on the server to keep data across redeploys.</span>' : s.backup.ready ? `<span style="color:var(--ok)">Connected to MongoDB</span><br/>Last backup: ${s.backup.lastPushAt ? timeAgo(s.backup.lastPushAt) : 'pending'}${s.backup.restored ? `<br/>Restored on boot: ${s.backup.restored.users} users, ${s.backup.restored.bots} bots` : ''}` : `Not connected<br/><span style="font-size:12px;color:#ff8095">${esc(s.backup.lastError || '')}</span>`}</p></div>
        <div class="card"><h3>Bot Code</h3><p>${s.installed ? 'Installed' : 'Not installed'}<br/>Admins: ${s.admins}</p></div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="alert alert-error show">${esc(e.message)}</div>`;
  }
}

async function adminUsers(el) {
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const { users } = await api('/api/admin/users');
    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>User</th><th>Plan</th><th>Billing</th><th>Bots</th><th>Joined</th><th>Last login</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td><strong>${esc(u.username)}</strong>${u.isAdmin ? ' <span class="badge badge-running" style="font-size:9px">admin</span>' : ''}<br/><span style="color:var(--muted);font-size:12px">${esc(u.email || '—')}</span></td>
                <td>${esc(u.plan)}</td>
                <td style="font-size:12.5px">${esc(u.billingMode)}<br/><span style="color:var(--muted)">${u.coins} coins</span></td>
                <td>${u.botCount} / ${u.botLimit}</td>
                <td style="color:var(--muted)">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                <td style="color:var(--muted)">${u.lastLogin ? timeAgo(new Date(u.lastLogin).getTime()) : 'never'}</td>
                <td>
                  <button class="btn btn-sm" data-uplan="${u.id}" data-plan="${u.plan === 'pro' ? 'free' : 'pro'}">${u.plan === 'pro' ? 'Downgrade' : 'Upgrade'}</button>
                  <button class="btn btn-sm btn-green" data-ugrant="${u.id}" data-body='{"grantSubscriptionDays":30}' title="Mark as paid: +30 days">+30d sub</button>
                  <button class="btn btn-sm" data-ugrant="${u.id}" data-body='{"grantCoins":20}' title="Give 20 coins">+20 coins</button>
                  ${u.id !== state.user.id ? `<button class="btn btn-sm btn-danger" data-udel="${u.id}">Delete</button>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    $$('[data-uplan]').forEach((b) => (b.onclick = async () => {
      try {
        await api(`/api/admin/users/${b.dataset.uplan}`, { method: 'PATCH', body: { plan: b.dataset.plan } });
        toast('Plan updated');
        adminUsers(el);
      } catch (e) { toast(e.message, 'err'); }
    }));
    $$('[data-ugrant]').forEach((b) => (b.onclick = async () => {
      try {
        await api(`/api/admin/users/${b.dataset.ugrant}`, { method: 'PATCH', body: JSON.parse(b.dataset.body) });
        toast('Updated');
        adminUsers(el);
      } catch (e) { toast(e.message, 'err'); }
    }));
    $$('[data-udel]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this user and all their bots?')) return;
      try {
        await api(`/api/admin/users/${b.dataset.udel}`, { method: 'DELETE' });
        toast('User deleted');
        adminUsers(el);
      } catch (e) { toast(e.message, 'err'); }
    }));
  } catch (e) {
    el.innerHTML = `<div class="alert alert-error show">${esc(e.message)}</div>`;
  }
}

async function adminBots(el) {
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const { bots } = await api('/api/admin/bots');
    if (!bots.length) return (el.innerHTML = '<div class="empty">No bots on the platform yet.</div>');
    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Bot</th><th>Owner</th><th>Status</th><th>Restarts</th><th>Actions</th></tr></thead>
          <tbody>
            ${bots.map((b) => `
              <tr>
                <td><strong>${esc(b.name)}</strong><br/><span style="color:var(--muted);font-size:12px">${esc(b.sessionIdMasked)}</span></td>
                <td>${esc(b.owner)}</td>
                <td>${badge(b.status)}</td>
                <td>${b.restarts || 0}</td>
                <td>
                  ${b.running ? `<button class="btn btn-sm btn-danger" data-bstop="${b.id}">Stop</button>` : ''}
                  <button class="btn btn-sm btn-danger" data-bdel="${b.id}">Delete</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    $$('[data-bstop]').forEach((b) => (b.onclick = async () => {
      try { await api(`/api/admin/bots/${b.dataset.bstop}/stop`, { method: 'POST' }); toast('Stopped'); adminBots(el); }
      catch (e) { toast(e.message, 'err'); }
    }));
    $$('[data-bdel]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this bot?')) return;
      try { await api(`/api/admin/bots/${b.dataset.bdel}`, { method: 'DELETE' }); toast('Deleted'); adminBots(el); }
      catch (e) { toast(e.message, 'err'); }
    }));
  } catch (e) {
    el.innerHTML = `<div class="alert alert-error show">${esc(e.message)}</div>`;
  }
}

async function adminInstaller(el) {
  el.innerHTML = '<div class="empty">Loading...</div>';
  const st = await api('/api/admin/installer').catch(() => ({}));
  el.innerHTML = `
    <div class="grid grid-3">
      <div class="card" style="grid-column: span 2">
        <h3>Install bot code from GitHub</h3>
        <p style="margin-bottom:14px">Downloads the Ladybug Mini source and extracts it into the bot directory. Session folders and node_modules are preserved.</p>
        <div class="field"><label>Archive URL</label><input class="input" id="iUrl" value="https://github.com/kids-codentando/Ladybug-Mini/archive/refs/heads/main.zip" /></div>
        <button class="btn btn-primary" id="iGithub">Install / Update from GitHub</button>
        <hr style="border:none;border-top:1px solid var(--border);margin:22px 0" />
        <h3>Upload a zip</h3>
        <p style="margin-bottom:14px">Upload your own bot build (must contain index.js at the root).</p>
        <input type="file" id="iFile" accept=".zip" class="input" style="padding:10px" />
        <button class="btn" id="iUpload" style="margin-top:12px">Upload & Install</button>
      </div>
      <div class="card">
        <h3>Status</h3>
        <p style="line-height:2">
          Code installed: <strong>${st.installed ? 'Yes' : 'No'}</strong><br/>
          Step: <strong>${esc(st.step || 'idle')}</strong><br/>
          Last install: <strong>${st.lastInstalledAt ? new Date(st.lastInstalledAt).toLocaleString() : 'never'}</strong>
        </p>
        <div style="height:8px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden;margin:14px 0">
          <div style="height:100%;width:${st.progress || 0}%;background:linear-gradient(90deg,var(--red-2),var(--amber));transition:width .3s"></div>
        </div>
        <p style="font-size:12.5px;min-height:36px">${esc(st.message || '')}</p>
        <hr style="border:none;border-top:1px solid var(--border);margin:18px 0" />
        <h3>Dependencies</h3>
        <p style="margin-bottom:12px">Install the bot's npm packages (needed before first run).</p>
        <button class="btn btn-green btn-block" id="iDeps">Install Dependencies</button>
      </div>
    </div>`;

  const poll = async () => {
    const s = await api('/api/admin/installer').catch(() => null);
    if (s) {
      const p = el.querySelector('div[style*="width"]');
      if (p) p.style.width = `${s.progress || 0}%`;
      const msgEl = el.querySelectorAll('p')[1];
      if (msgEl && s.message) msgEl.textContent = s.message;
    }
  };

  $('#iGithub').onclick = async (e) => {
    e.target.disabled = true;
    e.target.innerHTML = '<span class="spin"></span> Installing...';
    try {
      await api('/api/admin/installer/github', { method: 'POST', body: { url: $('#iUrl').value.trim() } });
      toast('Bot code installed!');
      adminInstaller(el);
    } catch (err) {
      toast(err.message, 'err');
      e.target.disabled = false;
      e.target.textContent = 'Install / Update from GitHub';
    }
  };

  $('#iUpload').onclick = async () => {
    const f = $('#iFile').files[0];
    if (!f) return toast('Choose a zip file first', 'err');
    const fd = new FormData();
    fd.append('file', f);
    const btn = $('#iUpload');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Uploading...';
    try {
      const res = await fetch('/api/admin/installer/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Upload failed');
      toast('Installed!');
      adminInstaller(el);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.textContent = 'Upload & Install';
    }
  };

  $('#iDeps').onclick = async (e) => {
    e.target.disabled = true;
    e.target.innerHTML = '<span class="spin"></span> Installing deps...';
    try {
      await api('/api/admin/installer/deps', { method: 'POST' });
      toast('Dependency install started — this can take a few minutes');
      const t = setInterval(poll, 3000);
      setTimeout(() => clearInterval(t), 600000);
    } catch (err) {
      toast(err.message, 'err');
      e.target.disabled = false;
      e.target.textContent = 'Install Dependencies';
    }
  };
}

/* ---------------------------------------------------------------- boot */
window.addEventListener('hashchange', navigate);
window.closeModal = closeModal;
window.openNewBot = openNewBot;
navigate();
