# Demo SPARC — sparcgroup.mx

Propuesta de sitio web para **SPARC** (Servicios Profesionales en Administración
Residencial y Comercial), cliente: **Eduardo Guillermo Curiel y Caballero**.
Construida por FishFlow, septiembre 2026.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Landing completa, single-file, con el bloque RESPONSIVE BASE del `_template` |
| `aviso-de-privacidad.html` | Aviso de privacidad adaptado al dominio sparcgroup.mx |
| `sparc-logo.png` | Logo vertical (edificios + barra verde), fondo transparente |
| `sparc-lockup.png` | Lockup horizontal completo (logo + razón social) |
| `sparc-admin.png` | Variante "SPARC ADMINISTRACIÓN" |
| `favicon-512.png` / `apple-touch-icon.png` / `favicon-32.png` | Iconos de marca del cliente |

Los logos se extrajeron en vector desde `SPARCLOGO_COLOR.pdf` y
`SPARCadminLOGO_COLOR.pdf` (400–600 dpi), con el fondo blanco convertido a alfa.

## Marca (del manual entregado por el cliente)

| Token | Valor |
|---|---|
| Azul | PMS 641C · `#0065A1` |
| Verde | PMS 7739C · `#2C9A42` |
| Tipografía original | Champagne & Limousines |
| Sustituto web | Jost (títulos) + Inter (cuerpo) |

Champagne & Limousines no está en Google Fonts. **Jost** es el geométrico más
cercano disponible por CDN. Si SPARC tiene licencia web de la fuente original,
se sustituye con `@font-face` sin tocar el resto del CSS.

## Estándares aplicados

- Bloque RESPONSIVE BASE de `public/demos/_template/` intacto al inicio del `<style>`.
- Menú hamburguesa móvil con `aria-expanded` / `aria-label`, cierra al tocar cualquier opción.
- Favicon de la marca del cliente (no el de FishFlow).
- Test de 3 anchos pasado: 390 / 820 / 1280 px, sin scroll horizontal en ninguno.
- Banner superior que marca el sitio como PROPUESTA, en las dos páginas.

## Audiencias: quién ve qué (decisión 08-sep-2026)

La landing le habla a **tres públicos distintos** y no debe mezclarlos:

| Público | Qué le interesa | Dónde vive en la página |
|---|---|---|
| Prospecto (comité buscando administradora) | Credibilidad, comparativa, proceso de cambio, FAQ | Toda la landing |
| Condómino actual | Reservar salón, ver pagos, avisos publicados, reporte por correo | Bloque "Para ti, que vives aquí" |
| Eduardo (administrador) | Tablero, cumplimiento, detección de incidencias | Bloque "Para tu comité" |

**El analizador de chats con IA se bajó de la web pública.** Es herramienta de
Eduardo, no beneficio del condómino, y decir en abierto "analizamos los chats
del condominio con IA" se lee como vigilancia — además el Aviso de Privacidad de
SPARC no cubre el tratamiento de mensajes de chat. En la landing quedó como una
línea sobria ("las incidencias que se repiten se detectan antes de escalar"). Su
lugar es la junta de venta de Eduardo con un comité, no la página abierta.

**Portal SPARC, no "app".** Webapp, no aplicación nativa: sin App Store ni Play,
sin descargas, sobre el Next.js + Supabase que ya existe. De cara al condómino
nunca se le llama "webapp" —es jerga— sino **Portal SPARC**, y el no-descargar
se vende como ventaja: *entras desde tu celular, sin instalar nada*.

## ⚠️ El Portal NO existe hoy

Lo único que corre en producción para SPARC es el lado del administrador:
`sparc_buildings`, `sparc_staff`, subir chats, mensajes y dashboard en
`app/app/sparc/`. **No hay reservas, ni pagos, ni avisos, ni portal del
condómino.** El claim de "aplicación móvil y plataforma web" viene del Resumen
Informativo de SPARC y es aspiracional — confirmado por Rafa el 08-sep-2026.

Consecuencia, y es dura:

- **El demo sí muestra el Portal** — es una propuesta, el banner lo dice, y es
  el gancho para venderle el módulo a Eduardo. Va marcado con la nota "módulo
  propuesto por FishFlow: hoy no está en operación" bajo la pantalla y bajo el
  teléfono del hero.
- **sparcgroup.mx en vivo NO puede salir con esa sección hasta que el Portal
  exista**, aunque sea en su primera pieza. Regla de la casa: no se publica nada
  que no corra ya en producción.
- **Primera pieza a construir: avisos públicos.** Es lo único de la lista que no
  necesita login, se construye rápido y ninguno de los tres competidores lo tiene.

## Newsletter: módulo vendible aparte

Ya corre con Mario Citalán y se replica casi tal cual:
`app/api/newsletter/draft|send|subscribe`, tabla `newsletter_campaigns`. La
mecánica que hay que conservar: **la IA propone el borrador, Eduardo lo edita y
aprueba, y el envío sale individual** para que ningún condómino vea el correo de
otro. Para SPARC: reporte mensual del inmueble + avisos oportunos.

En la landing aparece como beneficio ("el reporte mensual te llega solo"), no
como tecnología. A Eduardo se le cotiza como módulo recurrente, no incluido.

Pendiente antes de encenderlo: `TEST_MODE` sigue en `true` en
`api/newsletter/send`, y falta el List-Unsubscribe con token por destinatario.

## Contenido pendiente de validar con SPARC

Todo lo marcado con la píldora naranja **POR VALIDAR CON SPARC** o con nota al pie:

1. **Testimonios** — 3 espacios listos. Se necesitan nombre, rol (Presidente /
   Tesorero de Comité / Condómino) y nombre del desarrollo. Ninguno de los tres
   competidores publica testimonios: es la ventaja más barata de tomar.
2. **Zonas de cobertura** — el listado actual se infirió de la ubicación de sus
   oficinas (Huixquilucan). Hay que cerrarlo con las zonas donde SPARC ya
   administra inmuebles: es lo que posiciona el sitio en búsqueda local.
3. **Números de prueba social** — la barra de credenciales usa solo datos del
   Resumen Informativo (15+ años, 24/7, 100% responsabilidad patronal). Portik
   presume 155 condominios / 375 colaboradores / 25,000 propiedades. Si SPARC
   tiene cifras equivalentes, van aquí.
4. **Certificación PROSOC** — GSI la presume. Si SPARC está certificada, es un
   sello que debe aparecer arriba del pliegue. **No se incluyó porque no está
   confirmada.**
5. **Correos del dominio nuevo** — `contacto@sparcgroup.mx` y
   `privacidad@sparcgroup.mx` están puestos en el copy. Hay que darlos de alta
   al comprar el dominio, o cambiarlos por los actuales.
6. **Teléfono** — el Aviso de Privacidad trae `3687-9047` sin lada. Se asumió
   CDMX (`55 3687 9047`). Confirmar.
7. **Aviso de Privacidad** — texto adaptado del `.doc` original, con el dominio
   actualizado a sparcgroup.mx. Requiere validación jurídica antes de publicar.
   **Si el Portal se construye, hay que ampliarlo**: hoy no cubre reservas,
   pagos en línea ni envío de newsletter.

## Lo que sigue

1. Comprar `sparcgroup.mx` — **registrant a nombre de SPARC / Eduardo**, push
   transfer en Namecheap (política de dominios de clientes, ver
   `project_politica_dominios_clientes.md`).
2. Validar el contenido pendiente con Eduardo.
3. Decidir esquema de hosting: `fishflow-clients/sparcgroup/` en Vercel
   (recomendado, dominio propio) vs. Hostinger del cliente.
4. Cotizar a Eduardo los dos módulos por separado: **Portal SPARC** (fase 1 =
   avisos públicos) y **newsletter** (reporte mensual + avisos oportunos).
