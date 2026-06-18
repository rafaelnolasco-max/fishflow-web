"use client";

import { useEffect } from "react";

/**
 * Embed inline de Cal.com (sin dependencias npm).
 *
 * Cuando Rafa cree el event type en Cal.com, el enlace queda como:
 *   cal.com/<usuario>/<slug>  →  CAL_LINK = "<usuario>/<slug>"
 *
 * Config acordada: "Diagnóstico FishFlow · 30 min", Lun–Vie 11:00–14:00,
 * zona America/Mexico_City. Esos parámetros viven en Cal.com, no aquí:
 * si cambian, no hay que tocar este archivo. Lo único editable es CAL_LINK.
 */
const CAL_LINK = "rafa-fish-likxep/diagnostico-fishflow";

// Color de marca FishFlow (naranja principal)
const BRAND = "FF8C35";

export default function BookingCal() {
  useEffect(() => {
    // Snippet oficial de Cal.com embed.js (carga única e idempotente)
    (function (C: any, A: string, L: string) {
      const p = (a: any, ar: any) => {
        a.q.push(ar);
      };
      const d = C.document;
      C.Cal =
        C.Cal ||
        function (...args: any[]) {
          const cal = C.Cal;
          const ar = args;
          if (!cal.loaded) {
            cal.ns = {};
            cal.q = cal.q || [];
            const s = d.createElement("script");
            s.src = A;
            d.head.appendChild(s);
            cal.loaded = true;
          }
          if (ar[0] === L) {
            const api: any = function (...iargs: any[]) {
              p(api, iargs);
            };
            const namespace = ar[1];
            api.q = api.q || [];
            if (typeof namespace === "string") {
              cal.ns[namespace] = cal.ns[namespace] || api;
              p(cal.ns[namespace], ar);
              p(cal, ["initNamespace", namespace]);
            } else {
              p(cal, ar);
            }
            return;
          }
          p(cal, ar);
        };
    })(window, "https://app.cal.com/embed/embed.js", "init");

    const Cal = (window as any).Cal;
    Cal("init", "diagnostico", { origin: "https://cal.com" });

    Cal.ns.diagnostico("inline", {
      elementOrSelector: "#cal-inline-diagnostico",
      calLink: CAL_LINK,
      layout: "month_view",
      config: { layout: "month_view" },
    });

    Cal.ns.diagnostico("ui", {
      cssVarsPerTheme: {
        light: { "cal-brand": `#${BRAND}` },
        dark: { "cal-brand": `#${BRAND}` },
      },
      hideEventTypeDetails: false,
      layout: "month_view",
    });
  }, []);

  return (
    <div
      id="cal-inline-diagnostico"
      className="w-full overflow-hidden rounded-2xl border border-primary/20 bg-white shadow-sm"
      style={{ minHeight: 600 }}
    />
  );
}
