"use client";

// Pestaña "Resumen" del panel RMZ — inteligencia de negocio para el dueño.
// Todo se calcula en el cliente a partir de los pedidos ya cargados por page.tsx.

import React, { useMemo, useState } from "react";
import { StatGrid, StatCard as DStatCard, Empty as DEmpty, type DashTheme } from "@/components/dashboard";

// ─── Tipos (estructuralmente compatibles con los de page.tsx) ─────────────────
export type ROrder = {
  id: string;
  order_no: number;
  customer_name: string;
  customer_phone: string;
  total: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
};
export type ROrderItem = {
  order_id: string;
  product_name: string;
  color_name: string | null;
  color_hex?: string | null;
  unit_price: number;
  qty: number;
  line_total: number;
};
export type RProduct = { id: string; category: string; name: string; price: number; active: boolean };

type Period = "30d" | "90d" | "12m";

const PERIOD_LABEL: Record<Period, string> = {
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  "12m": "Últimos 12 meses",
};
const PERIOD_DAYS: Record<Period, number> = { "30d": 30, "90d": 90, "12m": 365 };

const money = (n: number) => "$" + Math.round(Number(n)).toLocaleString("es-MX");
const pct = (n: number) => (n * 100).toFixed(0) + "%";
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// ─── Piezas visuales (a nivel módulo, nunca dentro del render) ────────────────
function Card({ title, hint, theme: t, children }: {
  title: string; hint?: string; theme: DashTheme; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16,
      padding: "16px 18px 18px",
    }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: t.text, marginBottom: hint ? 2 : 12 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: t.muted, marginBottom: 12 }}>{hint}</div>}
      {children}
    </div>
  );
}

function BarRow({ label, sub, value, max, display, color, swatch, theme: t }: {
  label: string; sub?: string; value: number; max: number; display: string;
  color: string; swatch?: string | null; theme: DashTheme;
}) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13.5, marginBottom: 4 }}>
        {swatch && (
          <span style={{
            width: 12, height: 12, borderRadius: 3, background: swatch,
            border: `1px solid ${t.border}`, flexShrink: 0, alignSelf: "center",
          }} />
        )}
        <span style={{ fontWeight: 600, color: t.text }}>{label}</span>
        {sub && <span style={{ color: t.muted, fontSize: 12 }}>{sub}</span>}
        <span style={{ marginLeft: "auto", fontWeight: 800, color: t.text, whiteSpace: "nowrap" }}>{display}</span>
      </div>
      <div style={{ height: 7, background: t.panel ?? "#eee", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 99 }} />
      </div>
    </div>
  );
}

function Delta({ v, theme: t }: { v: number | null; theme: DashTheme }) {
  if (v === null || !isFinite(v)) return <span style={{ color: t.muted }}>sin comparativo</span>;
  const up = v >= 0;
  return (
    <span style={{ color: up ? "#1E5E44" : "#B3261E", fontWeight: 700 }}>
      {up ? "▲" : "▼"} {Math.abs(v * 100).toFixed(0)}% vs periodo anterior
    </span>
  );
}

function Reco({ icon, title, body, tone, theme: t }: {
  icon: string; title: string; body: string; tone: "alert" | "ok" | "info"; theme: DashTheme;
}) {
  const bg = tone === "alert" ? "#FFF6E5" : tone === "ok" ? "#EDF8F2" : t.panel ?? "#F5F5F5";
  const bd = tone === "alert" ? "#EFD9A8" : tone === "ok" ? "#C8E6D5" : t.border;
  return (
    <div style={{
      background: bg, border: `1px solid ${bd}`, borderRadius: 12,
      padding: "12px 14px", display: "flex", gap: 11, alignItems: "flex-start",
    }}>
      <span style={{ fontSize: 18, lineHeight: 1.2 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: t.text, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: t.text, opacity: 0.85, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Resumen({ orders, items, products, theme: t, accent, accentDark }: {
  orders: ROrder[];
  items: Record<string, ROrderItem[]>;
  products: RProduct[];
  theme: DashTheme;
  accent: string;
  accentDark: string;
}) {
  const [period, setPeriod] = useState<Period>("90d");
  const [rank, setRank] = useState<"ingreso" | "unidades">("ingreso");

  const d = useMemo(() => {
    const now = Date.now();
    const days = PERIOD_DAYS[period];
    const from = now - days * 864e5;
    const prevFrom = now - 2 * days * 864e5;

    const paid = orders.filter((o) => o.payment_status === "paid");
    const inWin = paid.filter((o) => +new Date(o.created_at) >= from);
    const inPrev = paid.filter((o) => {
      const ts = +new Date(o.created_at);
      return ts >= prevFrom && ts < from;
    });

    const sum = (os: ROrder[]) => os.reduce((s, o) => s + Number(o.total), 0);
    const units = (os: ROrder[]) =>
      os.reduce((s, o) => s + (items[o.id] ?? []).reduce((a, i) => a + i.qty, 0), 0);

    const rev = sum(inWin), revPrev = sum(inPrev);
    const cnt = inWin.length, cntPrev = inPrev.length;
    const tk = cnt ? rev / cnt : 0, tkPrev = cntPrev ? revPrev / cntPrev : 0;
    const un = units(inWin), unPrev = units(inPrev);
    const delta = (a: number, b: number) => (b > 0 ? (a - b) / b : null);

    // ── Productos (ventana actual) ──
    const byProd = new Map<string, { u: number; r: number; last: number }>();
    const byCat = new Map<string, number>();
    const byColor = new Map<string, { u: number; hex: string | null }>();
    const catOf = new Map(products.map((p) => [p.name, p.category]));

    for (const o of inWin) {
      for (const it of items[o.id] ?? []) {
        const p = byProd.get(it.product_name) ?? { u: 0, r: 0, last: 0 };
        p.u += it.qty; p.r += Number(it.line_total);
        byProd.set(it.product_name, p);
        const c = catOf.get(it.product_name) ?? "Otros";
        byCat.set(c, (byCat.get(c) ?? 0) + Number(it.line_total));
        if (it.color_name) {
          const cc = byColor.get(it.color_name) ?? { u: 0, hex: it.color_hex ?? null };
          cc.u += it.qty; byColor.set(it.color_name, cc);
        }
      }
    }
    // última venta histórica (no solo la ventana) para detectar productos muertos
    const lastSale = new Map<string, number>();
    for (const o of paid) {
      const ts = +new Date(o.created_at);
      for (const it of items[o.id] ?? []) {
        if (ts > (lastSale.get(it.product_name) ?? 0)) lastSale.set(it.product_name, ts);
      }
    }

    const prodRows = [...byProd.entries()]
      .map(([name, v]) => ({ name, ...v, cat: catOf.get(name) ?? "" }))
      .sort((a, b) => (rank === "ingreso" ? b.r - a.r : b.u - a.u));
    const catRows = [...byCat.entries()].map(([name, r]) => ({ name, r })).sort((a, b) => b.r - a.r);
    const colorRows = [...byColor.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.u - a.u);
    const totalColorU = colorRows.reduce((s, c) => s + c.u, 0);

    // ── Tendencia 12 meses (siempre, independiente del selector) ──
    const trend: { key: string; label: string; rev: number; cnt: number }[] = [];
    const base = new Date();
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
      trend.push({
        key: `${dt.getFullYear()}-${dt.getMonth()}`,
        label: MES[dt.getMonth()] + (dt.getMonth() === 0 || i === 11 ? ` ${String(dt.getFullYear()).slice(2)}` : ""),
        rev: 0, cnt: 0,
      });
    }
    const tIdx = new Map(trend.map((x, i) => [x.key, i]));
    for (const o of paid) {
      const dt = new Date(o.created_at);
      const i = tIdx.get(`${dt.getFullYear()}-${dt.getMonth()}`);
      if (i !== undefined) { trend[i].rev += Number(o.total); trend[i].cnt++; }
    }
    const trendMax = Math.max(1, ...trend.map((x) => x.rev));
    const bestMonth = trend.reduce((a, b) => (b.rev > a.rev ? b : a), trend[0]);

    // ── Métodos de pago y fuga de SPEI (12 meses) ──
    const yearAgo = now - 365 * 864e5;
    const recent = orders.filter((o) => +new Date(o.created_at) >= yearAgo);
    const payRows = ["stripe", "mercadopago", "transferencia"].map((m) => {
      const all = recent.filter((o) => o.payment_method === m);
      const ok = all.filter((o) => o.payment_status === "paid");
      return {
        m,
        label: m === "stripe" ? "Tarjeta / OXXO" : m === "mercadopago" ? "Mercado Pago" : "Transferencia SPEI",
        cnt: ok.length,
        rev: ok.reduce((s, o) => s + Number(o.total), 0),
        conv: all.length ? ok.length / all.length : 1,
        lost: all.filter((o) => o.payment_status !== "paid").reduce((s, o) => s + Number(o.total), 0),
      };
    }).filter((r) => r.cnt > 0 || r.lost > 0);
    const payRevTotal = payRows.reduce((s, r) => s + r.rev, 0);
    const spei = payRows.find((r) => r.m === "transferencia");

    // ── Depósitos pendientes ──
    const pending = orders
      .filter((o) => o.payment_status === "pending")
      .map((o) => ({ ...o, age: Math.floor((now - +new Date(o.created_at)) / 864e5) }))
      .sort((a, b) => b.age - a.age);
    const pendingAmt = pending.reduce((s, o) => s + Number(o.total), 0);
    const stale = pending.filter((o) => o.age > 7);

    // ── Clientes (12 meses) ──
    const byCust = new Map<string, { name: string; n: number; rev: number }>();
    for (const o of paid) {
      if (+new Date(o.created_at) < yearAgo) continue;
      const k = o.customer_phone || o.customer_name;
      const c = byCust.get(k) ?? { name: o.customer_name, n: 0, rev: 0 };
      c.n++; c.rev += Number(o.total);
      byCust.set(k, c);
    }
    const custs = [...byCust.values()];
    const repeat = custs.filter((c) => c.n > 1);
    const repeatRev = repeat.reduce((s, c) => s + c.rev, 0);
    const custRev = custs.reduce((s, c) => s + c.rev, 0);
    const topCust = [...custs].sort((a, b) => b.rev - a.rev).slice(0, 5);

    // ── Multi-pieza ──
    const yearPaid = paid.filter((o) => +new Date(o.created_at) >= yearAgo);
    const multi = yearPaid.filter(
      (o) => (items[o.id] ?? []).reduce((s, i) => s + i.qty, 0) > 1
    ).length;
    const multiRate = yearPaid.length ? multi / yearPaid.length : 0;

    // ── Producto sin movimiento ──
    const dead = products
      .filter((p) => p.active)
      .map((p) => ({ name: p.name, days: Math.floor((now - (lastSale.get(p.name) ?? 0)) / 864e5), last: lastSale.get(p.name) }))
      .filter((p) => p.last && p.days > 60)
      .sort((a, b) => b.days - a.days);

    return {
      rev, cnt, tk, un,
      dRev: delta(rev, revPrev), dCnt: delta(cnt, cntPrev), dTk: delta(tk, tkPrev), dUn: delta(un, unPrev),
      prodRows, catRows, colorRows, totalColorU,
      trend, trendMax, bestMonth,
      payRows, payRevTotal, spei,
      pending, pendingAmt, stale,
      custs, repeat, repeatRev, custRev, topCust,
      multiRate, dead, yearPaid,
    };
  }, [orders, items, products, period, rank]);

  if (!orders.length) return <DEmpty theme={t} msg="Aún no hay pedidos que analizar." />;

  const prodMax = Math.max(1, ...d.prodRows.map((p) => (rank === "ingreso" ? p.r : p.u)));
  const catMax = Math.max(1, ...d.catRows.map((c) => c.r));
  const colorMax = Math.max(1, ...d.colorRows.map((c) => c.u));
  const payMax = Math.max(1, ...d.payRows.map((p) => p.rev));

  const topProd = d.prodRows[0];
  const topRevProd = [...d.prodRows].sort((a, b) => b.r - a.r)[0];
  const topUnitProd = [...d.prodRows].sort((a, b) => b.u - a.u)[0];
  const topColor = d.colorRows[0];

  // ── Recomendaciones por reglas ──
  const recos: { icon: string; title: string; body: string; tone: "alert" | "ok" | "info" }[] = [];

  if (d.pending.length) {
    recos.push({
      icon: "🏦", tone: "alert",
      title: `${d.pending.length} depósito${d.pending.length > 1 ? "s" : ""} sin confirmar por ${money(d.pendingAmt)}`,
      body: d.stale.length
        ? `El pedido RMZ-${d.stale[0].order_no} lleva ${d.stale[0].age} días esperando. Después de una semana casi nunca llegan: dale seguimiento por WhatsApp hoy o márcalo cancelado para que no ensucie tus números.`
        : "Revisa tu cuenta y confírmalos desde la pestaña Pedidos para que entren a fabricación.",
    });
  }
  if (d.spei && d.spei.conv < 0.9 && d.spei.lost > 0) {
    recos.push({
      icon: "💳", tone: "alert",
      title: `${pct(1 - d.spei.conv)} de los pedidos por transferencia nunca se pagan`,
      body: `Son ${money(d.spei.lost)} en 12 meses que se quedaron en el camino. La tarjeta te cobra al instante: poner "Pagar con tarjeta" como opción principal en la tienda recupera buena parte de eso.`,
    });
  }
  if (topColor && d.totalColorU > 0) {
    recos.push({
      icon: "🎨", tone: "info",
      title: `${topColor.name} es el acabado que más te piden — ${pct(topColor.u / d.totalColorU)} de las piezas`,
      body: `Compra melamina ${topColor.name.toLowerCase()} por volumen y tenla siempre en piso: es el acabado que menos riesgo tiene de quedarse parado.${
        d.colorRows.length > 2 ? ` En el otro extremo, ${d.colorRows[d.colorRows.length - 1].name} apenas suma ${d.colorRows[d.colorRows.length - 1].u} pieza(s) — quizá no vale la pena mantenerlo.` : ""
      }`,
    });
  }
  if (topRevProd && topUnitProd && topRevProd.name !== topUnitProd.name) {
    recos.push({
      icon: "⭐", tone: "ok",
      title: `Tu producto estrella no es el que más vendes`,
      body: `"${topUnitProd.name}" es el que más piezas mueve (${topUnitProd.u}), pero "${topRevProd.name}" es el que más dinero deja (${money(topRevProd.r)}, ${pct(topRevProd.r / Math.max(1, d.rev))} del ingreso). Empújalo en las fotos y en la portada de la tienda.`,
    });
  }
  if (d.dead.length) {
    recos.push({
      icon: "🕸️", tone: "alert",
      title: `"${d.dead[0].name}" no vende desde hace ${d.dead[0].days} días`,
      body: `O le falta una mejor foto y descripción, o el precio está fuera de mercado. Prueba bajarlo un escalón o pausarlo desde el Catálogo para que no distraiga de lo que sí vende.`,
    });
  }
  if (d.multiRate < 0.5 && d.yearPaid.length > 5) {
    recos.push({
      icon: "🧺", tone: "info",
      title: `Solo ${pct(d.multiRate)} de los pedidos lleva más de una pieza`,
      body: `Ahí está la palanca más barata para subir el ticket (hoy ${money(d.tk)}). Arma un paquete —por ejemplo ${topUnitProd?.name ?? "el buró"} + un set de repisas— con un descuento chico: vendes dos piezas con el mismo envío y el mismo cliente.`,
    });
  }
  if (d.bestMonth && d.bestMonth.rev > 0) {
    const share = d.bestMonth.rev / Math.max(1, d.trend.reduce((s, x) => s + x.rev, 0));
    recos.push({
      icon: "📅", tone: "info",
      title: `${d.bestMonth.label} fue tu mejor mes — ${pct(share)} del año`,
      body: `Tus picos son de temporada. Empieza a producir inventario con 4 a 6 semanas de anticipación y no dejes que los tiempos de fabricación te tumben pedidos justo cuando más te buscan.`,
    });
  }
  if (d.repeat.length) {
    recos.push({
      icon: "🔁", tone: "ok",
      title: `${d.repeat.length} clientes ya te compraron más de una vez`,
      body: `Representan ${pct(d.repeatRev / Math.max(1, d.custRev))} de tu ingreso. Son los más baratos de volver a vender: un mensaje con el producto complementario al que ya compraron suele convertir mejor que cualquier anuncio.`,
    });
  }

  const tabBtn = (id: Period | "ingreso" | "unidades", active: boolean, onClick: () => void, label: string) => (
    <button key={id} onClick={onClick} style={{
      background: active ? accent : t.surface,
      color: active ? "#fff" : t.muted,
      border: `1px solid ${active ? accent : t.border}`,
      borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 700,
      cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
    }}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Selector de periodo */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: t.muted, fontWeight: 600 }}>Periodo:</span>
        {(["30d", "90d", "12m"] as Period[]).map((p) =>
          tabBtn(p, period === p, () => setPeriod(p), PERIOD_LABEL[p])
        )}
      </div>

      <StatGrid>
        <DStatCard theme={t} icon="💰" label="Ventas cobradas" value={money(d.rev)} accent={accent} />
        <DStatCard theme={t} icon="🛒" label="Pedidos pagados" value={String(d.cnt)} />
        <DStatCard theme={t} icon="🎫" label="Ticket promedio" value={money(d.tk)} />
        <DStatCard theme={t} icon="📦" label="Piezas vendidas" value={String(d.un)} />
      </StatGrid>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: 12.5, marginTop: -8 }}>
        <span style={{ color: t.muted }}>Ventas: <Delta v={d.dRev} theme={t} /></span>
        <span style={{ color: t.muted }}>Pedidos: <Delta v={d.dCnt} theme={t} /></span>
        <span style={{ color: t.muted }}>Ticket: <Delta v={d.dTk} theme={t} /></span>
      </div>

      {/* Recomendaciones */}
      {recos.length > 0 && (
        <Card theme={t} title="Qué haría yo esta semana"
          hint="Sugerencias calculadas con tus propias ventas, se actualizan solas.">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recos.map((r, i) => <Reco key={i} {...r} theme={t} />)}
          </div>
        </Card>
      )}

      {/* Tendencia 12 meses */}
      <Card theme={t} title="Cómo has vendido mes a mes" hint="Últimos 12 meses, solo pedidos cobrados.">
        <div style={{
          display: "flex", alignItems: "flex-end", gap: "clamp(4px, 1.2vw, 12px)",
          height: 160, marginBottom: 8,
        }}>
          {d.trend.map((m) => {
            const h = Math.max(3, (m.rev / d.trendMax) * 100);
            const best = m.rev === d.trendMax && m.rev > 0;
            return (
              <div key={m.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                <div style={{ fontSize: 10, color: t.muted, marginBottom: 3, whiteSpace: "nowrap" }}>
                  {m.rev > 0 ? Math.round(m.rev / 1000) + "k" : ""}
                </div>
                <div title={`${m.label}: ${money(m.rev)} · ${m.cnt} pedidos`} style={{
                  width: "100%", height: `${h}%`, background: best ? accent : t.panel ?? "#eee",
                  border: `1px solid ${best ? accent : t.border}`,
                  borderRadius: "6px 6px 3px 3px", minHeight: 4,
                }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: "clamp(4px, 1.2vw, 12px)" }}>
          {d.trend.map((m) => (
            <div key={m.key} style={{ flex: 1, textAlign: "center", fontSize: 10.5, color: t.muted, whiteSpace: "nowrap" }}>
              {m.label}
            </div>
          ))}
        </div>
      </Card>

      {/* Productos + Categorías */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Card theme={t} title="Qué se vende más" hint={PERIOD_LABEL[period]}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {tabBtn("ingreso", rank === "ingreso", () => setRank("ingreso"), "Por dinero")}
            {tabBtn("unidades", rank === "unidades", () => setRank("unidades"), "Por piezas")}
          </div>
          {!d.prodRows.length && <DEmpty theme={t} msg="Sin ventas en este periodo." />}
          {d.prodRows.slice(0, 8).map((p) => (
            <BarRow key={p.name} theme={t} label={p.name} sub={p.cat}
              value={rank === "ingreso" ? p.r : p.u} max={prodMax} color={accent}
              display={rank === "ingreso" ? money(p.r) : `${p.u} pz`} />
          ))}
        </Card>

        <Card theme={t} title="Ingreso por categoría" hint={PERIOD_LABEL[period]}>
          {!d.catRows.length && <DEmpty theme={t} msg="Sin ventas en este periodo." />}
          {d.catRows.map((c) => (
            <BarRow key={c.name} theme={t} label={c.name} value={c.r} max={catMax} color={accentDark}
              display={money(c.r)} sub={pct(c.r / Math.max(1, d.rev))} />
          ))}
        </Card>
      </div>

      {/* Colores + Pagos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Card theme={t} title="Acabado más pedido"
          hint="Con esto decides qué melamina comprar por volumen.">
          {!d.colorRows.length && <DEmpty theme={t} msg="Sin ventas en este periodo." />}
          {d.colorRows.map((c) => (
            <BarRow key={c.name} theme={t} label={c.name} swatch={c.hex ?? undefined}
              value={c.u} max={colorMax} color={c.hex ?? accent}
              display={`${c.u} pz`} sub={pct(c.u / Math.max(1, d.totalColorU))} />
          ))}
        </Card>

        <Card theme={t} title="Cómo te pagan" hint="Últimos 12 meses. La conversión es cuántos de esos pedidos sí se cobraron.">
          {d.payRows.map((p) => (
            <BarRow key={p.m} theme={t} label={p.label} value={p.rev} max={payMax} color={accentDark}
              display={money(p.rev)}
              sub={`${p.cnt} pedidos · ${pct(p.conv)} cobrados`} />
          ))}
          {d.spei && d.spei.lost > 0 && (
            <div style={{ fontSize: 12.5, color: "#B3261E", marginTop: 10, fontWeight: 600 }}>
              ⚠️ {money(d.spei.lost)} en pedidos por transferencia que nunca se pagaron.
            </div>
          )}
        </Card>
      </div>

      {/* Clientes */}
      <Card theme={t} title="Tus clientes" hint="Últimos 12 meses.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
          <DStatCard theme={t} soft label="Clientes distintos" value={String(d.custs.length)} />
          <DStatCard theme={t} soft label="Compraron 2+ veces" value={String(d.repeat.length)} />
          <DStatCard theme={t} soft label="Ingreso de recurrentes"
            value={pct(d.repeatRev / Math.max(1, d.custRev))} accent={accentDark} />
        </div>
        <div style={{ fontSize: 12.5, color: t.muted, fontWeight: 700, marginBottom: 8 }}>
          LOS QUE MÁS TE HAN COMPRADO
        </div>
        {d.topCust.map((c) => (
          <BarRow key={c.name + c.rev} theme={t} label={c.name} value={c.rev}
            max={Math.max(1, d.topCust[0]?.rev ?? 1)} color={accent}
            display={money(c.rev)} sub={`${c.n} pedido${c.n > 1 ? "s" : ""}`} />
        ))}
      </Card>
    </div>
  );
}
