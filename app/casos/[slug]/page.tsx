import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowLeft, CheckCircle2, Clock, ExternalLink, MapPin, Quote } from "lucide-react";
import { CASOS, CASOS_PUBLICOS, getCaso } from "@/lib/casos";
import { CasoHeader, CasoFooter } from "@/components/casos/CasoChrome";

const EMAIL = "raf@fishflow.mx";

export function generateStaticParams() {
  return CASOS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const caso = getCaso(slug);
  if (!caso) return { title: "Caso no encontrado | FishFlow" };

  const title = `${caso.cliente} — caso de éxito | FishFlow`;
  return {
    title,
    description: caso.resumen,
    alternates: { canonical: `https://fishflow.mx/casos/${caso.slug}` },
    openGraph: {
      title,
      description: caso.resumen,
      url: `https://fishflow.mx/casos/${caso.slug}`,
      type: "article",
    },
  };
}

export default async function CasoDetalle({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const caso = getCaso(slug);
  if (!caso) notFound();

  const otros = CASOS_PUBLICOS.filter((c) => c.slug !== caso.slug);

  return (
    <div className="min-h-screen bg-background">
      <CasoHeader />

      {/* 1 · Quién es */}
      <section className="px-4 md:px-0 py-14 md:py-16 bg-gradient-to-b from-secondary/40 to-white">
        <div className="container max-w-3xl mx-auto">
          <Link
            href="/casos"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Todos los casos
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {caso.logo && (
              <Image
                src={caso.logo}
                alt={caso.cliente}
                width={72}
                height={72}
                className="h-16 w-16 rounded-xl object-contain"
              />
            )}
            <div>
              <div className="mb-2 flex flex-wrap gap-2">
                <span className="inline-block rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
                  {caso.angulo}
                </span>
                {caso.propio && (
                  <span className="inline-block rounded-full border border-primary/30 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    Operación propia
                  </span>
                )}
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground">{caso.cliente}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{caso.sector}</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {caso.ciudad}
                </span>
              </p>
            </div>
          </div>

          <p className="mt-6 text-lg text-foreground">{caso.resumen}</p>

          {caso.propio && (
            <p className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
              <strong className="text-foreground">Transparencia:</strong> FishFlow es socio de esta
              operación. Lo publicamos porque es donde corremos primero lo que después le vendemos a
              terceros — pero no es un cliente externo y preferimos decirlo.
            </p>
          )}

          {caso.sitio && (
            <a
              href={caso.sitio}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80"
            >
              Ver su sitio <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </section>

      {/* 2 · Cómo estaba antes */}
      <section className="px-4 md:px-0 py-12">
        <div className="container max-w-3xl mx-auto">
          <h2 className="mb-5 text-2xl font-bold text-foreground">Cómo estaba antes</h2>
          <ul className="space-y-3">
            {caso.antes.map((a) => (
              <li key={a} className="flex gap-3 rounded-lg bg-secondary/50 p-4 text-sm text-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3 · Qué implementamos */}
      <section className="px-4 md:px-0 py-12 bg-secondary/30">
        <div className="container max-w-3xl mx-auto">
          <h2 className="mb-5 text-2xl font-bold text-foreground">Qué implementamos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {caso.implementado.map((i) => (
              <div key={i.t} className="rounded-xl border border-primary/15 bg-white p-5">
                <div className="mb-2 flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <p className="font-semibold leading-snug text-foreground">{i.t}</p>
                </div>
                <p className="text-sm text-muted-foreground">{i.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4 · Resultado */}
      <section className="px-4 md:px-0 py-12">
        <div className="container max-w-3xl mx-auto">
          <h2 className="mb-5 text-2xl font-bold text-foreground">Qué cambió</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {caso.resultados.map((r) => (
              <div
                key={r.label}
                className="rounded-xl border border-accent/25 bg-gradient-to-br from-accent/10 to-transparent p-5"
              >
                <p className="text-3xl font-extrabold text-accent">{r.valor}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{r.label}</p>
                {r.nota && <p className="mt-1 text-xs text-muted-foreground">{r.nota}</p>}
              </div>
            ))}
          </div>

          {caso.medicionEnCurso && (
            <div className="mt-5 flex gap-3 rounded-xl border border-primary/25 bg-primary/5 p-5">
              <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
              <div>
                <p className="mb-1 text-sm font-semibold text-foreground">Medición en curso</p>
                <p className="text-sm text-muted-foreground">{caso.medicionEnCurso}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 5 · Cita del cliente */}
      {caso.cita && (
        <section className="px-4 md:px-0 py-12 bg-secondary/30">
          <div className="container max-w-3xl mx-auto">
            <blockquote className="rounded-2xl border border-primary/15 bg-white p-8">
              <Quote className="mb-3 h-7 w-7 text-primary/40" />
              <p className="text-lg leading-relaxed text-foreground">{caso.cita.texto}</p>
              <footer className="mt-5 text-sm">
                <p className="font-semibold text-foreground">{caso.cita.autor}</p>
                <p className="text-muted-foreground">{caso.cita.puesto}</p>
              </footer>
            </blockquote>
          </div>
        </section>
      )}

      {/* 6 · CTA */}
      <section className="px-4 md:px-0 py-14">
        <div className="container max-w-3xl mx-auto rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-white to-accent/5 p-8 text-center md:p-12">
          <h2 className="mb-3 text-2xl md:text-3xl font-bold text-foreground">
            Quiero esto para mi negocio
          </h2>
          <p className="mx-auto mb-7 max-w-xl text-muted-foreground">
            Empezamos con un diagnóstico de 30 minutos, sin costo. Salimos con una lista
            concreta de qué conviene automatizar primero en tu caso.
          </p>
          <a
            href={`mailto:${EMAIL}?subject=Quiero%20un%20diagn%C3%B3stico%20para%20mi%20negocio`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Agendar mi diagnóstico <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Otros casos */}
      <section className="px-4 md:px-0 pb-8">
        <div className="container max-w-3xl mx-auto">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Otros casos
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {otros.map((o) => (
              <Link
                key={o.slug}
                href={`/casos/${o.slug}`}
                className="group rounded-xl border border-primary/15 bg-white p-5 transition-all hover:border-primary/40 hover:shadow-lg"
              >
                <p className="font-semibold text-foreground">{o.cliente}</p>
                <p className="mt-1 text-xs text-muted-foreground">{o.angulo}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  Ver caso
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CasoFooter />
    </div>
  );
}
