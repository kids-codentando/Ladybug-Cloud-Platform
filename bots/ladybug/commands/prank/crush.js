/**
 * Crush Pack — fake "someone here likes you" pranks.
 * Made under Ntandomods
 *
 * Same rules as the rest of the prank pack: nothing here touches anyone's
 * client, nothing is sent to a third party, and every result ends with a
 * visible PRANK line so the target is in on the joke. The names are picked
 * from the group's real member list only so the gag lands, never repeated
 * outside the chat, and never persisted.
 */

const theme = require('../../utils/ladybugTheme');
const config = require('../../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Strip the device suffix and domain so we can print a readable handle. */
function handleOf(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

/** Real, non-bot members of the current group. */
function groupMembers(groupMetadata, excludeJid) {
  const parts = (groupMetadata && groupMetadata.participants) || [];
  const exclude = handleOf(excludeJid);
  return parts
    .map((p) => p.id)
    .filter(Boolean)
    .filter((id) => handleOf(id) !== exclude)
    .filter((id) => !String(id).includes('bot'));
}

const REVEAL = `_😂 prank — nobody was scanned, no message was sent._`;

// ------------------------------------------------------------------ commands

const crush = {
  name: 'crush',
  aliases: ['secretcrush', 'wholikesyou'],
  category: 'prank',
  description: 'Fake reveal: someone in this group has a crush on you',
  usage: '.crush',
  async execute(sock, msg, args, extra) {
    const from = extra.from;

    if (!extra.isGroup) {
      const text = [
        theme.header('Secret Crush'),
        theme.row(theme.ICON.warn, 'Group only', 'This one needs a group to pick a name from.'),
        theme.footer(REVEAL),
      ].join('\n');
      return sock.sendMessage(from, { text }, { quoted: msg });
    }

    const members = groupMembers(extra.groupMetadata, extra.sender);
    if (!members.length) {
      const text = [
        theme.header('Secret Crush'),
        theme.row(theme.ICON.warn, 'No candidates', 'Nobody else in here to pick from.'),
        theme.footer(REVEAL),
      ].join('\n');
      return sock.sendMessage(from, { text }, { quoted: msg });
    }

    // Suspense beat, then the reveal.
    const scan = [
      theme.header('Secret Crush'),
      theme.line(`${theme.ICON.sparkle} Reading today's messages...`),
      theme.line(`${theme.ICON.spot} Checking who reacted fastest...`),
      theme.footer(),
    ].join('\n');
    await sock.sendMessage(from, { text: scan }, { quoted: msg });
    await sleep(1400);

    const target = members[Math.floor(Math.random() * members.length)];
    const targetHandle = handleOf(target);
    const pct = theme.randInt(72, 99);

    const text = [
      theme.header('Secret Crush'),
      theme.row(theme.ICON.crown, 'You', `@${handleOf(extra.sender)}`),
      theme.blank(),
      theme.line(`${theme.ICON.sparkle} *Someone in this group has a crush on you.*`),
      theme.blank(),
      theme.row(theme.ICON.fire, 'Confidence', theme.bugBar(pct, 100)),
      theme.divider(),
      theme.line(`They read your messages ${theme.randInt(2, 9)} times before replying.`),
      theme.line(`They typed and deleted ${theme.randInt(1, 4)} message(s) today.`),
      theme.blank(),
      theme.line(`It's *@${targetHandle}*.`),
      theme.footer(REVEAL),
    ].join('\n');

    await sock.sendMessage(from, { text, mentions: [extra.sender, target] }, { quoted: msg });
  },
};

const crushscan = {
  name: 'crushscan',
  aliases: ['crushradar', 'radar'],
  category: 'prank',
  description: 'Fake radar sweep that "finds" who likes you',
  usage: '.crushscan',
  async execute(sock, msg, args, extra) {
    const from = extra.from;
    if (!extra.isGroup) {
      return sock.sendMessage(
        from,
        { text: `${theme.ICON.warn} *Group only* — run this in a group.` },
        { quoted: msg }
      );
    }

    const members = groupMembers(extra.groupMetadata, extra.sender);
    if (!members.length) {
      return sock.sendMessage(
        from,
        { text: `${theme.ICON.warn} *No candidates* — nobody else in here.` },
        { quoted: msg }
      );
    }

    const sent = await sock.sendMessage(
      from,
      { text: `${theme.header('Crush Radar')}\n${theme.line(`${theme.ICON.net} Sweeping...`)}\n${theme.footer()}` },
      { quoted: msg }
    );
    const key = sent && sent.key;

    const sweeps = [18, 41, 63, 88];
    for (const pct of sweeps) {
      await sleep(700);
      const body = [
        theme.header('Crush Radar'),
        theme.line(`${theme.ICON.net} Sweeping... ${theme.bugBar(pct, 100)}`),
        theme.line(`${theme.ICON.spot} ${theme.randInt(1, 6)} heartbeat(s) detected`),
        theme.footer(),
      ].join('\n');
      try {
        await sock.sendMessage(from, { text: body, edit: key });
      } catch (e) {
        await sock.sendMessage(from, { text: body });
      }
    }

    await sleep(800);
    const target = members[Math.floor(Math.random() * members.length)];
    const final = [
      theme.header('Crush Radar'),
      theme.line(`${theme.ICON.ok} *Locked on: @${handleOf(target)}*`),
      theme.blank(),
      theme.line(`Signal strength: ${theme.bugBar(theme.randInt(80, 99), 100)}`),
      theme.line(`Distance: ${theme.randInt(1, 4)} seat(s) away`),
      theme.footer(REVEAL),
    ].join('\n');

    try {
      await sock.sendMessage(from, { text: final, edit: key, mentions: [target] });
    } catch (e) {
      await sock.sendMessage(from, { text: final, mentions: [target] }, { quoted: msg });
    }
  },
};

const crushmeter = {
  name: 'crushmeter',
  aliases: ['crushrate', 'lovemeter'],
  category: 'prank',
  description: 'Fake compatibility score between you and someone',
  usage: '.crushmeter [@user]',
  async execute(sock, msg, args, extra) {
    const from = extra.from;
    const mentioned = (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid) || [];
    const other = mentioned[0];

    if (!other) {
      const text = [
        theme.header('Crush Meter'),
        theme.row(theme.ICON.warn, 'Usage', `${config.prefix || '.'}crushmeter @someone`),
        theme.footer(),
      ].join('\n');
      return sock.sendMessage(from, { text }, { quoted: msg });
    }

    // Deterministic: the same pair always gets the same score, so two people
    // comparing results in the chat don't see the number change.
    const pair = [handleOf(extra.sender), handleOf(other)].sort().join(':');
    const pct = 30 + Math.round(theme.hashRatio(pair) * 70);

    const verdicts = [
      { min: 95, text: 'Suspiciously perfect. Someone is blushing.', icon: '💞' },
      { min: 80, text: 'Strong signal. Reply to their status already.', icon: '💖' },
      { min: 60, text: 'There is something there. Slowly does it.', icon: '💛' },
      { min: 40, text: 'Friendship with potential. Keep talking.', icon: '🤝' },
      { min: 0, text: 'The garden says: stay friends.', icon: '🌱' },
    ];
    const verdict = verdicts.find((v) => pct >= v.min) || verdicts[verdicts.length - 1];

    const text = [
      theme.header('Crush Meter'),
      theme.row(theme.ICON.crown, 'Pair', `@${handleOf(extra.sender)} × @${handleOf(other)}`),
      theme.row(theme.ICON.fire, 'Chemistry', theme.bugBar(pct, 100)),
      theme.divider(),
      theme.row(verdict.icon, 'Verdict', verdict.text),
      theme.blank(),
      theme.line(`Shared interests: ${theme.randInt(2, 7)}`),
      theme.line(`Awkward silences survived: ${theme.randInt(0, 12)}`),
      theme.footer(REVEAL),
    ].join('\n');

    await sock.sendMessage(from, { text, mentions: [extra.sender, other] }, { quoted: msg });
  },
};

const crushmenu = {
  name: 'crushmenu',
  aliases: ['crushcmds'],
  category: 'prank',
  description: 'List the crush pranks',
  usage: '.crushmenu',
  async execute(sock, msg, args, extra) {
    const p = config.prefix || '.';
    const text = [
      theme.header('Crush Pack'),
      theme.line(`${theme.ICON.sparkle} *${p}crush* — "someone here likes you" reveal`),
      theme.line(`${theme.ICON.net} *${p}crushscan* — radar sweep that locks on`),
      theme.line(`${theme.ICON.fire} *${p}crushmeter @user* — compatibility score`),
      theme.divider(),
      theme.line(`${theme.ICON.warn} Group commands need a group to pick names from.`),
      theme.line(`${theme.ICON.leaf} Every result is a prank and says so.`),
      theme.footer(),
    ].join('\n');
    await sock.sendMessage(extra.from, { text }, { quoted: msg });
  },
};

module.exports = [crush, crushscan, crushmeter, crushmenu];
