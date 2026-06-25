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
import LeadForm from "@/components/LeadForm";
import BookingCal from "@/components/BookingCal";
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
  Search,
  PenTool,
  Cog,
  Activity,
  ShoppingBag,
  Shirt,
  ExternalLink,
  MapPin,
  Car,
  Coffee,
  Scissors,
  Store,
  Building2,
  Trophy,
  Utensils,
  Brain,
  Navigation,
  LayoutDashboard,
  Eye,
  Clock,
  Globe,
  CreditCard,
  FileText,
  Phone,
  Package,
} from "lucide-react";
import { useEffect, useState } from "react";

const EMAIL = "raf@fishflow.mx";
const MAILTO_GENERIC = `mailto:${EMAIL}?subject=Quiero%20conocer%20m%C3%A1s%20de%20FishFlow`;

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
              { label: "Capacidades",   id: "capacidades" },
              { label: "Servicios",     id: "services" },
              { label: "Apps",          id: "apps" },
              { label: "Tu panel",      id: "panel" },
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
            onClick={() => scrollToSection("agenda")}
            className="bg-primary hover:bg-primary/90 text-white"
            size="sm"
          >
            Agendar
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
                Cafeterías, autolavados, tiendas, estéticas, tintorerías, restaurantes… damos a tu
                micro PyME el mismo poder digital que las grandes: WhatsApp automático, agenda online,
                automatización con IA y reportes en tiempo real.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start mb-10">
                <Button
                  onClick={() => scrollToSection("agenda")}
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-white"
                >
                  Agendar diagnóstico gratis <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button onClick={() => scrollToSection("apps")} variant="outline" size="lg">
                  Ver apps por industria
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row gap-6 justify-center md:justify-start">
                {[
                  { icon: Zap,        label: "Puesta en marcha rápida" },
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

      {/* ── Tira de confianza ───────────────────────────────────────────── */}
      <section id="clientes" className="py-12 px-4 md:px-0 border-y border-primary/10 bg-white">
        <div className="container max-w-5xl mx-auto">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-7">
            Negocios que ya operan con FishFlow
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 md:gap-4">
            {[
              { icon: Scissors,   name: "Estética Belange", note: "CDMX", soon: false },
              { icon: Activity,   name: "CANE Neurofeedback", note: "Salud", soon: false },
              { icon: Sparkles,   name: "Studio Jomay", note: "Micropigmentación", soon: false },
              { icon: Navigation, name: "Lukon", note: "Telemática GPS", soon: false },
              { icon: Brain,      name: "TherapyOS", note: "Terapia", soon: false },
              { icon: PenTool,    name: "Mario Citalán", note: "Próximamente", soon: true },
            ].map((c) => (
              <div
                key={c.name}
                className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-2.5 transition-colors ${
                  c.soon
                    ? "border-dashed border-accent/40 bg-accent/5"
                    : "border-primary/15 bg-secondary/40 hover:border-primary/40"
                }`}
              >
                <c.icon className={`h-4 w-4 flex-shrink-0 ${c.soon ? "text-accent" : "text-primary"}`} />
                <span className="text-sm font-semibold text-foreground leading-none">{c.name}</span>
                <span className={`text-[11px] leading-none ${c.soon ? "text-accent font-medium" : "text-muted-foreground"}`}>
                  · {c.note}
                </span>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground mt-7">
            Estéticas, consultorios, telemática y más — cada negocio con su propia app y panel.
          </p>
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
              { step: "02", icon: PenTool, title: "Primera versión funcional a tu medida", desc: "Diseñamos una aplicación pensada para tu giro (cafetería, autolavado, tintorería, hospital…) y la aprobamos juntos antes de ponerla en marcha." },
              { step: "03", icon: Cog,     title: "Puesta en marcha",   desc: "Conectamos WhatsApp, agenda, base de datos y tableros. Pasamos tus clientes al sistema y capacitamos a tu equipo." },
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

      {/* ── Capacidades / Bloques ───────────────────────────────────────── */}
      <section id="capacidades" className="py-20 px-4 md:px-0">
        <div className="container max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-3 border-accent/40 text-accent">Capacidades</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">
              No te hacemos una página. Te armamos una plataforma.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Tu sitio captura clientes, tu panel los recibe ya calificados y la automatización trabaja sola. Estos son los bloques que sumas — empiezas con lo que necesitas hoy y creces sin cambiar de herramienta.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: Globe,           accent: false, title: "Sitio web profesional",        desc: "Página rápida y a tu marca, siempre en línea, administrada por nosotros." },
              { icon: Bot,             accent: true,  title: "Panel de prospectos con IA",   desc: "Cada interesado llega a tu panel ya clasificado por tipo y con una respuesta sugerida por IA." },
              { icon: Users,           accent: false, title: "Control de clientes y ventas", desc: "Tus ventas en etapas claras: nuevo, contactado, agendado y cliente." },
              { icon: CreditCard,      accent: false, title: "Cobros en línea",              desc: "Stripe, MercadoPago y OXXO conectados, con recibo automático al cliente." },
              { icon: FileText,        accent: false, title: "Facturación automática",       desc: "Timbrado de facturas (CFDI) conectado a tus cobros, sin hojas de cálculo." },
              { icon: Calendar,        accent: false, title: "Agenda y reservas en línea",   desc: "Tus clientes agendan solos las 24 horas y reciben confirmación al instante." },
              { icon: MessageSquare,   accent: false, title: "WhatsApp y avisos",            desc: "Avisos y recordatorios automáticos sin que levantes un dedo." },
              { icon: Phone,           accent: true,  title: "Llamada con voz IA",           desc: "Una llamada con voz natural confirma o reagenda las citas por ti." },
              { icon: Package,         accent: false, title: "Inventario y punto de venta",  desc: "Control de productos, ventas del día y existencias en tiempo real." },
              { icon: Brain,           accent: true,  title: "Expediente con resúmenes IA",  desc: "Notas y sesiones que la IA resume y organiza solas, listas para consultar." },
              { icon: Navigation,      accent: false, title: "Rastreo GPS de flotillas",     desc: "Monitoreo de vehículos, contratos y facturación en un solo tablero." },
              { icon: LayoutDashboard, accent: false, title: "Tablero en tiempo real",       desc: "Tus números clave y alertas de tu negocio, desde cualquier dispositivo." },
            ].map((b) => (
              <Card
                key={b.title}
                className={`transition-colors ${b.accent ? "border-accent/25 hover:border-accent/60 bg-gradient-to-br from-accent/5 to-transparent" : "border-primary/10 hover:border-primary/40"}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 ${b.accent ? "bg-accent/10" : "bg-primary/10"}`}>
                      <b.icon className={`h-5 w-5 ${b.accent ? "text-accent" : "text-primary"}`} />
                    </div>
                    <CardTitle className="text-base leading-tight">{b.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{b.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-10 text-center">
            <p className="text-sm text-muted-foreground italic mb-4">
              Combinamos los bloques que tu negocio necesita en un solo plan. ¿No sabes por dónde empezar? Lo definimos en el diagnóstico.
            </p>
            <Button
              onClick={() => scrollToSection("agenda")}
              className="bg-primary hover:bg-primary/90 text-white"
            >
              Arma tu plataforma <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── Servicios / Paquetes ────────────────────────────────────────── */}
      <section id="services" className="py-20 px-4 md:px-0">
        <div className="container max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Paquetes</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">
              Elige el nivel que necesita tu negocio
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Desde presencia digital hasta automatización con inteligencia artificial. Tres niveles para crecer sin cambiar de herramienta.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">

            {/* Flow Básico */}
            <Card className="border-2 border-primary/20 hover:border-primary/40 transition-colors">
              <CardHeader>
                <Badge className="w-fit mb-2 bg-primary/10 text-primary border-primary/20">Básico</Badge>
                <CardTitle className="text-2xl text-primary">Flow Básico</CardTitle>
                <CardDescription>Presencia digital profesional para negocios que están dando su primer paso digital.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { t: "Página web profesional",        d: "Hasta 4 actualizaciones al año incluidas" },
                    { t: "Tu sitio siempre en línea",     d: "FishFlow lo administra por ti, sin complicaciones" },
                    { t: "Formulario de contacto",        d: "Las personas interesadas te escriben directo desde el sitio" },
                    { t: "Capacitación inicial",          d: "1 sesión de arranque en vivo" },
                  ].map((b) => (
                    <div key={b.t} className="flex gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground text-sm">{b.t}</p>
                        <p className="text-xs text-muted-foreground">{b.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => window.open(`mailto:${EMAIL}?subject=Cotizaci%C3%B3n%20Flow%20B%C3%A1sico`)}
                  variant="outline"
                  className="w-full mt-4 border-primary text-primary hover:bg-primary hover:text-white"
                >
                  Cotizar Flow Básico
                </Button>
              </CardContent>
            </Card>

            {/* Flow Pro */}
            <Card className="border-2 border-primary/50 hover:border-primary transition-colors relative shadow-lg">
              <div className="absolute -top-3 right-5">
                <Badge className="bg-primary text-white hover:bg-primary">
                  <Sparkles className="w-3 h-3 mr-1" /> Más elegido
                </Badge>
              </div>
              <CardHeader>
                <Badge className="w-fit mb-2 bg-primary/15 text-primary border-primary/30">Intermedio</Badge>
                <CardTitle className="text-2xl text-primary">Flow Pro</CardTitle>
                <CardDescription>Tu operación en digital: ventas, clientes y pagos en un solo lugar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { t: "Página web + para aparecer en Google", d: "Hasta 8 actualizaciones al año incluidas" },
                    { t: "Tablero de tu negocio",       d: "Ventas, reportes y números clave de tu negocio" },
                    { t: "Control de clientes",         d: "Seguimiento de ventas y clientes · hasta 3 usuarios" },
                    { t: "Pagos conectados",            d: "MercadoPago o Stripe conectados a tu sistema" },
                    { t: "Avisos automáticos",          d: "WhatsApp o correo sin que levantes un dedo" },
                    { t: "Soporte mensual dedicado",    d: "Sesión mensual de revisión y mejora" },
                  ].map((b) => (
                    <div key={b.t} className="flex gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground text-sm">{b.t}</p>
                        <p className="text-xs text-muted-foreground">{b.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => window.open(`mailto:${EMAIL}?subject=Cotizaci%C3%B3n%20Flow%20Pro`)}
                  className="w-full mt-4 bg-primary hover:bg-primary/90 text-white"
                >
                  Cotizar Flow Pro
                </Button>
              </CardContent>
            </Card>

            {/* Flow IA */}
            <Card className="border-2 border-accent/30 hover:border-accent/60 transition-colors bg-gradient-to-br from-accent/5 to-transparent">
              <CardHeader>
                <Badge className="w-fit mb-2 bg-accent/10 text-accent border-accent/20">Avanzado</Badge>
                <CardTitle className="text-2xl text-accent">Flow IA</CardTitle>
                <CardDescription>Automatización completa con inteligencia artificial aplicada a tu operación real.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { t: "Página web + posicionamiento en Google + mejora continua", d: "Hasta 12 actualizaciones al año incluidas" },
                    { t: "Tablero en tiempo real",     d: "Alertas, tus números clave y reportes para dirección" },
                    { t: "Control de clientes avanzado + automatización", d: "Seguimiento y clasificación automáticos, sin trabajo manual" },
                    { t: "IA aplicada a tu negocio",   d: "Resúmenes automáticos, prioriza tus ventas y respuestas inteligentes" },
                    { t: "Conexiones a la medida",     d: "Facturación, inventario, GPS, auditoría y más" },
                    { t: "Usuarios ilimitados",        d: "Todo tu equipo en la misma plataforma" },
                    { t: "Revisión trimestral",        d: "Sesión estratégica con reporte para dirección" },
                  ].map((b) => (
                    <div key={b.t} className="flex gap-3">
                      <CheckCircle2 className="h-5 w-5 text-accent flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground text-sm">{b.t}</p>
                        <p className="text-xs text-muted-foreground">{b.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => window.open(`mailto:${EMAIL}?subject=Cotizaci%C3%B3n%20Flow%20IA`)}
                  variant="outline"
                  className="w-full mt-4 border-accent text-accent hover:bg-accent hover:text-white"
                >
                  Cotizar Flow IA
                </Button>
              </CardContent>
            </Card>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8 italic">
            Los precios varían según el caso de uso y volumen — primero diagnosticamos, luego cotizamos.
          </p>
        </div>
      </section>

      {/* ── Web apps por industria ──────────────────────────────────────── */}
      <section id="apps" className="py-20 px-4 md:px-0 bg-gradient-to-b from-secondary/30 to-white">
        <div className="container max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-3 border-accent/40 text-accent">Demos en vivo</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">Web apps a la medida</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              No son imágenes — son apps reales que puedes explorar ahora mismo. Mira exactamente
              cómo se vería FishFlow en tu industria.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Shirt, color: "primary", title: "Tintorería", slug: "tintoreria",
                features: ["Seguimiento de prendas con folio","Aviso por WhatsApp cuando esté lista","Historial y control de clientes"],
              },
              {
                icon: Car, color: "accent", title: "Autolavado", slug: "autolavado",
                features: ["SMS/WhatsApp automático al entrar y salir","Control de turnos y tiempos","Tablero de tickets diarios"],
              },
              {
                icon: Coffee, color: "primary", title: "Cafetería", slug: "cafeteria",
                features: ["Pedidos por WhatsApp o QR","Programa de lealtad digital","Reportes de ventas por turno"],
              },
              {
                icon: Scissors, color: "accent", title: "Estética / Barbería", slug: "barberia",
                features: ["Agenda en línea 24/7 para clientes","Recordatorio automático de cita","Control de clientes con historial de servicios"],
              },
              {
                icon: Utensils, color: "primary", title: "Pozolería", slug: "pozoleria",
                features: ["Menú digital accesible desde el celular","Pedidos y reservaciones en línea","Control de platillos y ventas del día"],
              },
              {
                icon: Trophy, color: "accent", title: "MMChampions", slug: "mmchampions",
                features: ["Gestión de torneos y equipos","Registro de resultados en tiempo real","Tablero de estadísticas del campeonato"],
              },
              {
                icon: Brain, color: "primary", title: "Centro de Terapias", slug: "terapias",
                features: ["Agenda de citas por especialidad","Expediente básico del paciente","Avisos automáticos de cita"],
              },
              {
                icon: Building2, color: "accent", title: "CondOS · Condominios", slug: "condos",
                features: ["Portal de residentes y pagos de mantenimiento","Reportes de incidencias y seguimiento","Tablero de administración para el comité"],
              },
            ].map((v) => (
              <Card key={v.title} className="overflow-hidden hover:shadow-xl transition-all group">
                <div className={`relative h-40 bg-gradient-to-br ${v.color === "primary" ? "from-primary/30 via-primary/15 to-primary/5" : "from-accent/30 via-accent/15 to-accent/5"} flex items-center justify-center`}>
                  <v.icon className={`h-16 w-16 ${v.color === "primary" ? "text-primary/70" : "text-accent/80"} group-hover:scale-110 transition-transform`} />
                  <Badge className="absolute top-3 right-3 bg-white/90 text-foreground border-0 text-xs">Demo en vivo</Badge>
                </div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{v.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1.5 text-muted-foreground mb-4">
                    {v.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <CheckCircle2 className={`h-4 w-4 ${v.color === "primary" ? "text-primary" : "text-accent"} flex-shrink-0 mt-0.5`} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    onClick={() => window.open(`/demos/${v.slug}`, "_blank")}
                    variant="outline"
                    size="sm"
                    className={`w-full ${v.color === "primary" ? "border-primary text-primary hover:bg-primary hover:text-white" : "border-accent text-accent hover:bg-accent hover:text-white"}`}
                  >
                    Ver demo <ExternalLink className="ml-2 h-3 w-3" />
                  </Button>
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

      {/* ── Tu panel / back-office ──────────────────────────────────────── */}
      <section id="panel" className="py-20 px-4 md:px-0" style={{ backgroundColor: "#0D1B2A" }}>
        <div className="container max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Copy */}
            <div>
              <Badge variant="outline" className="mb-3 border-accent/40 text-accent">Tu panel</Badge>
              <h2 className="text-3xl md:text-5xl font-bold mb-5 text-white leading-tight">
                Tu negocio también recibe su propio panel
              </h2>
              <p className="text-lg text-white/70 mb-8 max-w-xl">
                La página es solo la mitad. Detrás, tú entras a un panel donde cada prospecto llega ya calificado, avanzas tus ventas y cobras — todo en tiempo real, sin hojas de cálculo.
              </p>

              <div className="space-y-4 mb-9">
                {[
                  { icon: Bot,          t: "Prospectos con propuesta de IA", d: "Cada interesado llega clasificado por tipo y con una respuesta sugerida lista." },
                  { icon: Users,        t: "Seguimiento de ventas",     d: "Nuevo, contactado, agendado, cliente — sin perder a nadie." },
                  { icon: CreditCard,   t: "Cobros y recibos",          d: "Stripe, MercadoPago y OXXO con recibo automático." },
                  { icon: LayoutDashboard, t: "Resumen en tiempo real", d: "Tus números del mes, desde cualquier dispositivo." },
                ].map((b) => (
                  <div key={b.t} className="flex gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 flex-shrink-0">
                      <b.icon className="h-5 w-5 text-accent" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{b.t}</p>
                      <p className="text-sm text-white/60">{b.d}</p>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                onClick={() => window.open("/demos/panel", "_blank")}
                size="lg"
                className="bg-accent hover:bg-accent/90 text-[#0D1B2A] font-semibold"
              >
                Abrir el panel demo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <p className="text-xs text-white/40 mt-3">Demo real con datos de ejemplo — explóralo tú mismo.</p>
            </div>

            {/* Mock window */}
            <button
              onClick={() => window.open("/demos/panel", "_blank")}
              className="group block w-full text-left rounded-xl overflow-hidden border border-white/10 shadow-2xl hover:border-accent/40 transition-colors"
              aria-label="Abrir el panel demo"
            >
              <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border-b border-white/10">
                <span className="h-3 w-3 rounded-full bg-red-400/70" />
                <span className="h-3 w-3 rounded-full bg-yellow-400/70" />
                <span className="h-3 w-3 rounded-full bg-green-400/70" />
                <span className="ml-3 text-xs text-white/40 font-mono">fishflow.mx/demos/panel</span>
              </div>
              <div className="bg-white p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[#0D1B2A]">🎯 Prospectos desde tu sitio</span>
                  <span className="text-xs text-muted-foreground">24 este mes</span>
                </div>
                {[
                  { n: "Paola Guerra", s: "Cotización", c: "bg-accent/15 text-accent" },
                  { n: "Jorge Medina", s: "Cita",       c: "bg-primary/15 text-primary" },
                  { n: "Andrea Ríos",  s: "Pedido",     c: "bg-green-100 text-green-700" },
                ].map((r) => (
                  <div key={r.n} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-bold text-foreground/70">
                        {r.n.split(" ").map((w) => w[0]).join("")}
                      </span>
                      <span className="text-sm font-medium text-foreground">{r.n}</span>
                    </div>
                    <span className={`text-[10px] font-mono uppercase tracking-wide px-2 py-1 rounded ${r.c}`}>{r.s}</span>
                  </div>
                ))}
                <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wide text-accent mb-1">✦ Propuesta sugerida por IA</p>
                  <p className="text-xs text-muted-foreground">Prospecto listo para comprar, con fecha y cantidad — responde hoy con cotización y liga para agendar.</p>
                </div>
                <p className="text-center text-xs text-primary font-medium group-hover:underline pt-1">Abrir panel completo →</p>
              </div>
            </button>

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

          {/* Featured — RiskFlow · Hospital */}
          <Card className="border-2 border-accent/30 mb-8 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-3">
              <div className="bg-gradient-to-br from-accent/15 to-primary/10 p-8 flex flex-col justify-center md:col-span-1">
                <Badge className="w-fit mb-3 bg-accent text-white hover:bg-accent">En desarrollo</Badge>
                <h3 className="text-xl font-bold mb-2 text-foreground">RiskFlow · Hospital</h3>
                <p className="text-sm text-muted-foreground mb-4">Flow IA — Gestión de Riesgos y Controles · Auditoría interna digital</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Eye className="h-4 w-4 text-accent" /> CDMX · Sector salud
                </div>
              </div>
              <div className="md:col-span-2 p-8">
                <CardTitle className="text-lg mb-3">Del Excel al ciclo de auditoría 100% digital, colaborativo y trazable</CardTitle>
                <p className="text-sm text-muted-foreground mb-4">
                  El equipo de Auditoría Interna de un hospital de referencia en CDMX gestionaba
                  riesgos y controles en Excel — sin flujo de trabajo separado, sin historial, sin trazabilidad.
                  Preparar el reporte para la certificadora tomaba días de consolidación manual. Con FishFlow
                  construimos una app en tres fases: un cuestionario guiado que el Dueño del Proceso completa
                  solo (sin capacitación previa), generación automática de la Matriz de Riesgos y Controles,
                  y un Mapa de Calor en tiempo real por nivel inherente y residual. Sin Excel, desde cualquier dispositivo.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                  {[
                    { label: "Antes",        text: "Excel compartido manualmente, sin historial ni trazabilidad" },
                    { label: "Con FishFlow", text: "Cuestionario guiado → Matriz automática → Mapa de calor" },
                    { label: "Resultado",    text: "Ciclo de auditoría colaborativo, trazable y auditable desde cualquier dispositivo" },
                  ].map((r) => (
                    <div key={r.label} className="bg-accent/5 p-3 rounded-lg">
                      <p className="text-xs font-semibold text-accent uppercase mb-1">{r.label}</p>
                      <p className="text-sm text-foreground">{r.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* Grid — 6 clientes activos */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: LayoutDashboard, color: "accent",
                title: "Panel central FishFlow",
                tag: "Gestión",
                desc: "Panel central para gestionar clientes, ingresos y operaciones de todos los negocios desde un solo lugar — en tiempo real, desde cualquier dispositivo.",
                ai: false,
              },
              {
                icon: ShoppingBag, color: "primary",
                title: "App Belange · Estética CDMX",
                tag: "Operación",
                desc: "Tablero de contabilidad de productos vendidos por día, semana y mes. Conectado con MercadoPago para control de ingresos sin hojas de cálculo.",
                ai: false,
              },
              {
                icon: Navigation, color: "accent",
                title: "App Lukon · Telemática GPS",
                tag: "Tecnología",
                desc: "Plataforma de rastreo GPS con tablero en tiempo real, gestión de contratos, facturación conectada y cobro en línea con MercadoPago.",
                ai: false,
              },
              {
                icon: TrendingUp, color: "primary",
                title: "App TBA · Ventas Telecom",
                tag: "Ventas + IA",
                desc: "Sistema de seguimiento de ventas para equipos comerciales de telecomunicaciones — con inteligencia artificial que prioriza las ventas y acelera el cierre.",
                ai: true,
              },
              {
                icon: Brain, color: "accent",
                title: "App TherapyOS",
                tag: "Clínico + IA",
                desc: "Expediente clínico digital con IA que resume sesiones automáticamente, organiza notas clínicas y lleva el historial del paciente sesión a sesión.",
                ai: true,
              },
              {
                icon: Activity, color: "primary",
                title: "CANE Neurofeedback",
                tag: "Presencia digital",
                desc: "Página web clínica profesional con actualizaciones continuas. Pacientes nuevos llegan con información clara y confianza — sin que el dueño tenga que tocar nada.",
                ai: false,
              },
              {
                icon: Sparkles, color: "accent",
                title: "Studio Jomay · Micropigmentación",
                tag: "Presencia digital",
                desc: "Sitio web profesional con su propia marca y dominio (studiojomay.com.mx), administrado por FishFlow. Sus clientas la encuentran en línea y la contactan directo.",
                ai: false,
              },
              {
                icon: PenTool, color: "primary",
                title: "Mario Citalán · Ecosistema digital",
                tag: "Próximamente",
                desc: "Plataforma de contenidos y diagnóstico para su método de criterio y actitud: sitio, cuestionarios guiados y panel — en construcción para lanzamiento.",
                ai: true,
              },
            ].map((c, i) => (
              <Card key={i} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className={`w-fit ${c.color === "primary" ? "border-primary/30 text-primary" : "border-accent/40 text-accent"}`}>
                      {c.tag}
                    </Badge>
                    {c.ai && (
                      <Badge className="bg-accent/10 text-accent border border-accent/20 text-xs">
                        <Bot className="w-3 h-3 mr-1" /> IA
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 shrink-0 ${c.color === "primary" ? "bg-primary/10" : "bg-accent/10"}`}>
                      <c.icon className={`h-5 w-5 ${c.color === "primary" ? "text-primary" : "text-accent"}`} />
                    </div>
                    <CardTitle className="text-base leading-snug">{c.title}</CardTitle>
                  </div>
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
      <section id="why" className="py-20 px-4 md:px-0" style={{ backgroundColor: "#0D1B2A" }}>
        <div className="container max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-3 border-primary/40 text-primary bg-transparent">Diferenciadores</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-white">
              Por qué FishFlow y no un freelance cualquiera
            </h2>
            <p className="text-lg text-white/70 max-w-2xl mx-auto">
              Combinamos tecnología sólida con el trato humano de un socio local.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Database,     title: "Tecnología profesional", desc: "La misma tecnología (Next.js, Supabase, Vercel) que usan las empresas grandes." },
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

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {[
              { label: "Otras opciones",     cons: ["Aparece y desaparece según su disponibilidad","Tecnología improvisada, distinta cada vez","Pagas de más por funciones que no usas, sin soporte cercano"], highlight: false },
              { label: "FishFlow",           cons: ["Socio constante, mes con mes","Tecnología probada y replicable","Soporte directo, en tu zona horaria"], highlight: true },
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
              { q: "¿Cuánto tarda en estar listo?",                      a: "Para giros que ya conocemos (tintorería, autolavado, cafetería, estética), tu sistema suele estar listo en 2 a 4 semanas. Giros nuevos o con conexiones especiales pueden tomar más, pero siempre te lo decimos antes de empezar." },
              { q: "¿Necesito conocimientos técnicos para operarlo?",    a: "No. Te capacitamos a ti y a tu equipo en sesiones cortas. La plataforma está diseñada para que cualquier persona del negocio la use sin depender de alguien técnico." },
              { q: "¿Hay contrato a plazos largos?",                     a: "No amarramos a nadie. Trabajamos mes con mes — si no estás viendo valor, lo cancelas. Nuestro incentivo es mantenerte como cliente por resultados, no por letras chiquitas." },
              { q: "¿Y si mi negocio no es ninguno de los giros listados?", a: "Cafeterías, autolavados, estéticas y tintorerías son nuestros giros prioritarios, pero nuestra tecnología es flexible. Consultorios, talleres, escuelas, distribuidoras — si tu negocio maneja clientes y comunicación, podemos automatizarlo. Cuéntanos tu caso." },
              { q: "¿Quién es FishFlow exactamente?",                    a: "FishFlow es la práctica de Rafa Nolasco, con más de una década vendiendo tecnología a operadores de telecomunicaciones. La misma seriedad que le pedirías a un proveedor de primer nivel, al tamaño de tu negocio local." },
            ].map((item, i) => (
              <AccordionItem key={i} value={`q${i + 1}`}>
                <AccordionTrigger className="text-left">{item.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── Diagnóstico IA ──────────────────────────────────────────────── */}
      <LeadForm />

      {/* ── Agenda (Cal.com) ────────────────────────────────────────────── */}
      <section id="agenda" className="py-20 px-4 md:px-0 bg-secondary/40">
        <div className="container max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Agenda en línea</Badge>
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">
              Agenda tu diagnóstico gratis
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Elige el día y la hora que mejor te acomode. Son 30 minutos por videollamada
              para entender tu operación y decirte qué automatizar primero. Sin costo y sin compromiso.
            </p>
          </div>

          <BookingCal />

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            {[
              { icon: Clock,       label: "30 minutos" },
              { icon: Calendar,    label: "Disponibilidad en vivo" },
              { icon: ShieldCheck, label: "Sin compromiso" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center">
                <Icon className="h-5 w-5 text-primary mb-1" />
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
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
                  Elige tú mismo el día y la hora. Te llega la confirmación con el enlace de la videollamada al instante.
                </p>
                <Button
                  onClick={() => scrollToSection("agenda")}
                  className="bg-primary hover:bg-primary/90 text-white w-full sm:w-auto"
                  size="lg"
                >
                  <Calendar className="mr-2 h-4 w-4" /> Ver disponibilidad
                </Button>
                <p className="text-xs text-muted-foreground mt-3">
                  Lun a Vie · 11:00–14:00 (hora CDMX) · videollamada de 30 min.
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
      <footer style={{ backgroundColor: "#0D1B2A" }} className="text-white py-12 px-4 md:px-0">
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
                la misma seriedad que un proveedor de primer nivel, al tamaño de tu negocio.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3">Navegación</h4>
              <ul className="space-y-2 text-sm text-white/70">
                {["how","services","apps","cases","faq"].map((id) => (
                  <li key={id}>
                    <button onClick={() => scrollToSection(id)} className="hover:text-white transition-colors capitalize">
                      {id === "how" ? "Cómo funciona" : id === "services" ? "Servicios" : id === "apps" ? "Apps" : id === "cases" ? "Casos" : "FAQ"}
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
            <div className="flex items-center gap-4">
              <a href="/aviso-de-privacidad" className="hover:text-white transition-colors">Aviso de privacidad</a>
              <span>fishflow.mx</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
