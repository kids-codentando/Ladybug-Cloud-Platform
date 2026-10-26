/**
 * Prank Pack — fake "my phone broke" screenshots and gags.
 *
 * These are deliberately harmless. Every command renders a *picture* or plays a
 * short scripted gag; nothing here touches the recipient's client, sends
 * oversized payloads, or uses malformed content. The joke is always the reveal,
 * so every output ends with a visible "prank" line — nobody is left genuinely
 * panicking about a broken phone or a banned account.
 *
 * Why not real crash payloads: freezing another person's app is a DoS, it gets
 * the bot's number banned within hours, and it is a criminal offence under
 * computer-misuse law in most of the markets this bot serves. Fake screenshots
 * get the same laugh with none of that.
 */

const config = require('../../config');

// Rendering backend. `@napi-rs/canvas` ships a prebuilt binary, so it works on
// hosts where node-canvas fails to compile (no cairo/pango headers, ephemeral
// filesystems). node-canvas is the fallback; if neither loads we degrade to
// plain text instead of throwing.
let createCanvas = null;
for (const mod of ['@napi-rs/canvas', 'canvas']) {
  try {
    ({ createCanvas } = require(mod));
    if (createCanvas) break;
  } catch (e) {
    createCanvas = null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PREFIX = () => config.prefix || '.';

// ------------------------------------------------------------------ drawing

const FONT = 'sans-serif';
const MONO = 'monospace';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function canvasOrNull(w, h) {
  if (!createCanvas) return null;
  try {
    const c = createCanvas(w, h);
    return { canvas: c, ctx: c.getContext('2d') };
  } catch (e) {
    return null;
  }
}

/** Android-style "App isn't responding" dialog. */
function renderCrash(appName = 'WhatsApp') {
  const W = 900;
  const H = 620;
  const made = canvasOrNull(W, H);
  if (!made) return null;
  const { canvas, ctx } = made;

  // Dimmed chat background
  ctx.fillStyle = '#0b141a';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 14; i += 1) {
    const y = 40 + i * 42;
    const left = i % 2 === 0;
    ctx.fillStyle = left ? '#202c33' : '#005c4b';
    const bw = 300 + ((i * 97) % 220);
    roundRect(ctx, left ? 40 : W - bw - 40, y, bw, 30, 8);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Scrim
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, 0, W, H);

  // Dialog
  const dw = 620;
  const dh = 300;
  const dx = (W - dw) / 2;
  const dy = (H - dh) / 2;
  ctx.fillStyle = '#1f2c34';
  roundRect(ctx, dx, dy, dw, dh, 22);
  ctx.fill();
  ctx.strokeStyle = '#2f3c44';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#e9edef';
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(`${appName} isn't responding`, dx + 40, dy + 78);

  ctx.fillStyle = '#8696a0';
  ctx.font = `24px ${FONT}`;
  const body = wrap(ctx, 'You can wait for it to respond, or close the app.', dw - 80);
  body.forEach((l, i) => ctx.fillText(l, dx + 40, dy + 130 + i * 34));

  // Buttons
  const by = dy + dh - 84;
  ctx.font = `600 26px ${FONT}`;
  ctx.fillStyle = '#8696a0';
  ctx.fillText('Close app', dx + dw - 320, by + 34);
  ctx.fillStyle = '#00a884';
  ctx.fillText('Wait', dx + dw - 140, by + 34);

  // Watermark so nobody is actually fooled
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.font = `600 20px ${MONO}`;
  ctx.fillText('PRANK · nothing actually crashed', dx + 40, dy + dh - 30);

  return canvas.toBuffer('image/png');
}

/** Torn / glitched frozen screen. */
function renderGlitch(seedText = 'SIGNAL LOST') {
  const W = 900;
  const H = 620;
  const made = canvasOrNull(W, H);
  if (!made) return null;
  const { canvas, ctx } = made;

  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, W, H);

  const palette = ['#e23b2e', '#35d39a', '#a78bfa', '#ffb347', '#ffffff'];
  for (let i = 0; i < 90; i += 1) {
    const y = Math.random() * H;
    const h = 2 + Math.random() * 22;
    const x = Math.random() * W * 0.5;
    const w = W * (0.2 + Math.random() * 0.8);
    ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
    ctx.globalAlpha = 0.08 + Math.random() * 0.5;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;

  // Shifted text rows — a few slices, not a pile of overlapping copies
  const text = String(seedText).toUpperCase().slice(0, 22);
  let size = 96;
  ctx.font = `700 ${size}px ${FONT}`;
  while (ctx.measureText(text).width > W - 120 && size > 28) {
    size -= 6;
    ctx.font = `700 ${size}px ${FONT}`;
  }
  for (let i = 0; i < 3; i += 1) {
    const y = 240 + i * 30;
    ctx.globalAlpha = 0.45 + i * 0.2;
    ctx.fillStyle = i === 1 ? '#e23b2e' : '#f4efea';
    ctx.fillText(text, 60 + (i - 1) * 26, y);
  }
  ctx.globalAlpha = 1;

  // Scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

  // Reveal plate — drawn last, on a solid strip, so it stays readable
  ctx.fillStyle = 'rgba(5,7,10,0.92)';
  ctx.fillRect(0, H - 84, W, 84);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `600 22px ${MONO}`;
  ctx.fillText('PRANK · your screen is fine', 60, H - 34);

  return canvas.toBuffer('image/png');
}

/** Fake account-ban notice, styled like an in-app system screen. */
function renderBan(number = '+254 7•• ••• •••') {
  const W = 900;
  const H = 620;
  const made = canvasOrNull(W, H);
  if (!made) return null;
  const { canvas, ctx } = made;

  ctx.fillStyle = '#0b141a';
  ctx.fillRect(0, 0, W, H);

  // Red header band
  ctx.fillStyle = '#7a1f18';
  ctx.fillRect(0, 0, W, 130);
  ctx.fillStyle = '#ffd9d4';
  ctx.font = `700 38px ${FONT}`;
  ctx.fillText('Account banned', 50, 82);

  // Warning triangle
  ctx.strokeStyle = '#e23b2e';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(450, 190);
  ctx.lineTo(520, 300);
  ctx.lineTo(380, 300);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#e23b2e';
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText('!', 443, 288);

  ctx.fillStyle = '#e9edef';
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(String(number).slice(0, 28), 50, 360);

  ctx.fillStyle = '#8696a0';
  ctx.font = `24px ${FONT}`;
  const lines = wrap(
    ctx,
    'This account was reported for sending automated messages. You can appeal this decision within 30 days.',
    W - 100
  );
  lines.forEach((l, i) => ctx.fillText(l, 50, 410 + i * 34));

  ctx.fillStyle = '#e23b2e';
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText('Appeal', 50, 540);

  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  ctx.font = `600 20px ${MONO}`;
  ctx.fillText('PRANK · no account was touched', 50, 590);

  return canvas.toBuffer('image/png');
}

/** Fake "infinite loading" screen. */
function renderLoading(label = 'Restoring chats') {
  const W = 900;
  const H = 620;
  const made = canvasOrNull(W, H);
  if (!made) return null;
  const { canvas, ctx } = made;

  ctx.fillStyle = '#0b141a';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#00a884';
  ctx.font = `700 40px ${FONT}`;
  const t = String(label).slice(0, 30);
  const tw = ctx.measureText(t).width;
  ctx.fillText(t, (W - tw) / 2, 270);

  // Progress bar stuck at 99%
  const bw = 560;
  const bx = (W - bw) / 2;
  const by = 320;
  ctx.fillStyle = '#202c33';
  roundRect(ctx, bx, by, bw, 22, 11);
  ctx.fill();
  ctx.fillStyle = '#00a884';
  roundRect(ctx, bx, by, bw * 0.99, 22, 11);
  ctx.fill();

  ctx.fillStyle = '#8696a0';
  ctx.font = `24px ${FONT}`;
  ctx.fillText('99%', bx + bw - 60, by + 62);
  ctx.fillText('Do not close the app', bx, by + 62);

  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.font = `600 20px ${MONO}`;
  ctx.fillText('PRANK · nothing is loading', bx, H - 60);

  return canvas.toBuffer('image/png');
}

// ------------------------------------------------------------------ helpers

async function sendImage(sock, from, msg, buffer, caption) {
  if (!buffer) {
    return sock.sendMessage(from, { text: caption }, { quoted: msg });
  }
  return sock.sendMessage(from, { image: buffer, caption }, { quoted: msg });
}

const REVEAL = '\n\n_😂 prank — nothing actually happened to your phone._';

// ------------------------------------------------------------------ commands

const fakecrash = {
  name: 'fakecrash',
  aliases: ['crashscreen', 'anr'],
  category: 'prank',
  description: "Send a fake \"app isn't responding\" screenshot",
  usage: '.fakecrash [app name]',
  async execute(sock, msg, args) {
    const from = msg.key.remoteJid;
    const app = args.join(' ').trim().slice(0, 20) || 'WhatsApp';
    const buf = renderCrash(app);
    await sendImage(
      sock,
      from,
      msg,
      buf,
      `📱 *${app} isn't responding*\n\nClose app · Wait${REVEAL}`
    );
  },
};

const glitchscreen = {
  name: 'glitchscreen',
  aliases: ['frozenscreen', 'deadphone'],
  category: 'prank',
  description: 'Send a fake glitched / frozen screen',
  usage: '.glitchscreen [text]',
  async execute(sock, msg, args) {
    const from = msg.key.remoteJid;
    const text = args.join(' ').trim() || 'SIGNAL LOST';
    const buf = renderGlitch(text);
    await sendImage(sock, from, msg, buf, `📵 *screen frozen*${REVEAL}`);
  },
};

const fakeban = {
  name: 'fakeban',
  aliases: ['banhammer', 'banned'],
  category: 'prank',
  description: 'Send a fake WhatsApp ban notice',
  usage: '.fakeban [number]',
  async execute(sock, msg, args) {
    const from = msg.key.remoteJid;
    const num = args.join(' ').trim() || '+254 7•• ••• •••';
    const buf = renderBan(num);
    await sendImage(
      sock,
      from,
      msg,
      buf,
      `🚫 *Account banned*\n\nAppeal within 30 days${REVEAL}`
    );
  },
};

const fakescreen = {
  name: 'fakescreen',
  aliases: ['loadingforever', 'stuck99'],
  category: 'prank',
  description: 'Send a fake loading screen stuck at 99%',
  usage: '.fakescreen [label]',
  async execute(sock, msg, args) {
    const from = msg.key.remoteJid;
    const label = args.join(' ').trim() || 'Restoring chats';
    const buf = renderLoading(label);
    await sendImage(sock, from, msg, buf, `⏳ *${label}* — 99%${REVEAL}`);
  },
};

const hack = {
  name: 'hack',
  aliases: ['h4ck', 'hacked'],
  category: 'prank',
  description: 'Fake hacking sequence (ends in a joke)',
  usage: '.hack',
  async execute(sock, msg) {
    const from = msg.key.remoteJid;
    const steps = [
      '🔍 Scanning target...',
      '📡 Bypassing firewall ▓▓▓▓▓░░░░░ 50%',
      '🔓 Cracking 256-bit key ▓▓▓▓▓▓▓▓░░ 80%',
      '💾 Downloading gallery ▓▓▓▓▓▓▓▓▓▓ 100%',
      '✅ Access granted.',
    ];
    for (const step of steps) {
      await sock.sendMessage(from, { text: step }, { quoted: msg });
      await sleep(700);
    }
    await sleep(600);
    await sock.sendMessage(
      from,
      {
        text:
          '📸 *Uploading your selfies to the internet...*\n\n' +
          "_just kidding. I downloaded nothing, I can't even see your gallery._" +
          REVEAL,
      },
      { quoted: msg }
    );
  },
};

const fakelag = {
  name: 'fakelag',
  aliases: ['lag', 'typingforever'],
  category: 'prank',
  description: 'Show "typing…" for a few seconds, then a joke',
  usage: '.fakelag [seconds]',
  async execute(sock, msg, args) {
    const from = msg.key.remoteJid;
    const secs = Math.min(Math.max(parseInt(args[0], 10) || 6, 2), 12);
    try {
      await sock.sendPresenceUpdate('composing', from);
    } catch (e) {
      /* presence is best-effort */
    }
    await sleep(secs * 1000);
    try {
      await sock.sendPresenceUpdate('paused', from);
    } catch (e) {
      /* ignore */
    }
    await sock.sendMessage(
      from,
      {
        text: `…sorry, I was typing a ${secs}-second message and then forgot it.\n\nTyping for ${secs}s and saying nothing is the real prank.${REVEAL}`,
      },
      { quoted: msg }
    );
  },
};

const loadingbar = {
  name: 'loadingbar',
  aliases: ['loading', 'progress'],
  category: 'prank',
  description: 'Animated loading bar that never quite finishes',
  usage: '.loadingbar [label]',
  async execute(sock, msg, args) {
    const from = msg.key.remoteJid;
    const label = args.join(' ').trim().slice(0, 24) || 'Loading';
    const sent = await sock.sendMessage(
      from,
      { text: `⏳ ${label}... 0%` },
      { quoted: msg }
    );
    const key = sent && sent.key;
    for (const pct of [12, 34, 57, 78, 91, 99]) {
      await sleep(650);
      try {
        await sock.sendMessage(from, { text: `⏳ ${label}... ${pct}%`, edit: key });
      } catch (e) {
        // Older clients can't edit; fall back to a fresh message.
        await sock.sendMessage(from, { text: `⏳ ${label}... ${pct}%` });
      }
    }
    await sleep(900);
    const done = `✅ ${label}... 100%\n\nActually it was done at 12%.${REVEAL}`;
    try {
      await sock.sendMessage(from, { text: done, edit: key });
    } catch (e) {
      await sock.sendMessage(from, { text: done }, { quoted: msg });
    }
  },
};

const prankmenu = {
  name: 'prankmenu',
  aliases: ['pranks', 'gags'],
  category: 'prank',
  description: 'List the prank pack',
  usage: '.prankmenu',
  async execute(sock, msg) {
    const from = msg.key.remoteJid;
    const p = PREFIX();
    const text = [
      '🎭 *PRANK PACK*',
      '',
      `▸ ${p}fakecrash [app] — fake "isn't responding" dialog`,
      `▸ ${p}glitchscreen [text] — fake frozen screen`,
      `▸ ${p}fakeban [number] — fake ban notice`,
      `▸ ${p}fakescreen [label] — stuck at 99%`,
      `▸ ${p}hack — fake hacking sequence`,
      `▸ ${p}fakelag [secs] — types, then says nothing`,
      `▸ ${p}loadingbar [label] — bar that never finishes`,
      '',
      '_Every prank ends with a visible reveal, so nobody is left',
      'thinking their phone or account is actually broken._',
      '',
      '> 🐞 Ladybug Mini • pranks are free',
    ].join('\n');
    await sock.sendMessage(from, { text }, { quoted: msg });
  },
};

module.exports = [
  fakecrash,
  glitchscreen,
  fakeban,
  fakescreen,
  hack,
  fakelag,
  loadingbar,
  prankmenu,
];
