"use client";

// app/o/[slug]/EncuestaQR.tsx
// Encuesta del canal QR. Seis pantallas, una sola pregunta obligatoria.
//
// Orden: P0 CSAT → P1 chips → P2 atribución → P3 comentario → P4 contacto →
//        P5 salida dual → P6 gracias
//
// La pregunta de atribución (P2) salió de analizar el cuestionario de Don Frank:
// es la única con ROI de marketing directo. Ver copy-canal-qr-moran.md.
//
// Regla dura: en P5 los dos botones se muestran SIEMPRE, con el mismo tamaño y
// en la misma pantalla, sin importar el CSAT. Condicionar el CTA de Google al
// sentimiento es review gating y viola la política de Google Maps.

import { useCallback, useEffect, useMemo, useState } from "react";

type Question = {
  id: string;
  position: number;
  kind: "rating" | "choice" | "multichoice" | "text";
  label_high: string | null;
  label_low: string | null;
  options: string[] | null;
  required: boolean;
};

type Config = {
  business: string;
  brandColor: string | null;
  logoUrl: string | null;
  privacyUrl: string | null;
  incentiveText: string | null;
  collectContact: boolean;
  reviewLink: string | null;
  touchpoint: { label: string; kind: string };
  questions: Question[];
};

const CARITAS = ["\u{1F620}", "\u{1F615}", "\u{1F610}", "\u{1F642}", "\u{1F929}"];
const PASOS = ["csat", "chips", "atribucion", "comentario", "contacto", "salida", "gracias"] as const;
type Paso = (typeof PASOS)[number];

export default function EncuestaQR({ slug }: { slug: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [paso, setPaso] = useState<Paso>("csat");
  const [csat, setCsat] = useState<number | null>(null);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [atribucion, setAtribucion] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [telefono, setTelefono] = useState("");
  const [consiente, setConsiente] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/o/${slug}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo cargar.");
        return j as Config;
      })
      .then((j) => vivo && setCfg(j))
      .catch((e: Error) => vivo && setFallo(e.message));
    return () => {
      vivo = false;
    };
  }, [slug]);

  const alto = (csat ?? 5) >= 4;

  const preguntaChips = useMemo(
    () => cfg?.questions.find((q) => q.kind === "multichoice") ?? null,
    [cfg],
  );
  const preguntaAtrib = useMemo(
    () => cfg?.questions.find((q) => q.kind === "choice") ?? null,
    [cfg],
  );
  const preguntaTexto = useMemo(
    () => cfg?.questions.find((q) => q.kind === "text") ?? null,
    [cfg],
  );

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const r = await fetch(`/api/o/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
    },
    [slug],
  );

  async function elegirCsat(n: number) {
    if (ocupado) return;
    setOcupado(true);
    setCsat(n);
    const j = await post({ action: "start", csat: n });
    if (j?.responseId) setResponseId(String(j.responseId));
    setOcupado(false);
    setPaso("chips");
  }

  async function guardarChips(saltar = false) {
    if (!saltar && seleccion.length && preguntaChips && responseId) {
      await post({
        action: "answers",
        responseId,
        answers: [{ questionId: preguntaChips.id, choice: seleccion }],
      });
    }
    setPaso("atribucion");
  }

  async function guardarAtribucion(valor: string | null) {
    setAtribucion(valor);
    if (valor && responseId) {
      await post({ action: "detail", responseId, attribution: valor });
      if (preguntaAtrib) {
        await post({
          action: "answers",
          responseId,
          answers: [{ questionId: preguntaAtrib.id, text: valor }],
        });
      }
    }
    setPaso("comentario");
  }

  async function guardarComentario(saltar = false) {
    const texto = comentario.trim();
    if (!saltar && texto && responseId) {
      await post({ action: "detail", responseId, comment: texto });
      if (preguntaTexto) {
        await post({
          action: "answers",
          responseId,
          answers: [{ questionId: preguntaTexto.id, text: texto }],
        });
      }
    }
    setPaso(cfg?.collectContact ? "contacto" : "salida");
  }

  async function guardarContacto(saltar = false) {
    if (!saltar && consiente && telefono.trim() && responseId) {
      await post({ action: "contact", responseId, phone: telefono, consent: true });
    }
    setPaso("salida");
  }

  async function terminar(outcome: "google" | "private") {
    if (responseId) await post({ action: "finish", responseId, outcome });
    if (outcome === "google" && cfg?.reviewLink) {
      window.open(cfg.reviewLink, "_blank", "noopener,noreferrer");
    }
    setPaso("gracias");
  }

  if (fallo) {
    return (
      <Marco titulo="Código no válido" color={null} logo={null} sub={null} progreso={0}>
        <p className="q">{fallo}</p>
      </Marco>
    );
  }
  if (!cfg) {
    return (
      <Marco titulo="Cargando" color={null} logo={null} sub={null} progreso={0}>
        <p className="q">Un momento…</p>
      </Marco>
    );
  }

  const color = cfg.brandColor ?? "#C9741F";
  const idx = PASOS.indexOf(paso);
  const progreso = (idx / (PASOS.length - 1)) * 100;

  return (
    <Marco
      titulo={cfg.business}
      sub={cfg.touchpoint.label}
      color={color}
      logo={cfg.logoUrl}
      progreso={progreso}
    >
      {paso === "csat" && (
        <>
          <div className="eyebrow">Un toque</div>
          <h2>¿Cómo estuvo tu visita?</h2>
          <p className="q">Nos ayuda a cuidar lo que hacemos bien y arreglar lo que no.</p>
          <div className="csat">
            {CARITAS.map((cara, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Calificar con ${i + 1} de 5`}
                onClick={() => void elegirCsat(i + 1)}
                disabled={ocupado}
              >
                <span className="face">{cara}</span>
                <span className="n">{i + 1}</span>
              </button>
            ))}
          </div>
          <div className="anchors">
            <span>Mal</span>
            <span>Excelente</span>
          </div>
          <div className="foot">Toma menos de un minuto</div>
        </>
      )}

      {paso === "chips" && preguntaChips && (
        <>
          <div className="eyebrow">Calificaste {csat} de 5</div>
          <h2>{(alto ? preguntaChips.label_high : preguntaChips.label_low) ?? "¿Qué tal todo?"}</h2>
          <p className="q">Puedes elegir más de una. Opcional.</p>
          <div className="chips">
            {(preguntaChips.options ?? []).map((o) => (
              <button
                key={o}
                type="button"
                className={seleccion.includes(o) ? "chip sel" : "chip"}
                onClick={() =>
                  setSeleccion((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]))
                }
              >
                {o}
              </button>
            ))}
          </div>
          <button className="btn btn--dark" onClick={() => void guardarChips()}>
            Continuar
          </button>
          <button className="skip" onClick={() => void guardarChips(true)}>
            Saltar
          </button>
        </>
      )}

      {paso === "atribucion" && preguntaAtrib && (
        <>
          <div className="eyebrow">Opcional</div>
          <h2>{preguntaAtrib.label_high ?? "¿Cómo llegaste hoy?"}</h2>
          <p className="q">Nos dice dónde vale la pena poner esfuerzo.</p>
          <div className="opciones">
            {(preguntaAtrib.options ?? []).map((o) => (
              <button
                key={o}
                type="button"
                className={atribucion === o ? "opcion sel" : "opcion"}
                onClick={() => void guardarAtribucion(o)}
              >
                {o}
              </button>
            ))}
          </div>
          <button className="skip" onClick={() => void guardarAtribucion(null)}>
            Saltar
          </button>
        </>
      )}

      {paso === "comentario" && (
        <>
          <div className="eyebrow">Opcional</div>
          <h2>{(alto ? preguntaTexto?.label_high : preguntaTexto?.label_low) ?? "¿Nos cuentas más?"}</h2>
          <p className="q">
            {alto
              ? "Lo que escribas lo lee el equipo, no un robot."
              : "Entre más claro nos lo digas, mejor lo arreglamos."}
          </p>
          <textarea
            className="field"
            rows={3}
            maxLength={2000}
            placeholder="Escríbelo en pocas palabras"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
          <button className="btn btn--dark" onClick={() => void guardarComentario()}>
            Continuar
          </button>
          <button className="skip" onClick={() => void guardarComentario(true)}>
            Saltar
          </button>
        </>
      )}

      {paso === "contacto" && (
        <>
          <div className="eyebrow">Opcional</div>
          <h2>¿Te avisamos de lo nuevo?</h2>
          {cfg.incentiveText && (
            <div className="perk">
              <b>{cfg.incentiveText}</b>
              <br />
              Ya es tuyo, hayas calificado como hayas calificado.
            </div>
          )}
          <div className="label">WhatsApp</div>
          <input
            className="field"
            inputMode="numeric"
            maxLength={16}
            placeholder="10 dígitos"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
          />
          <label className="consent">
            <input
              type="checkbox"
              checked={consiente}
              onChange={(e) => setConsiente(e.target.checked)}
            />
            <span>
              Acepto que {cfg.business} me escriba sobre novedades y promociones.{" "}
              {cfg.privacyUrl && (
                <a href={cfg.privacyUrl} target="_blank" rel="noopener noreferrer">
                  Aviso de privacidad
                </a>
              )}
            </span>
          </label>
          <button className="btn btn--dark" onClick={() => void guardarContacto()}>
            Continuar
          </button>
          <button className="skip" onClick={() => void guardarContacto(true)}>
            Saltar
          </button>
        </>
      )}

      {paso === "salida" && (
        <>
          <div className="eyebrow">Último paso</div>
          <h2>{alto ? "Gracias por contarnos" : "Perdón, así no debió ser"}</h2>
          <p className="q">¿Dónde quieres dejar tu opinión?</p>
          {/* Los dos botones van siempre juntos y del mismo tamaño. No condicionar
              por CSAT: eso sería review gating. */}
          <div className="dual">
            {cfg.reviewLink && (
              <button className="btn btn--google" onClick={() => void terminar("google")}>
                <span className="g">G</span> Publicar mi opinión en Google
              </button>
            )}
            <button className="btn btn--out" onClick={() => void terminar("private")}>
              Enviar solo al equipo de {cfg.business}
            </button>
          </div>
          <div className="foot">Los dos botones aparecen siempre, con cualquier calificación.</div>
        </>
      )}

      {paso === "gracias" && (
        <>
          <div className="ok">&#10003;</div>
          <h2 style={{ textAlign: "center" }}>Listo, gracias</h2>
          <p className="q" style={{ textAlign: "center" }}>
            {alto
              ? "Tu opinión ya le llegó al equipo."
              : "Tu mensaje ya le llegó al dueño. Si nos dejaste WhatsApp, te buscamos hoy."}
          </p>
          {consiente && telefono.trim() && cfg.incentiveText && (
            <div className="perk" style={{ textAlign: "center" }}>
              Te lo mandamos por WhatsApp.
            </div>
          )}
          <div className="foot">{cfg.business} · Automatizado por FishFlow</div>
        </>
      )}
    </Marco>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Marco visual. Estilos inline en el componente para que la ruta pública no
// dependa del sistema de la app (esto lo abre gente en la calle, con su datos).
// ─────────────────────────────────────────────────────────────────────────────
function Marco({
  titulo,
  sub,
  color,
  logo,
  progreso,
  children,
}: {
  titulo: string;
  sub: string | null;
  color: string | null;
  logo: string | null;
  progreso: number;
  children: React.ReactNode;
}) {
  const c = color ?? "#C9741F";
  return (
    <>
      <style>{CSS.replace(/__ACENTO__/g, c)}</style>
      <main className="wrap">
        <div className="card">
          <header className="brandbar">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={titulo} className="logo-img" />
            ) : (
              <div className="logo">{titulo}</div>
            )}
            {sub && <div className="sub">{sub}</div>}
          </header>
          <div className="progress">
            <i style={{ width: `${progreso}%` }} />
          </div>
          <section className="pane">{children}</section>
        </div>
      </main>
    </>
  );
}

const CSS = `
*{box-sizing:border-box}
*,*::before,*::after{min-width:0}
html,body{margin:0;padding:0;overflow-x:hidden;max-width:100%;
  background:#241811;
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
img{max-width:100%;display:block;height:auto}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{width:100%;max-width:440px;background:#F6EFE5;color:#2E1F17;border-radius:22px;
  overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.35);display:flex;flex-direction:column;
  min-height:min(620px,92vh)}
.brandbar{background:#2E1F17;padding:18px 22px;text-align:center}
.logo{font-size:22px;font-weight:800;letter-spacing:-.01em;color:#F6EFE5}
.logo-img{max-height:44px;margin:0 auto}
.sub{font-size:10px;letter-spacing:.2em;text-transform:uppercase;
  color:rgba(246,239,229,.5);margin-top:4px}
.progress{height:3px;background:#EFE4D5}
.progress i{display:block;height:100%;background:__ACENTO__;transition:width .3s ease}
.pane{padding:26px 22px 24px;flex:1;display:flex;flex-direction:column}
.eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;font-weight:700;
  color:__ACENTO__;margin-bottom:8px}
h2{font-size:21px;line-height:1.2;letter-spacing:-.015em;margin:0 0 6px;font-weight:800}
.q{font-size:15px;line-height:1.45;margin:0 0 18px;color:#4A3527}
.foot{margin-top:auto;padding-top:16px;font-size:11.5px;color:rgba(46,31,23,.5);text-align:center}
.csat{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:8px 0 10px}
.csat button{aspect-ratio:1;border:1.5px solid rgba(46,31,23,.14);background:#fff;
  border-radius:14px;cursor:pointer;font-family:inherit;display:grid;place-items:center;
  gap:2px;padding:4px;transition:transform .12s ease,border-color .12s ease}
.csat button:hover{border-color:__ACENTO__;transform:translateY(-3px)}
.csat button:disabled{opacity:.5}
.face{font-size:26px;line-height:1}
.n{font-size:10px;font-weight:700;color:rgba(46,31,23,.45)}
.anchors{display:flex;justify-content:space-between;font-size:11px;color:rgba(46,31,23,.55)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
.chip{border:1.5px solid rgba(46,31,23,.14);background:#fff;border-radius:999px;
  padding:9px 15px;font-size:13.5px;font-weight:600;color:#4A3527;cursor:pointer;
  font-family:inherit;transition:all .14s ease}
.chip:hover{border-color:__ACENTO__}
.chip.sel{background:#2E1F17;border-color:#2E1F17;color:#F6EFE5}
.opciones{display:grid;gap:9px;margin-bottom:14px}
.opcion{border:1.5px solid rgba(46,31,23,.14);background:#fff;border-radius:12px;
  padding:14px 16px;font-size:14.5px;font-weight:600;color:#2E1F17;cursor:pointer;
  font-family:inherit;text-align:left;transition:all .14s ease}
.opcion:hover{border-color:__ACENTO__}
.opcion.sel{background:#2E1F17;border-color:#2E1F17;color:#F6EFE5}
.field{width:100%;border:1.5px solid rgba(46,31,23,.14);border-radius:12px;background:#fff;
  padding:13px 14px;font-size:15px;font-family:inherit;color:#2E1F17;margin-bottom:14px;
  resize:vertical}
.field:focus{outline:none;border-color:__ACENTO__}
.label{font-size:13.5px;font-weight:700;margin-bottom:8px}
.consent{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;line-height:1.45;
  color:rgba(46,31,23,.72);margin-bottom:16px}
.consent input{margin-top:2px;width:17px;height:17px;accent-color:__ACENTO__;flex:none}
.consent a{color:__ACENTO__}
.perk{background:#EFE4D5;border:1px dashed __ACENTO__;border-radius:14px;padding:14px 16px;
  margin-bottom:16px;font-size:13.5px;line-height:1.5;color:#4A3527}
.btn{display:block;width:100%;border:none;border-radius:12px;padding:15px;font-size:15px;
  font-weight:700;font-family:inherit;cursor:pointer;text-align:center}
.btn:hover{filter:brightness(1.07)}
.btn--dark{background:#2E1F17;color:#F6EFE5}
.btn--out{background:#fff;color:#2E1F17;border:1.5px solid #2E1F17}
.btn--google{background:#fff;color:#1F1F1F;border:1.5px solid rgba(46,31,23,.14);
  display:flex;align-items:center;justify-content:center;gap:9px}
.btn--google .g{font-weight:800;font-size:17px;
  background:linear-gradient(90deg,#4285F4,#EA4335 35%,#FBBC05 65%,#34A853);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.dual{display:grid;gap:10px}
.skip{display:block;width:100%;background:none;border:none;text-align:center;margin-top:10px;
  font-size:13.5px;color:rgba(46,31,23,.55);cursor:pointer;font-family:inherit;
  text-decoration:underline}
.ok{width:54px;height:54px;border-radius:50%;background:#2E7D5B;color:#fff;display:grid;
  place-items:center;font-size:27px;margin:6px auto 14px}
@media(max-width:600px){.wrap{padding:0}.card{border-radius:0;min-height:100vh;max-width:100%}}
`;
