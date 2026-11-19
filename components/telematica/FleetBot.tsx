"use client";

// Telemática · "Pregúntale a tu flotilla": chat con datos reales de la flotilla.
// Vive en Recorridos (panel de LUKON y vistas por NIP). Backend: /api/telematica/bot.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RecorridosTokens } from "./RecorridosTab";

interface Msg { role: "user" | "assistant"; content: string; error?: boolean }

const SUGERENCIAS = [
  "¿Qué unidad recorrió más kilómetros el mes pasado?",
  "¿Quién tuvo más excesos de velocidad esta semana?",
  "¿Qué unidades se movieron el fin de semana?",
  "¿Cuántos litros estimados gastamos en octubre?",
  "¿Qué unidades tienen más ralentí este mes?",
  "¿Dónde está cada unidad ahora?",
];

/** Markdown mínimo y seguro: **negritas**, listas con guion y saltos de línea. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`} style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{list.map((l, i) => <li key={i} style={{ margin: "2px 0" }}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const m = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) { list.push(m[1]); continue; }
    flush();
    if (line.trim()) blocks.push(<p key={`p${blocks.length}`} style={{ margin: "0 0 8px" }}>{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

export default function FleetBot({ clientId, fleetName, t }: { clientId: string; fleetName: string; t: RecorridosTokens }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const res = await fetch("/api/telematica/bot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, messages: next.filter(m => !m.error).map(({ role, content }) => ({ role, content })) }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error ?? "No pude contestar");
      setMsgs(m => [...m, { role: "assistant", content: r.reply }]);
    } catch (e) {
      setMsgs(m => [...m, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const card = { background: "#FFFFFF", border: `1px solid ${t.lineL}`, borderRadius: 12 };
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", minHeight: 460 }}>
      <div style={{ padding: "18px 20px", borderBottom: `1px solid ${t.lineL}` }}>
        <div style={{ fontFamily: t.fBody, fontWeight: 700, fontSize: 18, color: t.ink }}>Pregúntale a tu flotilla</div>
        <div style={{ fontFamily: t.fBody, fontSize: 14, color: t.mutedL, marginTop: 4 }}>
          Escribe como le preguntarías a una persona. Las respuestas salen de los datos del GPS de {fleetName}.
        </div>
      </div>

      <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", maxHeight: 560 }}>
        {!msgs.length && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SUGERENCIAS.map(s => (
              <button key={s} onClick={() => send(s)} style={{
                background: t.paper2, color: t.ink, border: `1px solid ${t.lineL}`, borderRadius: 999,
                padding: "8px 14px", fontFamily: t.fBody, fontSize: 14, cursor: "pointer", textAlign: "left",
              }}>{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
            <div style={{
              background: m.role === "user" ? t.ink : m.error ? "#FDECE7" : t.paper,
              color: m.role === "user" ? "#FFFFFF" : m.error ? t.crimson : t.ink,
              border: m.role === "user" ? "none" : `1px solid ${t.lineL}`,
              borderRadius: 12, padding: "10px 14px", fontFamily: t.fBody, fontSize: 15, lineHeight: 1.5,
            }}>
              {m.role === "user" ? m.content : <Rich text={m.content} />}
            </div>
          </div>
        ))}
        {busy && <div style={{ fontFamily: t.fBody, fontSize: 14, color: t.mutedL }}>Revisando los datos de la flotilla…</div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={e => { e.preventDefault(); send(input); }} style={{ display: "flex", gap: 8, padding: 14, borderTop: `1px solid ${t.lineL}` }}>
        <input value={input} onChange={e => setInput(e.target.value)} disabled={busy} maxLength={500}
          placeholder="Ej. ¿Cuántos km hizo la 06 en octubre?" aria-label="Pregunta sobre la flotilla"
          style={{ flex: 1, minWidth: 0, padding: "12px 14px", border: `1px solid ${t.lineL}`, borderRadius: 8, fontFamily: t.fBody, fontSize: 16, color: t.ink }} />
        <button type="submit" disabled={busy || !input.trim()} style={{
          background: t.ink, color: t.signal, border: "none", borderRadius: 8, padding: "0 18px",
          fontFamily: t.fBody, fontWeight: 700, fontSize: 15, cursor: busy || !input.trim() ? "not-allowed" : "pointer", opacity: busy || !input.trim() ? 0.6 : 1,
        }}>Enviar</button>
      </form>
    </div>
  );
}
