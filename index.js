require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const mongoose = require('mongoose');

const { User, Activation, NumberAccount } = require('./models');
const { isAdmin, adminOnly, ADMIN_IDS } = require('./admin');
const { mainMenu, backToMain, sendMainMenu, safeEdit } = require('./keyboards');
const { requireChannelSub } = require('./channelSub');
const { countryName } = require('./countries');
const { getSetting } = require('./settings');
const userbot = require('./userbot');
const heroSms = require('./heroSms');

const { adminScene, showAdminPanel } = require('./adminScene');
const { topupScene, showTopupMenu, approveTopup, creditStarsPayment } = require('./topupScene');
const tonPayment = require('./tonPayment');
const {
  setBotInstance,
  showCountries,
  handleCountrySelect,
  handleConfirm,
  handleCancelActivation,
  handleIncomingCode,
  startExpiryWatchdog,
} = require('./buyScene');

const bot = new Telegraf(process.env.BOT_TOKEN);
setBotInstance(bot); // buyScene kod kelganda foydalanuvchiga xabar yuborishi uchun

// ---- MongoDB ulanish ----
mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB ulandi');
    // Bot qayta ishga tushganda (Render uxlab qolishi / qayta deploy) barcha login qilingan
    // raqamlar uchun userbot tinglovchilarini qayta ulaydi — shunda kod kelishi to'xtamaydi.
    try {
      const accounts = await NumberAccount.find({
        sessionString: { $exists: true, $ne: '' },
        status: { $in: ['available', 'assigned'] },
      }).lean();
      await userbot.resumeAll(accounts, handleIncomingCode);
      console.log(`🔌 Userbot: ${accounts.length} ta raqam uchun tinglovchi ulandi`);
    } catch (e) {
      console.error('❌ Userbot tinglovchilarini ulashda xato:', e.message);
    }
  })
  .catch(err => console.error('❌ MongoDB xatosi:', err));

// Bot qayta ishga tushsa ham (Render uxlab qolishi / qayta deploy) pending aktivatsiyalarni
// vaqti o'tgach avtomatik bekor qilib, pulni qaytarib turadi.
startExpiryWatchdog(bot);
tonPayment.startTonWatcher(bot); // TON blokcheynidagi to'lovlarni fonda kuzatib turadi

// ---- Scenes ----
const stage = new Scenes.Stage([adminScene(), topupScene()]);
bot.use(session());
bot.use(stage.middleware());

// ---- Foydalanuvchini bazaga yozish ----
bot.use(async (ctx, next) => {
  if (ctx.from) {
    await User.findOneAndUpdate(
      { telegramId: ctx.from.id },
      {
        $setOnInsert: {
          telegramId: ctx.from.id,
          username: ctx.from.username,
          fullName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
        },
      },
      { upsert: true }
    );

    // Referal: /start orqali kelgan referal ID'ni darhol kredit qilmasdan, "kutilayotgan"
    // holatda saqlaymiz — bonus faqat majburiy kanallarga aʼzo boʻlgach beriladi.
    const payload = ctx.startPayload;
    if (payload && /^\d+$/.test(payload)) {
      const refId = parseInt(payload, 10);
      if (refId !== ctx.from.id) {
        await User.updateOne(
          { telegramId: ctx.from.id, referredBy: { $exists: false }, pendingReferrer: { $exists: false } },
          { $set: { pendingReferrer: refId } }
        );
      }
    }
  }
  return next();
});

// ---- Ban tekshiruvi ----
bot.use(async (ctx, next) => {
  if (ctx.from && !isAdmin(ctx.from.id)) {
    const u = await User.findOne({ telegramId: ctx.from.id }, { isBanned: 1 }).lean();
    if (u?.isBanned) {
      const text = '🚫 Siz botdan foydalanish huquqidan mahrum qilingansiz.\nBatafsil maʼlumot uchun admin bilan bogʻlaning.';
      if (ctx.callbackQuery) {
        try { await ctx.answerCbQuery('🚫 Siz bloklangansiz', { show_alert: true }); } catch {}
      } else {
        try { await ctx.reply(text); } catch {}
      }
      return;
    }
  }
  return next();
});

// ---- Majburiy kanal obunasi tekshiruvi ----
bot.use(requireChannelSub);

// ---- Referal bonusini berish: faqat majburiy kanallarga aʼzo boʻlgan foydalanuvchiga ----
async function tryGrantReferralBonus(ctx) {
  if (!ctx.from) return;
  const user = await User.findOne(
    { telegramId: ctx.from.id },
    { pendingReferrer: 1, referredBy: 1 }
  ).lean();
  if (!user || !user.pendingReferrer || user.referredBy) return;

  const refId = user.pendingReferrer;
  // Atomik: faqat hali referredBy o'rnatilmagan bo'lsa bonus beriladi (qayta berilmasligi uchun)
  const updated = await User.findOneAndUpdate(
    { telegramId: ctx.from.id, referredBy: { $exists: false } },
    { $set: { referredBy: refId }, $unset: { pendingReferrer: '' } },
    { new: true }
  );
  if (!updated) return;

  const bonus = await getSetting('referral_bonus_uzs');
  await User.updateOne(
    { telegramId: refId },
    { $inc: { balance: bonus, referralCount: 1 } }
  );
  try {
    await ctx.telegram.sendMessage(
      refId,
      `🎉 Sizning referalingiz orqali taklif qilingan foydalanuvchi majburiy kanallarga aʼzo boʻldi!\n💰 +${bonus.toLocaleString()} so'm balansga qo'shildi.`
    );
  } catch {}
}

bot.use(async (ctx, next) => {
  await tryGrantReferralBonus(ctx);
  return next();
});

// ================= START =================
bot.start(async ctx => {
  const admin = isAdmin(ctx.from.id);

  const userDoc = await User.findOne({ telegramId: ctx.from.id });
  const balance = userDoc?.balance || 0;

  await sendMainMenu(
    ctx,
    `👋 Assalomu alaykum, ${ctx.from.first_name}!\n\n` +
    `📱 Bu bot orqali turli xizmatlar uchun virtual raqamlar sotib olishingiz mumkin.\n\n` +
    `👛 Balansingiz: <b>${balance.toLocaleString()} so'm</b>\n\n` +
    `🔥 Eng arzon takliflarni koʻrish uchun pastdagi tugmani bosing.`,
    mainMenu(admin),
    { edit: false }
  );
});

// ================= KANAL OBUNASINI TEKSHIRISH =================
bot.action('check_sub', async ctx => {
  const admin = isAdmin(ctx.from.id);
  await ctx.answerCbQuery('✅ Tekshirildi!');
  await sendMainMenu(
    ctx,
    `👋 Xush kelibsiz, ${ctx.from.first_name}!\n\nQuyidagi menyudan foydalaning:`,
    mainMenu(admin),
    { edit: true }
  );
});

// ================= MAIN MENU =================
bot.action('back_main', async ctx => {
  await ctx.answerCbQuery();
  const admin = isAdmin(ctx.from.id);
  const userDoc = await User.findOne({ telegramId: ctx.from.id });
  const balance = userDoc?.balance || 0;
  const text = `🏠 <b>Bosh menyu</b>\n\n👛 Balansingiz: <b>${balance.toLocaleString()} so'm</b>`;
  await sendMainMenu(ctx, text, mainMenu(admin), { edit: true });
});

// ================= REFERAL =================
bot.action('referral_info', async ctx => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const bonus = await getSetting('referral_bonus_uzs');
  const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;

  await safeEdit(ctx,
    `🎁 <b>Referal dasturi</b>\n\n` +
    `Doʻstlaringizni taklif qiling va bonus yigʻing!\n\n` +
    `💰 Bonus: <b>${bonus.toLocaleString()} so'm</b> — har bir yangi foydalanuvchi uchun\n` +
    `👥 Sizning referallaringiz: <b>${user?.referralCount || 0}</b>\n\n` +
    `ℹ️ Bonus faqat taklif qilingan foydalanuvchi majburiy kanallarga aʼzo boʻlgandan keyin beriladi.\n\n` +
    `🔗 Sizning referal havolangiz:\n<code>${refLink}</code>`,
    { parse_mode: 'HTML', ...backToMain() }
  );
});

bot.action('help', async ctx => {
  await ctx.answerCbQuery();
  const support = await getSetting('support_username');
  await safeEdit(ctx, 
    `❓ <b>Yordam</b>\n\n` +
    `🔥 "Arzon nomerlar" — davlatlar roʻyxati, eng arzonidan boshlab\n` +
    `📱 "Raqam olish" — davlatni tanlab virtual raqam sotib olish\n` +
    `👤 "Kabinet" — balans va xaridlar tarixi\n` +
    `👛 "Balans to'ldirish" — Telegram Stars yoki karta orqali to'lov\n\n` +
    `💡 Raqam olgach, kod avtomatik kelib, shu yerga yuboriladi — hech narsa bosish shart emas.\n\n` +
    `💬 Savollar bo'yicha: ${support}`,
    { parse_mode: 'HTML', ...backToMain() }
  );
});

// ================= CABINET =================
bot.action('cabinet', async ctx => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const activations = await Activation.find({ telegramId: ctx.from.id }).sort({ createdAt: -1 }).limit(5);

  let histText = activations.length
    ? activations.map(a => `• ${countryName(a.country)} (${a.status === 'success' ? '✅' : a.status === 'pending' ? '⏳' : '❌'}) — ${a.pricePaid.toLocaleString()} so'm`).join('\n')
    : 'Tarix mavjud emas.';

  const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;

  await safeEdit(ctx, 
    `👤 <b>Kabinet</b>\n\n` +
    `🆔 ID: <code>${ctx.from.id}</code>\n` +
    `👛 Balans: <b>${(user?.balance || 0).toLocaleString()} so'm</b>\n` +
    `💸 Jami sarflangan: <b>${(user?.totalSpent || 0).toLocaleString()} so'm</b>\n` +
    `👥 Referallar: <b>${user?.referralCount || 0}</b>\n\n` +
    `📜 <b>Oxirgi xaridlar:</b>\n${histText}\n\n` +
    `🔗 Referal havola:\n<code>${refLink}</code>`,
    { parse_mode: 'HTML', ...backToMain() }
  );
});

// ================= BUY NUMBER =================
bot.action('buy_number', async ctx => {
  await showCountries(ctx);
});

bot.action('cheap_numbers', async ctx => {
  await showCountries(ctx, { title: '🔥 <b>Eng arzon davlatlar</b>' });
});

bot.action(/^buycnt_(.+)$/, async ctx => {
  await handleCountrySelect(ctx, ctx.match[1]);
});

bot.action(/^buyconfirm_(.+)$/, async ctx => {
  await handleConfirm(ctx, ctx.match[1]);
});

bot.action(/^cancel_act_(.+)$/, async ctx => {
  await handleCancelActivation(ctx, ctx.match[1]);
});

// ================= BALANS TO'LDIRISH (entry point) =================
bot.action('topup', async ctx => {
  await ctx.answerCbQuery();
  await ctx.scene.enter('topup_flow');
});

// ================= ADMIN PANEL (entry point) =================
bot.action('admin_panel', adminOnly, async ctx => {
  await ctx.answerCbQuery();
  await ctx.scene.enter('admin');
});

// ================= ADMIN: balans to'ldirish tasdiqlash / rad etish =================
bot.action(/^approve_topup_(\d+)_(\d+)_(\d+)$/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Ruxsat yoq', { show_alert: true });
  await ctx.answerCbQuery('✅ Tasdiqlandi');
  const targetUserId = parseInt(ctx.match[1]);
  const credited = parseInt(ctx.match[2]);
  const fee = parseInt(ctx.match[3]);
  try {
    const updated = await approveTopup(ctx, targetUserId, credited, fee);
    await ctx.editMessageCaption(
      ctx.callbackQuery.message.caption +
        `\n\n✅ <b>TASDIQLANDI</b> (yangi balans: ${updated.balance.toLocaleString()} so'm)`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('Topupni tasdiqlashda xato:', e);
    try {
      await ctx.editMessageCaption(
        ctx.callbackQuery.message.caption + `\n\n❌ <b>XATO:</b> ${e.message}`,
        { parse_mode: 'HTML' }
      );
    } catch {}
  }
});

bot.action(/^reject_topup_(\d+)$/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Ruxsat yoq', { show_alert: true });
  await ctx.answerCbQuery('❌ Rad etildi');
  const targetUserId = parseInt(ctx.match[1]);
  try {
    await ctx.telegram.sendMessage(targetUserId, "❌ To'lov chekingiz rad etildi. Iltimos, admin bilan bog'laning yoki qaytadan urinib ko'ring.", backToMain());
  } catch {}
  try {
    await ctx.editMessageCaption(
      ctx.callbackQuery.message.caption + '\n\n❌ <b>RAD ETILDI</b>',
      { parse_mode: 'HTML' }
    );
  } catch {}
});

// ================= ADMIN: balans qo'shish komandasi =================
// /addbalance <telegram_id> <miqdor>
bot.command('addbalance', async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  const parts = ctx.message.text.split(' ').filter(Boolean);
  if (parts.length !== 3) {
    return ctx.reply('Format: /addbalance <telegram_id> <miqdor>\nMasalan: /addbalance 123456789 50000');
  }
  const [, targetId, amountStr] = parts;
  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return ctx.reply("❌ Miqdor noto'g'ri.");

  await User.findOneAndUpdate(
    { telegramId: parseInt(targetId) },
    { $inc: { balance: amount } },
    { upsert: true }
  );
  await ctx.reply(`✅ ${targetId} ga ${amount.toLocaleString()} so'm qo'shildi.`);
  try {
    await ctx.telegram.sendMessage(targetId, `💰 Balansingizga ${amount.toLocaleString()} so'm qo'shildi!`);
  } catch {}
});

// ================= ADMIN: HeroSMS balansini tekshirish =================
bot.command('herobalance', async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  try {
    const balance = await heroSms.getBalance();
    await ctx.reply(`🦸 HeroSMS balans: $${balance.toFixed(2)}`);
  } catch (e) {
    await ctx.reply(`❌ HeroSMS balansini olishda xato: ${e.message}`);
  }
});

// ================= TELEGRAM STARS TO'LOVI =================
bot.on('pre_checkout_query', async ctx => {
  // Hozircha barcha so'rovlarni tasdiqlaymiz (zaxira/limit tekshiruvi shart emas)
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.error('PreCheckout xatosi:', e.message);
  }
});

bot.on('successful_payment', async ctx => {
  const payment = ctx.message.successful_payment;
  if (payment.currency !== 'XTR') return;

  const starsCount = payment.total_amount;
  // payload formati: topup_<telegramId>_<amountUZS>_<timestamp>
  const parts = (payment.invoice_payload || '').split('_');
  const amountUZS = parseInt(parts[2]) || 0;

  if (amountUZS > 0) {
    await creditStarsPayment(ctx, ctx.from.id, amountUZS, starsCount);
  } else {
    await ctx.reply('✅ To\'lov qabul qilindi, lekin summani aniqlashda xato. Admin bilan bog\'laning.');
  }
});

// ================= ERROR HANDLING =================
bot.catch((err, ctx) => {
  console.error('Bot xatosi:', err);
  try {
    ctx.reply("❌ Texnik xatolik yuz berdi. Iltimos, keyinroq urinib ko'ring.");
  } catch {}
});

// ================= LAUNCH (WEBHOOK + HEALTH CHECK) =================
const express = require('express');
const PORT = process.env.PORT || 3000;
// RENDER_EXTERNAL_URL Render tomonidan avtomatik beriladi (masalan: https://my-bot.onrender.com)
// Agar boshqa hostingda bo'lsa, WEBHOOK_URL ni .env orqali qo'lda bering.
const DOMAIN = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL;
const WEBHOOK_PATH = `/webhook/${process.env.BOT_TOKEN}`;

if (!DOMAIN) {
  console.error('❌ WEBHOOK_URL yoki RENDER_EXTERNAL_URL topilmadi. .env ga WEBHOOK_URL qo\'shing (masalan: https://your-app.onrender.com)');
  process.exit(1);
}

const app = express();
app.use(express.json());

// UptimeRobot yoki boshqa monitoring xizmati uchun "tirikligini" tekshirish yo'li.
// Bu yo'lga har necha daqiqada so'rov yuborilsa, Render bepul instansiyasi uxlab qolmaydi.
app.get('/ping', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.status(200).send('Bot ishlayapti'));

app.use(bot.webhookCallback(WEBHOOK_PATH));

async function setWebhookWithRetry(retries = 8, delaySeconds = 3) {
  try {
    await bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`);
    console.log(`✅ Webhook o'rnatildi: ${DOMAIN}${WEBHOOK_PATH}`);
  } catch (err) {
    const retryAfter = err?.response?.parameters?.retry_after || delaySeconds;
    console.error(`❌ Webhook o'rnatishda xato: ${err.message}`);
    if (retries > 0) {
      console.warn(`⏳ ${retryAfter}s kutib qayta urinish... (qolgan urinishlar: ${retries})`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return setWebhookWithRetry(retries - 1, Math.min(delaySeconds * 2, 30));
    }
    // Urinishlar tugadi — lekin serverni o'chirmaymiz, chunki HTTP server
    // (/ping, /) ishlab turishi kerak; Render health-check shu orqali o'tadi.
    // Webhook keyinroq /set-webhook orqali qo'lda o'rnatilishi mumkin.
    console.error('❌ Webhook barcha urinishlardan keyin ham o\'rnatilmadi. Server ishlashda davom etadi.');
  }
}

app.get('/set-webhook', async (req, res) => {
  try {
    await bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`);
    res.status(200).send('✅ Webhook qayta o\'rnatildi');
  } catch (err) {
    res.status(500).send('❌ Xato: ' + err.message);
  }
});

app.listen(PORT, async () => {
  console.log(`🌐 Server ${PORT}-portda ishga tushdi`);
  setWebhookWithRetry(); // await qilinmaydi — server darhol ishga tushadi, webhook fonda o'rnatiladi
  console.log('🤖 Bot ishga tushdi (webhook)');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
