"use client";

// Módulo Descubrimiento — el cuestionario que contesta el prospecto.
//
// Pensado para contestarse en el celular entre cliente y cliente: un bloque
// por pantalla, guardado automático y la posibilidad de retomar donde se quedó.
// Si esto no guardara solo, nadie terminaría las treinta preguntas.
//
// Marca FishFlow, no formulario genérico: encabezado oscuro con el logo,
// naranja y cyan de acento, Outfit para títulos y JetBrains Mono en las
// etiquetas. El cuestionario es la primera demo del producto.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiscoveryBlock, DiscoveryQuestion, NotaLeida } from "@/lib/discovery";

type Respuestas = Record<string, unknown>;

interface FotoEstado {
  subiendo: boolean;
  nombre?: string;
  preview?: NotaLeida | null;
  aviso?: string | null;
  error?: string | null;
}

const CSS = `
.dx-wrap { min-height:100dvh; background:#F4F1EA; color:#0E2A36;
  font-family:'Outfit',ui-sans-serif,system-ui,sans-serif; }
.dx-mono { font-family:var(--ff-mono),ui-monospace,SFMono-Regular,Menlo,monospace; }

.dx-top { position:sticky; top:0; z-index:20; background:#0A1820; color:#F4F1EA; }
.dx-top-in { max-width:720px; margin:0 auto; padding:14px 20px 12px;
  display:flex; align-items:center; justify-content:space-between; gap:16px; }
.dx-top img { height:20px; filter:brightness(0) invert(1); }
.dx-who { font-size:11px; letter-spacing:.16em; text-transform:uppercase;
  color:rgba(244,241,234,.55); text-align:right; }
.dx-bar { height:3px; background:rgba(244,241,234,.14); }
.dx-bar > i { display:block; height:100%; background:#F26B17; transition:width .35s ease; }

.dx-main { max-width:720px; margin:0 auto; padding:26px 20px 132px; }

.dx-intro { background:#fff; border:1px solid #E5E1D6; border-radius:10px;
  padding:20px 22px; margin-bottom:24px; }
.dx-intro h1 { font-size:24px; font-weight:600; letter-spacing:-.02em; margin:0 0 8px; }
.dx-intro p { font-size:15px; line-height:1.6; color:#0C3445; margin:0; }

.dx-step { font-size:10px; letter-spacing:.2em; text-transform:uppercase;
  color:#F26B17; margin:0 0 4px; }
.dx-title { font-size:22px; font-weight:600; letter-spacing:-.02em; margin:0 0 20px;
  padding-bottom:12px; border-bottom:1px solid #C9C4B5; }

.dx-q { background:#fff; border:1px solid #E5E1D6; border-radius:10px;
  padding:16px 18px; margin-bottom:14px; }
.dx-q > label.dx-lab { display:block; font-size:16px; font-weight:500;
  line-height:1.4; margin:0 0 3px; }
.dx-n { font-family:var(--ff-mono),ui-monospace,monospace; font-size:12px;
  color:#1FA9D6; margin-right:8px; }
.dx-hint { font-size:13px; line-height:1.5; color:#6B7B82; margin:0 0 10px; }

.dx-in, .dx-ta { width:100%; box-sizing:border-box; font:inherit; font-size:16px;
  color:#0E2A36; background:#FAFAF7; border:1px solid #E5E1D6; border-radius:7px;
  padding:11px 12px; outline:none; }
.dx-ta { min-height:96px; resize:vertical; line-height:1.55; }
.dx-in:focus, .dx-ta:focus { border-color:#1FA9D6; background:#fff;
  box-shadow:0 0 0 3px rgba(31,169,214,.12); }

.dx-opts { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; }
.dx-opt { display:inline-flex; align-items:center; gap:8px; cursor:pointer;
  font-size:14px; background:#FAFAF7; border:1px solid #E5E1D6; border-radius:7px;
  padding:9px 13px; user-select:none; }
.dx-opt:has(input:checked) { border-color:#F26B17; background:rgba(242,107,23,.07); }
.dx-opt input { accent-color:#F26B17; width:16px; height:16px; margin:0; }

.dx-warn { background:rgba(242,107,23,.08); border-left:3px solid #F26B17;
  border-radius:0 6px 6px 0; padding:11px 13px; margin:0 0 12px;
  font-size:13.5px; line-height:1.55; color:#0C3445; }
.dx-warn b { font-weight:600; }

.dx-file { display:block; border:1.5px dashed #C9C4B5; border-radius:9px;
  padding:20px; text-align:center; cursor:pointer; background:#FAFAF7; }
.dx-file:hover { border-color:#1FA9D6; background:#fff; }
.dx-file span { display:block; font-size:15px; font-weight:500; }
.dx-file small { display:block; font-size:12.5px; color:#6B7B82; margin-top:4px; }
.dx-file input { display:none; }

.dx-prev { border:1px solid #E5E1D6; border-radius:9px; margin-top:14px; overflow:hidden; }
.dx-prev-h { background:#0A1820; color:#F4F1EA; padding:11px 14px;
  font-size:10px; letter-spacing:.18em; text-transform:uppercase; }
.dx-prev-h i { color:#F26B17; font-style:normal; }
.dx-prev-b { padding:14px; }
.dx-row { padding:8px 0; border-bottom:1px solid #E5E1D6; }
.dx-row:last-child { border-bottom:0; }
.dx-row dt { font-family:var(--ff-mono),ui-monospace,monospace; font-size:10px;
  letter-spacing:.14em; text-transform:uppercase; color:#6B7B82; margin-bottom:3px; }
.dx-row dd { margin:0; font-size:14.5px; line-height:1.55; }
.dx-pac { background:#F4F1EA; border-radius:7px; padding:12px 14px; margin-top:12px; }
.dx-pac p { margin:6px 0 0; font-size:14px; line-height:1.6; }

.dx-err { color:#B4531B; font-size:13.5px; margin:10px 0 0; }

.dx-nav { position:fixed; left:0; right:0; bottom:0; background:#fff;
  border-top:1px solid #E5E1D6; }
.dx-nav-in { max-width:720px; margin:0 auto; padding:12px 20px;
  display:flex; align-items:center; gap:12px; }
.dx-save { flex:1; font-size:11px; letter-spacing:.14em; text-transform:uppercase;
  color:#6B7B82; }
.dx-btn { font:inherit; font-size:15px; font-weight:500; border-radius:8px;
  padding:12px 22px; cursor:pointer; border:1px solid transparent; }
.dx-btn-1 { background:#0E2A36; color:#fff; }
.dx-btn-1:disabled { background:#6B7B82; cursor:not-allowed; }
.dx-btn-2 { background:#fff; color:#0E2A36; border-color:#C9C4B5; }
.dx-btn-go { background:#F26B17; color:#fff; }

.dx-rev h2 { font-size:20px; font-weight:600; margin:22px 0 8px; letter-spacing:-.015em; }
.dx-rev dl { margin:0; background:#fff; border:1px solid #E5E1D6;
  border-radius:10px; padding:6px 16px; }
.dx-miss { font-size:14px; line-height:1.6; color:#6B7B82; }
.dx-link { background:none; border:0; padding:0; font:inherit; font-size:13px;
  color:#1FA9D6; cursor:pointer; text-decoration:underline; }

.dx-done { background:#fff; border:1px solid #E5E1D6; border-radius:10px;
  padding:30px 24px; text-align:center; }
.dx-done h1 { font-size:26px; font-weight:600; margin:0 0 10px; letter-spacing:-.02em; }
.dx-done p { font-size:15.5px; line-height:1.6; color:#0C3445; margin:0 auto; max-width:420px; }

@media (max-width:600px) {
  .dx-main { padding:20px 14px 130px; }
  .dx-top-in, .dx-nav-in { padding-left:14px; padding-right:14px; }
  .dx-title { font-size:20px; }
  .dx-btn { padding:12px 16px; }
}
`;

/* ── Piezas, definidas fuera del render (un wrapper dentro del render
      remonta el input y le tumba el foco a media palabra) ──────────────── */

function BarraAvance({ pct }: { pct: number }) {
  return (
    <div className="dx-bar">
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

function Fila({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="dx-row">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function VistaPrevia({ leida }: { leida: NotaLeida }) {
  if (!leida.legible) {
    return (
      <div className="dx-prev">
        <div className="dx-prev-h">No se pudo leer</div>
        <div className="dx-prev-b">
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6 }}>
            {leida.motivo_no_legible ||
              "La foto salió borrosa o cortada. Vuelve a intentar con más luz y de frente."}
          </p>
        </div>
      </div>
    );
  }
  const n = leida.nota;
  return (
    <div className="dx-prev">
      <div className="dx-prev-h">
        <i>&#9679;</i> Así quedaría en el expediente
      </div>
      <div className="dx-prev-b">
        <dl style={{ margin: 0 }}>
          <Fila k="Motivo" v={n.motivo} />
          <Fila k="Padecimiento actual" v={n.padecimiento_actual} />
          <Fila k="Antecedentes" v={n.antecedentes} />
          <Fila k="Exploración" v={n.exploracion} />
          <Fila k="Estudios" v={n.estudios} />
          <Fila k="Diagnóstico" v={n.diagnostico} />
          <Fila k="Plan" v={n.plan} />
          <Fila k="Medicación" v={n.medicacion?.join(" · ")} />
          <Fila k="Próxima cita" v={n.proxima_cita} />
        </dl>
        {leida.indicaciones_paciente && (
          <div className="dx-pac">
            <span
              className="dx-mono"
              style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "#6B7B82" }}
            >
              Lo que se llevaría el paciente
            </span>
            <p>{leida.indicaciones_paciente}</p>
          </div>
        )}
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "#6B7B82", lineHeight: 1.5 }}>
          Los datos que identifican al paciente no se copian: aparecen como
          &quot;[dato del paciente]&quot;. La imagen se guarda en privado.
        </p>
      </div>
    </div>
  );
}

/* ── Campo por tipo de pregunta ───────────────────────────────────────────── */

interface CampoProps {
  q: DiscoveryQuestion;
  valor: unknown;
  onChange: (v: unknown) => void;
  foto?: FotoEstado;
  onFoto: (q: DiscoveryQuestion, f: File) => void;
}

function Campo({ q, valor, onChange, foto, onFoto }: CampoProps) {
  if (q.type === "textarea") {
    return (
      <textarea
        id={q.id}
        className="dx-ta"
        value={typeof valor === "string" ? valor : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (q.type === "text") {
    return (
      <input
        id={q.id}
        className="dx-in"
        type="text"
        value={typeof valor === "string" ? valor : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (q.type === "choice") {
    return (
      <div className="dx-opts">
        {(q.options ?? []).map((o) => (
          <label key={o} className="dx-opt">
            <input
              type="radio"
              name={q.id}
              checked={valor === o}
              onChange={() => onChange(o)}
            />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }
  if (q.type === "multi") {
    const marcadas = Array.isArray(valor) ? (valor as string[]) : [];
    return (
      <div className="dx-opts">
        {(q.options ?? []).map((o) => (
          <label key={o} className="dx-opt">
            <input
              type="checkbox"
              checked={marcadas.includes(o)}
              onChange={() =>
                onChange(
                  marcadas.includes(o) ? marcadas.filter((x) => x !== o) : [...marcadas, o],
                )
              }
            />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }
  // photo
  return (
    <div>
      <label className="dx-file">
        <span>{foto?.subiendo ? "Leyendo la imagen…" : "Tomar o elegir una foto"}</span>
        <small>
          {foto?.nombre
            ? foto.nombre
            : "JPG o PNG, hasta 10 MB. Desde el celular puedes tomarla ahí mismo."}
        </small>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={foto?.subiendo}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFoto(q, f);
            e.target.value = "";
          }}
        />
      </label>
      {foto?.error && <p className="dx-err">{foto.error}</p>}
      {foto?.aviso && (
        <p style={{ fontSize: 13.5, color: "#6B7B82", margin: "10px 0 0" }}>{foto.aviso}</p>
      )}
      {foto?.preview && <VistaPrevia leida={foto.preview} />}
    </div>
  );
}

/* ── Pantalla completa ────────────────────────────────────────────────────── */

interface Props {
  token: string;
  prospecto: string;
  organizacion: string | null;
  intro: string | null;
  nombreCuestionario: string;
  bloques: DiscoveryBlock[];
  respuestasIniciales: Respuestas;
}

function contestada(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function pinta(v: unknown): string {
  if (Array.isArray(v)) return (v as string[]).join(" · ");
  return String(v ?? "");
}

export default function Cuestionario({
  token,
  prospecto,
  organizacion,
  intro,
  nombreCuestionario,
  bloques,
  respuestasIniciales,
}: Props) {
  const [respuestas, setRespuestas] = useState<Respuestas>(respuestasIniciales);
  const [paso, setPaso] = useState(0); // 0..bloques.length (el último es revisión)
  const [fotos, setFotos] = useState<Record<string, FotoEstado>>({});
  const [guardando, setGuardando] = useState(false);
  const [guardadoEn, setGuardadoEn] = useState<Date | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendientes = useRef<Respuestas | null>(null);

  const totalPreguntas = useMemo(
    () => bloques.reduce((n, b) => n + b.questions.length, 0),
    [bloques],
  );
  const hechas = useMemo(
    () =>
      bloques.reduce(
        (n, b) => n + b.questions.filter((q) => contestada(respuestas[q.id])).length,
        0,
      ),
    [bloques, respuestas],
  );
  const pct = totalPreguntas ? Math.round((hechas / totalPreguntas) * 100) : 0;

  const guardar = useCallback(
    async (datos: Respuestas) => {
      setGuardando(true);
      try {
        const res = await fetch("/api/descubrimiento/guardar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, answers: datos }),
        });
        if (res.ok) setGuardadoEn(new Date());
      } catch {
        /* Silencio a propósito: el siguiente cambio vuelve a intentar y no
           tiene caso asustar al prospecto por un parpadeo de red. */
      } finally {
        setGuardando(false);
      }
    },
    [token],
  );

  // Autoguardado con retraso: se dispara cuando deja de escribir.
  useEffect(() => {
    if (!pendientes.current) return;
    if (temporizador.current) clearTimeout(temporizador.current);
    const datos = pendientes.current;
    temporizador.current = setTimeout(() => {
      pendientes.current = null;
      void guardar(datos);
    }, 900);
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [respuestas, guardar]);

  const cambiar = useCallback((id: string, v: unknown) => {
    setRespuestas((prev) => {
      const next = { ...prev, [id]: v };
      pendientes.current = next;
      return next;
    });
  }, []);

  const subirFoto = useCallback(
    async (q: DiscoveryQuestion, file: File) => {
      setFotos((p) => ({ ...p, [q.id]: { subiendo: true, nombre: file.name } }));
      try {
        const fd = new FormData();
        fd.append("token", token);
        fd.append("question_id", q.id);
        fd.append("archivo", file);
        const res = await fetch("/api/descubrimiento/foto", { method: "POST", body: fd });
        const data = (await res.json()) as {
          error?: string;
          preview?: NotaLeida | null;
          aviso?: string;
        };
        if (!res.ok) {
          setFotos((p) => ({
            ...p,
            [q.id]: { subiendo: false, nombre: file.name, error: data.error ?? "No se pudo subir." },
          }));
          return;
        }
        setFotos((p) => ({
          ...p,
          [q.id]: {
            subiendo: false,
            nombre: file.name,
            preview: data.preview ?? null,
            aviso: data.aviso ?? null,
          },
        }));
        cambiar(q.id, file.name);
      } catch {
        setFotos((p) => ({
          ...p,
          [q.id]: { subiendo: false, nombre: file.name, error: "Falló la subida. Inténtalo otra vez." },
        }));
      }
    },
    [token, cambiar],
  );

  const irA = useCallback(
    (n: number) => {
      if (temporizador.current) clearTimeout(temporizador.current);
      if (pendientes.current) {
        const datos = pendientes.current;
        pendientes.current = null;
        void guardar(datos);
      }
      setPaso(n);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [guardar],
  );

  const enviar = useCallback(async () => {
    setEnviando(true);
    setErrorEnvio(null);
    try {
      if (pendientes.current) {
        const datos = pendientes.current;
        pendientes.current = null;
        await guardar(datos);
      }
      const res = await fetch("/api/descubrimiento/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorEnvio(data.error ?? "No se pudo enviar. Inténtalo otra vez.");
        return;
      }
      setEnviado(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErrorEnvio("No se pudo enviar. Revisa tu conexión e inténtalo otra vez.");
    } finally {
      setEnviando(false);
    }
  }, [token, guardar]);

  const enRevision = paso >= bloques.length;
  const bloque = enRevision ? null : bloques[paso];
  const sinContestar = useMemo(
    () => bloques.flatMap((b) => b.questions).filter((q) => !contestada(respuestas[q.id])),
    [bloques, respuestas],
  );

  if (enviado) {
    return (
      <div className="dx-wrap">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="dx-top">
          <div className="dx-top-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-horizontal-mono.svg" alt="FishFlow" />
          </div>
          <BarraAvance pct={100} />
        </div>
        <main className="dx-main">
          <div className="dx-done">
            <h1>Listo, {prospecto.split(" ")[0]}.</h1>
            <p>
              Ya tenemos tus respuestas. Las vamos a revisar antes de vernos, para llegar
              con propuestas concretas y no con preguntas que ya contestaste.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dx-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="dx-top">
        <div className="dx-top-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-horizontal-mono.svg" alt="FishFlow" />
          <div className="dx-who dx-mono">
            {prospecto}
            {organizacion ? ` · ${organizacion}` : ""}
            <br />
            {pct}% · {hechas} de {totalPreguntas}
          </div>
        </div>
        <BarraAvance pct={pct} />
      </div>

      <main className="dx-main">
        {paso === 0 && intro && (
          <div className="dx-intro">
            <h1>{nombreCuestionario}</h1>
            <p>{intro}</p>
          </div>
        )}

        {bloque && (
          <>
            <p className="dx-step dx-mono">
              {bloque.label} · {paso + 1} de {bloques.length}
            </p>
            <h2 className="dx-title">{bloque.title}</h2>

            {bloque.questions.map((q) => (
              <div className="dx-q" key={q.id}>
                <label className="dx-lab" htmlFor={q.id}>
                  {q.n && <span className="dx-n">{q.n}</span>}
                  {q.label}
                </label>
                {q.hint && <p className="dx-hint">{q.hint}</p>}
                {q.warning && (
                  <p className="dx-warn">
                    <b>Antes de la foto:</b> {q.warning}
                  </p>
                )}
                <Campo
                  q={q}
                  valor={respuestas[q.id]}
                  onChange={(v) => cambiar(q.id, v)}
                  foto={fotos[q.id]}
                  onFoto={subirFoto}
                />
              </div>
            ))}
          </>
        )}

        {enRevision && (
          <div className="dx-rev">
            <p className="dx-step dx-mono">Último paso</p>
            <h2 className="dx-title">Revisa y envía</h2>

            {bloques.map((b) => {
              const filas = b.questions.filter((q) => contestada(respuestas[q.id]));
              if (!filas.length) return null;
              return (
                <div key={b.id}>
                  <h2>{b.title}</h2>
                  <dl>
                    {filas.map((q) => (
                      <div className="dx-row" key={q.id}>
                        <dt className="dx-mono">{q.label}</dt>
                        <dd>{pinta(respuestas[q.id])}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}

            {sinContestar.length > 0 && (
              <>
                <h2>Quedó sin contestar ({sinContestar.length})</h2>
                <p className="dx-miss">
                  No es obligatorio contestar todo. Lo que dejes en blanco lo vemos juntos
                  en la sesión.
                </p>
                <p className="dx-miss">{sinContestar.map((q) => q.label).join(" · ")}</p>
                <button className="dx-link" onClick={() => irA(0)}>
                  Volver al principio
                </button>
              </>
            )}

            {errorEnvio && <p className="dx-err">{errorEnvio}</p>}
          </div>
        )}
      </main>

      <div className="dx-nav">
        <div className="dx-nav-in">
          {paso > 0 && (
            <button className="dx-btn dx-btn-2" onClick={() => irA(paso - 1)}>
              Atrás
            </button>
          )}
          <span className="dx-save dx-mono">
            {guardando
              ? "Guardando…"
              : guardadoEn
                ? `Guardado ${guardadoEn.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`
                : "Se guarda solo"}
          </span>
          {enRevision ? (
            <button className="dx-btn dx-btn-go" onClick={enviar} disabled={enviando}>
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          ) : (
            <button className="dx-btn dx-btn-1" onClick={() => irA(paso + 1)}>
              {paso === bloques.length - 1 ? "Revisar" : "Siguiente"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
