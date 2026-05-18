'use client'

// ============================================================
// FishFlow — Página pública de pagos
// Ruta: fishflow.mx/pay/[slug]
// Ejemplo: fishflow.mx/pay/belange
// Sin login requerido. Muestra los cobros pendientes
// que Rafa genera desde /admin → 💳 Cobros
// ============================================================

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface Transaction {
  id: string
  service: string
  amount: number
  currency: string
  payment_url: string | null
  created_at: string
}

interface ClientData {
  id: string
  name: string
  slug: string
}

function fmtMXN(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)
}

export default function PayPage() {
  const { slug } = useParams<{ slug: string }>()
  const [client, setClient] = useState<ClientData | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!slug) return
    fetch(`/api/payments/pay?slug=${slug}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return null }
        return r.json()
      })
      .then(data => {
        if (!data) return
        setClient(data.client)
        setTransactions(data.transactions)
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [slug])

  return (
    <>
      <style>{CSS}</style>
      <div className="pay-root">

        {/* Header */}
        <header className="pay-header">
          <div className="pay-logo">
            <div className="pay-logo-icon">🐟</div>
            <span className="pay-logo-name">FishFlow</span>
          </div>
          <div className="pay-secure">🔒 Pago seguro</div>
        </header>

        <main className="pay-main">

          {loading && (
            <div className="pay-state">
              <div className="pay-spinner" />
              <p>Cargando tus cobros...</p>
            </div>
          )}

          {!loading && notFound && (
            <div className="pay-state">
              <div className="pay-icon-big">🔍</div>
              <h2>Página no encontrada</h2>
              <p>Este link de pagos no está disponible. Contacta a tu proveedor FishFlow.</p>
            </div>
          )}

          {!loading && !notFound && client && (
            <>
              <div className="pay-client-header">
                <div className="pay-client-name">{client.name}</div>
                <div className="pay-client-sub">Portal de pagos · FishFlow</div>
              </div>

              {transactions.length === 0 ? (
                <div className="pay-card pay-empty">
                  <div className="pay-icon-big">✅</div>
                  <h3>Sin cobros pendientes</h3>
                  <p>No tienes pagos pendientes en este momento. Tu proveedor te avisará cuando haya uno nuevo.</p>
                </div>
              ) : (
                <div className="pay-list">
                  {transactions.map(tx => (
                    <div key={tx.id} className="pay-card">
                      <div className="pay-card-top">
                        <div>
                          <div className="pay-card-service">{tx.service}</div>
                          <div className="pay-card-date">
                            {new Date(tx.created_at).toLocaleDateString('es-MX', {
                              day: 'numeric', month: 'long', year: 'numeric'
                            })}
                          </div>
                        </div>
                        <div className="pay-card-amount">{fmtMXN(tx.amount)}</div>
                      </div>

                      {tx.payment_url ? (
                        <a
                          href={tx.payment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pay-btn"
                        >
                          Pagar ahora con MercadoPago →
                        </a>
                      ) : (
                        <div className="pay-btn-disabled">Link de pago no disponible — contacta a FishFlow</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="pay-footer-note">
                ¿Tienes dudas? Escríbenos a{' '}
                <a href="mailto:hola@fishflow.mx">hola@fishflow.mx</a>
              </div>
            </>
          )}
        </main>

        <footer className="pay-footer">
          <span>Powered by</span>
          <strong>FishFlow</strong>
          <span>· Automatización inteligente para tu negocio</span>
        </footer>
      </div>
    </>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .pay-root {
    min-height: 100vh;
    background: #0D1B2A;
    color: #e8eaf6;
    font-family: 'Inter', -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
  }

  /* Header */
  .pay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.03);
  }
  .pay-logo {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pay-logo-icon {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #FF8C35, #e07020);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
  }
  .pay-logo-name {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 800;
    font-size: 18px;
    color: #fff;
  }
  .pay-secure {
    font-size: 12px;
    color: #67D4E8;
    font-weight: 600;
    letter-spacing: .3px;
  }

  /* Main */
  .pay-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px 60px;
  }

  /* Estado de carga / not found */
  .pay-state {
    text-align: center;
    padding: 60px 20px;
    color: #8b8fa8;
  }
  .pay-state h2 { font-size: 20px; color: #e8eaf6; margin: 12px 0 8px; }
  .pay-state p  { font-size: 14px; }
  .pay-spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(255,140,53,.2);
    border-top-color: #FF8C35;
    border-radius: 50%;
    animation: spin .8s linear infinite;
    margin: 0 auto 16px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .pay-icon-big { font-size: 48px; margin-bottom: 12px; }

  /* Client header */
  .pay-client-header {
    text-align: center;
    margin-bottom: 32px;
  }
  .pay-client-name {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 26px;
    font-weight: 800;
    color: #fff;
    margin-bottom: 4px;
  }
  .pay-client-sub {
    font-size: 13px;
    color: #67D4E8;
    font-weight: 600;
    letter-spacing: .3px;
  }

  /* Lista de cobros */
  .pay-list {
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Card de cobro */
  .pay-card {
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 16px;
    padding: 20px;
    width: 100%;
    max-width: 480px;
  }
  .pay-card.pay-empty {
    text-align: center;
    padding: 40px 24px;
  }
  .pay-card.pay-empty h3 { font-size: 18px; color: #e8eaf6; margin: 10px 0 8px; }
  .pay-card.pay-empty p  { font-size: 13px; color: #8b8fa8; line-height: 1.6; }

  .pay-card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 16px;
  }
  .pay-card-service {
    font-size: 16px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 4px;
    font-family: 'Plus Jakarta Sans', sans-serif;
  }
  .pay-card-date {
    font-size: 12px;
    color: #8b8fa8;
  }
  .pay-card-amount {
    font-size: 24px;
    font-weight: 800;
    color: #FF8C35;
    font-family: 'Plus Jakarta Sans', sans-serif;
    white-space: nowrap;
  }

  /* Botón de pago */
  .pay-btn {
    display: block;
    width: 100%;
    background: linear-gradient(135deg, #FF8C35, #e07020);
    color: white;
    text-align: center;
    text-decoration: none;
    font-size: 15px;
    font-weight: 700;
    padding: 14px;
    border-radius: 10px;
    transition: opacity .15s, transform .1s;
    font-family: 'Plus Jakarta Sans', sans-serif;
  }
  .pay-btn:hover { opacity: .9; transform: translateY(-1px); }
  .pay-btn:active { transform: translateY(0); }

  .pay-btn-disabled {
    text-align: center;
    font-size: 13px;
    color: #8b8fa8;
    padding: 12px;
    background: rgba(255,255,255,.04);
    border-radius: 8px;
    border: 1px dashed rgba(255,255,255,.12);
  }

  .pay-footer-note {
    margin-top: 28px;
    font-size: 12px;
    color: #8b8fa8;
    text-align: center;
  }
  .pay-footer-note a { color: #67D4E8; text-decoration: none; }
  .pay-footer-note a:hover { text-decoration: underline; }

  /* Footer */
  .pay-footer {
    text-align: center;
    padding: 16px;
    font-size: 12px;
    color: #4a4d60;
    border-top: 1px solid rgba(255,255,255,.05);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
  .pay-footer strong { color: #8b8fa8; }
`
