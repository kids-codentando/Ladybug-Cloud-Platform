# Premium (paid) commands

The bot now has a paid tier. Premium is granted **per person** (WhatsApp JID), not per
group, and is enforced in `handler.js` before any command executes.

## How it works

```
commands/premium/showcase.js   the paid command pack
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

## The paid pack

| Command | What it does |
|---|---|
| `.glitch <text>` | Zalgo / combining-mark text |
| `.corrupt <text>` | Strikethrough corruption |
| `.banner <text>` | Block-letter ASCII banner |
| `.matrix <word>` | Vertical rain art |
| `.vhs <text>` | VHS tracking-error styling |
| `.typewriter <text>` | Thin-space typewriter text |

All six are pure text transformations. They render fancy Unicode in a normal message —
they do not touch other clients, do not send floods, and cannot harm anyone's app.

## What is deliberately NOT here

There is no "crash" or "bug" payload pack. Commands built to crash someone else's
WhatsApp are a denial-of-service attack against real people: they freeze the victim's
app, can lose unsent messages, and get the sending number banned under WhatsApp's terms.
That is not something this codebase will ship, paid or otherwise.

If the goal is "commands that look wild and make people go *what is that*", the pack above
does that safely. If the goal is monetisation, the gate is the valuable part — you can
attach it to any future command by setting `premium: true` on the module.
