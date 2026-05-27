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
              { label: "Apps",          id: "apps" },
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
                Cafeterías, autolavados, tiendas, estéticas, tintorerías, restaurantes… damos a tu
                micro PyME el mismo poder digital que las grandes: WhatsApp automático, agenda online,
                automatización con IA y reportes en tiempo real.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start mb-10">
                <Button
                  onClick={() => scrollToSection("contact")}
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
              { step: "02", icon: PenTool, title: "Prototipo funcional a la medida", desc: "Diseñamos una web app funcional pensada para tu vertical (cafetería, autolavado, tintorería, hospital…) y la aprobamos juntos antes de implementar." },
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
                    { t: "Landing page profesional",      d: "Hasta 4 actualizaciones al año incluidas" },
                    { t: "Dominio + hosting gestionados", d: "FishFlow lo administra por ti, sin complicaciones" },
                    { t: "Formulario de contacto",        d: "Tus prospectos te escriben directo desde el sitio" },
                    { t: "Capacitación inicial",          d: "1 sesión de onboarding en vivo" },
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
                <CardDescription>Operación digitalizada: ventas, clientes y pagos integrados en un solo lugar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { t: "Landing page + SEO básico",   d: "Hasta 8 actualizaciones al año incluidas" },
                    { t: "Dashboard operativo",         d: "Ventas, reportes y métricas clave de tu negocio" },
                    { t: "CRM de clientes",             d: "Pipeline y gestión de oportunidades · hasta 3 usuarios" },
                    { t: "Integración de pago",         d: "MercadoPago o Stripe conectados a tu app" },
                    { t: "Notificaciones automáticas",  d: "WhatsApp o email sin que levantes un dedo" },
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
                    { t: "Landing page + SEO + optimización continua", d: "Hasta 12 actualizaciones al año incluidas" },
                    { t: "Dashboard en tiempo real",   d: "Alertas, KPIs personalizados y reportes ejecutivos" },
                    { t: "CRM avanzado + automatización", d: "Flujos, segmentación y seguimiento sin intervención manual" },
                    { t: "IA aplicada a tu negocio",   d: "Resúmenes automáticos, priorización de pipeline, respuestas inteligentes" },
                    { t: "Integraciones a la medida",  d: "Facturación, inventario, GPS, auditoría y más" },
                    { t: "Usuarios ilimitados",        d: "Todo tu equipo en la misma plataforma" },
                    { t: "Revisión trimestral",        d: "Sesión estratégica con reporte ejecutivo" },
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
                features: ["Seguimiento de prendas con folio","Aviso por WhatsApp cuando esté lista","Historial y CRM de clientes"],
              },
              {
                icon: Car, color: "accent", title: "Autolavado", slug: "autolavado",
                features: ["SMS/WhatsApp automático al entrar y salir","Control de turnos y tiempos","Dashboard de tickets diarios"],
              },
              {
                icon: Coffee, color: "primary", title: "Cafetería", slug: "cafeteria",
                features: ["Pedidos por WhatsApp o QR","Programa de lealtad digital","Reportes de ventas por turno"],
              },
              {
                icon: Scissors, color: "accent", title: "Estética / Barbería", slug: "barberia",
                features: ["Agenda online 24/7 para clientes","Recordatorio automático de cita","CRM con historial de servicios"],
              },
              {
                icon: Utensils, color: "primary", title: "Pozolería", slug: "pozoleria",
                features: ["Menú digital accesible desde el celular","Pedidos y reservaciones online","Control de platillos y ventas del día"],
              },
              {
                icon: Trophy, color: "accent", title: "MMChampions", slug: "mmchampions",
                features: ["Gestión de torneos y equipos","Registro de resultados en tiempo real","Dashboard de estadísticas del campeonato"],
              },
              {
                icon: Brain, color: "primary", title: "Centro de Terapias", slug: "terapias",
                features: ["Agenda de citas por especialidad","Expediente básico del paciente","Notificaciones automáticas de cita"],
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

          {/* Featured — RiskFlow · Hospital Oftalmológico */}
          <Card className="border-2 border-accent/30 mb-8 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-3">
              <div className="bg-gradient-to-br from-accent/15 to-primary/10 p-8 flex flex-col justify-center md:col-span-1">
                <Badge className="w-fit mb-3 bg-accent text-white hover:bg-accent">En desarrollo</Badge>
                <h3 className="text-xl font-bold mb-2 text-foreground">RiskFlow · Hospital Oftalmológico</h3>
                <p className="text-sm text-muted-foreground mb-4">Flow IA — Gestión de Riesgos y Controles · Auditoría interna digital</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Eye className="h-4 w-4 text-accent" /> CDMX · Sector salud
                </div>
              </div>
              <div className="md:col-span-2 p-8">
                <CardTitle className="text-lg mb-3">Del Excel al ciclo de auditoría 100% digital, colaborativo y trazable</CardTitle>
                <p className="text-sm text-muted-foreground mb-4">
                  El equipo de Auditoría Interna de un hospital oftalmológico de referencia en CDMX gestionaba
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
                title: "FishFlow Admin CRM",
                tag: "Gestión",
                desc: "Panel central para gestionar clientes, ingresos y operaciones de todos los negocios desde un solo lugar — en tiempo real, desde cualquier dispositivo.",
                ai: false,
              },
              {
                icon: ShoppingBag, color: "primary",
                title: "App Belange · Estética CDMX",
                tag: "Operación",
                desc: "Dashboard de contabilidad de productos vendidos por día, semana y mes. Integración con MercadoPago para control de ingresos sin hojas de cálculo.",
                ai: false,
              },
              {
                icon: Navigation, color: "accent",
                title: "App Lukon · Telemática GPS",
                tag: "Tecnología",
                desc: "Plataforma de monitoreo GPS con dashboard en tiempo real, gestión de contratos, facturación integrada y checkout digital con MercadoPago.",
                ai: false,
              },
              {
                icon: TrendingUp, color: "primary",
                title: "App TBA · Telecom CRM",
                tag: "Ventas + IA",
                desc: "CRM de oportunidades para equipos comerciales de telecomunicaciones — con inteligencia artificial que prioriza el pipeline y acelera el cierre de ventas.",
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
                desc: "Landing page clínica profesional con actualizaciones continuas. Pacientes nuevos llegan con información clara y confianza — sin que el dueño tenga que tocar nada.",
                ai: false,
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
              { q: "¿Cuánto tarda la implementación?",                   a: "Para verticales que ya conocemos (tintorería, autolavado, cafetería, estética), el live suele estar en 2 a 4 semanas. Verticales nuevas o con integraciones especiales pueden tomar más, pero siempre te lo decimos antes de empezar." },
              { q: "¿Necesito conocimientos técnicos para operarlo?",    a: "No. Te capacitamos a ti y a tu equipo en sesiones cortas. La plataforma está diseñada para que cualquier persona del negocio la use sin depender de alguien técnico." },
              { q: "¿Hay contrato a plazos largos?",                     a: "No amarramos a nadie. Trabajamos mes con mes — si no estás viendo valor, lo cancelas. Nuestro incentivo es mantenerte como cliente por resultados, no por letras chiquitas." },
              { q: "¿Y si mi negocio no es ninguna de las verticales listadas?", a: "Cafeterías, autolavados, estéticas y tintorerías son nuestras verticales prioritarias, pero el stack es flexible. Consultorios, talleres, escuelas, distribuidoras — si tu negocio gestiona clientes y comunicación, podemos automatizarlo. Cuéntanos tu caso." },
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

      {/* ── Diagnóstico IA ──────────────────────────────────────────────── */}
      <LeadForm />

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
            <p>fishflow.mx</p>
          </div>
        </div>
      </footer>

    </div>
  );
}
