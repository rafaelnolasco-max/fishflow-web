# FishFlow — Sistema de Logo

Sistema de identidad visual para FishFlow. La filosofía completa está en `design-philosophy.md`.

## Archivos

```
brand/
├── README.md                    ← este archivo
├── design-philosophy.md         ← manifiesto visual (Tidal Geometry)
├── svg/                         ← fuente vectorial editable
│   ├── isotipo.svg
│   ├── isotipo-mono-dark.svg
│   ├── isotipo-mono-light.svg
│   ├── logo-vertical.svg
│   ├── logo-vertical-dark.svg
│   ├── logo-horizontal.svg
│   └── logo-horizontal-mono.svg
└── png/                         ← exports a 512 / 1024 / 2048 px
    ├── logo-system-overview.png
    └── ...
```

## Cuándo usar cada versión

| Versión | Uso |
|---|---|
| `isotipo` (color) | Favicon, app icon, redes, avatares, watermark |
| `logo-vertical` | Web hero, propuestas, presentaciones, cover de pitch deck |
| `logo-horizontal` | Header de web, firma de email, footer de documentos |
| `*-mono-dark` | Fondos claros donde el color compite (impresión BN, sellos, marca de agua) |
| `*-mono-light` / `*-dark` | Fondos oscuros (presentaciones nocturnas, hero invertido) |

## Paleta

| Token | Hex | Uso |
|---|---|---|
| Tide Cyan | `#1FA9D6` | Lóbulo izquierdo, "Fish" |
| Tide Orange | `#F26B17` | Lóbulo derecho, "Flow" |
| Ink | `#0E2A36` | Tipografía oscura, monocromo |
| Ink Soft | `#0C3445` | Ojo del pez |
| Background Dark | `#0A1820` | Fondo oscuro de marca |

## Construcción

- Lemniscata trazada como un único path auto-intersectante. Tangentes diagonales (~45°) en el cruce producen una X limpia, no un quiebre.
- Stroke width 44 (en viewBox 1200×600), `linecap=round`, `linejoin=round`.
- El pez está "solo insinuado": un único ojo discreto en el lóbulo derecho. La X central funciona naturalmente como la cintura cónica donde el cuerpo se conecta a la cola.
- Wordmark en **Outfit Bold** (Google Fonts, OFL). Las letras están convertidas a paths para portabilidad total.

## Espacio mínimo y tamaño

- **Espacio de respeto**: equivalente a la altura del lóbulo (≈ 60% del ancho del lóbulo).
- **Tamaño mínimo del isotipo**: 40 px de ancho (digital), 16 mm (impreso).
- **Tamaño mínimo del logo horizontal**: 120 px de ancho.

## No-no's

- No estirar ni distorsionar las proporciones.
- No cambiar el ángulo del cruce X (es lo que hace que lea como pez).
- No agregar sombras, glows o bevels — la silueta es el mensaje.
- No invertir las posiciones de cyan/naranja (cyan siempre es el lado izquierdo / la palabra "Fish").
