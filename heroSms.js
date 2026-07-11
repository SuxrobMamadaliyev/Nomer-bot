// heroSms.js — HeroSMS (hero-sms.com) ochiq API bilan ishlash uchun klient.
// HeroSMS API'si SMS-Activate protokoliga mos ("Compatible with SMS-Activate API protocol"),
// shuning uchun klassik handler_api.php uslubidagi so'rovlardan foydalanamiz.
//
// MUHIM: .env faylida HEROSMS_API_KEY bo'lishi shart. Agar hero-sms.com o'z bazaviy
// URL manzilini o'zgartirsa, HEROSMS_BASE_URL orqali qayta sozlash mumkin.

const axios = require('axios');

const API_KEY = process.env.HEROSMS_API_KEY || '';
const BASE_URL = process.env.HEROSMS_BASE_URL || 'https://hero-sms.com/stubs/handler_api.php';
// Telegram uchun standart xizmat kodi ('tg'). Agar HeroSMS boshqacha kod ishlatsa,
// .env orqali HEROSMS_SERVICE bilan almashtirish mumkin.
const SERVICE = process.env.HEROSMS_SERVICE || 'tg';

function checkKey() {
  if (!API_KEY) {
    throw new Error('HEROSMS_API_KEY sozlanmagan (.env fayliga qo\'shing).');
  }
}

async function request(params, { asJson = false } = {}) {
  checkKey();
  const { data } = await axios.get(BASE_URL, {
    params: { api_key: API_KEY, ...params },
    timeout: 20000,
  });
  return data;
}

// Matn ko'rinishidagi javoblarda uchraydigan xato kodlarini o'qiladigan xabarga aylantiradi.
const ERROR_MESSAGES = {
  BAD_KEY: "HeroSMS API kaliti noto'g'ri",
  BAD_ACTION: "HeroSMS: noto'g'ri action",
  BAD_SERVICE: "HeroSMS: noto'g'ri xizmat kodi",
  ERROR_SQL: 'HeroSMS server xatosi',
  NO_NUMBERS: 'Bu davlatda hozircha mavjud raqam yoʻq',
  NO_BALANCE: 'HeroSMS balansida mablagʻ yetarli emas',
  WRONG_ACTIVATION_ID: "Aktivatsiya ID noto'g'ri",
  EARLY_CANCEL_DENIED: "Hali bekor qilib bo'lmaydi (juda erta)",
};

function throwIfError(text, fallback) {
  if (typeof text !== 'string') return;
  const code = text.split(':')[0];
  if (ERROR_MESSAGES[code]) {
    const err = new Error(ERROR_MESSAGES[code]);
    err.code = code;
    throw err;
  }
  if (text.startsWith('BANNED')) {
    const err = new Error('HeroSMS akkaunt bloklangan: ' + text);
    err.code = 'BANNED';
    throw err;
  }
}

// ---- Balans ----
async function getBalance() {
  const text = await request({ action: 'getBalance' });
  throwIfError(text);
  const m = String(text).match(/ACCESS_BALANCE:([\d.]+)/);
  if (!m) throw new Error("HeroSMS balansini o'qib bo'lmadi: " + text);
  return parseFloat(m[1]);
}

// ---- Davlatlar roʻyxati (id, eng, rus nomlari bilan) ----
let countriesCache = null;
let countriesCacheAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 soat

async function getCountries(force = false) {
  if (!force && countriesCache && Date.now() - countriesCacheAt < CACHE_TTL) {
    return countriesCache;
  }
  const data = await request({ action: 'getCountries' });
  if (typeof data === 'string') throwIfError(data);
  countriesCache = data; // { "0": { id, eng, rus, ... }, ... }
  countriesCacheAt = Date.now();
  return countriesCache;
}

// Ingliz nomi bo'yicha HeroSMS davlat ID'sini topadi (masalan "Uzbekistan" -> 182)
async function resolveCountryId(engName) {
  const list = await getCountries();
  const target = engName.trim().toLowerCase();
  for (const key of Object.keys(list)) {
    const c = list[key];
    const eng = (c.eng || '').trim().toLowerCase();
    if (eng === target) return parseInt(c.id ?? key, 10);
  }
  return null;
}

// ---- Narxlar (bitta so'rovda barcha davlatlar uchun) ----
// Qaytadi: { [countryId]: costUSD } faqat mavjud (count>0) bo'lganlar
async function getPricesForService(service = SERVICE) {
  const data = await request({ action: 'getPrices', service });
  if (typeof data === 'string') { throwIfError(data); return {}; }
  const result = {};
  for (const countryId of Object.keys(data)) {
    const entry = data[countryId]?.[service];
    if (entry && Number(entry.count) > 0) {
      result[countryId] = { cost: Number(entry.cost), count: Number(entry.count) };
    }
  }
  return result;
}

// ---- Raqam sotib olish ----
// Qaytaradi: { activationId, phoneNumber, cost }
async function getNumber({ service = SERVICE, country, maxPrice } = {}) {
  const data = await request({
    action: 'getNumberV2',
    service,
    country,
    ...(maxPrice ? { maxPrice } : {}),
  });

  // getNumberV2 muvaffaqiyatli bo'lsa JSON qaytaradi; xato bo'lsa oddiy matn.
  if (typeof data === 'string') {
    throwIfError(data);
    // Fallback: eski uslubdagi javob "ACCESS_NUMBER:id:phone"
    const m = data.match(/^ACCESS_NUMBER:(\d+):(\d+)/);
    if (m) return { activationId: m[1], phoneNumber: m[2], cost: null };
    throw new Error('HeroSMS: kutilmagan javob — ' + data);
  }

  if (!data || !data.activationId) {
    throw new Error('HeroSMS: raqam topilmadi');
  }
  return {
    activationId: String(data.activationId),
    phoneNumber: String(data.phoneNumber),
    cost: data.activationCost != null ? Number(data.activationCost) : null,
  };
}

// ---- Status (kod kelganini tekshirish) ----
// Qaytaradi: { status: 'WAIT'|'OK'|'CANCEL'|'RETRY', code? }
async function getStatus(activationId) {
  const text = await request({ action: 'getStatus', id: activationId });
  throwIfError(text);
  const str = String(text);
  if (str.startsWith('STATUS_OK')) {
    return { status: 'OK', code: str.split(':')[1] || null };
  }
  if (str.startsWith('STATUS_WAIT_CODE')) return { status: 'WAIT' };
  if (str.startsWith('STATUS_WAIT_RETRY')) return { status: 'WAIT', code: str.split(':')[1] || null };
  if (str.startsWith('STATUS_WAIT_RESEND')) return { status: 'WAIT' };
  if (str.startsWith('STATUS_CANCEL')) return { status: 'CANCEL' };
  return { status: 'UNKNOWN', raw: str };
}

// ---- Status o'zgartirish ----
// 1=tayyor, 3=qayta so'rash, 6=yakunlash, 8=bekor qilish
async function setStatus(activationId, status) {
  const text = await request({ action: 'setStatus', id: activationId, status });
  throwIfError(text);
  return String(text);
}

async function markReady(activationId) {
  return setStatus(activationId, 1);
}

async function complete(activationId) {
  return setStatus(activationId, 6);
}

// Bekor qilish — muvaffaqiyatsiz bo'lsa (masalan "juda erta") xatoni yutib, false qaytaradi.
async function cancel(activationId) {
  try {
    await setStatus(activationId, 8);
    return true;
  } catch (e) {
    console.error(`HeroSMS bekor qilishda xato (${activationId}):`, e.message);
    return false;
  }
}

module.exports = {
  SERVICE,
  getBalance,
  getCountries,
  resolveCountryId,
  getPricesForService,
  getNumber,
  getStatus,
  setStatus,
  markReady,
  complete,
  cancel,
};
