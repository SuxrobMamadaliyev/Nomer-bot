const mongoose = require('mongoose');

// ---- Foydalanuvchi ----
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username: String,
  fullName: String,
  balance: { type: Number, default: 0 }, // UZS
  totalSpent: { type: Number, default: 0 },
  isPremium: { type: Boolean, default: false },
  premiumUntil: Date,
  referredBy: Number,
  referralCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// ---- Sozlamalar (admin tomonidan o'zgartiriladi) ----
const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

// ---- Aktivatsiya tarixi ----
const activationSchema = new mongoose.Schema({
  telegramId: Number,
  activationId: String,
  service: String,
  country: String,
  phoneNumber: String,
  pricePaid: Number, // UZS
  status: { type: String, default: 'pending' }, // pending | success | cancelled
  code: String,
  createdAt: { type: Date, default: Date.now },
});

// ---- Obuna ----
const subscriptionSchema = new mongoose.Schema({
  telegramId: Number,
  plan: String,
  priceUZS: Number,
  startDate: { type: Date, default: Date.now },
  endDate: Date,
  active: { type: Boolean, default: true },
});

const User = mongoose.model('User', userSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Activation = mongoose.model('Activation', activationSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = { User, Settings, Activation, Subscription };
