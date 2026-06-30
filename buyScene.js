const { User, Activation } = require('./models');
const { getSetting } = require('./settings');
const {
  getNumber,
  getStatus,
  setStatus,
  getNumberPrice,
  SERVICES,
  COUNTRIES,
  ERROR_MAP,
} = require('./herosms');
const {
  servicesKeyboard,
  countriesKeyboard,
  confirmBuyKeyboard,
  cancelActivationKeyboard,
  backToMain,
  mainMenu,
} = require('./keyboards');
const { isAdmin } = require('./admin');

// Faol polllar: telegramId -> timeout
const activePolls = {};

function findService(code) {
  return SERVICES.find(s => s.code === code);
}
function findCountry(code) {
  return COUNTRIES.find(c => c.code === code);
}

// Narx hisoblash: dollardagi narxni so'mga o'tkazib, markup qo'shish
async function calcPrice(costUSD) {
  const rate = await getSetting('usd_to_uzs');
  const markup = await getSetting('markup_percent');
  const base = costUSD * rate;
  const final = Math.ceil(base * (1 + markup / 100) / 100) * 100; // 100 so'mga yaxlitlash
  return final;
}

async function showServices(ctx) {
  const text = '📱 <b>Servisni tanlang:</b>';
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...servicesKeyboard() });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...servicesKeyboard() });
  }
}

async function handleServiceSelect(ctx, serviceCode) {
  await ctx.answerCbQuery();
  const svc = findService(serviceCode);
  if (!svc) return;
  await ctx.editMessageText(
    `${svc.name} uchun mamlakatni tanlang:`,
    { parse_mode: 'HTML', ...countriesKeyboard(serviceCode) }
  );
}

async function handleCountrySelect(ctx, serviceCode, countryCode) {
  await ctx.answerCbQuery('⏳ Narx tekshirilmoqda...');
  const svc = findService(serviceCode);
  const cnt = findCountry(countryCode);
  if (!svc || !cnt) return;

  const { cost, count } = await getNumberPrice(process.env.HEROSMS_API_KEY, serviceCode, countryCode);
  const priceUZS = await calcPrice(cost || 0.1);

  const user = await User.findOne({ telegramId: ctx.from.id });
  const balance = user?.balance || 0;

  const text =
    `📋 <b>Buyurtma ma'lumotlari</b>\n\n` +
    `🔧 Servis: <b>${svc.name}</b>\n` +
    `🌍 Mamlakat: <b>${cnt.name}</b>\n` +
    `💰 Narx: <b>${priceUZS.toLocaleString()} so'm</b>\n` +
    `📦 Mavjud raqamlar: <b>${count}</b>\n\n` +
    `👛 Sizning balansingiz: <b>${balance.toLocaleString()} so'm</b>\n\n` +
    (balance >= priceUZS
      ? `✅ Balans yetarli. Tasdiqlaysizmi?`
      : `❌ Balans yetarli emas. Iltimos, balansni to'ldiring.`);

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    ...(balance >= priceUZS
      ? confirmBuyKeyboard(serviceCode, countryCode)
      : backToMain()),
  });
}

async function handleConfirm(ctx, serviceCode, countryCode) {
  await ctx.answerCbQuery('⏳ Raqam olinmoqda...');

  const svc = findService(serviceCode);
  const cnt = findCountry(countryCode);
  const user = await User.findOne({ telegramId: ctx.from.id });

  const { cost } = await getNumberPrice(process.env.HEROSMS_API_KEY, serviceCode, countryCode);
  const priceUZS = await calcPrice(cost || 0.1);

  if ((user?.balance || 0) < priceUZS) {
    return ctx.editMessageText('❌ Balans yetarli emas!', backToMain());
  }

  let numData;
  try {
    numData = await getNumber(process.env.HEROSMS_API_KEY, serviceCode, countryCode);
  } catch (e) {
    const errText = ERROR_MAP[e.message] || ('❌ Xato: ' + e.message);
    return ctx.editMessageText(errText, backToMain());
  }

  // Balansdan ayirish
  await User.updateOne(
    { telegramId: ctx.from.id },
    { $inc: { balance: -priceUZS, totalSpent: priceUZS } }
  );

  // Aktivatsiyani saqlash
  await Activation.create({
    telegramId: ctx.from.id,
    activationId: numData.activationId,
    service: serviceCode,
    country: countryCode,
    phoneNumber: numData.phoneNumber,
    pricePaid: priceUZS,
    status: 'pending',
  });

  await ctx.editMessageText(
    `✅ <b>Raqam tayyor!</b>\n\n` +
    `📱 Raqam: <code>+${numData.phoneNumber}</code>\n` +
    `🔧 Servis: <b>${svc.name}</b>\n` +
    `🌍 Mamlakat: <b>${cnt.name}</b>\n` +
    `💰 To'landi: <b>${priceUZS.toLocaleString()} so'm</b>\n\n` +
    `⏳ SMS kutilmoqda (20 daqiqagacha)...`,
    { parse_mode: 'HTML', ...cancelActivationKeyboard(numData.activationId) }
  );

  // Polling boshlash
  pollForCode(ctx, numData.activationId, ctx.from.id);
}

function pollForCode(ctx, activationId, telegramId) {
  const startTime = Date.now();
  const MAX_WAIT = 20 * 60 * 1000;

  const check = async () => {
    if (Date.now() - startTime > MAX_WAIT) {
      await Activation.updateOne({ activationId }, { status: 'timeout' });
      await ctx.telegram.sendMessage(
        telegramId,
        '⏰ Vaqt tugadi (20 daqiqa). SMS kelmadi. Balans qaytarilmaydi (raqam band qilindi).',
        backToMain()
      );
      delete activePolls[telegramId];
      return;
    }

    try {
      const status = await getStatus(process.env.HEROSMS_API_KEY, activationId);

      if (typeof status === 'string' && status.startsWith('STATUS_OK:')) {
        const code = status.split(':')[1];
        await setStatus(process.env.HEROSMS_API_KEY, activationId, 6); // complete
        await Activation.updateOne({ activationId }, { status: 'success', code });
        await ctx.telegram.sendMessage(
          telegramId,
          `📩 <b>SMS kodi keldi!</b>\n\n🔑 Kod: <code>${code}</code>\n\n✅ Aktivatsiya muvaffaqiyatli yakunlandi.`,
          { parse_mode: 'HTML', ...backToMain() }
        );
        delete activePolls[telegramId];
        return;
      }

      if (status === 'STATUS_CANCEL') {
        await Activation.updateOne({ activationId }, { status: 'cancelled' });
        await ctx.telegram.sendMessage(telegramId, '🚫 Aktivatsiya bekor qilindi.', backToMain());
        delete activePolls[telegramId];
        return;
      }

      // STATUS_WAIT_CODE — davom etamiz
      activePolls[telegramId] = setTimeout(check, 5000);
    } catch {
      activePolls[telegramId] = setTimeout(check, 5000);
    }
  };

  activePolls[telegramId] = setTimeout(check, 3000);
}

async function handleCancelActivation(ctx, activationId) {
  await ctx.answerCbQuery();
  try {
    await setStatus(process.env.HEROSMS_API_KEY, activationId, 8); // cancel
    await Activation.updateOne({ activationId }, { status: 'cancelled' });
    if (activePolls[ctx.from.id]) {
      clearTimeout(activePolls[ctx.from.id]);
      delete activePolls[ctx.from.id];
    }
    await ctx.editMessageText('🚫 Aktivatsiya bekor qilindi.', backToMain());
  } catch (e) {
    await ctx.editMessageText('❌ Bekor qilishda xato: ' + e.message, backToMain());
  }
}

module.exports = {
  showServices,
  handleServiceSelect,
  handleCountrySelect,
  handleConfirm,
  handleCancelActivation,
};
