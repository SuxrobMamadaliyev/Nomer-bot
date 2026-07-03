const { Markup } = require('telegraf');
const { COUNTRIES } = require('./countries');
const { getSetting } = require('./settings');

function mainMenu(isAdmin = false) {
  const rows = [
    [Markup.button.callback('🔥 Arzon nomerlar', 'cheap_numbers')],
    [
      Markup.button.callback('📱 Raqam olish', 'buy_number'),
      Markup.button.callback('👤 Kabinet', 'cabinet'),
    ],
    [
      Markup.button.callback("👛 Balans to'ldirish", 'topup'),
      Markup.button.callback('❓ Yordam', 'help'),
    ],
    [Markup.button.callback('🎁 Referal', 'referral_info')],
  ];
  if (isAdmin) {
    rows.push([Markup.button.callback('⚙️ Admin panel', 'admin_panel')]);
  }
  return Markup.inlineKeyboard(rows);
}

// Sotuvda mavjud davlatlar roʻyxati — har biri narxi bilan.
// offers: [{ code, name, price, available }] (available > 0 boʻlganlar)
function countriesForSaleKeyboard(offers) {
  const rows = offers.map(o => [
    Markup.button.callback(
      `${o.name} — ${o.price.toLocaleString()} so'm (${o.available} ta)`,
      `buycnt_${o.code}`
    ),
  ]);
  rows.push([Markup.button.callback('🔙 Bosh menyu', 'back_main')]);
  return Markup.inlineKeyboard(rows);
}

function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Markup %', 'adm_markup'),
      Markup.button.callback('💱 USD kurs', 'adm_usdrate'),
    ],
    [
      Markup.button.callback('📉 Toʻldirish komissiyasi', 'adm_topupfee'),
      Markup.button.callback('⭐ Stars kursi', 'adm_starsrate'),
    ],
    [
      Markup.button.callback('💳 Karta', 'adm_card'),
      Markup.button.callback('📢 Majburiy kanallar', 'adm_channel'),
    ],
    [
      Markup.button.callback('💎 TON hamyon', 'adm_tonwallet'),
      Markup.button.callback('💎 TON kursi', 'adm_tonrate'),
    ],
    [Markup.button.callback('🔢 Raqamlar bazasi', 'adm_numbers')],
    [
      Markup.button.callback('🎁 Referal bonusi', 'adm_refbonus'),
      Markup.button.callback('💵 Minimal depozit', 'adm_mindeposit'),
    ],
    [Markup.button.callback('🧾 Isbot kanali', 'adm_proofchannel')],
    [Markup.button.callback('🖼 Bosh menyu rasmi', 'adm_image')],
    [Markup.button.callback('👥 Foydalanuvchilar / Balans', 'adm_balances')],
    [Markup.button.callback('🔍 Foydalanuvchini boshqarish', 'adm_user_search')],
    [Markup.button.callback('📣 Barchaga xabar yuborish', 'adm_broadcast')],
    [Markup.button.callback('📊 Statistika', 'adm_stats')],
    [Markup.button.callback('🔙 Bosh menyu', 'back_main')],
  ]);
}

function balancesMenuKeyboard(page, totalPages, users = []) {
  const navRow = [];
  if (page > 0) navRow.push(Markup.button.callback('⬅️ Oldingi', `adm_balances_page_${page - 1}`));
  if (page < totalPages - 1) navRow.push(Markup.button.callback('Keyingi ➡️', `adm_balances_page_${page + 1}`));

  const rows = [];
  // Har bir foydalanuvchi uchun boshqaruv tugmasi (balans berish/ayirish, ban/unban)
  users.forEach(u => {
    const name = u.username ? `@${u.username}` : (u.fullName || `ID:${u.telegramId}`);
    const banMark = u.isBanned ? '🚫 ' : '';
    rows.push([Markup.button.callback(`${banMark}${name} — ${(u.balance || 0).toLocaleString()} so'm`, `adm_uview_${u.telegramId}`)]);
  });
  if (navRow.length) rows.push(navRow);
  rows.push([Markup.button.callback('🔍 ID/username boʻyicha qidirish', 'adm_user_search')]);
  rows.push([Markup.button.callback('🗑 Barcha balanslarni 0 qilish', 'adm_balances_reset_confirm')]);
  rows.push([Markup.button.callback('🔙 Admin panel', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
}

// Bitta foydalanuvchini boshqarish (balans qo'shish/ayirish, ban/unban)
function userDetailKeyboard(telegramId, isBanned) {
  const rows = [
    [
      Markup.button.callback('➕ Balans qoʻshish', `adm_uaddbal_${telegramId}`),
      Markup.button.callback('➖ Balans ayirish', `adm_usubbal_${telegramId}`),
    ],
  ];
  rows.push([
    isBanned
      ? Markup.button.callback('✅ Ban olib tashlash', `adm_uunban_${telegramId}`)
      : Markup.button.callback('🚫 Ban qilish', `adm_uban_${telegramId}`),
  ]);
  rows.push([Markup.button.callback('🔙 Roʻyxatga qaytish', 'adm_balances')]);
  return Markup.inlineKeyboard(rows);
}

function balancesResetConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Ha, hammasini 0 qilish', 'adm_balances_reset_do')],
    [Markup.button.callback('❌ Bekor qilish', 'adm_balances')],
  ]);
}

function backToAdmin() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Admin panel', 'admin_panel')]]);
}

function backToMain() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Bosh menyu', 'back_main')]]);
}

function confirmBuyKeyboard(countryCode) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Tasdiqlash', `buyconfirm_${countryCode}`)],
    [Markup.button.callback('❌ Bekor qilish', 'back_main')],
  ]);
}

function cancelActivationKeyboard(activationId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚫 Bekor qilish', `cancel_act_${activationId}`)],
  ]);
}

// ---- Admin: Raqamlar bazasi ----

// Har bir davlat uchun mavjud/band/ishlatilgan sonini ko'rsatadigan menyu
function numbersAdminMenuKeyboard(summaries) {
  const rows = summaries.map(s => [
    Markup.button.callback(
      `${s.name} — ✅${s.available} ⏳${s.assigned} ⛔${s.used}`,
      `adm_num_country_${s.code}`
    ),
  ]);
  rows.push([Markup.button.callback('➕ Yangi raqam qoʻshish', 'adm_num_add')]);
  rows.push([Markup.button.callback('🔙 Admin panel', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
}

// Raqam qo'shish/ko'rish uchun davlat tanlash (to'liq statik ro'yxat)
function countryPickerKeyboard(prefix, cancelData = 'adm_numbers') {
  const buttons = COUNTRIES.map(c => Markup.button.callback(c.name, `${prefix}_${c.code}`));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([Markup.button.callback('❌ Bekor', cancelData)]);
  return Markup.inlineKeyboard(rows);
}

// Bitta davlat ichidagi raqamlar ro'yxati (o'chirish uchun bosiladi)
function numberListKeyboard(countryCode, numbers) {
  const statusEmoji = { pending_login: '🔧', available: '✅', assigned: '⏳', used: '⛔', error: '❌' };
  const rows = numbers.map(n => [
    Markup.button.callback(
      `${statusEmoji[n.status] || '•'} ${n.phoneNumber}`,
      `adm_num_view_${n._id}`
    ),
  ]);
  rows.push([Markup.button.callback('💰 Narxni sozlash', `adm_num_price_${countryCode}`)]);
  rows.push([Markup.button.callback('🔙 Raqamlar bazasi', 'adm_numbers')]);
  return Markup.inlineKeyboard(rows);
}

function numberDetailKeyboard(id, status) {
  const rows = [];
  if (status !== 'assigned') {
    rows.push([Markup.button.callback("🗑 O'chirish", `adm_num_del_${id}`)]);
  }
  rows.push([Markup.button.callback('🔙 Orqaga', 'adm_numbers')]);
  return Markup.inlineKeyboard(rows);
}

function cancelLoginKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'adm_num_login_cancel')]]);
}

// Asosiy menyuni (matn + tugmalar) admin tomonidan o'rnatilgan rasm bilan yoki rasmsiz chiqaradi.
// edit=true bo'lsa, mavjud xabarni tahrirlashga harakat qiladi (callback orqali chaqirilganda).
async function sendMainMenu(ctx, text, keyboard, { edit = false } = {}) {
  const image = await getSetting('main_menu_image');

  if (image) {
    if (edit && ctx.callbackQuery) {
      try {
        await ctx.editMessageMedia(
          { type: 'photo', media: image, caption: text, parse_mode: 'HTML' },
          keyboard
        );
        return;
      } catch (e) {
        // Eski xabar rasm emas edi (matn xabar) — uni o'chirib, yangi rasm xabarini yuboramiz
        try { await ctx.deleteMessage(); } catch {}
      }
    }
    try {
      await ctx.replyWithPhoto(image, { caption: text, parse_mode: 'HTML', ...keyboard });
      return;
    } catch (e) {
      console.error('Bosh menyu rasmini yuborishda xato:', e.message);
      // rasm yuborib bo'lmadi — pastda matn sifatida yuboramiz
    }
  }

  if (edit && ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      return;
    } catch {}
  }
  await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

// Xabarni tahrirlashga urinadi; agar joriy xabar matn bo'lmasa (masalan rasm bo'lsa)
// yoki boshqa sababdan tahrirlab bo'lmasa, eski xabarni o'chirib, yangisini yuboradi.
async function safeEdit(ctx, text, extra = {}) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (e) {
    try { await ctx.deleteMessage(); } catch {}
    return ctx.reply(text, extra);
  }
}

module.exports = {
  mainMenu,
  countriesForSaleKeyboard,
  adminPanelKeyboard,
  balancesMenuKeyboard,
  balancesResetConfirmKeyboard,
  userDetailKeyboard,
  backToAdmin,
  backToMain,
  confirmBuyKeyboard,
  cancelActivationKeyboard,
  numbersAdminMenuKeyboard,
  countryPickerKeyboard,
  numberListKeyboard,
  numberDetailKeyboard,
  cancelLoginKeyboard,
  sendMainMenu,
  safeEdit,
};
