const mongoose = require('mongoose');

// ---- Foydalanuvchi ----
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username: String,
  fullName: String,
  balance: { type: Number, default: 0 }, // UZS
  totalSpent: { type: Number, default: 0 },
  totalFeeCollected: { type: Number, default: 0 }, // Balans to'ldirishda ushlab qolingan komissiya
  referredBy: Number,
  pendingReferrer: Number, // /start orqali kelgan referal ID — majburiy kanallarga aʼzo boʻlgach tasdiqlanadi
  referralCount: { type: Number, default: 0 },
  referralBonusGiven: { type: Boolean, default: false }, // taklif qilingan foydalanuvchi uchun bonus allaqachon berilganmi (ilk depozitda)
  isBanned: { type: Boolean, default: false },
  bannedAt: Date,
  createdAt: { type: Date, default: Date.now },
});

// ---- Sozlamalar (admin tomonidan o'zgartiriladi) ----
const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

// ---- Aktivatsiya tarixi (foydalanuvchiga berilgan raqamlar) ----
const activationSchema = new mongoose.Schema({
  telegramId: Number,
  numberAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'NumberAccount' },
  country: String, // country code (countries.js)
  phoneNumber: String,
  pricePaid: Number, // UZS
  status: { type: String, default: 'pending' }, // pending | success | cancelled | timeout
  code: String,
  source: { type: String, default: 'userbot' }, // userbot (admin bazasi) | herosms (HeroSMS API)
  heroActivationId: String, // faqat source: 'herosms' bo'lganda to'ldiriladi
  heroServiceLabel: String, // masalan "WhatsApp" — faqat source: 'herosms' bo'lganda
  createdAt: { type: Date, default: Date.now },
});

// ---- Raqamlar bazasi (admin qo'shgan, alohida Telegram akkauntga ulangan) ----
const numberAccountSchema = new mongoose.Schema({
  country: { type: String, required: true }, // countries.js kodi (masalan 'uz')
  phoneNumber: { type: String, required: true, unique: true }, // +xxxxxxxxxxx
  sessionString: String, // GramJS StringSession — login tugagach saqlanadi
  // pending_login: login jarayoni tugallanmagan (kod/parol kutilmoqda)
  // available: sotuvga tayyor, hech kimga berilmagan
  // assigned: foydalanuvchiga berilgan, kod kutilmoqda
  // used: berib bo'lingan (kod kelgan yoki muddat/bekor bo'lgan — baribir qayta ishlatilmaydi)
  // error: login/ulanishda doimiy xato
  status: { type: String, default: 'pending_login' },
  assignedTo: Number, // telegramId
  assignedAt: Date,
  lastCode: String,
  lastCodeAt: Date,
  lastError: String,
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Activation = mongoose.model('Activation', activationSchema);
const NumberAccount = mongoose.model('NumberAccount', numberAccountSchema);

// ---- TON orqali balans to'ldirish invoyslari ----
const tonInvoiceSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true },
  code: { type: String, required: true, unique: true }, // Tranzaksiya izohida (comment) qidiriladigan noyob kod
  amountTon: { type: Number, required: true },
  amountUZS: { type: Number, required: true }, // Toʻlov tasdiqlansa balansga shuncha so'm qo'shiladi
  walletAddress: { type: String, required: true },
  status: { type: String, default: 'pending' }, // pending | paid | expired
  txHash: String,
  receivedTon: Number,
  paidAt: Date,
  createdAt: { type: Date, default: Date.now },
});

const TonInvoice = mongoose.model('TonInvoice', tonInvoiceSchema);

module.exports = { User, Settings, Activation, NumberAccount, TonInvoice };
