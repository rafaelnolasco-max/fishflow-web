# Plantilla base de demos — FishFlow

Base estándar para que **todo demo nazca optimizado para PC, iPad y móvil**.
Evita el problema de tener que parchar cada demo a mano después.

## Archivos

| Archivo | Para qué |
|---|---|
| `responsive-base.css` | El bloque responsivo reutilizable (fuente canónica). |
| `index.html` | Esqueleto self-contained listo para copiar y rellenar. |
| `README.md` | Esto. |

## Cómo construir un demo nuevo

1. Copia `_template/index.html` a `public/demos/<slug>/index.html`.
2. Reemplaza tokens de marca, copy y componentes. **Conserva el bloque "RESPONSIVE BASE" intacto al inicio del `<style>`.**
3. Construye con los primitivos `ff-*` (abajo), no con grids de columnas fijas.
4. Pasa el **test de 3 anchos** antes de darlo por listo.

> Los demos son single-file por diseño (se copian tal cual a `public/demos/`).
> Por eso el bloque base va **inline** dentro del `<style>`, no enlazado.

## Primitivos (las reglas de oro)

- **Nunca** `grid-template-columns:repeat(4,1fr)` fijo. Usa `class="ff-grid"`
  (o `ff-grid--sm/md/lg`): las columnas se reacomodan solas, sin media queries.
- **Tablas** siempre dentro de `<div class="ff-tablewrap">`. Scrollean dentro
  de su caja, nunca rompen la página.
- **Dashboards** (sidebar + contenido [+ panel]): usa `ff-shell` o `ff-shell--3`.
  Se apilan automáticamente en ≤900px.
- **Visuales decorativos** (ilustración de hero, etc.): márcalos
  `class="ff-hide-mobile"`. Se ocultan en móvil y no causan scroll horizontal.
- **Filas flex** que deban apilarse en móvil: `class="ff-stack-mobile"`.
- El reset global ya trae `overflow-x:hidden` + `min-width:0` (mata el bug de
  overflow en grids/flex) e `img/svg max-width:100%`. No lo quites.

## Breakpoints del sistema

| Rango | Entorno |
|---|---|
| ≤ 600px | móvil |
| 601–900px | iPad / tablet |
| > 900px | escritorio |

## Test de 3 anchos (obligatorio antes de publicar)

Revisa en **390px (móvil)**, **820px (iPad)** y **1280px (PC)**:

- [ ] No hay scroll horizontal en ninguno.
- [ ] El hero se lee bien y el visual decorativo no estorba en móvil.
- [ ] Todos los grids colapsan (no quedan columnas espachurradas).
- [ ] Las tablas scrollean dentro de su caja, no rompen el ancho.
- [ ] El nav no se desborda; en móvil hay acceso a lo esencial.
- [ ] Dashboards: sidebar y panel derecho se apilan, no se cortan.
