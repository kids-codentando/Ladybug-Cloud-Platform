/**
 * Premium · Fast pack — codecs & hashes.
 *
 * Pure in-memory conversions using Node builtins (Buffer, crypto).
 * No network, no child processes, no temp files.
 *
 * Gated behind the premium tier (premium: true).
 */

const crypto = require('crypto');

const MAX = 800;

/* ------------------------------------------------------------------ morse */

const MORSE = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....',
  i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.',
  q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-',
  y: '-.--', z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
};

const MORSE_REVERSE = Object.fromEntries(
  Object.entries(MORSE).map(([k, v]) => [v, k])
);

function toMorse(text) {
  return [...text.toLowerCase()]
    .map((ch) => (ch === ' ' ? '/' : MORSE[ch] || ''))
    .filter(Boolean)
    .join(' ');
}

function fromMorse(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((code) => (code === '/' ? ' ' : MORSE_REVERSE[code] || '?'))
    .join('');
}

/* ------------------------------------------------------------------ commands */

const commands = [
  {
    name: 'base64',
    aliases: ['b64', 'encode'],
    category: 'premium',
    description: 'Encode text to Base64 (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}base64 <text>`);
      if (text.length > MAX) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      const out = Buffer.from(text, 'utf8').toString('base64');
      await sock.sendMessage(extra.from, { text: '🔒 *Base64*\n\n```\n' + out + '\n```' }, { quoted: msg });
    },
  },
  {
    name: 'unbase64',
    aliases: ['b64decode', 'decode'],
    category: 'premium',
    description: 'Decode Base64 back to text (premium)',
    usage: '<base64>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ').trim();
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}unbase64 <base64>`);
      try {
        const out = Buffer.from(text, 'base64').toString('utf8');
        if (!out || /\uFFFD/.test(out)) throw new Error('not valid utf8');
        await sock.sendMessage(extra.from, { text: '🔓 *Decoded*\n\n' + out }, { quoted: msg });
      } catch {
        await extra.reply('❌ That is not valid Base64.');
      }
    },
  },
  {
    name: 'binary',
    aliases: ['bin', 'tobin'],
    category: 'premium',
    description: 'Convert text to binary (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}binary <text>`);
      if (text.length > 120) return extra.reply('❌ Keep it under 120 characters.');
      const out = [...Buffer.from(text, 'utf8')]
        .map((b) => b.toString(2).padStart(8, '0'))
        .join(' ');
      await sock.sendMessage(extra.from, { text: '💻 *Binary*\n\n```\n' + out + '\n```' }, { quoted: msg });
    },
  },
  {
    name: 'unbinary',
    aliases: ['frombin'],
    category: 'premium',
    description: 'Convert binary back to text (premium)',
    usage: '<01001000 ...>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const raw = args.join(' ').replace(/[^01]/g, '');
      if (!raw) return extra.reply(`Usage: ${extra.prefix || '.'}unbinary <binary>`);
      if (raw.length % 8 !== 0) return extra.reply('❌ Binary length must be a multiple of 8.');
      try {
        const bytes = [];
        for (let i = 0; i < raw.length; i += 8) bytes.push(parseInt(raw.slice(i, i + 8), 2));
        const out = Buffer.from(bytes).toString('utf8');
        await sock.sendMessage(extra.from, { text: '🔓 *Decoded*\n\n' + out }, { quoted: msg });
      } catch {
        await extra.reply('❌ Could not decode that binary.');
      }
    },
  },
  {
    name: 'morse',
    aliases: ['tomorse'],
    category: 'premium',
    description: 'Convert text to Morse code (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}morse <text>`);
      if (text.length > MAX) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      const out = toMorse(text);
      await sock.sendMessage(extra.from, { text: '📡 *Morse*\n\n```\n' + out + '\n```' }, { quoted: msg });
    },
  },
  {
    name: 'unmorse',
    aliases: ['frommorse'],
    category: 'premium',
    description: 'Decode Morse code to text (premium)',
    usage: '<... --- ...>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}unmorse <morse>`);
      const out = fromMorse(text);
      await sock.sendMessage(extra.from, { text: '🔓 *Decoded*\n\n' + out }, { quoted: msg });
    },
  },
  {
    name: 'hex',
    aliases: ['tohex'],
    category: 'premium',
    description: 'Convert text to hex (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}hex <text>`);
      if (text.length > MAX) return extra.reply(`❌ Keep it under ${MAX} characters.`);
      const out = Buffer.from(text, 'utf8').toString('hex').match(/.{1,2}/g).join(' ');
      await sock.sendMessage(extra.from, { text: '🧬 *Hex*\n\n```\n' + out + '\n```' }, { quoted: msg });
    },
  },
  {
    name: 'unhex',
    aliases: ['fromhex'],
    category: 'premium',
    description: 'Decode hex back to text (premium)',
    usage: '<68656c6c6f>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const raw = args.join(' ').replace(/[^0-9a-fA-F]/g, '');
      if (!raw) return extra.reply(`Usage: ${extra.prefix || '.'}unhex <hex>`);
      if (raw.length % 2 !== 0) return extra.reply('❌ Hex length must be even.');
      try {
        const out = Buffer.from(raw, 'hex').toString('utf8');
        await sock.sendMessage(extra.from, { text: '🔓 *Decoded*\n\n' + out }, { quoted: msg });
      } catch {
        await extra.reply('❌ Could not decode that hex.');
      }
    },
  },
  {
    name: 'hash',
    aliases: ['checksum', 'digest'],
    category: 'premium',
    description: 'Hash text with md5 / sha1 / sha256 / sha512 (premium)',
    usage: '<algo> <text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const p = extra.prefix || '.';
      const algos = ['md5', 'sha1', 'sha256', 'sha512'];
      const algo = (args[0] || '').toLowerCase();
      const text = args.slice(1).join(' ');

      if (!algos.includes(algo)) {
        return extra.reply(
          `#️⃣ *Hash*\n\nAlgorithms: ${algos.join(', ')}\n\nUsage: ${p}hash sha256 hello`
        );
      }
      if (!text) return extra.reply(`Usage: ${p}hash ${algo} <text>`);
      if (text.length > MAX) return extra.reply(`❌ Keep it under ${MAX} characters.`);

      const out = crypto.createHash(algo).update(text, 'utf8').digest('hex');
      await sock.sendMessage(extra.from, {
        text: `#️⃣ *${algo.toUpperCase()}*\n\n\`\`\`\n${out}\n\`\`\``,
      }, { quoted: msg });
    },
  },
];

module.exports = commands;
