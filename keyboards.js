const { Markup } = require('telegraf');
const { SERVICES, COUNTRIES } = require('./herosms');

function mainMenu(isAdmin = false) {
  const rows = [
    [
      Markup.button.callback('📱 Raqam olish', 'buy_number'),
      Markup.button.callback('👤 Kabinet', 'cabinet'),
    ],
    [
      Markup.button.callback('💎 Obuna', 'subscription'),
      Markup.button.callback('❓ Yordam', 'help'),
    ],
  ];
  if (isAdmin) {
    rows.push([Markup.button.callback('⚙️ Admin panel', 'admin_panel')]);
  }
  return Markup.inlineKeyboard(rows);
}

function servicesKeyboard() {
  const buttons = SERVICES.map(s =>
    Markup.button.callback(s.name, `svc_${s.code}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback('🔙 Orqaga', 'back_main')]);
  return Markup.inlineKeyboard(rows);
}

function countriesKeyboard(serviceCode) {
  const buttons = COUNTRIES.map(c =>
    Markup.button.callback(c.name, `cnt_${serviceCode}_${c.code}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback('🔙 Servislar', 'buy_number')]);
  return Markup.inlineKeyboard(rows);
}

function subscriptionKeyboard(prices) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`1 oy — ${prices.sub_1month_uzs.toLocaleString()} so'm`, 'sub_1month')],
    [Markup.button.callback(`3 oy — ${prices.sub_3month_uzs.toLocaleString()} so'm`, 'sub_3month')],
    [Markup.button.callback(`♾ Umrbod — ${prices.sub_lifetime_uzs.toLocaleString()} so'm`, 'sub_lifetime')],
    [Markup.button.callback('🔙 Orqaga', 'back_main')],
  ]);
}

function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Markup %', 'adm_markup'),
      Markup.button.callback('💱 USD kurs', 'adm_usdrate'),
    ],
    [
      Markup.button.callback('📦 Obuna narxlari', 'adm_subprices'),
      Markup.button.callback('💳 Karta', 'adm_card'),
    ],
    [
      Markup.button.callback('🎁 Referal bonus', 'adm_referral'),
      Markup.button.callback('📊 Statistika', 'adm_stats'),
    ],
    [Markup.button.callback('🔙 Bosh menyu', 'back_main')],
  ]);
}

function adminSubPricesKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1 oylik narx", 'adm_sub1'), Markup.button.callback("3 oylik narx", 'adm_sub3')],
    [Markup.button.callback("Umrbod narx", 'adm_sublife')],
    [Markup.button.callback('🔙 Admin panel', 'admin_panel')],
  ]);
}

function backToAdmin() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Admin panel', 'admin_panel')]]);
}

function backToMain() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Bosh menyu', 'back_main')]]);
}

function confirmBuyKeyboard(serviceCode, countryCode) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Tasdiqlash', `confirm_${serviceCode}_${countryCode}`)],
    [Markup.button.callback('❌ Bekor qilish', 'back_main')],
  ]);
}

function cancelActivationKeyboard(activationId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚫 Bekor qilish', `cancel_act_${activationId}`)],
  ]);
}

module.exports = {
  mainMenu,
  servicesKeyboard,
  countriesKeyboard,
  subscriptionKeyboard,
  adminPanelKeyboard,
  adminSubPricesKeyboard,
  backToAdmin,
  backToMain,
  confirmBuyKeyboard,
  cancelActivationKeyboard,
};
