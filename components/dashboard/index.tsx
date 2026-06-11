"use client";

/**
 * Componentes compartidos de dashboards FishFlow.
 * Cada dashboard pasa su propio tema (paleta del cliente) — el comportamiento
 * y la estructura son comunes, el branding es por cliente.
 *
 * Uso:
 *   import { DashboardHeader, StatGrid, StatCard, TabBar, Section, Empty,
 *            Chip, Modal, Field, SaveBtn, Toast, inputStyle, cardStyle,
 *            cardBtnStyle, rowStyle, type DashTheme } from "@/components/dashboard";
 */

import React from "react";

// ─── Tema por cliente ──────────────────────────────────────────────────────────
export type DashTheme = {
  accent: string;      // color principal del cliente (botones, tabs activos)
  accentDark: string;  // variante oscura (textos sobre fondos suaves)
  accentSoft: string;  // fondo suave del acento (iconos, highlights)
  bg: string;          // fondo de página
  surface: string;     // fondo de cards / modales
  text: string;        // texto principal
  muted: string;       // texto secundario
  border: string;      // bordes
  danger: string;      // errores
  disabled: string;    // botones deshabilitados
  panel?: string;      // fondo neutro suave para cards "soft" (default: surface)
};

const FONT_HEAD = "'Plus Jakarta Sans', Inter, sans-serif";

// ─── Estilos base reutilizables ────────────────────────────────────────────────
export const inputStyle = (t: DashTheme): React.CSSProperties => ({
  width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${t.border}`,
  fontSize: 14, fontFamily: "inherit", background: "#fff", color: t.text,
});

export const cardStyle = (t: DashTheme): React.CSSProperties => ({
  background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16,
});

export const cardBtnStyle = (t: DashTheme): React.CSSProperties => ({
  ...cardStyle(t), cursor: "pointer", textAlign: "left", width: "100%", display: "block",
});

export const rowStyle = (t: DashTheme): React.CSSProperties => ({
  background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12,
  padding: "14px 16px", display: "flex", gap: 12, alignItems: "center",
});

// ─── Header del dashboard ──────────────────────────────────────────────────────
export function DashboardHeader({ icon, title, subtitle, theme: t, onLogout, logoutLabel = "Salir", right, sticky, iconBg, iconShape = "square" }: {
  icon: React.ReactNode; title: string; subtitle?: string; theme: DashTheme;
  onLogout?: () => void; logoutLabel?: string; right?: React.ReactNode;
  sticky?: boolean; iconBg?: string; iconShape?: "square" | "circle";
}) {
  return (
    <header style={{ background: t.surface, borderBottom: `1px solid ${t.border}`,
      padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      ...(sticky ? { position: "sticky" as const, top: 0, zIndex: 30 } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: iconShape === "circle" ? "50%" : 10,
          background: iconBg ?? t.accent,
          display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>{icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em", fontFamily: FONT_HEAD,
            color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: t.muted }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {right}
        {onLogout && (
          <button onClick={onLogout}
            style={{ fontSize: 13, color: t.muted, background: "none", border: `1px solid ${t.border}`,
              borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>
            {logoutLabel}
          </button>
        )}
      </div>
    </header>
  );
}

// ─── Stats ─────────────────────────────────────────────────────────────────────
export function StatGrid({ children }: { children: React.ReactNode }) {
  // auto-fit: 4 columnas en desktop, se apilan solas en móvil
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      gap: 14, marginBottom: 24 }}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, icon, highlight, theme: t, sub, accent, soft }: {
  label: string; value: React.ReactNode; icon?: string; highlight?: boolean; theme: DashTheme;
  sub?: string;      // línea secundaria bajo el valor
  accent?: string;   // color del valor (default: texto del tema)
  soft?: boolean;    // variante compacta sobre fondo neutro sin borde (usa theme.panel)
}) {
  if (soft) {
    return (
      <div style={{ background: t.panel ?? t.surface, borderRadius: 8, padding: "0.875rem 1rem" }}>
        <div style={{ fontSize: 11, color: t.muted, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: accent ?? t.text, lineHeight: 1.3, wordBreak: "break-word" }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: t.muted, opacity: .75, marginTop: 3 }}>{sub}</div>}
      </div>
    );
  }
  return (
    <div style={{ background: highlight ? "#FDF1E3" : t.surface,
      border: `1px solid ${highlight ? "#EBC99A" : t.border}`, borderRadius: 14, padding: "16px 18px" }}>
      {icon && <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>}
      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: FONT_HEAD, color: accent ?? t.text }}>{value}</div>
      <div style={{ fontSize: 12, color: t.muted }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: t.muted, opacity: .75, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────
export function TabBar<T extends string>({ tabs, active, onChange, theme: t }: {
  tabs: { id: T; label: string; icon?: string }[]; active: T; onChange: (id: T) => void; theme: DashTheme;
}) {
  return (
    <div style={{ display: "flex", gap: 6, borderBottom: `1px solid ${t.border}`, marginBottom: 22,
      overflowX: "auto" }}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button key={tab.id} onClick={() => onChange(tab.id)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 16px",
              fontSize: 14, fontWeight: isActive ? 700 : 500,
              color: isActive ? t.accentDark : t.muted,
              borderBottom: isActive ? `2px solid ${t.accent}` : "2px solid transparent",
              marginBottom: -1, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
            {tab.icon && <span>{tab.icon}</span>}{tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Sección con título + acción ───────────────────────────────────────────────
export function Section({ title, action, theme: t, children }: {
  title: string; action?: { label: string; onClick: () => void }; theme: DashTheme; children: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, fontFamily: FONT_HEAD, color: t.text }}>{title}</h2>
        {action && (
          <button onClick={action.onClick} style={{ background: t.accent, color: "#fff", border: "none",
            borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

// ─── Estado vacío ──────────────────────────────────────────────────────────────
export function Empty({ msg, theme: t }: { msg: string; theme: DashTheme }) {
  return <div style={{ padding: "48px 0", textAlign: "center", color: t.muted, fontSize: 14 }}>{msg}</div>;
}

// ─── Chip de estado ────────────────────────────────────────────────────────────
export function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, background: bg, color: fg, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// ─── Modal genérico ────────────────────────────────────────────────────────────
export function Modal({ title, onClose, theme: t, children, wide }: {
  title: string; onClose: () => void; theme: DashTheme; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,30,30,.45)",
      display: "grid", placeItems: "center", zIndex: 200, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderRadius: 16,
        width: "100%", maxWidth: wide ? 560 : 440, maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${t.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, fontFamily: FONT_HEAD, color: t.text }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22,
            color: t.muted, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Campos de formulario ──────────────────────────────────────────────────────
export function Field({ label, theme: t, children }: {
  label: string; theme: DashTheme; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: t.muted, marginBottom: 5, display: "block" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function SaveBtn({ onClick, disabled, theme: t, label = "Guardar" }: {
  onClick: () => void; disabled?: boolean; theme: DashTheme; label?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width: "100%", background: disabled ? t.disabled : t.accent, color: "#fff",
        border: "none", borderRadius: 10, padding: "11px", fontSize: 14, fontWeight: 700,
        cursor: disabled ? "default" : "pointer", marginTop: 6 }}>
      {label}
    </button>
  );
}

// ─── Toast ─────────────────────────────────────────────────────────────────────
export function Toast({ msg, theme: t }: { msg: string | null; theme: DashTheme }) {
  if (!msg) return null;
  return (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      background: t.accentDark, color: "#fff", padding: "10px 20px", borderRadius: 10,
      fontSize: 13, boxShadow: "0 6px 20px rgba(0,0,0,.2)", zIndex: 100 }}>
      {msg}
    </div>
  );
}
