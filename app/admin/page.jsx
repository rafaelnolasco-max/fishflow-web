'use client'

// ============================================================
// FishFlow CRM — Next.js + Supabase
// Ruta: fishflow.mx/admin
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const STAGES = [
  { id: 'prospecto',   label: 'Prospecto',   color: '#5b6af0' },
  { id: 'demo',        label: 'Demo',        color: '#06b6d4' },
  { id: 'propuesta',   label: 'Propuesta',   color: '#f97316' },
  { id: 'negociacion', label: 'Negociación', color: '#eab308' },
  { id: 'cerrado',     label: 'Cerrado ✓',   color: '#22c55e' },
]

const MESES_OPTS = [3, 6, 12, 24, 36]

const EMPTY_FORM = {
  empresa: '', giro: '', contacto: '', cargo: '',
  etapa: 'prospecto', prob: 50, fecha: '',
  impl: '', sub: '', meses: 12, notas: '',
}

function tcv(d) {
  return (Number(d.impl) || 0) + (Number(d.sub) || 0) * (Number(d.meses) || 12)
}

function fmt(n) {
  if (!n) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${Number(n).toLocaleString('es-MX')}`
}

function probClass(p) {
  if (p >= 70) return 'prob-high'
  if (p >= 35) return 'prob-mid'
  return 'prob-low'
}

function fechaInfo(f) {
  if (!f) return null
  const diff = (new Date(f) - new Date()) / 86_400_000
  if (diff < 0)    return { txt: 'Fecha vencida',      cls: 'urgente' }
  if (diff <= 14)  return { txt: '⚠️ Esta quincena',  cls: 'urgente' }
  if (diff <= 30)  return { txt: '🕐 Mes en curso',   cls: 'pronto'  }
  return { txt: '📅 ' + new Date(f).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }), cls: '' }
}

export default function CRMPage() {
  const router = useRouter()
  const [deals,   setDeals]   = useState([])
  const [loading, setLoading] = useState(true)

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }
  const [search,  setSearch]  = useState('')
  const [modal,   setModal]   = useState({ open: false, editId: null })
  const [form,    setForm]    = useState(EMPTY_FORM)
  const [toast,   setToast]   = useState({ msg: '', type: '', show: false })
  const dragId  = useRef(null)
  const toastTm = useRef(null)

  const fetchDeals = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('opportunities')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error) setDeals(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchDeals() }, [fetchDeals])

  useEffect(() => {
    const channel = supabase
      .channel('opportunities-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities' }, fetchDeals)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchDeals])

  function showToast(msg, type = '') {
    clearTimeout(toastTm.current)
    setToast({ msg, type, show: true })
    toastTm.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 2800)
  }

  async function saveDeal() {
    if (!form.empresa.trim()) { showToast('❌ El nombre del negocio es requerido', 'error'); return }
    const payload = {
      empresa: form.empresa.trim(), giro: form.giro.trim(),
      contacto: form.contacto.trim(), cargo: form.cargo.trim(),
      etapa: form.etapa, prob: Number(form.prob), fecha: form.fecha || null,
      impl: Number(form.impl) || 0, sub: Number(form.sub) || 0,
      meses: Number(form.meses), notas: form.notas.trim(),
    }
    if (modal.editId) {
      const { error } = await supabase.from('opportunities').update(payload).eq('id', modal.editId)
      if (error) { showToast('❌ Error al actualizar', 'error'); return }
      showToast('✅ Oportunidad actualizada', 'success')
    } else {
      const { error } = await supabase.from('opportunities').insert(payload)
      if (error) { showToast('❌ Error al crear', 'error'); return }
      showToast('🎉 Oportunidad creada', 'success')
    }
    closeModal(); fetchDeals()
  }

  async function deleteDeal(id, empresa) {
    if (!confirm(`¿Eliminar "${empresa}"?`)) return
    const { error } = await supabase.from('opportunities').delete().eq('id', id)
    if (error) { showToast('❌ Error al eliminar', 'error'); return }
    showToast('🗑️ Oportunidad eliminada'); fetchDeals()
  }

  async function moveDeal(id, newEtapa) {
    const { error } = await supabase.from('opportunities').update({ etapa: newEtapa }).eq('id', id)
    if (error) return
    showToast(`✅ Movido a ${STAGES.find(s => s.id === newEtapa)?.label}`, 'success')
    fetchDeals()
  }

  function openModal(etapa = 'prospecto') { setForm({ ...EMPTY_FORM, etapa }); setModal({ open: true, editId: null }) }
  function editDeal(d) {
    setForm({ empresa: d.empresa||'', giro: d.giro||'', contacto: d.contacto||'', cargo: d.cargo||'',
      etapa: d.etapa||'prospecto', prob: d.prob??50, fecha: d.fecha||'',
      impl: d.impl??'', sub: d.sub??'', meses: d.meses||12, notas: d.notas||'' })
    setModal({ open: true, editId: d.id })
  }
  function closeModal() { setModal({ open: false, editId: null }) }
  function setField(key, val) { setForm(f => ({ ...f, [key]: val })) }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered  = search ? deals.filter(d =>
    d.empresa.toLowerCase().includes(search.toLowerCase()) ||
    (d.giro||'').toLowerCase().includes(search.toLowerCase()) ||
    (d.contacto||'').toLowerCase().includes(search.toLowerCase())
  ) : deals

  const active     = filtered.filter(d => d.etapa !== 'cerrado')
  const closed     = filtered.filter(d => d.etapa === 'cerrado')
  const totalTCV   = active.reduce((s, d) => s + tcv(d), 0)
  const pondTCV    = active.reduce((s, d) => s + tcv(d) * d.prob / 100, 0)
  const totalMRR   = active.reduce((s, d) => s + Number(d.sub || 0), 0)
  const closedRev  = closed.reduce((s, d) => s + tcv(d), 0)
  const avgProb    = active.length ? Math.round(active.reduce((s, d) => s + d.prob, 0) / active.length) : 0
  const tasa       = filtered.length ? Math.round(closed.length / filtered.length * 100) : 0
  const prevImpl   = Number(form.impl) || 0
  const prevSub    = (Number(form.sub) || 0) * (Number(form.meses) || 12)
  const prevTCV    = prevImpl + prevSub

  function onDragStart(id) { dragId.current = id }
  function onDragEnd()     { dragId.current = null }
  function onDragOver(e)   { e.preventDefault() }
  async function onDrop(stageId) {
    if (dragId.current) {
      const deal = deals.find(d => d.id === dragId.current)
      if (deal && deal.etapa !== stageId) await moveDeal(dragId.current, stageId)
    }
  }

  return (
    <>
      <style>{CSS}</style>

      <header className="ff-header">
        <div className="ff-logo">
          <div className="ff-logo-icon">🐟</div>
          FishFlow <span>CRM</span>
        </div>
        <div className="ff-header-right">
          <div className="ff-search-wrap">
            <input className="ff-search" placeholder="Buscar cliente, giro..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="ff-btn-primary" onClick={() => openModal()}>+ Nueva Oportunidad</button>
          <button className="ff-btn-logout" onClick={handleLogout} title="Cerrar sesión">⎋ Salir</button>
        </div>
      </header>

      <div className="ff-metrics">
        {[
          { label: 'TCV Pipeline',    val: fmt(totalTCV),            sub: `${active.length} oportunidades activas` },
          { label: 'TCV Ponderado',   val: fmt(Math.round(pondTCV)), sub: `Prob. promedio: ${avgProb}%` },
          { label: 'MRR Pipeline',    val: fmt(totalMRR) + '/mes',   sub: 'Suscripciones activas potenciales' },
          { label: 'Revenue Cerrado', val: fmt(closedRev),           sub: `${closed.length} deal(s) cerrado(s)` },
          { label: 'Tasa de Cierre',  val: tasa + '%',               sub: `${closed.length} de ${filtered.length} totales` },
        ].map((m, i) => (
          <div key={i} className="ff-metric-card">
            <div className="ff-metric-label">{m.label}</div>
            <div className={`ff-metric-value ff-metric-${i}`}>{m.val}</div>
            <div className="ff-metric-sub">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="ff-board-wrap">
        {loading ? (
          <div className="ff-loading">Cargando oportunidades...</div>
        ) : (
          <div className="ff-board">
            {STAGES.map(stage => {
              const sDeals = filtered.filter(d => d.etapa === stage.id)
              const sTCV   = sDeals.reduce((s, d) => s + tcv(d), 0)
              const sMRR   = sDeals.reduce((s, d) => s + Number(d.sub || 0), 0)
              return (
                <div key={stage.id} className="ff-column" onDragOver={onDragOver} onDrop={() => onDrop(stage.id)}>
                  <div className="ff-col-header">
                    <div className="ff-col-title-row">
                      <div className="ff-col-title">
                        <div className="ff-col-dot" style={{ background: stage.color }} />
                        {stage.label}
                        <span className="ff-col-count">{sDeals.length}</span>
                      </div>
                    </div>
                    {sTCV > 0 && <div className="ff-col-tcv">TCV {fmt(sTCV)}</div>}
                    {sMRR > 0 && <div className="ff-col-mrr">MRR {fmt(sMRR)}/mes</div>}
                  </div>
                  <div className="ff-cards">
                    {sDeals.length === 0 ? (
                      <div className="ff-empty-col">Sin oportunidades</div>
                    ) : sDeals.map(d => (
                      <DealCard key={d.id} deal={d} stageColor={stage.color}
                        onEdit={() => editDeal(d)} onDelete={() => deleteDeal(d.id, d.empresa)}
                        onDragStart={() => onDragStart(d.id)} onDragEnd={onDragEnd} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modal.open && (
        <div className="ff-overlay" onClick={e => e.target.className === 'ff-overlay' && closeModal()}>
          <div className="ff-modal">
            <h2>{modal.editId ? '✏️ Editar Oportunidad' : '🆕 Nueva Oportunidad'}</h2>

            <div className="ff-section">Cliente</div>
            <div className="ff-row">
              <Field label="Empresa / Negocio *"><input value={form.empresa} onChange={e => setField('empresa', e.target.value)} placeholder="Tacos El Güero..." autoFocus /></Field>
              <Field label="Giro / Industria"><input value={form.giro} onChange={e => setField('giro', e.target.value)} placeholder="Restaurante, Clínica..." /></Field>
            </div>
            <div className="ff-row">
              <Field label="Contacto principal"><input value={form.contacto} onChange={e => setField('contacto', e.target.value)} placeholder="Nombre del dueño" /></Field>
              <Field label="Cargo"><input value={form.cargo} onChange={e => setField('cargo', e.target.value)} placeholder="Dueño, Gerente..." /></Field>
            </div>

            <div className="ff-section">Pipeline</div>
            <div className="ff-row">
              <Field label="Etapa">
                <select value={form.etapa} onChange={e => setField('etapa', e.target.value)}>
                  {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Fecha de cierre estimada"><input type="date" value={form.fecha} onChange={e => setField('fecha', e.target.value)} /></Field>
            </div>
            <Field label={`Probabilidad de cierre: ${form.prob}%`}>
              <div className="ff-range-row">
                <input type="range" min="0" max="100" value={form.prob} onChange={e => setField('prob', Number(e.target.value))} />
                <span className="ff-range-val">{form.prob}%</span>
              </div>
            </Field>

            <div className="ff-section">Pricing SaaS</div>
            <div className="ff-row">
              <Field label="Fee de Implementación (MXN)"><input type="number" value={form.impl} onChange={e => setField('impl', e.target.value)} placeholder="0" min="0" step="500" /></Field>
              <Field label="Suscripción Mensual (MXN)"><input type="number" value={form.sub} onChange={e => setField('sub', e.target.value)} placeholder="0" min="0" step="100" /></Field>
            </div>
            <Field label="Duración del contrato">
              <select value={form.meses} onChange={e => setField('meses', Number(e.target.value))}>
                {MESES_OPTS.map(m => <option key={m} value={m}>{m} meses{m === 12 ? ' (anual)' : ''}</option>)}
              </select>
            </Field>

            <div className="ff-tcv-preview">
              <div className="ff-tcv-item"><div className="ff-tcv-lbl">Implementación</div><div className="ff-tcv-impl">{fmt(prevImpl)}</div></div>
              <div className="ff-tcv-item"><div className="ff-tcv-lbl">Suscripción Total</div><div className="ff-tcv-sub">{fmt(prevSub)}</div></div>
              <div className="ff-tcv-item"><div className="ff-tcv-lbl">TCV Total</div><div className="ff-tcv-total">{fmt(prevTCV)}</div></div>
            </div>

            <Field label="Notas / Siguiente paso">
              <textarea value={form.notas} onChange={e => setField('notas', e.target.value)} placeholder="Contexto del cliente, objeciones, próxima acción..." />
            </Field>

            <div className="ff-modal-footer">
              <button className="ff-btn-secondary" onClick={closeModal}>Cancelar</button>
              <button className="ff-btn-primary" onClick={saveDeal}>💾 Guardar</button>
            </div>
          </div>
        </div>
      )}

      <div className={`ff-toast ${toast.show ? 'show' : ''} ${toast.type}`}>{toast.msg}</div>
    </>
  )
}

function Field({ label, children }) {
  return (
    <div className="ff-field">
      <label>{label}</label>
      {children}
    </div>
  )
}

function DealCard({ deal: d, stageColor, onEdit, onDelete, onDragStart, onDragEnd }) {
  const v        = tcv(d)
  const subTotal = Number(d.sub || 0) * Number(d.meses || 12)
  const fi       = fechaInfo(d.fecha)
  return (
    <div className="ff-card" draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      onClick={e => !e.target.closest('.ff-card-btn') && onEdit()}>
      <div className="ff-card-bar" style={{ background: stageColor }} />
      <div className="ff-card-actions">
        <button className="ff-card-btn" onClick={e => { e.stopPropagation(); onEdit() }}>✏️</button>
        <button className="ff-card-btn del" onClick={e => { e.stopPropagation(); onDelete() }}>🗑️</button>
      </div>
      <div className="ff-card-empresa">{d.empresa}</div>
      <div className="ff-card-giro">{d.giro || ''}</div>
      {d.contacto && <div className="ff-card-contact">👤 {d.contacto}{d.cargo ? ` · ${d.cargo}` : ''}</div>}
      <div className="ff-card-pricing">
        <div className="ff-pr"><span className="ff-pr-lbl">Implementación</span><span className="ff-pr-impl">{fmt(d.impl)}</span></div>
        <div className="ff-pr"><span className="ff-pr-lbl">Suscripción {d.meses}m</span><span className="ff-pr-sub">{fmt(subTotal)}</span></div>
        <div className="ff-pr" style={{ borderTop:'1px solid #2e3150', marginTop:5, paddingTop:5 }}>
          <span className="ff-pr-lbl" style={{ fontWeight:700 }}>TCV</span>
          <span className="ff-pr-tcv">{fmt(v)}</span>
        </div>
      </div>
      <div className="ff-card-meta">
        <span className="ff-meses-chip">{d.meses}m · {fmt(d.sub)}/mes</span>
        <span className={`ff-prob ${probClass(d.prob)}`}>{d.prob}%</span>
      </div>
      {fi && <div className={`ff-fecha ${fi.cls}`}>{fi.txt}</div>}
    </div>
  )
}

const CSS = `
  .ff-header { background:#1a1d2e; border-bottom:1px solid #2e3150; padding:0 24px; height:60px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .ff-logo { display:flex; align-items:center; gap:10px; font-size:18px; font-weight:700; color:#e8eaf6; }
  .ff-logo-icon { width:32px; height:32px; background:linear-gradient(135deg,#5b6af0,#7c3aed); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:16px; }
  .ff-logo span { color:#8b8fa8; font-weight:400; font-size:14px; margin-left:4px; }
  .ff-header-right { display:flex; gap:10px; align-items:center; }
  .ff-search-wrap { position:relative; }
  .ff-search-wrap::before { content:'🔍'; position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:11px; pointer-events:none; }
  .ff-search { background:#252840; border:1px solid #2e3150; border-radius:8px; padding:7px 12px 7px 32px; color:#e8eaf6; font-size:13px; width:220px; outline:none; }
  .ff-search:focus { border-color:#5b6af0; }
  .ff-btn-primary { background:#5b6af0; color:white; border:none; border-radius:8px; padding:8px 16px; font-size:13px; font-weight:600; cursor:pointer; }
  .ff-btn-primary:hover { background:#4a59e0; }
  .ff-btn-secondary { background:transparent; color:#8b8fa8; border:1px solid #2e3150; border-radius:8px; padding:8px 16px; font-size:13px; font-weight:600; cursor:pointer; }
  .ff-btn-secondary:hover { color:#e8eaf6; border-color:#8b8fa8; }
  .ff-btn-logout { background:transparent; color:#8b8fa8; border:1px solid #2e3150; border-radius:8px; padding:8px 14px; font-size:12px; cursor:pointer; }
  .ff-btn-logout:hover { color:#ef4444; border-color:#ef4444; }
  .ff-metrics { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; padding:16px 24px; background:#1a1d2e; border-bottom:1px solid #2e3150; }
  .ff-metric-card { background:#252840; border:1px solid #2e3150; border-radius:10px; padding:14px 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .ff-metric-label { font-size:10px; color:#8b8fa8; text-transform:uppercase; letter-spacing:.8px; font-weight:600; margin-bottom:4px; }
  .ff-metric-value { font-size:20px; font-weight:700; letter-spacing:-.5px; }
  .ff-metric-sub { font-size:11px; color:#8b8fa8; margin-top:3px; }
  .ff-metric-0 { color:#06b6d4; } .ff-metric-1 { color:#5b6af0; } .ff-metric-2 { color:#a855f7; } .ff-metric-3 { color:#22c55e; } .ff-metric-4 { color:#f97316; }
  .ff-board-wrap { padding:20px 24px 40px; background:#0f1117; min-height:calc(100vh - 200px); overflow-x:auto; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .ff-loading { color:#8b8fa8; text-align:center; padding:60px 0; font-size:14px; }
  .ff-board { display:flex; gap:14px; min-width:1000px; }
  .ff-column { flex:1; min-width:210px; background:#1a1d2e; border-radius:12px; border:1px solid #2e3150; display:flex; flex-direction:column; max-height:calc(100vh - 230px); }
  .ff-col-header { padding:12px 14px 10px; border-bottom:1px solid #2e3150; }
  .ff-col-title-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:3px; }
  .ff-col-title { display:flex; align-items:center; gap:7px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#e8eaf6; }
  .ff-col-dot { width:8px; height:8px; border-radius:50%; }
  .ff-col-count { background:#252840; color:#8b8fa8; border-radius:20px; padding:1px 7px; font-size:11px; font-weight:600; }
  .ff-col-tcv { font-size:11px; color:#8b8fa8; } .ff-col-mrr { font-size:10px; color:#8b8fa8; }
  .ff-cards { flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:8px; min-height:80px; }
  .ff-cards::-webkit-scrollbar { width:3px; } .ff-cards::-webkit-scrollbar-thumb { background:#2e3150; border-radius:4px; }
  .ff-empty-col { text-align:center; color:#2e3150; font-size:12px; padding:20px 0; border:1.5px dashed #2e3150; border-radius:8px; }
  .ff-card { background:#252840; border:1px solid #2e3150; border-radius:10px; padding:11px 12px; cursor:grab; position:relative; transition:transform .15s,box-shadow .15s,border-color .15s; color:#e8eaf6; }
  .ff-card:hover { transform:translateY(-2px); box-shadow:0 6px 20px rgba(0,0,0,.4); border-color:#5b6af0; }
  .ff-card:active { cursor:grabbing; }
  .ff-card-bar { position:absolute; left:0; top:0; bottom:0; width:3px; border-radius:10px 0 0 10px; }
  .ff-card-actions { position:absolute; top:8px; right:8px; display:none; gap:4px; }
  .ff-card:hover .ff-card-actions { display:flex; }
  .ff-card-btn { background:#1a1d2e; border:1px solid #2e3150; color:#8b8fa8; border-radius:6px; width:24px; height:24px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px; }
  .ff-card-btn:hover { color:#e8eaf6; border-color:#5b6af0; } .ff-card-btn.del:hover { color:#ef4444; border-color:#ef4444; }
  .ff-card-empresa { font-size:13px; font-weight:700; margin-bottom:2px; }
  .ff-card-giro { font-size:11px; color:#8b8fa8; margin-bottom:7px; }
  .ff-card-contact { font-size:10px; color:#8b8fa8; margin-bottom:6px; }
  .ff-card-pricing { background:rgba(255,255,255,.03); border:1px solid #2e3150; border-radius:7px; padding:7px 9px; margin-bottom:7px; }
  .ff-pr { display:flex; justify-content:space-between; align-items:center; font-size:11px; } .ff-pr + .ff-pr { margin-top:4px; }
  .ff-pr-lbl { color:#8b8fa8; } .ff-pr-impl { color:#f97316; font-weight:600; } .ff-pr-sub { color:#06b6d4; font-weight:600; } .ff-pr-tcv { color:#22c55e; font-weight:700; font-size:12px; }
  .ff-card-meta { display:flex; align-items:center; justify-content:space-between; }
  .ff-meses-chip { font-size:10px; font-weight:600; color:#a855f7; background:rgba(168,85,247,.15); border-radius:20px; padding:2px 7px; }
  .ff-prob { font-size:10px; font-weight:700; padding:2px 7px; border-radius:20px; }
  .prob-high { background:rgba(34,197,94,.18); color:#4ade80; } .prob-mid { background:rgba(234,179,8,.18); color:#fbbf24; } .prob-low { background:rgba(239,68,68,.18); color:#f87171; }
  .ff-fecha { font-size:10px; color:#8b8fa8; margin-top:4px; } .ff-fecha.urgente { color:#f87171; } .ff-fecha.pronto { color:#fbbf24; }
  .ff-overlay { position:fixed; inset:0; background:rgba(0,0,0,.72); backdrop-filter:blur(4px); z-index:200; display:flex; align-items:center; justify-content:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .ff-modal { background:#1a1d2e; border:1px solid #2e3150; border-radius:16px; padding:26px; width:520px; max-width:95vw; max-height:90vh; overflow-y:auto; color:#e8eaf6; }
  .ff-modal::-webkit-scrollbar { width:4px; } .ff-modal::-webkit-scrollbar-thumb { background:#2e3150; border-radius:4px; }
  .ff-modal h2 { font-size:17px; font-weight:700; margin-bottom:18px; }
  .ff-section { font-size:11px; font-weight:700; color:#8b8fa8; text-transform:uppercase; letter-spacing:.8px; border-bottom:1px solid #2e3150; padding-bottom:6px; margin:16px 0 12px; }
  .ff-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .ff-field { display:flex; flex-direction:column; gap:5px; margin-bottom:12px; }
  .ff-field label { font-size:11px; font-weight:600; color:#8b8fa8; text-transform:uppercase; letter-spacing:.6px; }
  .ff-field input, .ff-field select, .ff-field textarea { background:#252840; border:1px solid #2e3150; border-radius:8px; padding:8px 12px; color:#e8eaf6; font-size:13px; font-family:inherit; outline:none; width:100%; }
  .ff-field input:focus, .ff-field select:focus, .ff-field textarea:focus { border-color:#5b6af0; }
  .ff-field select option { background:#252840; } .ff-field textarea { resize:vertical; min-height:65px; }
  .ff-range-row { display:flex; align-items:center; gap:10px; }
  .ff-range-row input[type=range] { flex:1; height:4px; padding:0; accent-color:#5b6af0; cursor:pointer; }
  .ff-range-val { min-width:36px; text-align:right; font-weight:700; font-size:14px; color:#5b6af0; }
  .ff-tcv-preview { background:rgba(91,106,240,.08); border:1px solid rgba(91,106,240,.3); border-radius:10px; padding:12px 16px; display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:14px 0; }
  .ff-tcv-item { text-align:center; } .ff-tcv-lbl { font-size:10px; color:#8b8fa8; text-transform:uppercase; letter-spacing:.6px; margin-bottom:4px; }
  .ff-tcv-impl { font-size:15px; font-weight:700; color:#f97316; } .ff-tcv-sub { font-size:15px; font-weight:700; color:#06b6d4; } .ff-tcv-total { font-size:15px; font-weight:700; color:#22c55e; }
  .ff-modal-footer { display:flex; gap:10px; justify-content:flex-end; margin-top:18px; padding-top:14px; border-top:1px solid #2e3150; }
  .ff-toast { position:fixed; bottom:24px; right:24px; background:#252840; border:1px solid #2e3150; border-radius:10px; padding:11px 16px; font-size:13px; opacity:0; transform:translateY(8px); transition:all .25s; z-index:500; pointer-events:none; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#e8eaf6; }
  .ff-toast.show { opacity:1; transform:translateY(0); } .ff-toast.success { border-color:#22c55e; } .ff-toast.error { border-color:#ef4444; }
`
