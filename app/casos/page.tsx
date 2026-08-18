import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { CASOS_PUBLICOS } from "@/lib/casos";
import { CasoHeader, CasoFooter } from "@/components/casos/CasoChrome";

const EMAIL = "raf@fishflow.mx";

export const metadata: Metadata = {
  title: "Casos de éxito | FishFlow",
  description:
    "Negocios reales en México que operan con FishFlow: cómo estaban antes, qué implementamos y qué cambió. Sin cifras infladas.",
  alternates: { canonical: "https://fishflow.mx/casos" },
  openGraph: {
    title: "Casos de éxito | FishFlow",
    description:
      "Negocios reales en México que operan con FishFlow: cómo estaban antes, qué implementamos y qué cambió.",
    url: "https://fishflow.mx/casos",
    type: "website",
  },
};

function Monograma({ nombre }: { nombre: string }) {
  const iniciales = nombre
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-base font-bold text-primary">
      {iniciales}
    </div>
  );
}

export default function CasosIndex() {
  return (
    <div className="min-h-screen bg-background">
      <CasoHeader />

      <section className="px-4 md:px-0 py-16 md:py-20 bg-gradient-to-b from-secondary/40 to-white">
        <div className="container max-w-5xl mx-auto text-center">
          <span className="inline-block rounded-full border border-primary/30 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary mb-4">
            Casos de éxito
          </span>
          <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-4">
            Negocios reales, no demostraciones
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Tres clientes, tres problemas distintos. Aquí está cómo estaban antes, qué
            construimos y qué cambió — con los números que sí podemos comprobar.
          </p>
        </div>
      </section>

      <section className="px-4 md:px-0 pb-4">
        <div className="container max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {CASOS_PUBLICOS.map((caso) => (
            <Link
              key={caso.slug}
              href={`/casos/${caso.slug}`}
              className="group flex flex-col rounded-xl border border-primary/15 bg-white p-6 transition-all hover:border-primary/40 hover:shadow-xl"
            >
              <div className="mb-4 flex items-center gap-3">
                {caso.logo ? (
                  <Image
                    src={caso.logo}
                    alt={caso.cliente}
                    width={48}
                    height={48}
                    className="h-12 w-12 rounded-xl object-contain"
                  />
                ) : (
                  <Monograma nombre={caso.cliente} />
                )}
                <div>
                  <p className="font-bold leading-snug text-foreground">{caso.cliente}</p>
                  <p className="text-xs text-muted-foreground">{caso.sector}</p>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                <span className="w-fit rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
                  {caso.angulo}
                </span>
                {caso.propio && (
                  <span className="w-fit rounded-full border border-primary/30 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    Operación propia
                  </span>
                )}
              </div>

              <p className="mb-5 flex-1 text-sm text-muted-foreground">{caso.resumen}</p>

              <div className="mb-5 space-y-1.5">
                {caso.modulos.map((m) => (
                  <p key={m} className="flex items-center gap-2 text-xs text-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                    {m}
                  </p>
                ))}
              </div>

              <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
                Ver el caso completo
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="px-4 md:px-0 py-16">
        <div className="container max-w-3xl mx-auto rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-white to-accent/5 p-8 text-center md:p-12">
          <h2 className="mb-3 text-2xl md:text-3xl font-bold text-foreground">
            ¿Tu negocio se parece a alguno de estos?
          </h2>
          <p className="mx-auto mb-7 max-w-xl text-muted-foreground">
            El diagnóstico es una videollamada de 30 minutos, sin costo y sin compromiso.
            Salimos de ahí con una lista concreta de qué automatizar primero.
          </p>
          <a
            href={`mailto:${EMAIL}?subject=Quiero%20un%20diagn%C3%B3stico%20para%20mi%20negocio`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Agendar mi diagnóstico <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      <CasoFooter />
    </div>
  );
}
