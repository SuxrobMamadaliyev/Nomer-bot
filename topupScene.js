const { Scenes, Markup } = require('telegraf');
const { User } = require('./models');
const { getAllSettings } = require('./settings');
const { backToMain } = require('./keyboards');
const { ADMIN_IDS } = require('./admin');

// Waiting state: telegramId -> { step: 'amount' | 'receipt', amount, fee, credited }
const waiting = {};

async function showTopupMenu(ctx) {
  const s = await getAllSettings();
  const user = await User.findOne({ telegramId: ctx.from.id });

  const text =
    `👛 <b>Balans to'ldirish</b>\n\n` +
    `💰 Joriy balans: <b>${(user?.balance || 0).toLocaleString()} so'm</b>\n\n` +
    `ℹ️ To'ldirishda <b>${s.topup_fee_percent}%</b> xizmat haqi ushlab qolinadi.\n\n` +
    `To'ldirish uchun summani kiriting (so'mda), masalan: <code>50000</code>`;

  waiting[ctx.from.id] = { step: 'amount' };

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'back_main')]]),
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'back_main')]]),
    });
  }
}

function calcFee(amount, feePercent) {
  const fee = Math.round(amount * feePercent / 100);
  const credited = amount - fee;
  return { fee, credited };
}

function topupScene() {
  const scene = new Scenes.BaseScene('topup_flow');

  scene.enter(async ctx => showTopupMenu(ctx));

  scene.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (data === 'back_main') {
      await ctx.answerCbQuery();
      delete waiting[ctx.from.id];
      return ctx.scene.leave();
    }
    return next();
  });

  scene.on('text', async ctx => {
    const w = waiting[ctx.from.id];
    if (!w || w.step !== 'amount') return;

    const amount = parseInt(ctx.message.text.replace(/\D/g, ''));
    if (!amount || amount < 1000) {
      return ctx.reply("❌ Iltimos, to'g'ri summa kiriting (kamida 1000 so'm).");
    }

    const s = await getAllSettings();
    const { fee, credited } = calcFee(amount, s.topup_fee_percent);
    waiting[ctx.from.id] = { step: 'receipt', amount, fee, credited };

    await ctx.reply(
      `💳 <b>To'lov</b>\n\n` +
      `💰 To'lov summasi: <b>${amount.toLocaleString()} so'm</b>\n` +
      `📉 Xizmat haqi (${s.topup_fee_percent}%): <b>−${fee.toLocaleString()} so'm</b>\n` +
      `✅ Balansga qo'shiladigan summa: <b>${credited.toLocaleString()} so'm</b>\n\n` +
      `Quyidagi kartaga ${amount.toLocaleString()} so'm o'tkazing:\n\n` +
      `💳 <code>${s.card_number}</code>\n` +
      `👤 ${s.card_holder}\n\n` +
      `❗️To'lovdan so'ng chek rasmini shu yerga yuboring. Admin tasdiqlagach balansingiz to'ldiriladi.\n\n` +
      `💬 Savol bo'lsa: ${s.support_username}`,
      { parse_mode: 'HTML' }
    );
  });

  scene.on('photo', async ctx => {
    const w = waiting[ctx.from.id];
    if (!w || w.step !== 'receipt') return;
    delete waiting[ctx.from.id];

    const { amount, fee, credited } = w;
    const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    const caption =
      `🧾 <b>Balans to'ldirish so'rovi</b>\n\n` +
      `👤 Foydalanuvchi: ${ctx.from.first_name} (@${ctx.from.username || '—'})\n` +
      `🆔 ID: <code>${ctx.from.id}</code>\n\n` +
      `💰 Kelgan to'lov: <b>${amount.toLocaleString()} so'm</b>\n` +
      `📉 Xizmat haqi: <b>${fee.toLocaleString()} so'm</b>\n` +
      `✅ Balansga qo'shiladi: <b>${credited.toLocaleString()} so'm</b>`;

    for (const adminId of ADMIN_IDS) {
      try {
        await ctx.telegram.sendPhoto(adminId, photo, {
          caption,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Tasdiqlash', `approve_topup_${ctx.from.id}_${credited}_${fee}`),
              Markup.button.callback('❌ Rad etish', `reject_topup_${ctx.from.id}`),
            ],
          ]),
        });
      } catch {}
    }

    await ctx.reply(
      `✅ Chek adminga yuborildi.\n\n` +
      `💰 To'lov: ${amount.toLocaleString()} so'm\n` +
      `📉 Xizmat haqi: ${fee.toLocaleString()} so'm\n` +
      `✅ Tasdiqlangach balansga qo'shiladi: <b>${credited.toLocaleString()} so'm</b>`,
      { parse_mode: 'HTML', ...backToMain() }
    );
    await ctx.scene.leave();
  });

  return scene;
}

async function approveTopup(ctx, targetUserId, credited, fee) {
  await User.findOneAndUpdate(
    { telegramId: targetUserId },
    { $inc: { balance: credited, totalFeeCollected: fee } },
    { upsert: true }
  );
  try {
    await ctx.telegram.sendMessage(
      targetUserId,
      `✅ Balansingiz to'ldirildi!\n\n` +
      `➕ Qo'shildi: <b>${credited.toLocaleString()} so'm</b>\n` +
      `📉 Xizmat haqi (ushlab qolindi): <b>${fee.toLocaleString()} so'm</b>`,
      { parse_mode: 'HTML' }
    );
  } catch {}
}

module.exports = { topupScene, showTopupMenu, approveTopup, calcFee };
