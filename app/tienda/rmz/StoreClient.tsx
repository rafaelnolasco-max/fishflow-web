"use client";

// Tienda B2C RMZ — port del mockup HTML a React con catálogo de Supabase
// y checkout real (Stripe tarjeta+OXXO / Mercado Pago / transferencia SPEI).

import React, { useMemo, useState } from "react";

export type StoreProduct = {
  id: string;
  category: string;
  name: string;
  dimensions: string | null;
  price: number;
  colors: [string, string][]; // [nombre, hex]
  photo_url: string | null;
};

const BRAND = {
  name: "Vallejo Tableros & Herrajes",
  short: "Vallejo",
  line: "Cocinas y Closets RMZ",   // línea de muebles del mismo dueño
  logo: "/rmz/logo.png",
  logoLight: "/rmz/logo-light.png",
  tel: "55 1144 2279",
  tel2: "55 3777 0823",
  mail: "contacto@cocinasrmz.mx",
  whatsapp: "https://wa.me/message/PFRTV2CU6ZUDF1",
  instagram: "https://www.instagram.com/cocinas_y_closets_rmz/",
  deliveryDays: "5 a 7 días hábiles",
};

const ICONS: Record<string, React.ReactNode> = {
  Alacenas: (
    <svg viewBox="0 0 64 64" fill="none" stroke="#fff" strokeWidth="2.4"><rect x="12" y="8" width="40" height="48" rx="2" /><line x1="32" y1="8" x2="32" y2="56" /><circle cx="27" cy="32" r="1.6" fill="#fff" /><circle cx="37" cy="32" r="1.6" fill="#fff" /></svg>
  ),
  "Burós": (
    <svg viewBox="0 0 64 64" fill="none" stroke="#fff" strokeWidth="2.4"><rect x="12" y="18" width="40" height="30" rx="2" /><line x1="12" y1="32" x2="52" y2="32" /><line x1="16" y1="48" x2="16" y2="56" /><line x1="48" y1="48" x2="48" y2="56" /><circle cx="32" cy="25" r="1.6" fill="#fff" /><circle cx="32" cy="40" r="1.6" fill="#fff" /></svg>
  ),
  Zapateras: (
    <svg viewBox="0 0 64 64" fill="none" stroke="#fff" strokeWidth="2.4"><rect x="14" y="10" width="36" height="44" rx="2" /><line x1="14" y1="25" x2="50" y2="25" /><line x1="14" y1="40" x2="50" y2="40" /></svg>
  ),
  "Coffee stations": (
    <svg viewBox="0 0 64 64" fill="none" stroke="#fff" strokeWidth="2.4"><rect x="14" y="10" width="36" height="44" rx="2" /><rect x="20" y="16" width="24" height="12" rx="1" /><path d="M22 40h20" /><path d="M22 46h14" /></svg>
  ),
  Repisas: (
    <svg viewBox="0 0 64 64" fill="none" stroke="#fff" strokeWidth="2.4"><line x1="12" y1="20" x2="44" y2="20" /><line x1="20" y1="34" x2="52" y2="34" /><line x1="12" y1="48" x2="40" y2="48" /></svg>
  ),
  Mesas: (
    <svg viewBox="0 0 64 64" fill="none" stroke="#fff" strokeWidth="2.4"><rect x="12" y="24" width="40" height="6" rx="1" /><line x1="16" y1="30" x2="16" y2="46" /><line x1="48" y1="30" x2="48" y2="46" /></svg>
  ),
};

const money = (n: number) => "$" + Number(n).toLocaleString("es-MX");

function shade(hex: string, pct: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + pct);
  const g = Math.min(255, ((n >> 8) & 255) + pct);
  const b = Math.min(255, (n & 255) + pct);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

type CartLine = { p: StoreProduct; color: [string, string]; qty: number };
type PayMethod = "stripe" | "mercadopago" | "transferencia";

// Mercado Pago está apagado hasta tener las llaves de prueba RMZ_MP_* en Vercel.
// Poner en true (y quitar el bloqueo en /api/store/rmz/checkout) para reactivarlo.
const MP_ENABLED = false;

function Placeholder({ cat, color, soon }: { cat: string; color: string; soon?: boolean }) {
  return (
    <div className="ph" style={{ background: `linear-gradient(160deg, ${shade(color, 18)}, ${color})` }}>
      {soon && <span className="soon">Foto próximamente</span>}
      {ICONS[cat] ?? ICONS["Mesas"]}
    </div>
  );
}

export default function StoreClient({ products }: { products: StoreProduct[] }) {
  const [activeCat, setActiveCat] = useState("Todos");
  const [sel, setSel] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", tel: "", email: "", dir: "" });
  const [payMethod, setPayMethod] = useState<PayMethod>("stripe");
  const [sending, setSending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const cats = useMemo(() => ["Todos", ...new Set(products.map((p) => p.category))], [products]);
  const list = products.filter((p) => activeCat === "Todos" || p.category === activeCat);
  const items = Object.entries(cart);
  const count = items.reduce((s, [, i]) => s + i.qty, 0);
  const total = items.reduce((s, [, i]) => s + i.qty * Number(i.p.price), 0);

  function toast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2200);
  }

  function addToCart(p: StoreProduct) {
    const ci = sel[p.id] ?? 0;
    const color = p.colors[ci] ?? ["", "var(--accent)"];
    const key = p.id + "__" + color[0];
    setCart((c) => ({ ...c, [key]: { p, color, qty: (c[key]?.qty ?? 0) + 1 } }));
    toast(`${p.name}${color[0] ? ` (${color[0]})` : ""} agregado`);
    setDrawerOpen(true);
  }

  function changeQty(key: string, d: number) {
    setCart((c) => {
      const line = c[key];
      if (!line) return c;
      const qty = line.qty + d;
      const next = { ...c };
      if (qty <= 0) delete next[key];
      else next[key] = { ...line, qty };
      return next;
    });
  }

  async function submitOrder() {
    setErrMsg(null);
    if (!form.name.trim() || !form.tel.trim() || !form.dir.trim()) {
      setErrMsg("Completa nombre, teléfono y dirección.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      setErrMsg("Escribe un correo válido — ahí te llega tu orden de compra.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/store/rmz/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.name,
          customer_phone: form.tel,
          customer_email: form.email,
          shipping_address: form.dir,
          payment_method: payMethod,
          items: items.map(([, i]) => ({
            product_id: i.p.id,
            color_name: i.color[0] || undefined,
            color_hex: i.color[1] || undefined,
            qty: i.qty,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al procesar el pedido");
      window.location.href = data.redirect_url ?? data.order_url;
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Error al procesar el pedido");
      setSending(false);
    }
  }

  return (
    <div className="rmz">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* HEADER */}
      <header className="rz-header">
        <div className="wrap nav">
          <a className="brand" href="#top">
            <span className="logo" aria-hidden="true">
              <img src={BRAND.logo} alt={BRAND.name} />
            </span>
          </a>
          <nav className="navlinks">
            <a href="#catalogo">Catálogo</a>
            <a href="#como">Cómo funciona</a>
            <a href="#calidad">Calidad</a>
            <a href="#contacto">Contacto</a>
          </nav>
          <div className="nav-cta">
            <a href="#catalogo" className="btn btn--primary rz-hide-m">Ver muebles</a>
            <button className="cartbtn" onClick={() => setDrawerOpen(true)} aria-label="Carrito">
              🛒<span className="count">{count}</span>
            </button>
            <button className="hamburger" aria-label="Menú" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>☰</button>
          </div>
        </div>
        {menuOpen && (
          <div className="wrap"><div className="mobile-menu">
            {[["#catalogo", "Catálogo"], ["#como", "Cómo funciona"], ["#calidad", "Calidad"], ["#contacto", "Contacto"]].map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
            ))}
            <a href="#catalogo" onClick={() => setMenuOpen(false)} style={{ color: "var(--accent)", fontWeight: 600 }}>Ver muebles →</a>
          </div></div>
        )}
      </header>

      <main id="top">
        {/* HERO */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <span className="pill">{BRAND.line} · Diseño 100% personalizado</span>
              <h1 style={{ marginTop: 14 }}>Muebles listos, entregados <span style={{ color: "var(--accent)" }}>armados</span> en tu casa.</h1>
              <p>La línea prefabricada de <b>{BRAND.line}</b>, fabricada con los tableros y herrajes de <b>{BRAND.name}</b>: alacenas, burós, zapateras y coffee stations hechas en nuestro taller con CNC. Elige modelo y color, paga en línea y te lo llevamos montado.</p>
              <div className="hero-actions">
                <a href="#catalogo" className="btn btn--primary">Ver catálogo</a>
                <a href="#como" className="btn btn--ghost">Cómo funciona</a>
              </div>
              <div className="trust">
                <span><b>Entrega armado</b><br />a domicilio</span>
                <span><b>Fabricado con CNC</b><br />en nuestro taller</span>
                <span><b>CDMX y Edo. Méx.</b><br />cobertura de entrega</span>
              </div>
            </div>
            <div className="hero-visual"><div className="tag">📷 Foto de tu mueble estrella aquí</div></div>
          </div>
        </section>

        {/* CÓMO FUNCIONA */}
        <section id="como">
          <div className="wrap">
            <div className="sec-head"><h2>Comprar es de tres pasos</h2><p>Tú eliges, nosotros fabricamos y te lo entregamos armado. Así de simple.</p></div>
            <div className="grid3">
              <div className="step"><div className="n">1</div><h3>Elige modelo y color</h3><p>Cada mueble tiene varios acabados. Escoge el que combine con tu espacio.</p></div>
              <div className="step"><div className="n">2</div><h3>Paga en línea</h3><p>Checkout seguro: tarjeta, OXXO o transferencia bancaria.</p></div>
              <div className="step"><div className="n">3</div><h3>Recíbelo armado</h3><p>Lo fabricamos y el chofer te lo lleva montado a domicilio. Sin que armes nada.</p></div>
            </div>
          </div>
        </section>

        {/* CATÁLOGO */}
        <section id="catalogo" style={{ background: "#fff", borderBlock: "1px solid #EAE0D5" }}>
          <div className="wrap">
            <div className="sec-head"><h2>Nuestra línea</h2><p>Modelos prefabricados listos para pedir. Toca los colores para ver los acabados.</p></div>
            <div className="filters">
              {cats.map((c) => (
                <button key={c} className={`chip ${c === activeCat ? "active" : ""}`} onClick={() => setActiveCat(c)}>{c}</button>
              ))}
            </div>
            <div className="pgrid">
              {list.map((p) => {
                const ci = sel[p.id] ?? 0;
                const color = p.colors[ci] ?? ["", "var(--accent)"];
                return (
                  <article className="pcard" key={p.id}>
                    <div className="pmedia">
                      {p.photo_url
                        ? <img src={p.photo_url} alt={p.name} loading="lazy" />
                        : <Placeholder cat={p.category} color={color[1]} soon />}
                    </div>
                    <div className="pbody">
                      <span className="cat">{p.category}</span>
                      <h3>{p.name}</h3>
                      {p.dimensions && <div className="pdim">{p.dimensions}</div>}
                      <div className="swatches">
                        {p.colors.map((c, i) => (
                          <span key={c[0]} className={`swatch ${i === ci ? "sel" : ""}`} style={{ background: c[1] }} title={c[0]}
                            onClick={() => setSel((s) => ({ ...s, [p.id]: i }))} />
                        ))}
                        <span className="swatch-name">{color[0]}</span>
                      </div>
                      <div className="price">{money(Number(p.price))}</div>
                      <button className="btn btn--primary btn--block" onClick={() => addToCart(p)}>Agregar al carrito</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA A LA MEDIDA */}
        <section style={{ paddingBlock: 0 }}>
          <div className="wrap">
            <div className="cta-medida">
              <div style={{ maxWidth: "54ch" }}>
                <span className="pill" style={{ background: "#262E38", color: "#BFD4FA" }}>¿Buscas algo a la medida?</span>
                <h2 style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 600, color: "#fff", margin: "12px 0 6px" }}>Cocinas, closets, tocadores y comedores para tu espacio.</h2>
                <p style={{ opacity: 0.85, margin: 0, fontSize: 15 }}>Este es el negocio de siempre de RMZ: diseño 100% personalizado, fabricado con CNC en CDMX e instalado en CDMX y Edo. de México. Cuéntanos tu proyecto y te cotizamos.</p>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <a href={BRAND.whatsapp} className="btn btn--primary">Cotizar por WhatsApp</a>
                <a href={BRAND.instagram} className="btn btn--ghost" style={{ background: "transparent", color: "#E7EDF7", borderColor: "#2E3742" }}>Ver proyectos en Instagram</a>
              </div>
            </div>
          </div>
        </section>

        {/* CALIDAD */}
        <section id="calidad">
          <div className="wrap hero-grid">
            <div className="hero-visual" style={{ background: "radial-gradient(120% 120% at 30% 20%,#EAD9C6,#B98F6B 60%,#9E7328)" }}>
              <div className="tag">📷 Foto de detalle: herrajes / armado</div>
            </div>
            <div>
              <span className="pill">Por qué duran</span>
              <h2 style={{ fontSize: "clamp(26px,3.6vw,40px)", fontWeight: 600, margin: "14px 0 12px" }}>No son las alacenas que se deshacen en tres días.</h2>
              <p style={{ color: "#6E645C", maxWidth: "46ch" }}>Las nuestras se cortan en CNC con el mismo grosor de tablero de punta a punta y se ensamblan con tornillería real, no con tarugos que se aflojan. Llegan armadas y listas para usar.</p>
              <div className="trust" style={{ marginTop: 22 }}>
                <span><b>CNC</b><br />corte de precisión</span>
                <span><b>Tornillería</b><br />no tarugos</span>
                <span><b>Armado</b><br />de fábrica</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer id="contacto">
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <div className="foot-brand"><img src={BRAND.logoLight} alt={BRAND.name} /></div>
              <p style={{ opacity: 0.8, fontSize: 14, maxWidth: "34ch", margin: 0 }}>Tableros, herrajes y la línea de muebles <b>{BRAND.line}</b>: prefabricados entregados armados a domicilio. También fabricamos cocinas y closets a la medida. CDMX y área metropolitana.</p>
              <div className="foot-social">
                <a href={BRAND.instagram} aria-label="Instagram" title="Instagram">◎</a>
                <a href={BRAND.whatsapp} aria-label="WhatsApp" title="WhatsApp">✆</a>
              </div>
            </div>
            <div>
              <h4>Tienda</h4>
              <a href="#catalogo">Catálogo</a>
              <a href="#como">Cómo funciona</a>
              <a href="#calidad">Calidad</a>
            </div>
            <div>
              <h4>Contacto</h4>
              <a href={BRAND.whatsapp}>WhatsApp</a>
              <a href={`tel:+52${BRAND.tel.replace(/\D/g, "")}`}>Tel. {BRAND.tel} · {BRAND.tel2}</a>
              <a href={`mailto:${BRAND.mail}`}>{BRAND.mail}</a>
              <a href="#">San Nicolás Totolapan, Magdalena Contreras, CDMX</a>
            </div>
          </div>
          <div className="foot-legal">
            <span>© {new Date().getFullYear()} {BRAND.name}. Todos los derechos reservados.</span>
            <span>Hecho con FishFlow</span>
          </div>
        </div>
      </footer>

      {/* CARRITO */}
      <div className={`overlay ${drawerOpen ? "open" : ""}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`drawer ${drawerOpen ? "open" : ""}`} aria-label="Carrito">
        <div className="drawer-head"><h3>Tu carrito</h3><button className="btn btn--ghost" style={{ padding: "8px 12px" }} onClick={() => setDrawerOpen(false)}>✕</button></div>
        <div className="drawer-body">
          {!items.length && <div className="empty">Tu carrito está vacío.<br />Explora la línea y agrega tu primer mueble.</div>}
          {items.map(([key, it]) => (
            <div className="citem" key={key}>
              <div className="thumb" style={{ background: `linear-gradient(160deg,${shade(it.color[1], 18)},${it.color[1]})` }} />
              <div className="info">
                <b>{it.p.name}</b>
                {it.color[0] && <div className="colr"><span className="dot" style={{ background: it.color[1] }} />{it.color[0]}</div>}
                <div className="qty">
                  <button onClick={() => changeQty(key, -1)}>−</button><span>{it.qty}</span><button onClick={() => changeQty(key, 1)}>+</button>
                  <span style={{ marginLeft: "auto", fontWeight: 600 }}>{money(it.qty * Number(it.p.price))}</span>
                </div>
              </div>
              <button className="rm" onClick={() => changeQty(key, -999)} aria-label="Quitar">✕</button>
            </div>
          ))}
        </div>
        <div className="drawer-foot">
          <div className="rowline"><span>Subtotal</span><span>{money(total)}</span></div>
          <div className="rowline" style={{ color: "#6E645C", fontSize: 13 }}><span>Envío a domicilio</span><span>Se cotiza al confirmar</span></div>
          <div className="rowline total"><span>Total</span><span>{money(total)}</span></div>
          <button className="btn btn--primary btn--block" disabled={!items.length} style={{ opacity: items.length ? 1 : 0.5 }}
            onClick={() => { setCheckoutOpen(true); }}>
            Continuar al pago
          </button>
        </div>
      </aside>

      {/* CHECKOUT */}
      {checkoutOpen && (
        <div className="modal open">
          <div className="sheet">
            <div className="sheet-head">
              <h3>Datos de entrega y pago</h3>
              <p>Entrega estimada: {BRAND.deliveryDays}. Tu orden de compra te llega por correo.</p>
            </div>
            <div className="sheet-body">
              <div className="field"><label>Nombre completo</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Juan Pérez" /></div>
              <div className="field"><label>WhatsApp / teléfono</label>
                <input value={form.tel} onChange={(e) => setForm({ ...form, tel: e.target.value })} placeholder="55 1234 5678" inputMode="tel" /></div>
              <div className="field"><label>Correo electrónico</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="tucorreo@ejemplo.com" inputMode="email" /></div>
              <div className="field"><label>Dirección de entrega</label>
                <textarea value={form.dir} onChange={(e) => setForm({ ...form, dir: e.target.value })} rows={2} placeholder="Calle, número, colonia, CP, referencias" /></div>

              <div className="field"><label>Método de pago</label>
                <div className="paylist">
                  {([
                    ["stripe", "💳 Tarjeta u OXXO", "Pago seguro en línea. Con OXXO recibes un voucher para pagar en tienda."],
                    ...(MP_ENABLED
                      ? [["mercadopago", "🔵 Mercado Pago", "Paga con tu cuenta de Mercado Pago, tarjeta o meses sin intereses."] as [PayMethod, string, string]]
                      : []),
                    ["transferencia", "🏦 Transferencia SPEI", "Te enviamos la CLABE por correo. Confirmamos tu pedido al recibir el depósito."],
                  ] as [PayMethod, string, string][]).map(([val, label, desc]) => (
                    <label key={val} className={`payopt ${payMethod === val ? "sel" : ""}`}>
                      <input type="radio" name="pay" checked={payMethod === val} onChange={() => setPayMethod(val)} />
                      <span><b>{label}</b><br /><small>{desc}</small></span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rowline total" style={{ margin: "4px 0 0" }}><span>Total a pagar</span><span>{money(total)}</span></div>
              {errMsg && <div className="errbox">{errMsg}</div>}
              <button className="btn btn--primary btn--block" disabled={sending} onClick={submitOrder}>
                {sending ? "Procesando…" : payMethod === "transferencia" ? "Confirmar pedido" : "Continuar al pago seguro"}
              </button>
              <button className="btn btn--ghost btn--block" disabled={sending} onClick={() => setCheckoutOpen(false)}>Volver</button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && <div className="toast show">{toastMsg}</div>}
    </div>
  );
}

// ─── CSS (port del mockup, prefijado bajo .rmz) ──────────────────────────────
const CSS = `
.rmz{--accent:#0944C2;--accent-dark:#06349A;--accent-soft:#E9F0FD;--ink:#1B2027;--steel:#505050;--muted:#69707A;--cream:#F6F8FB;--line:#E2E7EE;
  font-family:Inter,system-ui,sans-serif;color:var(--ink);background:var(--cream);line-height:1.55;min-height:100vh;}
.rmz *{box-sizing:border-box;min-width:0;}
.rmz img,.rmz svg{max-width:100%;display:block;height:auto;}
.rmz h1,.rmz h2,.rmz h3{font-family:Manrope,system-ui,sans-serif;letter-spacing:-.01em;margin:0;}
.rmz a{color:inherit;text-decoration:none;}
.rmz .wrap{width:100%;max-width:1200px;margin-inline:auto;padding-inline:clamp(18px,4vw,56px);}
.rmz .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:12px;
  padding:13px 20px;font-weight:600;font-size:15px;cursor:pointer;font-family:Inter,sans-serif;transition:.15s;}
.rmz .btn--primary{background:var(--accent);color:#fff;}
.rmz .btn--primary:hover{background:var(--accent-dark);}
.rmz .btn--ghost{background:#fff;color:var(--ink);border:1px solid var(--line);}
.rmz .btn--ghost:hover{border-color:var(--accent);color:var(--accent);}
.rmz .btn--block{width:100%;}
.rmz .pill{display:inline-block;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent-dark);}
.rmz .rz-header{position:sticky;top:0;z-index:40;background:rgba(250,246,240,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);}
.rmz .nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:14px;}
.rmz .brand{display:flex;align-items:center;gap:10px;font-family:Manrope,system-ui,sans-serif;font-weight:700;font-size:21px;}
.rmz .brand .logo{display:block;line-height:0;}
.rmz .brand .logo img{height:38px;width:auto;display:block;}
@media(max-width:600px){.rmz .brand .logo img{height:30px;}.rmz .foot-brand img{height:36px;}}
.rmz .brand .logo svg{width:22px;height:22px;}
.rmz .brand .wm{display:flex;flex-direction:column;line-height:1;}
.rmz .brand .wm small{font-family:Inter,sans-serif;font-size:10px;font-weight:700;letter-spacing:.22em;color:var(--accent);margin-top:3px;}
.rmz .navlinks{display:flex;align-items:center;gap:26px;}
.rmz .navlinks a{font-weight:500;font-size:15px;color:var(--muted);}
.rmz .navlinks a:hover{color:var(--ink);}
.rmz .nav-cta{display:flex;align-items:center;gap:12px;}
.rmz .cartbtn{position:relative;background:#fff;border:1px solid var(--line);border-radius:12px;width:46px;height:46px;display:grid;place-items:center;cursor:pointer;font-size:20px;}
.rmz .cartbtn .count{position:absolute;top:-7px;right:-7px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;min-width:20px;height:20px;border-radius:999px;display:grid;place-items:center;padding:0 5px;}
.rmz .hamburger{display:none;background:#fff;border:1px solid var(--line);border-radius:12px;width:46px;height:46px;place-items:center;cursor:pointer;font-size:22px;}
.rmz .mobile-menu{display:flex;flex-direction:column;gap:4px;padding:8px 0 16px;border-top:1px solid var(--line);}
.rmz .mobile-menu a{padding:12px 4px;font-weight:500;color:var(--ink);border-bottom:1px solid var(--line);}
.rmz .hero{padding:clamp(40px,7vw,84px) 0;}
.rmz .hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(24px,4vw,56px);align-items:center;}
.rmz .hero h1{font-size:clamp(34px,5.4vw,60px);line-height:1.02;font-weight:700;}
.rmz .hero p{font-size:clamp(16px,1.5vw,19px);color:var(--muted);margin:18px 0 26px;max-width:44ch;}
.rmz .hero-actions{display:flex;gap:12px;flex-wrap:wrap;}
.rmz .hero-visual{aspect-ratio:4/3;border-radius:22px;background:radial-gradient(120% 120% at 70% 20%, #6E8FD8 0%, #2A5CC9 45%, var(--accent-dark) 100%);
  box-shadow:0 10px 30px rgba(60,40,25,.10);position:relative;overflow:hidden;display:grid;place-items:center;}
.rmz .hero-visual .tag{position:absolute;left:18px;bottom:18px;background:rgba(255,255,255,.92);border-radius:12px;padding:10px 14px;font-size:13px;font-weight:600;}
.rmz .trust{display:flex;gap:26px;flex-wrap:wrap;margin-top:26px;color:var(--muted);font-size:14px;}
.rmz .trust b{color:var(--ink);}
.rmz section{padding:clamp(36px,5vw,64px) 0;}
.rmz .sec-head{text-align:center;max-width:640px;margin:0 auto 34px;}
.rmz .sec-head h2{font-size:clamp(26px,3.6vw,40px);font-weight:600;}
.rmz .sec-head p{color:var(--muted);margin-top:10px;}
.rmz .grid3{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));}
.rmz .step{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;}
.rmz .step .n{width:38px;height:38px;border-radius:11px;background:var(--accent-soft);color:var(--accent-dark);font-weight:700;display:grid;place-items:center;margin-bottom:14px;}
.rmz .step h3{font-size:19px;font-weight:600;margin-bottom:6px;}
.rmz .step p{color:var(--muted);font-size:15px;margin:0;}
.rmz .filters{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:26px;}
.rmz .chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:9px 16px;font-size:14px;font-weight:500;cursor:pointer;color:var(--muted);}
.rmz .chip.active{background:var(--ink);color:#fff;border-color:var(--ink);}
.rmz .pgrid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));}
.rmz .pcard{background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 4px 14px rgba(60,40,25,.05);}
.rmz .pmedia{aspect-ratio:1/1;position:relative;display:grid;place-items:center;overflow:hidden;}
.rmz .pmedia img{width:100%;height:100%;object-fit:cover;}
.rmz .pmedia .ph{width:100%;height:100%;display:grid;place-items:center;position:relative;}
.rmz .pmedia .ph svg{width:52%;height:52%;opacity:.9;filter:drop-shadow(0 6px 10px rgba(0,0,0,.12));}
.rmz .pmedia .soon{position:absolute;top:10px;left:10px;background:rgba(255,255,255,.9);font-size:11px;font-weight:600;padding:4px 9px;border-radius:999px;color:var(--muted);}
.rmz .pbody{padding:16px 16px 18px;display:flex;flex-direction:column;gap:10px;flex:1;}
.rmz .pbody .cat{font-size:12px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.04em;}
.rmz .pbody h3{font-size:18px;font-weight:600;}
.rmz .pdim{font-size:13px;color:var(--muted);}
.rmz .price{font-size:22px;font-weight:700;font-family:Manrope,system-ui,sans-serif;}
.rmz .swatches{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.rmz .swatch{width:26px;height:26px;border-radius:8px;cursor:pointer;border:2px solid #fff;box-shadow:0 0 0 1px var(--line);}
.rmz .swatch.sel{box-shadow:0 0 0 2px var(--accent);}
.rmz .swatch-name{font-size:12px;color:var(--muted);margin-left:2px;}
.rmz .pbody .btn{margin-top:auto;}
.rmz .cta-medida{background:var(--ink);color:#E7EDF7;border-radius:22px;padding:clamp(24px,4vw,40px);display:flex;gap:22px;align-items:center;justify-content:space-between;flex-wrap:wrap;}
.rmz footer{background:var(--ink);color:#DCE2EA;padding:44px 0 30px;margin-top:20px;}
.rmz .foot-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:28px;}
.rmz footer h4{font-family:Inter;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#8E97A3;margin:0 0 12px;}
.rmz footer a{display:block;color:#DCE2EA;opacity:.85;padding:4px 0;font-size:14px;}
.rmz footer a:hover{opacity:1;}
.rmz .foot-brand{margin-bottom:14px;line-height:0;}
.rmz .foot-brand img{height:44px;width:auto;display:block;}
.rmz .foot-social{display:flex;gap:10px;margin-top:6px;}
.rmz .foot-social a{width:38px;height:38px;border:1px solid #2E3742;border-radius:10px;display:grid;place-items:center;padding:0;}
.rmz .foot-legal{border-top:1px solid #262E38;margin-top:26px;padding-top:16px;font-size:12px;color:#79818C;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;}
.rmz .overlay{position:fixed;inset:0;background:rgba(30,20,12,.45);opacity:0;pointer-events:none;transition:.2s;z-index:50;}
.rmz .overlay.open{opacity:1;pointer-events:auto;}
.rmz .drawer{position:fixed;top:0;right:0;height:100%;width:min(420px,100%);background:var(--cream);z-index:60;
  transform:translateX(100%);transition:.25s;display:flex;flex-direction:column;box-shadow:-10px 0 40px rgba(0,0,0,.2);}
.rmz .drawer.open{transform:none;}
.rmz .drawer-head{display:flex;align-items:center;justify-content:space-between;padding:20px;border-bottom:1px solid var(--line);}
.rmz .drawer-head h3{font-size:20px;font-weight:600;}
.rmz .drawer-body{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px;}
.rmz .citem{display:flex;gap:12px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px;}
.rmz .citem .thumb{width:58px;height:58px;border-radius:10px;flex:none;}
.rmz .citem .info{flex:1;font-size:14px;}
.rmz .citem .info b{font-weight:600;}
.rmz .citem .colr{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;margin-top:2px;}
.rmz .citem .dot{width:12px;height:12px;border-radius:4px;box-shadow:0 0 0 1px var(--line);}
.rmz .qty{display:flex;align-items:center;gap:8px;margin-top:6px;}
.rmz .qty button{width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:15px;}
.rmz .citem .rm{background:none;border:0;color:var(--muted);cursor:pointer;font-size:13px;align-self:flex-start;}
.rmz .drawer-foot{padding:18px 20px;border-top:1px solid var(--line);background:#fff;}
.rmz .rowline{display:flex;justify-content:space-between;font-size:15px;margin-bottom:6px;}
.rmz .rowline.total{font-size:19px;font-weight:700;font-family:Manrope,system-ui,sans-serif;margin:8px 0 14px;}
.rmz .empty{color:var(--muted);text-align:center;padding:40px 0;}
.rmz .modal{position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(30,20,12,.5);}
.rmz .modal.open{display:flex;}
.rmz .sheet{background:var(--cream);border-radius:20px;width:min(540px,100%);max-height:92vh;overflow-y:auto;box-shadow:0 10px 30px rgba(60,40,25,.10);}
.rmz .sheet-head{padding:22px 24px 8px;}
.rmz .sheet-head h3{font-size:23px;font-weight:600;}
.rmz .sheet-head p{color:var(--muted);font-size:14px;margin:6px 0 0;}
.rmz .sheet-body{padding:14px 24px 24px;display:flex;flex-direction:column;gap:14px;}
.rmz .field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;}
.rmz .field input,.rmz .field textarea{width:100%;border:1px solid var(--line);border-radius:11px;padding:12px 14px;font-size:15px;font-family:inherit;background:#fff;}
.rmz .field input:focus,.rmz .field textarea:focus{outline:2px solid var(--accent);border-color:transparent;}
.rmz .paylist{display:flex;flex-direction:column;gap:8px;}
.rmz .payopt{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:14px;cursor:pointer;}
.rmz .payopt.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent);}
.rmz .payopt input{margin-top:3px;accent-color:var(--accent);}
.rmz .payopt small{color:var(--muted);}
.rmz .errbox{background:#FDECEA;border:1px solid #F5C6C0;color:#B3261E;border-radius:10px;padding:10px 14px;font-size:13px;}
.rmz .toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--ink);color:#fff;
  padding:12px 18px;border-radius:12px;font-size:14px;font-weight:500;z-index:90;box-shadow:0 10px 30px rgba(60,40,25,.2);}
@media(max-width:900px){
  .rmz .hero-grid{grid-template-columns:1fr;}
  .rmz .hero-visual{order:-1;max-height:320px;}
  .rmz .foot-grid{grid-template-columns:1fr 1fr;}
}
@media(min-width:601px){
  .rmz .hamburger{display:none;}
  .rmz .mobile-menu{display:none;}
}
@media(max-width:600px){
  .rmz .navlinks,.rmz .rz-hide-m{display:none;}
  .rmz .hamburger{display:grid;}
  .rmz .foot-grid{grid-template-columns:1fr;}
  .rmz .hero-actions .btn{flex:1;}
}
`;
