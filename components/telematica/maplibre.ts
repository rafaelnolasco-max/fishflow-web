/* eslint-disable @typescript-eslint/no-explicit-any */
// Carga MapLibre GL desde cdnjs una sola vez y comparte los estilos de
// OpenFreeMap (gratis, sin llave, uso comercial permitido).

const MAPLIBRE = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/";

export const BASEMAPS = {
  oscuro: "https://tiles.openfreemap.org/styles/dark",
  claro: "https://tiles.openfreemap.org/styles/positron",
} as const;
export type Basemap = keyof typeof BASEMAPS;

export function loadMapLibre(): Promise<any> {
  const w = window as any;
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (w.__maplibreLoading) return w.__maplibreLoading;
  w.__maplibreLoading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = MAPLIBRE + "maplibre-gl.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = MAPLIBRE + "maplibre-gl.js";
    js.onload = () => resolve(w.maplibregl);
    js.onerror = () => { w.__maplibreLoading = null; reject(new Error("No se pudo cargar el mapa (MapLibre).")); };
    document.head.appendChild(js);
  });
  return w.__maplibreLoading;
}
