// Sotuvda ishlatiladigan davlatlar roʻyxati.
// Har bir davlat ikkita manbadan kelishi mumkin:
//   1) Admin qo'shgan userbot raqamlari (NumberAccount bazasi)
//   2) HeroSMS API orqali jonli sotib olinadigan raqamlar
// "heroName" — HeroSMS'ning getCountries javobidagi inglizcha nomi bilan
// moslashtirish uchun ishlatiladi (heroSms.resolveCountryId orqali).
//
// Roʻyxat atayin qisqartirilgan: juda arzon, lekin kod yetib kelish foizi past
// bo'lgan davlatlar (Indoneziya, Filippin, Myanma va h.k.) olib tashlangan —
// faqat narxi hamyonbop VA SMS aniq yetib keladigan davlatlar qoldirilgan.
const COUNTRIES = [
  { code: 'uz', name: '🇺🇿 Oʻzbekiston', heroName: 'Uzbekistan' },
  { code: 'ru', name: '🇷🇺 Rossiya', heroName: 'Russia' },
  { code: 'kz', name: '🇰🇿 Qozogʻiston', heroName: 'Kazakhstan' },
  { code: 'kg', name: '🇰🇬 Qirgʻiziston', heroName: 'Kyrgyzstan' },
  { code: 'ua', name: '🇺🇦 Ukraina', heroName: 'Ukraine' },
  { code: 'us', name: '🇺🇸 AQSh', heroName: 'USA' },
  { code: 'gb', name: '🇬🇧 Buyuk Britaniya', heroName: 'England' },
  { code: 'tr', name: '🇹🇷 Turkiya', heroName: 'Turkey' },
  { code: 'in', name: '🇮🇳 Hindiston', heroName: 'India' },
  { code: 'cn', name: '🇨🇳 Xitoy', heroName: 'China' },

  // --- Qo'shimcha davlatlar (kengaytirilgan roʻyxat) ---
  // MUHIM: heroName qiymatlari HeroSMS'ning getCountries javobidagi "eng" nomiga
  // mos kelishi kerak. Bu yerdagi nomlar SMS-Activate protokolida odatda
  // ishlatiladigan standart inglizcha nomlar asosida tanlangan, lekin internetga
  // ulanmasdan 100% kafolatlab bo'lmaydi. Admin panelda "🦸 HeroSMS tekshiruv"
  // tugmasi orqali har bir nomni haqiqiy API bilan solishtirib, ❌ chiqqanlarini
  // shu faylda tuzatib qo'ying.
  { code: 'tj', name: '🇹🇯 Tojikiston', heroName: 'Tajikistan' },
  { code: 'az', name: '🇦🇿 Ozarbayjon', heroName: 'Azerbaijan' },
  { code: 'ge', name: '🇬🇪 Gruziya', heroName: 'Georgia' },
  { code: 'am', name: '🇦🇲 Armaniston', heroName: 'Armenia' },
  { code: 'by', name: '🇧🇾 Belarus', heroName: 'Belarus' },
  { code: 'md', name: '🇲🇩 Moldova', heroName: 'Moldova' },
  { code: 'pl', name: '🇵🇱 Polsha', heroName: 'Poland' },
  { code: 'de', name: '🇩🇪 Germaniya', heroName: 'Germany' },
  { code: 'fr', name: '🇫🇷 Fransiya', heroName: 'France' },
  { code: 'it', name: '🇮🇹 Italiya', heroName: 'Italy' },
  { code: 'es', name: '🇪🇸 Ispaniya', heroName: 'Spain' },
  { code: 'nl', name: '🇳🇱 Niderlandiya', heroName: 'Netherlands' },
  { code: 'ca', name: '🇨🇦 Kanada', heroName: 'Canada' },
  { code: 'sa', name: '🇸🇦 Saudiya Arabistoni', heroName: 'Saudi Arabia' },
  { code: 'ae', name: '🇦🇪 BAA', heroName: 'UAE' },
  { code: 'eg', name: '🇪🇬 Misr', heroName: 'Egypt' },
  { code: 'my', name: '🇲🇾 Malayziya', heroName: 'Malaysia' },
  { code: 'th', name: '🇹🇭 Tailand', heroName: 'Thailand' },
  { code: 'pk', name: '🇵🇰 Pokiston', heroName: 'Pakistan' },
  { code: 'bd', name: '🇧🇩 Bangladesh', heroName: 'Bangladesh' },
  { code: 'ng', name: '🇳🇬 Nigeriya', heroName: 'Nigeria' },
  { code: 'br', name: '🇧🇷 Braziliya', heroName: 'Brazil' },
  { code: 'mx', name: '🇲🇽 Meksika', heroName: 'Mexico' },
  { code: 'vn', name: '🇻🇳 Vyetnam', heroName: 'Vietnam' },
  { code: 'il', name: '🇮🇱 Isroil', heroName: 'Israel' },
  { code: 'kr', name: '🇰🇷 Janubiy Koreya', heroName: 'South Korea' },
  { code: 'jp', name: '🇯🇵 Yaponiya', heroName: 'Japan' },
];

function findCountry(code) {
  return COUNTRIES.find(c => c.code === code);
}

function countryName(code) {
  const c = findCountry(code);
  return c ? c.name : `🌍 ${code}`;
}

// ---- Admin panel orqali qo'shilgan davlatlar (Settings bazasida saqlanadi) ----
// Bular COUNTRIES massiviga runtime'da qo'shiladi (mutatsiya orqali — shu sabab
// bu faylni require qilgan boshqa modullar ham darhol yangi davlatni ko'radi,
// qayta ishga tushirish shart emas). Bot qayta ishga tushganda esa DB'dan
// loadCustomCountries() orqali tiklanadi.
const { getSetting, setSetting } = require('./settings');

async function loadCustomCountries() {
  try {
    const custom = (await getSetting('custom_countries')) || [];
    for (const c of custom) {
      if (!findCountry(c.code)) COUNTRIES.push({ ...c, custom: true });
    }
  } catch (e) {
    console.error('Qoʻshimcha davlatlarni yuklashda xato:', e.message);
  }
}

// { code, name, heroName } qabul qiladi. code — kichik harflarda, unikal bo'lishi kerak.
async function addCountry({ code, name, heroName }) {
  code = String(code || '').trim().toLowerCase();
  name = String(name || '').trim();
  heroName = String(heroName || '').trim();
  if (!code || !name || !heroName) {
    throw new Error("Barcha maydonlar toʻldirilishi shart: kod, nomi, HeroSMS nomi");
  }
  if (!/^[a-z0-9_-]{2,15}$/.test(code)) {
    throw new Error("Kod noto'g'ri formatda (faqat lotin harflar/raqamlar, 2-15 belgi)");
  }
  if (findCountry(code)) {
    throw new Error(`"${code}" kodli davlat allaqachon mavjud`);
  }
  const entry = { code, name, heroName, custom: true };
  COUNTRIES.push(entry);
  const custom = (await getSetting('custom_countries')) || [];
  custom.push({ code, name, heroName });
  await setSetting('custom_countries', custom);
  return entry;
}

// Faqat admin panel orqali qo'shilgan (custom: true) davlatlarni o'chirish mumkin —
// dastlabki (built-in) roʻyxat kodda qoladi.
async function removeCountry(code) {
  const idx = COUNTRIES.findIndex(c => c.code === code && c.custom);
  if (idx === -1) {
    throw new Error("Bu davlat topilmadi yoki asosiy (built-in) roʻyxatga tegishli — uni faqat kod orqali o'chirish mumkin");
  }
  const removed = COUNTRIES[idx];
  COUNTRIES.splice(idx, 1);
  const custom = (await getSetting('custom_countries')) || [];
  await setSetting('custom_countries', custom.filter(c => c.code !== code));
  return removed;
}

module.exports = {
  COUNTRIES,
  findCountry,
  countryName,
  addCountry,
  removeCountry,
  loadCustomCountries,
};
