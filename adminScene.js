const { Scenes, Markup } = require('telegraf');
const { getSetting, setSetting, getAllSettings, getNumberPrice, setNumberPrice } = require('./settings');
const {
  adminPanelKeyboard,
  balancesMenuKeyboard,
  balancesResetConfirmKeyboard,
  backToAdmin,
  safeEdit,
  numbersAdminMenuKeyboard,
  countryPickerKeyboard,
  numberListKeyboard,
  numberDetailKeyboard,
  cancelLoginKeyboard,
  userDetailKeyboard,
} = require('./keyboards');
const { User, Activation, NumberAccount } = require('./models');
const { countryName } = require('./countries');
const userbot = require('./userbot');
const { handleIncomingCode } = require('./buyScene');

// Admin panel asosiy ko'rinish
async function showAdminPanel(ctx) {
  const s = await getAllSettings();
  const channels = s.force_sub_channels || [];
  const text =
    `⚙️ <b>Admin Panel</b>\n\n` +
    `💰 Markup (raqam narxiga): <b>${s.markup_percent}%</b>\n` +
    `📉 Toʻldirish komissiyasi: <b>${s.topup_fee_percent}%</b>\n` +
    `⭐ Stars kursi: <b>1⭐ = ${s.star_to_uzs.toLocaleString()} so'm</b>\n` +
    `💱 USD/UZS kurs: <b>${s.usd_to_uzs.toLocaleString()} so'm</b>\n` +
    `💳 Karta: <b>${s.card_number}</b>\n` +
    `👤 Egasi: <b>${s.card_holder}</b>\n` +
    `📢 Majburiy kanallar: <b>${channels.length ? channels.length + ' ta' : 'oʻchirilgan'}</b>\n` +
    `🎁 Referal bonusi: <b>${(s.referral_bonus_uzs || 0).toLocaleString()} so'm</b>\n` +
    `🖼 Bosh menyu rasmi: <b>${s.main_menu_image ? 'oʻrnatilgan' : 'oʻrnatilmagan'}</b>\n` +
    `🧾 Isbot kanali: <b>${s.proof_channel || 'oʻrnatilmagan'}</b>\n` +
    `💬 Support: <b>${s.support_username}</b>`;

  const keyboard = adminPanelKeyboard();
  if (ctx.callbackQuery) {
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

const BALANCES_PAGE_SIZE = 15;
const DIVIDER_CHAR = '➖➖➖➖➖➖➖➖➖➖';

// Foydalanuvchilar balanslari roʻyxatini sahifalab koʻrsatadi
async function showBalancesPage(ctx, page = 0) {
  const totalUsers = await User.countDocuments();
  const totalPages = Math.max(1, Math.ceil(totalUsers / BALANCES_PAGE_SIZE));
  page = Math.min(Math.max(0, page), totalPages - 1);

  const users = await User.find({})
    .sort({ balance: -1 })
    .skip(page * BALANCES_PAGE_SIZE)
    .limit(BALANCES_PAGE_SIZE)
    .lean();

  const totalAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance' } } }]);
  const totalBalance = totalAgg[0]?.total || 0;

  const lines = users.map((u, i) => {
    const num = page * BALANCES_PAGE_SIZE + i + 1;
    const name = u.username ? `@${u.username}` : (u.fullName || `ID:${u.telegramId}`);
    return `${num}. ${name} — <b>${(u.balance || 0).toLocaleString()} so'm</b>`;
  });

  const text =
    `👥 <b>Foydalanuvchilar balansi</b>\n\n` +
    (lines.length ? lines.join('\n') : 'Foydalanuvchilar topilmadi.') +
    `\n\n💰 Jami balans (barcha foydalanuvchilar): <b>${totalBalance.toLocaleString()} so'm</b>\n` +
    `📄 Sahifa: ${page + 1}/${totalPages}\n\n` +
    `👇 Boshqarish uchun foydalanuvchini tanlang.`;

  await safeEdit(ctx, text, { parse_mode: 'HTML', ...balancesMenuKeyboard(page, totalPages, users) });
}

// Bitta foydalanuvchi haqida to'liq ma'lumot va boshqaruv tugmalarini ko'rsatadi
async function showUserDetail(ctx, telegramId) {
  const u = await User.findOne({ telegramId }).lean();
  if (!u) {
    return safeEdit(ctx, '❌ Foydalanuvchi topilmadi.', { parse_mode: 'HTML', ...backToAdmin() });
  }
  const name = u.username ? `@${u.username}` : (u.fullName || '—');
  const text =
    `👤 <b>Foydalanuvchi</b>\n${DIVIDER_CHAR}\n` +
    `🆔 ID: <code>${u.telegramId}</code>\n` +
    `📛 Ism/Username: ${name}\n` +
    `👛 Balans: <b>${(u.balance || 0).toLocaleString()} so'm</b>\n` +
    `💸 Jami sarflangan: <b>${(u.totalSpent || 0).toLocaleString()} so'm</b>\n` +
    `👥 Referallar soni: <b>${u.referralCount || 0}</b>\n` +
    `📊 Holat: <b>${u.isBanned ? '🚫 Bloklangan' : '✅ Faol'}</b>`;
  return safeEdit(ctx, text, { parse_mode: 'HTML', ...userDetailKeyboard(u.telegramId, !!u.isBanned) });
}

// Barcha foydalanuvchilarga xabar yuborish (cursor orqali xotirani tejab, birma-bir yuboriladi).
// Telegramning global cheklovi (~30 xabar/soniya) ga tushib qolmaslik uchun har birida kichik pauza qilinadi.
async function broadcastToAllUsers(ctx, content) {
  const cursor = User.find({}, { telegramId: 1 }).lean().cursor();
  let sent = 0, failed = 0, total = 0;

  for (let user = await cursor.next(); user != null; user = await cursor.next()) {
    total++;
    try {
      if (content.type === 'photo') {
        await ctx.telegram.sendPhoto(user.telegramId, content.photo, {
          caption: content.caption || undefined,
          parse_mode: 'HTML',
        });
      } else {
        await ctx.telegram.sendMessage(user.telegramId, content.text, { parse_mode: 'HTML' });
      }
      sent++;
    } catch (e) {
      failed++; // bloklangan, chat topilmadi va h.k.
    }
    await new Promise(r => setTimeout(r, 40));
  }

  return { sent, failed, total };
}

function channelMenuKeyboard(channels) {
  const rows = [];
  channels.forEach((ch, i) => {
    rows.push([Markup.button.callback(`🗑 ${ch}`, `adm_channel_del_${i}`)]);
  });
  rows.push([Markup.button.callback('➕ Kanal qoʻshish', 'adm_channel_add')]);
  if (channels.length) {
    rows.push([Markup.button.callback('🚫 Barchasini oʻchirish', 'adm_channel_clear')]);
  }
  rows.push([Markup.button.callback('🔙 Admin panel', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
}

function imageMenuKeyboard(hasImage) {
  const rows = [];
  rows.push([Markup.button.callback(hasImage ? '✏️ Rasmni almashtirish' : '➕ Rasm qoʻshish', 'adm_image_set')]);
  if (hasImage) {
    rows.push([Markup.button.callback('🗑 Rasmni oʻchirish', 'adm_image_remove')]);
  }
  rows.push([Markup.button.callback('🔙 Admin panel', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
}

// Waiting state: { key, label }
const waiting = {}; // telegramId -> { key, label, meta? }
const waitingPhoto = {}; // telegramId -> true (rasm kutilmoqda)
const pendingBroadcast = {}; // adminTelegramId -> { type: 'text'|'photo', text?, photo?, caption? }
const pendingNewNumber = {}; // adminTelegramId -> { country } (login jarayonidagi raqam)

// Har bir davlat bo'yicha mavjud/band/ishlatilgan raqamlar sonini hisoblaydi
async function getCountrySummaries() {
  const agg = await NumberAccount.aggregate([
    { $group: { _id: { country: '$country', status: '$status' }, count: { $sum: 1 } } },
  ]);
  const map = {};
  for (const row of agg) {
    const { country, status } = row._id;
    if (!map[country]) map[country] = {};
    map[country][status] = row.count;
  }
  return Object.keys(map)
    .map(code => ({
      code,
      name: countryName(code),
      available: map[code].available || 0,
      assigned: map[code].assigned || 0,
      used: (map[code].used || 0) + (map[code].error || 0) + (map[code].pending_login || 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function showNumbersAdminMenu(ctx) {
  const summaries = await getCountrySummaries();
  const text =
    `🔢 <b>Raqamlar bazasi</b>\n${DIVIDER_CHAR}\n` +
    (summaries.length
      ? `✅ mavjud · ⏳ band · ⛔ ishlatilgan/xato\n\nDavlatni tanlang — ichidagi raqamlarni koʻrish uchun.`
      : `Hozircha hech qanday raqam qoʻshilmagan.`);
  await safeEdit(ctx, text, { parse_mode: 'HTML', ...numbersAdminMenuKeyboard(summaries) });
}

function adminScene() {
  const scene = new Scenes.BaseScene('admin');

  scene.enter(async ctx => {
    await showAdminPanel(ctx);
  });

  // Har bir tugma uchun "qiymat kirit" so'rash
  const promptMap = {
    adm_markup:     { key: 'markup_percent',     label: 'Yangi markup foizini kiriting (masalan: 25)' },
    adm_usdrate:    { key: 'usd_to_uzs',         label: "1 USD = ? so'm (masalan: 12700)" },
    adm_topupfee:   { key: 'topup_fee_percent',  label: "Balans to'ldirish komissiyasini kiriting % (masalan: 5)" },
    adm_starsrate:  { key: 'star_to_uzs',        label: "1 Telegram Star necha so'mligini kiriting (masalan: 220)" },
    adm_card:       { key: '_card_combo',        label: 'Karta raqami va egasini kiriting:\nFormat: KARTA_RAQAMI|Ism Familiya\nMasalan: 8600 1234 5678 9012|Karimov Karim' },
    adm_support:    { key: 'support_username',   label: 'Support username kiriting (masalan: @admin_support)' },
    adm_refbonus:   { key: 'referral_bonus_uzs', label: "Referal uchun beriladigan bonus miqdorini kiriting, so'mda (masalan: 100)" },
    adm_mindeposit: { key: 'min_balance_uzs',    label: "Minimal depozit (to'ldirish) summasini kiriting, so'mda (masalan: 5000)" },
    adm_proofchannel: {
      key: 'proof_channel',
      label: "Isbot kanali username kiriting (masalan: @kanalim).\n❗️Bot shu kanalda admin boʻlishi shart, aks holda postlar yuborilmaydi.\nOʻchirish uchun \"-\" belgisini yuboring.",
    },
  };

  // Inline button handler
  scene.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === 'admin_panel' || data === 'back_admin') {
      await ctx.answerCbQuery();
      delete waiting[ctx.from.id];
      delete waitingPhoto[ctx.from.id];
      if (userbot.hasPendingLogin(ctx.from.id)) {
        await userbot.cancelLogin(ctx.from.id);
        delete pendingNewNumber[ctx.from.id];
      }
      return showAdminPanel(ctx);
    }

    // ---- RAQAMLAR BAZASI ----

    if (data === 'adm_numbers') {
      await ctx.answerCbQuery();
      return showNumbersAdminMenu(ctx);
    }

    if (data === 'adm_num_add') {
      await ctx.answerCbQuery();
      return safeEdit(ctx,
        '🌍 Yangi raqam qaysi davlat uchun?',
        { parse_mode: 'HTML', ...countryPickerKeyboard('adm_num_addc', 'adm_numbers') }
      );
    }

    if (data.startsWith('adm_num_addc_')) {
      await ctx.answerCbQuery();
      const country = data.replace('adm_num_addc_', '');
      waiting[ctx.from.id] = {
        key: '_num_phone',
        label: "Raqamni xalqaro formatda kiriting (masalan: 998901234567, + belgisisiz).",
        meta: { country },
      };
      return safeEdit(ctx,
        `✏️ ${waiting[ctx.from.id].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'adm_numbers')]]) }
      );
    }

    if (data === 'adm_num_login_cancel') {
      await ctx.answerCbQuery('❌ Bekor qilindi');
      await userbot.cancelLogin(ctx.from.id);
      delete waiting[ctx.from.id];
      delete pendingNewNumber[ctx.from.id];
      return showNumbersAdminMenu(ctx);
    }

    if (data.startsWith('adm_num_country_')) {
      await ctx.answerCbQuery();
      const country = data.replace('adm_num_country_', '');
      const numbers = await NumberAccount.find({ country }).sort({ createdAt: -1 }).lean();
      const text = numbers.length
        ? `${countryName(country)}\n${DIVIDER_CHAR}\n🔧 login kutilmoqda · ✅ mavjud · ⏳ band · ⛔ ishlatilgan/xato`
        : `${countryName(country)}\n${DIVIDER_CHAR}\nBu davlatda hali raqam yoʻq.`;
      return safeEdit(ctx, text, { parse_mode: 'HTML', ...numberListKeyboard(country, numbers) });
    }

    if (data.startsWith('adm_num_price_')) {
      await ctx.answerCbQuery();
      const country = data.replace('adm_num_price_', '');
      const current = await getNumberPrice(country);
      waiting[ctx.from.id] = {
        key: '_num_price',
        label: `${countryName(country)} uchun narxni so'mda kiriting (hozirgi: ${current.toLocaleString()} so'm).`,
        meta: { country },
      };
      return safeEdit(ctx,
        `✏️ ${waiting[ctx.from.id].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', `adm_num_country_${country}`)]]) }
      );
    }

    if (data.startsWith('adm_num_view_')) {
      await ctx.answerCbQuery();
      const id = data.replace('adm_num_view_', '');
      const n = await NumberAccount.findById(id).lean();
      if (!n) return safeEdit(ctx, '❌ Topilmadi.', { parse_mode: 'HTML', ...backToAdmin() });
      const statusLabel = {
        pending_login: '🔧 Login tugallanmagan',
        available: '✅ Mavjud (sotuvda)',
        assigned: '⏳ Band (foydalanuvchida)',
        used: '⛔ Ishlatilgan',
        error: '❌ Xato',
      }[n.status] || n.status;
      const text =
        `📱 <b>+${n.phoneNumber}</b>\n${DIVIDER_CHAR}\n` +
        `🌍 Davlat: ${countryName(n.country)}\n` +
        `📊 Holat: ${statusLabel}\n` +
        (n.assignedTo ? `👤 Berilgan: <code>${n.assignedTo}</code>\n` : '') +
        (n.lastCode ? `🔑 Oxirgi kod: <code>${n.lastCode}</code>\n` : '') +
        (n.lastError ? `⚠️ Xato: ${n.lastError}\n` : '');
      return safeEdit(ctx, text, { parse_mode: 'HTML', ...numberDetailKeyboard(n._id, n.status) });
    }

    if (data.startsWith('adm_num_del_')) {
      const id = data.replace('adm_num_del_', '');
      const n = await NumberAccount.findById(id);
      if (!n) {
        await ctx.answerCbQuery('Topilmadi');
        return showNumbersAdminMenu(ctx);
      }
      if (n.status === 'assigned') {
        return ctx.answerCbQuery("⛔ Bu raqam hozir foydalanuvchida — o'chirib bo'lmaydi", { show_alert: true });
      }
      await userbot.stopListening(n.phoneNumber);
      await NumberAccount.deleteOne({ _id: id });
      await ctx.answerCbQuery("🗑 O'chirildi");
      const numbers = await NumberAccount.find({ country: n.country }).sort({ createdAt: -1 }).lean();
      return safeEdit(ctx,
        `${countryName(n.country)}\n${DIVIDER_CHAR}\n🗑 <code>+${n.phoneNumber}</code> oʻchirildi.`,
        { parse_mode: 'HTML', ...numberListKeyboard(n.country, numbers) }
      );
    }

    if (data === 'adm_channel') {
      await ctx.answerCbQuery();
      const channels = (await getSetting('force_sub_channels')) || [];
      const listText = channels.length
        ? channels.map((c, i) => `${i + 1}. ${c}`).join('\n')
        : 'Hozircha kanal qoʻshilmagan.';
      return safeEdit(ctx, 
        `📢 <b>Majburiy obuna kanallari</b>\n\n${listText}\n\n` +
        (channels.length
          ? "Foydalanuvchilar botdan foydalanishdan oldin barcha kanallarga aʼzo boʻlishlari shart."
          : "Cheksiz miqdorda kanal qoʻsha olasiz."),
        { parse_mode: 'HTML', ...channelMenuKeyboard(channels) }
      );
    }

    if (data === 'adm_channel_add') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = {
        key: '_channel_add',
        label: "Kanal username yoki linkini kiriting (masalan: @mychannel yoki https://t.me/mychannel).\n❗️Bot shu kanalda admin boʻlishi shart, aks holda tekshiruv ishlamaydi.",
      };
      return safeEdit(ctx, 
        `✏️ ${waiting[ctx.from.id].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'adm_channel')]]) }
      );
    }

    if (data.startsWith('adm_channel_del_')) {
      const idx = parseInt(data.replace('adm_channel_del_', ''), 10);
      const channels = (await getSetting('force_sub_channels')) || [];
      const removed = channels[idx];
      if (Number.isInteger(idx) && removed !== undefined) {
        channels.splice(idx, 1);
        await setSetting('force_sub_channels', channels);
      }
      await ctx.answerCbQuery(removed ? `🗑 Oʻchirildi: ${removed}` : 'Topilmadi');
      const listText = channels.length
        ? channels.map((c, i) => `${i + 1}. ${c}`).join('\n')
        : 'Hozircha kanal qoʻshilmagan.';
      return safeEdit(ctx, 
        `📢 <b>Majburiy obuna kanallari</b>\n\n${listText}`,
        { parse_mode: 'HTML', ...channelMenuKeyboard(channels) }
      );
    }

    if (data === 'adm_channel_clear') {
      await ctx.answerCbQuery('🚫 Barchasi oʻchirildi');
      await setSetting('force_sub_channels', []);
      return safeEdit(ctx, 
        '🚫 Barcha majburiy kanallar oʻchirildi. Endi foydalanuvchilar erkin foydalanishadi.',
        { parse_mode: 'HTML', ...backToAdmin() }
      );
    }

    if (data === 'adm_image') {
      await ctx.answerCbQuery();
      const image = await getSetting('main_menu_image');
      return safeEdit(ctx, 
        `🖼 <b>Bosh menyu rasmi</b>\n\n` +
        `Joriy holat: <b>${image ? 'oʻrnatilgan' : 'oʻrnatilmagan'}</b>\n\n` +
        (image
          ? "Bu rasm foydalanuvchilarga bosh menyu tugmalari ustida koʻrsatiladi."
          : "Hozircha rasm oʻrnatilmagan — bosh menyu oddiy matn sifatida chiqadi."),
        { parse_mode: 'HTML', ...imageMenuKeyboard(!!image) }
      );
    }

    if (data === 'adm_image_set') {
      await ctx.answerCbQuery();
      delete waiting[ctx.from.id];
      waitingPhoto[ctx.from.id] = true;
      return safeEdit(ctx, 
        '🖼 Bosh menyu uchun rasm yuboring (surat sifatida, fayl emas).',
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'adm_image')]]) }
      );
    }

    if (data === 'adm_image_remove') {
      await ctx.answerCbQuery('🗑 Oʻchirildi');
      await setSetting('main_menu_image', '');
      return safeEdit(ctx, 
        '🗑 Bosh menyu rasmi oʻchirildi.',
        { parse_mode: 'HTML', ...backToAdmin() }
      );
    }

    if (data === 'adm_balances') {
      await ctx.answerCbQuery();
      return showBalancesPage(ctx, 0);
    }

    if (data.startsWith('adm_balances_page_')) {
      await ctx.answerCbQuery();
      const page = parseInt(data.replace('adm_balances_page_', ''), 10) || 0;
      return showBalancesPage(ctx, page);
    }

    if (data === 'adm_balances_reset_confirm') {
      await ctx.answerCbQuery();
      return safeEdit(ctx,
        `⚠️ <b>Diqqat!</b>\n\nHaqiqatan ham BARCHA foydalanuvchilarning balansini 0 ga tushirmoqchimisiz?\nBu amalni ortga qaytarib boʻlmaydi.`,
        { parse_mode: 'HTML', ...balancesResetConfirmKeyboard() }
      );
    }

    if (data === 'adm_balances_reset_do') {
      await ctx.answerCbQuery('✅ Bajarildi');
      const result = await User.updateMany({}, { $set: { balance: 0 } });
      await safeEdit(ctx,
        `✅ Barcha foydalanuvchilar balansi 0 qilindi.\n👥 Yangilangan foydalanuvchilar: <b>${result.modifiedCount ?? result.nModified ?? 0}</b>`,
        { parse_mode: 'HTML', ...backToAdmin() }
      );
      return;
    }

    // ---- FOYDALANUVCHINI BOSHQARISH (balans berish/ayirish, ban/unban) ----

    if (data === 'adm_user_search') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = {
        key: '_user_search',
        label: 'Foydalanuvchi Telegram ID yoki @username kiriting.',
      };
      return safeEdit(ctx,
        `✏️ ${waiting[ctx.from.id].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'admin_panel')]]) }
      );
    }

    if (data.startsWith('adm_uview_')) {
      await ctx.answerCbQuery();
      const telegramId = parseInt(data.replace('adm_uview_', ''), 10);
      return showUserDetail(ctx, telegramId);
    }

    if (data.startsWith('adm_uaddbal_')) {
      await ctx.answerCbQuery();
      const telegramId = parseInt(data.replace('adm_uaddbal_', ''), 10);
      waiting[ctx.from.id] = {
        key: '_user_addbal',
        label: "Qo'shiladigan summani kiriting, so'mda (masalan: 10000)",
        meta: { telegramId },
      };
      return safeEdit(ctx,
        `✏️ ${waiting[ctx.from.id].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', `adm_uview_${telegramId}`)]]) }
      );
    }

    if (data.startsWith('adm_usubbal_')) {
      await ctx.answerCbQuery();
      const telegramId = parseInt(data.replace('adm_usubbal_', ''), 10);
      waiting[ctx.from.id] = {
        key: '_user_subbal',
        label: "Ayiriladigan summani kiriting, so'mda (masalan: 10000)",
        meta: { telegramId },
      };
      return safeEdit(ctx,
        `✏️ ${waiting[ctx.from.id].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', `adm_uview_${telegramId}`)]]) }
      );
    }

    if (data.startsWith('adm_uban_')) {
      const telegramId = parseInt(data.replace('adm_uban_', ''), 10);
      await User.updateOne({ telegramId }, { $set: { isBanned: true, bannedAt: new Date() } });
      await ctx.answerCbQuery('🚫 Bloklandi');
      try {
        await ctx.telegram.sendMessage(telegramId, '🚫 Siz botdan foydalanish huquqidan mahrum qilindingiz.\nBatafsil maʼlumot uchun admin bilan bogʻlaning.');
      } catch {}
      return showUserDetail(ctx, telegramId);
    }

    if (data.startsWith('adm_uunban_')) {
      const telegramId = parseInt(data.replace('adm_uunban_', ''), 10);
      await User.updateOne({ telegramId }, { $set: { isBanned: false }, $unset: { bannedAt: '' } });
      await ctx.answerCbQuery('✅ Blok olib tashlandi');
      try {
        await ctx.telegram.sendMessage(telegramId, '✅ Sizga botdan foydalanish huquqi qaytarildi.');
      } catch {}
      return showUserDetail(ctx, telegramId);
    }

    if (data === 'adm_broadcast') {
      await ctx.answerCbQuery();
      delete pendingBroadcast[ctx.from.id];
      waiting[ctx.from.id] = { key: '_broadcast' };
      return safeEdit(ctx,
        `📣 <b>Barchaga xabar yuborish</b>\n\n` +
        `Yubormoqchi boʻlgan xabar matnini kiriting yoki rasm (izoh bilan) yuboring.\n\n` +
        `ℹ️ HTML formatlash qoʻllab-quvvatlanadi (masalan: <b>qalin</b>, <i>qiya</i>).`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'admin_panel')]]) }
      );
    }

    if (data === 'adm_broadcast_send') {
      await ctx.answerCbQuery();
      const pending = pendingBroadcast[ctx.from.id];
      if (!pending) {
        return safeEdit(ctx, "❌ Yuborish uchun xabar topilmadi. Qaytadan urinib koʻring.", { parse_mode: 'HTML', ...backToAdmin() });
      }
      delete pendingBroadcast[ctx.from.id];
      await ctx.reply('⏳ Xabar yuborilmoqda... Foydalanuvchilar soniga qarab bir necha daqiqa vaqt olishi mumkin.');
      const result = await broadcastToAllUsers(ctx, pending);
      await ctx.reply(
        `✅ <b>Xabar yuborish yakunlandi</b>\n\n` +
        `📤 Yuborildi: <b>${result.sent}</b>\n` +
        `🚫 Yuborilmadi (bloklangan/xato): <b>${result.failed}</b>\n` +
        `👥 Jami foydalanuvchilar: <b>${result.total}</b>`,
        { parse_mode: 'HTML', ...backToAdmin() }
      );
      return;
    }

    if (data === 'adm_broadcast_cancel') {
      await ctx.answerCbQuery('❌ Bekor qilindi');
      delete pendingBroadcast[ctx.from.id];
      return showAdminPanel(ctx);
    }

    if (data === 'adm_stats') {
      await ctx.answerCbQuery();
      const totalUsers = await User.countDocuments();
      const totalActivations = await Activation.countDocuments();
      const successAct = await Activation.countDocuments({ status: 'success' });

      // Sotuvdan tushgan pul — faqat SMS kelib, muvaffaqiyatli yakunlangan
      // aktivatsiyalar hisobga olinadi (pending/bekor/timeout hisoblanmaydi).
      const salesAgg = await Activation.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: null, total: { $sum: '$pricePaid' } } },
      ]);
      const totalSales = salesAgg[0]?.total || 0;

      const feeAgg = await User.aggregate([
        { $group: { _id: null, totalFee: { $sum: '$totalFeeCollected' } } },
      ]);
      const totalFee = feeAgg[0]?.totalFee || 0;

      const numAvailable = await NumberAccount.countDocuments({ status: 'available' });
      const numAssigned = await NumberAccount.countDocuments({ status: 'assigned' });
      const numUsed = await NumberAccount.countDocuments({ status: 'used' });

      let starsBalance = '—';
      try {
        const res = await ctx.telegram.callApi('getMyStarBalance', {});
        starsBalance = `${res.amount ?? 0}⭐`;
      } catch (e) {
        console.error('Stars balansini olishda xato:', e.message);
      }

      await safeEdit(ctx, 
        `📊 <b>Statistika</b>\n\n` +
        `👥 Jami foydalanuvchilar: <b>${totalUsers}</b>\n` +
        `📱 Jami aktivatsiyalar: <b>${totalActivations}</b>\n` +
        `✅ Muvaffaqiyatli: <b>${successAct}</b>\n\n` +
        `💵 Raqamlardan tushgan (sotuv): <b>${totalSales.toLocaleString()} so'm</b>\n` +
        `📉 To'ldirish komissiyasidan: <b>${totalFee.toLocaleString()} so'm</b>\n\n` +
        `🔢 Raqamlar bazasi: ✅${numAvailable}  ⏳${numAssigned}  ⛔${numUsed}\n` +
        `⭐ Bot Stars balansi: <b>${starsBalance}</b>`,
        { parse_mode: 'HTML', ...backToAdmin() }
      );
      return;
    }

    if (promptMap[data]) {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = promptMap[data];
      await safeEdit(ctx, 
        `✏️ ${promptMap[data].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'admin_panel')]]) }
      );
      return;
    }

    return next();
  });

  // Bosh menyu rasmini yuklash / Broadcast uchun rasm qabul qilish
  scene.on('photo', async ctx => {
    const w = waiting[ctx.from.id];

    if (w && w.key === '_broadcast') {
      delete waiting[ctx.from.id];
      const photos = ctx.message.photo;
      const fileId = photos[photos.length - 1].file_id;
      const caption = ctx.message.caption || '';
      pendingBroadcast[ctx.from.id] = { type: 'photo', photo: fileId, caption };

      const confirmKb = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yuborish', 'adm_broadcast_send'), Markup.button.callback('❌ Bekor', 'adm_broadcast_cancel')],
      ]);
      try {
        await ctx.replyWithPhoto(fileId, {
          caption: `📣 <b>Preview</b>\n${DIVIDER_CHAR}\n${caption}`,
          parse_mode: 'HTML',
          ...confirmKb,
        });
      } catch (e) {
        delete pendingBroadcast[ctx.from.id];
        await ctx.reply('❌ Xabar formatida xato: ' + e.message, backToAdmin());
      }
      return;
    }

    if (!waitingPhoto[ctx.from.id]) return;
    delete waitingPhoto[ctx.from.id];

    try {
      const photos = ctx.message.photo;
      const fileId = photos[photos.length - 1].file_id; // eng katta o'lchamdagisi
      await setSetting('main_menu_image', fileId);
      await ctx.reply('✅ Bosh menyu rasmi saqlandi!', backToAdmin());
    } catch (e) {
      await ctx.reply('❌ Xatolik: ' + e.message, backToAdmin());
    }
  });

  // Matn kiritish
  scene.on('text', async ctx => {
    const w = waiting[ctx.from.id];
    if (!w) return;

    if (w.key === '_broadcast') {
      delete waiting[ctx.from.id];
      const text = ctx.message.text;
      pendingBroadcast[ctx.from.id] = { type: 'text', text };

      const confirmKb = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yuborish', 'adm_broadcast_send'), Markup.button.callback('❌ Bekor', 'adm_broadcast_cancel')],
      ]);
      try {
        await ctx.reply(`📣 <b>Preview</b>\n${DIVIDER_CHAR}\n${text}`, { parse_mode: 'HTML', ...confirmKb });
      } catch (e) {
        delete pendingBroadcast[ctx.from.id];
        await ctx.reply('❌ Xabar formatida xato: ' + e.message, backToAdmin());
      }
      return;
    }

    // ---- RAQAM QO'SHISH: telefon raqam kiritildi -> GramJS login boshlanadi ----
    if (w.key === '_num_phone') {
      const phoneRaw = ctx.message.text.trim().replace(/[^0-9]/g, '');
      delete waiting[ctx.from.id];
      if (!phoneRaw || phoneRaw.length < 8) {
        return ctx.reply("❌ Raqam noto'g'ri. Qaytadan urinib ko'ring.", backToAdmin());
      }
      const existing = await NumberAccount.findOne({ phoneNumber: phoneRaw });
      if (existing) {
        return ctx.reply('⚠️ Bu raqam allaqachon bazada mavjud.', backToAdmin());
      }

      const country = w.meta.country;
      const adminId = ctx.from.id;
      pendingNewNumber[adminId] = { country, phoneNumber: phoneRaw };

      const statusMsg = await ctx.reply(`⏳ <code>+${phoneRaw}</code> uchun login boshlanmoqda...`, { parse_mode: 'HTML' });

      try {
        userbot.startLogin(adminId, phoneRaw, {
          onCodeRequested: () => {
            waiting[adminId] = { key: '_num_login_code', label: '' };
            ctx.telegram.sendMessage(
              adminId,
              `📩 <b>+${phoneRaw}</b> akkauntiga Telegram tomonidan kod yuborildi.\nShu raqamning Telegram ilovasidan (yoki qayerga kelsa) kodni kiriting:`,
              { parse_mode: 'HTML', ...cancelLoginKeyboard() }
            ).catch(() => {});
          },
          onPasswordRequested: () => {
            waiting[adminId] = { key: '_num_login_password', label: '' };
            ctx.telegram.sendMessage(
              adminId,
              `🔒 Bu akkauntda ikki bosqichli parol (2FA) yoqilgan. Parolni kiriting:`,
              { parse_mode: 'HTML', ...cancelLoginKeyboard() }
            ).catch(() => {});
          },
          onSuccess: async (sessionString) => {
            delete pendingNewNumber[adminId];
            delete waiting[adminId];
            try {
              const doc = await NumberAccount.create({
                country,
                phoneNumber: phoneRaw,
                sessionString,
                status: 'available',
              });
              await userbot.startListening(doc, handleIncomingCode);
              await ctx.telegram.sendMessage(
                adminId,
                `✅ <b>+${phoneRaw}</b> muvaffaqiyatli ulandi va sotuvga qoʻyildi!\n\n` +
                `❗️ Narx sozlanmagan boʻlsa, "💰 Narxni sozlash" orqali ${countryName(country)} uchun narx kiriting — aks holda bu davlat xaridorlarga koʻrinmaydi.`,
                { parse_mode: 'HTML', ...backToAdmin() }
              );
            } catch (e) {
              await ctx.telegram.sendMessage(adminId, '❌ Saqlashda xato: ' + e.message, { parse_mode: 'HTML', ...backToAdmin() });
            }
          },
          onError: (err) => {
            delete pendingNewNumber[adminId];
            delete waiting[adminId];
            ctx.telegram.sendMessage(
              adminId,
              '❌ Login xatosi: ' + (err.message || String(err)),
              { parse_mode: 'HTML', ...backToAdmin() }
            ).catch(() => {});
          },
        });
      } catch (e) {
        delete pendingNewNumber[adminId];
        return ctx.reply('❌ ' + e.message, backToAdmin());
      }
      return;
    }

    if (w.key === '_num_login_code') {
      const code = ctx.message.text.trim();
      const ok = userbot.submitCode(ctx.from.id, code);
      if (!ok) {
        delete waiting[ctx.from.id];
        return ctx.reply('❌ Login sessiyasi topilmadi. Qaytadan urinib koʻring.', backToAdmin());
      }
      return ctx.reply('⏳ Tekshirilmoqda...');
    }

    if (w.key === '_num_login_password') {
      const password = ctx.message.text.trim();
      const ok = userbot.submitPassword(ctx.from.id, password);
      if (!ok) {
        delete waiting[ctx.from.id];
        return ctx.reply('❌ Login sessiyasi topilmadi. Qaytadan urinib koʻring.', backToAdmin());
      }
      return ctx.reply('⏳ Tekshirilmoqda...');
    }

    if (w.key === '_user_search') {
      delete waiting[ctx.from.id];
      let val = ctx.message.text.trim();
      let user;
      if (val.startsWith('@')) {
        user = await User.findOne({ username: val.slice(1) }).lean();
      } else {
        const id = parseInt(val.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(id)) user = await User.findOne({ telegramId: id }).lean();
      }
      if (!user) {
        return ctx.reply('❌ Foydalanuvchi topilmadi.', backToAdmin());
      }
      return showUserDetail(ctx, user.telegramId);
    }

    if (w.key === '_user_addbal') {
      const telegramId = w.meta.telegramId;
      delete waiting[ctx.from.id];
      const amount = parseFloat(ctx.message.text.replace(/[^0-9.]/g, ''));
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply("❌ Iltimos, to'g'ri summa kiriting.", backToAdmin());
      }
      const updated = await User.findOneAndUpdate(
        { telegramId },
        { $inc: { balance: amount } },
        { upsert: true, new: true }
      );
      try {
        await ctx.telegram.sendMessage(telegramId, `💰 Balansingizga admin tomonidan ${amount.toLocaleString()} so'm qo'shildi.\n👛 Joriy balans: ${updated.balance.toLocaleString()} so'm`);
      } catch {}
      await ctx.reply(`✅ ${amount.toLocaleString()} so'm qo'shildi. Yangi balans: ${updated.balance.toLocaleString()} so'm`);
      return showUserDetail(ctx, telegramId);
    }

    if (w.key === '_user_subbal') {
      const telegramId = w.meta.telegramId;
      delete waiting[ctx.from.id];
      const amount = parseFloat(ctx.message.text.replace(/[^0-9.]/g, ''));
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply("❌ Iltimos, to'g'ri summa kiriting.", backToAdmin());
      }
      const updated = await User.findOneAndUpdate(
        { telegramId },
        { $inc: { balance: -amount } },
        { upsert: true, new: true }
      );
      try {
        await ctx.telegram.sendMessage(telegramId, `⚠️ Balansingizdan admin tomonidan ${amount.toLocaleString()} so'm ayirildi.\n👛 Joriy balans: ${updated.balance.toLocaleString()} so'm`);
      } catch {}
      await ctx.reply(`✅ ${amount.toLocaleString()} so'm ayirildi. Yangi balans: ${updated.balance.toLocaleString()} so'm`);
      return showUserDetail(ctx, telegramId);
    }

    if (w.key === '_num_price') {
      const country = w.meta.country;
      delete waiting[ctx.from.id];
      const price = parseInt(ctx.message.text.trim(), 10);
      if (isNaN(price) || price <= 0) {
        return ctx.reply("❌ Iltimos, to'g'ri narx kiriting (so'mda).", backToAdmin());
      }
      await setNumberPrice(country, price);
      return ctx.reply(`✅ ${countryName(country)} narxi ${price.toLocaleString()} so'm qilib belgilandi.`, backToAdmin());
    }

    const val = ctx.message.text.trim();
    delete waiting[ctx.from.id];

    try {
      if (w.key === '_card_combo') {
        const [cardNum, cardHolder] = val.split('|').map(s => s.trim());
        if (!cardNum || !cardHolder) {
          return ctx.reply("❌ Format xato! Qaytadan urinib ko'ring:\n8600 XXXX XXXX XXXX|Ism Familiya");
        }
        await setSetting('card_number', cardNum);
        await setSetting('card_holder', cardHolder);
        await ctx.reply(`✅ Karta yangilandi:\n💳 ${cardNum}\n👤 ${cardHolder}`, backToAdmin());
      } else if (w.key === '_channel_add') {
        let channel = val.trim();
        if (!channel.startsWith('@') && !channel.startsWith('https://t.me/')) {
          return ctx.reply("❌ Format xato! @username yoki https://t.me/username koʻrinishida kiriting.", backToAdmin());
        }
        const channels = (await getSetting('force_sub_channels')) || [];
        if (channels.includes(channel)) {
          return ctx.reply('⚠️ Bu kanal allaqachon roʻyxatda mavjud.', backToAdmin());
        }
        channels.push(channel);
        await setSetting('force_sub_channels', channels);
        await ctx.reply(`✅ Kanal qoʻshildi: ${channel}\n\n❗️Eslatma: botni shu kanalga admin qilib qoʻyishni unutmang, aks holda obuna tekshiruvi ishlamaydi.\n\n📋 Jami kanallar: ${channels.length} ta`, backToAdmin());
      } else if (w.key === 'proof_channel') {
        if (val === '-') {
          await setSetting('proof_channel', '');
          await ctx.reply('🗑 Isbot kanali oʻchirildi.', backToAdmin());
        } else {
          let channel = val;
          if (!channel.startsWith('@') && !channel.startsWith('https://t.me/')) {
            return ctx.reply("❌ Format xato! @username koʻrinishida kiriting.", backToAdmin());
          }
          await setSetting('proof_channel', channel);
          await ctx.reply(`✅ Isbot kanali oʻrnatildi: ${channel}\n\n❗️Eslatma: botni shu kanalga admin qilib qoʻyishni unutmang.`, backToAdmin());
        }
      } else {
        const numVal = parseFloat(val);
        if (['markup_percent', 'usd_to_uzs', 'topup_fee_percent', 'star_to_uzs', 'referral_bonus_uzs', 'min_balance_uzs'].includes(w.key)) {
          if (isNaN(numVal) || numVal < 0) {
            return ctx.reply("❌ Iltimos, to'g'ri raqam kiriting.", backToAdmin());
          }
          if (w.key === 'topup_fee_percent' && numVal > 100) {
            return ctx.reply("❌ Komissiya 100% dan oshmasligi kerak.", backToAdmin());
          }
          await setSetting(w.key, numVal);
        } else {
          await setSetting(w.key, val);
        }
        await ctx.reply(`✅ Saqlandi!`, backToAdmin());
      }
    } catch (e) {
      await ctx.reply('❌ Xatolik: ' + e.message, backToAdmin());
    }
  });

  return scene;
}

module.exports = { adminScene, showAdminPanel };
