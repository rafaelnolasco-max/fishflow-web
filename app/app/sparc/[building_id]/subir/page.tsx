"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import JSZip from "jszip";

const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";
const SPARC_CLIENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

interface Building { id: string; name: string }

function FishFlowMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.52} viewBox="0 0 68 36" fill="none">
      <path d="M34 18 C34 9 25 3 15 6 C6 9 4 19 11 24 C19 30 34 27 34 18Z" stroke={FF_CYAN} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M34 18 C34 9 43 3 53 6 C62 9 64 19 57 24 C49 30 34 27 34 18Z" stroke={FF_ORANGE} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M64 14 L68 10 M64 22 L68 26" stroke={FF_ORANGE} strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function NavBar({ buildingName, buildingId, active }: { buildingName: string; buildingId: string; active: string }) {
  const router = useRouter();
  const tabs = [
    { label: "Dashboard",  path: "dashboard" },
    { label: "Mensajes",   path: "mensajes"  },
    { label: "Subir chat", path: "subir"     },
  ];
  return (
    <div style={{ borderBottom: "1px solid #1e3048", background: "#0D1B2A", padding: "0 32px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 16 }}>
        <FishFlowMark size={24} />
        <button onClick={() => router.push("/app/sparc")} style={{ background: "none", border: "none", color: FF_CYAN, fontWeight: 700, fontSize: 15, cursor: "pointer", padding: 0 }}>Sparc</button>
        <span style={{ color: "#5a7a9a" }}>/</span>
        <span style={{ color: "#f0f4f8", fontSize: 14, fontWeight: 600 }}>{buildingName}</span>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
        {tabs.map(t => (
          <button key={t.path} onClick={() => router.push(`/app/sparc/${buildingId}/${t.path}`)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "8px 16px", fontSize: 14, fontWeight: active === t.path ? 700 : 400, color: active === t.path ? FF_CYAN : "#5a7a9a", borderBottom: active === t.path ? `2px solid ${FF_CYAN}` : "2px solid transparent", marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type Stage = "idle" | "file_loaded" | "uploading" | "processing" | "done" | "error";

const PERIOD_OPTIONS = [
  { label: "Hoy",          days: 1  },
  { label: "Últimos 7 días",  days: 7  },
  { label: "Últimos 15 días", days: 15 },
  { label: "Últimos 30 días", days: 30 },
];

// Detecta formato iOS (DD/MM/YYYY) o Android ([M/D/YY)
// Limpia caracteres invisibles antes de detectar
function detectFormat(text: string): "ios" | "android" {
  // Tira invisibles del inicio de línea para detección limpia
  const cleaned = text.replace(/^[‎‏  ﻿]+/gm, "");
  const iosHit     = /^\d{1,2}\/\d{1,2}\/\d{4},/.test(cleaned);
  const androidHit = /^\[\d{1,2}\/\d{1,2}\/\d{2,4},/.test(cleaned);
  return iosHit && !androidHit ? "ios" : "android";
}

// Filtra el texto del chat a solo los mensajes dentro de los últimos N días
// Compara numéricamente (no usa new Date) para evitar bugs de timezone/parsing
function filterByDays(text: string, days: number): string {
  const now = new Date();
  const cutY = now.getFullYear();
  const cutM = now.getMonth() + 1; // 1-based
  const cutD = now.getDate() - days; // puede ser negativo, lo normalizamos

  // Calcular fecha de corte real
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const cutYear  = cutoff.getFullYear();
  const cutMonth = cutoff.getMonth() + 1;
  const cutDay   = cutoff.getDate();

  const format = detectFormat(text);
  // iOS: DD/MM/YYYY  →  groups: day, month, year
  // Android: [M/D/YY →  groups: month, day, year
  const iosRx     = /^[‎‏  ]*(\d{1,2})\/(\d{1,2})\/(\d{4}),/;
  const androidRx = /^[‎‏  ]*\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),/;
  const lineRegex = format === "ios" ? iosRx : androidRx;

  const lines = text.split("\n");
  const result: string[] = [];
  let include = false;

  for (const line of lines) {
    const m = line.match(lineRegex);
    if (m) {
      const a = parseInt(m[1]), b = parseInt(m[2]);
      const rawY = m[3];
      const y = rawY.length === 2 ? 2000 + parseInt(rawY) : parseInt(rawY);
      let day: number, month: number;
      if (format === "ios") { day = a; month = b; }
      else                  { month = a; day = b; }

      // Comparar numéricamente año-mes-día
      if (y > cutYear) include = true;
      else if (y === cutYear && month > cutMonth) include = true;
      else if (y === cutYear && month === cutMonth && day >= cutDay) include = true;
      else include = false;
    }
    if (include) result.push(line);
  }
  return result.join("\n");
}

export default function SparcSubir() {
  const router     = useRouter();
  const params     = useParams();
  const buildingId = params.building_id as string;

  const [building,    setBuilding]    = useState<Building | null>(null);
  const [stage,       setStage]       = useState<Stage>("idle");
  const [dragOver,    setDragOver]    = useState(false);
  const [fileName,    setFileName]    = useState("");
  const [fileText,    setFileText]    = useState("");      // texto completo original
  const [preview,     setPreview]     = useState({ lines: 0, firstDate: "", lastDate: "" });
  const [statusMsg,   setStatusMsg]   = useState("");
  const [uploadId,    setUploadId]    = useState("");
  const [selectedDays, setSelectedDays] = useState<number>(7);
  const [filteredPreview, setFilteredPreview] = useState({ lines: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data } = await supabase.from("sparc_buildings").select("id,name").eq("id", buildingId).single();
      if (data) setBuilding(data);
    }
    load();
  }, [buildingId, router]);

  // Recalcular preview filtrado cuando cambia el período
  useEffect(() => {
    if (!fileText) return;
    const filtered = filterByDays(fileText, selectedDays);
    // Contar líneas que empiezan con fecha — acepta iOS (DD/MM/YYYY,) y Android ([M/D/YY,)
    const count = (filtered.match(/^[^\S\n]*(?:\[)?\d{1,2}\/\d{1,2}\/\d{2,4},/gm) ?? []).length;
    setFilteredPreview({ lines: count });
  }, [fileText, selectedDays]);

  function parsePreview(text: string) {
    // Detectar formato Android [M/D/YY, o iOS DD/MM/YYYY,
    const androidRegex = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),/gm;
    const iosRegex     = /^(\d{1,2}\/\d{1,2}\/\d{4}),\s\d{1,2}:\d{2}\s(?:a\.|p\.)/gm;
    const androidMatches = [...text.matchAll(androidRegex)];
    const iosMatches     = [...text.matchAll(iosRegex)];
    const matches = iosMatches.length > androidMatches.length ? iosMatches : androidMatches;
    return { lines: matches.length, firstDate: matches[0]?.[1] ?? "", lastDate: matches[matches.length - 1]?.[1] ?? "" };
  }

  async function extractTextFromFile(file: File): Promise<{ text: string; name: string }> {
    if (file.name.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);
      const chatFile = Object.values(zip.files).find(f => !f.dir && f.name.endsWith(".txt"));
      if (!chatFile) throw new Error("No se encontró archivo .txt dentro del ZIP. Asegúrate de exportar el chat desde WhatsApp.");
      const text = await chatFile.async("string");
      // Usar solo el nombre del .txt interno (sin carpetas del ZIP)
      const innerName = chatFile.name.split("/").pop() ?? chatFile.name;
      return { text, name: innerName };
    } else {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve({ text: e.target?.result as string, name: file.name });
        reader.onerror = () => reject(new Error("Error leyendo el archivo"));
        reader.readAsText(file, "utf-8");
      });
    }
  }

  function handleFile(file: File) {
    if (!file.name.endsWith(".txt") && !file.name.endsWith(".zip")) {
      setStage("error");
      setStatusMsg("Solo se aceptan archivos .txt o .zip exportados de WhatsApp.");
      return;
    }
    extractTextFromFile(file)
      .then(({ text, name }) => {
        setFileText(text);
        setFileName(name);
        setPreview(parsePreview(text));
        setStage("file_loaded");
      })
      .catch(err => {
        setStage("error");
        setStatusMsg(err.message ?? "Error procesando el archivo.");
      });
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  async function procesar() {
    if (!fileText) return;
    setStage("uploading");
    setStatusMsg("Guardando chat en base de datos…");

    // Filtrar solo el período seleccionado
    const textToProcess = filterByDays(fileText, selectedDays);
    if (!textToProcess.trim()) {
      setStage("error");
      setStatusMsg(`No hay mensajes en los últimos ${selectedDays} días en este chat.`);
      return;
    }

    // 1. Insertar upload
    const { data: upload, error: upErr } = await supabase
      .from("sparc_chat_uploads")
      .insert({
        building_id: buildingId,
        client_id:   SPARC_CLIENT_ID,
        raw_text:    textToProcess,
        whatsapp_group_name: fileName.replace("_chat.txt", "").replace(".txt", ""),
      })
      .select("id")
      .single();

    if (upErr || !upload) {
      setStage("error");
      setStatusMsg("Error guardando el archivo: " + (upErr?.message ?? "desconocido"));
      return;
    }

    setUploadId(upload.id);
    setStage("processing");
    setStatusMsg("Clasificando mensajes con IA… esto puede tomar 30-60 segundos.");

    // 2. Llamar Edge Function (fire & forget — puede tardar más que el timeout del browser)
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-chat-upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ upload_id: upload.id }),
          signal: AbortSignal.timeout(90_000),
        }
      );
      const result = await res.json();
      if (result.success) {
        setStage("done");
        setStatusMsg(`✅ Listo. ${result.stats.messages_classified} mensajes clasificados — ${result.stats.urgent} urgentes, ${result.stats.medium} medios, ${result.stats.low} bajos.`);
      } else {
        setStage("error");
        setStatusMsg("Error en la clasificación: " + result.error);
      }
    } catch (err: any) {
      // Timeout del fetch — verificar si de todos modos procesó
      setStage("processing");
      setStatusMsg("La IA sigue procesando… revisa el dashboard en unos segundos.");
      setTimeout(() => router.push(`/app/sparc/${buildingId}/dashboard`), 4000);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0D1B2A", color: "#f0f4f8", fontFamily: "Inter, sans-serif" }}>
      <NavBar buildingName={building?.name ?? "…"} buildingId={buildingId} active="subir" />

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Subir chat de WhatsApp</h1>
        <p style={{ color: "#5a7a9a", marginBottom: 36, fontSize: 14 }}>
          Exporta el chat del grupo de vecinos desde WhatsApp → ⋮ → Más → Exportar chat → Sin archivos. Sube el <b style={{ color: "#f0f4f8" }}>.txt</b> (Android) o el <b style={{ color: "#f0f4f8" }}>.zip</b> (iOS) directamente aquí.
        </p>

        {/* Drop zone */}
        {(stage === "idle" || stage === "error") && (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? FF_CYAN : "#1e3048"}`,
                borderRadius: 14, padding: "56px 24px", textAlign: "center",
                cursor: "pointer", transition: "border-color 0.15s",
                background: dragOver ? "#091520" : "transparent",
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Arrastra tu archivo .txt o .zip aquí</div>
              <div style={{ color: "#5a7a9a", fontSize: 14 }}>o haz clic para seleccionarlo</div>
              <input ref={fileRef} type="file" accept=".txt,.zip" style={{ display: "none" }}
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
            {stage === "error" && (
              <div style={{ marginTop: 16, color: "#ff6b6b", background: "#2a1111", borderRadius: 8, padding: "12px 16px", fontSize: 14 }}>
                {statusMsg}
              </div>
            )}
          </>
        )}

        {/* Preview + selector de período */}
        {stage === "file_loaded" && (
          <div style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 12, padding: "24px" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>📄 {fileName}</div>

            {/* Stats del archivo completo */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
              {[
                { label: "Total mensajes",  value: preview.lines.toLocaleString() },
                { label: "Primer mensaje",  value: preview.firstDate || "—" },
                { label: "Último mensaje",  value: preview.lastDate  || "—" },
              ].map(item => (
                <div key={item.label} style={{ background: "#0d1b2a", borderRadius: 8, padding: "12px 16px" }}>
                  <div style={{ color: "#5a7a9a", fontSize: 12, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Selector de período */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: "#5a7a9a", marginBottom: 10 }}>
                ¿Qué período quieres analizar?
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {PERIOD_OPTIONS.map(opt => (
                  <button key={opt.days} onClick={() => setSelectedDays(opt.days)}
                    style={{
                      border: `2px solid ${selectedDays === opt.days ? FF_CYAN : "#1e3048"}`,
                      borderRadius: 10, padding: "12px 8px", background: selectedDays === opt.days ? "#091d2a" : "transparent",
                      color: selectedDays === opt.days ? FF_CYAN : "#5a7a9a",
                      fontWeight: selectedDays === opt.days ? 700 : 400,
                      cursor: "pointer", fontSize: 13, transition: "all 0.15s",
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview filtrado */}
            <div style={{ background: "#0d1b2a", borderRadius: 8, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#5a7a9a", fontSize: 13 }}>Mensajes a procesar:</span>
              <span style={{ fontWeight: 800, fontSize: 20, color: filteredPreview.lines > 0 ? FF_CYAN : "#ff6b6b" }}>
                {filteredPreview.lines.toLocaleString()}
              </span>
            </div>

            {filteredPreview.lines === 0 && (
              <div style={{ background: "#2a1111", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#ff6b6b", fontSize: 13 }}>
                No hay mensajes en este período. Prueba con un rango mayor.
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={procesar} disabled={filteredPreview.lines === 0}
                style={{ flex: 1, background: filteredPreview.lines > 0 ? FF_CYAN : "#1e3048", border: "none", borderRadius: 10, padding: "14px", color: filteredPreview.lines > 0 ? "#0D1B2A" : "#5a7a9a", fontWeight: 800, fontSize: 15, cursor: filteredPreview.lines > 0 ? "pointer" : "not-allowed" }}>
                Procesar con IA →
              </button>
              <button onClick={() => { setStage("idle"); setFileText(""); setFileName(""); }}
                style={{ background: "#1e3048", border: "none", borderRadius: 10, padding: "14px 20px", color: "#5a7a9a", cursor: "pointer", fontSize: 14 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Processing */}
        {(stage === "uploading" || stage === "processing") && (
          <div style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 12, padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16, animation: "spin 1.5s linear infinite" }}>⚙️</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{stage === "uploading" ? "Guardando…" : "Procesando con IA…"}</div>
            <div style={{ color: "#5a7a9a", fontSize: 14 }}>{statusMsg}</div>
          </div>
        )}

        {/* Done */}
        {stage === "done" && (
          <div style={{ background: "#0f2318", border: "1px solid #44cc8844", borderRadius: 12, padding: "36px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8, color: "#44cc88" }}>¡Chat procesado!</div>
            <div style={{ color: "#8ab09a", fontSize: 14, marginBottom: 24 }}>{statusMsg}</div>
            <button onClick={() => router.push(`/app/sparc/${buildingId}/dashboard`)}
              style={{ background: FF_CYAN, border: "none", borderRadius: 10, padding: "12px 28px", color: "#0D1B2A", fontWeight: 800, cursor: "pointer", fontSize: 15 }}>
              Ver dashboard →
            </button>
          </div>
        )}

        {/* Instrucciones */}
        <div style={{ marginTop: 40, background: "#112233", borderRadius: 12, padding: "20px 24px" }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>¿Cómo exportar el chat desde WhatsApp?</div>
          <ol style={{ color: "#5a7a9a", fontSize: 13, lineHeight: 2, margin: 0, paddingLeft: 18 }}>
            <li>Abre el grupo de vecinos en WhatsApp</li>
            <li>Toca los ⋮ tres puntos (Android) o el nombre del grupo (iOS)</li>
            <li>Selecciona <b style={{ color: "#f0f4f8" }}>Más → Exportar chat</b></li>
            <li>Elige <b style={{ color: "#f0f4f8" }}>Sin archivos</b> para obtener solo el texto</li>
            <li>Comparte o descarga el archivo — Android da un <b style={{ color: "#f0f4f8" }}>.txt</b>, iOS da un <b style={{ color: "#f0f4f8" }}>.zip</b> — ambos funcionan aquí</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
