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
];

function findCountry(code) {
  return COUNTRIES.find(c => c.code === code);
}

function countryName(code) {
  const c = findCountry(code);
  return c ? c.name : `🌍 ${code}`;
}

module.exports = { COUNTRIES, findCountry, countryName };
