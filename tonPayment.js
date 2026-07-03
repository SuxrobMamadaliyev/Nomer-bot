const crypto = require('crypto');
const axios = require('axios');
const { TonInvoice, User } = require('./models');
const { getSetting } = require('./settings');

const TONCENTER_API = 'https://toncenter.com/api/v2/getTransactions';
const POLL_INTERVAL_MS = 15 * 1000;        // 15 soniyada bir marta tekshiradi
const INVOICE_EXPIRY_MS = 30 * 60 * 1000;  // 30 daqiqa amal qiladi
const AMOUNT_TOLERANCE = 0.02;             // 2% kam toʻlovga ham yoʻl qoʻyamiz (kurs tebranishi/komissiya uchun)

let botInstance = null;
function setBotInstance(bot) {
  botInstance = bot;
}

function generateCode() {
  return 'DEP' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function toNanotons(ton) {
  return Math.round(ton * 1e9);
}

// Tonkeeper ilovasini avtomatik ochib, manzil/summa/izohni oldindan toʻldiradigan havola
function tonkeeperLink(address, amountTon, comment) {
  const nano = toNanotons(amountTon);
  return `https://app.tonkeeper.com/transfer/${address}?amount=${nano}&text=${encodeURIComponent(comment)}`;
}

// Yangi TON toʻlov invoysi yaratadi. amountUZS — foydalanuvchi balansiga qoʻshilishi kerak boʻlgan summa (so'mda).
async function createInvoice(telegramId, amountUZS) {
  const rate = await getSetting('ton_to_uzs');
  const wallet = await getSetting('ton_wallet_address');
  if (!rate || rate <= 0) throw new Error("TON kursi hali sozlanmagan. Admin bilan bogʻlaning.");
  if (!wallet) throw new Error("TON hamyon manzili hali sozlanmagan. Admin bilan bogʻlaning.");

  const amountTon = Math.ceil((amountUZS / rate) * 1000) / 1000; // 3 xonagacha yaxlitlash (0.001 TON)
  const code = generateCode();

  const invoice = await TonInvoice.create({
    telegramId,
    code,
    amountTon,
    amountUZS,
    walletAddress: wallet,
    status: 'pending',
  });

  return { invoice, link: tonkeeperLink(wallet, amountTon, code) };
}

async function getInvoiceById(invoiceId) {
  return TonInvoice.findById(invoiceId).lean();
}

async function fetchTransactions(address) {
  const apiKey = process.env.TONCENTER_API_KEY; // ixtiyoriy — bo'lsa limitlar kengroq bo'ladi
  const { data } = await axios.get(TONCENTER_API, {
    params: {
      address,
      limit: 30,
      archival: false,
      ...(apiKey ? { api_key: apiKey } : {}),
    },
    timeout: 10000,
  });
  return data?.result || [];
}

// Kutilayotgan barcha invoyslarni TON blokcheynidagi tranzaksiyalar bilan solishtiradi.
// Mos tranzaksiya topilsa (izohdagi kod boʻyicha) — invoysni "paid" qilib, foydalanuvchi balansini toʻldiradi.
async function checkPendingInvoices() {
  const pending = await TonInvoice.find({ status: 'pending' }).lean();
  if (!pending.length) return;

  const byWallet = {};
  for (const inv of pending) {
    (byWallet[inv.walletAddress] ||= []).push(inv);
  }

  for (const [address, invoices] of Object.entries(byWallet)) {
    let txs;
    try {
      txs = await fetchTransactions(address);
    } catch (e) {
      console.error('TON tranzaksiyalarni olishda xato:', e.message);
      continue;
    }

    for (const tx of txs) {
      const inMsg = tx.in_msg;
      const comment = (inMsg?.message || '').trim();
      if (!comment) continue;

      const match = invoices.find(inv => comment.includes(inv.code));
      if (!match) continue;

      const receivedNano = parseInt(inMsg.value, 10) || 0;
      const receivedTon = receivedNano / 1e9;
      const expectedTon = match.amountTon * (1 - AMOUNT_TOLERANCE);
      if (receivedTon + 1e-6 < expectedTon) continue; // yetarlicha TON kelmagan

      // Atomik: faqat hali "pending" boʻlgan invoysni "paid" ga oʻtkazamiz — ikki marta kredit boʻlmasligi uchun
      const updated = await TonInvoice.findOneAndUpdate(
        { _id: match._id, status: 'pending' },
        {
          status: 'paid',
          txHash: tx.transaction_id?.hash || '',
          receivedTon,
          paidAt: new Date(),
        }
      );
      if (!updated) continue;

      await User.findOneAndUpdate(
        { telegramId: match.telegramId },
        { $inc: { balance: match.amountUZS } },
        { upsert: true }
      );

      if (botInstance) {
        try {
          await botInstance.telegram.sendMessage(
            match.telegramId,
            `✅ <b>TON orqali toʻlov qabul qilindi!</b>\n\n` +
            `💎 Toʻlandi: <b>${receivedTon.toFixed(3)} TON</b>\n` +
            `➕ Balansga qoʻshildi: <b>${match.amountUZS.toLocaleString()} so'm</b>`,
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          console.error("TON toʻlovi haqida xabar yuborishda xato:", e.message);
        }
      }
    }
  }
}

async function expireOldInvoices() {
  const cutoff = new Date(Date.now() - INVOICE_EXPIRY_MS);
  await TonInvoice.updateMany(
    { status: 'pending', createdAt: { $lte: cutoff } },
    { status: 'expired' }
  );
}

function startTonWatcher(bot) {
  setBotInstance(bot);
  setInterval(async () => {
    try {
      await checkPendingInvoices();
      await expireOldInvoices();
    } catch (e) {
      console.error('TON watcher xatosi:', e.message);
    }
  }, POLL_INTERVAL_MS);
}

module.exports = {
  createInvoice,
  getInvoiceById,
  checkPendingInvoices,
  startTonWatcher,
};
