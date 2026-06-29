/**
 * HeroSMS Telegram Bot
 * HeroSMS API (SMS-Activate protokoliga mos) orqali vaqtinchalik raqam sotib oladi
 * va kelgan SMS kodni foydalanuvchiga yuboradi.
 *
 * .env fayl kerak:
 *   BOT_TOKEN=...........
 *   HEROSMS_API_KEY=...........
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_KEY = process.env.HEROSMS_API_KEY;
const API_URL = 'https://hero-sms.com/stubs/handler_api.php';

if (!BOT_TOKEN || !API_KEY) {
  console.error('BOT_TOKEN va HEROSMS_API_KEY .env faylda bo\'lishi shart!');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Foydalanuvchi holatini saqlash uchun (oddiy in-memory, production uchun DB tavsiya etiladi)
const userState = {}; // chatId -> { service, country, activationId, phoneNumber, pollTimer }

// ---- HeroSMS API yordamchi funksiyalar ----

async function apiRequest(params) {
  const res = await axios.get(API_URL, {
    params: { api_key: API_KEY, ...params },
    timeout: 15000,
  });
  return res.data;
}

async function getBalance() {
  const data = await apiRequest({ action: 'getBalance' });
  // Format: ACCESS_BALANCE:123.45
  if (typeof data === 'string' && data.startsWith('ACCESS_BALANCE:')) {
    return data.split(':')[1];
  }
  throw new Error('Balansni olishda xatolik: ' + data);
}

async function getNumber(service, country) {
  const data = await apiRequest({
    action: 'getNumber',
    service,
    country,
  });
  // Format: ACCESS_NUMBER:ID:PHONE
  if (typeof data === 'string' && data.startsWith('ACCESS_NUMBER:')) {
    const [, id, phone] = data.split(':');
    return { activationId: id, phoneNumber: phone };
  }
  // Xatolik kodlari: NO_NUMBERS, NO_BALANCE, BAD_SERVICE, BAD_KEY ...
  throw new Error(data);
}

async function getStatus(activationId) {
  const data = await apiRequest({ action: 'getStatus', id: activationId });
  return data; // STATUS_WAIT_CODE | STATUS_OK:CODE | STATUS_CANCEL | ...
}

async function setStatus(activationId, status) {
  // status: 1=ready, 3=resend, 6=complete, 8=cancel
  return apiRequest({ action: 'setStatus', id: activationId, status });
}

// ---- Bot buyruqlari ----

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Salom! Bu bot orqali HeroSMS dan vaqtinchalik raqam sotib olishingiz mumkin.\n\n` +
      `Buyruqlar:\n` +
      `/balance — balansni ko'rish\n` +
      `/buy <servis> <davlat_kodi> — raqam sotib olish (masalan: /buy tg 0)\n` +
      `/cancel — joriy faollashtirishni bekor qilish\n\n` +
      `Servis kodlari: tg (Telegram), wa (WhatsApp), ig (Instagram), go (Google) va h.k.\n` +
      `Davlat kodi: 0 = Rossiya, 6 = Indoneziya, 2 = Qozogʻiston (toʻliq ro'yxat HeroSMS saytida)`
  );
});

bot.onText(/\/balance/, async (msg) => {
  try {
    const balance = await getBalance();
    bot.sendMessage(msg.chat.id, `💰 Balansingiz: $${balance}`);
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Xatolik: ${e.message}`);
  }
});

bot.onText(/\/buy (\S+) (\S+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const service = match[1];
  const country = match[2];

  if (userState[chatId]?.activationId) {
    return bot.sendMessage(chatId, '⚠️ Sizda allaqachon faol so\'rov bor. Avval /cancel qiling.');
  }

  try {
    bot.sendMessage(chatId, '⏳ Raqam izlanmoqda...');
    const { activationId, phoneNumber } = await getNumber(service, country);

    userState[chatId] = { service, country, activationId, phoneNumber };

    bot.sendMessage(
      chatId,
      `✅ Raqam topildi: +${phoneNumber}\n` +
        `ID: ${activationId}\n\n` +
        `Endi shu raqamni kerakli ilovaga kiritib, SMS kodini kutamiz (~20 daqiqa).`
    );

    pollForCode(chatId);
  } catch (e) {
    const errMap = {
      NO_NUMBERS: 'Bu servis/davlat uchun raqamlar tugagan.',
      NO_BALANCE: 'Balansingiz yetarli emas.',
      BAD_SERVICE: 'Servis kodi noto\'g\'ri.',
      BAD_KEY: 'API kalit noto\'g\'ri.',
    };
    bot.sendMessage(chatId, `❌ Xatolik: ${errMap[e.message] || e.message}`);
  }
});

bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  const state = userState[chatId];
  if (!state?.activationId) {
    return bot.sendMessage(chatId, 'Faol so\'rov yo\'q.');
  }
  try {
    await setStatus(state.activationId, 8); // cancel
    clearTimeout(state.pollTimer);
    delete userState[chatId];
    bot.sendMessage(chatId, '🚫 Faollashtirish bekor qilindi.');
  } catch (e) {
    bot.sendMessage(chatId, `❌ Xatolik: ${e.message}`);
  }
});

// SMS kodni kutib, har 5 soniyada tekshiradi (maks. 20 daqiqa)
function pollForCode(chatId) {
  const state = userState[chatId];
  if (!state) return;

  const startTime = Date.now();
  const MAX_WAIT = 20 * 60 * 1000; // 20 daqiqa

  const check = async () => {
    if (!userState[chatId]) return; // bekor qilingan

    if (Date.now() - startTime > MAX_WAIT) {
      bot.sendMessage(chatId, '⏰ Vaqt tugadi, SMS kelmadi. Mablag\' balansga qaytariladi.');
      delete userState[chatId];
      return;
    }

    try {
      const status = await getStatus(state.activationId);
      if (status.startsWith('STATUS_OK:')) {
        const code = status.split(':')[1];
        bot.sendMessage(chatId, `📩 Kod keldi: ${code}`);
        await setStatus(state.activationId, 6); // complete
        delete userState[chatId];
        return;
      }
      if (status === 'STATUS_CANCEL') {
        bot.sendMessage(chatId, '🚫 Faollashtirish bekor qilingan.');
        delete userState[chatId];
        return;
      }
      // STATUS_WAIT_CODE — davom etamiz
      state.pollTimer = setTimeout(check, 5000);
    } catch (e) {
      state.pollTimer = setTimeout(check, 5000);
    }
  };

  check();
}

console.log('HeroSMS bot ishga tushdi...');
