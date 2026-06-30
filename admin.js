const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => parseInt(id.trim()))
  .filter(Boolean);

function isAdmin(telegramId) {
  return ADMIN_IDS.includes(telegramId);
}

function adminOnly(ctx, next) {
  if (!isAdmin(ctx.from?.id)) {
    return ctx.answerCbQuery('⛔ Ruxsat yoq!', { show_alert: true });
  }
  return next();
}

module.exports = { isAdmin, adminOnly, ADMIN_IDS };
