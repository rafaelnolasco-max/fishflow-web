"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Trufa — recortar la foto de perfil ───────────────────────────────────────
// Una foto de teléfono es vertical; la portada es un círculo. Sin recorte, el
// perro queda en una esquina y la cara fuera del encuadre.
//
// Sin librería: son cuarenta líneas de transformaciones y meter un paquete de
// recorte por esto engorda el bundle de toda la app.
//
// La clave está en que la vista previa y el canvas usen EXACTAMENTE la misma
// transformación. La previa pinta la imagen a `base` px con
// `translate(tx,ty) scale(escala)` y origen 0 0; el canvas repite eso mismo
// multiplicado por SALIDA/VISTA. Si se calcularan por separado, lo que la
// persona encuadra y lo que se guarda no coinciden — que es como se ven mal
// casi todos los recortadores hechos a mano.

const VISTA = 280;   // lado del recuadro en pantalla
const SALIDA = 800;  // lado del archivo final
const ZOOM_MAX = 4;

type Tema = { accent: string; surface: string; border: string; text: string; muted: string; panel?: string };

export default function RecortarFoto({
  file, onCancel, onListo, theme: t,
}: {
  file: File;
  onCancel: () => void;
  onListo: (blob: Blob) => Promise<void> | void;
  theme: Tema;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [base, setBase] = useState({ w: VISTA, h: VISTA });
  const [escala, setEscala] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const viewRef = useRef<HTMLDivElement | null>(null);
  const urlRef = useRef<string>("");
  const gesto = useRef<{ tipo: "none" | "pan" | "pinch"; x: number; y: number; dist: number; escala: number }>(
    { tipo: "none", x: 0, y: 0, dist: 0, escala: 1 },
  );

  // ── Cargar y encuadrar por primera vez (la imagen CUBRE el recuadro) ──────
  useEffect(() => {
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    const im = new Image();
    im.onload = () => {
      const cubrir = Math.max(VISTA / im.naturalWidth, VISTA / im.naturalHeight);
      const w = im.naturalWidth * cubrir;
      const h = im.naturalHeight * cubrir;
      setBase({ w, h });
      setPos({ x: (VISTA - w) / 2, y: (VISTA - h) / 2 });
      setEscala(1);
      setImg(im);
    };
    im.onerror = () => setError("No se pudo abrir esa imagen.");
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** La imagen nunca puede dejar hueco: el recuadro siempre queda cubierto. */
  const limitar = useCallback((x: number, y: number, s: number) => {
    const w = base.w * s;
    const h = base.h * s;
    return {
      x: Math.min(0, Math.max(VISTA - w, x)),
      y: Math.min(0, Math.max(VISTA - h, y)),
    };
  }, [base]);

  /** Zoom anclado a un punto: lo que está bajo los dedos se queda ahí. */
  const zoomEn = useCallback((nueva: number, px: number, py: number) => {
    setEscala((prev) => {
      const s = Math.min(ZOOM_MAX, Math.max(1, nueva));
      setPos((p) => limitar(px - ((px - p.x) / prev) * s, py - ((py - p.y) / prev) * s, s));
      return s;
    });
  }, [limitar]);

  // ── Gestos. Van con addEventListener y no con props de React porque hay que
  //    llamar preventDefault, y en móvil esos listeners son pasivos por default:
  //    sin esto, Safari hace zoom a la PÁGINA en vez de a la foto.
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !img) return;

    const dist = (t1: Touch, t2: Touch) =>
      Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    function onStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        gesto.current = {
          tipo: "pinch", dist: dist(e.touches[0], e.touches[1]), escala,
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      } else if (e.touches.length === 1) {
        gesto.current = { tipo: "pan", x: e.touches[0].clientX, y: e.touches[0].clientY, dist: 0, escala };
      }
    }

    function onMove(e: TouchEvent) {
      const g = gesto.current;
      const caja = el!.getBoundingClientRect();
      if (g.tipo === "pinch" && e.touches.length === 2) {
        e.preventDefault();
        const d = dist(e.touches[0], e.touches[1]);
        if (g.dist > 0) {
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - caja.left;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - caja.top;
          zoomEn(g.escala * (d / g.dist), cx, cy);
        }
      } else if (g.tipo === "pan" && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - g.x;
        const dy = e.touches[0].clientY - g.y;
        gesto.current = { ...g, x: e.touches[0].clientX, y: e.touches[0].clientY };
        setPos((p) => limitar(p.x + dx, p.y + dy, escala));
      }
    }

    function onEnd() { gesto.current = { ...gesto.current, tipo: "none" }; }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const caja = el!.getBoundingClientRect();
      zoomEn(escala * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - caja.left, e.clientY - caja.top);
    }

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [img, escala, limitar, zoomEn]);

  // ── Arrastre con ratón ────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    const inicio = { x: e.clientX, y: e.clientY };
    const mover = (ev: MouseEvent) => {
      const dx = ev.clientX - inicio.x;
      const dy = ev.clientY - inicio.y;
      inicio.x = ev.clientX; inicio.y = ev.clientY;
      setPos((p) => limitar(p.x + dx, p.y + dy, escala));
    };
    const soltar = () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
    };
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
  }

  // ── Exportar con la MISMA transformación de la vista previa ───────────────
  async function guardar() {
    if (!img) return;
    setGuardando(true); setError("");
    try {
      const k = SALIDA / VISTA;
      const canvas = document.createElement("canvas");
      canvas.width = SALIDA; canvas.height = SALIDA;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Tu navegador no pudo procesar la imagen.");
      ctx.imageSmoothingQuality = "high";
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.translate(pos.x, pos.y);
      ctx.scale(escala, escala);
      ctx.drawImage(img, 0, 0, base.w, base.h);

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
      if (!blob) throw new Error("No se pudo generar la foto.");
      await onListo(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el recorte.");
      setGuardando(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(31,23,20,.9)", zIndex: 70,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 20, gap: 18 }}>
      <div style={{ font: "700 16px/1.3 -apple-system, sans-serif", color: "#F6F0E8", textAlign: "center" }}>
        Acomoda la foto
        <div style={{ font: "400 13px/1.5 -apple-system, sans-serif", color: "rgba(246,240,232,.72)", marginTop: 5 }}>
          Arrastra para mover. Pellizca con dos dedos para acercar.
        </div>
      </div>

      <div
        ref={viewRef}
        onMouseDown={onMouseDown}
        style={{ width: VISTA, height: VISTA, maxWidth: "86vw", maxHeight: "86vw",
          position: "relative", overflow: "hidden", borderRadius: "50%",
          background: "#2A211D", touchAction: "none", cursor: "grab",
          boxShadow: "0 0 0 2px rgba(246,240,232,.35)" }}
      >
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={urlRef.current}
            alt=""
            draggable={false}
            style={{ position: "absolute", top: 0, left: 0,
              width: base.w, height: base.h,
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${escala})`,
              transformOrigin: "0 0", userSelect: "none", pointerEvents: "none" }}
          />
        )}
      </div>

      {/* Control deslizante: en escritorio no hay pinch, y hay quien no lo acierta. */}
      <input
        type="range" min={1} max={ZOOM_MAX} step={0.02} value={escala}
        aria-label="Acercar"
        onChange={(e) => zoomEn(Number(e.target.value), VISTA / 2, VISTA / 2)}
        style={{ width: Math.min(VISTA, 280), accentColor: t.accent }}
      />

      {error && (
        <div style={{ font: "400 13px/1.5 -apple-system, sans-serif", color: "#F3B9A4", maxWidth: 300, textAlign: "center" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onCancel} disabled={guardando}
          style={{ padding: "12px 22px", borderRadius: 10, border: "1px solid rgba(246,240,232,.3)",
            background: "transparent", color: "#F6F0E8", font: "600 14px/1 -apple-system, sans-serif",
            cursor: "pointer" }}>
          Cancelar
        </button>
        <button onClick={guardar} disabled={guardando || !img}
          style={{ padding: "12px 26px", borderRadius: 10, border: "none",
            background: guardando ? "#8E7D6D" : t.accent, color: "#FFF4EC",
            font: "800 14px/1 -apple-system, sans-serif", cursor: guardando ? "default" : "pointer" }}>
          {guardando ? "Guardando…" : "Usar esta foto"}
        </button>
      </div>
    </div>
  );
}
