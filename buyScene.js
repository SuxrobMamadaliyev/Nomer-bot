const { Markup } = require('telegraf');
const { User, Activation, NumberAccount } = require('./models');
const { getSetting, getNumberPrice } = require('./settings');
const { COUNTRIES, findCountry, countryName } = require('./countries');
const {
  countriesForSaleKeyboard,
  confirmBuyKeyboard,
  cancelActivationKeyboard,
  backToMain,
  safeEdit,
} = require('./keyboards');

const DIVIDER = '➖➖➖➖➖➖➖➖➖➖';

// Bot instance — kod kelganda foydalanuvchiga xabar yuborish uchun kerak.
// index.js botni yaratgach setBotInstance(bot) chaqiradi.
let telegram = null;
function setBotInstance(bot) {
  telegram = bot.telegram;
}

// Raqam berilgach kod necha daqiqa kutiladi (o'tsa pul qaytariladi)
async function getWaitMs() {
  const minutes = (await getSetting('number_wait_minutes')) || 5;
  return minutes * 60 * 1000;
}

// Nomerni maxfiylash uchun oxirgi 4 ta raqamidan tashqarisini yulduzcha bilan yopadi
function maskPhone(phone) {
  const str = String(phone);
  if (str.length <= 4) return str;
  const last4 = str.slice(-4);
  return '*'.repeat(str.length - 4) + last4;
}

// Har bir muvaffaqiyatli xariddan keyin "isbot" kanaliga post tashlaydi
async function postProofToChannel(ctx, { countryName: cName, phoneNumber }) {
  const channel = await getSetting('proof_channel');
  if (!channel) return;

  const buyerName = ctx.from.username
    ? `@${ctx.from.username}`
    : (ctx.from.first_name || 'Foydalanuvchi');

  const text =
    `✅ <b>Yangi xarid amalga oshirildi!</b>\n${DIVIDER}\n` +
    `🌍 Davlat: <b>${cName}</b>\n` +
    `📱 Nomer: <code>${maskPhone(phoneNumber)}</code>\n` +
    `👤 Xaridor: ${buyerName}`;

  try {
    await ctx.telegram.sendMessage(channel, text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🤖 Botga oʻtish', `https://t.me/${ctx.botInfo.username}`)],
      ]),
    });
  } catch (e) {
    console.error('Isbot kanaliga post yuborishda xato:', e.message);
  }
}

// Har bir davlat uchun mavjud (status: available) raqamlar sonini hisoblaydi
// va narxi bilan birga qaytaradi. Faqat available > 0 bo'lgan davlatlar chiqadi.
async function getCountryOffers() {
  const counts = await NumberAccount.aggregate([
    { $match: { status: 'available' } },
    { $group: { _id: '$country', count: { $sum: 1 } } },
  ]);
  const prices = (await getSetting('number_prices')) || {};

  const offers = counts
    .map(c => ({
      code: c._id,
      name: countryName(c._id),
      available: c.count,
      price: prices[c._id] || 0,
    }))
    .filter(o => o.available > 0 && o.price > 0)
    .sort((a, b) => a.price - b.price);

  return offers;
}

async function showCountries(ctx, { title = '🌍 <b>Davlatni tanlang</b>' } = {}) {
  const offers = await getCountryOffers();

  if (!offers.length) {
    const text = `📭 <b>Hozircha mavjud emas</b>\n${DIVIDER}\nHozircha sotuvda raqam yoʻq. Birozdan keyin urinib koʻring.`;
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
      return safeEdit(ctx, text, { parse_mode: 'HTML', ...backToMain() });
    }
    return ctx.reply(text, { parse_mode: 'HTML', ...backToMain() });
  }

  const text = `${title}\n${DIVIDER}\n💰 Narx har bir davlat yonida koʻrsatilgan.`;
  const keyboard = countriesForSaleKeyboard(offers);

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

async function handleCountrySelect(ctx, countryCode) {
  await ctx.answerCbQuery('⏳ Tekshirilmoqda...');

  const cnt = findCountry(countryCode) || { code: countryCode, name: countryName(countryCode) };
  const available = await NumberAccount.countDocuments({ country: countryCode, status: 'available' });
  const price = await getNumberPrice(countryCode);

  if (!available || !price) {
    return safeEdit(ctx,
      `📭 <b>Raqamlar tugagan</b>\n${DIVIDER}\n${cnt.name} uchun hozircha mavjud raqam yoʻq.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  }

  const user = await User.findOne({ telegramId: ctx.from.id });
  const balance = user?.balance || 0;
  const enough = balance >= price;

  const text =
    `📋 <b>Buyurtma maʼlumotlari</b>\n${DIVIDER}\n` +
    `🌍 Mamlakat: <b>${cnt.name}</b>\n` +
    `💰 Narx: <b>${price.toLocaleString()} so'm</b>\n` +
    `📦 Mavjud raqamlar: <b>${available} dona</b>\n${DIVIDER}\n` +
    `👛 Balansingiz: <b>${balance.toLocaleString()} so'm</b>\n\n` +
    (enough
      ? `✅ Balans yetarli. Tasdiqlaysizmi?`
      : `❌ Balans yetarli emas. Iltimos, avval balansni toʻldiring.`);

  await safeEdit(ctx, text, {
    parse_mode: 'HTML',
    ...(enough ? confirmBuyKeyboard(countryCode) : backToMain()),
  });
}

async function handleConfirm(ctx, countryCode) {
  await ctx.answerCbQuery('⏳ Raqam biriktirilmoqda...');

  const cnt = findCountry(countryCode) || { code: countryCode, name: countryName(countryCode) };
  const price = await getNumberPrice(countryCode);
  const user = await User.findOne({ telegramId: ctx.from.id });

  if (!price) {
    return safeEdit(ctx, '⚠️ Narx sozlanmagan. Admin bilan bogʻlaning.', { parse_mode: 'HTML', ...backToMain() });
  }
  if ((user?.balance || 0) < price) {
    return safeEdit(ctx, '❌ Balans yetarli emas!', { parse_mode: 'HTML', ...backToMain() });
  }

  // Atomik: faqat "available" bo'lgan bitta raqamni "assigned" ga o'tkazadi —
  // shu tufayli ikkita foydalanuvchi bir xil raqamni bir vaqtda ololmaydi.
  const numberDoc = await NumberAccount.findOneAndUpdate(
    { country: countryCode, status: 'available' },
    { status: 'assigned', assignedTo: ctx.from.id, assignedAt: new Date() },
    { new: true }
  );

  if (!numberDoc) {
    return safeEdit(ctx,
      `📭 Afsuski, bu oraliqda raqamlar tugab qoldi. Boshqa davlatni tanlang.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  }

  // Balansdan ayirish
  await User.updateOne(
    { telegramId: ctx.from.id },
    { $inc: { balance: -price, totalSpent: price } }
  );

  // Aktivatsiyani saqlash
  const activation = await Activation.create({
    telegramId: ctx.from.id,
    numberAccountId: numberDoc._id,
    country: countryCode,
    phoneNumber: numberDoc.phoneNumber,
    pricePaid: price,
    status: 'pending',
  });

  const waitMinutes = (await getSetting('number_wait_minutes')) || 5;

  await safeEdit(ctx,
    `✅ <b>Raqam tayyor!</b>\n${DIVIDER}\n` +
    `📱 Raqam: <code>+${numberDoc.phoneNumber}</code>\n` +
    `🌍 Mamlakat: <b>${cnt.name}</b>\n` +
    `💰 To'landi: <b>${price.toLocaleString()} so'm</b>\n${DIVIDER}\n` +
    `⏳ Kod kutilmoqda (${waitMinutes} daqiqagacha)...\n` +
    `📩 Kod kelishi bilan avtomatik shu yerga yuboriladi.`,
    { parse_mode: 'HTML', ...cancelActivationKeyboard(activation._id) }
  );

  postProofToChannel(ctx, { countryName: cnt.name, phoneNumber: numberDoc.phoneNumber });
}

// userbot.js dan kod kelganda chaqiriladi (index.js orqali ulanadi).
// Mos "pending" aktivatsiya bo'lsa — xaridorga yetkazadi va raqamni "used" qiladi.
// Bo'lmasa (masalan hali sotilmagan raqamga test SMS kelsa) — faqat admin uchun saqlab qo'yadi.
async function handleIncomingCode({ phoneNumber, code, rawText }) {
  const activation = await Activation.findOneAndUpdate(
    { phoneNumber, status: 'pending' },
    { status: 'success', code }
  );

  await NumberAccount.updateOne(
    { phoneNumber },
    { lastCode: code, lastCodeAt: new Date(), ...(activation ? { status: 'used' } : {}) }
  );

  if (!activation) return; // hech kim kutmayotgan edi

  if (telegram) {
    try {
      await telegram.sendMessage(
        activation.telegramId,
        `📩 <b>Kod keldi!</b>\n\n🔑 Kod: <code>${code}</code>\n\n✅ Aktivatsiya muvaffaqiyatli yakunlandi.`,
        { parse_mode: 'HTML', ...backToMain() }
      );
    } catch (e) {
      console.error('Kodni foydalanuvchiga yuborishda xato:', e.message);
    }
  }
}

// Pending aktivatsiyani atomik ravishda "timeout" ga o'tkazadi va pulni qaytaradi.
async function refundIfExpired(activation) {
  const updated = await Activation.findOneAndUpdate(
    { _id: activation._id, status: 'pending' },
    { status: 'timeout' }
  );
  if (!updated) return; // allaqachon yakunlangan

  await NumberAccount.updateOne({ phoneNumber: activation.phoneNumber }, { status: 'used' });

  await User.updateOne(
    { telegramId: activation.telegramId },
    { $inc: { balance: activation.pricePaid, totalSpent: -activation.pricePaid } }
  );

  if (!telegram) return;
  const waitMinutes = (await getSetting('number_wait_minutes')) || 5;
  try {
    await telegram.sendMessage(
      activation.telegramId,
      `⏰ <b>Vaqt tugadi (${waitMinutes} daqiqa)</b>\n${DIVIDER}\n` +
      `📵 Nomerga kod kelmadi.\n` +
      `💰 To'langan <b>${activation.pricePaid.toLocaleString()} so'm</b> hisobingizga qaytarildi.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  } catch {}
}

// Bot qayta ishga tushganda ham pending aktivatsiyalar "osilib qolmasligi" uchun
// DB'ni davriy tekshirib turadigan qo'riqchi.
const WATCHDOG_INTERVAL = 20 * 1000; // 20 soniyada bir tekshiradi

function startExpiryWatchdog(bot) {
  setInterval(async () => {
    try {
      const waitMs = await getWaitMs();
      const cutoff = new Date(Date.now() - waitMs);
      const expired = await Activation.find({ status: 'pending', createdAt: { $lte: cutoff } }).lean();
      for (const act of expired) {
        await refundIfExpired(act);
      }
    } catch (e) {
      console.error('Watchdog xatosi:', e.message);
    }
  }, WATCHDOG_INTERVAL);
}

async function handleCancelActivation(ctx, activationId) {
  await ctx.answerCbQuery();
  try {
    const activation = await Activation.findOneAndUpdate(
      { _id: activationId, status: 'pending' },
      { status: 'cancelled' }
    );

    let text = '🚫 Aktivatsiya bekor qilindi.';
    if (activation) {
      await NumberAccount.updateOne({ phoneNumber: activation.phoneNumber }, { status: 'used' });
      await User.updateOne(
        { telegramId: ctx.from.id },
        { $inc: { balance: activation.pricePaid, totalSpent: -activation.pricePaid } }
      );
      text = `🚫 <b>Aktivatsiya bekor qilindi</b>\n${DIVIDER}\n` +
        `💰 To'langan <b>${activation.pricePaid.toLocaleString()} so'm</b> hisobingizga qaytarildi.`;
    }

    await safeEdit(ctx, text, { parse_mode: 'HTML', ...backToMain() });
  } catch (e) {
    await safeEdit(ctx, '❌ Bekor qilishda xato: ' + e.message, backToMain());
  }
}

module.exports = {
  setBotInstance,
  showCountries,
  handleCountrySelect,
  handleConfirm,
  handleCancelActivation,
  handleIncomingCode,
  startExpiryWatchdog,
};
