'use client'

import Script from 'next/script'

// Google Analytics 4 (GA4) para fishflow.mx.
// Mide el tráfico del sitio: origen de las visitas, páginas vistas,
// interacción y conversiones. Es independiente del Píxel de Meta.
// El ID se puede sobreescribir con NEXT_PUBLIC_GA_ID (Vercel); si no,
// usa el ID de la propiedad "FishFlow" en Google Analytics.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-7HET91ETT5'

export default function GoogleAnalytics() {
  if (!GA_ID) return null
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${GA_ID}');`}
      </Script>
    </>
  )
}
