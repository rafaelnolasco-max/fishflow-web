"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Image from "next/image";
import {
  Mail,
  ArrowRight,
  CheckCircle2,
  Zap,
  Users,
  TrendingUp,
  Sparkles,
  MessageSquare,
  Calendar,
  Database,
  ShieldCheck,
  Bot,
  Rocket,
  Search,
  PenTool,
  Cog,
  Activity,
  ShoppingBag,
  Camera,
  Shirt,
  ExternalLink,
  MapPin,
} from "lucide-react";
import { useEffect, useState } from "react";

const EMAIL = "rafaelnolasco@gmail.com";
const MAILTO_GENERIC = `mailto:${EMAIL}?subject=Quiero%20conocer%20m%C3%A1s%20de%20FishFlow`;
const MAILTO_DEMO = `mailto:${EMAIL}?subject=Agendemos%20una%20llamada%20-%20FishFlow&body=Hola%20Rafa%2C%20me%20gustar%C3%ADa%20agendar%20una%20llamada%20para%20conocer%20FishFlow.`;

export default function Home() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-white">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className={`fixed top-0 w-full z-50 transition-all duration-300 ${
          scrolled ? "bg-white shadow-md" : "bg-white/85 backdrop-blur-sm"
        }`}
      >
        <nav className="container flex items-center justify-between h-16">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex items-center gap-2"
            aria-label="FishFlow inicio"
          >
            {/* logo-horizontal: Tide Cyan + Tide Orange sobre fondo claro */}
            <Image
              src="/logo-horizontal.svg"
              alt="FishFlow"
              width={140}
              height={40}
              priority
              className="h-9 w-auto"
            />
          </button>

          <div className="hidden md:flex items-center gap-7">
            {[
              { label: "Cómo funciona", id: "how" },
              { label: "Servicios",     id: "services" },
              { label: "Verticales",    id: "verticals" },
              { label: "Por qué FishFlow", id: "why" },
              { label: "FAQ",           id: "faq" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>

          <Button
            onClick={() => scrollToSection("contact")}
            className="bg-primary hover:bg-primary/90 text-white"
            size="sm"
          >
            Conectar
          </Button>
        </nav>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="pt-28 pb-20 px-4 md:px-0 relative overflow-hidden">

        {/* Glows de fondo */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-10 right-[15%] w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-10 left-[10%] w-80 h-80 bg-accent/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
        </div>

        <div className="container max-w-5xl mx-auto">

          {/* Layout: texto izquierda + logo derecha en desktop */}
          <div className="flex flex-col-reverse md:flex-row items-center gap-10 md:gap-16">

            {/* Columna de texto */}
            <div className="flex-1 text-center md:text-left">
              <Badge className="mb-5 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 inline-flex">
                <MapPin className="w-3 h-3 mr-1" /> Hecho en México · Para PyMES locales
              </Badge>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-5 text-foreground leading-tight">
                Automatización inteligente para tu{" "}
                <span className="text-primary">negocio local</span>
              </h1>

              <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-xl">
                Tintorerías, fotógrafos, estéticas, productores… damos a tu micro PyME el mismo poder
                digital que las grandes: WhatsApp automático, agenda online, contenido con IA y
                reportes en tiempo real.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start mb-10">
                <Button
                  onClick={() => scrollToSection("contact")}
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-white"
                >
                  Agendar diagnóstico gratis <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button onClick={() => scrollToSection("verticals")} variant="outline" size="lg">
                  Ver demos por industria
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row gap-6 justify-center md:justify-start">
                {[
                  { icon: Zap,        label: "Implementación rápida"  },
                  { icon: Bot,        label: "Impulsado por IA"       },
                  { icon: TrendingUp, label: "Crecimiento escalable"  },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon className="h-4 w-4 text-primary shrink-0" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Logo vertical — elemento visual principal */}
            <div className="flex-shrink-0 flex items-center justify-center">
              <div className="relative">
                {/* Halo detrás del logo */}
                <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl scale-125" />
                <Image
                  src="/logo-vertical.svg"
                  alt="FishFlow"
                  width={220}
                  height={220}
                  priority
                  className="relative w-48 md:w-56 h-auto drop-shadow-lg"
                />
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── Cómo funciona ───────────────────────────────────────────────── */}
      <section id="how" className="py-20 px-4 md:px-0 bg-secondary/40">
        <div className="container max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Proceso</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">Cómo funciona FishFlow</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Un proceso claro de cuatro pasos. Sin sorpresas, sin contratos largos, sin tecnicismos.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { step: "01", icon: Search,  title: "Diagnóstico",        desc: "Llamada inicial gratuita: revisamos tu operación, identificamos cuellos de botella y proponemos qué automatizar primero." },
              { step: "02", icon: PenTool, title: "Mockup a la medida", desc: "Diseñamos un mockup funcional pensado para tu vertical (estética, fotógrafo, tintorería) y lo aprobamos juntos." },
              { step: "03", icon: Cog,     title: "Implementación",     desc: "Conectamos WhatsApp, agenda, base de datos y dashboards. Migramos tus clientes y capacitamos al equipo." },
              { step: "04", icon: Activity,title: "Operación y mejora", desc: "Monitoreamos métricas, te entregamos reportes y vamos optimizando flujos mes con mes." },
            ].map((item) => (
              <Card key={item.step} className="relative border-primary/10 hover:border-primary/40 transition-colors">
                <div className="absolute -top-3 left-5 bg-primary text-white text-xs font-bold px-2.5 py-1 rounded-full">
                  PASO {item.step}
                </div>
                <CardHeader className="pt-7">
                  <item.icon className="h-7 w-7 text-primary mb-2" />
                  <CardTitle className="text-lg">{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Servicios / Paquetes ────────────────────────────────────────── */}
      <section id="services" className="py-20 px-4 md:px-0">
        <div className="container max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Paquetes</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">
              Dos formas de trabajar con FishFlow
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Puedes operar tú la herramienta, o dejarnos manejarla por ti. Cada propuesta se cotiza según el caso de uso.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Flow SaaS */}
            <Card className="border-2 border-primary/20 hover:border-primary/50 transition-colors">
              <CardHeader>
                <Badge className="w-fit mb-2 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15">Tú operas</Badge>
                <CardTitle className="text-2xl text-primary">Flow SaaS</CardTitle>
                <CardDescription>Plataforma en la nube lista para que tú o tu equipo la operen.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { t: "Gestión de clientes",        d: "Registro, historial y segmentación" },
                    { t: "Notificaciones automáticas", d: "WhatsApp, email y SMS" },
                    { t: "Reportes y dashboards",      d: "Métricas en tiempo real" },
                    { t: "Capacitación + soporte",     d: "Acompañamiento durante onboarding" },
                  ].map((b) => (
                    <div key={b.t} className="flex gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground">{b.t}</p>
                        <p className="text-sm text-muted-foreground">{b.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => window.open(`mailto:${EMAIL}?subject=Cotizaci%C3%B3n%20Flow%20SaaS`)}
                  variant="outline"
                  className="w-full mt-4 border-primary text-primary hover:bg-primary hover:text-white"
                >
                  Cotizar Flow SaaS
                </Button>
              </CardContent>
            </Card>

            {/* Flow Total */}
            <Card className="border-2 border-accent/30 hover:border-accent/60 transition-colors relative bg-gradient-to-br from-accent/5 to-transparent">
              <div className="absolute -top-3 right-5">
                <Badge className="bg-accent text-white hover:bg-accent">
                  <Sparkles className="w-3 h-3 mr-1" /> Más popular
                </Badge>
              </div>
              <CardHeader>
                <Badge className="w-fit mb-2 bg-accent/10 text-accent border-accent/20 hover:bg-accent/15">Nosotros operamos</Badge>
                <CardTitle className="text-2xl text-accent">Flow Total</CardTitle>
                <CardDescription>Servicio completo: nosotros gestionamos la plataforma y tu presencia digital.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { t: "Community Manager",     d: "Gestión integral de redes sociales" },
                    { t: "Contenido con IA",      d: "Posts, copies y respuestas automatizadas" },
                    { t: "Publicación programada",d: "Horarios óptimos y consistencia garantizada" },
                    { t: "Reportes mensuales",    d: "ROI transparente y plan del mes" },
                  ].map((b) => (
                    <div key={b.t} className="flex gap-3">
                      <CheckCircle2 className="h-5 w-5 text-accent flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground">{b.t}</p>
                        <p className="text-sm text-muted-foreground">{b.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => window.open(`mailto:${EMAIL}?subject=Cotizaci%C3%B3n%20Flow%20Total`)}
                  className="w-full mt-4 bg-accent hover:bg-accent/90 text-white"
                >
                  Cotizar Flow Total
                </Button>
              </CardContent>
            </Card>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8 italic">
            Los precios varían según el caso de uso y volumen — primero diagnosticamos, luego cotizamos.
          </p>
        </div>
      </section>

      {/* ── Verticales / Demos ──────────────────────────────────────────── */}
      <section id="verticals" className="py-20 px-4 md:px-0 bg-gradient-to-b from-secondary/30 to-white">
        <div className="container max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-3 border-accent/40 text-accent">Demos por industria</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">Mockups en construcción</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Estamos puliendo tres demos verticales para que puedas ver exactamente cómo se ve
              FishFlow en tu industria. ¿Quieres que el siguiente sea para tu negocio?
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Shirt, color: "primary", title: "Tintorería", domain: "tintoreria.fishflow.mx",
                features: ["Seguimiento de prendas con folio","Aviso por WhatsApp cuando esté lista","Historial y CRM de clientes"],
              },
              {
                icon: Camera, color: "accent", title: "Fotografía", domain: "fotografia.fishflow.mx",
                features: ["Agenda de sesiones y cotizador","Galería privada por cliente","Seguimiento de proyectos"],
              },
              {
                icon: ShoppingBag, color: "primary", title: "Quesos y Jamones", domain: "quesosyjamones.fishflow.mx",
                features: ["Catálogo y pedidos por WhatsApp","Control de inventario en tiempo real","Recordatorios para reabastecer"],
              },
            ].map((v) => (
              <Card key={v.title} className="overflow-hidden hover:shadow-xl transition-all group">
                <div className={`relative h-48 bg-gradient-to-br ${v.color === "primary" ? "from-primary/30 via-primary/15 to-primary/5" : "from-accent/30 via-accent/15 to-accent/5"} flex items-center justify-center`}>
                  <v.icon className={`h-20 w-20 ${v.color === "primary" ? "text-primary/70" : "text-accent/80"} group-hover:scale-110 transition-transform`} />
                  <Badge className="absolute top-3 right-3 bg-white/90 text-foreground border-0">Próximamente</Badge>
                </div>
                <CardHeader>
                  <CardTitle className="text-lg">{v.title}</CardTitle>
                  <CardDescription>{v.domain}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1.5 text-muted-foreground">
                    {v.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <CheckCircle2 className={`h-4 w-4 ${v.color === "primary" ? "text-primary" : "text-accent"} flex-shrink-0 mt-0.5`} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Button
              onClick={() => window.open(`mailto:${EMAIL}?subject=Mi%20industria%20no%20est%C3%A1%20listada`)}
              variant="outline" size="lg"
            >
              ¿Tu industria no está listada? Hablemos <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── Casos de éxito ──────────────────────────────────────────────── */}
      <section id="cases" className="py-20 px-4 md:px-0">
        <div className="container max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Casos de éxito</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">Resultados reales en negocios reales</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Estos son los problemas que estamos resolviendo hoy. Tu negocio puede ser el siguiente.
            </p>
          </div>

          <Card className="border-2 border-primary/30 mb-8 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-3">
              <div className="bg-gradient-to-br from-primary/15 to-accent/10 p-8 flex flex-col justify-center md:col-span-1">
                <Badge className="w-fit mb-3 bg-primary text-white hover:bg-primary">Caso destacado</Badge>
                <h3 className="text-xl font-bold mb-2 text-foreground">Estética en CDMX</h3>
                <p className="text-sm text-muted-foreground mb-4">Servicio Community Manager Tipo B (Flow Total)</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary" /> Cliente activo
                </div>
              </div>
              <div className="md:col-span-2 p-8">
                <CardTitle className="text-lg mb-3">Presencia digital consistente sin contratar más personal</CardTitle>
                <p className="text-sm text-muted-foreground mb-4">
                  Una estética de barrio quería competir en redes sociales contra cadenas grandes pero no
                  tenía tiempo ni equipo para crear contenido. Con Flow Total automatizamos la generación
                  de posts con IA, calendario editorial y respuestas a mensajes.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                  {[
                    { label: "Antes",    text: "Posts esporádicos sin estrategia" },
                    { label: "Después",  text: "Calendario constante todo el mes" },
                    { label: "Resultado",text: "Cero horas semanales del dueño" },
                  ].map((r) => (
                    <div key={r.label} className="bg-primary/5 p-3 rounded-lg">
                      <p className="text-xs font-semibold text-primary uppercase mb-1">{r.label}</p>
                      <p className="text-sm text-foreground">{r.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: "Tintorería: cero llamadas de '¿ya está listo?'", desc: "Notificaciones automáticas de WhatsApp cuando la prenda está lista. Menos llamadas, mejor experiencia.", tag: "Operación", color: "primary" },
              { title: "Fotógrafo: agenda llena sin chat manual",         desc: "Cotizador y agenda online conectada a WhatsApp. El cliente reserva sin que el fotógrafo conteste a las 11pm.", tag: "Comercial", color: "accent" },
              { title: "Productor local: pedidos por WhatsApp 24/7",      desc: "Catálogo digital y carrito por WhatsApp. Los pedidos llegan listos para empacar, sin teléfonos cruzados.", tag: "Ventas", color: "primary" },
            ].map((c, i) => (
              <Card key={i} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <Badge variant="outline" className={`w-fit mb-2 ${c.color === "primary" ? "border-primary/30 text-primary" : "border-accent/40 text-accent"}`}>
                    {c.tag}
                  </Badge>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{c.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Por qué FishFlow ────────────────────────────────────────────── */}
      <section id="why" className="py-20 px-4 md:px-0" style={{ backgroundColor: "#0A1820" }}>
        <div className="container max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-3 border-primary/40 text-primary bg-transparent">Diferenciadores</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-white">
              Por qué FishFlow y no un freelance cualquiera
            </h2>
            <p className="text-lg text-white/70 max-w-2xl mx-auto">
              Combinamos infraestructura sólida con el trato humano de un partner local.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Database,     title: "Stack moderno",     desc: "Next.js, Supabase y Vercel — la misma infraestructura que usan startups serias." },
              { icon: Bot,          title: "IA de verdad",      desc: "No son scripts: integramos modelos para generar contenido y responder clientes." },
              { icon: ShieldCheck,  title: "Datos seguros",     desc: "Tu información de clientes vive en bases con respaldo automático y permisos." },
              { icon: MessageSquare,title: "Soporte en español", desc: "Hablas con quien construye, no con un call center. Respuestas en horas, no días." },
            ].map((d, i) => (
              <div key={i} className="bg-white/5 rounded-lg p-6 border border-white/10 hover:border-primary/40 transition-colors">
                <div className="bg-primary/20 rounded-lg w-fit p-2 mb-4">
                  <d.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-bold text-white mb-2">{d.title}</h3>
                <p className="text-sm text-white/70">{d.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: "Freelance suelto",   cons: ["Desaparece cuando tiene otro proyecto","Stack improvisado caso por caso","Sin documentación cuando lo necesitas"], highlight: false },
              { label: "Software gringo",    cons: ["Sin soporte en español","Pensado para mercado de EUA","Pagas en dólares por funciones que no usas"], highlight: false },
              { label: "FishFlow",           cons: ["Partner constante, mes con mes","Stack probado y replicable","Soporte directo, en tu zona horaria"], highlight: true },
            ].map((col) => (
              <div key={col.label} className={`rounded-lg p-5 border ${col.highlight ? "bg-primary/15 border-primary/40" : "bg-white/5 border-white/10"}`}>
                <p className={`text-xs font-semibold uppercase mb-3 ${col.highlight ? "text-primary" : "text-white/50"}`}>{col.label}</p>
                <ul className="space-y-2 text-sm">
                  {col.cons.map((c) => (
                    <li key={c} className={col.highlight ? "text-white" : "text-white/70"}>
                      {col.highlight ? "✓" : "✗"} {c}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-20 px-4 md:px-0">
        <div className="container max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Preguntas frecuentes</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">FAQ</h2>
            <p className="text-lg text-muted-foreground">Lo que casi todos preguntan en la primera llamada.</p>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {[
              { q: "¿Cuánto cuesta FishFlow?",                           a: "No publicamos un precio fijo porque cada negocio es distinto: una tintorería con 200 clientes no paga lo mismo que una estética con redes activas. En la llamada de diagnóstico (gratis) te damos una propuesta puntual con alcance y precio mensual." },
              { q: "¿Cuánto tarda la implementación?",                   a: "Para mockups de las verticales que ya conocemos (tintorería, fotografía, alimentos), el live suele estar en 2 a 4 semanas. Verticales nuevas pueden tomar más, pero siempre te lo decimos antes de empezar." },
              { q: "¿Necesito conocimientos técnicos para operarlo?",    a: "No. Si eliges Flow SaaS te capacitamos a ti y a tu equipo en sesiones cortas. Si eliges Flow Total nosotros operamos la plataforma y tú solo recibes los reportes." },
              { q: "¿Hay contrato a plazos largos?",                     a: "No amarramos a nadie. Trabajamos mes con mes — si no estás viendo valor, lo cancelas. Nuestro incentivo es mantenerte como cliente por resultados, no por letras chiquitas." },
              { q: "¿Y si mi negocio no es tintorería, fotografía o alimentos?", a: "Esas son nuestras verticales prioritarias, pero el stack es flexible. Estéticas, consultorios, talleres, escuelas — si tu negocio gestiona clientes y comunicación, podemos automatizarlo. Cuéntanos tu caso." },
              { q: "¿Quién es FishFlow exactamente?",                    a: "FishFlow es la práctica de Rafa Nolasco, con más de una década vendiendo tecnología a operadores de telecomunicaciones. La misma seriedad que le pedirías a un proveedor enterprise, escalada al tamaño de tu negocio local." },
            ].map((item, i) => (
              <AccordionItem key={i} value={`q${i + 1}`}>
                <AccordionTrigger className="text-left">{item.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── Contacto ────────────────────────────────────────────────────── */}
      <section id="contact" className="py-20 px-4 md:px-0 bg-gradient-to-br from-primary/10 via-white to-accent/10">
        <div className="container max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Contacto</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">
              Conectemos y transformemos tu negocio
            </h2>
            <p className="text-lg text-muted-foreground">
              La primera llamada es gratis y sin compromiso. Solo necesito 30 minutos para entender qué automatizar primero.
            </p>
          </div>

          <Card className="border-2 border-primary/30 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="bg-gradient-to-br from-primary/15 to-accent/10 p-8 flex flex-col justify-center">
                <Mail className="h-10 w-10 text-primary mb-4" />
                <h3 className="text-xl font-bold text-foreground mb-2">Escríbeme un correo</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Cuéntame tu negocio, tu reto y tu disponibilidad. Te respondo personalmente en menos de 24 horas hábiles.
                </p>
                <a
                  href={MAILTO_GENERIC}
                  className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-semibold transition-colors break-all"
                >
                  {EMAIL} <ArrowRight className="h-4 w-4 flex-shrink-0" />
                </a>
              </div>
              <div className="p-8 bg-white flex flex-col justify-center">
                <Calendar className="h-10 w-10 text-accent mb-4" />
                <h3 className="text-xl font-bold text-foreground mb-2">Agenda una llamada</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  ¿Prefieres hablar antes de escribir? Mándame un correo con tu disponibilidad y te confirmo el slot.
                </p>
                <Button
                  onClick={() => window.open(MAILTO_DEMO)}
                  className="bg-primary hover:bg-primary/90 text-white w-full sm:w-auto"
                  size="lg"
                >
                  <Rocket className="mr-2 h-4 w-4" /> Solicitar diagnóstico gratis
                </Button>
                <p className="text-xs text-muted-foreground mt-3">
                  Pronto: integración con WhatsApp para conectar al instante.
                </p>
              </div>
            </div>
          </Card>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            {[
              { icon: Users,      label: "Atención personalizada" },
              { icon: ShieldCheck,label: "Sin compromiso" },
              { icon: Sparkles,   label: "Diagnóstico gratis" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center">
                <Icon className="h-5 w-5 text-primary mb-1" />
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer style={{ backgroundColor: "#0A1820" }} className="text-white py-12 px-4 md:px-0">
        <div className="container max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                {/* Logo horizontal versión clara (sobre fondo oscuro) */}
                <Image
                  src="/logo-horizontal.svg"
                  alt="FishFlow"
                  width={140}
                  height={40}
                  className="h-8 w-auto"
                />
              </div>
              <p className="text-white/70 text-sm max-w-sm">
                Automatización inteligente para micro PyMES locales en México. Construido con
                la misma seriedad que un proveedor enterprise, al tamaño de tu negocio.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3">Navegación</h4>
              <ul className="space-y-2 text-sm text-white/70">
                {["how","services","verticals","cases","faq"].map((id) => (
                  <li key={id}>
                    <button onClick={() => scrollToSection(id)} className="hover:text-white transition-colors capitalize">
                      {id === "how" ? "Cómo funciona" : id === "services" ? "Servicios" : id === "verticals" ? "Verticales" : id === "cases" ? "Casos" : "FAQ"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3">Contacto</h4>
              <ul className="space-y-2 text-sm text-white/70">
                <li><a href={MAILTO_GENERIC} className="hover:text-white transition-colors break-all">{EMAIL}</a></li>
                <li className="text-white/50">CDMX, México</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/20 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-sm text-white/60">
            <p>© {new Date().getFullYear()} FishFlow. Todos los derechos reservados.</p>
            <p>fishflow.mx</p>
          </div>
        </div>
      </footer>

    </div>
  );
}
