const { User } = require('./models');
const { getSetting } = require('./settings');

// Referal bonusi: taklif qilingan foydalanuvchi ilk marta minimal depozit miqdorida
// (yoki undan ko'p) balans to'ldirsa, uni taklif qilgan foydalanuvchiga bonus beriladi.
// Bonus faqat BIR MARTA beriladi (har bir taklif qilingan foydalanuvchi uchun).
//
// Chaqiriladigan joylar: karta orqali tasdiqlangan to'lov, Stars orqali to'lov,
// TON orqali tasdiqlangan to'lov — ya'ni balans haqiqatda oshgan har bir holatda.
async function tryGrantReferralDepositBonus(telegramId, depositAmountUZS, telegram) {
  try {
    const user = await User.findOne(
      { telegramId },
      { referredBy: 1, referralBonusGiven: 1 }
    ).lean();
    if (!user || !user.referredBy || user.referralBonusGiven) return;

    const minDeposit = (await getSetting('min_balance_uzs')) || 0;
    if (!depositAmountUZS || depositAmountUZS < minDeposit) return;

    // Atomik: faqat hali bonus berilmagan bo'lsa belgilaymiz — ikki marta berilmasligi uchun
    const updated = await User.findOneAndUpdate(
      { telegramId, referralBonusGiven: { $ne: true } },
      { $set: { referralBonusGiven: true } },
      { new: true }
    );
    if (!updated) return;

    const refId = user.referredBy;
    const bonus = await getSetting('referral_bonus_uzs');
    await User.updateOne(
      { telegramId: refId },
      { $inc: { balance: bonus, referralCount: 1 } }
    );

    if (telegram) {
      try {
        await telegram.sendMessage(
          refId,
          `🎉 Sizning referalingiz orqali taklif qilingan foydalanuvchi birinchi depozitini amalga oshirdi!\n` +
          `💰 +${bonus.toLocaleString()} so'm balansga qo'shildi.`
        );
      } catch {}
    }
  } catch (e) {
    console.error('Referal depozit bonusini berishda xato:', e.message);
  }
}

module.exports = { tryGrantReferralDepositBonus };
