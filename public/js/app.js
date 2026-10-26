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

  // Auto-claim add-on ($2/month) — the server claims the daily coins for you.
  const ac = b.autoClaim || {};
  let autoClaim;
  if (ac.active) {
    autoClaim = `<div class="autoclaim on">
        <div class="autoclaim-top"><span class="dot-ok"></span><b>Auto-claim on</b>
          <span class="autoclaim-left">renews in <span data-left="${ac.until}">${fmtLeft(ac.until - now)}</span></span></div>
        <p>We claim your ${c.claimCoins} coins every ${c.claimCooldownHours || 24}h for you — you'll never lose a bot to a forgotten claim.</p>
      </div>`;
  } else if (ac.requested) {
    autoClaim = `<div class="autoclaim off pending">
        <div class="autoclaim-top"><b>Auto-claim</b><span class="autoclaim-left">pending</span></div>
        <p>Request received. The admin will switch it on for you \u2014 no payment needed until then.</p>
      </div>`;
  } else if (ac.redundant) {
    autoClaim = `<div class="autoclaim off">
        <div class="autoclaim-top"><b>Auto-claim</b><span class="autoclaim-left">not needed</span></div>
        <p>Your plan already runs without coins, so there is nothing to claim.</p>
      </div>`;
  } else {
    autoClaim = `<div class="autoclaim off">
        <div class="autoclaim-top"><b>Auto-claim</b><span class="autoclaim-left">$${ac.priceUsd}/month</span></div>
        <p>Never lose a bot to a forgotten claim. We claim your ${c.claimCoins} daily coins automatically.</p>
        <button class="btn btn-sm btn-autoclaim" id="autoClaimBtn">Turn on auto-claim</button>
      </div>`;
  }
  // Extra bot slot add-on ($1/month each) \u2014 stacks on the plan limit.
  const es = b.extraSlots || {};
  let slots;
  if (es.active) {
    slots = `<div class="autoclaim on">
        <div class="autoclaim-top"><span class="dot-ok"></span><b>${es.count} extra slot${es.count > 1 ? 's' : ''} on</b>
          <span class="autoclaim-left">renews in <span data-left="${es.until}">${fmtLeft(es.until - now)}</span></span></div>
        <p>You can run up to <b>${es.botLimit}</b> bot${es.botLimit > 1 ? 's' : ''} at once. Add another for $${es.priceUsd}/month.</p>
        <button class="btn btn-sm btn-autoclaim" id="slotBtn">Add another slot</button>
      </div>`;
  } else if (es.requested) {
    slots = `<div class="autoclaim off pending">
        <div class="autoclaim-top"><b>Extra bot slot</b><span class="autoclaim-left">pending</span></div>
        <p>Request received. The admin will switch it on for you \u2014 no payment needed until then.</p>
      </div>`;
  } else {
    slots = `<div class="autoclaim off">
        <div class="autoclaim-top"><b>Extra bot slot</b><span class="autoclaim-left">$${es.priceUsd}/month</span></div>
        <p>Running ${es.botLimit} bot${es.botLimit > 1 ? 's' : ''}? Add one more without jumping to Unlimited.</p>
        <button class="btn btn-sm btn-autoclaim" id="slotBtn">Add a bot slot</button>
      </div>`;
  }
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
      ${autoClaim}
      ${slots}
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
    const ab = $('#autoClaimBtn');
    if (ab) ab.onclick = async () => {
      ab.disabled = true; ab.innerHTML = '<span class="spin"></span>';
      try {
        const r = await api('/api/billing/autoclaim', { method: 'POST' });
        if (r.url) { window.open(r.url, '_blank', 'noopener'); toast('Finish the payment to switch it on.', 'ok'); }
        else toast(r.message || 'Auto-claim requested.', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      loadWallet();
    };
    const slb = $('#slotBtn');
    if (slb) slb.onclick = async () => {
      slb.disabled = true; slb.innerHTML = '<span class="spin"></span>';
      try {
        const r = await api('/api/billing/slots', { method: 'POST', body: { count: 1 } });
        if (r.url) { window.open(r.url, '_blank', 'noopener'); toast('Finish the payment to add the slot.', 'ok'); }
        else toast(r.message || 'Slot requested.', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      loadWallet();
    };
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
    <div class="hero-bg" aria-hidden="true">
      <div class="hero-grid-lines"></div>
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
      <div class="orb orb-3"></div>
    </div>
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <span class="hero-eyebrow reveal"><i class="dot"></i> Built for group admins &amp; creators</span>
        <h1 class="reveal">Your WhatsApp bot,<br><span class="grad">online in two minutes.</span></h1>
        <p class="lead reveal">Link your number, press start, and Ladybug Cloud keeps <b>Ladybug Mini</b> running around the clock. <b>7 days free</b> &mdash; then claim 20 coins a day, or pay $${price}/month and forget about it.</p>
        <div class="hero-cta reveal">
          <a href="#/register" class="btn btn-primary btn-lg">Start free &mdash; no card <span class="arrow">&rarr;</span></a>
          <a href="#/pricing" class="btn btn-lg btn-outline">See pricing</a>
        </div>
        <ul class="hero-ticks reveal">
          <li><span>&#9889;</span> Live in ~2 minutes</li>
          <li><span>&#128274;</span> Session stays private</li>
          <li><span>&#8734;</span> 24/7 uptime</li>
        </ul>
      </div>

      <div class="hero-visual reveal">
        <div class="phone">
          <div class="phone-notch"></div>
          <div class="phone-screen">
            <div class="wa-head">
              <div class="wa-back">&#8249;</div>
              <div class="wa-avatar">&#128027;</div>
              <div class="wa-id"><b>Ladybug Mini</b><span>online</span></div>
              <div class="wa-icons"><span>&#128247;</span><span>&#8942;</span></div>
            </div>
            <div class="wa-chat">
              <div class="wa-day">TODAY</div>
              <div class="wa-msg out">.menu<span class="wa-time">12:04 <i>&#10003;&#10003;</i></span></div>
              <div class="wa-msg in menu">
                <div class="wa-menu-title">&#128027; LADYBUG MINI</div>
                <div class="wa-menu-row"><span>Owner</span><em>.autostatus .setprefix</em></div>
                <div class="wa-menu-row"><span>Admin</span><em>.antilink .welcome .tagall</em></div>
                <div class="wa-menu-row"><span>Downloader</span><em>.play .ytmp4 .tiktok</em></div>
                <div class="wa-menu-row"><span>General</span><em>.ai .sticker .vv</em></div>
                <div class="wa-menu-foot">42 commands ready &middot; prefix .</div>
                <span class="wa-time">12:04</span>
              </div>
              <div class="wa-msg out">.sticker<span class="wa-time">12:05 <i>&#10003;&#10003;</i></span></div>
              <div class="wa-msg in">Sticker created <span class="wa-emoji">&#128027;</span><span class="wa-time">12:05</span></div>
              <div class="wa-typing"><i></i><i></i><i></i></div>
            </div>
          </div>
        </div>

        <div class="float-log" aria-hidden="true">
          <div class="fl-bar"><span class="fl-dots"><i></i><i></i><i></i></span><b>live log</b></div>
          <div class="fl-body" id="heroLog"></div>
        </div>

        <div class="float-status" aria-hidden="true">
          <span class="fs-dot"></span>
          <div><b>ladybug-mini</b><span>Running &middot; 3d 4h uptime</span></div>
        </div>
      </div>
    </div>

    <div class="wrap">
      <div class="trust-strip reveal">
        <span>Runs <b>Ladybug Mini</b></span><i></i>
        <span>No coding required</span><i></i>
        <span>One bot per account</span><i></i>
        <span>Backed up automatically</span>
      </div>
    </div>
  </section>

  <div class="marquee" aria-hidden="true">
    <div class="marquee-track">
      ${['.autostatus','.antilink','.welcome','.tagall','.play','.ytmp4','.tiktok','.ai','.sticker','.vv','.antispam','.broadcast','.setprefix','.lyrics','.translate','.antidelete','.instagram','.textmaker']
        .map(c => `<span>${c}</span>`).join('')}
      ${['.autostatus','.antilink','.welcome','.tagall','.play','.ytmp4','.tiktok','.ai','.sticker','.vv','.antispam','.broadcast','.setprefix','.lyrics','.translate','.antidelete','.instagram','.textmaker']
        .map(c => `<span>${c}</span>`).join('')}
    </div>
  </div>

  <section class="stats-band">
    <div class="wrap stats-band-inner">
      <div class="sb-item reveal"><b>~2 min</b><span>From sign-up to live</span></div>
      <div class="sb-item reveal"><b>24/7</b><span>Always-on hosting</span></div>
      <div class="sb-item reveal"><b>42+</b><span>Bot commands</span></div>
      <div class="sb-item reveal"><b>7 days</b><span>Free, no card</span></div>
    </div>
  </section>

  <section class="section" id="commands">
    <div class="wrap">
      <div class="section-title center reveal">
        <span class="kicker">Real bot commands</span>
        <h2>What your bot can do</h2>
        <p>Not marketing fluff &mdash; these are the command categories live on your Ladybug Mini bot. Sign up and start using them with your prefix.</p>
      </div>
      <div class="cmd-grid">
        <article class="cmd-card reveal" data-accent="amber">
          <div class="cmd-top"><div class="cmd-icon">&#128081;</div><span class="cmd-count">14+ cmds</span></div>
          <h3>Owner</h3>
          <p>Control your bot account &mdash; status, privacy, branding &amp; broadcasts.</p>
          <div class="chips"><span>.autostatus</span><span>.savestatus</span><span>.autoread</span><span>.antidelete</span><span>.setprefix</span><span>.broadcast</span><span class="more">+8 more</span></div>
        </article>
        <article class="cmd-card reveal" data-accent="red">
          <div class="cmd-top"><div class="cmd-icon">&#128737;</div><span class="cmd-count">14+ cmds</span></div>
          <h3>Admin</h3>
          <p>Keep groups clean &mdash; anti-spam, links, bots, tags &amp; welcome flows.</p>
          <div class="chips"><span>.antilink</span><span>.antispam</span><span>.antibot</span><span>.welcome</span><span>.tagall</span><span>.warn</span><span class="more">+8 more</span></div>
        </article>
        <article class="cmd-card reveal" data-accent="violet">
          <div class="cmd-top"><div class="cmd-icon">&#11015;</div><span class="cmd-count">10+ cmds</span></div>
          <h3>Downloader</h3>
          <p>Pull media from the apps you already use &mdash; fast and simple.</p>
          <div class="chips"><span>.play</span><span>.ytmp4</span><span>.tiktok</span><span>.instagram</span><span>.facebook</span><span>.lyrics</span><span class="more">+4 more</span></div>
        </article>
        <article class="cmd-card reveal" data-accent="mint">
          <div class="cmd-top"><div class="cmd-icon">&#10024;</div><span class="cmd-count">14+ cmds</span></div>
          <h3>General</h3>
          <p>AI, stickers, view-once tools, text styles &amp; fun for every chat.</p>
          <div class="chips"><span>.ai</span><span>.sticker</span><span>.vv</span><span>.viewonce</span><span>.textmaker</span><span>.translate</span><span class="more">+8 more</span></div>
        </article>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section-title center reveal">
        <span class="kicker">How it works</span>
        <h2>Online in three steps</h2>
        <p>No server, no terminal, no config files. Most people are live in minutes.</p>
      </div>
      <div class="step-row">
        <div class="step-card reveal">
          <div class="step-num">1</div>
          <span class="step-tag">Get session</span>
          <h3>Link your number</h3>
          <p>Enter your phone number and we show an 8-digit code. Type it into WhatsApp under <b>Linked devices</b> &mdash; or paste an existing session ID.</p>
        </div>
        <div class="step-card reveal">
          <div class="step-num">2</div>
          <span class="step-tag">Press start</span>
          <h3>Bot goes live</h3>
          <p>Your bot gets its own private process and connects in seconds. Watch the live log to see exactly what it is doing.</p>
        </div>
        <div class="step-card reveal">
          <div class="step-num">3</div>
          <span class="step-tag">Stay online</span>
          <h3>Keep it running</h3>
          <p>Claim 20 free coins each day &mdash; that covers a bot for 24 hours. Or subscribe and it runs without using coins.</p>
        </div>
        <div class="step-line" aria-hidden="true"></div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section-title center reveal">
        <span class="kicker">Built to stay online</span>
        <h2>Everything you need, nothing you don't</h2>
        <p>Reliability is the product. Ladybug Cloud handles the hard parts so your bot just works.</p>
      </div>
      <div class="bento">
        <div class="bento-card lg reveal">
          <div class="bento-head"><div class="feat-ic">&#128220;</div><div><h3>Live logs, streamed</h3><p>Your bot's console streams straight into the dashboard, so problems are easy to spot and fix.</p></div></div>
          <div class="term" aria-hidden="true">
            <div class="term-bar"><span class="term-dots"><i></i><i></i><i></i></span><b>ladybug-mini &mdash; console</b></div>
            <div class="term-body" id="bentoLog"></div>
          </div>
        </div>
        <div class="bento-card tall reveal">
          <div class="feat-ic">&#128241;</div>
          <h3>Pair in the browser</h3>
          <p>Generate a session without installing anything on your computer. No Node, no terminal, no config files.</p>
          <div class="pair-visual" aria-hidden="true">
            <div class="pv-code">8 4 2 1 9 3 6 7</div>
            <div class="pv-label">Pairing code &middot; expires in 60s</div>
          </div>
        </div>
        <div class="bento-card reveal"><div class="feat-ic">&#128260;</div><h3>Automatic restarts</h3><p>If the bot crashes, it comes back on its own with a growing delay between attempts.</p></div>
        <div class="bento-card reveal"><div class="feat-ic">&#128274;</div><h3>Private by default</h3><p>Every bot runs in its own process with its own session folder. Session IDs are never shown publicly.</p></div>
        <div class="bento-card reveal"><div class="feat-ic">&#9889;</div><h3>Always the latest bot</h3><p>The bot code is maintained centrally, so you never update anything yourself.</p></div>
        <div class="bento-card reveal"><div class="feat-ic">&#128200;</div><h3>Public status page</h3><p>See platform health and uptime at a glance on the <a href="#/status">status page</a>.</p></div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section-title center reveal">
        <span class="kicker">Who it's for</span>
        <h2>Made for people who run chats</h2>
        <p>If you manage a community, a brand, or a busy group, your bot earns its keep every day.</p>
      </div>
      <div class="usecase-grid">
        <div class="usecase reveal"><span class="uc-emoji">&#128101;</span><h3>Group admins</h3><p>Anti-spam, welcome flows, tag-all and moderation that runs itself.</p></div>
        <div class="usecase reveal"><span class="uc-emoji">&#127908;</span><h3>Creators</h3><p>Auto-status, sticker packs and downloaders to keep fans engaged.</p></div>
        <div class="usecase reveal"><span class="uc-emoji">&#128722;</span><h3>Small businesses</h3><p>Fast replies, media downloads and AI answers without hiring.</p></div>
        <div class="usecase reveal"><span class="uc-emoji">&#129309;</span><h3>Resellers</h3><p>Spin up bots for clients from one clean dashboard.</p></div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section-title center reveal">
        <span class="kicker">Loved by operators</span>
        <h2>Less grind, more uptime</h2>
      </div>
      <div class="quote-grid">
        <figure class="quote reveal">
          <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <blockquote>&ldquo;Deployed in under a minute. Autostatus and antidelete alone save me hours every week &mdash; it feels like a full-time assistant on WhatsApp.&rdquo;</blockquote>
          <figcaption><span class="ava">AM</span><div><b>Arjun M.</b><span>Community manager</span></div></figcaption>
        </figure>
        <figure class="quote reveal">
          <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <blockquote>&ldquo;Group mods love antilink and antispam. We cut spam overnight, and the live logs make fixing anything trivial.&rdquo;</blockquote>
          <figcaption><span class="ava">PK</span><div><b>Priya K.</b><span>Group admin</span></div></figcaption>
        </figure>
        <figure class="quote reveal">
          <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <blockquote>&ldquo;Sticker packs and the downloader are insanely useful. Pasted my session, hit start, and the bot was live &mdash; zero coding.&rdquo;</blockquote>
          <figcaption><span class="ava">DR</span><div><b>Dev R.</b><span>Creator</span></div></figcaption>
        </figure>
      </div>
    </div>
  </section>

  <section class="section" id="pricing">
    <div class="wrap">
      <div class="section-title center reveal">
        <span class="kicker">Pricing</span>
        <h2>Pricing that starts at zero</h2>
        <p>Try it free for a week. After that, pick whichever way suits you.</p>
      </div>
      <div class="pricing">
        <div class="plan reveal">
          <div class="plan-name">Free trial</div>
          <div class="plan-price">$0<small>for 7 days</small></div>
          <p class="plan-desc">Everything works from day one. No card required.</p>
          <ul><li>1 bot, hosted for you</li><li>Live logs and auto-restart</li><li>Browser pairing</li></ul>
          <a href="#/register" class="btn btn-block">Start free trial</a>
        </div>
        <div class="plan featured reveal">
          <div class="plan-glow" aria-hidden="true"></div>
          <div class="plan-name">Daily coins <span class="plan-tag">Most popular</span></div>
          <div class="plan-price">20<small>coins a day, free</small></div>
          <p class="plan-desc">Claim once a day. 20 coins keeps one bot online for 24 hours.</p>
          <ul><li>Claim every 24 hours</li><li>Balance holds up to 140 coins</li><li>If coins run out, the bot pauses and nothing is deleted</li></ul>
          <a href="#/register" class="btn btn-primary btn-block">Create free account</a>
        </div>
        <div class="plan reveal">
          <div class="plan-name">Unlimited</div>
          <div class="plan-price">$${price}<small>per month</small></div>
          <p class="plan-desc">For bots you never want to think about.</p>
          <ul><li>Runs 24/7 without coins</li><li>No daily claiming</li><li>Your coins stay in your balance</li></ul>
          <a href="#/register" class="btn btn-block">Get started</a>
        </div>
        <div class="plan reveal">
          <div class="plan-name">Auto-claim <span class="plan-tag alt">New</span></div>
          <div class="plan-price">$2<small>per month</small></div>
          <p class="plan-desc">Keep the free coins, stop remembering to claim them.</p>
          <ul><li>We claim your 20 coins every 24h</li><li>No more paused bots after a busy day</li><li>Cheaper than Unlimited — you keep paying in coins</li></ul>
          <a href="#/register" class="btn btn-block">Start free trial</a>
        </div>
        <div class="plan reveal">
          <div class="plan-name">Extra bot slot <span class="plan-tag addon">Add-on</span></div>
          <div class="plan-price">$1<small>per month</small></div>
          <p class="plan-desc">One more bot, without jumping to Unlimited.</p>
          <ul><li>+1 bot slot per purchase — stack as many as you need</li><li>Works on any plan, including the free trial</li><li>Cancel by simply not renewing</li></ul>
          <a href="#/register" class="btn btn-block">Start free trial</a>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap section-split">
      <div class="section-head reveal"><span class="kicker">FAQ</span><h2>Questions</h2><p>The short answers.</p></div>
      <div class="faq reveal">
        <details><summary>What happens when my trial ends?</summary><p>Your bot keeps running as long as you have coins or a subscription. Each day of hosting costs 20 coins, which is exactly what one daily claim gives you.</p></details>
        <details><summary>What if I forget to claim?</summary><p>If your balance cannot cover the next day, the bot pauses and shows a notice on your dashboard. Claim your coins and press Start to bring it back. Your settings and session stay saved.</p></details>
        <details><summary>What is auto-claim?</summary><p>A $2/month add-on that claims your free coins for you. You still pay for hosting in coins, but you never have to remember the daily tap — so a busy day can't pause your bot. If you already pay for Unlimited, auto-claim is pointless and the dashboard will tell you so.</p></details>
        <details><summary>How do I run two bots?</summary><p>Each extra bot slot is $1/month and stacks on whatever plan you are on, including the free trial. Buy as many as you need from your dashboard — they all renew together and quietly expire if you stop paying, so there is nothing to cancel.</p></details>
        <details><summary>Can I stack coins?</summary><p>Yes, up to 140. That is a week of hosting if you want to claim less often.</p></details>
        <details><summary>How do I pay the $${price} a month?</summary><p>Use the Subscribe button on your dashboard. Once your payment is confirmed, your account switches to Unlimited.</p></details>
        <details><summary>Is it safe to use with my WhatsApp?</summary><p>The bot runs as a linked device, like WhatsApp Web. Your chats stay on WhatsApp and session IDs are never shown publicly. Still follow WhatsApp's rules: don't spam groups or blast random numbers.</p></details>
        <details><summary>Will I lose my account if the site restarts?</summary><p>No. Accounts, bots, coins and logins are backed up continuously and restored automatically.</p></details>
      </div>
    </div>
  </section>

  <section class="cta-band">
    <div class="wrap">
      <div class="cta-inner reveal">
        <div class="cta-orb" aria-hidden="true"></div>
        <div class="cta-copy">
          <h2>Get your bot online today.</h2>
          <p>Seven days free. No card. One bot per account.</p>
        </div>
        <a href="#/register" class="btn btn-lg">Start your free trial <span class="arrow">&rarr;</span></a>
      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="wrap">
      <span><b>Ladybug Cloud</b> by Ntandomods</span>
      <span>Not affiliated with WhatsApp Inc. Use at your own risk.</span>
    </div>
  </footer>`;
  initLanding();
}

/* ---------------- landing interactions ---------------- */
function initLanding() {
  // scroll reveal
  const items = $$('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el, i) => { el.style.transitionDelay = `${Math.min(i % 4, 3) * 70}ms`; io.observe(el); });
  }

  // nav shadow on scroll
  if (!window._navScroll) {
    window._navScroll = true;
    const nav = document.querySelector('.nav');
    const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // hero live log
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const heroLines = [
    ['12:00', 'Starting ladybug-mini', ''],
    ['12:01', 'Session loaded', ''],
    ['12:02', 'Connecting to WhatsApp...', ''],
    ['12:03', 'Connected. 42 commands ready', 'g'],
    ['12:04', 'Listening for messages', ''],
  ];
  const heroLog = $('#heroLog');
  if (heroLog) {
    heroLog.innerHTML = '';
    let i = 0;
    const push = () => {
      if (!$('#heroLog')) return;
      const [t, txt, cls] = heroLines[i];
      heroLog.insertAdjacentHTML('beforeend',
        `<div class="fl-line"><span class="fl-t">${t}</span><span class="${cls}">${txt}</span></div>`);
      heroLog.scrollTop = heroLog.scrollHeight;
      i++;
      if (i < heroLines.length) setTimeout(push, reduce ? 0 : 700);
    };
    push();
  }

  // bento terminal loop
  const bento = $('#bentoLog');
  if (bento) {
    const seq = [
      ['12:04:02', 'bot ready · 42 commands', 'g'],
      ['12:04:09', 'message from +27 82 *** · .sticker', ''],
      ['12:04:11', 'sticker generated in 640ms', 'g'],
      ['12:04:26', 'group antilink triggered · removed', 'w'],
      ['12:04:31', 'auto-restart check · healthy', 'g'],
      ['12:04:44', 'listening for messages', ''],
    ];
    let k = 0;
    const tick = () => {
      if (!$('#bentoLog')) return;
      const [t, txt, cls] = seq[k % seq.length];
      bento.insertAdjacentHTML('beforeend',
        `<div class="term-line"><span class="term-t">${t}</span><span class="${cls}">${txt}</span></div>`);
      if (bento.children.length > 6) bento.firstElementChild.remove();
      k++;
      setTimeout(tick, reduce ? 400 : 1600);
    };
    tick();
  }
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
                  <button class="btn btn-sm" data-ugrant="${u.id}" data-body='{"grantAutoClaimDays":30}' title="Grant 30 days of auto-claim">+auto-claim</button>
                  <button class="btn btn-sm" data-ugrant="${u.id}" data-body='{"grantSlotDays":30,"grantSlots":1}' title="Grant 1 extra bot slot for 30 days">+slot</button>
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
