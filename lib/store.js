/**
 * Tiny JSON file store — no native deps, safe on Render free tier.
 */
const fs = require('fs');
const path = require('path');

const mongoSync = require('./mongo-sync');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  users: [],
  bots: [],
  meta: { createdAt: new Date().toISOString(), version: 1 },
};

let data = null;
let writeTimer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (data) return data;
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      data.users = data.users || [];
      data.bots = data.bots || [];
      data.meta = data.meta || DEFAULTS.meta;
    } catch (e) {
      console.error('[store] corrupt db, starting fresh:', e.message);
      data = JSON.parse(JSON.stringify(DEFAULTS));
    }
  } else {
    data = JSON.parse(JSON.stringify(DEFAULTS));
    persistNow();
  }
  return data;
}

function persistNow() {
  try {
    ensureDir();
    const tmp = DB_FILE + '.tmp';
    data.meta = data.meta || {};
    data.meta.savedAt = Date.now();
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, DB_FILE);
    mongoSync.pushDb(json);
  } catch (e) {
    console.error('[store] write failed:', e.message);
  }
}

/** Debounced save so rapid mutations don't thrash the disk. */
function save() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    persistNow();
  }, 150);
}

const db = {
  get data() {
    return load();
  },
  save,
  flush: persistNow,

  // ---- users ----
  findUserByUsername(username) {
    return load().users.find(
      (u) => u.username.toLowerCase() === String(username).toLowerCase()
    );
  },
  findUserByEmail(email) {
    if (!email) return null;
    return load().users.find(
      (u) => u.email && u.email.toLowerCase() === String(email).toLowerCase()
    );
  },
  findUserById(id) {
    return load().users.find((u) => u.id === id);
  },
  addUser(user) {
    load().users.push(user);
    save();
    return user;
  },
  updateUser(id, patch) {
    const u = this.findUserById(id);
    if (!u) return null;
    Object.assign(u, patch);
    save();
    return u;
  },
  deleteUser(id) {
    const d = load();
    d.users = d.users.filter((u) => u.id !== id);
    d.bots = d.bots.filter((b) => b.userId !== id);
    save();
  },

  // ---- bots ----
  listBots() {
    return load().bots;
  },
  botsForUser(userId) {
    return load().bots.filter((b) => b.userId === userId);
  },
  findBotById(id) {
    return load().bots.find((b) => b.id === id);
  },
  addBot(bot) {
    load().bots.push(bot);
    save();
    return bot;
  },
  updateBot(id, patch) {
    const b = this.findBotById(id);
    if (!b) return null;
    Object.assign(b, patch);
    save();
    return b;
  },
  deleteBot(id) {
    const d = load();
    d.bots = d.bots.filter((b) => b.id !== id);
    save();
  },
};

module.exports = db;
