/**
 * Ladybug Cloud — Multi-tenant WhatsApp bot hosting
 * Made under Ntandomods
 */
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const db = require('./lib/store');
const bots = require('./lib/bots');
const installer = require('./lib/installer');
const sessiongen = require('./lib/sessiongen');
const FileSessionStore = require('./lib/session-store');
const billing = require('./lib/billing');
const mongoSync = require('./lib/mongo-sync');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Ntando';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mods';
const FREE_BOT_LIMIT = parseInt(process.env.FREE_BOT_LIMIT || '1', 10);
const PRO_BOT_LIMIT = parseInt(process.env.PRO_BOT_LIMIT || '10', 10);

// ---------------------------------------------------------------- middleware
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
// Login sessions never expire: they are stored on disk (survive restarts and
// redeploys), the signing secret is stable, and the cookie lasts ~10 years and
// is refreshed on every request. Users only get logged out by pressing Logout.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch (e) { /* first boot */ }
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, secret, { mode: 0o600 }); mongoSync.syncSecret().catch(() => {}); } catch (e) { console.error('[sessions] could not persist secret:', e.message); }
  return secret;
}

app.use(
  session({
    store: new FileSessionStore(path.join(DATA_DIR, 'sessions')),
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
      maxAge: 1000 * 60 * 60 * 24 * 365 * 10,
    },
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 }, // 60MB
});

// ---------------------------------------------------------------- helpers
const uid = () => crypto.randomBytes(9).toString('hex');

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    plan: u.plan || 'free',
    isAdmin: !!u.isAdmin,
    botLimit: billing.botLimitFor(u),
    createdAt: u.createdAt,
    lastLogin: u.lastLogin || null,
    billingMode: billing.mode(u),
    trialEndsAt: u.trialEndsAt || null,
    subscriptionUntil: u.subscriptionUntil || null,
    coins: u.coins || 0,
    autoClaimUntil: u.autoClaimUntil || null,
    extraSlots: billing.extraSlotCount(u),
    extraSlotsUntil: u.extraSlotsUntil || null,
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.findUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Session expired' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

function botView(bot) {
  const st = bots.status(bot.id);
  return {
    id: bot.id,
    name: bot.name,
    sessionIdMasked: bot.sessionId
      ? `${bot.sessionId.slice(0, 12)}${'•'.repeat(Math.max(0, Math.min(20, bot.sessionId.length - 12)))}`
      : '',
    hasSession: !!bot.sessionId,
    autoRestart: bot.autoRestart !== false,
    createdAt: bot.createdAt,
    status: st.status,
    running: st.running,
    pid: st.pid,
    startedAt: st.startedAt,
    restarts: st.restarts,
    lastError: st.lastError,
    coinPaidUntil: bot.coinPaidUntil || null,
    suspendedReason: bot.suspendedReason || null,
  };
}

// ---------------------------------------------------------------- bootstrap admin
(function ensureAdmin() {
  let admin = db.findUserByUsername(ADMIN_USERNAME);
  if (!admin) {
    admin = {
      id: uid(),
      username: ADMIN_USERNAME,
      email: 'admin@ntandomods.local',
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      isAdmin: true,
      plan: 'pro',
      botLimit: 999,
      createdAt: new Date().toISOString(),
    };
    db.addUser(admin);
    console.log(`[boot] Admin account created: ${ADMIN_USERNAME}`);
  } else if (!admin.isAdmin) {
    db.updateUser(admin.id, { isAdmin: true, plan: 'pro', botLimit: 999 });
  }
})();

// Existing accounts from before billing existed get a fresh trial from now.
(function grandfatherUsers() {
  let n = 0;
  for (const u of db.data.users) {
    if (!u.isAdmin && !u.trialEndsAt) {
      u.trialEndsAt = Date.now() + billing.cfg.trialDays * billing.DAY;
      n++;
    }
    if (typeof u.coins !== 'number') u.coins = 0;
  }
  if (n) { db.save(); console.log(`[billing] granted a ${billing.cfg.trialDays}-day trial to ${n} existing user(s)`); }
})();

// ---------------------------------------------------------------- auth routes
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (String(username).length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.findUserByUsername(username)) return res.status(409).json({ error: 'Username already taken' });
  if (email && db.findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });

  const user = {
    id: uid(),
    username: String(username).trim(),
    email: email ? String(email).trim() : null,
    passwordHash: bcrypt.hashSync(String(password), 10),
    isAdmin: false,
    plan: 'free',
    botLimit: FREE_BOT_LIMIT,
    createdAt: new Date().toISOString(),
    trialEndsAt: Date.now() + billing.cfg.trialDays * billing.DAY,
    coins: 0,
  };
  db.addUser(user);
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const user = db.findUserByUsername(username);
  if (!user || !bcrypt.compareSync(String(password), user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  db.updateUser(user.id, { lastLogin: new Date().toISOString() });
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.findUserById(req.session.userId);
  res.json({ user: user ? publicUser(user) : null });
});

// ---------------------------------------------------------------- billing / coins
app.get('/api/billing', requireAuth, (req, res) => {
  res.json(billing.summary(req.user));
});

app.post('/api/coins/claim', requireAuth, (req, res) => {
  const r = billing.claim(req.user);
  if (!r.ok) {
    return res.status(429).json({ error: 'You already claimed today. Come back later!', nextClaimAt: r.nextClaimAt });
  }
  db.save();
  res.json({ ok: true, ...r, billing: billing.summary(req.user) });
});

// Auto-claim add-on ($2/month): the server claims the daily coins for you.
app.post('/api/billing/autoclaim', requireAuth, (req, res) => {
  const b = billing.summary(req.user);
  if (b.autoClaim.active) {
    return res.status(409).json({ error: 'Auto-claim is already active.', billing: b });
  }
  if (!billing.cfg.autoClaimPaymentUrl) {
    // No checkout configured: record the intent so the admin can see it.
    if (req.user.autoClaimRequestedAt) {
      return res.status(409).json({
        error: 'Your auto-claim request is already pending. The admin will activate it shortly.',
        billing: b,
      });
    }
    req.user.autoClaimRequestedAt = Date.now();
    db.save();
    return res.json({
      ok: true,
      manual: true,
      message:
        `Auto-claim costs $${billing.cfg.autoClaimPriceUsd}/month. ` +
        'Your request has been recorded - the admin will activate it for you.',
      billing: billing.summary(req.user),
    });
  }
  const url = billing.cfg.autoClaimPaymentUrl;
  res.json({
    ok: true,
    url:
      `${url}${url.includes('?') ? '&' : '?'}plan=autoclaim` +
      `&client_reference_id=${encodeURIComponent(req.user.username)}`,
  });
});

// Extra bot slot add-on ($1/month each): stacks on top of the plan limit.
app.post('/api/billing/slots', requireAuth, (req, res) => {
  const b = billing.summary(req.user);
  const want = Math.max(1, Math.min(5, parseInt(req.body && req.body.count, 10) || 1));
  if (!billing.cfg.slotPaymentUrl) {
    // No checkout configured: record the intent so the admin can see it.
    if (req.user.slotRequestedAt) {
      return res.status(409).json({
        error: 'Your slot request is already pending. The admin will activate it shortly.',
        billing: b,
      });
    }
    req.user.slotRequestedAt = Date.now();
    req.user.slotRequestedCount = want;
    db.save();
    return res.json({
      ok: true,
      manual: true,
      message:
        `An extra bot slot costs $${billing.cfg.slotPriceUsd}/month. ` +
        'Your request has been recorded - the admin will activate it for you.',
      billing: billing.summary(req.user),
    });
  }
  const url = billing.cfg.slotPaymentUrl;
  res.json({
    ok: true,
    url:
      `${url}${url.includes('?') ? '&' : '?'}plan=slot&qty=${want}` +
      `&client_reference_id=${encodeURIComponent(req.user.username)}`,
  });
});

// ---------------------------------------------------------------- user bots
app.get('/api/bots', requireAuth, (req, res) => {
  const list = db.botsForUser(req.user.id).map(botView);
  res.json({ bots: list, limit: billing.botLimitFor(req.user) });
});

app.post('/api/bots', requireAuth, (req, res) => {
  const { name, sessionId } = req.body || {};
  const owned = db.botsForUser(req.user.id);
  const limit = billing.botLimitFor(req.user);
  if (owned.length >= limit) {
    return res.status(403).json({
      error:
        `Bot limit reached (${limit}). Add an extra slot for $${billing.cfg.slotPriceUsd}/month, ` +
        'upgrade to Unlimited, or contact the admin.',
      limit,
    });
  }
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Bot name is required' });
  if (!sessionId || !String(sessionId).trim()) return res.status(400).json({ error: 'Session ID is required' });

  // One WhatsApp session = one connection. Reusing a session across bots makes
  // WhatsApp answer with "Stream Errored (conflict)" and both bots flap forever.
  const clash = db
    .listBots()
    .find((b) => b.sessionId && b.sessionId === String(sessionId).trim());
  if (clash) {
    return res.status(409).json({
      error: `That session ID is already used by the bot "${clash.name}". Each bot needs its own WhatsApp session.`,
    });
  }

  const bot = {
    id: uid(),
    userId: req.user.id,
    name: String(name).trim().slice(0, 40),
    sessionId: String(sessionId).trim(),
    autoRestart: true,
    createdAt: new Date().toISOString(),
    status: 'stopped',
  };
  db.addBot(bot);
  res.json({ ok: true, bot: botView(bot) });
});

function ownBot(req, res) {
  const bot = db.findBotById(req.params.id);
  if (!bot) {
    res.status(404).json({ error: 'Bot not found' });
    return null;
  }
  if (bot.userId !== req.user.id && !req.user.isAdmin) {
    res.status(403).json({ error: 'Not your bot' });
    return null;
  }
  return bot;
}

app.patch('/api/bots/:id', requireAuth, (req, res) => {
  const bot = ownBot(req, res);
  if (!bot) return;
  const patch = {};
  if (req.body.name) patch.name = String(req.body.name).trim().slice(0, 40);
  if (typeof req.body.sessionId === 'string' && req.body.sessionId.trim()) {
    const nextSession = req.body.sessionId.trim();
    const clash = db
      .listBots()
      .find((b) => b.id !== bot.id && b.sessionId && b.sessionId === nextSession);
    if (clash) {
      return res.status(409).json({
        error: `That session ID is already used by the bot "${clash.name}". Each bot needs its own WhatsApp session.`,
      });
    }
    patch.sessionId = nextSession;
  }
  if (typeof req.body.autoRestart === 'boolean') patch.autoRestart = req.body.autoRestart;
  db.updateBot(bot.id, patch);
  res.json({ ok: true, bot: botView(db.findBotById(bot.id)) });
});

app.delete('/api/bots/:id', requireAuth, (req, res) => {
  const bot = ownBot(req, res);
  if (!bot) return;
  bots.stop(bot.id);
  db.deleteBot(bot.id);
  res.json({ ok: true });
});

app.post('/api/bots/:id/start', requireAuth, (req, res) => {
  const bot = ownBot(req, res);
  if (!bot) return;

  // Safety net: if another bot is still running on the same session, stop it
  // first. Two sockets on one session always end in a conflict loop.
  const twin = db
    .listBots()
    .find((b) => b.id !== bot.id && b.sessionId && b.sessionId === bot.sessionId);
  if (twin && bots.status(twin.id).running) {
    bots.stop(twin.id);
    db.updateBot(twin.id, { status: 'stopped' });
  }

  const owner = db.findUserById(bot.userId) || req.user;
  const auth = billing.authorize(owner, bot);
  if (!auth.ok) return res.status(402).json({ error: auth.reason, billing: billing.summary(owner) });
  if (auth.charged) db.save();
  db.updateBot(bot.id, { status: 'running', suspendedReason: null, ...(auth.until ? { coinPaidUntil: auth.until } : {}) });
  const r = bots.start(db.findBotById(bot.id));
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, preparing: !!r.preparing, message: r.message, status: bots.status(bot.id) });
});

app.post('/api/bots/:id/stop', requireAuth, (req, res) => {
  const bot = ownBot(req, res);
  if (!bot) return;
  db.updateBot(bot.id, { status: 'stopped' });
  bots.stop(bot.id);
  res.json({ ok: true, status: bots.status(bot.id) });
});

app.post('/api/bots/:id/restart', requireAuth, (req, res) => {
  const bot = ownBot(req, res);
  if (!bot) return;
  const owner = db.findUserById(bot.userId) || req.user;
  const auth = billing.authorize(owner, bot);
  if (!auth.ok) return res.status(402).json({ error: auth.reason, billing: billing.summary(owner) });
  if (auth.charged) db.save();
  db.updateBot(bot.id, { status: 'running', suspendedReason: null, ...(auth.until ? { coinPaidUntil: auth.until } : {}) });
  bots.restart(db.findBotById(bot.id));
  res.json({ ok: true });
});

app.get('/api/bots/:id/logs', requireAuth, (req, res) => {
  const bot = ownBot(req, res);
  if (!bot) return;
  res.json({ logs: bots.logs(bot.id, parseInt(req.query.limit || '200', 10)), status: bots.status(bot.id) });
});

app.delete('/api/bots/:id/logs', requireAuth, (req, res) => {
  const bot = ownBot(req, res);
  if (!bot) return;
  bots.clearLogs(bot.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- sessions
// In-browser session generator: request a pairing code, then poll for the
// finished `Ladybug!...` session id.
app.post('/api/session/pair', requireAuth, (req, res) => {
  try {
    const job = sessiongen.start((req.body || {}).phone);
    res.json({ ok: true, job });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/session/pair/:id', requireAuth, (req, res) => {
  const job = sessiongen.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Pairing job not found or expired.' });
  res.json({ job });
});

app.delete('/api/session/pair/:id', requireAuth, (req, res) => {
  sessiongen.cancel(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- public status
app.get('/api/status', (req, res) => {
  const allBots = db.listBots();
  const users = db.data.users || [];
  const running = allBots.filter((b) => bots.status(b.id).running).length;
  const installed = bots.botCodeInstalled();
  res.json({
    ok: true,
    platform: 'Ladybug Cloud',
    brand: 'Ntandomods',
    uptime: Math.round(process.uptime()),
    installed,
    stats: {
      users: users.length,
      bots: allBots.length,
      running,
      stopped: allBots.length - running,
    },
    bots: allBots
      .map((b) => {
        const st = bots.status(b.id);
        return {
          id: b.id,
          name: b.name,
          status: st.status,
          running: st.running,
          startedAt: st.startedAt,
          uptime: st.startedAt ? Math.round((Date.now() - st.startedAt) / 1000) : 0,
        };
      })
      .sort((a, b) => Number(b.running) - Number(a.running))
      .slice(0, 50),
    generatedAt: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------- admin
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const data = db.data;
  const mem = process.memoryUsage();
  res.json({
    users: data.users.length,
    admins: data.users.filter((u) => u.isAdmin).length,
    bots: data.bots.length,
    running: bots.runningCount(),
    installed: installer.getState().installed,
    uptime: process.uptime(),
    memory: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
    loadavg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    platform: `${os.type()} ${os.release()}`,
    node: process.version,
    cpus: os.cpus().length,
    backup: mongoSync.status(),
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.data.users.map((u) => ({
    ...publicUser(u),
    botCount: db.botsForUser(u.id).length,
  }));
  res.json({ users });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = db.findUserById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const patch = {};
  if (req.body.plan) {
    patch.plan = req.body.plan;
    patch.botLimit = req.body.plan === 'pro' ? PRO_BOT_LIMIT : FREE_BOT_LIMIT;
  }
  if (typeof req.body.botLimit === 'number') patch.botLimit = req.body.botLimit;
  if (typeof req.body.isAdmin === 'boolean') patch.isAdmin = req.body.isAdmin;
  if (typeof req.body.grantSubscriptionDays === 'number') {
    const days = req.body.grantSubscriptionDays;
    const base = u.subscriptionUntil && u.subscriptionUntil > Date.now() ? u.subscriptionUntil : Date.now();
    patch.subscriptionUntil = days <= 0 ? null : base + days * billing.DAY;
  }
  if (typeof req.body.grantCoins === 'number') {
    u.coins = Math.max(0, (u.coins || 0) + Math.round(req.body.grantCoins));
    patch.coins = u.coins;
  }
  if (typeof req.body.grantAutoClaimDays === 'number') {
    const days = req.body.grantAutoClaimDays;
    patch.autoClaimUntil = days <= 0 ? null : billing.grantAutoClaim(u, days);
    patch.autoClaimRequestedAt = null;
  }
  if (typeof req.body.grantSlotDays === 'number') {
    const days = req.body.grantSlotDays;
    const count = Math.max(1, Math.min(10, Math.round(req.body.grantSlots || 1)));
    if (days <= 0) {
      billing.grantExtraSlots(u, 0, 0);
      patch.extraSlots = 0;
      patch.extraSlotsUntil = null;
    } else {
      const r = billing.grantExtraSlots(u, count, days);
      patch.extraSlots = r.slots;
      patch.extraSlotsUntil = r.until;
    }
    patch.slotRequestedAt = null;
    patch.slotRequestedCount = null;
  }
  if (typeof req.body.extendTrialDays === 'number') {
    const base = u.trialEndsAt && u.trialEndsAt > Date.now() ? u.trialEndsAt : Date.now();
    patch.trialEndsAt = base + req.body.extendTrialDays * billing.DAY;
  }
  if (req.body.password) patch.passwordHash = bcrypt.hashSync(String(req.body.password), 10);
  db.updateUser(u.id, patch);
  res.json({ ok: true, user: publicUser(db.findUserById(u.id)) });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = db.findUserById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own admin account' });
  for (const b of db.botsForUser(u.id)) bots.stop(b.id);
  db.deleteUser(u.id);
  res.json({ ok: true });
});

app.get('/api/admin/bots', requireAdmin, (req, res) => {
  const list = db.data.bots.map((b) => {
    const owner = db.findUserById(b.userId);
    return { ...botView(b), owner: owner ? owner.username : 'deleted' };
  });
  res.json({ bots: list });
});

app.post('/api/admin/bots/:id/stop', requireAdmin, (req, res) => {
  const bot = db.findBotById(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  db.updateBot(bot.id, { status: 'stopped' });
  bots.stop(bot.id);
  res.json({ ok: true });
});

app.delete('/api/admin/bots/:id', requireAdmin, (req, res) => {
  const bot = db.findBotById(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  bots.stop(bot.id);
  db.deleteBot(bot.id);
  res.json({ ok: true });
});

// --- bot code installer ---
app.get('/api/admin/installer', requireAdmin, (req, res) => {
  res.json(installer.getState());
});

app.post('/api/admin/installer/github', requireAdmin, async (req, res) => {
  try {
    const url = req.body && req.body.url ? String(req.body.url) : undefined;
    const r = await installer.installFromGitHub(url);
    res.json({ ok: true, ...r, state: installer.getState() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/installer/upload', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const r = await installer.installFromBuffer(req.file.buffer, req.file.originalname);
    res.json({ ok: true, ...r, state: installer.getState() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/installer/deps', requireAdmin, (req, res) => {
  const r = installer.installDependencies();
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- static
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------- boot
const server = app.listen(PORT, () => {
  console.log(`\n🐞 Ladybug Cloud running on port ${PORT}`);
  console.log(`   Admin: ${ADMIN_USERNAME}`);
  console.log(`   Bot code installed: ${installer.getState().installed ? 'yes' : 'no'}`);
});

// Resume bots that were running before a restart. On ephemeral filesystems the
// bot's node_modules may be gone, so make sure they exist first.
setTimeout(async () => {
  const pending = db.data.bots.filter((b) => b.status === 'running' && b.sessionId);
  if (!pending.length) return;

  if (installer.getState().installed && !installer.depsInstalled()) {
    console.log('[boot] Bot dependencies missing — installing before resume...');
    try {
      await installer.ensureDependencies((line) => console.log(`[deps] ${line}`));
      console.log('[boot] Dependencies ready.');
    } catch (e) {
      console.error(`[boot] Dependency install failed: ${e.message}`);
    }
  }

  for (const bot of pending) {
    console.log(`[boot] Resuming bot "${bot.name}"`);
    bots.start(bot);
  }
}, 3000);

// Every minute: renew coin-funded bots, stop the ones that can no longer pay,
// and top up anyone paying for auto-claim.
function billingTick() {
  try {
    const claimed = billing.runAutoClaims(db.data.users);
    if (claimed.length) {
      db.save();
      for (const c of claimed) {
        console.log(`[auto-claim] +${c.added} coins for ${c.user.username} (balance ${c.coins})`);
      }
    }
  } catch (e) {
    console.error(`[auto-claim] pass failed: ${e.message}`);
  }

  for (const bot of db.listBots()) {
    if (bot.status !== 'running' && !bots.status(bot.id).running) continue;
    const owner = db.findUserById(bot.userId);
    if (!owner) continue;
    const auth = billing.authorize(owner, bot);
    if (auth.ok) {
      if (auth.charged) {
        db.updateBot(bot.id, { coinPaidUntil: auth.until });
        db.save();
        console.log(`[billing] renewed "${bot.name}" for ${owner.username}`);
      }
      continue;
    }
    console.log(`[billing] stopping "${bot.name}" (${owner.username}): out of coins`);
    bots.stop(bot.id);
    db.updateBot(bot.id, { status: 'stopped', suspendedReason: 'Out of coins - claim daily coins or subscribe, then press Start.' });
  }
}
setInterval(billingTick, 60 * 1000).unref();
setTimeout(billingTick, 5000).unref();

function shutdown() {
  console.log('\n[shutdown] stopping bots...');
  bots.stopAll();
  db.flush();
  mongoSync.close().finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
