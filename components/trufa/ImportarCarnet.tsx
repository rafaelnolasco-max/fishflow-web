"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reducirImagen, subirFoto } from "@/lib/trufaFotos";
import type { CarnetLeido, Confianza } from "@/lib/importarCarnet";

// ─── Trufa — importar el carnet de papel ──────────────────────────────────────
// Tres pasos: elegir fotos → leerlas → REVISAR y guardar.
//
// El tercero no es un trámite. Lo que devuelve el modelo es un borrador sobre
// letra manuscrita y etiquetas arrugadas; si se guardara solo, un lote o una
// fecha mal leídos se quedarían en el historial médico del animal sin que nadie
// los vuelva a cuestionar. Por eso cada renglón se puede corregir y desmarcar,
// y lo que el modelo leyó con poca confianza llega DESMARCADO: para que entre
// al carnet hay que decir que sí, no dejar de decir que no.

const MAX_FOTOS = 8;
const LADO_IA = 1400; // suficiente para leer letra manuscrita sin reventar el cuerpo del POST

type Tema = { accent: string; surface: string; border: string; text: string; muted: string; danger: string; panel?: string };
type Paso = "elegir" | "leyendo" | "revisar" | "guardando";

type Fila = { incluir: boolean; confianza: Confianza; fecha: string; titulo: string; detalle: string; datos: Record<string, unknown> };

const COLOR_CONF: Record<Confianza, string> = { alta: "#5F8A6A", media: "#E0A33E", baja: "#C2552E" };

async function aBase64(file: File): Promise<{ media_type: string; data: string }> {
  // Se reescala aparte de la copia que se guarda en el álbum: al modelo le
  // sirve chico y liviano, al carnet le sirve la foto completa.
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, LADO_IA / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  return { media_type: "image/jpeg", data: dataUrl.split(",")[1] };
}

export default function ImportarCarnet({
  petId, clientId, onCerrar, onListo, theme: t,
}: {
  petId: string; clientId: string;
  onCerrar: () => void; onListo: () => Promise<void> | void; theme: Tema;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [paso, setPaso] = useState<Paso>("elegir");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [carnet, setCarnet] = useState<CarnetLeido | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [guardarFotos, setGuardarFotos] = useState(true);

  function aFilas(c: CarnetLeido): Fila[] {
    const out: Fila[] = [];
    for (const v of c.vacunas) out.push({
      incluir: v.confianza !== "baja", confianza: v.confianza, fecha: v.applied_on,
      titulo: v.vaccine, detalle: [v.brand, v.lot ? `Lote ${v.lot}` : null].filter(Boolean).join(" · "),
      datos: { tabla: "vet_vaccinations", vaccine: v.vaccine, brand: v.brand, lot: v.lot, next_due_on: v.next_due_on },
    });
    for (const d of c.desparasitaciones) out.push({
      incluir: d.confianza !== "baja", confianza: d.confianza, fecha: d.applied_on,
      titulo: `Desparasitación ${d.kind}`, detalle: d.product,
      datos: { tabla: "vet_dewormings", kind: d.kind, product: d.product, weight_kg: d.weight_kg, next_due_on: d.next_due_on },
    });
    for (const tr of c.tratamientos) out.push({
      incluir: tr.confianza !== "baja", confianza: tr.confianza, fecha: tr.applied_on,
      titulo: tr.product, detalle: [tr.dose, tr.lot ? `Lote ${tr.lot}` : null].filter(Boolean).join(" · "),
      datos: { tabla: "vet_treatments", product: tr.product, dose: tr.dose, lot: tr.lot, weight_kg: tr.weight_kg, next_due_on: tr.next_due_on },
    });
    for (const w of c.pesos) out.push({
      incluir: w.confianza !== "baja", confianza: w.confianza, fecha: w.measured_on,
      titulo: `${w.weight_kg} kg`, detalle: "Peso",
      datos: { tabla: "vet_weights", weight_kg: w.weight_kg },
    });
    for (const p of c.padecimientos) out.push({
      incluir: true, confianza: "media", fecha: p.diagnosed_on ?? "",
      titulo: p.name, detalle: "Padecimiento",
      datos: { tabla: "vet_conditions", name: p.name, notes: p.notes },
    });
    return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  async function leer(files: File[]) {
    setPaso("leyendo"); setError(""); setAviso("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Se cerró tu sesión. Vuelve a entrar.");
      const imagenes = await Promise.all(files.map(aBase64));
      const res = await fetch("/api/trufa/importar-carnet", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ pet_id: petId, imagenes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo leer el carnet.");
      const c = data.carnet as CarnetLeido;
      setCarnet(c);
      setFilas(aFilas(c));
      setPaso("revisar");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el carnet.");
      setPaso("elegir");
    }
  }

  async function guardar() {
    if (!carnet) return;
    setPaso("guardando"); setError("");
    try {
      const elegidas = filas.filter(f => f.incluir && f.fecha);
      const base = { pet_id: petId, client_id: clientId };
      const porTabla: Record<string, Record<string, unknown>[]> = {};

      for (const f of elegidas) {
        const { tabla, ...resto } = f.datos as { tabla: string } & Record<string, unknown>;
        const fechaCampo = tabla === "vet_weights" ? "measured_on"
          : tabla === "vet_conditions" ? "diagnosed_on" : "applied_on";
        (porTabla[tabla] ??= []).push({ ...base, ...resto, [fechaCampo]: f.fecha });
      }

      for (const [tabla, filasT] of Object.entries(porTabla)) {
        const { error: e } = await supabase.from(tabla).insert(filasT);
        if (e) throw new Error(`No se pudo guardar en ${tabla}: ${e.message}`);
      }

      // Los datos de la mascota solo RELLENAN huecos: si ya pusiste la raza a
      // mano, la lectura de una foto torcida no te la pisa.
      const m = carnet.mascota;
      const { data: actual } = await supabase
        .from("vet_pets").select("breed, sex, birth_date, color, microchip").eq("id", petId).maybeSingle();
      if (actual) {
        const parche: Record<string, unknown> = {};
        for (const k of ["breed", "sex", "birth_date", "color", "microchip"] as const) {
          if (!actual[k] && m[k]) parche[k] = m[k];
        }
        if (Object.keys(parche).length) await supabase.from("vet_pets").update(parche).eq("id", petId);
      }

      if (guardarFotos) {
        for (const f of archivos) {
          try { await subirFoto({ file: f, petId, clientId, caption: "Carnet original" }); }
          catch { /* la foto es respaldo, no puede tumbar la importación */ }
        }
      }

      await onListo();
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setPaso("revisar");
    }
  }

  const marcadas = filas.filter(f => f.incluir && f.fecha).length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(31,23,20,.9)", zIndex: 65,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: t.surface, borderRadius: 16, width: "100%", maxWidth: 560,
        maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div style={{ padding: "20px 22px 14px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ font: "800 18px/1.25 'Plus Jakarta Sans', Inter, sans-serif", color: t.text }}>
            {paso === "revisar" ? "Revisa antes de guardar" : "Pasar tu carnet de papel"}
          </div>
          <div style={{ fontSize: 13, color: t.muted, marginTop: 4, lineHeight: 1.5 }}>
            {paso === "revisar"
              ? "Corrige lo que haga falta. Lo que se leyó con dudas viene desmarcado."
              : `Toma o elige hasta ${MAX_FOTOS} fotos de las páginas con registros.`}
          </div>
        </div>

        <div style={{ padding: "18px 22px", overflowY: "auto", flexGrow: 1 }}>
          {paso === "elegir" && (
            <>
              <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => {
                  const fs = Array.from(e.target.files ?? []).slice(0, MAX_FOTOS);
                  if (inputRef.current) inputRef.current.value = "";
                  if (fs.length === 0) return;
                  setArchivos(fs);
                  void leer(fs);
                }} />
              <button onClick={() => inputRef.current?.click()}
                style={{ width: "100%", padding: "28px 0", borderRadius: 12, cursor: "pointer",
                  border: `1px dashed ${t.border}`, background: t.panel ?? t.surface,
                  color: t.accent, font: "700 15px/1 inherit" }}>
                Elegir fotos del carnet
              </button>
              <p style={{ fontSize: 13, color: t.muted, lineHeight: 1.6, marginTop: 14 }}>
                Sirve cualquier libreta. Enfoca las páginas de vacunas, desparasitación y
                revisiones — las etiquetas pegadas se leen bien si la foto no sale movida.
              </p>
            </>
          )}

          {paso === "leyendo" && (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <div style={{ font: "700 15px/1.4 inherit", color: t.text }}>Leyendo el carnet…</div>
              <div style={{ fontSize: 13, color: t.muted, marginTop: 6, lineHeight: 1.55 }}>
                {archivos.length} foto{archivos.length === 1 ? "" : "s"}. Tarda un par de minutos.
              </div>
            </div>
          )}

          {paso === "revisar" && carnet && (
            <>
              {carnet.ilegibles.length > 0 && (
                <div style={{ background: "rgba(224,163,62,.14)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#7A5A1C", marginBottom: 5 }}>
                    Esto no se pudo leer
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 17 }}>
                    {carnet.ilegibles.map((i, k) => (
                      <li key={k} style={{ fontSize: 13, color: "#7A5A1C", lineHeight: 1.5 }}>{i}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filas.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                    padding: "11px 12px", borderRadius: 10,
                    border: `1px solid ${f.incluir ? t.border : "transparent"}`,
                    background: f.incluir ? t.surface : (t.panel ?? "#FBF7F1"),
                    opacity: f.incluir ? 1 : .62 }}>
                    <input type="checkbox" checked={f.incluir} aria-label={`Incluir ${f.titulo}`}
                      onChange={() => setFilas(p => p.map((x, k) => k === i ? { ...x, incluir: !x.incluir } : x))}
                      style={{ marginTop: 3, width: 18, height: 18, accentColor: t.accent, flexShrink: 0 }} />
                    <div style={{ flexGrow: 1, minWidth: 0 }}>
                      <input value={f.titulo}
                        onChange={(e) => setFilas(p => p.map((x, k) => k === i ? { ...x, titulo: e.target.value } : x))}
                        style={{ width: "100%", border: "none", background: "transparent", padding: 0,
                          font: "600 14px/1.35 inherit", color: t.text, outline: "none" }} />
                      <div style={{ fontSize: 12.5, color: t.muted, marginTop: 2 }}>{f.detalle}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      <input type="date" value={f.fecha}
                        onChange={(e) => setFilas(p => p.map((x, k) => k === i ? { ...x, fecha: e.target.value } : x))}
                        style={{ border: `1px solid ${t.border}`, borderRadius: 7, padding: "3px 6px",
                          font: "600 12px/1 inherit", color: t.text, background: t.surface }} />
                      <span style={{ font: "700 10.5px/1 inherit", letterSpacing: ".06em",
                        textTransform: "uppercase", color: COLOR_CONF[f.confianza] }}>
                        {f.confianza}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <label style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 16, cursor: "pointer" }}>
                <input type="checkbox" checked={guardarFotos} onChange={() => setGuardarFotos(v => !v)}
                  style={{ width: 17, height: 17, accentColor: t.accent }} />
                <span style={{ fontSize: 13, color: t.muted, lineHeight: 1.5 }}>
                  Guardar también las fotos del carnet original
                </span>
              </label>
            </>
          )}

          {paso === "guardando" && (
            <div style={{ padding: "32px 0", textAlign: "center", font: "700 15px/1.4 inherit", color: t.text }}>
              Guardando en el carnet…
            </div>
          )}

          {error && (
            <div style={{ fontSize: 13, color: t.danger, lineHeight: 1.55, marginTop: 14 }}>{error}</div>
          )}
          {aviso && (
            <div style={{ fontSize: 13, color: t.muted, lineHeight: 1.55, marginTop: 14 }}>{aviso}</div>
          )}
        </div>

        <div style={{ padding: "14px 22px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10 }}>
          <button onClick={onCerrar} disabled={paso === "guardando"}
            style={{ padding: "11px 18px", borderRadius: 9, border: `1px solid ${t.border}`,
              background: "transparent", color: t.muted, font: "600 14px/1 inherit", cursor: "pointer" }}>
            Cancelar
          </button>
          {paso === "revisar" && (
            <button onClick={guardar} disabled={marcadas === 0}
              style={{ flexGrow: 1, padding: "11px 0", borderRadius: 9, border: "none",
                background: marcadas === 0 ? t.muted : t.accent, color: "#FFF4EC",
                font: "800 14px/1 inherit", cursor: marcadas === 0 ? "default" : "pointer" }}>
              Guardar {marcadas} registro{marcadas === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
