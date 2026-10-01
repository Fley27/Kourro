// @retail/mock-catalog — deterministic dev mock catalog generator.
// Haitian best-sellers across business types (epicerie, bar/buvette, household).
// Run: npm run generate  (writes categories.json, suppliers.json, products.json,
// product_supplier_costs.json next to this file — all committed).
//
// Tiers (supplier coverage): U = ubiquitous (~90% of suppliers), C = crossed
// (2-5 suppliers, ~70% of products), N = niche (<=3), E = exclusive (1).
// Units carry the variant dimensions: [label, factorToBase, condition, sellHTG].
// Costs derive from sell x margin + seeded jitter (stable across runs).

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------- deterministic RNG (stable output) ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260923);

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "u";

// ---------- categories (polyhierarchy DAG) ----------
// [id, name, icon, color, sort, parents[]]
const CATS = [
  ["drinks", "Bwason", "🥤", "#0f172a", 1, []],
  ["beer", "Byè", "🍺", "#0f172a", 2, ["drinks", "alcohol"]],
  ["alcohol", "Alkòl", "🥃", "#0f172a", 3, ["drinks"]],
  ["liquor", "Like", "🍾", "#0f172a", 4, ["alcohol"]],
  ["soft", "Bwason dous", "🧋", "#0f172a", 5, ["drinks"]],
  ["water", "Dlo", "💧", "#0f172a", 6, ["drinks"]],
  ["juice", "Ji", "🧃", "#0f172a", 7, ["drinks"]],
  ["energy", "Enèji", "⚡", "#0f172a", 8, ["soft"]],
  ["food", "Manje", "🍚", "#0f172a", 10, []],
  ["staples", "Baz", "🌾", "#0f172a", 11, ["food"]],
  ["beans", "Pwa", "🫘", "#0f172a", 12, ["food", "staples"]],
  ["dairy", "Letye", "🥛", "#0f172a", 13, ["food"]],
  ["bakery", "Boulanjri", "🥐", "#0f172a", 14, ["food"]],
  ["snacks", "Goute", "🍪", "#0f172a", 15, ["food", "bakery"]],
  ["produce", "Lejume", "🥬", "#0f172a", 16, ["food"]],
  ["frozen", "Vyann", "🍗", "#0f172a", 17, ["food"]],
  ["canned", "Konsèv", "🥫", "#0f172a", 18, ["food", "staples"]],
  ["household", "Kay", "🧴", "#0f172a", 20, []],
  ["care", "Swen", "🧼", "#0f172a", 21, []],
  ["baby", "Bebe", "🍼", "#0f172a", 22, []],
  ["tob", "Tabak", "🚬", "#0f172a", 23, []],
];

// ---------- suppliers (10, global) ----------
const SUPPLIERS = [
  ["sup-carib", "Caribbean Foods", "+509 2810 1001", "30 jou"],
  ["sup-haiti-import", "Haiti Import SA", "+509 2810 1002", "COD"],
  ["sup-diri", "Diri & Co", "+509 2810 1003", "15 jou"],
  ["sup-bwason", "Bwason Plus", "+509 2810 1004", "COD"],
  ["sup-top", "Top Marché Supply", "+509 2810 1005", "30 jou"],
  ["sup-pv", "Petyonvil Distribisyon", "+509 2810 1006", "7 jou"],
  ["sup-sid", "Sid Distribisyon", "+509 2810 1007", "15 jou"],
  ["sup-no", "Nò Wholesale", "+509 2810 1008", "30 jou"],
  ["sup-santral", "Santral Pwovizyon", "+509 2810 1009", "COD"],
  ["sup-ti", "Ti Machann Wholesale", "+509 2810 1010", "Cash"],
];

// ---------- products ----------
// P(sku, name, name_ht, cats, tier, stockBase, low, units, bundles?)
// U(label, factor, condition, sell)   condition: null | "cold"
// stockBase is in BASE units (factor 1). Cost derived via margin+jitter.
const U = (label, factor, condition, sell) => ({ label, factor, condition, sell });
const B = (unitIdx, variant, minQty, price) => ({ unitIdx, variant, minQty, price });
const P = (sku, name, ht, cats, tier, stock, low, units, bundles = []) =>
  ({ sku, name, name_ht: ht, cats, tier, stock, low, units, bundles });

const PRODUCTS = [
  // ---- beer / alcohol (liquor shots deduct fractionally from bottle) ----
  P("PREST-12", "Prestige 12oz", "Prestige 12oz", ["drinks", "beer", "alcohol"], "U", 240, 48,
    [U("single", 1, null, 150), U("single", 1, "cold", 175), U("box of 24", 24, null, 3300), U("box of 24", 24, "cold", 3600)],
    [B(1, "Cold", 3, 450)]),
  P("PREST-LT-12", "Prestige Light 12oz", "Prestige Light 12oz", ["drinks", "beer", "alcohol"], "C", 96, 24,
    [U("single", 1, null, 150), U("single", 1, "cold", 175), U("box of 24", 24, "cold", 3600)]),
  P("PREST-22", "Prestige 22oz", "Prestige 22oz", ["drinks", "beer", "alcohol"], "C", 60, 12,
    [U("single", 1, null, 250), U("single", 1, "cold", 275)]),
  P("CORONA-12", "Corona 12oz", "Corona 12oz", ["drinks", "beer", "alcohol"], "U", 144, 24,
    [U("single", 1, "cold", 225), U("6-pack", 6, null, 1150), U("6-pack", 6, "cold", 1250), U("box of 24", 24, null, 4400), U("box of 24", 24, "cold", 4700)]),
  P("HEIN-12", "Heineken 12oz", "Heineken 12oz", ["drinks", "beer", "alcohol"], "C", 72, 24,
    [U("single", 1, null, 200), U("single", 1, "cold", 225), U("6-pack", 6, "cold", 1200)]),
  P("GUIN-12", "Guinness 12oz", "Guinness 12oz", ["drinks", "beer", "alcohol"], "N", 48, 12,
    [U("single", 1, null, 225), U("single", 1, "cold", 250)]),
  P("AMSTEL-12", "Amstel 12oz", "Amstel 12oz", ["drinks", "beer", "alcohol"], "N", 48, 12,
    [U("single", 1, "cold", 200), U("6-pack", 6, "cold", 1050)]),
  P("BARB-3-750", "Rhum Barbancourt 3-Star 750ml", "Barbancourt 3-Star 750ml", ["drinks", "alcohol", "liquor"], "U", 30, 6,
    [U("bottle", 1, null, 1450), U("shot", 0.04, null, 100)]),
  P("BARB-5-750", "Rhum Barbancourt 5-Star 750ml", "Barbancourt 5-Star 750ml", ["drinks", "alcohol", "liquor"], "C", 18, 4,
    [U("bottle", 1, null, 2400), U("shot", 0.04, null, 150)]),
  P("KLEREN-750", "Kleren 750ml", "Kleren 750ml", ["drinks", "alcohol", "liquor"], "C", 24, 6,
    [U("bottle", 1, null, 650), U("shot", 0.04, null, 50), U("gallon", 5, null, 2900)]),
  P("VIEUX-LABBE", "Rhum Vieux Labbé 750ml", "Vieux Labbé 750ml", ["drinks", "alcohol", "liquor"], "E", 12, 3,
    [U("bottle", 1, null, 1800), U("shot", 0.04, null, 125)]),
  P("BW-750", "Whisky Black & White 750ml", "Whisky 750ml", ["drinks", "alcohol", "liquor"], "E", 8, 2,
    [U("bottle", 1, null, 3200), U("shot", 0.04, null, 200)]),
  P("VODKA-750", "Vodka Nikolai 750ml", "Vodka 750ml", ["drinks", "alcohol", "liquor"], "C", 10, 2,
    [U("bottle", 1, null, 1500), U("shot", 0.04, null, 100)]),
  P("KREMAS-750", "Kremas 750ml", "Kremas 750ml", ["drinks", "alcohol", "liquor"], "E", 12, 3,
    [U("bottle", 1, null, 1200), U("shot", 0.04, null, 100)]),
  P("MALTA-350", "Malta H 350ml", "Malta 350ml", ["drinks", "soft"], "C", 120, 24,
    [U("single", 1, null, 100), U("single", 1, "cold", 125), U("6-pack", 6, null, 550)]),
  // ---- sodas: 12-pack, box = 2x12, sold by 3, singles cold+regular ----
  P("COCA-500", "Coca-Cola 500ml", "Coca 500ml", ["drinks", "soft"], "U", 144, 36,
    [U("single", 1, null, 100), U("single", 1, "cold", 125), U("3-pack", 3, null, 275), U("12-pack", 12, null, 1050), U("12-pack", 12, "cold", 1200), U("box of 24", 24, null, 2000)],
    [B(2, "Regular", 3, 750)]),
  P("COCA-2L", "Coca-Cola 2L", "Coca 2L", ["drinks", "soft"], "C", 36, 6, [U("single", 1, null, 250)]),
  P("COCA-350", "Coca-Cola Can 350ml", "Coca Canette 350ml", ["drinks", "soft"], "C", 72, 12,
    [U("single", 1, "cold", 110), U("6-pack", 6, "cold", 600)]),
  P("SPRITE-500", "Sprite 500ml", "Sprite 500ml", ["drinks", "soft"], "U", 120, 24,
    [U("single", 1, null, 100), U("single", 1, "cold", 125), U("12-pack", 12, null, 1050), U("box of 24", 24, null, 2000)]),
  P("SPRITE-2L", "Sprite 2L", "Sprite 2L", ["drinks", "soft"], "C", 24, 6, [U("single", 1, null, 250)]),
  P("FANTA-500", "Fanta 500ml", "Fanta 500ml", ["drinks", "soft"], "C", 96, 24,
    [U("single", 1, null, 100), U("single", 1, "cold", 125), U("12-pack", 12, null, 1050)]),
  P("CRN-CHAMP-500", "Couronne Champagne 500ml", "Cola Couronne 500ml", ["drinks", "soft"], "C", 144, 24,
    [U("single", 1, null, 75), U("single", 1, "cold", 100), U("3-pack", 3, null, 200), U("12-pack", 12, null, 800), U("box of 24", 24, null, 1550)]),
  P("CRN-OR-500", "Couronne Orange 500ml", "Couronne Orange 500ml", ["drinks", "soft"], "C", 96, 24,
    [U("single", 1, null, 75), U("single", 1, "cold", 100), U("12-pack", 12, null, 800)]),
  P("CRN-CIT-500", "Couronne Citron 500ml", "Couronne Citron 500ml", ["drinks", "soft"], "C", 96, 24,
    [U("single", 1, null, 75), U("single", 1, "cold", 100), U("12-pack", 12, null, 800)]),
  P("CRN-FRAMB-500", "Couronne Framboise 500ml", "Couronne Framboise 500ml", ["drinks", "soft"], "C", 72, 12,
    [U("single", 1, null, 75), U("single", 1, "cold", 100)]),
  // ---- water / juice / energy ----
  P("DLO-5GAL", "Water 5gal", "Dlo 5 galon", ["drinks", "water"], "U", 40, 8, [U("jug", 1, null, 150), U("jug", 1, "cold", 175)]),
  P("DLO-1L", "Water Crystal 1L", "Dlo Cristal 1L", ["drinks", "water"], "C", 96, 24,
    [U("single", 1, null, 75), U("single", 1, "cold", 100), U("case of 12", 12, null, 800)]),
  P("DLO-SACHET", "Water Sachet Bag 20x500ml", "Dlo sachet 20", ["drinks", "water"], "C", 40, 8, [U("bag of 20", 20, null, 500), U("bag of 20", 20, "cold", 600)]),
  P("DLO-1GAL", "Dlo Trete 1gal", "Dlo Trete 1 galon", ["drinks", "water"], "C", 24, 6, [U("gallon", 1, null, 125)]),
  P("TAMP-1L", "Tampico 1L", "Tampico 1L", ["drinks", "juice"], "C", 48, 12,
    [U("single", 1, null, 150), U("single", 1, "cold", 175), U("gallon", 3.78, null, 550)]),
  P("JUVE-MANGO", "Juve Mango 500ml", "Ji Mango 500ml", ["drinks", "juice"], "C", 60, 12,
    [U("single", 1, null, 125), U("single", 1, "cold", 150)]),
  P("TORO-250", "Toro Energy 250ml", "Toro 250ml", ["drinks", "soft", "energy"], "C", 72, 12, [U("single", 1, "cold", 150)]),
  // ---- coffee / milk / eggs ----
  P("KAFE-200", "Rebo Coffee 200g", "Kafe Rebo 200g", ["food", "staples"], "C", 60, 10,
    [U("pack", 1, null, 450), U("case of 12", 12, null, 5000)]),
  P("KAFE-GRENN", "Kafe Grenn 1lb", "Kafe grenn 1 liv", ["food", "staples"], "C", 40, 8, [U("pound", 1, null, 600)]),
  P("LET-400", "Milk Powder Nido 400g", "Lèt Nido 400g", ["food", "dairy"], "U", 48, 8,
    [U("tin", 1, null, 650), U("box of 12", 12, null, 7400)]),
  P("LET-EVAP", "Evaporated Milk 354ml", "Lèt evapore 354ml", ["food", "dairy", "canned"], "C", 72, 12,
    [U("can", 1, null, 150), U("box of 48", 48, null, 6700)]),
  P("ZE-12", "Eggs Dozen", "Ze 1 douzèn", ["food", "dairy"], "U", 360, 60, [U("egg", 1, null, 25), U("dozen", 12, null, 275)]),
  P("YOGOUT-200", "Yogout 200ml", "Yogout 200ml", ["food", "dairy"], "C", 48, 12, [U("single", 1, "cold", 150)]),
  P("BUTTER-250", "Butter 250g", "Bè 250g", ["food", "dairy"], "C", 40, 8, [U("pack", 1, null, 450)]),
  // ---- staples: sack / mamit / vè (base = smallest) ----
  P("RICE-25KG", "Rice 25kg", "Diri 25kg", ["food", "staples"], "U", 2500, 250,
    [U("sack 25kg", 50, null, 3200), U("mamit", 6, null, 400), U("vè", 1, null, 75)]),
  P("RICE-MEGA-10", "Rice Mega 10kg", "Diri Mega 10kg", ["food", "staples"], "C", 1000, 100,
    [U("sack 10kg", 20, null, 1350), U("mamit", 6, null, 400), U("vè", 1, null, 75)]),
  P("RICE-DJAK-5", "Rice Djakout 5kg", "Diri Djakout 5kg", ["food", "staples"], "C", 500, 50, [U("bag 5kg", 10, null, 700), U("mamit", 6, null, 400)]),
  P("SIK-10KG", "White Sugar 10kg", "Sik Blan 10kg", ["food", "staples"], "U", 1000, 100,
    [U("sack 10kg", 40, null, 950), U("mamit", 4, null, 110), U("vè", 1, null, 30)]),
  P("SIK-1KG", "Sugar 1kg Packet", "Sik 1kg", ["food", "staples"], "C", 200, 20, [U("packet", 1, null, 110), U("box of 20", 20, null, 2000)]),
  P("SIK-50KG", "Sugar Sack 50kg", "Sik 50kg", ["food", "staples"], "N", 200, 40, [U("sack 50kg", 200, null, 4400), U("mamit", 4, null, 110)]),
  P("OIL-5L", "Cooking Oil 5L", "Lwil 5L", ["food", "staples"], "U", 60, 10, [U("jug 5L", 5, null, 1100), U("liter", 1, null, 240)]),
  P("OIL-1L", "Cooking Oil 1L", "Lwil 1L", ["food", "staples"], "C", 72, 12, [U("bottle 1L", 1, null, 240), U("case of 12", 12, null, 2700)]),
  P("OIL-20L", "Cooking Oil 20L", "Lwil 20L", ["food", "staples"], "N", 10, 2, [U("tin 20L", 20, null, 4200)]),
  P("OIL-COCO-500", "Coconut Oil 500ml", "Lwil kokoye 500ml", ["food", "staples"], "C", 30, 6, [U("bottle", 1, null, 450)]),
  P("FARIN-25KG", "Flour 25kg", "Farin 25kg", ["food", "staples"], "C", 1000, 100,
    [U("sack 25kg", 50, null, 2800), U("mamit", 6, null, 350), U("vè", 1, null, 65)]),
  P("FARIN-10KG", "Flour 10kg", "Farin 10kg", ["food", "staples"], "C", 400, 40, [U("sack 10kg", 20, null, 1150), U("mamit", 6, null, 350)]),
  P("MAYI-10KG", "Corn Meal 10kg", "Mayi 10kg", ["food", "staples"], "C", 600, 60,
    [U("sack 10kg", 20, null, 800), U("mamit", 4, null, 175), U("vè", 1, null, 50)]),
  P("MAYI-25KG", "Corn Meal 25kg", "Mayi 25kg", ["food", "staples"], "N", 500, 100, [U("sack 25kg", 50, null, 1900), U("mamit", 4, null, 175)]),
  P("SEL-5KG", "Salt 5kg", "Sèl 5kg", ["food", "staples"], "C", 500, 50,
    [U("sack 5kg", 20, null, 300), U("mamit", 4, null, 75), U("vè", 1, null, 25)]),
  P("SEL-500G", "Salt 500g", "Sèl 500g", ["food", "staples"], "C", 150, 20, [U("packet", 1, null, 50)]),
  // ---- beans / grains ----
  P("PWA-NWA-5", "Black Beans 5lb", "Pwa nwa 5 liv", ["food", "beans", "staples"], "C", 300, 30,
    [U("bag 5lb", 5, null, 550), U("mamit", 2, null, 225), U("vè", 1, null, 125)]),
  P("PWA-WOUJ-5", "Red Beans 5lb", "Pwa wouj 5 liv", ["food", "beans", "staples"], "C", 200, 20,
    [U("bag 5lb", 5, null, 600), U("mamit", 2, null, 250)]),
  P("PWA-KONGO-5", "Pwa Kongo 5lb", "Pwa kongo 5 liv", ["food", "beans"], "C", 150, 15, [U("bag 5lb", 5, null, 650), U("mamit", 2, null, 275)]),
  // ---- pasta / canned / condiments ----
  P("PASTA-500", "Spaghetti 500g", "Espageti 500g", ["food", "staples"], "U", 120, 15,
    [U("pack", 1, null, 75), U("box of 24", 24, null, 1650)]),
  P("TOMAT-400", "Tomato Paste 400g", "Tomat 400g", ["food", "canned"], "C", 96, 10,
    [U("can", 1, null, 120), U("box of 48", 48, null, 5300)]),
  P("TOMAT-800", "Tomato Paste 800g", "Tomat 800g", ["food", "canned"], "C", 48, 6, [U("can", 1, null, 220)]),
  P("SARDINE-120", "Sardine Tin 120g", "Sardine 120g", ["food", "canned", "staples"], "C", 150, 20, [U("tin", 1, null, 85), U("box of 50", 50, null, 3900)]),
  P("TUNA-170", "Tuna Can 170g", "Ton 170g", ["food", "canned"], "C", 72, 10, [U("can", 1, null, 175), U("box of 48", 48, null, 7800)]),
  P("CORNED-340", "Corned Beef 340g", "Kòn bif 340g", ["food", "canned"], "C", 60, 8, [U("can", 1, null, 350)]),
  P("MAGGI-100", "Maggi Cube Box 100", "Maggi 100 kib", ["food", "staples"], "U", 500, 100, [U("cube", 1, null, 15), U("box of 100", 100, null, 1250)]),
  P("SOSIS-1KG", "Sausage 1kg", "Sosis 1kg", ["food", "frozen"], "C", 40, 8, [U("pack 1kg", 2, null, 650), U("half pack", 1, null, 350)]),
  P("POULET-LB", "Chicken lb", "Poul 1 liv", ["food", "frozen"], "C", 200, 20, [U("pound", 1, null, 175), U("pound", 1, "cold", 185)]),
  P("KODENN-LB", "Turkey lb", "Kodenn 1 liv", ["food", "frozen"], "N", 60, 10, [U("pound", 1, null, 225)]),
  P("PWASON-LB", "Fish lb", "Pwason 1 liv", ["food", "frozen", "produce"], "N", 80, 10, [U("pound", 1, null, 200)]),
  P("PIKLIZ-JAR", "Pikliz Jar 500ml", "Pikliz bokal", ["food", "produce"], "E", 24, 4, [U("jar", 1, null, 450)]),
  P("EPIS-JAR", "Epis Jar 500ml", "Epis bokal", ["food", "produce"], "C", 30, 5, [U("jar", 1, null, 400)]),
  P("KETCHUP-500", "Ketchup 500ml", "Ketchup 500ml", ["food", "canned"], "C", 48, 6, [U("bottle", 1, null, 275)]),
  P("MAYO-500", "Mayo 500ml", "Mayo 500ml", ["food", "canned"], "C", 48, 6, [U("jar", 1, null, 350)]),
  P("VINEG-500", "Vinegar 500ml", "Vinèg 500ml", ["food", "staples"], "C", 48, 6, [U("bottle", 1, null, 150)]),
  P("TE-25", "Tea Bags Box 25", "Te 25 sache", ["food", "staples"], "C", 100, 10, [U("bag", 1, null, 15), U("box of 25", 25, null, 300)]),
  P("AVWAN-500", "Oats 500g", "Avwan 500g", ["food", "staples"], "C", 60, 8, [U("pack", 1, null, 275)]),
  P("MANBA-500", "Peanut Butter 500g", "Manba 500g", ["food", "staples"], "C", 48, 6, [U("jar", 1, null, 450)]),
  // ---- bakery / snacks ----
  P("PEN-50", "Bread 50g", "Pen 50g", ["food", "bakery"], "C", 200, 30, [U("single", 1, null, 25), U("dozen", 12, null, 275)]),
  P("GATEAU-SL", "Cake Slice", "Moso gato", ["food", "bakery"], "E", 40, 8, [U("slice", 1, null, 100)]),
  P("KWASAN", "Croissant", "Kwasan", ["food", "bakery", "snacks"], "N", 60, 10, [U("single", 1, null, 75)]),
  P("BISK-30", "Sayo Biscuit", "Biskè Sayo", ["food", "bakery", "snacks"], "U", 200, 30, [U("single", 1, null, 25), U("box of 36", 36, null, 800)]),
  P("CRACKERS-100", "Soda Crackers 100g", "Krakè 100g", ["food", "bakery", "snacks"], "C", 120, 15, [U("pack", 1, null, 50), U("box of 24", 24, null, 1050)]),
  P("CHIPS-BAN", "Banana Chips 100g", "Chips fig 100g", ["food", "snacks"], "N", 80, 10, [U("bag", 1, null, 100)]),
  P("PISTACH-100", "Peanuts 100g", "Pistach 100g", ["food", "snacks"], "C", 100, 12, [U("bag", 1, null, 75), U("box of 20", 20, null, 1300)]),
  // ---- produce fresh ----
  P("TOMAT-FRESH", "Tomato Fresh kg", "Tomat fre 1kg", ["food", "produce"], "C", 100, 10,
    [U("kg", 2, null, 200), U("pound", 1, null, 100)]),
  P("ZYONYON", "Onion kg", "Zonyon 1kg", ["food", "produce"], "C", 100, 10, [U("kg", 2, null, 250), U("pound", 1, null, 125)]),
  P("LAY", "Garlic Head", "Lay 1 tèt", ["food", "produce"], "N", 100, 15, [U("head", 1, null, 25)]),
  P("BANNANN-DZ", "Plantain Dozen", "Bannann 1 douzèn", ["food", "produce"], "N", 60, 6, [U("single", 1, null, 50), U("dozen", 12, null, 550)]),
  P("CHOU", "Cabbage", "Chou", ["food", "produce"], "C", 40, 5, [U("head", 1, null, 150)]),
  P("KAWOT-LB", "Carrot lb", "Kawòt 1 liv", ["food", "produce"], "C", 80, 10, [U("pound", 1, null, 100)]),
  P("SITWON-SK", "Lime Sack", "Sitwon 1 sak", ["food", "produce"], "N", 20, 3, [U("sack", 100, null, 1500), U("dozen", 12, null, 200)]),
  P("MANYOK-LB", "Cassava lb", "Manyòk 1 liv", ["food", "produce"], "C", 100, 10, [U("pound", 1, null, 75)]),
  // ---- household ----
  P("SOAP-001", "Laundry Soap Bar", "Savon 1 moso", ["household"], "U", 250, 30, [U("bar", 1, null, 50), U("box of 40", 40, null, 1800)]),
  P("SAVON-DET", "Detergent Powder 1kg", "Savon Poud 1kg", ["household"], "C", 80, 10, [U("bag 1kg", 1, null, 120), U("box of 12", 12, null, 1300)]),
  P("SAVON-500", "Detergent Powder 500g", "Savon Poud 500g", ["household"], "C", 100, 12, [U("bag", 1, null, 65)]),
  P("CLOROX-1L", "Bleach 1L", "Klowo 1L", ["household"], "C", 60, 8, [U("bottle 1L", 1, null, 150), U("case of 12", 12, null, 1650)]),
  P("SAVON-LIK", "Dish Soap 500ml", "Savon likid 500ml", ["household"], "C", 60, 8, [U("bottle", 1, null, 175)]),
  P("EPONJ", "Sponge", "Eponj", ["household"], "C", 100, 12, [U("single", 1, null, 50)]),
  P("BALAI", "Broom", "Balè", ["household"], "C", 20, 3, [U("single", 1, null, 450)]),
  P("ALIMET", "Matches Box", "Alimèt 1 bwat", ["household", "tob"], "C", 200, 20, [U("box", 1, null, 25), U("pack of 10", 10, null, 225)]),
  P("BALENN", "Candle", "Balèn", ["household"], "C", 150, 15, [U("single", 1, null, 50), U("pack of 6", 6, null, 275)]),
  P("BAT-AA4", "Batteries AA 4-pack", "Pil AA 4", ["household"], "C", 60, 8, [U("pack of 4", 1, null, 250)]),
  P("ANPOUL", "Light Bulb", "Anpoul", ["household"], "C", 48, 6, [U("single", 1, null, 200), U("box of 12", 12, null, 2200)]),
  P("CHARBON-10", "Charcoal 10kg", "Chabon 10kg", ["household", "food"], "C", 200, 20,
    [U("sack 10kg", 10, null, 800), U("mamit", 1, null, 100)]),
  P("KEROZ-L", "Kerosene Liter", "Kerozen 1L", ["household"], "C", 100, 10, [U("liter", 1, null, 200), U("gallon", 3.78, null, 725)]),
  P("SACH-POUB", "Trash Bags x10", "Sach poubèl 10", ["household"], "C", 80, 10, [U("pack of 10", 1, null, 150)]),
  // ---- personal care ----
  P("PAT-COLG", "Colgate Toothpaste", "Pat Colgate", ["care"], "C", 100, 10, [U("tube", 1, null, 180), U("box of 12", 12, null, 2000)]),
  P("BWOS-DAN", "Toothbrush", "Bwòs dan", ["care"], "C", 100, 12, [U("single", 1, null, 100)]),
  P("DEODO", "Deodorant", "Deyodoran", ["care"], "C", 48, 6, [U("single", 1, null, 350)]),
  P("SHAMP-SACH", "Shampoo Sachet", "Chanpou sache", ["care"], "C", 200, 20, [U("sachet", 1, null, 25), U("box of 12", 12, null, 275)]),
  P("SAVON-LUX", "Beauty Soap", "Savon Lux 1 moso", ["care"], "C", 120, 12, [U("bar", 1, null, 125), U("3-pack", 3, null, 350)]),
  P("POMAD", "Hair Pomade", "Pomad 100g", ["care"], "C", 48, 6, [U("jar", 1, null, 250)]),
  P("RAZWA", "Razor", "Razwa", ["care"], "C", 100, 12, [U("single", 1, null, 75)]),
  P("PAPIJ-TWAL", "Toilet Paper Roll", "Papye twalèt 1 woulo", ["care", "household"], "U", 200, 20, [U("roll", 1, null, 75), U("pack of 12", 12, null, 825)]),
  P("SERVIET-YEJ", "Sanitary Pads 8", "Sèvyèt 8", ["care"], "C", 60, 8, [U("pack of 8", 1, null, 250)]),
  // ---- baby ----
  P("KOUCH-M20", "Diapers M x20", "Kouch M 20", ["baby"], "C", 60, 6, [U("pack of 20", 1, null, 850), U("box of 4", 4, null, 3200)]),
  P("LETE-BEBE", "Baby Formula 400g", "Lèt bebe 400g", ["baby"], "E", 20, 3, [U("tin", 1, null, 1500)]),
  P("LWIL-BEBE", "Baby Oil 200ml", "Lwil bebe 200ml", ["baby", "care"], "C", 40, 5, [U("bottle", 1, null, 350)]),
  P("SAVON-BEBE", "Baby Soap", "Savon bebe", ["baby", "care"], "C", 60, 6, [U("bar", 1, null, 150)]),
  P("LINGET", "Baby Wipes 80", "Lenjèt 80", ["baby"], "C", 48, 6, [U("pack", 1, null, 400)]),
  P("RAPADOU", "Rapadou", "Rapadou", ["food", "staples"], "C", 80, 8, [U("cone", 1, null, 75)]),
  P("TABLET-KOKO", "Tablette Kokoye", "Tablet kokoye", ["food", "snacks"], "N", 60, 6, [U("single", 1, null, 50)]),
  P("DOUS-MAKOS", "Dous Makos", "Dous makos", ["food", "snacks", "bakery"], "N", 48, 5, [U("single", 1, null, 100)]),
  P("AKASAN-500", "Akasan 500ml", "Akasan 500ml", ["drinks", "soft"], "C", 60, 8, [U("single", 1, "cold", 125)]),
  P("MABI-500", "Mabi 500ml", "Mabi 500ml", ["drinks", "soft"], "C", 48, 6, [U("single", 1, null, 100)]),
  P("CHOKOLA-5", "Chokola 5 Boul", "Chokola 5 boul", ["food", "staples"], "C", 70, 7, [U("pack of 5", 1, null, 150)]),
  P("POUD-BEBE", "Baby Powder 200g", "Poud bebe 200g", ["baby", "care"], "C", 40, 5, [U("bottle", 1, null, 300)]),
  P("LWIL-MASK", "Castor Oil 100ml", "Lwil maskriti 100ml", ["care"], "N", 36, 4, [U("bottle", 1, null, 275)]),
  // ---- tobacco / misc / stationery ----
  P("CIG-CIF", "Cigarettes Pack 20", "Sigarèt 20", ["tob"], "C", 100, 10, [U("pack of 20", 1, null, 250), U("carton of 10", 10, null, 2350)]),
  P("DOMINO", "Domino Set", "Domino", ["tob", "household"], "E", 10, 2, [U("set", 1, null, 750)]),
  P("KAT-JWE", "Playing Cards", "Kat jwèt", ["tob", "household"], "C", 40, 5, [U("deck", 1, null, 200)]),
  P("KAYE-100", "Notebook 100p", "Kayè 100 paj", ["household"], "C", 100, 12, [U("single", 1, null, 150), U("dozen", 12, null, 1650)]),
  P("PLIM-BL", "Pen Blue", "Plim ble", ["household"], "C", 300, 30, [U("single", 1, null, 25), U("box of 50", 50, null, 1050)]),
  P("KOD-M", "Rope Meter", "Kòd 1 mèt", ["household"], "C", 100, 10, [U("meter", 1, null, 50)]),
  P("KLOU-KG", "Nails kg", "Klou 1kg", ["household"], "C", 50, 5, [U("kg", 1, null, 400)]),
];

// cost margin by family (cost = sell x margin, jittered per supplier)
function marginFor(cats) {
  if (cats.includes("staples") || cats.includes("beans")) return 0.82;
  if (cats.includes("beer") || cats.includes("liquor")) return 0.66;
  if (cats.includes("soft") || cats.includes("water") || cats.includes("juice")) return 0.62;
  if (cats.includes("baby")) return 0.72;
  return 0.7;
}

// ---------- build ----------
function fail(msg) { console.error("✗ " + msg); process.exit(1); }

// 1. categories + DAG validation
const catIds = new Set(CATS.map((c) => c[0]));
for (const [id, , , , , parents] of CATS) {
  for (const p of parents) {
    if (p === id) fail(`self-parent: ${id}`);
    if (!catIds.has(p)) fail(`unknown parent ${p} of ${id}`);
  }
}
// cycle check (child -> parents)
{
  const adj = new Map(CATS.map((c) => [c[0], c[5]]));
  const state = new Map();
  const visit = (n, path) => {
    if (state.get(n) === 1) fail(`category cycle: ${[...path, n].join(" -> ")}`);
    if (state.get(n) === 2) return;
    state.set(n, 1);
    for (const p of adj.get(n) ?? []) visit(p, [...path, n]);
    state.set(n, 2);
  };
  for (const id of catIds) visit(id, []);
}

const categories = CATS.map(([id, name, icon, color, sort, parents]) => ({
  id: `cat-${id}`, key: id, name, icon, color, sort_order: sort, parents: parents.map((p) => `cat-${p}`),
}));

// 2. suppliers
const suppliers = SUPPLIERS.map(([id, name, phone, terms]) => ({
  id, name, phone, address: null, payment_terms: terms, bank_info: null, notes: "mock",
}));

// 3. tier -> supplier assignment (deterministic rotation)
function suppliersFor(tier, pi) {
  const n = SUPPLIERS.length;
  const ids = SUPPLIERS.map((s) => s[0]);
  if (tier === "U") return ids.filter((_, i) => (pi + i) % 10 !== 0); // 9 of 10
  if (tier === "E") return [ids[pi % n]]; // exactly 1
  if (tier === "N") { const k = 2 + (pi % 2); const s = (pi * 5 + 2) % n; return Array.from({ length: k }, (_, j) => ids[(s + j) % n]); }
  const k = 2 + (pi % 4); const s = (pi * 7 + 3) % n; // C: 2-5
  return Array.from({ length: k }, (_, j) => ids[(s + j) % n]);
}

// 4. products + units + prices + bundles + costs
const unitIdOf = (pid, u, seen) => {
  let base = `unit-${pid}-${slug(u.label)}${u.condition ? "-" + slug(u.condition) : ""}`;
  let id = base, i = 2;
  while (seen.has(id)) id = `${base}-${i++}`;
  seen.add(id);
  return id;
};

const products = [];
const costs = [];
PRODUCTS.forEach((p, pi) => {
  const pid = "p-" + slug(p.sku);
  const seen = new Set();
  const units = p.units.map((u) => ({ ...u, id: unitIdOf(pid, u, seen) }));
  const margin = marginFor(p.cats);
  // supplier cost rows: one per (product, supplier, unit)
  for (const sid of suppliersFor(p.tier, pi)) {
    const spread = p.tier === "U" ? 0.03 : p.tier === "E" ? 0 : 0.08;
    for (const u of units) {
      const base = Math.max(1, Math.round(u.sell * margin));
      const jitter = p.tier === "E" ? 0 : (rand() * 2 - 1) * spread;
      costs.push({ product_id: pid, supplier_id: sid, unit_id: u.id, cost: Math.max(1, Math.round(base * (1 + jitter))) });
    }
  }
  products.push({
    id: pid, sku: p.sku, barcode: p.sku, name: p.name, name_ht: p.name_ht,
    categories: p.cats.map((c) => `cat-${c}`), item_type: "goods",
    stock: p.stock, low: p.low, tier: p.tier,
    units: units.map((u) => ({ id: u.id, label: u.label, factor: u.factor, condition: u.condition, sell: u.sell })),
    bundles: p.bundles.map((b) => ({ ...b, unit_id: units[b.unitIdx].id })),
  });
});

// 5. referential checks
const pids = new Set(products.map((p) => p.id));
const uids = new Set(products.flatMap((p) => p.units.map((u) => u.id)));
const sids = new Set(suppliers.map((s) => s.id));
for (const p of products) {
  for (const c of p.categories) if (!catIds.has(c.replace(/^cat-/, ""))) fail(`bad cat ${c} on ${p.sku}`);
  const skus = products.filter((x) => x.sku === p.sku);
  if (skus.length > 1) fail(`dup sku ${p.sku}`);
}
for (const c of costs) {
  if (!pids.has(c.product_id)) fail(`bad cost product ${c.product_id}`);
  if (!sids.has(c.supplier_id)) fail(`bad cost supplier ${c.supplier_id}`);
  if (!uids.has(c.unit_id)) fail(`bad cost unit ${c.unit_id}`);
}

// 6. stats
const tierCount = {};
for (const p of products) tierCount[p.tier] = (tierCount[p.tier] ?? 0) + 1;
const multi = products.filter((p) => p.units.length > 1).length;
const bySup = {};
for (const c of costs) bySup[c.supplier_id] = (bySup[c.supplier_id] ?? 0) + 1;
console.log(`categories: ${categories.length} (poly: ${CATS.filter((c) => c[5].length > 1).length} multi-parent)`);
console.log(`products: ${products.length} tiers=${JSON.stringify(tierCount)} multi-unit=${multi} (${Math.round((multi / products.length) * 100)}%)`);
console.log(`suppliers: ${suppliers.length}`);
console.log(`cost rows: ${costs.length}`);
console.log(`rows/supplier: ${Object.entries(bySup).map(([k, v]) => k.replace("sup-", "") + "=" + v).join(" ")}`);

// 7. emit (canonical here + mirrors for bundler consumers — never hand-edit
// mirrors, they are overwritten by this script)
const out = (name, data) => writeFileSync(join(HERE, name), JSON.stringify(data, null, 2) + "\n");
out("categories.json", categories);
out("suppliers.json", suppliers);
out("products.json", products);
out("product_supplier_costs.json", costs);
const MIRRORS = [
  "../../mobile-app/src/data", // Expo/Metro: relative JSON import, no workspace dep
  "../../web-app/src/data", // Vite: same
];
for (const dir of MIRRORS) {
  try {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(HERE, dir), { recursive: true });
    for (const [name, data] of [["catalog.categories.json", categories], ["catalog.suppliers.json", suppliers], ["catalog.products.json", products], ["catalog.costs.json", costs]]) {
      writeFileSync(join(HERE, dir, name), JSON.stringify(data, null, 2) + "\n");
    }
  } catch (e) { console.error(`⚠ mirror ${dir} failed:`, String(e)); }
}
console.log("✓ wrote categories.json, suppliers.json, products.json, product_supplier_costs.json");
