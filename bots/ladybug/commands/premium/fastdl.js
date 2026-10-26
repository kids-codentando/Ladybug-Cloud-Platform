/**
 * Premium · Fast downloaders.
 *
 * These are the same platforms as the free downloaders, but resolved through
 * utils/fastFetch.js which gives them three advantages:
 *
 *   - 15-minute URL cache      -> repeat links return instantly, zero network
 *   - in-flight dedupe         -> concurrent identical links share one request
 *   - parallel provider racing -> first provider to answer wins, losers aborted
 *   - 12s hard cap             -> no more 180s hangs on a dead endpoint
 *
 * Gated behind the premium tier (premium: true).
 */

const config = require('../../config');
const fast = require('../../utils/fastFetch');

const MEDIA_API = String(config.mediaApiUrl || '').replace(/\/$/, '');
const MEDIA_KEY = config.mediaApiKey || 'knight';
const PRINCE_API = String(config.princeApiUrl || '').replace(/\/$/, '');
const PRINCE_KEY = config.princeApiKey || 'prince';

const PER_PROVIDER_MS = 12000;

/* ------------------------------------------------------------------ helpers */

function pick(obj, keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => (o ? o[p] : undefined), obj);
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

function pickAll(obj, keys) {
  const out = [];
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => (o ? o[p] : undefined), obj);
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

function titleOf(data) {
  return (
    data?.result?.title ||
    data?.result?.desc ||
    data?.title ||
    data?.desc ||
    data?.result?.caption ||
    ''
  ).toString().slice(0, 200);
}

/* ------------------------------------------------------------------ providers */

/** Ladybug media API — the primary endpoint the free commands use. */
function mediaApi(path, extraParams = {}) {
  return {
    name: `media:${path}`,
    run: async (signal) => {
      if (!MEDIA_API) throw new Error('no media api configured');
      const data = await fast.getJSON(
        `${MEDIA_API}/api/download/${path}`,
        { apikey: MEDIA_KEY, ...extraParams },
        signal
      );
      if (!data?.success && !data?.result) throw new Error('media api: no result');

      const urls = pickAll(data, [
        'result.download',
        'result.dl_url',
        'result.dl',
        'result.url',
        'result.video',
        'result.audio',
        'result.mp4',
        'result.mp3',
        'result.hd',
        'result.hdplay',
        'result.wmplay',
        'result.medias.0.url',
        'result.data.0.url',
        'result.0.url',
      ]);
      if (!urls.length) throw new Error('media api: no url');

      return { url: urls[0], urls, title: titleOf(data), thumb: pick(data, ['result.thumbnail', 'result.thumb']) };
    },
  };
}

/** Prince Tech API — independent fallback, different infra. */
function princeApi(path, extraParams = {}) {
  return {
    name: `prince:${path}`,
    run: async (signal) => {
      if (!PRINCE_API) throw new Error('no prince api configured');
      const data = await fast.getJSON(
        `${PRINCE_API}/api/download/${path}`,
        { apikey: PRINCE_KEY, ...extraParams },
        signal
      );
      const urls = pickAll(data, [
        'result.download_url',
        'result.url',
        'result.dl_url',
        'result.download',
        'data.url',
        'data.download',
        'url',
      ]);
      if (!urls.length) throw new Error('prince: no url');
      return { url: urls[0], urls, title: titleOf(data), thumb: pick(data, ['result.thumbnail', 'thumbnail']) };
    },
  };
}

/** Provider sets per platform — raced in parallel. */
function providersFor(platform) {
  switch (platform) {
    case 'tiktok':
      return [mediaApi('tiktok'), princeApi('tiktok')];
    case 'instagram':
      return [mediaApi('instagram'), princeApi('instagram')];
    case 'facebook':
      return [mediaApi('facebook'), princeApi('facebook')];
    case 'twitter':
      return [mediaApi('twitter'), princeApi('twitter')];
    case 'youtube':
      return [mediaApi('ytmp4'), mediaApi('ytvideo'), princeApi('ytmp4')];
    case 'pinterest':
      return [mediaApi('pinterest'), princeApi('pinterest')];
    case 'spotify':
      return [mediaApi('spotify'), princeApi('spotify')];
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ sending */

async function sendMedia(sock, jid, msg, result, opts = {}) {
  const botName = (config.botName || 'Ladybug Mini').toUpperCase();
  const caption =
    `*DOWNLOADED BY ${botName}*` +
    (result.title ? `\n\n📝 ${result.title}` : '') +
    (result._cached ? '\n\n⚡ _from cache — instant_' : `\n\n⚡ _${result._provider || 'fast'}_`);

  const isAudio = opts.audio === true || /\.(mp3|m4a|opus|ogg)(\?|$)/i.test(result.url);

  if (isAudio) {
    await sock.sendMessage(
      jid,
      { audio: { url: result.url }, mimetype: 'audio/mpeg', fileName: `${result.title || 'audio'}.mp3` },
      { quoted: msg }
    );
    await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    return;
  }

  await sock.sendMessage(
    jid,
    { video: { url: result.url }, mimetype: 'video/mp4', caption },
    { quoted: msg }
  );
}

/* ------------------------------------------------------------------ commands */

function makeDownloader({ name, aliases, platforms, description, audio = false }) {
  return {
    name,
    aliases,
    category: 'premium',
    description,
    usage: `<url>`,
    premium: true,
    async execute(sock, msg, args, extra) {
      const p = extra.prefix || '.';
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        args.join(' ');

      const url = fast.extractUrl(text);
      if (!url) {
        return extra.reply(`Usage: ${p}${name} <link>\n\nSupports: ${platforms.join(', ')}`);
      }

      const platform = fast.detectPlatform(url);
      if (!platform || !platforms.includes(platform)) {
        return extra.reply(
          `❌ ${p}${name} handles: ${platforms.join(', ')}\n` +
            `That link looks like: ${platform || 'unknown'}`
        );
      }

      try {
        await sock.sendMessage(extra.from, { react: { text: '⚡', key: msg.key } });

        const result = await fast.memo(`${platform}:${url}:${audio ? 'a' : 'v'}`, () =>
          fast.race(providersFor(platform), PER_PROVIDER_MS)
        );

        if (!result?.url) throw new Error('no media url');

        await sendMedia(sock, extra.from, msg, result, { audio });
        await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
      } catch (err) {
        console.error(`[fastdl:${name}]`, err?.message || err);
        await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
        await extra.reply(
          `❌ Couldn't fetch that one.\n\n` +
            `_${String(err?.message || 'unknown error').slice(0, 120)}_\n\n` +
            `Try a different link, or use ${p}${name === 'fastdl' ? 'tiktok' : name} as a fallback.`
        );
      }
    },
  };
}

const commands = [
  makeDownloader({
    name: 'fastdl',
    aliases: ['fast', 'fdl', 'quickdl'],
    platforms: ['tiktok', 'instagram', 'facebook', 'twitter', 'youtube', 'pinterest'],
    description: 'Fastest downloader — auto-detects platform (premium)',
  }),
  makeDownloader({
    name: 'fasttt',
    aliases: ['ftiktok', 'ttfast'],
    platforms: ['tiktok'],
    description: 'Fast TikTok downloader (premium)',
  }),
  makeDownloader({
    name: 'fastig',
    aliases: ['fig', 'igfast'],
    platforms: ['instagram'],
    description: 'Fast Instagram downloader (premium)',
  }),
  makeDownloader({
    name: 'fastfb',
    aliases: ['ffb', 'fbfast'],
    platforms: ['facebook'],
    description: 'Fast Facebook downloader (premium)',
  }),
  makeDownloader({
    name: 'fastx',
    aliases: ['ftwitter', 'xfast'],
    platforms: ['twitter'],
    description: 'Fast Twitter/X downloader (premium)',
  }),
  makeDownloader({
    name: 'fastyt',
    aliases: ['fyt', 'ytfast'],
    platforms: ['youtube'],
    description: 'Fast YouTube video downloader (premium)',
  }),
  makeDownloader({
    name: 'fastmp3',
    aliases: ['fmp3', 'mp3fast'],
    platforms: ['youtube', 'spotify'],
    description: 'Fast audio downloader (premium)',
    audio: true,
  }),
  {
    name: 'fastcache',
    aliases: ['dlcache', 'cacheinfo'],
    category: 'premium',
    description: 'Show fast-downloader cache stats (premium)',
    usage: '[clear]',
    premium: true,
    async execute(sock, msg, args, extra) {
      const p = extra.prefix || '.';

      if ((args[0] || '').toLowerCase() === 'clear') {
        const n = fast.cacheClear();
        return extra.reply(`🧹 Cleared *${n}* cached link${n === 1 ? '' : 's'}.`);
      }

      const s = fast.cacheStats();
      const hitRate = s.hits + s.misses > 0
        ? ((s.hits / (s.hits + s.misses)) * 100).toFixed(1)
        : '0.0';

      await extra.reply(
        `⚡ *Fast downloader cache*\n\n` +
          `Cached links: *${s.size}* / ${s.max}\n` +
          `Cache hits: *${s.hits}*\n` +
          `Cache misses: *${s.misses}*\n` +
          `Hit rate: *${hitRate}%*\n` +
          `Deduped requests: *${s.dedupes}*\n` +
          `Provider races: *${s.races}*\n` +
          `Evictions: *${s.evictions}*\n` +
          `In flight: *${s.inflight}*\n\n` +
          `Clear with: ${p}fastcache clear`
      );
    },
  },
];

module.exports = commands;
