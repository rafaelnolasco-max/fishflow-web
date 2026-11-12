"use client";
import { useCallback, useState } from "react";
import { OrderDetail } from "@/components/lukon/InstalacionesTab";

// Misma paleta que el panel de LUKON (app/app/lukon/page.tsx)
const L = {
  ink: "#000D32", ink2: "#06143F", ink3: "#0E2150", paper: "#F6F9FE", paper2: "#E9F2FF", line: "#1E3A70", lineL: "#D6E0F0",
  muted: "#8DA2C8", mutedL: "#5A6B8C", signal: "#3BA4FF", amber: "#F6A623", crimson: "#E04E2A",
  fBody: "'Inter', system-ui, sans-serif", fMono: "'Inter', system-ui, sans-serif", fDisplay: "'Bebas Neue', Impact, 'Arial Narrow', sans-serif",
};
const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap");
body{margin:0;background:${L.paper};}
.iv input,.iv select,.iv textarea{font-size:16px !important;}
`;

export default function InstallerView({ id, token }: { id: string | null; token: string }) {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const onToast = useCallback((msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); }, []);

  return (
    <div className="iv" style={{ minHeight: "100vh", background: L.paper, fontFamily: L.fBody, color: L.ink, overflowX: "clip" }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header style={{ background: L.ink, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <svg viewBox="0 -2 606 187" role="img" aria-label="LUKON" style={{ height: 24, width: "auto", display: "block" }}>
          <g fill="#FFFFFF"><path d="M0 0h28.7v106h71.6v28H0z"/><path d="M104 0h28.5v78a27.5 27.5 0 0 0 55 0V0H216v78a56 56 0 0 1-112 0z"/><path d="M237.5 0h28.3v56.4L316.2 0H350l-55.1 62.8 57 71.2h-36.7l-49.4-61.75V134h-28.3z"/><circle cx="416.75" cy="66.5" r="17.75"/></g>
          <g fill="#0084F9"><path fillRule="evenodd" d="M416.75 0.7a66.3 66.3 0 1 0 0.001 0zm0 28.45a37.85 37.85 0 1 1-0.001 0z"/><path d="M393 146.8h47.8l-23.9 36.2z"/><path d="M498.8 0H518l60.2 75.25V0H606v134h-18.4l-61.1-76.4V134h-27.7z"/></g>
        </svg>
        <span style={{ color: L.muted, fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase" }}>Instalador</span>
      </header>
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px 60px" }}>
        {id
          ? <OrderDetail t={L} id={id} installerToken={token} onToast={onToast} />
          : <div style={{ background: "#fff", border: `1px solid ${L.lineL}`, borderRadius: 10, padding: 20, marginTop: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>Esta liga ya no es válida</div>
              <p style={{ color: L.mutedL, margin: "6px 0 0" }}>Puede que la orden se haya cancelado o que LUKON te haya mandado una liga nueva. Pídela de nuevo a LUKON.</p>
            </div>}
      </main>
      {toast && (
        <div style={{ position: "fixed", left: 12, right: 12, top: 12, zIndex: 999, background: toast.ok ? L.ink3 : "#3d1010", color: toast.ok ? L.signal : "#ffaaaa",
          border: `1px solid ${toast.ok ? L.signal : L.crimson}`, padding: "12px 16px", borderRadius: 8, fontSize: 14 }}>{toast.msg}</div>
      )}
    </div>
  );
}
