"use client";

// Módulo Revisión en línea — lo que ve el cliente.
// Cada pieza se pinta tal como se publicará (el correo dentro de un iframe,
// con su propio diseño) y debajo lleva su hilo: visto bueno o cambios.
// Marca FishFlow alrededor: barra oscura, papel, naranja y etiquetas en mono.

import { useEffect, useMemo, useState } from "react";
import { itemState, type ReviewComment, type Verdict } from "@/lib/contentReview";

interface Pieza {
  id: string;
  n?: string;
  titulo: string;
  subtitulo?: string;
  tag?: string;
  asunto?: string;
  nota?: string;
  v?: number;
  html: string;
}

const CSS = `
.rv-wrap{min-height:100dvh;background:#F4F1EA;color:#0E2A36;font-family:'Outfit',ui-sans-serif,system-ui,sans-serif}
.rv-mono{font-family:var(--ff-mono),ui-monospace,SFMono-Regular,Menlo,monospace}
.rv-top{position:sticky;top:0;z-index:20;background:#0A1820;color:#F4F1EA}
.rv-top-in{max-width:780px;margin:0 auto;padding:14px 20px 12px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.rv-top img{height:20px;filter:brightness(0) invert(1)}
.rv-prog{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(244,241,234,.6);text-align:right}
.rv-bar{height:3px;background:rgba(244,241,234,.14)}.rv-bar>i{display:block;height:100%;background:#F26B17;transition:width .35s}
.rv-main{max-width:780px;margin:0 auto;padding:28px 20px 80px}
.rv-kick{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#F26B17;margin-bottom:10px}
.rv-h1{font-size:30px;line-height:1.1;font-weight:600;letter-spacing:-.02em;margin:0 0 12px}
.rv-p{font-size:16px;line-height:1.6;color:#33484F;margin:0 0 14px;white-space:pre-line}
.rv-box{background:#fff;border:1px solid #E5E1D6;border-radius:14px;padding:20px 22px;margin:0 0 22px}
.rv-box h2{font-size:15px;margin:0 0 10px;font-weight:600}
.rv-box ol{margin:0;padding-left:20px;font-size:15px;line-height:1.55;color:#33484F}.rv-box li{margin:4px 0}
.rv-who{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.rv-chip{border:1.5px solid #0E2A36;background:#fff;color:#0E2A36;border-radius:999px;padding:8px 16px;font-size:14px;cursor:pointer;font-family:inherit}
.rv-chip.on{background:#0E2A36;color:#F4F1EA}
.rv-card{background:#fff;border:1px solid #E5E1D6;border-radius:16px;margin:0 0 26px;overflow:hidden}
.rv-card-h{display:flex;gap:14px;align-items:flex-start;padding:18px 20px 14px}
.rv-n{flex:0 0 34px;height:34px;border-radius:50%;background:#0E2A36;color:#F4F1EA;display:grid;place-items:center;font-weight:600}
.rv-t{font-size:17px;font-weight:600;margin:0}.rv-sub{font-size:13px;color:#6B7B82;margin-top:2px}
.rv-tag{display:inline-block;margin-top:8px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#0E2A36;background:#F4F1EA;padding:4px 8px;border-radius:4px}
.rv-st{margin-left:auto;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;padding:5px 9px;border-radius:999px;white-space:nowrap}
.rv-st.ok{background:#E3F5EA;color:#1E7A45}.rv-st.aj{background:#E2F2F8;color:#0B6E8F}
.rv-aj{margin-top:6px;font-size:13.5px;color:#0B6E8F;background:#EEF7FA;border-radius:6px;padding:6px 10px}
.rv-v{display:inline-block;margin-left:8px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#0B6E8F}.rv-st.cam{background:#FDEBDD;color:#B4500F}.rv-st.pen{background:#EEF0F1;color:#6B7B82}
.rv-nota{margin:0 20px 12px;background:#FFF6E5;border:1px solid #F1DDB3;border-radius:8px;padding:9px 12px;font-size:13.5px}
.rv-asunto{margin:0 20px;padding:10px 14px;background:#F4F1EA;border-radius:8px 8px 0 0;font-size:13.5px;border:1px solid #E5E1D6;border-bottom:none}
.rv-asunto b{color:#0E2A36}
.rv-frame{display:block;width:calc(100% - 40px);margin:0 20px;border:1px solid #E5E1D6;border-radius:0 0 8px 8px;background:#F6FBFB;min-height:300px}
.rv-hilo{padding:14px 20px 4px}
.rv-c{border-left:3px solid #E5E1D6;padding:6px 0 6px 12px;margin:0 0 10px;font-size:14.5px;line-height:1.5}
.rv-c.ok{border-color:#2E9B5C}.rv-c.cam{border-color:#F26B17}
.rv-c-m{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#6B7B82;margin-bottom:2px}
.rv-form{padding:4px 20px 20px}
.rv-ta{width:100%;min-height:78px;border:1.5px solid #D8D3C6;border-radius:10px;padding:10px 12px;font-family:inherit;font-size:15px;color:#0E2A36;background:#FCFBF8;resize:vertical}
.rv-ta:focus{outline:none;border-color:#0E2A36}
.rv-acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
.rv-b{border:none;border-radius:10px;padding:11px 16px;font-family:inherit;font-size:14.5px;font-weight:600;cursor:pointer}
.rv-b:disabled{opacity:.5;cursor:default}
.rv-b.ok{background:#1E7A45;color:#fff}.rv-b.cam{background:#F26B17;color:#fff}.rv-b.com{background:#fff;color:#0E2A36;border:1.5px solid #0E2A36}
.rv-err{color:#B42318;font-size:13.5px;margin-top:8px}
.rv-foot{text-align:center;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6B7B82;margin-top:30px}
@media(max-width:600px){.rv-h1{font-size:24px}.rv-frame{width:calc(100% - 24px);margin:0 12px}.rv-asunto{margin:0 12px}.rv-card-h,.rv-hilo,.rv-form{padding-left:14px;padding-right:14px}.rv-st{display:none}}
`;

const ETIQ: Record<Verdict, string> = { aprobado: "Aprobado", cambios: "Pide cambios", comentario: "Comentario" };
const CLS: Record<Verdict, string> = { aprobado: "ok", cambios: "cam", comentario: "" };

function fecha(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
  } catch {
    return "";
  }
}

function Marco({ html, titulo }: { html: string; titulo: string }) {
  const [alto, setAlto] = useState(520);
  return (
    <iframe
      className="rv-frame"
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
          /* sin acceso al documento: se queda el alto por defecto */
        }
      }}
    />
  );
}

export default function Revision(props: {
  token: string;
  titulo: string;
  intro: string | null;
  preguntas: string[];
  revisores: string[];
  cerrada: boolean;
  vence: string;
  piezas: Pieza[];
  comentariosIniciales: ReviewComment[];
}) {
  const { token, piezas, revisores, cerrada } = props;
  const [comentarios, setComentarios] = useState<ReviewComment[]>(props.comentariosIniciales);
  const [quien, setQuien] = useState<string>("");
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const g = localStorage.getItem("ff-revision-quien");
      if (g && (!revisores.length || revisores.includes(g))) setQuien(g);
    } catch {
      /* modo privado: no pasa nada */
    }
  }, [revisores]);

  const elegir = (n: string) => {
    setQuien(n);
    try {
      localStorage.setItem("ff-revision-quien", n);
    } catch {
      /* sin almacenamiento */
    }
  };

  const porPieza = useMemo(() => {
    const m: Record<string, ReviewComment[]> = {};
    for (const c of comentarios) (m[c.item_id ?? "__general"] ??= []).push(c);
    return m;
  }, [comentarios]);

  const estado = (id: string) => itemState(comentarios, id);
  const aprobadas = piezas.filter((p) => estado(p.id) === "aprobado").length;

  async function enviar(itemId: string | null, verdict: Verdict) {
    const key = itemId ?? "__general";
    const body = (textos[key] ?? "").trim();
    if (!quien) {
      setErrores((e) => ({ ...e, [key]: "Arriba elige quién está revisando." }));
      return;
    }
    if (verdict !== "aprobado" && !body) {
      setErrores((e) => ({ ...e, [key]: "Escribe qué hay que cambiar." }));
      return;
    }
    setEnviando(key);
    setErrores((e) => ({ ...e, [key]: "" }));
    try {
      const r = await fetch("/api/revision/comentar/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, item_id: itemId, author: quien, verdict, body }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar.");
      setComentarios(j.comments);
      setTextos((t) => ({ ...t, [key]: "" }));
    } catch (err) {
      setErrores((e) => ({ ...e, [key]: err instanceof Error ? err.message : "No se pudo guardar." }));
    } finally {
      setEnviando(null);
    }
  }

  const hilo = (id: string) => (
    <div className="rv-hilo">
      {(porPieza[id] ?? []).map((c) => (
        <div key={c.id} className={`rv-c ${CLS[c.verdict]}`}>
          <div className="rv-c-m rv-mono">
            {c.author} · {ETIQ[c.verdict]} · {fecha(c.created_at)}
          </div>
          {c.body}
          {c.resolved_at ? (
            <div className="rv-aj">✓ Ajustado{c.resolution_note ? `: ${c.resolution_note}` : ""}</div>
          ) : null}
        </div>
      ))}
    </div>
  );

  // Funciones (no componentes) para que el textarea no se remonte y pierda el foco.
  const form = (id: string | null, general?: boolean) => {
    const key = id ?? "__general";
    if (cerrada) return null;
    return (
      <div className="rv-form">
        <textarea
          className="rv-ta"
          placeholder={general ? "Comentarios generales: tono, firma, datos fiscales…" : "¿Qué cambiarías? (opcional si lo apruebas)"}
          value={textos[key] ?? ""}
          onChange={(e) => setTextos((t) => ({ ...t, [key]: e.target.value }))}
        />
        <div className="rv-acts">
          {general ? (
            <button className="rv-b com" disabled={enviando === key} onClick={() => enviar(null, "comentario")}>
              Enviar comentario
            </button>
          ) : (
            <>
              <button className="rv-b ok" disabled={enviando === key} onClick={() => enviar(id, "aprobado")}>
                ✓ Aprobar
              </button>
              <button className="rv-b cam" disabled={enviando === key} onClick={() => enviar(id, "cambios")}>
                ✎ Pedir cambios
              </button>
            </>
          )}
        </div>
        {errores[key] ? <div className="rv-err">{errores[key]}</div> : null}
      </div>
    );
  };

  return (
    <div className="rv-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="rv-top">
        <div className="rv-top-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-horizontal-mono.svg" alt="FishFlow" />
          <div className="rv-prog rv-mono">
            Revisión en línea · {aprobadas} de {piezas.length} aprobadas
          </div>
        </div>
        <div className="rv-bar">
          <i style={{ width: `${piezas.length ? (aprobadas / piezas.length) * 100 : 0}%` }} />
        </div>
      </div>

      <main className="rv-main">
        <div className="rv-kick rv-mono">Para revisión</div>
        <h1 className="rv-h1">{props.titulo}</h1>
        {props.intro ? <p className="rv-p">{props.intro}</p> : null}

        {props.preguntas.length ? (
          <div className="rv-box">
            <h2>Antes de enviar, necesitamos que nos confirmen</h2>
            <ol>
              {props.preguntas.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {revisores.length ? (
          <div className="rv-box">
            <h2>¿Quién está revisando?</h2>
            <div className="rv-who">
              {revisores.map((r) => (
                <button key={r} className={`rv-chip ${quien === r ? "on" : ""}`} onClick={() => elegir(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {cerrada ? <div className="rv-box">Esta revisión ya se cerró. Gracias por sus comentarios.</div> : null}

        {piezas.map((p) => {
          const st = estado(p.id);
          return (
            <section key={p.id} className="rv-card" id={`pieza-${p.id}`}>
              <div className="rv-card-h">
                <div className="rv-n">{p.n ?? ""}</div>
                <div style={{ minWidth: 0 }}>
                  <h3 className="rv-t">
                    {p.titulo}
                    {p.v && p.v > 1 ? <span className="rv-v rv-mono">Versión {p.v}</span> : null}
                  </h3>
                  {p.subtitulo ? <div className="rv-sub">{p.subtitulo}</div> : null}
                  {p.tag ? <div className="rv-tag rv-mono">{p.tag}</div> : null}
                </div>
                <span className={`rv-st rv-mono ${st === "aprobado" ? "ok" : st === "cambios" ? "cam" : st === "ajustado" ? "aj" : "pen"}`}>
                  {st === "aprobado" ? "Aprobado" : st === "cambios" ? "Con cambios" : st === "ajustado" ? "Ajustado · por aprobar" : "Pendiente"}
                </span>
              </div>
              {p.nota ? <div className="rv-nota">⚠ {p.nota}</div> : null}
              {p.asunto ? (
                <div className="rv-asunto">
                  Asunto: <b>{p.asunto}</b>
                </div>
              ) : null}
              <Marco html={p.html} titulo={p.titulo} />
              {hilo(p.id)}
              {form(p.id)}
            </section>
          );
        })}

        <section className="rv-card">
          <div className="rv-card-h">
            <div className="rv-n">+</div>
            <div>
              <h3 className="rv-t">Comentarios generales</h3>
              <div className="rv-sub">Lo que aplica a todos los correos.</div>
            </div>
          </div>
          {hilo("__general")}
          {form(null, true)}
        </section>

        <div className="rv-foot rv-mono">FishFlow · Siempre adelante</div>
      </main>
    </div>
  );
}
