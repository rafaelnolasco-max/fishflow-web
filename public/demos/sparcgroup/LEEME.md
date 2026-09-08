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

## Lo que sigue

1. Comprar `sparcgroup.mx` — **registrant a nombre de SPARC / Eduardo**, push
   transfer en Namecheap (política de dominios de clientes, ver
   `project_politica_dominios_clientes.md`).
2. Validar el contenido pendiente con Eduardo.
3. Decidir esquema de hosting: `fishflow-clients/sparcgroup/` en Vercel
   (recomendado, dominio propio) vs. Hostinger del cliente.
