"use client";

/**
 * Módulo de Contenido (multi-tenant).
 *
 * La IA propone publicaciones con la voz del cliente (content_settings.voice_profile),
 * el cliente edita y aprueba, y el arte se produce en Canva.
 *
 * El puente con Canva es Bulk Create vía CSV: la Autofill API de Canva exige plan
 * Enterprise y nuestros clientes tienen Canva Pro, que sí incluye Bulk Create.
 * El tablero exporta el CSV con una fila por publicación aprobada.
 *
 * Uso:
 *   <ContentTab clientId={CANE_CLIENT_ID} theme={T} formats={FORMATOS_PSICOLOGIA} />
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Section, Empty, Chip, Modal, Field, SaveBtn, Toast,
  StatGrid, StatCard, inputStyle as mkInput,
  type DashTheme,
} from "@/components/dashboard";

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type ContentFormat = { id: string; label: string; icon?: string; hint?: string };

export type ContentPost = {
  id: string;
  client_id: string;
  format: string;
  topic: string | null;
  hook: string | null;
  caption: string | null;
  hashtags: string | null;
  visual_note: string | null;
  status: "draft" | "approved" | "published";
  scheduled_for: string | null;
  published_at: string | null;
  source: "ai" | "manual";
  created_at: string;
};

type DraftForm = {
  format: string;
  topic: string;
  hook: string;
  caption: string;
  hashtags: string;
  visual_note: string;
};

const EMPTY_DRAFT: DraftForm = {
  format: "", topic: "", hook: "", caption: "", hashtags: "", visual_note: "",
};

const STATUS_LABEL: Record<ContentPost["status"], string> = {
  draft: "Borrador",
  approved: "Aprobado",
  published: "Publicado",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/** Escapa un campo para CSV: comillas dobladas y todo entrecomillado. */
function csvCell(value: string) {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

/**
 * CSV para Bulk Create de Canva Pro.
 * Cada encabezado se conecta a un campo de texto de la plantilla del cliente.
 * BOM al inicio para que Excel y Canva respeten los acentos.
 */
function buildCanvaCsv(posts: ContentPost[], signature: string, labelOf: (id: string) => string) {
  const headers = ["gancho", "firma", "formato", "tema", "nota_de_arte"];
  const rows = posts.map((p) => [
    csvCell(p.hook ?? ""),
    csvCell(signature),
    csvCell(labelOf(p.format)),
    csvCell(p.topic ?? ""),
    csvCell(p.visual_note ?? ""),
  ].join(","));
  return "﻿" + [headers.join(","), ...rows].join("\r\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Componente ───────────────────────────────────────────────────────────────
export default function ContentTab({
  clientId, theme: t, formats, network = "Instagram y Facebook",
}: {
  clientId: string;
  theme: DashTheme;
  formats: ContentFormat[];
  network?: string;
}) {
  const input = useMemo(() => mkInput(t), [t]);

  const [posts, setPosts]       = useState<ContentPost[]>([]);
  const [signature, setSignature] = useState("");
  const [canvaUrl, setCanvaUrl]   = useState("");
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  // Generador
  const [showGen, setShowGen]   = useState(false);
  const [genFormat, setGenFormat] = useState(formats[0]?.id ?? "reflexion");
  const [genTopic, setGenTopic] = useState("");
  const [genNotes, setGenNotes] = useState("");
  const [generating, setGenerating] = useState(false);

  // Editor del borrador (post nuevo o existente)
  const [editing, setEditing]   = useState<DraftForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);

  const labelOf = useCallback(
    (id: string) => formats.find((f) => f.id === id)?.label ?? id,
    [formats]
  );

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // ── Carga ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: postsData, error: pErr }, { data: cfg }] = await Promise.all([
      supabase
        .from("content_posts")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("content_settings")
        .select("signature, canva_template_url")
        .eq("client_id", clientId)
        .maybeSingle(),
    ]);

    if (pErr) {
      console.error("[ContentTab] load error:", pErr);
      setError("No se pudieron cargar las publicaciones.");
    } else {
      setPosts((postsData ?? []) as ContentPost[]);
      setError(null);
    }
    setSignature(cfg?.signature ?? "");
    setCanvaUrl(cfg?.canva_template_url ?? "");
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // ── Generar con IA ──────────────────────────────────────────────────────────
  async function generate() {
    if (!genTopic.trim()) { setError("Escribe de qué quieres hablar."); return; }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/content/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId, format: genFormat, topic: genTopic.trim(), notes: genNotes.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "No se pudo generar.");

      setEditingId(null);
      setEditing({
        format: genFormat,
        topic: genTopic.trim(),
        hook: json.hook ?? "",
        caption: json.caption ?? "",
        hashtags: json.hashtags ?? "",
        visual_note: json.visual_note ?? "",
      });
      setShowGen(false);
      setGenTopic("");
      setGenNotes("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo generar.");
    } finally {
      setGenerating(false);
    }
  }

  // ── Guardar borrador ────────────────────────────────────────────────────────
  async function saveDraft() {
    if (!editing) return;
    setSaving(true);
    const payload = {
      client_id: clientId,
      format: editing.format,
      topic: editing.topic || null,
      hook: editing.hook || null,
      caption: editing.caption || null,
      hashtags: editing.hashtags || null,
      visual_note: editing.visual_note || null,
    };

    const { error: sErr } = editingId
      ? await supabase.from("content_posts").update(payload).eq("id", editingId)
      : await supabase.from("content_posts").insert(payload);

    setSaving(false);
    if (sErr) {
      console.error("[ContentTab] save error:", sErr);
      setError("No se pudo guardar. Intenta de nuevo.");
      return;
    }
    setEditing(null);
    setEditingId(null);
    flash(editingId ? "Publicación actualizada" : "Guardada como borrador");
    load();
  }

  // ── Cambios de estado ───────────────────────────────────────────────────────
  async function setStatus(post: ContentPost, status: ContentPost["status"]) {
    const patch: Partial<ContentPost> = { status };
    if (status === "published") patch.published_at = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("content_posts").update(patch).eq("id", post.id);
    if (uErr) {
      console.error("[ContentTab] status error:", uErr);
      setError("No se pudo actualizar el estado.");
      return;
    }
    flash(status === "approved" ? "Aprobada" : status === "published" ? "Marcada como publicada" : "Regresó a borrador");
    load();
  }

  async function remove(post: ContentPost) {
    if (!confirm("¿Eliminar esta publicación?")) return;
    const { error: dErr } = await supabase.from("content_posts").delete().eq("id", post.id);
    if (dErr) {
      console.error("[ContentTab] delete error:", dErr);
      setError("No se pudo eliminar.");
      return;
    }
    flash("Eliminada");
    load();
  }

  async function copyCaption(post: ContentPost) {
    const texto = [post.caption ?? "", post.hashtags ?? ""].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(texto);
      flash("Pie copiado — pégalo en la publicación");
    } catch {
      setError("Tu navegador bloqueó el portapapeles. Copia el texto a mano.");
    }
  }

  // ── Export a Canva ──────────────────────────────────────────────────────────
  const approved = useMemo(() => posts.filter((p) => p.status === "approved"), [posts]);

  function exportCanva() {
    if (approved.length === 0) {
      setError("Aprueba al menos una publicación antes de exportar.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(buildCanvaCsv(approved, signature, labelOf), `canva-${stamp}.csv`);
    flash(`${approved.length} publicación${approved.length !== 1 ? "es" : ""} en el CSV`);
  }

  // ── Contadores ──────────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    draft:     posts.filter((p) => p.status === "draft").length,
    approved:  approved.length,
    published: posts.filter((p) => p.status === "published").length,
  }), [posts, approved]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <Empty msg="Cargando publicaciones…" theme={t} />;

  return (
    <>
      <StatGrid>
        <StatCard theme={t} label="Borradores"  value={counts.draft}     icon="✏️" />
        <StatCard theme={t} label="Aprobadas"   value={counts.approved}  icon="✅" accent={t.accent} />
        <StatCard theme={t} label="Publicadas"  value={counts.published} icon="📣" />
      </StatGrid>

      {error && (
        <div style={{
          background: "#FEF2F2", border: `1px solid ${t.danger}`, color: t.danger,
          borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      <Section
        title={<>Contenido para {network}</>}
        theme={t}
        action={{ label: "✨ Nueva publicación", onClick: () => { setShowGen(true); setError(null); } }}
      >
        {/* Barra de Canva */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
          background: t.accentSoft, borderRadius: 12, padding: "12px 16px", marginBottom: 18,
        }}>
          <div style={{ fontSize: 13, color: t.text, flex: "1 1 260px", minWidth: 0 }}>
            <strong>Diseño en Canva:</strong> exporta las aprobadas y súbelas con{" "}
            <em>Bulk Create</em> a tu plantilla. Salen todos los diseños de una vez.
          </div>
          <button
            onClick={exportCanva}
            style={{
              background: t.accent, color: "#fff", border: "none", borderRadius: 9,
              padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ⬇ CSV para Canva ({counts.approved})
          </button>
          {canvaUrl && (
            <a
              href={canvaUrl} target="_blank" rel="noopener noreferrer"
              style={{
                fontSize: 13, fontWeight: 600, color: t.accentDark, textDecoration: "none",
                border: `1px solid ${t.accent}`, borderRadius: 9, padding: "9px 16px",
                whiteSpace: "nowrap",
              }}
            >
              Abrir plantilla ↗
            </a>
          )}
        </div>

        {posts.length === 0 ? (
          <Empty msg="Todavía no hay publicaciones. Genera la primera." theme={t} />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {posts.map((post) => (
              <article
                key={post.id}
                style={{
                  background: t.surface, border: `1px solid ${t.border}`,
                  borderRadius: 14, padding: 16,
                }}
              >
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 8,
                  alignItems: "center", marginBottom: 10,
                }}>
                  <Chip
                    label={STATUS_LABEL[post.status]}
                    bg={post.status === "approved" ? t.accentSoft : post.status === "published" ? "#EEF2FF" : "#F3F4F6"}
                    fg={post.status === "approved" ? t.accentDark : post.status === "published" ? "#4338CA" : t.muted}
                  />
                  <Chip label={labelOf(post.format)} bg="#F9FAFB" fg={t.muted} />
                  <span style={{ fontSize: 12, color: t.muted, marginLeft: "auto" }}>
                    {fmtDate(post.created_at)}
                  </span>
                </div>

                {post.hook && (
                  <div style={{
                    fontSize: 15, fontWeight: 700, color: t.text, lineHeight: 1.45,
                    marginBottom: 8, whiteSpace: "pre-wrap",
                  }}>
                    {post.hook}
                  </div>
                )}

                {post.caption && (
                  <div style={{
                    fontSize: 13.5, color: t.muted, lineHeight: 1.65,
                    whiteSpace: "pre-wrap", marginBottom: 8,
                  }}>
                    {post.caption}
                  </div>
                )}

                {post.hashtags && (
                  <div style={{ fontSize: 12.5, color: t.accentDark, marginBottom: 8 }}>
                    {post.hashtags}
                  </div>
                )}

                {post.visual_note && (
                  <div style={{
                    fontSize: 12, color: t.muted, background: t.panel ?? "#F9FAFB",
                    borderRadius: 8, padding: "8px 10px", marginBottom: 12, lineHeight: 1.55,
                  }}>
                    🎨 {post.visual_note}
                  </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <ActionBtn theme={t} onClick={() => copyCaption(post)}>Copiar pie</ActionBtn>
                  <ActionBtn
                    theme={t}
                    onClick={() => {
                      setEditingId(post.id);
                      setEditing({
                        format: post.format,
                        topic: post.topic ?? "",
                        hook: post.hook ?? "",
                        caption: post.caption ?? "",
                        hashtags: post.hashtags ?? "",
                        visual_note: post.visual_note ?? "",
                      });
                    }}
                  >
                    Editar
                  </ActionBtn>
                  {post.status === "draft" && (
                    <ActionBtn theme={t} primary onClick={() => setStatus(post, "approved")}>
                      Aprobar
                    </ActionBtn>
                  )}
                  {post.status === "approved" && (
                    <>
                      <ActionBtn theme={t} primary onClick={() => setStatus(post, "published")}>
                        Marcar publicada
                      </ActionBtn>
                      <ActionBtn theme={t} onClick={() => setStatus(post, "draft")}>
                        Regresar a borrador
                      </ActionBtn>
                    </>
                  )}
                  <ActionBtn theme={t} danger onClick={() => remove(post)}>Eliminar</ActionBtn>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      {/* ── Modal: generar ──────────────────────────────────────────────────── */}
      {showGen && (
        <Modal title="Nueva publicación" onClose={() => setShowGen(false)} theme={t}>
          <Field label="Formato" theme={t}>
            <select
              value={genFormat}
              onChange={(e) => setGenFormat(e.target.value)}
              style={input}
            >
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.icon ? `${f.icon} ` : ""}{f.label}
                </option>
              ))}
            </select>
            {formats.find((f) => f.id === genFormat)?.hint && (
              <div style={{ fontSize: 12, color: t.muted, marginTop: 6, lineHeight: 1.5 }}>
                {formats.find((f) => f.id === genFormat)!.hint}
              </div>
            )}
          </Field>

          <Field label="¿De qué quieres hablar?" theme={t}>
            <input
              value={genTopic}
              onChange={(e) => setGenTopic(e.target.value)}
              placeholder="Por qué cuesta poner límites con la familia"
              style={input}
            />
          </Field>

          <Field label="Notas (opcional)" theme={t}>
            <textarea
              value={genNotes}
              onChange={(e) => setGenNotes(e.target.value)}
              placeholder="Algo que quieras incluir sí o sí, un enfoque, una frase tuya…"
              rows={3}
              style={{ ...input, resize: "vertical" }}
            />
          </Field>

          <SaveBtn
            theme={t}
            onClick={generate}
            disabled={generating || !genTopic.trim()}
            label={generating ? "Escribiendo…" : "✨ Generar borrador"}
          />
          <div style={{ fontSize: 11.5, color: t.muted, marginTop: 10, lineHeight: 1.5 }}>
            El borrador no se publica solo. Lo revisas, lo editas y tú decides si sale.
          </div>
        </Modal>
      )}

      {/* ── Modal: editar borrador ──────────────────────────────────────────── */}
      {editing && (
        <Modal
          title={editingId ? "Editar publicación" : "Revisar borrador"}
          onClose={() => { setEditing(null); setEditingId(null); }}
          theme={t}
          wide
        >
          <Field label="Texto de la imagen (gancho)" theme={t}>
            <textarea
              value={editing.hook}
              onChange={(e) => setEditing({ ...editing, hook: e.target.value })}
              rows={3}
              style={{ ...input, resize: "vertical", fontWeight: 600 }}
            />
          </Field>

          <Field label="Pie de publicación" theme={t}>
            <textarea
              value={editing.caption}
              onChange={(e) => setEditing({ ...editing, caption: e.target.value })}
              rows={10}
              style={{ ...input, resize: "vertical", lineHeight: 1.6 }}
            />
          </Field>

          <Field label="Hashtags" theme={t}>
            <input
              value={editing.hashtags}
              onChange={(e) => setEditing({ ...editing, hashtags: e.target.value })}
              style={input}
            />
          </Field>

          <Field label="Nota de arte para Canva" theme={t}>
            <textarea
              value={editing.visual_note}
              onChange={(e) => setEditing({ ...editing, visual_note: e.target.value })}
              rows={2}
              style={{ ...input, resize: "vertical" }}
            />
          </Field>

          <SaveBtn
            theme={t}
            onClick={saveDraft}
            disabled={saving}
            label={saving ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar borrador"}
          />
        </Modal>
      )}

      <Toast msg={toast} theme={t} />
    </>
  );
}

// ─── Botón de acción de tarjeta (fuera del render del padre a propósito) ──────
function ActionBtn({
  children, onClick, theme: t, primary, danger,
}: {
  children: React.ReactNode; onClick: () => void; theme: DashTheme;
  primary?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: primary ? t.accent : "none",
        color: primary ? "#fff" : danger ? t.danger : t.muted,
        border: primary ? "none" : `1px solid ${danger ? t.danger : t.border}`,
        borderRadius: 8, padding: "7px 13px", fontSize: 12.5,
        fontWeight: primary ? 600 : 500, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}
