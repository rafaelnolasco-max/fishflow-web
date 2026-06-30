'use client'

import { useEffect } from 'react'
import { fbqTrack } from '@/components/MetaPixel'

// Rastrea clics en CTAs y los manda como eventos estándar de Meta:
//   - Contact  → correo (mailto) o WhatsApp
//   - Schedule → botones de agendar cita / ver disponibilidad
// Solo dispara si el píxel está activo (fbqTrack es no-op sin píxel).
export default function MetaCtaTracker() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const el = (e.target as HTMLElement)?.closest('a,button') as HTMLElement | null
      if (!el) return
      const href = (el.getAttribute('href') || '').toLowerCase()
      const txt = (el.textContent || '').toLowerCase()

      if (href.startsWith('mailto:') || href.includes('wa.me') || href.includes('api.whatsapp') || /whatsapp|escr[íi]beme|cont[áa]ctame/.test(txt)) {
        const canal = href.includes('wa.me') || href.includes('whatsapp') || txt.includes('whatsapp') ? 'WhatsApp' : 'Correo'
        fbqTrack('Contact', { content_name: canal })
      } else if (href.includes('#agenda') || /agendar|agenda|disponibilidad|reservar|\bcita\b/.test(txt)) {
        fbqTrack('Schedule', { content_name: 'Agendar diagnóstico' })
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  return null
}
