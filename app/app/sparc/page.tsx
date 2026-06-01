"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";
const SPARC_CLIENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

interface Building { id: string; name: string; address: string | null }

function FishFlowMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.52} viewBox="0 0 68 36" fill="none">
      <path d="M34 18 C34 9 25 3 15 6 C6 9 4 19 11 24 C19 30 34 27 34 18Z" stroke={FF_CYAN} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M34 18 C34 9 43 3 53 6 C62 9 64 19 57 24 C49 30 34 27 34 18Z" stroke={FF_ORANGE} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M64 14 L68 10 M64 22 L68 26" stroke={FF_ORANGE} strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function SparcHome() {
  const router = useRouter();
  const [buildings,   setBuildings]   = useState<Building[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [userEmail,   setUserEmail]   = useState<string>("");
  const [showModal,   setShowModal]   = useState(false);
  const [newName,     setNewName]     = useState("");
  const [newAddress,  setNewAddress]  = useState("");
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserEmail(user.email ?? "");
      const { data, error } = await supabase
        .from("sparc_buildings")
        .select("id, name, address")
        .eq("client_id", SPARC_CLIENT_ID)
        .eq("active", true)
        .order("name");
      if (error) setError(error.message);
      else setBuildings(data ?? []);
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function openModal() {
    setNewName(""); setNewAddress(""); setSaveError(null); setShowModal(true);
  }

  async function handleSave() {
    if (!newName.trim()) { setSaveError("El nombre del edificio es obligatorio."); return; }
    setSaving(true); setSaveError(null);
    const { data, error } = await supabase
      .from("sparc_buildings")
      .insert({ client_id: SPARC_CLIENT_ID, name: newName.trim(), address: newAddress.trim() || null })
      .select("id, name, address")
      .single();
    if (error) { setSaveError(error.message); setSaving(false); return; }
    setBuildings(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setShowModal(false);
    setSaving(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0D1B2A", color: "#f0f4f8", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e3048", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <FishFlowMark size={28} />
          <span style={{ fontWeight: 700, fontSize: 16, color: FF_CYAN }}>Sparc</span>
          <span style={{ color: "#5a7a9a", fontSize: 14 }}>/ Mis Edificios</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, color: "#5a7a9a" }}>{userEmail}</span>
          <button onClick={handleLogout} style={{ background: "none", border: "1px solid #1e3048", color: "#5a7a9a", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 13 }}>
            Salir
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 40, flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Mis Edificios</h1>
            <p style={{ color: "#5a7a9a", fontSize: 15, margin: 0 }}>
              Carga el chat de WhatsApp de cada edificio para obtener el resumen y clasificación de mensajes.
            </p>
          </div>
          <button onClick={openModal}
            style={{ background: FF_CYAN, border: "none", borderRadius: 10, padding: "12px 22px", color: "#0D1B2A", fontWeight: 800, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            + Agregar edificio
          </button>
        </div>

        {loading && <p style={{ color: "#5a7a9a" }}>Cargando edificios…</p>}
        {error   && <p style={{ color: "#ff6b6b" }}>Error: {error}</p>}

        {!loading && buildings.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 24px", color: "#5a7a9a" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>No hay edificios registrados</div>
            <button onClick={openModal} style={{ background: FF_CYAN, border: "none", borderRadius: 8, padding: "10px 22px", color: "#0D1B2A", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
              Agregar primer edificio
            </button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 20 }}>
          {buildings.map(b => (
            <div key={b.id} onClick={() => router.push(`/app/sparc/${b.id}/dashboard`)}
              style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 12, padding: "28px 24px", cursor: "pointer", transition: "border-color 0.15s, box-shadow 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = FF_CYAN; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 0 1px ${FF_CYAN}22`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "#1e3048"; (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🏢</div>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{b.name}</div>
              {b.address && <div style={{ color: "#5a7a9a", fontSize: 13 }}>{b.address}</div>}
              <div style={{ marginTop: 16, color: FF_CYAN, fontSize: 13, fontWeight: 600 }}>Abrir dashboard →</div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal — Nuevo edificio */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "#000000bb", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 16, padding: "32px", width: "100%", maxWidth: 440 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 24 }}>Nuevo edificio</h2>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, color: "#5a7a9a", marginBottom: 6 }}>Nombre del edificio *</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSave()}
                placeholder="Ej. Torre Insurgentes"
                autoFocus
                style={{ width: "100%", background: "#0D1B2A", border: "1px solid #1e3048", borderRadius: 8, padding: "10px 14px", color: "#f0f4f8", fontSize: 15, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, color: "#5a7a9a", marginBottom: 6 }}>Dirección <span style={{ color: "#3a5a7a" }}>(opcional)</span></label>
              <input
                value={newAddress}
                onChange={e => setNewAddress(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSave()}
                placeholder="Ej. Insurgentes Sur 1234, CDMX"
                style={{ width: "100%", background: "#0D1B2A", border: "1px solid #1e3048", borderRadius: 8, padding: "10px 14px", color: "#f0f4f8", fontSize: 15, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            {saveError && (
              <div style={{ background: "#2a1111", border: "1px solid #ff444433", borderRadius: 8, padding: "10px 14px", color: "#ff6b6b", fontSize: 13, marginBottom: 16 }}>
                {saveError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, background: saving ? "#1e3048" : FF_CYAN, border: "none", borderRadius: 10, padding: "12px", color: saving ? "#5a7a9a" : "#0D1B2A", fontWeight: 800, fontSize: 15, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "Guardando…" : "Guardar edificio"}
              </button>
              <button onClick={() => setShowModal(false)}
                style={{ background: "#1e3048", border: "none", borderRadius: 10, padding: "12px 20px", color: "#5a7a9a", cursor: "pointer", fontSize: 14 }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
