const { Scenes, Markup } = require('telegraf');
const { User } = require('./models');
const { getAllSettings } = require('./settings');
const { backToMain, safeEdit, styledButton } = require('./keyboards');
const { ADMIN_IDS } = require('./admin');
const tonPayment = require('./tonPayment');

// Waiting state: telegramId -> { step, method, amount, fee, credited }
const waiting = {};

function methodKeyboard(tonEnabled) {
  const rows = [
    [styledButton('⭐ Telegram Stars (avtomatik)', 'topup_method_stars', 'primary')],
  ];
  if (tonEnabled) {
    rows.push([styledButton('💎 TON (avtomatik)', 'topup_method_ton', 'primary')]);
  }
  rows.push([Markup.button.callback('💳 Karta orqali (chek bilan)', 'topup_method_card')]);
  rows.push([styledButton('❌ Bekor', 'back_main', 'danger')]);
  return Markup.inlineKeyboard(rows);
}

function tonPayKeyboard(link, invoiceId) {
  return Markup.inlineKeyboard([
    [Markup.button.url('💎 Tonkeeper orqali toʻlash', link)],
    [styledButton('✅ Toʻlovni tekshirish', `ton_check_${invoiceId}`, 'success')],
    [styledButton('❌ Bekor qilish', 'back_main', 'danger')],
  ]);
}

async function showTopupMenu(ctx) {
  const user = await User.findOne({ telegramId: ctx.from.id });
  const s = await getAllSettings();
  const tonEnabled = !!(s.ton_wallet_address && s.ton_to_uzs > 0);
  const text =
    `👛 <b>Balans to'ldirish</b>\n\n` +
    `💰 Joriy balans: <b>${(user?.balance || 0).toLocaleString()} so'm</b>\n\n` +
    `To'ldirish usulini tanlang:`;

  waiting[ctx.from.id] = { step: 'choose_method' };

  if (ctx.callbackQuery) {
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...methodKeyboard(tonEnabled) });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...methodKeyboard(tonEnabled) });
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

    if (data === 'topup_method_ton') {
      await ctx.answerCbQuery();
      const s = await getAllSettings();
      if (!s.ton_wallet_address || !s.ton_to_uzs) {
        return safeEdit(ctx, "❌ TON orqali toʻldirish hozircha sozlanmagan. Boshqa usulni tanlang.", { parse_mode: 'HTML', ...methodKeyboard(false) });
      }
      waiting[ctx.from.id] = { step: 'amount', method: 'ton' };
      return safeEdit(ctx,
        `💎 <b>TON orqali toʻldirish</b>\n\n` +
        `ℹ️ Kurs: 1 TON = ${s.ton_to_uzs.toLocaleString()} so'm\n` +
        `✅ Toʻlov avtomatik aniqlanadi, hech qanday chek yuborish shart emas.\n` +
        `ℹ️ Minimal depozit: <b>${s.min_balance_uzs.toLocaleString()} so'm</b>\n\n` +
        `To'ldirish uchun summani kiriting (so'mda), masalan: <code>50000</code>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[styledButton('❌ Bekor', 'topup', 'danger')]]) }
      );
    }

    if (data === 'topup_method_card') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = { step: 'amount', method: 'card' };
      const s = await getAllSettings();
      return safeEdit(ctx, 
        `💳 <b>Karta orqali to'ldirish</b>\n\n` +
        `ℹ️ To'ldirishda <b>${s.topup_fee_percent}%</b> xizmat haqi ushlab qolinadi.\n` +
        `ℹ️ Minimal depozit: <b>${s.min_balance_uzs.toLocaleString()} so'm</b>\n\n` +
        `To'ldirish uchun summani kiriting (so'mda), masalan: <code>50000</code>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[styledButton('❌ Bekor', 'topup', 'danger')]]) }
      );
    }

    if (data === 'topup_method_stars') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = { step: 'amount', method: 'stars' };
      const s = await getAllSettings();
      return safeEdit(ctx, 
        `⭐ <b>Telegram Stars orqali to'ldirish</b>\n\n` +
        `ℹ️ Kurs: 1 ⭐ = ${s.star_to_uzs.toLocaleString()} so'm\n` +
        `✅ Bu usulda komissiya olinmaydi, balans darhol avtomatik to'ldiriladi.\n` +
        `ℹ️ Minimal depozit: <b>${s.min_balance_uzs.toLocaleString()} so'm</b>\n\n` +
        `To'ldirish uchun summani kiriting (so'mda), masalan: <code>50000</code>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[styledButton('❌ Bekor', 'topup', 'danger')]]) }
      );
    }

    if (data === 'topup') {
      await ctx.answerCbQuery();
      return showTopupMenu(ctx);
    }

    if (data.startsWith('ton_check_')) {
      const invoiceId = data.replace('ton_check_', '');
      await ctx.answerCbQuery('⏳ Tekshirilmoqda...');
      try {
        await tonPayment.checkPendingInvoices(); // navbatdan tashqari darhol tekshiradi
        const invoice = await tonPayment.getInvoiceById(invoiceId);
        if (!invoice) {
          return ctx.reply('❌ Invoys topilmadi.', backToMain());
        }
        if (invoice.status === 'paid') {
          return ctx.reply(
            `✅ Toʻlov allaqachon tasdiqlangan!\n➕ Balansga qoʻshildi: ${invoice.amountUZS.toLocaleString()} so'm`,
            backToMain()
          );
        }
        if (invoice.status === 'expired') {
          return ctx.reply('⏰ Bu invoysning muddati tugagan. Iltimos, qaytadan urinib koʻring.', backToMain());
        }
        return ctx.reply("⏳ Toʻlov hali aniqlanmadi. Toʻlovni amalga oshirgan boʻlsangiz, bir necha soniya kutib qaytadan tekshiring.");
      } catch (e) {
        return ctx.reply('❌ Tekshirishda xato: ' + e.message);
      }
    }

    return next();
  });

  scene.on('text', async ctx => {
    const w = waiting[ctx.from.id];
    if (!w || w.step !== 'amount') return;

    const amount = parseInt(ctx.message.text.replace(/\D/g, ''));
    const s = await getAllSettings();
    const minDeposit = s.min_balance_uzs || 1000;
    if (!amount || amount < minDeposit) {
      return ctx.reply(`❌ Iltimos, to'g'ri summa kiriting (kamida ${minDeposit.toLocaleString()} so'm).`);
    }

    if (w.method === 'stars') {
      // Stars orqali to'lov — narxni Stars'ga aylantiramiz
      const starsAmount = Math.ceil(amount / s.star_to_uzs);
      delete waiting[ctx.from.id];

      try {
        await ctx.replyWithInvoice({
          title: "Balansni to'ldirish",
          description: `Botdagi balansingizga ${amount.toLocaleString()} so'm qo'shiladi.`,
          payload: `topup_${ctx.from.id}_${amount}_${Date.now()}`,
          provider_token: '', // Stars uchun bo'sh
          currency: 'XTR',
          prices: [{ label: 'Balans to\'ldirish', amount: starsAmount }],
        });
        await ctx.reply(
          `⭐ Hisob-faktura yuborildi: <b>${starsAmount} Stars</b> (≈ ${amount.toLocaleString()} so'm)\n\n` +
          `To'lovni amalga oshirish uchun yuqoridagi xabardagi "Pay" tugmasini bosing.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        await ctx.reply('❌ Hisob-faktura yaratishda xato: ' + e.message, backToMain());
      }
      return;
    }

    if (w.method === 'ton') {
      delete waiting[ctx.from.id];
      try {
        const { invoice, link } = await tonPayment.createInvoice(ctx.from.id, amount);
        await ctx.reply(
          `💎 <b>TON orqali toʻlov</b>\n\n` +
          `💰 Toʻlanadigan summa: <b>${invoice.amountTon} TON</b> (≈ ${amount.toLocaleString()} so'm)\n\n` +
          `1️⃣ Pastdagi "Tonkeeper orqali toʻlash" tugmasini bosing — ilova avtomatik ochilib, manzil, summa va izoh oldindan toʻldirilgan boʻladi.\n` +
          `2️⃣ Tonkeeperda toʻlovni tasdiqlang.\n` +
          `3️⃣ Toʻlov bir necha soniyada avtomatik aniqlanadi va balansingiz toʻldiriladi.\n\n` +
          `❗️ Izohni (comment) oʻchirmang — toʻlovingiz aynan shu orqali aniqlanadi.\n` +
          `⏳ Invoys 30 daqiqa amal qiladi.`,
          { parse_mode: 'HTML', ...tonPayKeyboard(link, invoice._id) }
        );
      } catch (e) {
        await ctx.reply('❌ ' + e.message, backToMain());
      }
      return;
    }

    // Karta orqali (chek bilan)
    const { fee, credited } = calcFee(amount, s.topup_fee_percent);
    waiting[ctx.from.id] = { step: 'receipt', method: 'card', amount, fee, credited };

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
      `🧾 <b>Balans to'ldirish so'rovi (Karta)</b>\n\n` +
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
              styledButton('✅ Tasdiqlash', `approve_topup_${ctx.from.id}_${credited}_${fee}`, 'success'),
              styledButton('❌ Rad etish', `reject_topup_${ctx.from.id}`, 'danger'),
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

// Karta orqali to'lovni admin tasdiqlaganda chaqiriladi
async function approveTopup(ctx, targetUserId, credited, fee) {
  const updated = await User.findOneAndUpdate(
    { telegramId: targetUserId },
    { $inc: { balance: credited, totalFeeCollected: fee } },
    { upsert: true, new: true }
  );
  try {
    await ctx.telegram.sendMessage(
      targetUserId,
      `✅ Balansingiz to'ldirildi!\n\n` +
      `➕ Qo'shildi: <b>${credited.toLocaleString()} so'm</b>\n` +
      `📉 Xizmat haqi (ushlab qolindi): <b>${fee.toLocaleString()} so'm</b>\n` +
      `👛 Joriy balans: <b>${updated.balance.toLocaleString()} so'm</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('Foydalanuvchiga xabar yuborishda xato:', e.message);
  }
  return updated;
}

// Stars orqali to'lov muvaffaqiyatli bo'lganda chaqiriladi (index.js dagi successful_payment handlerida)
async function creditStarsPayment(ctx, telegramId, amountUZS, starsCount) {
  await User.findOneAndUpdate(
    { telegramId },
    { $inc: { balance: amountUZS } },
    { upsert: true }
  );
  await ctx.reply(
    `✅ <b>To'lov muvaffaqiyatli!</b>\n\n` +
    `⭐ To'landi: <b>${starsCount} Stars</b>\n` +
    `➕ Balansga qo'shildi: <b>${amountUZS.toLocaleString()} so'm</b>`,
    { parse_mode: 'HTML', ...backToMain() }
  );
}

module.exports = { topupScene, showTopupMenu, approveTopup, calcFee, creditStarsPayment };
