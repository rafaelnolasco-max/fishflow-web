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

// ─── Resumen de la noche ─────────────────────────────────────────────────────
// Todo se calcula en el cliente a partir de las requests de la sesión abierta
// (incluye canceladas — por eso cancelar es soft delete).

function NightSummary({ rows, openedAt }: { rows: KRequest[]; openedAt: string }) {
  const total = rows.length
  const done = rows.filter((r) => r.status === 'done')
  const cancelled = rows.filter((r) => r.status === 'cancelled')
  const waiting = rows.filter((r) => r.status === 'pending' || r.status === 'next')

  // Ritmo: canciones cantadas por hora desde que abrió la noche
  const hoursOpen = Math.max(
    (Date.now() - new Date(openedAt).getTime()) / 3_600_000,
    1 / 60
  )
  const perHour = done.length / hoursOpen

  // Espera promedio: creada → cantada (updated_at del done)
  const waits = done.map(
    (r) => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()
  )
  const avgWaitMin =
    waits.length > 0 ? waits.reduce((a, b) => a + b, 0) / waits.length / 60_000 : null

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

  // Actividad por hora (pedidas)
  const byHour = rows.reduce<Record<string, number>>((acc, r) => {
    const h = new Date(r.created_at).toLocaleTimeString('es-MX', { hour: '2-digit' })
    acc[h] = (acc[h] ?? 0) + 1
    return acc
  }, {})
  const hourMax = Math.max(1, ...Object.values(byHour))

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center">
        <Stat label="Pedidas" value={total} />
        <Stat label="Cantadas" value={done.length} />
        <Stat label="En fila" value={waiting.length} />
        <Stat label="Canceladas" value={cancelled.length} />
        <Stat label="Por hora" value={Math.round(perHour * 10) / 10} />
        <Stat
          label="Espera prom."
          value={avgWaitMin != null ? `${Math.round(avgWaitMin)} min` : '—'}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Top mesas */}
        <RankCard title="🏆 Mesas más activas" items={top(byTable)} unit="canciones" />
        {/* Top artistas */}
        <RankCard title="🎸 Artistas más pedidos" items={top(byArtist)} unit="veces" />
        {/* Top canciones */}
        <RankCard title="🎵 Canciones más pedidas" items={top(bySong)} unit="veces" />

        {/* Actividad por hora */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
          <h2 className="font-bold text-sm uppercase tracking-widest text-neutral-400 mb-3">
            ⏰ Peticiones por hora
          </h2>
          {Object.keys(byHour).length === 0 ? (
            <p className="text-neutral-600 text-sm">Sin actividad todavía.</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(byHour)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([h, n]) => (
                  <li key={h} className="flex items-center gap-3 text-sm">
                    <span className="w-14 shrink-0 text-neutral-400">{h} h</span>
                    <div className="flex-1 h-4 rounded bg-neutral-800 overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{ width: `${(n / hourMax) * 100}%`, background: AMBER }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right font-bold" style={{ color: AMBER }}>
                      {n}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function RankCard({
  title,
  items,
  unit,
}: {
  title: string
  items: [string, number][]
  unit: string
}) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
      <h2 className="font-bold text-sm uppercase tracking-widest text-neutral-400 mb-3">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-neutral-600 text-sm">Sin datos todavía.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(([name, n], i) => (
            <li
              key={name}
              className="flex items-center justify-between gap-3 text-sm border-b border-neutral-800/60 pb-1.5"
            >
              <span className="min-w-0 truncate text-neutral-300">
                <span className="text-neutral-600 font-bold mr-2">{i + 1}</span>
                {name}
              </span>
              <span className="shrink-0 font-bold" style={{ color: AMBER }}>
                {n} <span className="text-neutral-600 font-normal">{unit}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
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
