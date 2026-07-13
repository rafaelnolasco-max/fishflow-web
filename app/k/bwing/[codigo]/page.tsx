'use client'

// ============================================================
// B-Wing Karaoke — Vista pública de mesa
// Ruta: fishflow.mx/k/bwing/[codigo]   (QR pegado en cada mesa)
// El código es aleatorio por mesa (karaoke_tables): nadie puede
// adivinar la URL de otra mesa para meterle o quitarle canciones.
// Sin login. La mesa pide canciones, ve SOLO sus canciones
// (nunca la fila global ni su posición — la fila la maneja
// Jesús con discrecionalidad), puede reordenar y cancelar
// las suyas mientras estén en espera.
// Escrituras → /api/bwing/requests (service role, valida el código).
// Lecturas → Supabase anon + Realtime (policy solo sesión open).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const AMBER = '#F7A917'

interface KRequest {
  id: string
  session_id: string
  table_number: number
  song: string
  artist: string | null
  singer_name: string
  status: 'pending' | 'next' | 'singing' | 'done' | 'cancelled'
  created_at: string
}

interface OwnRef {
  id: string
  edit_token: string
}

const STATUS_LABEL: Record<KRequest['status'], string> = {
  pending: 'En la fila',
  next: '¡Eres el siguiente!',
  singing: '¡Cantando!',
  done: 'Completada',
  cancelled: 'Cancelada',
}

export default function MesaBwing() {
  const params = useParams<{ codigo: string }>()
  const codigo = (params.codigo ?? '').toLowerCase()
  const storageKey = `bwing_mesa_${codigo}`

  const [mesa, setMesa] = useState<number | null>(null)
  const [maxPending, setMaxPending] = useState(12)
  const [invalid, setInvalid] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ownRefs, setOwnRefs] = useState<OwnRef[]>([])
  const [rows, setRows] = useState<KRequest[]>([])
  const [song, setSong] = useState('')
  const [artist, setArtist] = useState('')
  const [singer, setSinger] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const ownRefsRef = useRef<OwnRef[]>([])
  ownRefsRef.current = ownRefs

  // ── localStorage: mis canciones de esta mesa ──────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setOwnRefs(JSON.parse(raw))
    } catch {
      /* noop */
    }
  }, [storageKey])

  const saveRefs = useCallback(
    (refs: OwnRef[]) => {
      setOwnRefs(refs)
      try {
        localStorage.setItem(storageKey, JSON.stringify(refs))
      } catch {
        /* noop */
      }
    },
    [storageKey]
  )

  // ── Sesión abierta + fetch inicial + Realtime ─────────────────────────────
  const fetchRows = useCallback(async (sid: string) => {
    const ids = ownRefsRef.current.map((r) => r.id)
    if (ids.length === 0) {
      setRows([])
      return
    }
    const { data } = await supabase
      .from('karaoke_requests')
      .select('id, session_id, table_number, song, artist, singer_name, status, created_at')
      .eq('session_id', sid)
      .in('id', ids)
      .order('created_at', { ascending: true })
    setRows((data as KRequest[]) ?? [])
  }, [])

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      // 1) Resolver código → mesa (el servidor valida; anon no puede listar códigos)
      try {
        const res = await fetch(
          `/api/bwing/requests?code=${encodeURIComponent(codigo)}`
        )
        if (!res.ok) {
          setInvalid(true)
          setLoading(false)
          return
        }
        const json = await res.json()
        setMesa(json.table_number)
        if (json.max_pending) setMaxPending(json.max_pending)
      } catch {
        setInvalid(true)
        setLoading(false)
        return
      }

      // 2) Sesión abierta + Realtime
      const { data: sess } = await supabase
        .from('karaoke_sessions')
        .select('id')
        .eq('status', 'open')
        .maybeSingle()
      setSessionId(sess?.id ?? null)
      setLoading(false)
      if (!sess) return

      await fetchRows(sess.id)

      channel = supabase
        .channel(`bwing-mesa-${codigo}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'karaoke_requests',
            filter: `session_id=eq.${sess.id}`,
          },
          () => fetchRows(sess.id)
        )
        .subscribe()
    }

    init()
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [codigo, fetchRows])

  // refetch cuando cambian mis refs (p. ej. acabo de agregar una)
  useEffect(() => {
    if (sessionId) fetchRows(sessionId)
  }, [ownRefs, sessionId, fetchRows])

  // ── Acciones ──────────────────────────────────────────────────────────────
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSending(true)
    try {
      const res = await fetch('/api/bwing/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: codigo,
          song,
          artist,
          singer_name: singer,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      saveRefs([...ownRefs, { id: json.id, edit_token: json.edit_token }])
      setSong('')
      setArtist('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error, intenta de nuevo')
    } finally {
      setSending(false)
    }
  }

  async function cancel(id: string) {
    if (!confirm('¿Quitar esta canción de la fila?')) return
    const ref = ownRefs.find((r) => r.id === id)
    if (!ref) return
    await fetch('/api/bwing/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', id, edit_token: ref.edit_token }),
    })
    if (sessionId) fetchRows(sessionId)
  }

  async function saveEdit(id: string, newSong: string, newArtist: string, newSinger: string) {
    const ref = ownRefs.find((r) => r.id === id)
    if (!ref) return
    const res = await fetch('/api/bwing/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'edit',
        id,
        edit_token: ref.edit_token,
        song: newSong,
        artist: newArtist,
        singer_name: newSinger,
      }),
    })
    if (res.ok) {
      setEditingId(null)
      if (sessionId) fetchRows(sessionId)
    }
  }

  async function move(id: string, dir: -1 | 1) {
    // Reordenar solo entre MIS canciones pendientes (permuta de lugares propios)
    const pend = rows.filter((r) => r.status === 'pending')
    const idx = pend.findIndex((r) => r.id === id)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= pend.length) return
    const order = [...pend]
    ;[order[idx], order[to]] = [order[to], order[idx]]
    const items = order
      .map((r) => {
        const ref = ownRefs.find((o) => o.id === r.id)
        return ref ? { id: r.id, edit_token: ref.edit_token } : null
      })
      .filter(Boolean)
    if (items.length !== order.length) return
    await fetch('/api/bwing/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reorder_own', items }),
    })
    if (sessionId) fetchRows(sessionId)
  }

  // ── Derivados ─────────────────────────────────────────────────────────────
  const visible = rows.filter((r) => r.status !== 'cancelled')
  const isNext = visible.some((r) => r.status === 'next')
  const isSinging = visible.some((r) => r.status === 'singing')
  const pendingCount = visible.filter((r) => r.status === 'pending').length

  // ── UI ────────────────────────────────────────────────────────────────────
  if (invalid) {
    return (
      <Shell>
        <div className="text-center mt-20 space-y-3">
          <div className="text-5xl">🤔</div>
          <p className="text-neutral-400">
            Este QR no corresponde a ninguna mesa. Pídele al staff el QR de tu mesa.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {/* Header */}
      <header className="flex items-center justify-between pb-5">
        <div>
          <div className="text-3xl font-extrabold tracking-tight">
            b<span style={{ color: AMBER }}>·</span>wing
          </div>
          <div className="text-xs uppercase tracking-widest text-neutral-400">
            karaoke
          </div>
        </div>
        <div
          className="rounded-2xl px-4 py-2 text-center border"
          style={{ borderColor: AMBER }}
        >
          <div className="text-[10px] uppercase tracking-widest text-neutral-400">
            Mesa
          </div>
          <div className="text-2xl font-extrabold" style={{ color: AMBER }}>
            {mesa ?? '·'}
          </div>
        </div>
      </header>

      {loading ? (
        <p className="text-center text-neutral-500 mt-16">Cargando…</p>
      ) : !sessionId ? (
        <div className="text-center mt-16 space-y-3">
          <div className="text-5xl">🎤</div>
          <h1 className="text-xl font-bold">El karaoke aún no abre</h1>
          <p className="text-neutral-400 text-sm">
            Pídele al staff que abra la noche y recarga esta página.
          </p>
        </div>
      ) : (
        <>
          {/* Banner de turno */}
          {isSinging && (
            <div className="rounded-2xl p-4 mb-4 text-center font-extrabold text-lg bg-green-400 text-black animate-pulse">
              🎶 ¡Te toca! Al escenario 🎶
            </div>
          )}
          {!isSinging && isNext && (
            <div
              className="rounded-2xl p-4 mb-4 text-center font-extrabold text-lg text-black animate-pulse"
              style={{ background: AMBER }}
            >
              🎤 ¡Eres el siguiente! Prepárate
            </div>
          )}

          {/* Form */}
          <form
            onSubmit={submit}
            className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 space-y-3"
          >
            <h2 className="font-bold text-sm uppercase tracking-widest text-neutral-400">
              Pide tu canción
            </h2>
            <input
              value={song}
              onChange={(e) => setSong(e.target.value)}
              placeholder="Canción *"
              required
              maxLength={120}
              className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-4 py-3 text-base outline-none focus:border-[#F7A917]"
            />
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artista"
              maxLength={120}
              className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-4 py-3 text-base outline-none focus:border-[#F7A917]"
            />
            <input
              value={singer}
              onChange={(e) => setSinger(e.target.value)}
              placeholder="¿Quién canta? *"
              required
              maxLength={60}
              className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-4 py-3 text-base outline-none focus:border-[#F7A917]"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={sending || pendingCount >= maxPending}
              className="w-full rounded-xl py-4 font-extrabold text-black text-lg disabled:opacity-40"
              style={{ background: AMBER }}
            >
              {sending ? 'Enviando…' : '🎤 ¡A la fila!'}
            </button>
            {pendingCount >= maxPending && (
              <p className="text-neutral-500 text-xs text-center">
                Tu mesa ya tiene {maxPending} canciones en espera. Cuando pase una, puedes pedir otra.
              </p>
            )}
          </form>

          {/* Mis canciones */}
          <section className="mt-6">
            <h2 className="font-bold text-sm uppercase tracking-widest text-neutral-400 mb-3">
              Tus canciones
            </h2>
            {visible.length === 0 ? (
              <p className="text-neutral-600 text-sm">
                Aún no has pedido canciones esta noche.
              </p>
            ) : (
              <ul className="space-y-3">
                {visible.map((r) => {
                  const pend = visible.filter((x) => x.status === 'pending')
                  const pIdx = pend.findIndex((x) => x.id === r.id)
                  const editable = r.status === 'pending'
                  return (
                    <li
                      key={r.id}
                      className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-base truncate">{r.song}</div>
                          {r.artist && (
                            <div className="text-neutral-400 text-sm truncate">
                              {r.artist}
                            </div>
                          )}
                          <div className="text-neutral-500 text-xs mt-1">
                            Canta: {r.singer_name}
                          </div>
                        </div>
                        <StatusChip status={r.status} />
                      </div>

                      {editable && editingId !== r.id && (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => move(r.id, -1)}
                            disabled={pIdx <= 0}
                            className="flex-1 rounded-lg border border-neutral-700 py-2 text-sm disabled:opacity-30"
                            aria-label="Subir en tu lista"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => move(r.id, 1)}
                            disabled={pIdx < 0 || pIdx >= pend.length - 1}
                            className="flex-1 rounded-lg border border-neutral-700 py-2 text-sm disabled:opacity-30"
                            aria-label="Bajar en tu lista"
                          >
                            ▼
                          </button>
                          <button
                            onClick={() => setEditingId(r.id)}
                            className="flex-1 rounded-lg border border-neutral-700 py-2 text-sm"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => cancel(r.id)}
                            className="flex-1 rounded-lg border border-red-900 text-red-400 py-2 text-sm"
                          >
                            🗑
                          </button>
                        </div>
                      )}

                      {editable && editingId === r.id && (
                        <EditForm
                          row={r}
                          onSave={(s, a, n) => saveEdit(r.id, s, a, n)}
                          onCancel={() => setEditingId(null)}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {pendingCount > 1 && (
              <p className="text-neutral-600 text-xs mt-3">
                Con ▲▼ decides cuál de tus canciones va primero.
              </p>
            )}
          </section>
        </>
      )}

      <footer className="mt-10 pb-6 text-center text-neutral-700 text-xs">
        b·wing · alitas, música y buena vibra
      </footer>
    </Shell>
  )
}

// ─── Componentes auxiliares ──────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="min-h-screen text-white px-4 pt-6 max-w-md mx-auto"
      style={{ background: '#120e08' }}
    >
      {children}
    </main>
  )
}

function StatusChip({ status }: { status: KRequest['status'] }) {
  const styles: Record<KRequest['status'], string> = {
    pending: 'border-neutral-600 text-neutral-300',
    next: 'text-black font-bold',
    singing: 'bg-green-400 text-black font-bold border-transparent',
    done: 'border-neutral-700 text-neutral-500',
    cancelled: 'border-neutral-800 text-neutral-600 line-through',
  }
  return (
    <span
      className={`shrink-0 rounded-full border px-3 py-1 text-xs ${styles[status]}`}
      style={status === 'next' ? { background: AMBER, borderColor: AMBER } : undefined}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function EditForm({
  row,
  onSave,
  onCancel,
}: {
  row: KRequest
  onSave: (song: string, artist: string, singer: string) => void
  onCancel: () => void
}) {
  const [s, setS] = useState(row.song)
  const [a, setA] = useState(row.artist ?? '')
  const [n, setN] = useState(row.singer_name)
  return (
    <div className="mt-3 space-y-2">
      <input
        value={s}
        onChange={(e) => setS(e.target.value)}
        maxLength={120}
        className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm"
        placeholder="Canción"
      />
      <input
        value={a}
        onChange={(e) => setA(e.target.value)}
        maxLength={120}
        className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm"
        placeholder="Artista"
      />
      <input
        value={n}
        onChange={(e) => setN(e.target.value)}
        maxLength={60}
        className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm"
        placeholder="¿Quién canta?"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(s, a, n)}
          disabled={!s.trim() || !n.trim()}
          className="flex-1 rounded-lg py-2 text-sm font-bold text-black disabled:opacity-40"
          style={{ background: AMBER }}
        >
          Guardar
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border border-neutral-700 py-2 text-sm"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
