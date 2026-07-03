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
  referralCount: { type: Number, default: 0 },
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

module.exports = { User, Settings, Activation, NumberAccount };
