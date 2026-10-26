/**
 * .premium — manage paid access to the premium command pack.
 *
 *   .premium                     -> your own status
 *   .premium add <jid> [days]    -> grant (default 30, 0 = lifetime)
 *   .premium remove <jid>        -> revoke
 *   .premium list                -> active subscribers
 */

const premium = require('../../utils/premium');

function fmtDate(ts) {
  if (!ts) return 'never';
  return new Date(ts).toISOString().slice(0, 10);
}

module.exports = {
  name: 'premium',
  aliases: ['paid', 'sub'],
  category: 'owner',
  description: 'Manage premium (paid) command access',
  usage: '.premium <add|remove|list> [jid] [days]',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const p = extra.prefix || '.';
    const sub = (args[0] || '').toLowerCase();

    try {
      if (!sub) {
        const active = premium.isPremium(extra.sender);
        const left = premium.daysLeft(extra.sender);
        return extra.reply(
          `⭐ *Premium commands*\n\n` +
          `Your status: *${active ? 'ACTIVE' : 'INACTIVE'}*` +
          (active ? `\nExpires in: *${left === null ? 'never (lifetime)' : left + ' days'}*` : '') +
          `\n\nSubscribers: *${premium.count()}*\n\n` +
          `Usage:\n` +
          `  ${p}premium add 254712345678 30\n` +
          `  ${p}premium add 254712345678 0   (lifetime)\n` +
          `  ${p}premium remove 254712345678\n` +
          `  ${p}premium list`
        );
      }

      if (sub === 'list') {
        const all = premium.list();
        if (!all.length) return extra.reply('⭐ No active premium subscribers.');
        const lines = all.slice(0, 30).map((r, i) =>
          `${i + 1}. *${r.jid}* — ${r.daysLeft === null ? 'lifetime' : r.daysLeft + 'd left'}`
        );
        return extra.reply(`⭐ *Premium subscribers (${all.length})*\n\n` + lines.join('\n'));
      }

      if (sub === 'add' || sub === 'grant') {
        const target = args[1];
        if (!target) return extra.reply(`Usage: ${p}premium add <number> [days]`);
        const days = args[2] === undefined ? 30 : Number(args[2]);
        if (Number.isNaN(days) || days < 0) return extra.reply('❌ Days must be 0 (lifetime) or a positive number.');

        const rec = premium.grant(target, days, 'manual');
        if (!rec) return extra.reply('❌ Invalid number.');
        return extra.reply(
          `✅ *Premium granted*\n\n` +
          `User: *${premium.key(target)}*\n` +
          `Plan: *${days === 0 ? 'lifetime' : days + ' days'}*\n` +
          `Expires: *${rec.expires ? fmtDate(rec.expires) : 'never'}*`
        );
      }

      if (sub === 'remove' || sub === 'revoke') {
        const target = args[1];
        if (!target) return extra.reply(`Usage: ${p}premium remove <number>`);
        const ok = premium.revoke(target);
        return extra.reply(ok ? `✅ Premium revoked for *${premium.key(target)}*.` : '❌ That user is not premium.');
      }

      return extra.reply(`Unknown option *${sub}*. Try ${p}premium for help.`);
    } catch (err) {
      console.error('[premium cmd]', err);
      return extra.reply('❌ Premium command failed.');
    }
  },
};
