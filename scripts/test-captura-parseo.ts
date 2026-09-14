// Pruebas de la validación de lo que devuelve el modelo de visión.
// Correr con:  node scripts/test-captura-parseo.ts
//
// Lo que se protege aquí: que un renglón mal leído NUNCA se cuele al histórico
// como si fuera bueno. Un movimiento inventado no se nota en pantalla.
import { parseLectura, dedupeHash, merchantKey, MAX_ROWS_PER_CAPTURE } from "../lib/finanzasCaptura.ts";

let fallas = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (!cond) { fallas++; console.error(`FALLA  ${nombre}${detalle ? "\n  " + detalle : ""}`); }
}

// ── Caso feliz, con markdown alrededor (el modelo a veces lo agrega) ────────
const feliz = parseLectura(`Aquí va:
\`\`\`json
{"card_last4":"XX4021","movimientos":[
 {"tx_date":"2026-09-12","merchant_raw":"WHATABURGER #1042 HOUSTON TX","amount":18.475,"currency":"usd","txn_state":"posted","tx_type":"placer","confidence":0.93},
 {"tx_date":"2026-09-12","merchant_raw":"SHELL OIL 574 HOUSTON TX","amount":52.1,"currency":"USD","txn_state":"authorized","tx_type":"fijo","confidence":0.88}
],"unreadable_rows":1}
\`\`\``, "MXN");

check("parsea con markdown alrededor", feliz !== null);
check("card_last4 se queda con 4 dígitos", feliz?.card_last4 === "4021", `obtenido: ${feliz?.card_last4}`);
check("dos movimientos", feliz?.movimientos.length === 2);
check("monto redondeado a centavos", feliz?.movimientos[0].amount === 18.48, `obtenido: ${feliz?.movimientos[0].amount}`);
check("divisa normalizada a mayúsculas", feliz?.movimientos[0].currency === "USD");
check("authorized se conserva", feliz?.movimientos[1].txn_state === "authorized");
check("ilegibles del modelo", feliz?.unreadable_rows === 1);

// ── Basura que NO debe pasar ────────────────────────────────────────────────
const sucio = parseLectura(JSON.stringify({
  movimientos: [
    { tx_date: "2026-09-12", merchant_raw: "OXXO", amount: 0, currency: "MXN" },            // monto cero
    { tx_date: "2026-09-12", merchant_raw: "REVERSO", amount: -120, currency: "MXN" },      // negativo
    { tx_date: "12/09/2026", merchant_raw: "STARBUCKS", amount: 90, currency: "MXN" },      // fecha mal
    { tx_date: "2026-09-12", merchant_raw: "   ", amount: 90, currency: "MXN" },            // sin comercio
    { tx_date: "2026-09-12", merchant_raw: "AMAZON", amount: "mucho", currency: "MXN" },    // monto no numérico
    { tx_date: "2026-09-12", merchant_raw: "CFE", amount: 400, currency: "MXN" },           // bueno
  ],
  unreadable_rows: 0,
}), "MXN");

check("solo sobrevive el renglón bueno", sucio?.movimientos.length === 1, `obtenido: ${sucio?.movimientos.length}`);
check("el bueno es CFE", sucio?.movimientos[0].merchant_raw === "CFE");
check("los 5 descartados se cuentan como ilegibles", sucio?.unreadable_rows === 5, `obtenido: ${sucio?.unreadable_rows}`);

// ── Rubro inválido no se inventa: queda null y lo elige el usuario ──────────
const rubroMalo = parseLectura(JSON.stringify({
  movimientos: [{ tx_date: "2026-09-12", merchant_raw: "X", amount: 10, currency: "MXN", tx_type: "comida", confidence: 5 }],
  unreadable_rows: 0,
}), "MXN");
check("tx_type desconocido queda null", rubroMalo?.movimientos[0].tx_type === null, `obtenido: ${rubroMalo?.movimientos[0].tx_type}`);
check("confidence se acota a 1", rubroMalo?.movimientos[0].confidence === 1, `obtenido: ${rubroMalo?.movimientos[0].confidence}`);

// ── Divisa ausente cae en la pista, no en un default escondido ──────────────
const sinDivisa = parseLectura(JSON.stringify({
  movimientos: [{ tx_date: "2026-09-12", merchant_raw: "HEB", amount: 10, currency: "" }],
  unreadable_rows: 0,
}), "USD");
check("divisa vacía usa la pista de la UI", sinDivisa?.movimientos[0].currency === "USD");

// ── Tope de renglones ──────────────────────────────────────────────────────
const muchos = parseLectura(JSON.stringify({
  movimientos: Array.from({ length: 80 }, (_, i) => ({
    tx_date: "2026-09-12", merchant_raw: `M${i}`, amount: 10 + i, currency: "MXN",
  })),
  unreadable_rows: 0,
}), "MXN");
check("respeta el tope por captura", muchos?.movimientos.length === MAX_ROWS_PER_CAPTURE, `obtenido: ${muchos?.movimientos.length}`);

// ── No es JSON ─────────────────────────────────────────────────────────────
check("texto sin JSON devuelve null", parseLectura("No pude leer la imagen.", "MXN") === null);
check("JSON roto devuelve null", parseLectura('{"movimientos":[', "MXN") === null);

// ── Dedup: mismo cargo en dos screenshots = mismo hash ─────────────────────
const h1 = await dedupeHash("2026-09-12", 18.48, "USD", merchantKey("WHATABURGER #1042 HOUSTON TX"));
const h2 = await dedupeHash("2026-09-12", 18.48, "USD", merchantKey("WHATABURGER #1042 KATY TX"));
const h3 = await dedupeHash("2026-09-12", 18.49, "USD", merchantKey("WHATABURGER #1042 HOUSTON TX"));
const h4 = await dedupeHash("2026-09-13", 18.48, "USD", merchantKey("WHATABURGER #1042 HOUSTON TX"));
check("mismo cargo, mismo hash pese a otra sucursal", h1 === h2);
check("un centavo de diferencia cambia el hash", h1 !== h3);
check("otro día cambia el hash", h1 !== h4);

console.log(fallas === 0 ? "OK — parseo y dedup" : `${fallas} fallas`);
process.exit(fallas === 0 ? 0 : 1);
