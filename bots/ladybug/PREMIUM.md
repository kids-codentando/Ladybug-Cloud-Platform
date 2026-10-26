# Premium (paid) commands

The bot has a paid tier. Premium is granted **per person** (WhatsApp JID), not per group,
and is enforced in `handler.js` before any command executes.

## How it works

```
commands/premium/showcase.js   glitch / banner / matrix / vhs / corrupt / typewriter
commands/premium/fast.js       text styling — font, mock, reverse, censor, clap, uwu …
commands/premium/codec.js      encoders & hashes — base64, binary, morse, hex, hash
commands/owner/premium.js      .premium add / remove / list
utils/premium.js               JSON store + isPremium() / grant() / revoke()
handler.js                     premium gate (owners bypass)
```

Storage lives in `bots/ladybug/data/premium.json` (gitignored). A grant is either
time-boxed (`expires` timestamp) or lifetime (`expires: null`). Expired entries are pruned
on read, so the file self-cleans.

JIDs are normalised to the bare number, so a grant made against
`254712345678@s.whatsapp.net` also matches `254712345678@lid`. This matters because
WhatsApp's linked-device IDs differ from phone-number IDs.

## Owner commands

```
.premium                          your own status + subscriber count
.premium add <number> [days]      grant, default 30 days, 0 = lifetime
.premium remove <number>          revoke
.premium list                     active subscribers with days remaining
```

## The pack — 27 commands

### Fast text styling (`fast.js`)

| Command | What it does |
|---|---|
| `.font <style> <text>` | Restyle in `bold`, `italic`, `mono`, `sans`, `wide`, `small`, `circle`, `leet` |
| `.mock <text>` | sPoNgEbOb mocking case |
| `.reverse <text>` | Reverse the string |
| `.censor <text>` | Replace letters with █ blocks |
| `.clap <text>` | 👏 between every word |
| `.uwu <text>` | uwu-ify (r/l → w, n → ny) |
| `.scramble <text>` | Shuffle the letters |
| `.spoiler <text>` | Tap-to-reveal `\|\|text\|\|` |
| `.repeat <n> <text>` | Repeat up to 20× |
| `.count <text>` | Characters, words, lines |
| `.password [len]` | CSPRNG password, 8–64 chars |
| `.uuid [n]` | UUID v4, up to 10 |

### Codecs & hashes (`codec.js`)

| Command | What it does |
|---|---|
| `.base64` / `.unbase64` | Base64 encode / decode |
| `.binary` / `.unbinary` | UTF-8 ↔ binary |
| `.morse` / `.unmorse` | Text ↔ Morse |
| `.hex` / `.unhex` | Text ↔ hex |
| `.hash <algo> <text>` | md5, sha1, sha256, sha512 |

### Visual effects (`showcase.js`)

| Command | What it does |
|---|---|
| `.glitch <text>` | Zalgo / combining-mark text |
| `.corrupt <text>` | Strikethrough corruption |
| `.banner <text>` | Block-letter ASCII banner |
| `.matrix <word>` | Vertical rain art |
| `.vhs <text>` | VHS tracking-error styling |
| `.typewriter <text>` | Thin-space typewriter text |

## Why these are "fast"

Every command is O(n) string work using Node builtins only — no network calls, no
`ffmpeg`, no `sharp`, no temp files, no database round-trips. Measured across all 27:

```
27 pass / 0 fail
average   0.119 ms
slowest   0.41 ms  (.password — CSPRNG + shuffle)
```

Nothing exceeds 5ms, so replies land instantly. That is the actual selling point of the
tier: no "processing…" wait, which is exactly where most WhatsApp bots fall over.

## Adding a paid command

Set `premium: true` on the module and the gate handles the rest:

```js
module.exports = {
  name: 'mycmd',
  category: 'premium',
  premium: true,
  async execute(sock, msg, args, extra) { /* … */ },
};
```

Non-premium users get a short upsell message instead of the result. Owners bypass the
check so you can always test.

## What is deliberately NOT here

There is no "crash" or "bug" payload pack. Commands built to crash someone else's
WhatsApp are a denial-of-service attack against real people: they freeze the victim's app,
can lose unsent messages, and get the sending number banned under WhatsApp's terms. That
is not something this codebase will ship, paid or otherwise.

If the goal is "commands that look wild and make people go *what is that*", the pack above
does that safely. If the goal is monetisation, the gate is the valuable part — you can
attach it to any future command with one line.
