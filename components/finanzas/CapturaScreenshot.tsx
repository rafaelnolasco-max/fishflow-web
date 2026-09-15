"use client";

import React, { useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { DashTheme } from "@/components/dashboard";

// ─── Finanzas — captura de gastos por screenshot ──────────────────────────────
// Reemplaza teclear cada consumo: una foto de los movimientos del día y la app
// los propone clasificados. El usuario solo confirma o corrige.
//
// Nota sobre el input: NO lleva `capture`. Ese atributo fuerza la cámara, y un
// screenshot vive en el carrete, no en el lente.

type TxType = "ingreso" | "fijo" | "placer" | "futuro" | "extraordinario";

interface Meta { label: string; icon: string; color: string }

export interface Borrador {
  id: string;
  tx_date: string;
  merchant_raw: string;
  merchant_key: string;
  concept: string;
  amount_original: number;
  currency: string;
  amount: number | null;
  fx_rate_used: number | null;
  tx_type: TxType | null;
  category: string | null;
  confidence: number | null;
  rule_hit: boolean;
  txn_state: "authorized" | "posted";
  /** Tarjetahabiente adicional que hizo el cargo. null = tú. */
  cardholder: string | null;
  status: "pending" | "confirmed" | "discarded" | "duplicate";
}

interface Props {
  clientId: string;
  theme: DashTheme;
  txMeta: Record<TxType, Meta>;
  /** Rubros que se ofrecen como chips. "ingreso" no aplica a cargos de tarjeta. */
  rubros: TxType[];
  extraCats: string[];
  onToast: (msg: string) => void;
  /** Para que el tablero recargue después de confirmar. */
  onSaved: () => void;
}

const LOW_CONFIDENCE = 0.75;

/** Tope de imágenes por tanda. Cada una es un llamado de visión que se paga. */
const MAX_IMAGENES = 8;

// Topes del cliente. Van POR ENCIMA del timeout del SDK en la ruta (90 s) para
// que el servidor tenga chance de contestar un error de verdad antes de que el
// navegador corte, y por debajo del maxDuration (120 s).
const LECTURA_TIMEOUT_MS = 110_000;
const CONFIRMA_TIMEOUT_MS = 30_000;

/**
 * Sin AbortController, un mal rato del modelo deja el botón en "Leyendo…" para
 * siempre y el usuario no distingue entre "sigue trabajando" y "ya se murió".
 * Y se lee con text() + JSON.parse porque cuando la plataforma devuelve una
 * página de error en HTML, res.json() truena con un error de parseo que no le
 * dice nada a nadie.
 */
async function postJson<T>(
  url: string, init: RequestInit, ms: number,
): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const texto = await res.text();
    let data: T | null = null;
    try { data = JSON.parse(texto) as T; } catch { /* vino HTML, no JSON */ }

    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error;
      return { ok: false, data, error: msg ?? `El servidor respondió ${res.status}` };
    }
    if (!data) return { ok: false, data: null, error: "La respuesta del servidor no vino en el formato esperado" };
    return { ok: true, data };
  } catch (e) {
    const cortado = e instanceof DOMException && e.name === "AbortError";
    return {
      ok: false, data: null,
      error: cortado
        ? "La lectura tardó demasiado. Intenta con una captura más corta o menos renglones."
        : "No hubo conexión con el servidor.",
    };
  } finally {
    clearTimeout(reloj);
  }
}

const fmtMxn = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;
const fmtDiv = (n: number, div: string) =>
  `${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${div}`;

export default function CapturaScreenshot({
  clientId, theme: T, txMeta, rubros, extraCats, onToast, onSaved,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fase, setFase] = useState<"idle" | "subiendo" | "revisando">("idle");
  const [monedaHint, setMonedaHint] = useState("MXN");
  const [fx, setFx] = useState<string>("");

  const [captureIds, setCaptureIds] = useState<string[]>([]);
  const [progreso, setProgreso] = useState<{ actual: number; total: number } | null>(null);
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [descartados, setDescartados] = useState<Set<string>>(new Set());
  const [resumen, setResumen] = useState({ duplicados: 0, ilegibles: 0, last4: "" as string | null, fx: 0 });
  const [guardando, setGuardando] = useState(false);

  const hayDivisaExtranjera = useMemo(
    () => borradores.some(b => b.currency !== "MXN"),
    [borradores],
  );

  /** Rubros faltantes bloquean el guardado: un gasto sin rubro rompe el tablero. */
  const faltanRubro = useMemo(
    () => borradores.filter(b => !descartados.has(b.id) && !b.tx_type).length,
    [borradores, descartados],
  );
  const aGuardar = borradores.filter(b => !descartados.has(b.id)).length;

  /**
   * Cargos hechos con una tarjeta adicional. NO se descartan solos: los paga el
   * titular igual, y excluirlos por sistema subestimaría el gasto del mes. Se
   * marcan, y aquí hay un atajo para sacarlos todos de un tap si así se decide.
   */
  const adicionales = useMemo(
    () => borradores.filter(b => b.cardholder),
    [borradores],
  );
  const adicionalesFuera = adicionales.length > 0 && adicionales.every(b => descartados.has(b.id));

  function alternarAdicionales() {
    setDescartados(s => {
      const n = new Set(s);
      if (adicionalesFuera) adicionales.forEach(b => n.delete(b.id));
      else adicionales.forEach(b => n.add(b.id));
      return n;
    });
  }

  async function bearer(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  /**
   * Varias capturas en una sola pasada. Se procesan EN SERIE, no en paralelo,
   * por dos razones: cada una es un llamado de visión (en paralelo se topa con
   * el rate limit), y sobre todo porque la deduplicación depende del orden —
   * los borradores de la primera imagen ya están en la base cuando se lee la
   * segunda, así que el traslape entre capturas se detecta solo.
   */
  async function subirVarias(files: File[]) {
    const token = await bearer();
    if (!token) { onToast("Tu sesión expiró — vuelve a entrar"); return; }

    setFase("subiendo");
    const acumulados: Borrador[] = [];
    const ids: string[] = [];
    const fallos: string[] = [];
    let dup = 0, ileg = 0, tasa = 0;
    let last4: string | null = null;

    try {
      for (let i = 0; i < files.length; i++) {
        setProgreso({ actual: i + 1, total: files.length });

        const fd = new FormData();
        fd.append("archivo", files[i]);
        fd.append("client_id", clientId);
        fd.append("currency_hint", monedaHint);
        if (Number(fx) > 0) fd.append("fx_rate", fx);

        const r = await postJson<{
          capture_id?: string; borradores?: Borrador[];
          duplicados?: number; ilegibles?: number; card_last4?: string | null; fx_rate?: number;
        }>("/api/finanzas/captura", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: fd,
        }, LECTURA_TIMEOUT_MS);

        // Una imagen que falla no tumba las demás: se anota y se sigue.
        if (!r.ok || !r.data) { fallos.push(r.error ?? "no se pudo leer"); continue; }
        const j = r.data;

        if (j.capture_id) ids.push(j.capture_id);
        acumulados.push(...(j.borradores ?? []).filter(b => b.status === "pending"));
        dup  += j.duplicados ?? 0;
        ileg += j.ilegibles ?? 0;
        if (!last4 && j.card_last4) last4 = j.card_last4;
        if (j.fx_rate) tasa = j.fx_rate;
      }
    } catch (e) {
      console.error("[captura] subir:", e);
      onToast("Error al subir las imágenes");
      setFase("idle"); setProgreso(null);
      return;
    }

    setProgreso(null);
    setCaptureIds(ids);
    setBorradores(acumulados);
    setDescartados(new Set());
    setResumen({ duplicados: dup, ilegibles: ileg, last4, fx: tasa });
    if (tasa && !fx) setFx(String(tasa));

    if (acumulados.length === 0) {
      onToast(
        fallos.length === files.length ? (fallos[0] ?? "No pude leer las capturas")
        : dup > 0 ? "Todos esos cargos ya estaban registrados"
        : "No encontré cargos nuevos en esas imágenes",
      );
      setFase("idle");
      return;
    }
    if (fallos.length > 0) onToast(`${fallos.length} de ${files.length} no se pudieron leer`);
    setFase("revisando");
  }

  /** El tipo de cambio se aplica en vivo sobre los renglones en divisa. */
  function montoMxn(b: Borrador): number {
    if (b.currency === "MXN") return b.amount_original;
    const tasa = Number(fx) > 0 ? Number(fx) : (b.fx_rate_used ?? 0);
    return tasa > 0 ? Math.round(b.amount_original * tasa * 100) / 100 : (b.amount ?? 0);
  }

  function setRubro(id: string, tt: TxType) {
    setBorradores(bs => bs.map(b => (b.id === id ? { ...b, tx_type: tt } : b)));
  }
  function setConcepto(id: string, v: string) {
    setBorradores(bs => bs.map(b => (b.id === id ? { ...b, concept: v } : b)));
  }
  function setCategoria(id: string, v: string) {
    setBorradores(bs => bs.map(b => (b.id === id ? { ...b, category: v } : b)));
  }
  function toggleDescartar(id: string) {
    setDescartados(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function confirmar() {
    if (captureIds.length === 0 || faltanRubro > 0) return;
    const token = await bearer();
    if (!token) { onToast("Tu sesión expiró — vuelve a entrar"); return; }

    setGuardando(true);
    try {
      const movimientos = borradores.map(b => ({
        id: b.id,
        descartar: descartados.has(b.id),
        tx_type: b.tx_type ?? undefined,
        category: b.tx_type === "extraordinario" ? (b.category ?? extraCats[0] ?? "OTRO") : null,
        concept: b.concept,
        amount: montoMxn(b),
        fx_rate: b.currency === "MXN" ? undefined : (Number(fx) > 0 ? Number(fx) : undefined),
      }));

      const r = await postJson<{
        guardados?: number; descartados?: number; duplicados?: number; reglas?: number;
      }>("/api/finanzas/captura/confirmar", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, capture_ids: captureIds, movimientos }),
      }, CONFIRMA_TIMEOUT_MS);

      if (!r.ok || !r.data) { onToast(r.error ?? "No se pudo confirmar"); return; }
      const json = r.data;

      const partes = [`${json.guardados ?? 0} guardados`];
      if (json.duplicados) partes.push(`${json.duplicados} ya estaban`);
      if (json.descartados) partes.push(`${json.descartados} descartados`);
      onToast(partes.join(" · "));

      setFase("idle");
      setBorradores([]);
      setCaptureIds([]);
      onSaved();
    } catch (e) {
      console.error("[captura] confirmar:", e);
      onToast("Error al confirmar");
    } finally {
      setGuardando(false);
    }
  }

  // ── Tarjeta de entrada ────────────────────────────────────────────────────
  const tarjeta = (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
            📸 Subir screenshot del banco
          </div>
          <div style={{ fontSize: 12.5, color: T.muted, marginTop: 4, lineHeight: 1.55, maxWidth: 460 }}>
            Toma las capturas de los movimientos en el app de tu banco y súbelas todas juntas
            — puedes elegir varias. Leo los cargos, los clasifico y tú confirmas una sola vez.
            Los pagos a la tarjeta y las devoluciones se omiten, y si dos capturas traen el mismo
            cargo no se duplica.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: .4 }}>MONEDA DE LOS CARGOS</span>
        {["MXN", "USD"].map(m => (
          <button key={m} onClick={() => setMonedaHint(m)}
            style={{ padding: "6px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              border: `1.5px solid ${monedaHint === m ? T.accent : T.border}`,
              background: monedaHint === m ? T.accentSoft : T.panel,
              color: monedaHint === m ? T.text : T.muted }}>
            {m}
          </button>
        ))}
        {monedaHint !== "MXN" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11.5, color: T.muted }}>tipo de cambio</span>
            <input inputMode="decimal" value={fx} onChange={e => setFx(e.target.value)} placeholder="18.50"
              style={{ width: 78, padding: "6px 9px", borderRadius: 8, border: `1px solid ${T.border}`,
                background: T.bg, color: T.text, fontSize: 13, fontFamily: "inherit" }} />
          </span>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 6 }}>
        Solo es una pista: si la pantalla dice la divisa, mando esa.
      </div>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
        onChange={e => {
          const elegidas = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (elegidas.length === 0) return;
          if (elegidas.length > MAX_IMAGENES) {
            onToast(`Máximo ${MAX_IMAGENES} imágenes por tanda`);
            return;
          }
          void subirVarias(elegidas);
        }} />

      <button onClick={() => fileRef.current?.click()} disabled={fase === "subiendo"}
        style={{ width: "100%", marginTop: 16, padding: "13px 0", borderRadius: 12, border: "none",
          background: fase === "subiendo" ? T.disabled : T.accent, color: "#fff",
          fontSize: 15, fontWeight: 700, cursor: fase === "subiendo" ? "default" : "pointer",
          fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
        {fase === "subiendo"
          ? (progreso && progreso.total > 1
              ? `Leyendo ${progreso.actual} de ${progreso.total}…`
              : "Leyendo la captura…")
          : "Elegir capturas"}
      </button>
      {fase === "subiendo" && (
        <div style={{ fontSize: 12, color: T.muted, textAlign: "center", marginTop: 8 }}>
          Unos segundos por imagen. No cierres la pantalla.
        </div>
      )}
    </div>
  );

  // ── Hoja de revisión ──────────────────────────────────────────────────────
  const hoja = fase === "revisando" && (
    <div style={{ position: "fixed", inset: 0, zIndex: 120, display: "flex", flexDirection: "column",
      justifyContent: "flex-end", background: "rgba(6,13,20,.6)" }}>
      <div style={{ background: T.surface, borderRadius: "18px 18px 0 0", maxWidth: 860, width: "100%",
        margin: "0 auto", height: "min(88vh, 860px)", display: "flex", flexDirection: "column",
        border: `1px solid ${T.border}`, borderBottom: "none" }}>

        {/* Encabezado */}
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
              Revisar {borradores.length} {borradores.length === 1 ? "cargo" : "cargos"}
              {resumen.last4 && <span style={{ color: T.muted, fontWeight: 600 }}> · ••{resumen.last4}</span>}
            </div>
            <button onClick={() => { setFase("idle"); setBorradores([]); setCaptureIds([]); }}
              style={{ background: "none", border: "none", fontSize: 22, color: T.muted, cursor: "pointer" }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4, lineHeight: 1.6 }}>
            {resumen.duplicados > 0 && <span>{resumen.duplicados} ya estaban registrados y se omitieron. </span>}
            {resumen.ilegibles > 0 && <span>{resumen.ilegibles} renglón(es) no pude leerlos — captúralos a mano. </span>}
            {faltanRubro > 0 && (
              <span style={{ color: T.accent, fontWeight: 700 }}>
                Falta elegir rubro en {faltanRubro}.
              </span>
            )}
          </div>
          {adicionales.length > 0 && (
            <button onClick={alternarAdicionales}
              style={{ marginTop: 10, padding: "7px 12px", borderRadius: 9, cursor: "pointer",
                border: `1px solid ${adicionalesFuera ? "#B08CFF" : T.border}`,
                background: adicionalesFuera ? "rgba(176,140,255,.14)" : T.panel,
                color: adicionalesFuera ? "#B08CFF" : T.muted,
                fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", textAlign: "left" }}>
              {adicionalesFuera
                ? `Recuperar ${adicionales.length} de tarjetas adicionales`
                : `Descartar ${adicionales.length} de tarjetas adicionales`}
            </button>
          )}
          {hayDivisaExtranjera && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 11.5, color: T.muted }}>Tipo de cambio aplicado</span>
              <input inputMode="decimal" value={fx} onChange={e => setFx(e.target.value)}
                style={{ width: 84, padding: "5px 9px", borderRadius: 8, border: `1px solid ${T.border}`,
                  background: T.bg, color: T.text, fontSize: 13, fontFamily: "inherit" }} />
              <span style={{ fontSize: 11.5, color: T.muted }}>
                estimado — se corrige cuando el banco aplique el cargo
              </span>
            </div>
          )}
        </div>

        {/* Renglones */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {borradores.map(b => {
            const off = descartados.has(b.id);
            const dudoso = (b.confidence ?? 1) < LOW_CONFIDENCE;
            return (
              <div key={b.id} style={{ background: T.panel, border: `1px solid ${dudoso && !off ? T.accent : T.border}`,
                borderRadius: 13, padding: 13, opacity: off ? .45 : 1 }}>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input value={b.concept} onChange={e => setConcepto(b.id, e.target.value)} disabled={off}
                      style={{ width: "100%", background: "transparent", border: "none", outline: "none",
                        color: T.text, fontSize: 14.5, fontWeight: 700, fontFamily: "inherit", padding: 0 }} />
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 3, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {b.tx_date} · {b.merchant_raw}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                      {fmtMxn(montoMxn(b))}
                    </div>
                    {b.currency !== "MXN" && (
                      <div style={{ fontSize: 11, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                        {fmtDiv(b.amount_original, b.currency)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Señales: por qué este renglón sí o no pide atención */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {b.rule_hit && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: .3, padding: "2px 7px",
                      borderRadius: 5, background: "rgba(103,212,232,.14)", color: "#67D4E8" }}>
                      REGLA TUYA
                    </span>
                  )}
                  {dudoso && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: .3, padding: "2px 7px",
                      borderRadius: 5, background: T.accentSoft, color: T.accent }}>
                      REVISAR
                    </span>
                  )}
                  {b.cardholder && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: .3, padding: "2px 7px",
                      borderRadius: 5, background: "rgba(176,140,255,.16)", color: "#B08CFF" }}>
                      TARJETA DE {b.cardholder.toUpperCase()}
                    </span>
                  )}
                  {b.txn_state === "authorized" && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: .3, padding: "2px 7px",
                      borderRadius: 5, background: "rgba(126,147,168,.16)", color: T.muted }}>
                      PENDIENTE DE APLICAR
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {rubros.map(tt => {
                    const on = b.tx_type === tt;
                    return (
                      <button key={tt} onClick={() => setRubro(b.id, tt)} disabled={off}
                        style={{ padding: "6px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                          cursor: off ? "default" : "pointer",
                          border: `1.5px solid ${on ? txMeta[tt].color : T.border}`,
                          background: on ? txMeta[tt].color : T.surface,
                          color: on ? "#fff" : T.muted }}>
                        {txMeta[tt].icon} {txMeta[tt].label}
                      </button>
                    );
                  })}
                  <button onClick={() => toggleDescartar(b.id)}
                    style={{ marginLeft: "auto", padding: "6px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                      cursor: "pointer", border: `1.5px solid ${off ? T.accent : T.border}`,
                      background: T.surface, color: off ? T.accent : T.muted }}>
                    {off ? "Recuperar" : "No es gasto"}
                  </button>
                </div>

                {b.tx_type === "extraordinario" && !off && extraCats.length > 0 && (
                  <select value={b.category ?? extraCats[0]} onChange={e => setCategoria(b.id, e.target.value)}
                    style={{ marginTop: 9, width: "100%", padding: "8px 10px", borderRadius: 9,
                      border: `1px solid ${T.border}`, background: T.bg, color: T.text,
                      fontSize: 13, fontFamily: "inherit" }}>
                    {extraCats.map(c => <option key={c}>{c}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>

        {/* Pie */}
        <div style={{ padding: 14, borderTop: `1px solid ${T.border}` }}>
          <button onClick={() => void confirmar()} disabled={guardando || faltanRubro > 0 || aGuardar === 0}
            style={{ width: "100%", padding: "13px 0", borderRadius: 12, border: "none",
              background: guardando || faltanRubro > 0 || aGuardar === 0 ? T.disabled : T.accent,
              color: "#fff", fontSize: 15, fontWeight: 700,
              cursor: guardando || faltanRubro > 0 ? "default" : "pointer",
              fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
            {guardando ? "Guardando…"
              : faltanRubro > 0 ? `Elige rubro en ${faltanRubro}`
              : `Guardar ${aGuardar} ${aGuardar === 1 ? "movimiento" : "movimientos"}`}
          </button>
        </div>
      </div>
    </div>
  );

  return <>{tarjeta}{hoja}</>;
}
