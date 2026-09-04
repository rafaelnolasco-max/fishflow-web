import { NextRequest, NextResponse } from "next/server";
import { sendEmail, REPLY_TO } from "@/lib/email";
import {
  DISCOVERY_BUCKET,
  computeProgress,
  discoveryAdmin,
  isAnswered,
  loadInviteByToken,
  type DiscoveryBlock,
  type NotaLeida,
} from "@/lib/discovery";

export const runtime = "nodejs";
export const maxDuration = 60;

// ════════════════════════════════════════════════════════════════════════════
// Descubrimiento — envío final
// ════════════════════════════════════════════════════════════════════════════
// Sella la invitación y manda el correo con TODO lo contestado, las ligas
// firmadas a las fotos y lo que la IA leyó de ellas.
//
// El correo trae las respuestas completas a propósito: hoy no hay tablero, y
// un aviso de "ya contestó" que obliga a entrar a la base de datos no sirve
// para llegar preparado a la junta.

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function pintaValor(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => esc(x)).join(" · ");
  return esc(v).replace(/\n/g, "<br>");
}

export async function POST(req: NextRequest) {
  try {
    const { token } = (await req.json()) as { token?: string };
    if (!token) return NextResponse.json({ error: "Falta el token." }, { status: 400 });

    const supabase = discoveryAdmin();
    const found = await loadInviteByToken(supabase, token);
    if (!found.ok) {
      return NextResponse.json(
        { error: found.reason === "expired" ? "La liga ya venció." : "Liga no válida." },
        { status: found.reason === "expired" ? 410 : 404 },
      );
    }
    const { invite, template } = found;

    // Doble envío (dos toques al botón, o el usuario recargando): no es error.
    if (invite.status === "submitted") {
      return NextResponse.json({ ok: true, ya_enviado: true });
    }

    const nowIso = new Date().toISOString();
    const progress = computeProgress(template.blocks, invite.answers);

    const { error: upErr } = await supabase
      .from("discovery_invites")
      .update({ status: "submitted", submitted_at: nowIso, progress })
      .eq("id", invite.id);
    if (upErr) {
      console.error("[descubrimiento/enviar] update:", upErr);
      return NextResponse.json({ error: "No se pudo enviar." }, { status: 500 });
    }

    // ── Adjuntos con liga firmada (7 días) y lo que la IA leyó ───────────────
    const { data: adjuntos } = await supabase
      .from("discovery_attachments")
      .select("id, storage_path, mime, ai_result, ai_error, created_at")
      .eq("invite_id", invite.id)
      .order("created_at", { ascending: true });

    const bloquesAdjuntos: string[] = [];
    for (const a of adjuntos ?? []) {
      const { data: firmada } = await supabase.storage
        .from(DISCOVERY_BUCKET)
        .createSignedUrl(a.storage_path as string, 60 * 60 * 24 * 7);
      const leida = a.ai_result as NotaLeida | null;
      const campos = leida?.campos_detectados?.length
        ? `<p style="margin:6px 0 0;font-size:13px;color:#6B7B82">Campos que la IA detectó: ${esc(leida.campos_detectados.join(", "))}</p>`
        : "";
      bloquesAdjuntos.push(`
        <div style="border:1px solid #E5E1D6;border-radius:6px;padding:12px;margin:10px 0">
          <p style="margin:0;font-size:14px">
            ${firmada?.signedUrl ? `<a href="${esc(firmada.signedUrl)}" style="color:#1FA9D6">Ver el archivo</a>` : "Archivo sin liga"}
            <span style="color:#6B7B82"> · ${esc(a.mime)}</span>
          </p>
          ${leida?.legible === false ? `<p style="margin:6px 0 0;font-size:13px;color:#B4531B">La IA no pudo leerla: ${esc(leida.motivo_no_legible)}</p>` : ""}
          ${a.ai_error ? `<p style="margin:6px 0 0;font-size:13px;color:#B4531B">Falló la lectura: ${esc(a.ai_error)}</p>` : ""}
          ${campos}
        </div>`);
    }

    // ── Respuestas, bloque por bloque ────────────────────────────────────────
    const secciones = (template.blocks as DiscoveryBlock[])
      .map((b) => {
        const filas = b.questions
          .filter((q) => isAnswered(invite.answers[q.id]))
          .map(
            (q) => `
            <tr>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #E5E1D6;font-size:13px;color:#6B7B82;width:42%;vertical-align:top">${esc(q.label)}</td>
              <td style="padding:8px 0;border-bottom:1px solid #E5E1D6;font-size:14px;color:#0E2A36">${pintaValor(invite.answers[q.id])}</td>
            </tr>`,
          )
          .join("");
        if (!filas) return "";
        return `
          <h3 style="font-size:15px;color:#0E2A36;margin:22px 0 6px">${esc(b.title)}</h3>
          <table style="width:100%;border-collapse:collapse">${filas}</table>`;
      })
      .join("");

    const sinContestar = (template.blocks as DiscoveryBlock[])
      .flatMap((b) => b.questions)
      .filter((q) => !isAnswered(invite.answers[q.id]));

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#0E2A36">
        <div style="background:#0A1820;color:#F4F1EA;padding:22px 24px;border-radius:8px 8px 0 0">
          <p style="margin:0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#F26B17">Descubrimiento contestado</p>
          <h1 style="margin:6px 0 0;font-size:22px;font-weight:600">${esc(invite.prospect_name)}</h1>
          <p style="margin:4px 0 0;font-size:14px;color:rgba(244,241,234,.8)">
            ${esc(invite.prospect_org ?? template.name)} · ${progress}% contestado
          </p>
        </div>
        <div style="border:1px solid #E5E1D6;border-top:0;border-radius:0 0 8px 8px;padding:20px 24px">
          <p style="margin:0 0 4px;font-size:14px;color:#6B7B82">
            ${esc(invite.prospect_email ?? "sin correo")} · ${esc(invite.prospect_phone ?? "sin teléfono")}
          </p>
          ${secciones || '<p style="font-size:14px">No dejó ninguna respuesta.</p>'}
          ${
            bloquesAdjuntos.length
              ? `<h3 style="font-size:15px;margin:24px 0 6px">Lo que subió (${bloquesAdjuntos.length})</h3>
                 <p style="margin:0 0 4px;font-size:12px;color:#6B7B82">Las ligas vencen en 7 días.</p>
                 ${bloquesAdjuntos.join("")}`
              : ""
          }
          ${
            sinContestar.length
              ? `<h3 style="font-size:15px;margin:24px 0 6px">Quedó sin contestar (${sinContestar.length})</h3>
                 <p style="font-size:13px;color:#6B7B82;line-height:1.6">${sinContestar.map((q) => esc(q.label)).join(" · ")}</p>
                 <p style="font-size:13px;color:#6B7B82">Eso es material para la junta: lo que no contestó suele ser lo que no tiene resuelto.</p>`
              : ""
          }
        </div>
      </div>`;

    await sendEmail({
      from: "fishflow",
      to: REPLY_TO,
      replyTo: invite.prospect_email || REPLY_TO,
      subject: `Descubrimiento — ${invite.prospect_name} · ${progress}% contestado`,
      html,
      tag: "descubrimiento/enviar",
    });

    return NextResponse.json({ ok: true, progress });
  } catch (err) {
    console.error("[descubrimiento/enviar] error:", err);
    return NextResponse.json({ error: "Error al enviar." }, { status: 500 });
  }
}
