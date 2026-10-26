/**
 * Premium · Fast pack — text styling.
 *
 * Every command here is O(n) string work with no network, no ffmpeg, no disk.
 * They return in under a millisecond, which is what makes them feel premium:
 * instant reply, no "processing…" wait.
 *
 * Gated behind the premium tier (premium: true).
 */

const crypto = require('crypto');

/* ------------------------------------------------------------------ helpers */

const MAX = 400;

function tooLong(text) {
  return text.length > MAX;
}

/* --- unicode font styles -------------------------------------------------- */

function mathAlnum(upper, lower, digit) {
  return (ch) => {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(upper + (c - 65));
    if (c >= 97 && c <= 122) return String.fromCodePoint(lower + (c - 97));
    if (digit && c >= 48 && c <= 57) return String.fromCodePoint(digit + (c - 48));
    return ch;
  };
}

const SMALLCAPS = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ',
  k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ',
  u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
};

const LEET = {
  a: '4', b: '8', e: '3', g: '6', i: '1', l: '1', o: '0', s: '5', t: '7', z: '2',
};

const STYLES = {
  bold: mathAlnum(0x1d400, 0x1d41a, 0x1d7ce),
  mono: mathAlnum(0x1d670, 0x1d68a, 0x1d7f6),
  sans: mathAlnum(0x1d5d4, 0x1d5ee, 0x1d7ec),
  italic: (ch) => {
    const c = ch.codePointAt(0);
    if (c === 104) return '\u210e'; // italic h is a lone codepoint
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d434 + (c - 65));
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d44e + (c - 97));
    return ch;
  },
  wide: (ch) => {
    const c = ch.codePointAt(0);
    if (c === 32) return '\u3000';
    if (c >= 33 && c <= 126) return String.fromCodePoint(c + 0xfee0);
    return ch;
  },
  small: (ch) => SMALLCAPS[ch] || ch,
  circle: (ch) => {
    const c = ch.codePointAt(0);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x24d0 + (c - 97));
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x24b6 + (c - 65));
    if (c >= 49 && c <= 57) return String.fromCodePoint(0x2460 + (c - 49));
    if (c === 48) return '\u24ea';
    return ch;
  },
  leet: (ch) => LEET[ch.toLowerCase()] || ch,
};

function applyStyle(style, text) {
  const fn = STYLES[style];
  if (!fn) return text;
  return [...text].map(fn).join('');
}

/* --- misc transforms ------------------------------------------------------ */

function mockCase(text) {
  let i = 0;
  return [...text]
    .map((ch) => {
      if (!/[a-z]/i.test(ch)) return ch;
      const out = i % 2 === 0 ? ch.toLowerCase() : ch.toUpperCase();
      i++;
      return out;
    })
    .join('');
}

function censor(text) {
  return [...text].map((ch) => (/[a-z0-9]/i.test(ch) ? '█' : ch)).join('');
}

function uwu(text) {
  return text
    .replace(/[rl]/gi, 'w')
    .replace(/n([aeiou])/gi, 'ny$1')
    .replace(/ove/gi, 'uv')
    .replace(/!+/g, '! uwu')
    .replace(/\?+/g, '? owo');
}

function scramble(text) {
  const chars = [...text];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function clap(text) {
  return text.trim().split(/\s+/).join(' 👏 ');
}

/* ------------------------------------------------------------------ commands */

const commands = [
  {
    name: 'font',
    aliases: ['fancy', 'style'],
    category: 'premium',
    description: 'Restyle text in a unicode font (premium)',
    usage: '<bold|italic|mono|sans|wide|small|circle|leet> <text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const p = extra.prefix || '.';
      const style = (args[0] || '').toLowerCase();
      const text = args.slice(1).join(' ');

      if (!style || !STYLES[style]) {
        return extra.reply(
          `🔤 *Font styles*\n\n` +
            `Available: ${Object.keys(STYLES).join(', ')}\n\n` +
            `Usage: ${p}font bold hello world`
        );
      }
      if (!text) return extra.reply(`Usage: ${p}font ${style} <text>`);
      if (tooLong(text)) return extra.reply(`❌ Keep it under ${MAX} characters.`);

      await sock.sendMessage(extra.from, { text: applyStyle(style, text) }, { quoted: msg });
    },
  },
  {
    name: 'mock',
    aliases: ['spongebob', 'sarcasm'],
    category: 'premium',
    description: 'sPoNgEbOb mocking case (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}mock <text>`);
      if (tooLong(text)) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      await sock.sendMessage(extra.from, { text: mockCase(text) }, { quoted: msg });
    },
  },
  {
    name: 'reverse',
    aliases: ['rev', 'backwards'],
    category: 'premium',
    description: 'Reverse any text (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}reverse <text>`);
      if (tooLong(text)) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      await sock.sendMessage(extra.from, { text: [...text].reverse().join('') }, { quoted: msg });
    },
  },
  {
    name: 'censor',
    aliases: ['redact', 'blackout'],
    category: 'premium',
    description: 'Censor text with blocks (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}censor <text>`);
      if (tooLong(text)) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      await sock.sendMessage(extra.from, { text: censor(text) }, { quoted: msg });
    },
  },
  {
    name: 'clap',
    aliases: ['applause'],
    category: 'premium',
    description: 'Put 👏 between every word (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}clap <text>`);
      if (tooLong(text)) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      await sock.sendMessage(extra.from, { text: clap(text) }, { quoted: msg });
    },
  },
  {
    name: 'uwu',
    aliases: ['owo', 'cutespeak'],
    category: 'premium',
    description: 'uwu-ify your text (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}uwu <text>`);
      if (tooLong(text)) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      await sock.sendMessage(extra.from, { text: uwu(text) }, { quoted: msg });
    },
  },
  {
    name: 'scramble',
    aliases: ['shuffle', 'jumble'],
    category: 'premium',
    description: 'Scramble the letters (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}scramble <text>`);
      if (tooLong(text)) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      await sock.sendMessage(extra.from, { text: scramble(text) }, { quoted: msg });
    },
  },
  {
    name: 'spoiler',
    aliases: ['hide'],
    category: 'premium',
    description: 'Wrap text in a tap-to-reveal spoiler (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}spoiler <text>`);
      if (tooLong(text)) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      await sock.sendMessage(extra.from, { text: `||${text}||` }, { quoted: msg });
    },
  },
  {
    name: 'repeat',
    aliases: ['echo'],
    category: 'premium',
    description: 'Repeat text N times (premium)',
    usage: '<1-20> <text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const p = extra.prefix || '.';
      const n = Number(args[0]);
      const text = args.slice(1).join(' ');

      if (!n || Number.isNaN(n) || n < 1) return extra.reply(`Usage: ${p}repeat 5 hello`);
      if (!text) return extra.reply(`Usage: ${p}repeat ${n} <text>`);
      if (n > 20) return extra.reply('❌ Max 20 repeats.');
      if (text.length * n > 3000) return extra.reply('❌ That would be too long.');

      await sock.sendMessage(extra.from, { text: Array(n).fill(text).join('\n') }, { quoted: msg });
    },
  },
  {
    name: 'count',
    aliases: ['charcount'],
    category: 'premium',
    description: 'Count characters, words and lines (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}count <text>`);

      const chars = [...text].length;
      const noSpace = text.replace(/\s/g, '').length;
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      const lines = text.split('\n').length;

      await sock.sendMessage(extra.from, {
        text:
          `📊 *Text count*\n\n` +
          `Characters: *${chars}*\n` +
          `Without spaces: *${noSpace}*\n` +
          `Words: *${words}*\n` +
          `Lines: *${lines}*`,
      }, { quoted: msg });
    },
  },
  {
    name: 'password',
    aliases: ['genpass', 'passgen'],
    category: 'premium',
    description: 'Generate a strong random password (premium)',
    usage: '[length 8-64]',
    premium: true,
    async execute(sock, msg, args, extra) {
      let len = Number(args[0]) || 20;
      if (len < 8) len = 8;
      if (len > 64) len = 64;

      const sets = [
        'abcdefghijkmnopqrstuvwxyz',
        'ABCDEFGHJKLMNPQRSTUVWXYZ',
        '23456789',
        '!@#$%^&*_-+=?',
      ];
      const all = sets.join('');
      const chars = [];

      for (const s of sets) chars.push(s[crypto.randomInt(s.length)]);
      while (chars.length < len) chars.push(all[crypto.randomInt(all.length)]);

      for (let i = chars.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }

      await sock.sendMessage(extra.from, {
        text: `🔐 *Password (${len} chars)*\n\n\`${chars.join('')}\`\n\n_Sent in this chat — use it once, then change it._`,
      }, { quoted: msg });
    },
  },
  {
    name: 'uuid',
    aliases: ['guid'],
    category: 'premium',
    description: 'Generate a UUID v4 (premium)',
    usage: '[count 1-10]',
    premium: true,
    async execute(sock, msg, args, extra) {
      let n = Number(args[0]) || 1;
      if (n < 1) n = 1;
      if (n > 10) n = 10;

      const ids = Array.from({ length: n }, () => crypto.randomUUID());
      await sock.sendMessage(extra.from, {
        text: '🆔 *UUID v4*\n\n```\n' + ids.join('\n') + '\n```',
      }, { quoted: msg });
    },
  },
];

module.exports = commands;
