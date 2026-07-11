const { Markup } = require('telegraf');
const { User, Activation, NumberAccount } = require('./models');
const { getSetting, getNumberPrice, calcPriceUZS } = require('./settings');
const { COUNTRIES, findCountry, countryName } = require('./countries');
const heroSms = require('./heroSms');
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

// ---- HeroSMS narxlarini keshlab olish (bir necha mashhur xizmat bo'yicha) ----
// Faqat Telegram emas — O'zbekistonda ommaviy ishlatiladigan servislar bo'yicha ham
// tekshiramiz va har bir davlat uchun eng arzon (va mavjud) variantni tanlaymiz.
const POPULAR_SERVICES = [
  { code: 'tg', label: 'Telegram' },
  { code: 'wa', label: 'WhatsApp' },
  { code: 'ig', label: 'Instagram' },
  { code: 'fb', label: 'Facebook' },
  { code: 'go', label: 'Google' },
];

let heroPricesCache = null; // { [countryCode]: { service, label, cost, count } } — eng arzoni
let heroPricesCacheAt = 0;
const HERO_PRICE_TTL = 3 * 60 * 1000; // 3 daqiqa

// countryId -> countryCode xaritasi (COUNTRIES + heroSms.getCountries asosida)
let heroIdToCodeCache = null;
async function getHeroIdToCodeMap() {
  if (heroIdToCodeCache) return heroIdToCodeCache;
  const map = {};
  for (const c of COUNTRIES) {
    if (!c.heroName) continue;
    try {
      const id = await heroSms.resolveCountryId(c.heroName);
      if (id != null) map[id] = c.code;
    } catch (e) {
      console.error('HeroSMS davlat ID aniqlashda xato:', e.message);
      break; // API ishlamayotgan bo'lsa qolganlarini ham urinmaymiz
    }
  }
  heroIdToCodeCache = map;
  return map;
}

// countryCode -> { service, label, cost, count } — barcha POPULAR_SERVICES orasidan
// har bir davlat uchun eng arzon VA mavjud bo'lgan xizmatni tanlaydi.
async function getHeroOffersByCode() {
  if (heroPricesCache && Date.now() - heroPricesCacheAt < HERO_PRICE_TTL) {
    return heroPricesCache;
  }
  try {
    const idToCode = await getHeroIdToCodeMap();
    const perService = await Promise.all(
      POPULAR_SERVICES.map(async svc => {
        try {
          return { svc, prices: await heroSms.getPricesForService(svc.code) };
        } catch (e) {
          console.error(`HeroSMS narxlarini olishda xato (${svc.code}):`, e.message);
          return { svc, prices: {} };
        }
      })
    );

    const result = {};
    for (const { svc, prices } of perService) {
      for (const countryId of Object.keys(prices)) {
        const code = idToCode[countryId];
        if (!code) continue; // roʻyxatimizda yo'q davlat — e'tiborsiz qoldiramiz
        const entry = prices[countryId];
        const current = result[code];
        if (!current || entry.cost < current.cost) {
          result[code] = { service: svc.code, label: svc.label, cost: entry.cost, count: entry.count };
        }
      }
    }
    heroPricesCache = result;
    heroPricesCacheAt = Date.now();
    return result;
  } catch (e) {
    console.error('HeroSMS narxlarini olishda xato:', e.message);
    return heroPricesCache || {};
  }
}

async function heroCountryIdFor(countryCode) {
  const c = findCountry(countryCode);
  if (!c || !c.heroName) return null;
  try {
    return await heroSms.resolveCountryId(c.heroName);
  } catch (e) {
    console.error('HeroSMS davlat ID aniqlashda xato:', e.message);
    return null;
  }
}

// Har bir davlat uchun umumiy taklifni hisoblaydi: admin bazasi + HeroSMS.
// Narx: admin qo'lda belgilagan number_prices ustuvor, aks holda HeroSMS narxidan
// (markup bilan) hisoblanadi.
//
// MUHIM: admin panel orqali istalgan davlat kodi bilan raqam qo'shish mumkin (COUNTRIES
// roʻyxati faqat HeroSMS bilan moslashtirish uchun "tavsiya etilgan" roʻyxat, cheklov emas).
// Shu sabab bu yerda faqat COUNTRIES emas, balki admin bazasida haqiqatda mavjud bo'lgan
// barcha davlat kodlari + HeroSMS'dagi davlatlar birlashtiriladi — aks holda admin
// qo'shgan, lekin "tavsiya" roʻyxatida yo'q davlatlar xaridorlarga ko'rinmay qoladi.
async function getCountryOffers() {
  const adminCounts = await NumberAccount.aggregate([
    { $match: { status: 'available' } },
    { $group: { _id: '$country', count: { $sum: 1 } } },
  ]);
  const adminAvailable = {};
  for (const row of adminCounts) adminAvailable[row._id] = row.count;

  const manualPrices = (await getSetting('number_prices')) || {};
  const heroOffers = await getHeroOffersByCode();

  // Admin bazasidagi barcha davlat kodlari + HeroSMS'da mavjud kodlar — ikkalasi birlashtiriladi
  const allCodes = new Set([...Object.keys(adminAvailable), ...Object.keys(heroOffers)]);

  const offers = [];
  for (const code of allCodes) {
    const adminCount = adminAvailable[code] || 0;
    const hero = heroOffers[code];
    const heroCount = hero ? hero.count : 0;
    const totalAvailable = adminCount + heroCount;
    if (!totalAvailable) continue;

    let price = manualPrices[code] || 0;
    if (!price && hero) price = await calcPriceUZS(hero.cost);
    if (!price) continue; // narx sozlanmagan bo'lsa — ko'rsatilmaydi

    offers.push({
      code,
      name: countryName(code),
      available: totalAvailable,
      price,
    });
  }

  return offers.sort((a, b) => a.price - b.price);
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

// Bitta davlat uchun narx va mavjudlikni hisoblaydi (admin + HeroSMS birlashtirilgan)
async function getOfferFor(countryCode) {
  const adminCount = await NumberAccount.countDocuments({ country: countryCode, status: 'available' });
  const heroOffers = await getHeroOffersByCode();
  const hero = heroOffers[countryCode];
  const heroCount = hero ? hero.count : 0;

  const manualPrice = await getNumberPrice(countryCode);
  let price = manualPrice;
  if (!price && hero) price = await calcPriceUZS(hero.cost);

  return {
    adminCount,
    heroCount,
    total: adminCount + heroCount,
    price,
    heroService: hero ? hero.service : null,
  };
}

async function handleCountrySelect(ctx, countryCode) {
  await ctx.answerCbQuery('⏳ Tekshirilmoqda...');

  const cnt = findCountry(countryCode) || { code: countryCode, name: countryName(countryCode) };
  const { total, price } = await getOfferFor(countryCode);

  if (!total || !price) {
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
    `📦 Mavjud raqamlar: <b>${total} dona</b>\n${DIVIDER}\n` +
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
  const { price, heroService } = await getOfferFor(countryCode);
  const user = await User.findOne({ telegramId: ctx.from.id });

  if (!price) {
    return safeEdit(ctx, '⚠️ Narx sozlanmagan. Admin bilan bogʻlaning.', { parse_mode: 'HTML', ...backToMain() });
  }
  if ((user?.balance || 0) < price) {
    return safeEdit(ctx, '❌ Balans yetarli emas!', { parse_mode: 'HTML', ...backToMain() });
  }

  // 1-urinish: admin bazasidan ("userbot" manba). Atomik: faqat "available"
  // bo'lgan bitta raqamni "assigned" ga o'tkazadi — shu tufayli ikkita
  // foydalanuvchi bir xil raqamni bir vaqtda ololmaydi.
  const numberDoc = await NumberAccount.findOneAndUpdate(
    { country: countryCode, status: 'available' },
    { status: 'assigned', assignedTo: ctx.from.id, assignedAt: new Date() },
    { new: true }
  );

  let phoneNumber, source, heroActivationId, numberAccountId, heroServiceLabel;

  if (numberDoc) {
    phoneNumber = numberDoc.phoneNumber;
    source = 'userbot';
    numberAccountId = numberDoc._id;
  } else {
    // 2-urinish: admin bazasida yo'q — HeroSMS API orqali sotib olamiz.
    // Eng arzon topilgan xizmat (Telegram/WhatsApp/Instagram/...) bo'yicha so'raymiz.
    const heroId = await heroCountryIdFor(countryCode);
    if (heroId == null) {
      return safeEdit(ctx,
        `📭 Afsuski, bu oraliqda raqamlar tugab qoldi. Boshqa davlatni tanlang.`,
        { parse_mode: 'HTML', ...backToMain() }
      );
    }
    const svc = POPULAR_SERVICES.find(s => s.code === heroService) || POPULAR_SERVICES[0];
    try {
      const bought = await heroSms.getNumber({ country: heroId, service: svc.code });
      phoneNumber = bought.phoneNumber;
      heroActivationId = bought.activationId;
      heroServiceLabel = svc.label;
      source = 'herosms';
      heroSms.markReady(heroActivationId).catch(() => {}); // muhim emas, fonda
    } catch (e) {
      console.error(`HeroSMS'dan raqam olishda xato (${countryCode}):`, e.message);
      return safeEdit(ctx,
        `📭 Afsuski, bu oraliqda raqamlar tugab qoldi. Boshqa davlatni tanlang.`,
        { parse_mode: 'HTML', ...backToMain() }
      );
    }
  }

  // Balansdan ayirish
  await User.updateOne(
    { telegramId: ctx.from.id },
    { $inc: { balance: -price, totalSpent: price } }
  );

  // Aktivatsiyani saqlash
  const activation = await Activation.create({
    telegramId: ctx.from.id,
    numberAccountId,
    country: countryCode,
    phoneNumber,
    pricePaid: price,
    status: 'pending',
    source,
    heroActivationId,
    heroServiceLabel,
  });

  const waitMinutes = (await getSetting('number_wait_minutes')) || 5;

  await safeEdit(ctx,
    `✅ <b>Raqam tayyor!</b>\n${DIVIDER}\n` +
    `📱 Raqam: <code>+${phoneNumber}</code>\n` +
    `🌍 Mamlakat: <b>${cnt.name}</b>\n` +
    (heroServiceLabel ? `📲 Xizmat: <b>${heroServiceLabel}</b>\n` : '') +
    `💰 To'landi: <b>${price.toLocaleString()} so'm</b>\n${DIVIDER}\n` +
    `⏳ Kod kutilmoqda (${waitMinutes} daqiqagacha)...\n` +
    `📩 Kod kelishi bilan avtomatik shu yerga yuboriladi.`,
    { parse_mode: 'HTML', ...cancelActivationKeyboard(activation._id) }
  );

  postProofToChannel(ctx, { countryName: cnt.name, phoneNumber });
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

  await deliverCode(activation, code);
}

async function deliverCode(activation, code) {
  if (!telegram) return;
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

// ---- HeroSMS: pending aktivatsiyalarni davriy so'rab, kod kelganini tekshiradi ----
const HERO_POLL_INTERVAL = 10 * 1000; // 10 soniyada bir

function startHeroPolling() {
  setInterval(async () => {
    try {
      const pending = await Activation.find({ status: 'pending', source: 'herosms' }).lean();
      for (const act of pending) {
        try {
          const st = await heroSms.getStatus(act.heroActivationId);
          if (st.status === 'OK' && st.code) {
            const updated = await Activation.findOneAndUpdate(
              { _id: act._id, status: 'pending' },
              { status: 'success', code: st.code }
            );
            if (updated) {
              await deliverCode(act, st.code);
              heroSms.complete(act.heroActivationId).catch(() => {});
            }
          } else if (st.status === 'CANCEL') {
            // HeroSMS tomonidan bekor qilingan (masalan tashqi sabab bilan) — pulni qaytaramiz
            await refundIfExpired(act);
          }
        } catch (e) {
          console.error(`HeroSMS holatini tekshirishda xato (${act.heroActivationId}):`, e.message);
        }
      }
    } catch (e) {
      console.error('HeroSMS polling xatosi:', e.message);
    }
  }, HERO_POLL_INTERVAL);
}

// Pending aktivatsiyani atomik ravishda "timeout" ga o'tkazadi va pulni qaytaradi.
async function refundIfExpired(activation) {
  const updated = await Activation.findOneAndUpdate(
    { _id: activation._id, status: 'pending' },
    { status: 'timeout' }
  );
  if (!updated) return; // allaqachon yakunlangan

  if (activation.source === 'herosms' && activation.heroActivationId) {
    await heroSms.cancel(activation.heroActivationId);
  } else {
    await NumberAccount.updateOne({ phoneNumber: activation.phoneNumber }, { status: 'used' });
  }

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
  startHeroPolling();
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
      if (activation.source === 'herosms' && activation.heroActivationId) {
        await heroSms.cancel(activation.heroActivationId);
      } else {
        await NumberAccount.updateOne({ phoneNumber: activation.phoneNumber }, { status: 'used' });
      }
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
