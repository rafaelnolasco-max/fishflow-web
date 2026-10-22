"use client";

// Panel de una revisión en /admin: a la izquierda la pieza tal cual la ve el
// cliente, a la derecha su hilo. Cada comentario de cambios se marca
// "Ajustado" con una nota; el cliente la ve bajo su comentario.

import { useMemo, useState } from "react";
import { isPending, itemState, type ItemState, type ReviewComment } from "@/lib/contentReview";

interface Pieza {
  id: string;
  n?: string;
  titulo: string;
  subtitulo?: string;
  asunto?: string;
  v: number;
  ajustada_at: string | null;
  html: string;
}

const CSS = `
.ap{min-height:100dvh;background:#0A1820;color:#e8f4f8;font-family:'Inter',ui-sans-serif,system-ui,sans-serif}
.ap-top{position:sticky;top:0;z-index:20;background:#0C2232;border-bottom:1px solid rgba(255,255,255,.08)}
.ap-top-in{max-width:1320px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ap-back{color:#5a8a9e;text-decoration:none;font-size:13px}.ap-back:hover{color:#1FA9D6}
.ap-tit{flex:1;min-width:220px}.ap-tit small{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5a8a9e}
.ap-tit b{font-size:16px}
.ap-btn{background:#11313f;color:#e8f4f8;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;text-decoration:none;white-space:nowrap;font-family:inherit}
.ap-btn:hover{border-color:#1FA9D6}.ap-btn.pri{background:#1FA9D6;border-color:#1FA9D6;color:#fff}.ap-btn.ok{background:#2E9B5C;border-color:#2E9B5C;color:#fff}
.ap-btn:disabled{opacity:.5;cursor:default}
.ap-main{max-width:1320px;margin:0 auto;padding:18px 24px 80px}
.ap-stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.ap-stat{background:#0C2232;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 14px;min-width:120px}
.ap-stat i{display:block;font-style:normal;font-size:11px;color:#5a8a9e;text-transform:uppercase;letter-spacing:.1em}.ap-stat b{font-size:20px}
.ap-nav{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 18px}
.ap-dot{display:inline-flex;align-items:center;gap:6px;background:#0C2232;border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:5px 11px;font-size:12px;color:#e8f4f8;text-decoration:none}
.ap-dot i{width:8px;height:8px;border-radius:50%;display:inline-block}
.ap-filter{display:flex;gap:8px;align-items:center;margin:0 0 14px;font-size:13px;color:#5a8a9e}
.ap-card{background:#0C2232;border:1px solid rgba(255,255,255,.08);border-radius:14px;margin:0 0 18px;overflow:hidden}
.ap-card.pend{border-color:rgba(242,107,23,.5)}
.ap-ch{display:flex;gap:12px;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06)}
.ap-n{flex:0 0 30px;height:30px;border-radius:50%;background:#11313f;display:grid;place-items:center;font-weight:700;font-size:13px}
.ap-ch h3{margin:0;font-size:15px}.ap-ch .sub{font-size:12px;color:#5a8a9e}
.ap-st{margin-left:auto;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:999px;white-space:nowrap}
.ap-body{display:grid;grid-template-columns:minmax(0,620px) minmax(0,1fr);gap:0}
.ap-prev{padding:14px;border-right:1px solid rgba(255,255,255,.06);background:#081319}
.ap-asunto{font-size:12.5px;color:#9cc2d1;margin:0 0 8px}.ap-asunto b{color:#e8f4f8}
.ap-frame{width:100%;border:0;border-radius:8px;background:#fff;display:block}
.ap-hilo{padding:14px 18px}
.ap-c{border-left:3px solid #345a69;padding:4px 0 10px 12px;margin:0 0 12px}
.ap-c.ok{border-color:#2E9B5C}.ap-c.cam{border-color:#F26B17}.ap-c.res{border-color:#1FA9D6;opacity:.85}
.ap-cm{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5a8a9e;margin-bottom:3px}
.ap-ct{font-size:14px;line-height:1.5;white-space:pre-wrap}
.ap-res{margin-top:6px;font-size:12.5px;color:#7fd3f0;background:rgba(31,169,214,.08);border-radius:6px;padding:6px 9px}
.ap-ta{width:100%;min-height:52px;margin-top:8px;background:#11313f;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#e8f4f8;padding:8px 10px;font-family:inherit;font-size:13px;resize:vertical}
.ap-row{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}
.ap-empty{color:#5a8a9e;font-size:13px}
.ap-err{color:#ef4444;font-size:13px;margin:8px 0}
.ap-q{background:#0C2232;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 16px;margin:0 0 18px;font-size:13px;color:#9cc2d1}
.ap-q summary{cursor:pointer;color:#e8f4f8;font-weight:600}
.ap-q ol{margin:8px 0 0;padding-left:18px;line-height:1.55}
@media(max-width:1000px){.ap-body{grid-template-columns:1fr}.ap-prev{border-right:0;border-bottom:1px solid rgba(255,255,255,.06)}}
@media(max-width:600px){.ap-top-in,.ap-main{padding-left:14px;padding-right:14px}}
`;

const ST: Record<ItemState, { t: string; bg: string; c: string; dot: string }> = {
  aprobado: { t: "Aprobado", bg: "rgba(46,155,92,.15)", c: "#4fc983", dot: "#2E9B5C" },
  cambios: { t: "Pide cambios", bg: "rgba(242,107,23,.15)", c: "#ff9a5c", dot: "#F26B17" },
  ajustado: { t: "Ajustado · por re-aprobar", bg: "rgba(31,169,214,.15)", c: "#7fd3f0", dot: "#1FA9D6" },
  pendiente: { t: "Sin revisar", bg: "rgba(255,255,255,.06)", c: "#5a8a9e", dot: "#345a69" },
};
const ETIQ = { aprobado: "Aprobado", cambios: "Pide cambios", comentario: "Comentario" } as const;

function fecha(iso: string) {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
}

function Marco({ html, titulo }: { html: string; titulo: string }) {
  const [alto, setAlto] = useState(520);
  return (
    <iframe
      className="ap-frame"
      title={titulo}
      srcDoc={html}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ height: alto }}
      onLoad={(e) => {
        try {
          const d = e.currentTarget.contentDocument;
          if (d) {
            d.querySelectorAll("a").forEach((a) => a.setAttribute("target", "_blank"));
            setAlto(Math.max(300, d.documentElement.scrollHeight + 4));
          }
        } catch {
          /* alto por defecto */
        }
      }}
    />
  );
}

export default function Panel(props: {
  id: string;
  cliente: string;
  titulo: string;
  token: string;
  status: "open" | "closed";
  vence: string;
  revisores: string[];
  preguntas: string[];
  piezas: Pieza[];
  comentariosIniciales: ReviewComment[];
}) {
  const { id, piezas } = props;
  const [comentarios, setComentarios] = useState(props.comentariosIniciales);
  const [status, setStatus] = useState(props.status);
  const [vence, setVence] = useState(props.vence);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [soloPend, setSoloPend] = useState(true);
  const [copiado, setCopiado] = useState(false);

  const liga = `https://www.fishflow.mx/revision/${props.token}`;
  const vencida = new Date(vence).getTime() < Date.now();

  const porPieza = useMemo(() => {
    const m: Record<string, ReviewComment[]> = {};
    for (const c of comentarios) (m[c.item_id ?? "__general"] ??= []).push(c);
    return m;
  }, [comentarios]);

  const pendientes = comentarios.filter(isPending).length;
  const aprobadas = piezas.filter((p) => itemState(comentarios, p.id) === "aprobado").length;
  const generales = porPieza["__general"] ?? [];

  async function accion(body: Record<string, unknown>, key: string) {
    setOcupado(key);
    setError("");
    try {
      const r = await fetch(`/api/admin/revisiones/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar.");
      setComentarios(j.comments);
      if (j.status) setStatus(j.status);
      if (j.vence) setVence(j.vence);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setOcupado(null);
    }
  }

  const comentario = (c: ReviewComment) => {
    const pend = isPending(c);
    const cls = c.resolved_at ? "res" : c.verdict === "aprobado" ? "ok" : c.verdict === "cambios" ? "cam" : "";
    return (
      <div key={c.id} className={`ap-c ${cls}`}>
        <div className="ap-cm">
          {c.author} · {ETIQ[c.verdict]} · {fecha(c.created_at)}
        </div>
        {c.body ? <div className="ap-ct">{c.body}</div> : null}
        {c.resolved_at ? (
          <div className="ap-res">
            ✓ Ajustado {fecha(c.resolved_at)}
            {c.resolution_note ? ` — ${c.resolution_note}` : ""}
            <button
              className="ap-btn"
              style={{ marginLeft: 10, padding: "2px 8px", fontSize: 11 }}
              disabled={ocupado === c.id}
              onClick={() => accion({ action: "unresolve", comment_id: c.id }, c.id)}
            >
              Deshacer
            </button>
          </div>
        ) : null}
        {pend ? (
          <>
            <textarea
              className="ap-ta"
              placeholder="Nota para el cliente (opcional): qué ajustamos"
              value={notas[c.id] ?? ""}
              onChange={(e) => setNotas((n) => ({ ...n, [c.id]: e.target.value }))}
            />
            <div className="ap-row">
              <button
                className="ap-btn ok"
                disabled={ocupado === c.id}
                onClick={() => accion({ action: "resolve", comment_id: c.id, note: notas[c.id] ?? "" }, c.id)}
              >
                ✓ Marcar ajustado
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  };

  const visibles = soloPend ? piezas.filter((p) => (porPieza[p.id] ?? []).some(isPending)) : piezas;

  return (
    <div className="ap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ap-top">
        <div className="ap-top-in">
          <a className="ap-back" href="/admin?tab=revisiones">
            ← Revisiones
          </a>
          <div className="ap-tit">
            <small>{props.cliente}</small>
            <b>{props.titulo}</b>
          </div>
          <button
            className="ap-btn"
            onClick={() => {
              navigator.clipboard?.writeText(liga).then(() => {
                setCopiado(true);
                setTimeout(() => setCopiado(false), 1500);
              });
            }}
          >
            {copiado ? "✓ Copiada" : "Copiar liga"}
          </button>
          <a className="ap-btn" href={liga} target="_blank" rel="noopener noreferrer">
            Ver como cliente ↗
          </a>
          <button className="ap-btn" disabled={ocupado === "extend"} onClick={() => accion({ action: "extend", days: 7 }, "extend")}>
            +7 días
          </button>
          {status === "open" ? (
            <button
              className={`ap-btn ${aprobadas === piezas.length && piezas.length ? "pri" : ""}`}
              disabled={ocupado === "close"}
              onClick={() => accion({ action: "close" }, "close")}
            >
              Cerrar revisión
            </button>
          ) : (
            <button className="ap-btn" disabled={ocupado === "reopen"} onClick={() => accion({ action: "reopen" }, "reopen")}>
              Reabrir
            </button>
          )}
        </div>
      </div>

      <main className="ap-main">
        {error ? <div className="ap-err">{error}</div> : null}

        <div className="ap-stats">
          <div className="ap-stat">
            <i>Aprobadas</i>
            <b>
              {aprobadas}/{piezas.length}
            </b>
          </div>
          <div className="ap-stat" style={pendientes ? { borderColor: "rgba(242,107,23,.5)" } : undefined}>
            <i>Por resolver</i>
            <b style={pendientes ? { color: "#ff9a5c" } : undefined}>{pendientes}</b>
          </div>
          <div className="ap-stat">
            <i>Comentarios</i>
            <b>{comentarios.length}</b>
          </div>
          <div className="ap-stat">
            <i>Estado</i>
            <b style={{ fontSize: 14 }}>{status === "closed" ? "Cerrada" : vencida ? "Vencida" : "Abierta"}</b>
          </div>
          <div className="ap-stat">
            <i>Vence</i>
            <b style={{ fontSize: 14 }}>{new Date(vence).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" })}</b>
          </div>
        </div>

        <div className="ap-nav">
          {piezas.map((p) => {
            const s = ST[itemState(comentarios, p.id)];
            return (
              <a key={p.id} className="ap-dot" href={`#p-${p.id}`} onClick={() => setSoloPend(false)} title={s.t}>
                <i style={{ background: s.dot }} />
                {p.n ? `${p.n}. ` : ""}
                {p.titulo.split(" ")[0]}
              </a>
            );
          })}
        </div>

        {props.preguntas.length ? (
          <details className="ap-q">
            <summary>Preguntas que le hicimos al cliente ({props.preguntas.length})</summary>
            <ol>
              {props.preguntas.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </details>
        ) : null}

        <section className="ap-card" style={generales.some(isPending) ? { borderColor: "rgba(242,107,23,.5)" } : undefined}>
          <div className="ap-ch">
            <div className="ap-n">+</div>
            <div>
              <h3>Comentarios generales</h3>
              <div className="sub">Aplican a todas las piezas</div>
            </div>
          </div>
          <div className="ap-hilo">{generales.length ? generales.map(comentario) : <div className="ap-empty">Sin comentarios generales.</div>}</div>
        </section>

        <div className="ap-filter">
          <button className={`ap-btn ${soloPend ? "pri" : ""}`} onClick={() => setSoloPend(true)}>
            Solo con pendientes
          </button>
          <button className={`ap-btn ${!soloPend ? "pri" : ""}`} onClick={() => setSoloPend(false)}>
            Todas las piezas
          </button>
        </div>

        {soloPend && !visibles.length ? (
          <div className="ap-empty" style={{ padding: "30px 0", textAlign: "center" }}>
            Nada por resolver en las piezas. 🙌
          </div>
        ) : null}

        {visibles.map((p) => {
          const st = itemState(comentarios, p.id);
          const s = ST[st];
          const hilo = porPieza[p.id] ?? [];
          return (
            <section key={p.id} id={`p-${p.id}`} className={`ap-card ${st === "cambios" ? "pend" : ""}`}>
              <div className="ap-ch">
                <div className="ap-n">{p.n ?? ""}</div>
                <div style={{ minWidth: 0 }}>
                  <h3>{p.titulo}</h3>
                  <div className="sub">
                    {p.subtitulo}
                    {p.v > 1 ? ` · versión ${p.v}${p.ajustada_at ? `, ajustada ${fecha(p.ajustada_at)}` : ""}` : ""}
                  </div>
                </div>
                <span className="ap-st" style={{ background: s.bg, color: s.c }}>
                  {s.t}
                </span>
              </div>
              <div className="ap-body">
                <div className="ap-prev">
                  {p.asunto ? (
                    <div className="ap-asunto">
                      Asunto: <b>{p.asunto}</b>
                    </div>
                  ) : null}
                  <Marco html={p.html} titulo={p.titulo} />
                </div>
                <div className="ap-hilo">{hilo.length ? hilo.map(comentario) : <div className="ap-empty">Sin comentarios todavía.</div>}</div>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
