'use client'

// ============================================================
// B-Wing Karaoke — Pantalla del bar (TV / proyector)
// Ruta: fishflow.mx/k/bwing/pantalla
// Sin login, cero interacción: se abre en la TV y se olvida.
// Muestra SOLO quién canta ahora y quién sigue — nunca la fila
// completa (las posiciones son asunto de Jesús).
// Lecturas → Supabase anon + Realtime (policy solo sesión open).
// Nota de ruta: el segmento estático /pantalla gana sobre el
// dinámico /[codigo], no hay conflicto.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const AMBER = '#F7A917'
const GREEN = 'rgb(74,222,128)'

// Mesa 0 = el host (Jesús)
function mesaLabel(n: number) {
  return n === 0 ? 'Host 🎙' : `Mesa ${n}`
}

interface KRequest {
  id: string
  table_number: number
  song: string
  artist: string | null
  singer_name: string
  status: 'pending' | 'next' | 'singing' | 'done' | 'cancelled'
}

export default function PantallaBwing() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [singing, setSinging] = useState<KRequest | null>(null)
  const [next, setNext] = useState<KRequest | null>(null)
  const [doneCount, setDoneCount] = useState(0)

  const fetchState = useCallback(async (sid: string) => {
    const { data } = await supabase
      .from('karaoke_requests')
      .select('id, table_number, song, artist, singer_name, status')
      .eq('session_id', sid)
      .in('status', ['singing', 'next', 'done'])
    const rows = (data as KRequest[]) ?? []
    setSinging(rows.find((r) => r.status === 'singing') ?? null)
    setNext(rows.find((r) => r.status === 'next') ?? null)
    setDoneCount(rows.filter((r) => r.status === 'done').length)
  }, [])

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    let sessChannel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data: sess } = await supabase
        .from('karaoke_sessions')
        .select('id')
        .eq('status', 'open')
        .maybeSingle()
      setSessionId(sess?.id ?? null)
      setLoading(false)

      if (sess) {
        await fetchState(sess.id)
        channel = supabase
          .channel('bwing-pantalla')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'karaoke_requests',
              filter: `session_id=eq.${sess.id}`,
            },
            () => fetchState(sess.id)
          )
          .subscribe()
      }

      // Si abren/cierran la noche, recargamos para re-suscribir
      sessChannel = supabase
        .channel('bwing-pantalla-sess')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'karaoke_sessions' },
          () => window.location.reload()
        )
        .subscribe()
    }

    init()
    return () => {
      if (channel) supabase.removeChannel(channel)
      if (sessChannel) supabase.removeChannel(sessChannel)
    }
  }, [fetchState])

  return (
    <main
      className="min-h-screen text-white flex flex-col overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at 50% -20%, #2a1f0a 0%, #120e08 55%, #0a0805 100%)',
      }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-[4vw] pt-[3vh]">
        <div className="text-[5vmin] font-extrabold tracking-tight leading-none">
          b<span style={{ color: AMBER }}>·</span>wing
          <span className="ml-[1.5vmin] text-[2vmin] font-bold uppercase tracking-[0.35em] text-neutral-500 align-middle">
            karaoke
          </span>
        </div>
        {sessionId && (
          <div className="flex items-center gap-[1vmin] text-[2.2vmin] font-bold uppercase tracking-widest">
            <span
              className="inline-block rounded-full animate-pulse"
              style={{ width: '1.6vmin', height: '1.6vmin', background: GREEN }}
            />
            <span style={{ color: GREEN }}>en vivo</span>
          </div>
        )}
      </header>

      {loading ? null : !sessionId ? (
        // ── Noche cerrada ──
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="text-[12vmin]">🎤</div>
          <h1 className="text-[6vmin] font-extrabold mt-[2vh]">
            El karaoke abre pronto
          </h1>
          <p className="text-[2.8vmin] text-neutral-500 mt-[1vh]">
            alitas, música y buena vibra
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center px-[6vw] pb-[4vh] gap-[4vh]">
          {/* Cantando ahora */}
          <section key={singing?.id ?? 'idle'} className="ff-enter">
            <div
              className="text-[2.4vmin] font-bold uppercase tracking-[0.35em] mb-[1.5vh]"
              style={{ color: GREEN }}
            >
              🎶 Cantando ahora
            </div>
            {singing ? (
              <>
                <div className="text-[8.5vmin] font-extrabold leading-[1.05] break-words">
                  {singing.song}
                </div>
                {singing.artist && (
                  <div className="text-[4vmin] text-neutral-400 mt-[0.5vh]">
                    {singing.artist}
                  </div>
                )}
                <div className="text-[3.4vmin] mt-[1.5vh]">
                  <span style={{ color: AMBER }} className="font-extrabold">
                    {singing.singer_name}
                  </span>
                  <span className="text-neutral-500"> · {mesaLabel(singing.table_number)}</span>
                </div>
              </>
            ) : (
              <div className="text-[5vmin] font-extrabold text-neutral-600">
                El escenario está libre…
              </div>
            )}
          </section>

          {/* Siguiente */}
          <section
            key={next?.id ?? 'no-next'}
            className="ff-enter rounded-[2vmin] border px-[3vw] py-[2.5vh]"
            style={{ borderColor: 'rgba(247,169,23,0.35)', background: 'rgba(247,169,23,0.06)' }}
          >
            <div
              className="text-[2.2vmin] font-bold uppercase tracking-[0.35em] mb-[1vh]"
              style={{ color: AMBER }}
            >
              🎤 Siguiente en la fila
            </div>
            {next ? (
              <div className="flex flex-wrap items-baseline gap-x-[2vmin]">
                <span className="text-[4.6vmin] font-extrabold break-words">
                  {next.song}
                </span>
                {next.artist && (
                  <span className="text-[2.8vmin] text-neutral-400">{next.artist}</span>
                )}
                <span className="text-[2.8vmin]">
                  <span style={{ color: AMBER }} className="font-bold">
                    {next.singer_name}
                  </span>
                  <span className="text-neutral-500"> · {mesaLabel(next.table_number)}</span>
                </span>
              </div>
            ) : (
              <div className="text-[3.2vmin] text-neutral-500">
                Pide tu canción con el QR de tu mesa 📲
              </div>
            )}
          </section>
        </div>
      )}

      {/* Footer */}
      {sessionId && (
        <footer className="px-[4vw] pb-[2.5vh] flex items-center justify-between text-[2vmin] text-neutral-600">
          <span>Escanea el QR de tu mesa para pedir tu canción</span>
          <span>
            {doneCount > 0 && (
              <>
                <span className="font-bold" style={{ color: AMBER }}>
                  {doneCount}
                </span>{' '}
                canciones esta noche
              </>
            )}
          </span>
        </footer>
      )}

      <style>{`
        @keyframes ffEnter {
          from {
            opacity: 0;
            transform: translateY(2.5vh) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .ff-enter {
          animation: ffEnter 0.6s cubic-bezier(0.22, 1, 0.36, 1);
        }
      `}</style>
    </main>
  )
}
