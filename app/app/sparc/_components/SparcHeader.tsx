"use client";

/**
 * Encabezado del panel de SPARC con su marca (regla 4.1 de CLAUDE.md) y la
 * navegacion entre secciones. Compartido por /app/sparc y /app/sparc/cartera.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export const SPARC = {
  AZUL: "#0065A1",
  AZUL_900: "#00405F",
  AZUL_050: "#EDF5FA",
  VERDE: "#2C9A42",
  TINTA: "#0E1D28",
  GRIS: "#5C6E7C",
  LINEA: "#E1E9F0",
  PAPEL: "#F7FAFC",
  CLIENT_ID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
} as const;

const SECCIONES = [
  { href: "/app/sparc", label: "Prospectos" },
  { href: "/app/sparc/cartera", label: "Cartera" },
  { href: "/app/sparc/cobranza", label: "Cobranza" },
];

export function SparcFonts() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    </>
  );
}

export default function SparcHeader({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div style={{ background: "#fff", borderBottom: `1px solid ${SPARC.LINEA}`, padding: "12px 24px",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/clients/sparc/logo.png" alt="SPARC Administración" style={{ height: 46, width: "auto", display: "block" }} />
        <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", borderLeft: `1px solid ${SPARC.LINEA}`, paddingLeft: 14 }}>
          {SECCIONES.map((s) => {
            const ruta = (pathname ?? "").replace(/\/$/, "");
            const seccion = ruta.match(/\/(cartera|cobranza)$/)?.[1] ?? "";
            const activo = s.href === "/app/sparc" ? seccion === "" : s.href.endsWith("/" + seccion) && seccion !== "";
            return (
              <Link key={s.href} href={s.href}
                style={{ fontFamily: "'Jost', system-ui, sans-serif", fontSize: 15, textDecoration: "none",
                  padding: "6px 12px", borderRadius: 8,
                  color: activo ? SPARC.AZUL : SPARC.GRIS,
                  background: activo ? SPARC.AZUL_050 : "transparent",
                  fontWeight: activo ? 600 : 400 }}>
                {s.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 13, color: SPARC.GRIS }}>{userEmail}</span>
        <button onClick={handleLogout}
          style={{ background: "#fff", border: `1px solid ${SPARC.LINEA}`, color: SPARC.GRIS, borderRadius: 8,
            padding: "7px 14px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
          Salir
        </button>
      </div>
    </div>
  );
}
