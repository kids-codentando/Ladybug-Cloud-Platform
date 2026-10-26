/**
 * Premium showcase commands — the "look how broken this looks" pack.
 *
 * These are all pure text transformations. Nothing here touches other users'
 * clients, sends floods, or does anything beyond rendering fancy characters in
 * a normal chat message. They are gated behind the premium tier.
 *
 *   .glitch  hello world     -> z̸a̷l̶g̷o̸ text
 *   .matrix  ladybug         -> vertical rain art
 *   .vhs     retro           -> tracking-error styling
 *   .corrupt system          -> c̷o̷r̷r̷u̷p̷t̷e̷d̷
 *   .banner  HI              -> block letters
 *   .typewriter  hello       -> t-y-p-e-d out
 */

const ZALGO_UP = ['\u0300', '\u0301', '\u0302', '\u0303', '\u0304', '\u0306', '\u0307', '\u0308', '\u030a', '\u030b', '\u030c', '\u0312', '\u0313', '\u0314', '\u033d', '\u0344'];
const ZALGO_DOWN = ['\u0316', '\u0317', '\u0318', '\u0319', '\u031c', '\u031d', '\u031e', '\u031f', '\u0320', '\u0324', '\u0325', '\u0326', '\u0329', '\u032a', '\u032b', '\u032c', '\u0330', '\u0331', '\u0332', '\u0333'];
const ZALGO_MID = ['\u0315', '\u031b', '\u0340', '\u0341', '\u0358', '\u0321', '\u0322', '\u0327', '\u0328', '\u0334', '\u0335', '\u0336', '\u034f'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Sprinkle combining marks over a string. Intensity 1-3. */
function zalgo(text, intensity = 2) {
  let out = '';
  for (const ch of text) {
    out += ch;
    if (ch === ' ' || ch === '\n') continue;
    for (let i = 0; i < intensity; i++) {
      out += pick(ZALGO_UP);
      if (Math.random() > 0.5) out += pick(ZALGO_MID);
      if (Math.random() > 0.4) out += pick(ZALGO_DOWN);
    }
  }
  return out;
}

/** Strikethrough-ish corruption using combining long stroke overlay. */
function corrupt(text) {
  return [...text].map((ch) => (ch === ' ' ? ch : ch + '\u0336')).join('');
}

/** Block-letter banner via a tiny 5-row font for A-Z 0-9. */
const FONT = {
  A: ['█▀█', '█▀█', '▀ ▀'], B: ['█▀▄', '█▀▄', '▀▀ '], C: ['█▀▀', '█  ', '▀▀▀'],
  D: ['█▀▄', '█ █', '▀▀ '], E: ['█▀▀', '█▀▀', '▀▀▀'], F: ['█▀▀', '█▀▀', '▀  '],
  G: ['█▀▀', '█ █', '▀▀▀'], H: ['█ █', '█▀█', '▀ ▀'], I: ['█', '█', '▀'],
  J: ['  █', '  █', '▀▀ '], K: ['█ █', '█▀▄', '▀ ▀'], L: ['█  ', '█  ', '▀▀▀'],
  M: ['█▄█', '█ █', '▀ ▀'], N: ['█▄ █', '█ ▀█', '▀  ▀'], O: ['█▀█', '█ █', '▀▀▀'],
  P: ['█▀█', '█▀▀', '▀  '], Q: ['█▀█', '█ █', '▀▀█'], R: ['█▀█', '█▀▄', '▀ ▀'],
  S: ['█▀▀', '▀▀█', '▀▀▀'], T: ['▀█▀', ' █ ', ' ▀ '], U: ['█ █', '█ █', '▀▀▀'],
  V: ['█ █', '█ █', ' ▀ '], W: ['█ █', '█▄█', '▀ ▀'], X: ['█ █', ' ▄ ', '▀ ▀'],
  Y: ['█ █', ' █ ', ' ▀ '], Z: ['▀▀█', ' ▄▀', '▀▀▀'],
  0: ['█▀█', '█ █', '▀▀▀'], 1: ['▄█ ', ' █ ', '▀▀▀'], 2: ['▀▀█', '█▀▀', '▀▀▀'],
  3: ['▀▀█', ' ▀█', '▀▀▀'], 4: ['█ █', '▀▀█', '  ▀'], 5: ['█▀▀', '▀▀█', '▀▀▀'],
  6: ['█▀▀', '█▀█', '▀▀▀'], 7: ['▀▀█', '  █', '  ▀'], 8: ['█▀█', '█▀█', '▀▀▀'],
  9: ['█▀█', '▀▀█', '▀▀▀'], ' ': ['  ', '  ', '  '], '!': ['█', '█', '▀'],
  '?': ['▀▀█', ' ▄▀', ' ▀ '], '.': [' ', ' ', '▀'],
};

function banner(text) {
  const chars = text.toUpperCase().slice(0, 12).split('');
  const rows = ['', '', ''];
  for (const ch of chars) {
    const glyph = FONT[ch] || FONT[' '];
    for (let r = 0; r < 3; r++) rows[r] += glyph[r] + ' ';
  }
  return rows.join('\n');
}

/** Vertical rain of a word, widening as it falls. */
function matrix(word) {
  const w = (word || 'ladybug').slice(0, 10);
  const lines = [];
  for (let i = 1; i <= Math.min(w.length, 10); i++) {
    const seg = w.slice(0, i);
    lines.push(seg.padStart(Math.floor(i / 2) + seg.length) + '▓');
  }
  return lines.join('\n');
}

/** VHS tracking-error look: alternating glitch bands around the text. */
function vhs(text) {
  const bands = ['▚▚▚▚▚▚▚▚▚▚', '░░▒▒▓▓▒▒░░', '▞▞▚▚▞▞▚▚▞▞'];
  return [
    '▶ PLAY  ██ 00:0' + Math.floor(Math.random() * 9),
    pick(bands),
    '  ' + zalgo(text, 1),
    pick(bands),
    '◀◀   SP   ▶▶',
  ].join('\n');
}

/** Typewriter spacing. */
function typewriter(text) {
  return [...text].join('\u2009');
}

const commands = [
  {
    name: 'glitchtext',
    aliases: ['zalgo', 'cursed'],
    category: 'premium',
    description: 'Glitch out any text (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}glitch <text>`);
      if (text.length > 80) return extra.reply('❌ Keep it under 80 characters.');
      await sock.sendMessage(extra.from, { text: zalgo(text, 2) }, { quoted: msg });
    },
  },
  {
    name: 'corrupt',
    aliases: ['broken'],
    category: 'premium',
    description: 'Corrupted-text effect (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}corrupt <text>`);
      if (text.length > 120) return extra.reply('❌ Keep it under 120 characters.');
      await sock.sendMessage(extra.from, { text: corrupt(text) }, { quoted: msg });
    },
  },
  {
    name: 'banner',
    aliases: ['bigtext', 'ascii'],
    category: 'premium',
    description: 'Block-letter banner (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}banner <text>`);
      await sock.sendMessage(
        extra.from,
        { text: '```\n' + banner(text) + '\n```' },
        { quoted: msg }
      );
    },
  },
  {
    name: 'matrixrain',
    aliases: ['rain'],
    category: 'premium',
    description: 'Matrix rain art (premium)',
    usage: '<word>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const word = args[0] || 'ladybug';
      await sock.sendMessage(
        extra.from,
        { text: '```\n' + matrix(word) + '\n```' },
        { quoted: msg }
      );
    },
  },
  {
    name: 'vhs',
    aliases: ['retro'],
    category: 'premium',
    description: 'VHS tracking-error text (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ') || 'ladybug mini';
      await sock.sendMessage(extra.from, { text: vhs(text) }, { quoted: msg });
    },
  },
  {
    name: 'typewriter',
    aliases: ['spaced'],
    category: 'premium',
    description: 'Typewriter-spaced text (premium)',
    usage: '<text>',
    premium: true,
    async execute(sock, msg, args, extra) {
      const text = args.join(' ');
      if (!text) return extra.reply(`Usage: ${extra.prefix || '.'}typewriter <text>`);
      if (text.length > 100) return extra.reply('❌ Keep it under 100 characters.');
      await sock.sendMessage(extra.from, { text: typewriter(text) }, { quoted: msg });
    },
  },
];

module.exports = commands;
