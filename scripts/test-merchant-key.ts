// Pruebas del normalizador de comercios. Correr con:  node scripts/test-merchant-key.ts
// No necesita framework: si algo falla, sale con código 1 y lista los casos.
import { merchantKey, conceptoLegible } from "../lib/finanzasCaptura.ts";

const casos: [string, string][] = [
  // EE.UU. — el caso del viaje
  ["WHATABURGER #1042 HOUSTON TX",        "whataburger"],
  ["WHATABURGER #0087 KATY TX",           "whataburger"],   // misma llave, otra sucursal
  ["SQ *BLUE BOTTLE COFFEE",              "blue-bottle-coffee"],
  ["TST* RUDYS BAR B Q AUSTIN TX",        "rudys-bar-b"],
  ["UBER   TRIP HOUSTON TX",              "uber-trip"],
  ["UBER EATS",                           "uber-eats"],
  ["7 ELEVEN 32122 HOUSTON TX",           "7-eleven"],
  ["H E B #653 HOUSTON TX",               "h-e-b"],
  ["SHELL OIL 57445208 HOUSTON TX",       "shell-oil"],
  ["MARRIOTT MARQUIS HOUSTON TX",         "marriott-marquis"],

  // México
  ["OXXO 4521 CIUDAD DE MEXICO",          "oxxo"],
  ["CFE 123456789012",                    "cfe"],
  ["NETFLIX.COM",                         "netflix"],
  ["AMAZON MX MARKETPLACE",               "amazon"],
  ["COMPRA EN LIVERPOOL SA DE CV",        "liverpool"],
  ["PAGO A TELCEL 5512345678",            "telcel"],
  ["STARBUCKS STORE 12345 CDMX",          "starbucks"],

  // Acentos y espacios raros
  ["FARMACIA SAN PABLO   CDMX",           "farmacia-san-pablo"],
  ["CAFÉ PUNTA DEL CIELO",                "cafe-punta-del"],

  // ── Strings REALES del Amex Platinum MX (screenshots del 14-sep-2026) ──
  // Amex Mexico pega la ciudad SIN codigo de estado ("... HOUSTON"), asi que el
  // recorte por codigo de estado no dispara. Se acepta: el formato es
  // consistente, la llave sale igual siempre y el aprendizaje pega.
  ["MCDONALD'S F10691 00000 HOUSTON",     "mcdonald"],
  ["MCDONALD'S F10527 00000 HOUSTON",     "mcdonald"],
  ["T J MAXX #1439 00000143 HOUSTON",     "t-j-maxx"],
  ["UNIQLO MEMORIAL CITY HOUSTON",        "uniqlo-memorial-city"],
  ["H-E-B #109 000000000879 HOUSTON",     "h-e-b"],
  ["TST* RAYS REAL PIT BBQ HOUSTON",      "rays-real-pit"],
  ["TST* LUA VIET KITCHEN M HOUSTON",     "lua-viet-kitchen"],
  ["ROSS STORES #754 HOUSTON",            "ross-stores"],
  ["STARBUCKS STORE 4802 HOUSTON",        "starbucks"],
  ["ALI AND SONS GROUP LLC Houston",      "ali-and-sons"],
  ["LYFT *STANDARD 09-13 SAN FRANCISCO",  "lyft-standard"],
  ["HOUSTON MUSEUM NAT SCI HOUSTON",      "houston-museum-nat"],
  ["SKY CHEFS 462",                       "sky-chefs"],
  ["COCHA Houston",                       "cocha-houston"],

  // Bordes
  ["",                                    ""],
  ["#### 1234",                           "1234"],
];

let fallas = 0;
for (const [entrada, esperado] of casos) {
  const got = merchantKey(entrada);
  if (got !== esperado) {
    fallas++;
    console.error(`FALLA  "${entrada}"\n  esperado: "${esperado}"\n  obtenido: "${got}"`);
  }
}

// El invariante que de verdad importa: dos sucursales del mismo comercio
// tienen que producir la misma llave, o el aprendizaje nunca pega.
const sucursales = ["WHATABURGER #1042 HOUSTON TX", "WHATABURGER #0087 KATY TX", "WHATABURGER 9981 SUGAR LAND TX"];
const llaves = new Set(sucursales.map(merchantKey));
if (llaves.size !== 1) {
  fallas++;
  console.error(`FALLA  sucursales del mismo comercio dieron ${llaves.size} llaves: ${[...llaves].join(", ")}`);
}

// El mismo comercio escrito por dos procesadores distintos: uno pega prefijo,
// el otro pega ciudad y estado. Tienen que caer en la misma regla.
const formatos = ["SQ *BLUE BOTTLE COFFEE", "BLUE BOTTLE COFFEE SAN FRANCISCO CA"];
const llavesFmt = new Set(formatos.map(merchantKey));
if (llavesFmt.size !== 1) {
  fallas++;
  console.error(`FALLA  formatos del mismo comercio dieron ${llavesFmt.size} llaves: ${[...llavesFmt].join(", ")}`);
}

// Dos sucursales de McDonald's aparecen en el MISMO screenshot con folios
// distintos. Si no caen en la misma llave, la regla nunca se consolida.
const mcd = new Set(["MCDONALD'S F10691 00000 HOUSTON", "MCDONALD'S F10527 00000 HOUSTON"].map(merchantKey));
if (mcd.size !== 1) {
  fallas++;
  console.error(`FALLA  McDonald's dio ${mcd.size} llaves: ${[...mcd].join(", ")}`);
}

console.log(`conceptoLegible("blue-bottle-coffee") = "${conceptoLegible("blue-bottle-coffee")}"`);
console.log(`conceptoLegible("h-e-b") = "${conceptoLegible("h-e-b")}"`);
console.log(fallas === 0 ? `OK — ${casos.length} casos + 4 invariantes` : `${fallas} fallas`);
process.exit(fallas === 0 ? 0 : 1);
