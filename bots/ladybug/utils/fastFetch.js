/**
 * fastFetch — the speed layer behind the premium downloaders.
 *
 * Three things make a downloader feel fast, and none of them are "a better API":
 *
 *   1. CACHE        Resolved media URLs are cached for 15 min. A repeat link
 *                   returns in ~0ms with no network call at all.
 *   2. DEDUPE       If five people paste the same link at once, one request is
 *                   made and all five await the same promise.
 *   3. RACING       Providers are hit in PARALLEL and the first success wins,
 *                   instead of trying them one after another. Worst case drops
 *                   from (sum of all timeouts) to (fastest provider).
 *
 * Every request is also hard-capped with an AbortController so a dead provider
 * can't hold the queue for three minutes the way the old 180s timeouts did.
 */

const axios = require('axios');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ cache */

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const CACHE_MAX = 300;

const cache = new Map(); // key -> { value, exp }
const inflight = new Map(); // key -> Promise

const stats = { hits: 0, misses: 0, dedupes: 0, races: 0, evictions: 0 };

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(key);
    return null;
  }
  // refresh LRU position
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value, ttl = CACHE_TTL) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
    stats.evictions++;
  }
  cache.set(key, { value, exp: Date.now() + ttl });
}

function cacheClear() {
  const n = cache.size;
  cache.clear();
  return n;
}

function cacheStats() {
  return { ...stats, size: cache.size, inflight: inflight.size, max: CACHE_MAX };
}

/**
 * Wrap a resolver with cache + in-flight dedupe.
 * `key` should uniquely identify the request (e.g. "tiktok:<url>").
 */
async function memo(key, resolver, ttl = CACHE_TTL) {
  const cached = cacheGet(key);
  if (cached) {
    stats.hits++;
    return { ...cached, _cached: true };
  }

  const running = inflight.get(key);
  if (running) {
    stats.dedupes++;
    return running;
  }

  stats.misses++;
  const p = (async () => {
    try {
      const value = await resolver();
      if (value) cacheSet(key, value, ttl);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/* ------------------------------------------------------------------ timing */

/** Reject after `ms`, and abort the underlying request if it supports it. */
function withTimeout(fn, ms, label = 'task') {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    Promise.resolve()
      .then(() => fn(controller.signal))
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

/**
 * Run providers in parallel, return the first one that yields a usable result.
 * Losers are aborted so they stop burning bandwidth.
 *
 * @param {Array<{name:string, run:(signal)=>Promise<any>}>} providers
 * @param {number} ms per-provider timeout
 */
async function race(providers, ms = 12000) {
  if (!providers.length) throw new Error('no providers');

  const controllers = providers.map(() => new AbortController());
  stats.races++;

  const attempts = providers.map((p, i) =>
    withTimeout((signal) => p.run(signal), ms, p.name)
      .then((value) => {
        if (!value) throw new Error(`${p.name} returned nothing`);
        // kill the losers
        controllers.forEach((c, j) => {
          if (j !== i) c.abort();
        });
        return { ...value, _provider: p.name };
      })
  );

  try {
    // Promise.any resolves on the first fulfilment
    return await Promise.any(attempts);
  } catch (err) {
    const reasons = err?.errors?.map((e) => e.message).join(' | ') || err.message;
    throw new Error(`all providers failed: ${reasons}`);
  }
}

/* ------------------------------------------------------------------ http */

const http = axios.create({
  timeout: 12000,
  headers: { 'User-Agent': UA, Accept: 'application/json, */*' },
  maxRedirects: 3,
});

/** GET JSON with a signal, returns data. */
async function getJSON(url, params, signal) {
  const { data } = await http.get(url, { params, signal });
  return data;
}

/** HEAD/GET just enough to confirm a media URL is live. */
async function isLive(url, signal) {
  try {
    const res = await http.get(url, {
      signal,
      responseType: 'stream',
      timeout: 6000,
      headers: { 'User-Agent': UA, Range: 'bytes=0-1023' },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    res.data.destroy?.();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ urls */

const PLATFORMS = [
  { id: 'tiktok', re: /(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i },
  { id: 'instagram', re: /(?:instagram\.com|instagr\.am)/i },
  { id: 'facebook', re: /(?:facebook\.com|fb\.watch|fb\.com)/i },
  { id: 'twitter', re: /(?:twitter\.com|x\.com|t\.co)/i },
  { id: 'youtube', re: /(?:youtube\.com|youtu\.be)/i },
  { id: 'pinterest', re: /(?:pinterest\.com|pin\.it)/i },
  { id: 'spotify', re: /(?:spotify\.com|spoti\.fi)/i },
];

function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[),.]+$/, '') : '';
}

function detectPlatform(url) {
  const p = PLATFORMS.find((x) => x.re.test(url));
  return p ? p.id : null;
}

module.exports = {
  memo,
  race,
  withTimeout,
  getJSON,
  isLive,
  extractUrl,
  detectPlatform,
  cacheClear,
  cacheStats,
  PLATFORMS,
  UA,
};
