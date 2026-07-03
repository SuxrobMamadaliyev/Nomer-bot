// Sotuvda ishlatiladigan davlatlar roʻyxati (HeroSMS'dan mustaqil — bu endi
// o'z raqamlar bazamiz uchun ishlatiladi). Admin panelda raqam qo'shishda
// shu roʻyxatdan davlat tanlanadi.
const COUNTRIES = [
  { code: 'uz', name: '🇺🇿 Oʻzbekiston' },
  { code: 'ru', name: '🇷🇺 Rossiya' },
  { code: 'id', name: '🇮🇩 Indoneziya' },
  { code: 'kz', name: '🇰🇿 Qozogʻiston' },
  { code: 'ph', name: '🇵🇭 Filippin' },
  { code: 'ua', name: '🇺🇦 Ukraina' },
  { code: 'cn', name: '🇨🇳 Xitoy' },
  { code: 'us', name: '🇺🇸 AQSh' },
  { code: 'in', name: '🇮🇳 Hindiston' },
  { code: 'tr', name: '🇹🇷 Turkiya' },
  { code: 'gb', name: '🇬🇧 Buyuk Britaniya' },
  { code: 'my', name: '🇲🇾 Malayziya' },
  { code: 'eg', name: '🇪🇬 Misr' },
  { code: 'kg', name: '🇰🇬 Qirgʻiziston' },
  { code: 'tj', name: '🇹🇯 Tojikiston' },
  { code: 'ot', name: '🌍 Boshqa' },
];

function findCountry(code) {
  return COUNTRIES.find(c => c.code === code);
}

function countryName(code) {
  const c = findCountry(code);
  return c ? c.name : `🌍 ${code}`;
}

module.exports = { COUNTRIES, findCountry, countryName };
