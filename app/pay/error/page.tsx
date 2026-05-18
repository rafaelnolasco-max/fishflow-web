'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function ErrorContent() {
  const params = useSearchParams()
  const slug   = params.get('slug') // por si lo pasamos en el back_url futuro

  return (
    <>
      <style>{CSS}</style>
      <div className="ps-root">
        <header className="ps-header">
          <div className="ps-logo">
            <div className="ps-logo-icon">🐟</div>
            <span className="ps-logo-name">FishFlow</span>
          </div>
        </header>

        <main className="ps-main">
          <div className="ps-icon">❌</div>
          <h1 className="ps-title">Hubo un problema con tu pago</h1>
          <p className="ps-sub">El pago no pudo completarse. Puedes intentarlo de nuevo o contactarnos directamente.</p>

          <div className="ps-actions">
            <button className="ps-btn-back" onClick={() => window.history.back()}>
              ← Intentar de nuevo
            </button>
          </div>

          <div className="ps-note">
            ¿Necesitas ayuda? Escríbenos a{' '}
            <a href="mailto:hola@fishflow.mx">hola@fishflow.mx</a>
          </div>
        </main>

        <footer className="ps-footer">
          <span>Powered by</span>
          <strong>FishFlow</strong>
          <span>· Automatización inteligente para tu negocio</span>
        </footer>
      </div>
    </>
  )
}

export default function PayError() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  .ps-root { min-height:100vh; background:#0D1B2A; color:#e8eaf6; font-family:'Inter',-apple-system,sans-serif; display:flex; flex-direction:column; }
  .ps-header { display:flex; align-items:center; padding:16px 24px; border-bottom:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.03); }
  .ps-logo { display:flex; align-items:center; gap:10px; }
  .ps-logo-icon { width:36px; height:36px; background:linear-gradient(135deg,#FF8C35,#e07020); border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:18px; }
  .ps-logo-name { font-family:'Plus Jakarta Sans',sans-serif; font-weight:800; font-size:18px; color:#fff; }
  .ps-main { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; text-align:center; }
  .ps-icon { font-size:72px; margin-bottom:20px; filter:drop-shadow(0 0 20px rgba(239,68,68,.4)); }
  .ps-title { font-family:'Plus Jakarta Sans',sans-serif; font-size:28px; font-weight:800; color:#fff; margin-bottom:12px; }
  .ps-sub { font-size:15px; color:#8b8fa8; max-width:380px; line-height:1.6; margin-bottom:28px; }
  .ps-actions { margin-bottom:24px; }
  .ps-btn-back { background:transparent; border:1px solid rgba(255,255,255,.15); color:#e8eaf6; border-radius:10px; padding:12px 24px; font-size:14px; font-weight:600; cursor:pointer; transition:all .15s; }
  .ps-btn-back:hover { background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.3); }
  .ps-note { font-size:13px; color:#8b8fa8; }
  .ps-note a { color:#FF8C35; text-decoration:none; }
  .ps-note a:hover { text-decoration:underline; }
  .ps-footer { text-align:center; padding:16px; font-size:12px; color:#4a4d60; border-top:1px solid rgba(255,255,255,.05); display:flex; align-items:center; justify-content:center; gap:5px; }
  .ps-footer strong { color:#8b8fa8; }
`
