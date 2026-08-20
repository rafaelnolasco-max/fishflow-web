// app/promo/[code]/opengraph-image.tsx
// La imagen que WhatsApp pinta debajo del enlace. Esto es lo que convierte un
// mensaje de texto en algo que se ve como flyer, sin la API de Meta y sin
// pedirle al dueño que adjunte nada a mano.
//
// Se genera con next/og en cada petición: oferta, código, vigencia y color de
// marca cambian por cupón, así que no hay imagen que preparar ni almacenar.
//
// Dos reglas de Satori que aquí se cumplen a rajatabla, porque romperlas no da
// error de compilación sino una imagen mal armada:
//   1. TODO div con más de un hijo lleva display:flex explícito. Un texto
//      partido por una expresión ya cuenta como varios hijos.
//   2. Nada de fragmentos (<>): se aplanan mal y el layout en columna termina
//      pintándose en fila. Cada bloque va dentro de su propio div.
// Sin emoji ni fuentes externas: lo que no carga aquí no degrada elegante,
// sale como cuadrito.

import { ImageResponse } from "next/og";
import { cuponPorCodigo, estaVigente } from "./page";

export const runtime = "nodejs";
export const alt = "Tu cupón";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric", month: "long", timeZone: "America/Mexico_City",
  });
}

const columna = {
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
};

export default async function Imagen({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const cupon = await cuponPorCodigo(code);
  const marca = cupon?.brand_color ?? "#C9741F";
  const vigente = cupon ? estaVigente(cupon) : false;

  const cuerpo = !cupon ? (
    <div style={{ ...columna, fontSize: 54, fontWeight: 700 }}>Cupón no válido</div>
  ) : (
    <div style={{ ...columna, width: "100%" }}>
      <div style={{ ...columna, fontSize: 26, letterSpacing: 6, opacity: 0.85 }}>
        {cupon.business.toUpperCase()}
      </div>
      <div
        style={{
          ...columna, fontSize: 68, fontWeight: 800, marginTop: 18, marginBottom: 34,
          textAlign: "center", lineHeight: 1.1, maxWidth: 1000,
        }}
      >
        {cupon.offer_label}
      </div>
      {vigente ? (
        <div style={{ ...columna, width: "100%" }}>
          <div
            style={{
              ...columna, background: "#ffffff", color: marca, borderRadius: 26,
              padding: "26px 60px", fontSize: 92, fontWeight: 800, letterSpacing: 16,
            }}
          >
            {cupon.code}
          </div>
          <div style={{ ...columna, fontSize: 30, marginTop: 30, opacity: 0.9 }}>
            {`Vence el ${fechaCorta(cupon.expires_at)} · un solo uso`}
          </div>
        </div>
      ) : (
        <div style={{ ...columna, fontSize: 40, opacity: 0.9 }}>
          {cupon.state === "canjeado" ? "Cupón ya utilizado" : "Cupón vencido"}
        </div>
      )}
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          ...columna, width: "100%", height: "100%", background: marca,
          color: "#ffffff", fontFamily: "sans-serif", padding: 60,
        }}
      >
        {cuerpo}
      </div>
    ),
    size,
  );
}
