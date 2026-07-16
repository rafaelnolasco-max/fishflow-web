'use client'

// ============================================================
// B-Wing Karaoke — Panel admin (Jesús / Rafa)
// Ruta: fishflow.mx/app/bwing   (login requerido, middleware)
// Optimizado para iPad. Fila en vivo con Realtime.
// - Abrir / cerrar la noche (karaoke_sessions)
// - Marcar siguiente / cantando / completada
// - Reordenar la fila (▲ ▼ ⏫ — solo el admin ve posiciones)
// - Contador de canciones por mesa (base de estadísticas)
// Escrituras directas con el cliente autenticado (RLS
// user_has_access_to_client), sin pasar por el API público.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const AMBER = '#F7A917'
const BWING_CLIENT_ID = '1ced78d9-f137-4d8b-b7d6-82178fd90806'

// Mesa 0 = el host (Jesús agrega sus canciones desde el admin)
function mesaLabel(n: number) {
  return n === 0 ? '🎙 Host' : `Mesa ${n}`
}

interface KRequest {
  id: string
  session_id: string
  table_number: number
  song: string
  artist: string | null
  singer_name: string
  status: 'pending' | 'next' | 'singing' | 'done' | 'cancelled'
  position: number | null
  created_at: string
  updated_at: string
}

interface KSession {
  id: string
  opened_at: string
  status: 'open' | 'closed'
}

export default function BwingAdmin() {
  const [session, setSession] = useState<KSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<KRequest[]>([])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [view, setView] = useState<'fila' | 'resumen'>('fila')
  const [hostOpen, setHostOpen] = useState(false)
  const [hostSong, setHostSong] = useState('')
  const [hostArtist, setHostArtist] = useState('')
  const [hostSinger, setHostSinger] = useState('Jesús')

  function notify(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // ── Carga ─────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (sid: string) => {
    const { data, error } = await supabase
      .from('karaoke_requests')
      .select('*')
      .eq('session_id', sid)
      .order('position', { ascending: true })
    if (error) {
      console.error('[bwing admin] fetch:', error)
      return
    }
    setRows((data as KRequest[]) ?? [])
  }, [])

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data, error } = await supabase
        .from('karaoke_sessions')
        .select('id, opened_at, status')
        .eq('client_id', BWING_CLIENT_ID)
        .eq('status', 'open')
        .maybeSingle()
      if (error) console.error('[bwing admin] session:', error)
      setSession((data as KSession) ?? null)
      setLoading(false)
      if (!data) return

      await fetchAll(data.id)
      channel = supabase
        .channel('bwing-admin')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'karaoke_requests',
            filter: `session_id=eq.${data.id}`,
          },
          () => fetchAll(data.id)
        )
        .subscribe()
    }

    init()
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [fetchAll])

  // ── Sesión (noche) ────────────────────────────────────────────────────────
  async function openNight() {
    setBusy(true)
    const { data, error } = await supabase
      .from('karaoke_sessions')
      .insert({ client_id: BWING_CLIENT_ID })
      .select('id, opened_at, status')
      .single()
    setBusy(false)
    if (error) {
      console.error('[bwing admin] openNight:', error)
      notify('No se pudo abrir la noche')
      return
    }
    setSession(data as KSession)
    setRows([])
    notify('Noche abierta 🎤')
  }

  async function closeNight() {
    if (!session) return
    if (!confirm('¿Cerrar la noche? Las mesas ya no podrán pedir canciones.')) return
    setBusy(true)
    const { error } = await supabase
      .from('karaoke_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', session.id)
    setBusy(false)
    if (error) {
      console.error('[bwing admin] closeNight:', error)
      notify('No se pudo cerrar la noche')
      return
    }
    setSession(null)
    setRows([])
    notify('Noche cerrada')
  }

  // ── Canción del host (Jesús canta) ────────────────────────────────────────
  // Inserta directo con el cliente autenticado (RLS user_has_access_to_client);
  // mesa 0 = host. Entra a la fila como cualquier petición.
  async function addHostSong() {
    if (!session || !hostSong.trim() || !hostSinger.trim()) return
    setBusy(true)
    const maxPos = Math.max(0, ...rows.map((r) => r.position ?? 0))
    const { error } = await supabase.from('karaoke_requests').insert({
      session_id: session.id,
      client_id: BWING_CLIENT_ID,
      table_number: 0,
      song: hostSong.trim().slice(0, 120),
      artist: hostArtist.trim().slice(0, 120) || null,
      singer_name: hostSinger.trim().slice(0, 60),
      position: maxPos + 1,
    })
    setBusy(false)
    if (error) {
      console.error('[bwing admin] addHostSong:', error)
      notify('No se pudo agregar la canción')
      return
    }
    setHostSong('')
    setHostArtist('')
    setHostOpen(false)
    notify('🎙 Canción del host en la fila')
    fetchAll(session.id)
  }

  // ── Acciones sobre la fila ────────────────────────────────────────────────
  async function setStatus(r: KRequest, status: KRequest['status']) {
    if (!session) return
    // Reglas de exclusividad: solo un 'next' y un 'singing' a la vez.
    if (status === 'next') {
      const current = rows.find((x) => x.status === 'next' && x.id !== r.id)
      if (current) {
        const { error } = await supabase
          .from('karaoke_requests')
          .update({ status: 'pending' })
          .eq('id', current.id)
        if (error) console.error('[bwing admin] demote next:', error)
      }
    }
    if (status === 'singing') {
      const current = rows.find((x) => x.status === 'singing' && x.id !== r.id)
      if (current) {
        const { error } = await supabase
          .from('karaoke_requests')
          .update({ status: 'done' })
          .eq('id', current.id)
        if (error) console.error('[bwing admin] finish singing:', error)
      }
    }
    const { error } = await supabase
      .from('karaoke_requests')
      .update({ status })
      .eq('id', r.id)
    if (error) {
      console.error('[bwing admin] setStatus:', error)
      notify('Error al actualizar')
      return
    }
    fetchAll(session.id)
  }

  const queue = rows
    .filter((r) => r.status === 'pending' || r.status === 'next')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  async function move(r: KRequest, dir: -1 | 1) {
    if (!session) return
    const idx = queue.findIndex((x) => x.id === r.id)
    const other = queue[idx + dir]
    if (!other) return
    // Swap de posiciones (siempre capturar error — updates silenciosos no)
    const { error: e1 } = await supabase
      .from('karaoke_requests')
      .update({ position: other.position })
      .eq('id', r.id)
    const { error: e2 } = await supabase
      .from('karaoke_requests')
      .update({ position: r.position })
      .eq('id', other.id)
    if (e1 || e2) {
      console.error('[bwing admin] move:', e1 ?? e2)
      notify('Error al reordenar')
    }
    fetchAll(session.id)
  }

  async function moveToFront(r: KRequest) {
    if (!session) return
    const minPos = Math.min(...queue.map((x) => x.position ?? 0))
    const { error } = await supabase
      .from('karaoke_requests')
      .update({ position: minPos - 1 })
      .eq('id', r.id)
    if (error) {
      console.error('[bwing admin] moveToFront:', error)
      notify('Error al reordenar')
    }
    fetchAll(session.id)
  }

  // ── Derivados ─────────────────────────────────────────────────────────────
  const singing = rows.find((r) => r.status === 'singing')
  const doneCount = rows.filter((r) => r.status === 'done').length
  const cancelledCount = rows.filter((r) => r.status === 'cancelled').length
  const byTable = rows
    .filter((r) => r.status !== 'cancelled')
    .reduce<Record<number, number>>((acc, r) => {
      acc[r.table_number] = (acc[r.table_number] ?? 0) + 1
      return acc
    }, {})

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen text-white px-5 py-6" style={{ background: '#120e08' }}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-3xl font-extrabold tracking-tight">
              b<span style={{ color: AMBER }}>·</span>wing{' '}
              <span className="text-neutral-500 text-lg font-semibold">· karaoke admin</span>
            </div>
            {session && (
              <div className="text-xs text-neutral-500 mt-1">
                Noche abierta desde{' '}
                {new Date(session.opened_at).toLocaleTimeString('es-MX', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            )}
            <button
              onClick={signOut}
              className="text-xs text-neutral-500 underline underline-offset-2 mt-1 hover:text-neutral-300"
            >
              Cerrar sesión
            </button>
          </div>
          {session ? (
            <button
              onClick={closeNight}
              disabled={busy}
              className="rounded-xl border border-red-900 text-red-400 px-5 py-3 font-bold disabled:opacity-40"
            >
              Cerrar noche
            </button>
          ) : !loading ? (
            <button
              onClick={openNight}
              disabled={busy}
              className="rounded-xl px-5 py-3 font-extrabold text-black disabled:opacity-40"
              style={{ background: AMBER }}
            >
              🎤 Abrir noche
            </button>
          ) : null}
        </header>

        {toast && (
          <div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl px-5 py-3 font-bold text-black z-50"
            style={{ background: AMBER }}
          >
            {toast}
          </div>
        )}

        {loading ? (
          <p className="text-neutral-500">Cargando…</p>
        ) : !session ? (
          <div className="text-center mt-20 space-y-3">
            <div className="text-5xl">🌙</div>
            <p className="text-neutral-400">
              No hay noche abierta. Abre la noche para que las mesas puedan pedir canciones.
            </p>
          </div>
        ) : (
          <>
            {/* Tabs Fila / Resumen + canción del host */}
            <div className="flex gap-2 mb-5 flex-wrap items-center">
              {(['fila', 'resumen'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-xl px-5 py-2.5 font-bold text-sm ${
                    view === v ? 'text-black' : 'border border-neutral-700 text-neutral-400'
                  }`}
                  style={view === v ? { background: AMBER } : undefined}
                >
                  {v === 'fila' ? `🎤 Fila (${queue.length})` : '📊 Resumen de la noche'}
                </button>
              ))}
              <button
                onClick={() => setHostOpen((v) => !v)}
                className="rounded-xl px-5 py-2.5 font-bold text-sm border text-neutral-200 ml-auto"
                style={{ borderColor: AMBER }}
              >
                🎙 Canción del host
              </button>
            </div>

            {/* Form del host */}
            {hostOpen && (
              <div
                className="rounded-2xl border bg-neutral-900/60 p-4 mb-5 grid gap-2 sm:grid-cols-[2fr_2fr_1fr_auto]"
                style={{ borderColor: AMBER }}
              >
                <input
                  value={hostSong}
                  onChange={(e) => setHostSong(e.target.value)}
                  placeholder="Canción *"
                  maxLength={120}
                  className="rounded-xl bg-neutral-800 border border-neutral-700 px-4 py-3 outline-none focus:border-[#F7A917]"
                />
                <input
                  value={hostArtist}
                  onChange={(e) => setHostArtist(e.target.value)}
                  placeholder="Artista"
                  maxLength={120}
                  className="rounded-xl bg-neutral-800 border border-neutral-700 px-4 py-3 outline-none focus:border-[#F7A917]"
                />
                <input
                  value={hostSinger}
                  onChange={(e) => setHostSinger(e.target.value)}
                  placeholder="¿Quién canta? *"
                  maxLength={60}
                  className="rounded-xl bg-neutral-800 border border-neutral-700 px-4 py-3 outline-none focus:border-[#F7A917]"
                />
                <button
                  onClick={addHostSong}
                  disabled={busy || !hostSong.trim() || !hostSinger.trim()}
                  className="rounded-xl px-5 py-3 font-extrabold text-black disabled:opacity-40"
                  style={{ background: AMBER }}
                >
                  ¡A la fila!
                </button>
              </div>
            )}

            {view === 'resumen' ? (
              <NightSummary rows={rows} openedAt={session.opened_at} />
            ) : (
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            {/* Columna principal: cantando + fila */}
            <div>
              {/* Cantando ahora */}
              <section className="mb-5">
                {singing ? (
                  <div className="rounded-2xl p-5 bg-green-400 text-black">
                    <div className="text-xs uppercase tracking-widest font-bold opacity-70">
                      Cantando ahora · {mesaLabel(singing.table_number)}
                    </div>
                    <div className="text-2xl font-extrabold mt-1">{singing.song}</div>
                    <div className="font-semibold">
                      {singing.artist ? `${singing.artist} · ` : ''}
                      {singing.singer_name}
                    </div>
                    <button
                      onClick={() => setStatus(singing, 'done')}
                      className="mt-3 rounded-xl bg-black text-white px-5 py-3 font-bold"
                    >
                      ✓ Completada
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl p-5 border border-dashed border-neutral-800 text-neutral-500 text-center">
                    Nadie está cantando ahora
                  </div>
                )}
              </section>

              {/* Fila */}
              <section>
                <h2 className="font-bold text-sm uppercase tracking-widest text-neutral-400 mb-3">
                  Fila ({queue.length})
                </h2>
                {queue.length === 0 ? (
                  <p className="text-neutral-600 text-sm">
                    La fila está vacía. Las peticiones de las mesas aparecen aquí en vivo.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {queue.map((r, i) => (
                      <li
                        key={r.id}
                        className={`rounded-2xl border p-4 flex flex-wrap items-center gap-3 sm:gap-4 ${
                          r.status === 'next'
                            ? 'bg-neutral-900'
                            : 'border-neutral-800 bg-neutral-900/50'
                        }`}
                        style={r.status === 'next' ? { borderColor: AMBER } : undefined}
                      >
                        <div
                          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-sm"
                          style={{
                            background: r.status === 'next' ? AMBER : '#262626',
                            color: r.status === 'next' ? '#000' : '#aaa',
                          }}
                        >
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1 basis-40">
                          <div className="font-bold truncate">
                            {r.song}
                            {r.artist && (
                              <span className="text-neutral-400 font-normal"> · {r.artist}</span>
                            )}
                          </div>
                          <div className="text-sm text-neutral-500">
                            {mesaLabel(r.table_number)} · {r.singer_name}
                            {r.status === 'next' && (
                              <span className="font-bold ml-2" style={{ color: AMBER }}>
                                SIGUIENTE
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1.5 w-full justify-end sm:w-auto sm:shrink-0">
                          <IconBtn label="Al frente" onClick={() => moveToFront(r)} disabled={i === 0}>
                            ⏫
                          </IconBtn>
                          <IconBtn label="Subir" onClick={() => move(r, -1)} disabled={i === 0}>
                            ▲
                          </IconBtn>
                          <IconBtn
                            label="Bajar"
                            onClick={() => move(r, 1)}
                            disabled={i === queue.length - 1}
                          >
                            ▼
                          </IconBtn>
                          {r.status !== 'next' ? (
                            <button
                              onClick={() => setStatus(r, 'next')}
                              className="rounded-lg px-3 py-2.5 text-sm font-bold text-black"
                              style={{ background: AMBER }}
                            >
                              Siguiente
                            </button>
                          ) : (
                            <button
                              onClick={() => setStatus(r, 'singing')}
                              className="rounded-lg px-3 py-2.5 text-sm font-bold text-black bg-green-400"
                            >
                              🎤 Canta
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Columna lateral: stats */}
            <aside className="space-y-5">
              <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
                <h2 className="font-bold text-sm uppercase tracking-widest text-neutral-400 mb-3">
                  La noche
                </h2>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="En fila" value={queue.length} />
                  <Stat label="Cantadas" value={doneCount} />
                  <Stat label="Canceladas" value={cancelledCount} />
                </div>
              </section>

              <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
                <h2 className="font-bold text-sm uppercase tracking-widest text-neutral-400 mb-3">
                  Canciones por mesa
                </h2>
                {Object.keys(byTable).length === 0 ? (
                  <p className="text-neutral-600 text-sm">Sin actividad todavía.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {Object.entries(byTable)
                      .sort((a, b) => b[1] - a[1])
                      .map(([mesa, n]) => (
                        <li
                          key={mesa}
                          className="flex justify-between text-sm border-b border-neutral-800/60 pb-1.5"
                        >
                          <span className="text-neutral-300">{mesaLabel(Number(mesa))}</span>
                          <span className="font-bold" style={{ color: AMBER }}>
                            {n}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

// ─── Resumen de la noche (dashboard de venta) ────────────────────────────────
// Todo se calcula en el cliente a partir de las requests de la sesión abierta
// (incluye canceladas — por eso cancelar es soft delete). SVG/CSS puro, sin deps.

const GREEN = 'rgb(74,222,128)'

function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const dur = 900
    const tick = (t: number) => {
      const p = Math.min((t - t0) / dur, 1)
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{n}</>
}

function NightSummary({ rows, openedAt }: { rows: KRequest[]; openedAt: string }) {
  const total = rows.length
  const done = rows.filter((r) => r.status === 'done')
  const cancelled = rows.filter((r) => r.status === 'cancelled')
  const inPlay = rows.filter(
    (r) => r.status === 'pending' || r.status === 'next' || r.status === 'singing'
  )

  // Ritmo: canciones cantadas por hora desde que abrió la noche
  const hoursOpen = Math.max(
    (Date.now() - new Date(openedAt).getTime()) / 3_600_000,
    1 / 60
  )
  const perHour = Math.round((done.length / hoursOpen) * 10) / 10

  // Espera promedio: creada → cantada (updated_at del done)
  const waits = done.map(
    (r) => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()
  )
  const avgWaitMin =
    waits.length > 0
      ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length / 60_000)
      : null

  function top(map: Record<string, number>, n = 5) {
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
  }

  const active = rows.filter((r) => r.status !== 'cancelled')
  const byTable = active.reduce<Record<string, number>>((acc, r) => {
    const k = mesaLabel(r.table_number)
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
  const byArtist = active.reduce<Record<string, number>>((acc, r) => {
    if (!r.artist) return acc
    const k = r.artist.trim()
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
  const bySong = active.reduce<Record<string, number>>((acc, r) => {
    const k = r.artist ? `${r.song.trim()} · ${r.artist.trim()}` : r.song.trim()
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})

  // Actividad por hora (pedidas) + hora pico
  const byHour = rows.reduce<Record<string, number>>((acc, r) => {
    const h = new Date(r.created_at).toLocaleTimeString('es-MX', { hour: '2-digit' })
    acc[h] = (acc[h] ?? 0) + 1
    return acc
  }, {})
  const hours = Object.entries(byHour).sort((a, b) => a[0].localeCompare(b[0]))
  const hourMax = Math.max(1, ...Object.values(byHour))
  const horaPico = hours.length > 0 ? hours.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null

  const podium = top(byTable, 3)

  if (total === 0) {
    return (
      <div className="text-center mt-16 space-y-3">
        <div className="text-6xl">🎤</div>
        <p className="text-neutral-400 text-lg font-bold">La noche apenas empieza</p>
        <p className="text-neutral-600 text-sm">
          Cuando las mesas pidan canciones, este tablero se llena solo — en vivo.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes ffUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
        @keyframes ffGrow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        @keyframes ffRise { from { transform: scaleY(0) } to { transform: scaleY(1) } }
        @keyframes ffDash { from { stroke-dasharray: 0 999 } }
        .ff-up { animation: ffUp .55s cubic-bezier(.22,1,.36,1) both }
        .ff-grow { transform-origin: left; animation: ffGrow .8s cubic-bezier(.22,1,.36,1) both }
        .ff-rise { transform-origin: bottom; animation: ffRise .7s cubic-bezier(.22,1,.36,1) both }
        .ff-dash { animation: ffDash 1.1s ease-out both }
      `}</style>

      {/* Hero: la noche en números */}
      <section
        className="ff-up rounded-3xl border p-6 sm:p-8"
        style={{
          borderColor: 'rgba(247,169,23,0.35)',
          background:
            'radial-gradient(ellipse at 20% -30%, rgba(247,169,23,0.16) 0%, rgba(18,14,8,0) 60%), rgba(23,18,10,0.6)',
        }}
      >
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-neutral-500 mb-5">
          ✨ La noche en números
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <Hero label="Canciones pedidas" value={<CountUp value={total} />} color={AMBER} />
          <Hero label="Cantadas" value={<CountUp value={done.length} />} color={GREEN} />
          <Hero
            label="Ritmo"
            value={
              <>
                {perHour}
                <span className="text-xl text-neutral-500 font-bold"> /hora</span>
              </>
            }
            color="#fff"
          />
          <Hero
            label="Espera promedio"
            value={
              avgWaitMin != null ? (
                <>
                  <CountUp value={avgWaitMin} />
                  <span className="text-xl text-neutral-500 font-bold"> min</span>
                </>
              ) : (
                <span className="text-neutral-600">—</span>
              )
            }
            color="#fff"
          />
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Donut: destino de las canciones */}
        <Card title="🎯 Destino de las canciones" delay={0.05}>
          <div className="flex items-center gap-6">
            <Donut
              total={total}
              segments={[
                { value: done.length, color: GREEN },
                { value: inPlay.length, color: AMBER },
                { value: cancelled.length, color: '#525252' },
              ]}
              center={done.length}
              centerLabel="cantadas"
            />
            <ul className="space-y-2.5 text-sm">
              <Legend color={GREEN} label="Cantadas" value={done.length} />
              <Legend color={AMBER} label="En juego" value={inPlay.length} />
              <Legend color="#525252" label="Canceladas" value={cancelled.length} />
            </ul>
          </div>
        </Card>

        {/* Podio de mesas */}
        <Card title="🏆 Podio de mesas" delay={0.1}>
          {podium.length === 0 ? (
            <Empty />
          ) : (
            <div className="flex items-end justify-center gap-4 h-44 pt-2">
              {[podium[1], podium[0], podium[2]]
                .filter((e): e is [string, number] => Boolean(e))
                .map((entry) => {
                  const rank = podium.indexOf(entry) // 0=oro
                  const heights = ['92%', '64%', '46%']
                  const medals = ['🥇', '🥈', '🥉']
                  return (
                    <div key={entry[0]} className="flex flex-col items-center justify-end h-full w-24">
                      <div className="text-2xl mb-1">{medals[rank]}</div>
                      <div className="text-lg font-extrabold" style={{ color: AMBER }}>
                        {entry[1]}
                      </div>
                      <div
                        className="ff-rise w-full rounded-t-xl mt-1"
                        style={{
                          height: heights[rank],
                          background: `linear-gradient(180deg, ${
                            rank === 0 ? AMBER : 'rgba(247,169,23,0.45)'
                          } 0%, rgba(247,169,23,0.08) 100%)`,
                          animationDelay: `${0.15 + rank * 0.12}s`,
                        }}
                      />
                      <div className="text-xs font-bold text-neutral-300 mt-2 text-center truncate w-full">
                        {entry[0]}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </Card>

        {/* Top artistas */}
        <Card title="🎸 Artistas más pedidos" delay={0.15}>
          <Bars items={top(byArtist)} />
        </Card>

        {/* Top canciones */}
        <Card title="🎵 Canciones más pedidas" delay={0.2}>
          <Bars items={top(bySong)} />
        </Card>
      </div>

      {/* Peticiones por hora */}
      <Card title="⏰ El pulso de la noche" delay={0.25}>
        {hours.length === 0 ? (
          <Empty />
        ) : (
          <>
            <div className="flex items-end gap-2 h-40 pt-2">
              {hours.map(([h, n], i) => {
                const pico = h === horaPico
                return (
                  <div key={h} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                    <div className="text-xs font-extrabold mb-1" style={{ color: pico ? GREEN : AMBER }}>
                      {pico && '🔥'}{n}
                    </div>
                    <div
                      className="ff-rise w-full max-w-14 rounded-t-lg"
                      style={{
                        height: `${Math.max((n / hourMax) * 100, 6)}%`,
                        background: pico
                          ? `linear-gradient(180deg, ${GREEN} 0%, rgba(74,222,128,0.1) 100%)`
                          : `linear-gradient(180deg, ${AMBER} 0%, rgba(247,169,23,0.08) 100%)`,
                        boxShadow: pico ? '0 0 18px rgba(74,222,128,0.35)' : undefined,
                        animationDelay: `${0.1 + i * 0.06}s`,
                      }}
                    />
                    <div className="text-[11px] text-neutral-500 mt-2 font-bold">{h}h</div>
                  </div>
                )
              })}
            </div>
            {horaPico && (
              <p className="text-xs text-neutral-500 mt-3">
                🔥 Hora pico: <span className="font-bold" style={{ color: GREEN }}>{horaPico}:00</span> — la
                hora con más peticiones de la noche.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

// ─── Piezas del dashboard ────────────────────────────────────────────────────

function Hero({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div>
      <div className="text-4xl sm:text-5xl font-extrabold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-widest text-neutral-500 mt-1.5">{label}</div>
    </div>
  )
}

function Card({
  title,
  children,
  delay = 0,
}: {
  title: string
  children: React.ReactNode
  delay?: number
}) {
  return (
    <section
      className="ff-up rounded-3xl border border-neutral-800 bg-neutral-900/50 p-5"
      style={{ animationDelay: `${delay}s` }}
    >
      <h2 className="font-bold text-sm uppercase tracking-widest text-neutral-400 mb-4">{title}</h2>
      {children}
    </section>
  )
}

function Donut({
  total,
  segments,
  center,
  centerLabel,
}: {
  total: number
  segments: { value: number; color: string }[]
  center: number
  centerLabel: string
}) {
  const R = 52
  const C = 2 * Math.PI * R
  let acc = 0
  return (
    <div className="relative shrink-0" style={{ width: 150, height: 150 }}>
      <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
        <circle cx="70" cy="70" r={R} stroke="#262626" strokeWidth="16" fill="none" />
        {segments.map((s, i) => {
          if (s.value === 0 || total === 0) return null
          const len = (s.value / total) * C
          const el = (
            <circle
              key={i}
              cx="70"
              cy="70"
              r={R}
              stroke={s.color}
              strokeWidth="16"
              fill="none"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-acc}
              strokeLinecap="butt"
              className="ff-dash"
            />
          )
          acc += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-extrabold" style={{ color: GREEN }}>
          <CountUp value={center} />
        </div>
        <div className="text-[10px] uppercase tracking-widest text-neutral-500">{centerLabel}</div>
      </div>
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-neutral-300">{label}</span>
      <span className="font-extrabold ml-auto pl-4 tabular-nums" style={{ color }}>
        {value}
      </span>
    </li>
  )
}

function Bars({ items }: { items: [string, number][] }) {
  if (items.length === 0) return <Empty />
  const max = Math.max(...items.map(([, n]) => n))
  return (
    <ul className="space-y-3">
      {items.map(([name, n], i) => (
        <li key={name}>
          <div className="flex justify-between text-sm mb-1 gap-3">
            <span className="min-w-0 truncate text-neutral-200 font-semibold">
              <span className="text-neutral-600 font-extrabold mr-2">{i + 1}</span>
              {name}
            </span>
            <span className="shrink-0 font-extrabold tabular-nums" style={{ color: AMBER }}>
              {n}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="ff-grow h-full rounded-full"
              style={{
                width: `${(n / max) * 100}%`,
                background: `linear-gradient(90deg, rgba(247,169,23,0.35) 0%, ${AMBER} 100%)`,
                animationDelay: `${0.1 + i * 0.08}s`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Empty() {
  return <p className="text-neutral-600 text-sm">Sin datos todavía — la noche apenas arranca.</p>
}

// ─── Auxiliares ──────────────────────────────────────────────────────────────

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-lg border border-neutral-700 px-3 py-2.5 text-sm disabled:opacity-25"
    >
      {children}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-neutral-800/60 py-3">
      <div className="text-2xl font-extrabold" style={{ color: AMBER }}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-neutral-500">{label}</div>
    </div>
  )
}
