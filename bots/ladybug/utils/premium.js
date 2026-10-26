/**
 * Premium tier — paid command gating for Ladybug Mini.
 *
 * Premium is granted per WhatsApp JID (the person paying), not per group.
 * Storage is a small JSON file so it survives restarts and is trivial to back up.
 *
 *   .premium add 254712345678 30     -> 30 days
 *   .premium remove 254712345678
 *   .premium list
 *   .premium info
 */

const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '..', 'data', 'premium.json');

function ensureDir() {
  const dir = path.dirname(STORE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    ensureDir();
    if (!fs.existsSync(STORE)) return {};
    const raw = fs.readFileSync(STORE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('[premium] failed to read store:', err.message);
    return {};
  }
}

function save(data) {
  try {
    ensureDir();
    fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('[premium] failed to write store:', err.message);
    return false;
  }
}

/** Normalise a JID down to its bare user id so @s.whatsapp.net and @lid agree. */
function key(jid) {
  if (!jid) return '';
  return String(jid).split('@')[0].split(':')[0];
}

/** True when the JID has an active, unexpired premium grant. */
function isPremium(jid) {
  const k = key(jid);
  if (!k) return false;
  const rec = load()[k];
  if (!rec) return false;
  if (!rec.expires) return true; // lifetime grant
  return Date.now() < rec.expires;
}

/** Days remaining, or null for lifetime / non-premium. */
function daysLeft(jid) {
  const rec = load()[key(jid)];
  if (!rec || !rec.expires) return null;
  const ms = rec.expires - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
}

/** Grant (or extend) premium for a JID. days <= 0 means lifetime. */
function grant(jid, days = 30, note = '') {
  const k = key(jid);
  if (!k) return null;
  const data = load();
  const existing = data[k];
  const base = existing && existing.expires && existing.expires > Date.now()
    ? existing.expires
    : Date.now();

  data[k] = {
    since: existing?.since || Date.now(),
    expires: days > 0 ? base + days * 86400000 : null,
    note: note || existing?.note || '',
  };
  save(data);
  return data[k];
}

function revoke(jid) {
  const k = key(jid);
  const data = load();
  if (!data[k]) return false;
  delete data[k];
  save(data);
  return true;
}

/** All active grants, newest first. Expired entries are pruned on read. */
function list() {
  const data = load();
  const now = Date.now();
  const out = [];
  let dirty = false;

  for (const [k, rec] of Object.entries(data)) {
    if (rec.expires && rec.expires <= now) {
      delete data[k];
      dirty = true;
      continue;
    }
    out.push({
      jid: k,
      since: rec.since,
      expires: rec.expires,
      note: rec.note || '',
      daysLeft: rec.expires ? Math.ceil((rec.expires - now) / 86400000) : null,
    });
  }

  if (dirty) save(data);
  return out.sort((a, b) => (b.since || 0) - (a.since || 0));
}

function count() {
  return list().length;
}

module.exports = {
  isPremium,
  daysLeft,
  grant,
  revoke,
  list,
  count,
  key,
  STORE,
};
