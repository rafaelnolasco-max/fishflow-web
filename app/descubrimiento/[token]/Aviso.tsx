// Pantalla de aviso del módulo Descubrimiento: liga vencida, liga inválida o
// cuestionario ya enviado. Misma marca que el resto de la pieza.

const C = {
  ink: "#0E2A36",
  dark: "#0A1820",
  paper: "#F4F1EA",
  orange: "#F26B17",
  muted: "#6B7B82",
  rule: "#E5E1D6",
};

export default function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: C.paper,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: "100%",
          background: "#fff",
          border: `1px solid ${C.rule}`,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div style={{ background: C.dark, padding: "20px 24px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-horizontal-mono.svg"
            alt="FishFlow"
            style={{ height: 22, filter: "brightness(0) invert(1)" }}
          />
        </div>
        <div style={{ padding: "26px 24px 28px" }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: C.ink,
              margin: "0 0 10px",
              letterSpacing: "-0.02em",
            }}
          >
            {titulo}
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: C.muted, margin: 0 }}>{texto}</p>
          <a
            href="mailto:raf@fishflow.mx"
            style={{
              display: "inline-block",
              marginTop: 20,
              fontFamily: "var(--ff-mono), ui-monospace, monospace",
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: C.orange,
              textDecoration: "none",
            }}
          >
            raf@fishflow.mx
          </a>
        </div>
      </div>
    </main>
  );
}
