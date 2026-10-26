/**
 * Billing rules for Ladybug Cloud.
 *
 *  1. Every new account gets a FREE TRIAL (default 7 days) for its bot.
 *  2. After the trial a bot keeps running if EITHER
 *       - the owner has an active $3/month subscription, OR
 *       - the owner pays for it with coins (default 20 coins per day of runtime).
 *  3. Every user can CLAIM free coins once per day (default 20), so claiming
 *     daily keeps one bot running for free.
 *  4. AUTO-CLAIM is a $2/month add-on: the server claims the daily coins for
 *     you, so a forgotten claim can no longer pause a running bot.
 *
 * Everything is configurable through environment variables.
 */
const num = (v, d) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

const DAY = 24 * 60 * 60 * 1000;

const cfg = {
  trialDays: num(process.env.TRIAL_DAYS, 7),
  claimCoins: num(process.env.CLAIM_COINS, 20),
  claimCooldownHours: num(process.env.CLAIM_COOLDOWN_HOURS, 24),
  maxCoins: num(process.env.MAX_COINS, 140),
  botCoinCost: num(process.env.BOT_COIN_COST, 20), // coins per period
  botPeriodDays: num(process.env.BOT_COIN_PERIOD_DAYS, 1), // days of runtime one payment buys
  priceUsd: num(process.env.SUBSCRIPTION_PRICE_USD, 3),
  subscriptionDays: num(process.env.SUBSCRIPTION_DAYS, 30),
  paymentUrl: process.env.PAYMENT_URL || '',
  autoClaimPriceUsd: num(process.env.AUTOCLAIM_PRICE_USD, 2),
  autoClaimDays: num(process.env.AUTOCLAIM_DAYS, 30),
  autoClaimPaymentUrl:
    process.env.AUTOCLAIM_PAYMENT_URL || process.env.PAYMENT_URL || '',
};

const periodMs = () => cfg.botPeriodDays * DAY;

function trialEndsAt(user) {
  return user.trialEndsAt || null;
}

function mode(user, at = Date.now()) {
  if (user.isAdmin) return 'admin';
  if (user.subscriptionUntil && user.subscriptionUntil > at) return 'subscription';
  if (user.trialEndsAt && user.trialEndsAt > at) return 'trial';
  return 'coins';
}

/** True when the user's bots run without spending coins. */
function runsFree(user, at = Date.now()) {
  return mode(user, at) !== 'coins';
}

function nextClaimAt(user) {
  if (!user.lastClaimAt) return 0;
  return user.lastClaimAt + cfg.claimCooldownHours * 3600 * 1000;
}

function canClaim(user, at = Date.now()) {
  return at >= nextClaimAt(user);
}

function logCoin(user, delta, reason) {
  user.coinLog = user.coinLog || [];
  user.coinLog.unshift({ at: Date.now(), delta, reason, balance: user.coins });
  user.coinLog.length = Math.min(user.coinLog.length, 30);
}

function claim(user) {
  const at = Date.now();
  if (!canClaim(user, at)) return { ok: false, nextClaimAt: nextClaimAt(user) };
  const before = user.coins || 0;
  user.coins = Math.min(cfg.maxCoins, before + cfg.claimCoins);
  user.lastClaimAt = at;
  logCoin(user, user.coins - before, 'Daily claim');
  return { ok: true, added: user.coins - before, coins: user.coins, nextClaimAt: nextClaimAt(user) };
}

/** Try to fund a bot with coins. Mutates user + returns the new paid-until (or null). */
function charge(user, bot) {
  const at = Date.now();
  if ((user.coins || 0) < cfg.botCoinCost) return null;
  user.coins -= cfg.botCoinCost;
  const base = bot.coinPaidUntil && bot.coinPaidUntil > at ? bot.coinPaidUntil : at;
  const until = base + periodMs();
  logCoin(user, -cfg.botCoinCost, `Bot "${bot.name}" runtime`);
  return until;
}

/**
 * Decide whether a bot may run right now.
 * Returns { ok, until?, reason?, charged? }. When ok and `charged` is set,
 * the caller must persist user + bot.coinPaidUntil.
 */
function authorize(user, bot) {
  const at = Date.now();
  if (runsFree(user, at)) return { ok: true, free: true };
  if (bot.coinPaidUntil && bot.coinPaidUntil > at) return { ok: true, until: bot.coinPaidUntil };
  const until = charge(user, bot);
  if (until) return { ok: true, until, charged: true };
  return {
    ok: false,
    reason: `Free trial ended and you don't have enough coins. A bot costs ${cfg.botCoinCost} coins per ${
      cfg.botPeriodDays === 1 ? 'day' : cfg.botPeriodDays + ' days'
    }. Claim your ${cfg.claimCoins} free daily coins or subscribe for $${cfg.priceUsd}/month.`,
  };
}

/* ------------------------------------------------------------------ auto-claim */

/** Is the paid auto-claim add-on live for this user right now? */
function autoClaimActive(user, at = Date.now()) {
  return !!(user && user.autoClaimUntil && user.autoClaimUntil > at);
}

function autoClaimDaysLeft(user, at = Date.now()) {
  if (!autoClaimActive(user, at)) return 0;
  return Math.max(0, Math.ceil((user.autoClaimUntil - at) / DAY));
}

/** Extend (or start) the add-on. days <= 0 turns it off. */
function grantAutoClaim(user, days = cfg.autoClaimDays) {
  const at = Date.now();
  if (days <= 0) {
    user.autoClaimUntil = null;
    return null;
  }
  const base = user.autoClaimUntil && user.autoClaimUntil > at ? user.autoClaimUntil : at;
  user.autoClaimUntil = base + days * DAY;
  return user.autoClaimUntil;
}

/**
 * Should the server claim for this user right now?
 * Skips when the balance is already at the cap — claiming then would add 0 and
 * burn the cooldown, which would be worse than doing nothing.
 */
function autoClaimDue(user, at = Date.now()) {
  if (!autoClaimActive(user, at)) return false;
  if (!canClaim(user, at)) return false;
  return (user.coins || 0) < cfg.maxCoins;
}

/**
 * Run the auto-claim pass over a list of users.
 * Returns the users that were actually topped up, so the caller can persist.
 * @param {Array} users
 * @returns {Array<{user:object, added:number, coins:number}>}
 */
function runAutoClaims(users) {
  const at = Date.now();
  const done = [];
  for (const user of users || []) {
    if (!autoClaimDue(user, at)) continue;
    const r = claim(user);
    if (!r.ok) continue;
    // Re-label the log entry so the dashboard shows why the coins appeared.
    if (user.coinLog && user.coinLog[0]) user.coinLog[0].reason = 'Auto-claim';
    done.push({ user, added: r.added, coins: r.coins });
  }
  return done;
}

function summary(user) {
  const at = Date.now();
  return {
    mode: mode(user, at),
    trialEndsAt: trialEndsAt(user),
    subscriptionUntil: user.subscriptionUntil || null,
    coins: user.coins || 0,
    canClaim: canClaim(user, at),
    nextClaimAt: nextClaimAt(user) || null,
    log: (user.coinLog || []).slice(0, 10),
    autoClaim: {
      active: autoClaimActive(user, at),
      until: user.autoClaimUntil || null,
      daysLeft: autoClaimDaysLeft(user, at),
      priceUsd: cfg.autoClaimPriceUsd,
      days: cfg.autoClaimDays,
      requested: !!user.autoClaimRequestedAt,
      paymentUrl: cfg.autoClaimPaymentUrl,
      // True when the add-on is pointless because coins already run free.
      // Only a paid Unlimited subscription makes auto-claim pointless. The free
      // trial also "runs free" but expires, so we do not flag it as redundant.
      redundant: mode(user, at) === 'subscription',
    },
    config: {
      trialDays: cfg.trialDays,
      claimCoins: cfg.claimCoins,
      botCoinCost: cfg.botCoinCost,
      botPeriodDays: cfg.botPeriodDays,
      priceUsd: cfg.priceUsd,
      subscriptionDays: cfg.subscriptionDays,
      maxCoins: cfg.maxCoins,
      paymentUrl: cfg.paymentUrl,
      autoClaimPriceUsd: cfg.autoClaimPriceUsd,
      autoClaimDays: cfg.autoClaimDays,
    },
  };
}

module.exports = {
  cfg,
  DAY,
  mode,
  runsFree,
  canClaim,
  nextClaimAt,
  claim,
  authorize,
  summary,
  autoClaimActive,
  autoClaimDaysLeft,
  autoClaimDue,
  grantAutoClaim,
  runAutoClaims,
};
