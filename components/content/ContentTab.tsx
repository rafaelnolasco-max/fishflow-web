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
import MediaUploader, { type PostMedia } from "@/components/content/MediaUploader";

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type ContentFormat = { id: string; label: string; icon?: string; hint?: string };

/**
 * Plantilla de Canva del cliente.
 *
 * Bulk Create llena UNA plantilla por corrida: si el CSV mezcla formatos, Canva
 * estampa todos los textos en el mismo diseño. Por eso cada plantilla declara
 * qué formatos llena y el tablero descarga el CSV ya filtrado.
 *
 * `formats` vacío o ausente = la plantilla sirve para cualquier formato.
 */
export type CanvaTemplate = { label: string; url: string; formats?: string[] | null };

/** Normaliza lo que viene de content_settings.canva_templates (jsonb, sin garantías). */
function parseTemplates(raw: unknown, legacyUrl: string): CanvaTemplate[] {
  const list = Array.isArray(raw)
    ? raw.flatMap((item) => {
        const t = item as Partial<CanvaTemplate> | null;
        if (!t || typeof t.url !== "string" || !t.url) return [];
        return [{
          label: typeof t.label === "string" && t.label ? t.label : "Plantilla",
          url: t.url,
          formats: Array.isArray(t.formats) ? t.formats.filter((f) => typeof f === "string") : null,
        }];
      })
    : [];
  if (list.length > 0) return list;
  // Campo legado: clientes que todavía tienen una sola plantilla.
  return legacyUrl ? [{ label: "Plantilla", url: legacyUrl, formats: null }] : [];
}

/** Una plantilla sin formatos declarados acepta cualquier publicación. */
function templateTakes(tpl: CanvaTemplate, format: string) {
  return !tpl.formats || tpl.formats.length === 0 || tpl.formats.includes(format);
}

/**
 * Estados. 'scheduled' y 'failed' pertenecen a la fase de publicación automática
 * (Blotato) y todavía no se producen desde este tablero, pero se contemplan para
 * que una publicación entregada por otra vía no rompa el render.
 */
export type ContentStatus = "draft" | "approved" | "scheduled" | "published" | "failed";

export type ContentPost = PostMedia & {
  id: string;
  client_id: string;
  format: string;
  topic: string | null;
  hook: string | null;
  caption: string | null;
  hashtags: string | null;
  visual_note: string | null;
  status: ContentStatus;
  scheduled_for: string | null;
  published_at: string | null;
  publish_targets: string[] | null;
  publish_error: string | null;
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

const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: "Borrador",
  approved: "Aprobado",
  scheduled: "Programado",
  published: "Publicado",
  failed: "Falló al publicar",
};

/** Colores del chip de estado, para no cargar de ternarios el render. */
const STATUS_COLOR: Record<ContentStatus, { bg: string; fg: string }> = {
  draft:     { bg: "#F3F4F6", fg: "#6B7280" },
  approved:  { bg: "",        fg: "" },       // usa el acento del cliente
  scheduled: { bg: "#FEF3C7", fg: "#92400E" },
  published: { bg: "#EEF2FF", fg: "#4338CA" },
  failed:    { bg: "#FEF2F2", fg: "#B91C1C" },
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
  topicPlaceholder = "Por qué cuesta poner límites con la familia",
  notesPlaceholder = "Algo que quieras incluir sí o sí, un enfoque, una frase tuya…",
}: {
  clientId: string;
  theme: DashTheme;
  formats: ContentFormat[];
  network?: string;
  /** Ejemplos del propio negocio: el placeholder de CANE confunde a otros clientes. */
  topicPlaceholder?: string;
  notesPlaceholder?: string;
}) {
  const input = useMemo(() => mkInput(t), [t]);

  const [posts, setPosts]       = useState<ContentPost[]>([]);
  const [signature, setSignature] = useState("");
  const [templates, setTemplates] = useState<CanvaTemplate[]>([]);
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
        .select("signature, canva_template_url, canva_templates")
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
    setTemplates(parseTemplates(cfg?.canva_templates, cfg?.canva_template_url ?? ""));
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // ── Generar con IA ──────────────────────────────────────────────────────────
  async function generate() {
    if (!genTopic.trim()) { setError("Escribe de qué quieres hablar."); return; }
    setGenerating(true);
    setError(null);
    // Tope de espera del lado del cliente. Sin esto, si la petición se queda
    // colgada el botón se queda en "Escribiendo…" para siempre y el usuario no
    // tiene forma de saber si sigue trabajando o ya se murió.
    const ctrl = new AbortController();
    const corte = setTimeout(() => ctrl.abort(), 50_000);
    try {
      const res = await fetch("/api/content/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId, format: genFormat, topic: genTopic.trim(), notes: genNotes.trim(),
        }),
        signal: ctrl.signal,
      });
      // Si la plataforma devuelve una página de error, res.json() truena: leemos
      // texto y damos un mensaje entendible en lugar de un error de parseo.
      const cuerpo = await res.text();
      let json: { error?: string; hook?: string; caption?: string; hashtags?: string; visual_note?: string };
      try {
        json = JSON.parse(cuerpo);
      } catch {
        throw new Error(
          res.ok
            ? "La respuesta llegó incompleta. Intenta de nuevo."
            : `El servidor respondió con un error (${res.status}). Intenta de nuevo en un momento.`
        );
      }
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
      const abortada = e instanceof DOMException && e.name === "AbortError";
      setError(
        abortada
          ? "Se tardó demasiado y cancelamos la espera. Vuelve a intentar; si sigue igual, avísanos."
          : e instanceof Error ? e.message : "No se pudo generar."
      );
    } finally {
      clearTimeout(corte);
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

  /** Aprobadas que le tocan a cada plantilla, en el orden en que se muestran. */
  const byTemplate = useMemo(
    () => templates.map((tpl) => ({
      tpl,
      posts: approved.filter((p) => templateTakes(tpl, p.format)),
    })),
    [templates, approved]
  );

  /** Aprobadas que ninguna plantilla reclama: se avisan para que no se queden atoradas. */
  const orphans = useMemo(
    () => approved.filter((p) => !templates.some((tpl) => templateTakes(tpl, p.format))),
    [templates, approved]
  );

  function exportCanva(subset: ContentPost[], slug: string) {
    if (subset.length === 0) {
      setError("Aprueba al menos una publicación antes de exportar.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(buildCanvaCsv(subset, signature, labelOf), `canva-${slug}-${stamp}.csv`);
    flash(`${subset.length} publicación${subset.length !== 1 ? "es" : ""} en el CSV`);
  }

  /** "Reflexión — crema" → "reflexion-crema", para el nombre del archivo. */
  function slugify(text: string) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plantilla";
  }

  // ── Contadores ──────────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    draft:     posts.filter((p) => p.status === "draft").length,
    approved:  approved.length,
    published: posts.filter((p) => p.status === "published").length,
    // Aprobadas que YA tienen archivo: son las que podrían salir hoy mismo.
    lista:     approved.filter((p) => Boolean(p.media_url)).length,
  }), [posts, approved]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <Empty msg="Cargando publicaciones…" theme={t} />;

  return (
    <>
      <StatGrid>
        <StatCard theme={t} label="Borradores"  value={counts.draft}     icon="✏️" />
        <StatCard theme={t} label="Aprobadas"   value={counts.approved}  icon="✅" accent={t.accent} />
        <StatCard theme={t} label="Con arte"    value={counts.lista}     icon="🎬" />
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
        {/* Barra de Canva: una fila por plantilla, con su propio CSV ya filtrado. */}
        <div style={{
          background: t.accentSoft, borderRadius: 12, padding: "12px 16px", marginBottom: 18,
        }}>
          <div style={{ fontSize: 13, color: t.text, marginBottom: templates.length > 0 ? 10 : 0 }}>
            <strong>Diseño en Canva:</strong> escoge con qué plantilla quieres salir, baja su
            archivo y súbelo con <em>Bulk Create</em>. Cada archivo trae solo las publicaciones
            que le tocan a esa plantilla.
          </div>

          {templates.length === 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 10 }}>
              <button
                onClick={() => exportCanva(approved, "todas")}
                style={{
                  background: t.accent, color: "#fff", border: "none", borderRadius: 9,
                  padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                ⬇ CSV para Canva ({counts.approved})
              </button>
              <span style={{ fontSize: 12.5, color: t.muted }}>
                Mándanos el vínculo de tu plantilla y aparece aquí como botón.
              </span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {byTemplate.map(({ tpl, posts: subset }) => (
                <div
                  key={tpl.url + tpl.label}
                  style={{
                    display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
                    background: t.surface, border: `1px solid ${t.border}`,
                    borderRadius: 10, padding: "9px 12px",
                  }}
                >
                  <div style={{
                    fontSize: 13.5, fontWeight: 600, color: t.text,
                    flex: "1 1 180px", minWidth: 0,
                  }}>
                    {tpl.label}
                    <span style={{ fontWeight: 400, color: t.muted, marginLeft: 8, fontSize: 12.5 }}>
                      {subset.length === 0
                        ? "sin aprobadas"
                        : `${subset.length} aprobada${subset.length !== 1 ? "s" : ""}`}
                    </span>
                  </div>
                  <button
                    onClick={() => exportCanva(subset, slugify(tpl.label))}
                    disabled={subset.length === 0}
                    style={{
                      background: subset.length === 0 ? t.disabled : t.accent,
                      color: "#fff", border: "none", borderRadius: 9,
                      padding: "8px 14px", fontSize: 13, fontWeight: 600,
                      cursor: subset.length === 0 ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ⬇ CSV ({subset.length})
                  </button>
                  <a
                    href={tpl.url} target="_blank" rel="noopener noreferrer"
                    style={{
                      fontSize: 13, fontWeight: 600, color: t.accentDark, textDecoration: "none",
                      border: `1px solid ${t.accent}`, borderRadius: 9, padding: "8px 14px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Abrir ↗
                  </a>
                </div>
              ))}

              {orphans.length > 0 && (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
                  fontSize: 12.5, color: t.muted, paddingTop: 2,
                }}>
                  <span style={{ flex: "1 1 200px", minWidth: 0 }}>
                    {orphans.length} aprobada{orphans.length !== 1 ? "s" : ""} de otros formatos
                    todavía sin plantilla asignada.
                  </span>
                  <button
                    onClick={() => exportCanva(orphans, "sin-plantilla")}
                    style={{
                      background: "transparent", color: t.accentDark,
                      border: `1px solid ${t.border}`, borderRadius: 9,
                      padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ⬇ CSV de esas
                  </button>
                </div>
              )}
            </div>
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
                    label={STATUS_LABEL[post.status] ?? post.status}
                    bg={post.status === "approved" ? t.accentSoft : (STATUS_COLOR[post.status]?.bg || "#F3F4F6")}
                    fg={post.status === "approved" ? t.accentDark : (STATUS_COLOR[post.status]?.fg || t.muted)}
                  />
                  <Chip label={labelOf(post.format)} bg="#F9FAFB" fg={t.muted} />
                  {post.media_url && (
                    <Chip
                      label={post.media_type === "video" ? "🎬 Reel" : "🖼️ Arte"}
                      bg={t.accentSoft}
                      fg={t.accentDark}
                    />
                  )}
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

                {/*
                  El arte vive pegado a su publicación, no en el carrete del
                  celular. Además de resolver el extravío de archivos, deja la
                  URL pública que Blotato necesitará para programar.
                */}
                <MediaUploader
                  postId={post.id}
                  clientId={clientId}
                  media={post}
                  theme={t}
                  onSaved={(msg) => { setError(null); flash(msg); load(); }}
                  onError={setError}
                />

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
              placeholder={topicPlaceholder}
              style={input}
            />
          </Field>

          <Field label="Notas (opcional)" theme={t}>
            <textarea
              value={genNotes}
              onChange={(e) => setGenNotes(e.target.value)}
              placeholder={notesPlaceholder}
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
