const { Markup } = require('telegraf');
const { getSetting } = require('./settings');
const { isAdmin } = require('./admin');

// Botdan foydalanishdan oldin kanalga obuna bo'lishni tekshiradi.
// Agar admin panelda kanal o'rnatilmagan bo'lsa (bo'sh string), tekshiruv o'tkazib yuboriladi.
async function requireChannelSub(ctx, next) {
  if (isAdmin(ctx.from?.id)) return next();

  const channel = await getSetting('force_sub_channel');
  if (!channel) return next(); // Majburiy obuna o'chirilgan

  // check_sub tugmasiga doim ruxsat beriladi (aks holda foydalanuvchi tekshira olmaydi)
  const cbData = ctx.callbackQuery?.data;
  if (cbData === 'check_sub') return next();
  if (ctx.message?.text === '/start') {
    // /start o'tadi, lekin pastda hali ham tekshiriladi
  }

  try {
    const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
    const isMember = ['member', 'administrator', 'creator'].includes(member.status);
    if (isMember) return next();
  } catch (e) {
    // Bot kanalda admin emas yoki kanal noto'g'ri — xavfsizlik uchun o'tkazib yuboramiz
    console.error('Kanal tekshiruvida xato:', e.message);
    return next();
  }

  const channelLink = channel.startsWith('@') ? `https://t.me/${channel.slice(1)}` : channel;
  const text =
    `🔒 Botdan foydalanish uchun kanalga aʼzo boʻling:\n\n` +
    `📢 ${channel}\n\n` +
    `Aʼzo boʻlgach, "✅ Tekshirish" tugmasini bosing.`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.url('📢 Kanalga oʻtish', channelLink)],
    [Markup.button.callback('✅ Tekshirish', 'check_sub')],
  ]);

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('🔒 Avval kanalga aʼzo boʻling!', { show_alert: true });
    try { await ctx.editMessageText(text, kb); } catch { await ctx.reply(text, kb); }
  } else {
    await ctx.reply(text, kb);
  }
  return; // next() chaqirilmaydi — zanjir to'xtaydi
}

module.exports = { requireChannelSub };
