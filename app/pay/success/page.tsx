'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function SuccessContent() {
  const params = useSearchParams()
  const paymentId = params.get('payment_id') ?? params.get('collection_id')

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
          <div className="ps-icon success-icon">✅</div>
          <h1 className="ps-title">¡Pago recibido!</h1>
          <p className="ps-sub">Tu pago fue procesado correctamente. Nos pondremos en contacto contigo a la brevedad.</p>

          {paymentId && (
            <div className="ps-ref">
              <span className="ps-ref-label">Referencia de pago</span>
              <span className="ps-ref-value">{paymentId}</span>
            </div>
          )}

          <div className="ps-note">
            ¿Tienes alguna duda? Escríbenos a{' '}
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

export default function PaySuccess() {
  return (
    <Suspense>
      <SuccessContent />
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
  .ps-icon { font-size:72px; margin-bottom:20px; }
  .ps-title { font-family:'Plus Jakarta Sans',sans-serif; font-size:28px; font-weight:800; color:#fff; margin-bottom:12px; }
  .ps-sub { font-size:15px; color:#8b8fa8; max-width:380px; line-height:1.6; margin-bottom:28px; }
  .ps-ref { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1); border-radius:10px; padding:14px 20px; margin-bottom:24px; display:flex; flex-direction:column; gap:4px; }
  .ps-ref-label { font-size:10px; color:#8b8fa8; text-transform:uppercase; letter-spacing:.8px; font-weight:600; }
  .ps-ref-value { font-size:14px; color:#67D4E8; font-family:monospace; font-weight:600; }
  .ps-note { font-size:13px; color:#8b8fa8; }
  .ps-note a { color:#FF8C35; text-decoration:none; }
  .ps-note a:hover { text-decoration:underline; }
  .ps-footer { text-align:center; padding:16px; font-size:12px; color:#4a4d60; border-top:1px solid rgba(255,255,255,.05); display:flex; align-items:center; justify-content:center; gap:5px; }
  .ps-footer strong { color:#8b8fa8; }
  .success-icon { filter: drop-shadow(0 0 20px rgba(34,197,94,.4)); }
`
