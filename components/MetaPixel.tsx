'use client'

import Script from 'next/script'

// Píxel de Meta (Facebook/Instagram) para fishflow.mx.
// Se activa SOLO si existe NEXT_PUBLIC_META_PIXEL_ID (configúrala en Vercel).
// Sin la variable no renderiza nada: cero efecto, cero riesgo.
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

// Helper para disparar eventos desde cualquier componente cliente.
export function fbqTrack(event: string, params?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && (window as any).fbq) {
    ;(window as any).fbq('track', event, params || {})
  }
}

export default function MetaPixel() {
  if (!PIXEL_ID) return null
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
        document,'script','https://connect.facebook.net/en_US/fbevents.js');
        fbq('init','${PIXEL_ID}');fbq('track','PageView');`}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  )
}
