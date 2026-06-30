const { User } = require('./models');
const { isAdmin } = require('./admin');
const { Markup } = require('telegraf');

// Majburiy obuna tekshiruvi — har bir murojaatda ishlaydi
async function requireSubscription(ctx, next) {
  // Admin uchun cheklov yo'q
  if (isAdmin(ctx.from?.id)) return next();

  // /start va subscription bilan bog'liq actionlarga ruxsat (aks holda foydalanuvchi to'lay olmaydi)
  const allowedActions = ['subscription', 'sub_1month', 'sub_3month', 'sub_lifetime', 'back_main', 'help'];
  const cbData = ctx.callbackQuery?.data;
  if (ctx.message?.text === '/start') return next();
  if (cbData && (allowedActions.includes(cbData) || cbData.startsWith('receipt_'))) return next();

  const user = await User.findOne({ telegramId: ctx.from.id });

  const isActive = user?.isPremium && (!user.premiumUntil || user.premiumUntil > new Date());

  if (!isActive) {
    const text = '🔒 Botdan foydalanish uchun obuna talab qilinadi.\n\nIltimos, avval obunani faollashtiring.';
    const kb = Markup.inlineKeyboard([[Markup.button.callback('💎 Obunani ko\'rish', 'subscription')]]);

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('🔒 Obuna kerak!', { show_alert: true });
      try { await ctx.editMessageText(text, kb); } catch { await ctx.reply(text, kb); }
    } else {
      await ctx.reply(text, kb);
    }
    return;
  }

  return next();
}

module.exports = { requireSubscription };
