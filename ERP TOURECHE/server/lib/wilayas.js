// 69 ولاية (تقسيم 2026) — [الرمز، الاسم بالعربية، الاسم بالفرنسية، ASCII، الولاية الأم عند الشحن]
// شركات التوصيل ما زالت تعمل بـ 58 ولاية: الولايات 59–69 تُشحن باسم ولايتها الأم (shipAs).
// المصدر: DZBuild-com/dzship data/wilayas-2026.json (MIT) — انظر NOTICE.md
const RAW = [
  [1, "أدرار", "Adrar", "Adrar", 1],
  [2, "الشلف", "Chlef", "Chlef", 2],
  [3, "الأغواط", "Laghouat", "Laghouat", 3],
  [4, "أم البواقي", "Oum El Bouaghi", "Oum El Bouaghi", 4],
  [5, "باتنة", "Batna", "Batna", 5],
  [6, "بجاية", "Béjaïa", "Bejaia", 6],
  [7, "بسكرة", "Biskra", "Biskra", 7],
  [8, "بشار", "Béchar", "Bechar", 8],
  [9, "البليدة", "Blida", "Blida", 9],
  [10, "البويرة", "Bouira", "Bouira", 10],
  [11, "تمنراست", "Tamanrasset", "Tamanrasset", 11],
  [12, "تبسة", "Tébessa", "Tebessa", 12],
  [13, "تلمسان", "Tlemcen", "Tlemcen", 13],
  [14, "تيارت", "Tiaret", "Tiaret", 14],
  [15, "تيزي وزو", "Tizi Ouzou", "Tizi Ouzou", 15],
  [16, "الجزائر", "Alger", "Alger", 16],
  [17, "الجلفة", "Djelfa", "Djelfa", 17],
  [18, "جيجل", "Jijel", "Jijel", 18],
  [19, "سطيف", "Sétif", "Setif", 19],
  [20, "سعيدة", "Saïda", "Saida", 20],
  [21, "سكيكدة", "Skikda", "Skikda", 21],
  [22, "سيدي بلعباس", "Sidi Bel Abbès", "Sidi Bel Abbes", 22],
  [23, "عنابة", "Annaba", "Annaba", 23],
  [24, "قالمة", "Guelma", "Guelma", 24],
  [25, "قسنطينة", "Constantine", "Constantine", 25],
  [26, "المدية", "Médéa", "Medea", 26],
  [27, "مستغانم", "Mostaganem", "Mostaganem", 27],
  [28, "المسيلة", "M'Sila", "M'Sila", 28],
  [29, "معسكر", "Mascara", "Mascara", 29],
  [30, "ورقلة", "Ouargla", "Ouargla", 30],
  [31, "وهران", "Oran", "Oran", 31],
  [32, "البيض", "El Bayadh", "El Bayadh", 32],
  [33, "إليزي", "Illizi", "Illizi", 33],
  [34, "برج بوعريريج", "Bordj Bou Arréridj", "Bordj Bou Arreridj", 34],
  [35, "بومرداس", "Boumerdès", "Boumerdes", 35],
  [36, "الطارف", "El Tarf", "El Tarf", 36],
  [37, "تندوف", "Tindouf", "Tindouf", 37],
  [38, "تيسمسيلت", "Tissemsilt", "Tissemsilt", 38],
  [39, "الوادي", "El Oued", "El Oued", 39],
  [40, "خنشلة", "Khenchela", "Khenchela", 40],
  [41, "سوق أهراس", "Souk Ahras", "Souk Ahras", 41],
  [42, "تيبازة", "Tipaza", "Tipaza", 42],
  [43, "ميلة", "Mila", "Mila", 43],
  [44, "عين الدفلى", "Aïn Defla", "Ain Defla", 44],
  [45, "النعامة", "Naâma", "Naama", 45],
  [46, "عين تموشنت", "Aïn Témouchent", "Ain Temouchent", 46],
  [47, "غرداية", "Ghardaïa", "Ghardaia", 47],
  [48, "غليزان", "Relizane", "Relizane", 48],
  [49, "تيميمون", "Timimoun", "Timimoun", 49],
  [50, "برج باجي مختار", "Bordj Badji Mokhtar", "Bordj Badji Mokhtar", 50],
  [51, "أولاد جلال", "Ouled Djellal", "Ouled Djellal", 51],
  [52, "بني عباس", "Béni Abbès", "Beni Abbes", 52],
  [53, "عين صالح", "In Salah", "In Salah", 53],
  [54, "عين قزام", "In Guezzam", "In Guezzam", 54],
  [55, "تقرت", "Touggourt", "Touggourt", 55],
  [56, "جانت", "Djanet", "Djanet", 56],
  [57, "المغير", "El M'Ghair", "El M'Ghair", 57],
  [58, "المنيعة", "El Meniaa", "El Meniaa", 58],
  [59, "أفلو", "Aflou", "Aflou", 3],
  [60, "بريكة", "Barika", "Barika", 5],
  [61, "القنطرة", "El Kantara", "El Kantara", 7],
  [62, "بئر العاتر", "Bir El Ater", "Bir El Ater", 12],
  [63, "العريشة", "El Aricha", "El Aricha", 13],
  [64, "قصر الشلالة", "Ksar Chellala", "Ksar Chellala", 14],
  [65, "عين وسارة", "Aïn Ouessara", "Ain Ouessara", 17],
  [66, "مسعد", "Messaad", "Messaad", 17],
  [67, "قصر البخاري", "Ksar El Boukhari", "Ksar El Boukhari", 26],
  [68, "بوسعادة", "Bou Saâda", "Bou Saada", 28],
  [69, "الأبيض سيدي الشيخ", "El Abiodh Sidi Cheikh", "El Abiodh Sidi Cheikh", 32],
];

export const WILAYAS = RAW.map(([code, ar, fr, ascii, shipAs]) => ({ code, ar, fr, ascii, shipAs }));
const BY_CODE = new Map(WILAYAS.map((w) => [w.code, w]));

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u064B-\u0652]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, '');

const BY_NAME = new Map();
for (const w of WILAYAS) for (const n of [w.ar, w.fr, w.ascii]) BY_NAME.set(norm(n), w);
// أسماء شائعة أخرى
for (const [alias, code] of [['alger', 16], ['algiers', 16], ['الجزائرالعاصمه', 16], ['bejaia', 6], ['tizi', 15], ['oran', 31], ['constantine', 25], ['setif', 19], ['annaba', 23], ['bba', 34], ['bordjbouarreridj', 34], ['elbayadh', 32], ['eloued', 39], ['oued', 39]]) BY_NAME.set(norm(alias), BY_CODE.get(code));

export function wilayaByCode(code) {
  return BY_CODE.get(Number(code)) || null;
}

/** يقبل «16»، «16 - الجزائر»، «Alger»، «الجزائر» ويعيد الولاية أو null */
export function parseWilaya(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return wilayaByCode(input);
  const s = String(input).trim();
  const m = /^(\d{1,2})\b/.exec(s);
  if (m && BY_CODE.has(Number(m[1]))) return BY_CODE.get(Number(m[1]));
  const rest = s.replace(/^\d{1,2}\s*[-–:]\s*/, '');
  return BY_NAME.get(norm(rest)) || null;
}

/** رمز الولاية الذي تقبله شركات التوصيل (1–58) */
export function shippingWilaya(code) {
  const w = wilayaByCode(code);
  return w ? w.shipAs : null;
}
