'use client'

import { useState } from 'react'
import { fbqTrack } from '@/components/MetaPixel'

type FormState = 'idle' | 'loading' | 'success' | 'error'

export default function LeadForm() {
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [problem, setProblem] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState]     = useState<FormState>('idle')
  const [response, setResponse] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!consent) return
    setState('loading')
    setResponse('')

    try {
      const res = await fetch('/api/leads/ai', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, problem }),
      })

      const data = await res.json()

      if (!res.ok) {
        setState('error')
        setResponse(data.error ?? 'Algo salió mal. Intenta de nuevo.')
        return
      }

      setState('success')
      setResponse(data.response)
      // Conversión a Meta (solo dispara si el píxel está activo)
      fbqTrack('Lead', { content_name: 'Diagnóstico IA FishFlow' })
    } catch {
      setState('error')
      setResponse('No pudimos procesar tu solicitud. Revisa tu conexión e intenta de nuevo.')
    }
  }

  return (
    <section
      id="diagnostico"
      className="w-full py-20 px-4"
      style={{ background: '#0D1B2A' }}
    >
      <div className="max-w-2xl mx-auto">

        {/* Encabezado */}
        <div className="text-center mb-10">
          <span
            className="inline-block text-sm font-semibold uppercase tracking-widest mb-4"
            style={{ color: '#67D4E8' }}
          >
            Diagnóstico gratuito
          </span>
          <h2
            className="text-3xl md:text-4xl font-extrabold leading-tight"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#F1F5F9' }}
          >
            ¿Cuál es el mayor reto de tu negocio?
          </h2>
          <p className="mt-3 text-base" style={{ color: '#94a3b8' }}>
            Cuéntanos en tus propias palabras — te respondemos en segundos con una propuesta concreta.
          </p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-4">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Nombre */}
            <div>
              <label
                htmlFor="lead-name"
                className="block text-sm font-medium mb-1"
                style={{ color: '#94a3b8' }}
              >
                Tu nombre
              </label>
              <input
                id="lead-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="María López"
                disabled={state === 'loading'}
                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#F1F5F9',
                }}
                onFocus={(e) => (e.target.style.borderColor = '#FF8C35')}
                onBlur={(e)  => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
            </div>

            {/* Email */}
            <div>
              <label
                htmlFor="lead-email"
                className="block text-sm font-medium mb-1"
                style={{ color: '#94a3b8' }}
              >
                Tu correo
              </label>
              <input
                id="lead-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="maria@minegocio.com"
                disabled={state === 'loading'}
                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#F1F5F9',
                }}
                onFocus={(e) => (e.target.style.borderColor = '#FF8C35')}
                onBlur={(e)  => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
            </div>
          </div>

          {/* Problema */}
          <div>
            <label
              htmlFor="lead-problem"
              className="block text-sm font-medium mb-1"
              style={{ color: '#94a3b8' }}
            >
              ¿Qué problema quieres resolver?
            </label>
            <textarea
              id="lead-problem"
              required
              rows={4}
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              placeholder='Ej. "Necesito que mis clientes reciban un aviso automático cuando su ropa está lista en la tintorería"'
              disabled={state === 'loading'}
              className="w-full rounded-lg px-4 py-3 text-sm outline-none resize-none transition-all disabled:opacity-50"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#F1F5F9',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#FF8C35')}
              onBlur={(e)  => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
          </div>

          {/* Consentimiento */}
          <label htmlFor="lead-consent" className="flex items-start gap-3 cursor-pointer">
            <input
              id="lead-consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={state === 'loading'}
              className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
              style={{ accentColor: '#FF8C35' }}
            />
            <span className="text-xs leading-5" style={{ color: '#94a3b8' }}>
              He leído y acepto el{' '}
              <a
                href="/aviso-de-privacidad"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: '#67D4E8' }}
              >
                Aviso de Privacidad
              </a>{' '}
              y autorizo el tratamiento de mis datos para ser contactado.
            </span>
          </label>

          {/* Botón */}
          <button
            type="submit"
            disabled={state === 'loading' || !consent}
            className="w-full py-3 rounded-lg font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: '#FF8C35', color: '#fff' }}
          >
            {state === 'loading' ? 'Analizando tu negocio…' : 'Ver mi propuesta →'}
          </button>
        </form>

        {/* Respuesta de la IA */}
        {state === 'success' && response && (
          <div
            className="mt-8 rounded-xl p-6 animate-fade-in"
            style={{
              background: 'rgba(103,212,232,0.06)',
              border: '1px solid rgba(103,212,232,0.2)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ background: '#67D4E8' }}
              />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#67D4E8' }}>
                Tu propuesta
              </span>
            </div>
            <p className="text-sm leading-7" style={{ color: '#e2e8f0' }}>
              {response}
            </p>
            <p className="mt-4 text-xs" style={{ color: '#64748b' }}>
              También te enviamos esto a <strong style={{ color: '#94a3b8' }}>{email}</strong> para que lo tengas guardado.
            </p>
          </div>
        )}

        {/* Error */}
        {state === 'error' && response && (
          <div
            className="mt-6 rounded-lg px-4 py-3 text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            {response}
          </div>
        )}

      </div>
    </section>
  )
}
