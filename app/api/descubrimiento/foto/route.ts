import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_UPLOAD_MIME,
  DISCOVERY_BUCKET,
  MAX_ATTACHMENTS_PER_INVITE,
  MAX_UPLOAD_BYTES,
  VISION_MIME,
  discoveryAdmin,
  loadInviteByToken,
  safeFileName,
  type NotaLeida,
} from "@/lib/discovery";

export const runtime = "nodejs";
// Mirar una foto y redactar la nota tarda más que los 10 s por omisión.
export const maxDuration = 120;

// ════════════════════════════════════════════════════════════════════════════
// Descubrimiento — la foto del documento y la vista previa
// ════════════════════════════════════════════════════════════════════════════
// Este es el momento que vende: el prospecto fotografía una nota suya en papel
// y ve, en la misma pantalla, cómo quedaría dentro del sistema. No es un
// adorno del formulario, es la demo.
//
// Tres cuidados que no son negociables:
//  1) El bucket es PRIVADO. Aunque se le pide tapar los datos del paciente,
//     hay que asumir que a veces no lo hará.
//  2) Al modelo se le prohíbe copiar identificadores del paciente. Lo que se
//     guarda y lo que se enseña en pantalla va despersonalizado.
//  3) La ruta es pública y gasta créditos: tope de archivos por invitación y
//     timeout explícito, o la liga se vuelve una llave de la cuenta.

const VISION_MODEL = "claude-sonnet-4-6";

const SYSTEM = `Eres el motor de lectura de documentos clínicos de FishFlow.

Recibes la FOTO de una nota médica en papel y devuelves esa misma nota
estructurada, como quedaría capturada en un expediente electrónico.

Reglas duras:
- NO inventes. Si un campo no aparece en la foto, omítelo. Es preferible una
  nota corta y fiel que una completa e imaginada.
- NUNCA copies datos que identifiquen al paciente: nombre, número de
  expediente, teléfono, dirección, CURP o correo. Si aparecen, escribe
  exactamente "[dato del paciente]" en su lugar.
- Respeta la terminología del médico. No la traduzcas ni la "mejores".
- Si la foto está borrosa, cortada o no es una nota clínica, responde con
  legible=false y explica en una línea qué pasó.
- "indicaciones_paciente" es lo que se le entregaría al paciente al salir:
  lenguaje llano, sin jerga, en segunda persona, máximo 120 palabras.

Responde ÚNICAMENTE con JSON válido, sin markdown y sin texto alrededor:
{"legible":true,"motivo_no_legible":"","campos_detectados":["..."],
 "nota":{"motivo":"","padecimiento_actual":"","antecedentes":"","exploracion":"",
 "estudios":"","diagnostico":"","plan":"","medicacion":["..."],"proxima_cita":""},
 "indicaciones_paciente":""}`;

function parseJson(raw: string): NotaLeida | null {
  try {
    const cortado = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const p = JSON.parse(cortado) as Record<string, unknown>;
    const nota = (p.nota ?? {}) as NotaLeida["nota"];
    return {
      legible: p.legible !== false,
      motivo_no_legible: String(p.motivo_no_legible ?? "") || undefined,
      campos_detectados: Array.isArray(p.campos_detectados)
        ? p.campos_detectados.map(String)
        : [],
      nota: {
        ...nota,
        medicacion: Array.isArray(nota.medicacion) ? nota.medicacion.map(String) : undefined,
      },
      indicaciones_paciente: String(p.indicaciones_paciente ?? "") || undefined,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const token = String(form.get("token") ?? "");
    const questionId = String(form.get("question_id") ?? "") || null;
    const archivo = form.get("archivo");

    if (!token || !(archivo instanceof File) || archivo.size === 0) {
      return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
    }
    if (archivo.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "La imagen no debe pesar más de 10 MB." },
        { status: 400 },
      );
    }
    if (!ALLOWED_UPLOAD_MIME.has(archivo.type)) {
      return NextResponse.json(
        { error: "Manda una foto (JPG o PNG) o un PDF." },
        { status: 400 },
      );
    }

    const supabase = discoveryAdmin();
    const found = await loadInviteByToken(supabase, token);
    if (!found.ok) {
      return NextResponse.json(
        { error: found.reason === "expired" ? "La liga ya venció." : "Liga no válida." },
        { status: found.reason === "expired" ? 410 : 404 },
      );
    }
    const { invite } = found;

    // Tope por invitación: la ruta es pública y llama al modelo.
    const { count } = await supabase
      .from("discovery_attachments")
      .select("id", { count: "exact", head: true })
      .eq("invite_id", invite.id);
    if ((count ?? 0) >= MAX_ATTACHMENTS_PER_INVITE) {
      return NextResponse.json(
        { error: "Ya se subieron demasiados archivos en esta liga." },
        { status: 429 },
      );
    }

    // 1) Guardar el archivo en el bucket privado.
    const buf = await archivo.arrayBuffer();
    const path = `${invite.client_id}/${invite.id}/${crypto.randomUUID()}-${safeFileName(archivo.name)}`;
    const { error: upErr } = await supabase.storage
      .from(DISCOVERY_BUCKET)
      .upload(path, buf, { contentType: archivo.type, upsert: false });
    if (upErr) {
      console.error("[descubrimiento/foto] upload:", upErr);
      return NextResponse.json({ error: "No se pudo guardar la imagen." }, { status: 500 });
    }

    const { data: fila, error: insErr } = await supabase
      .from("discovery_attachments")
      .insert({
        client_id: invite.client_id,
        invite_id: invite.id,
        question_id: questionId,
        kind: "documento",
        storage_path: path,
        mime: archivo.type,
        size_bytes: archivo.size,
      })
      .select("id")
      .single();
    if (insErr || !fila) {
      console.error("[descubrimiento/foto] insert:", insErr);
      return NextResponse.json({ error: "No se pudo registrar la imagen." }, { status: 500 });
    }

    // 2) Vista previa. Best-effort: si la IA falla, el archivo YA está a salvo.
    if (!VISION_MIME.has(archivo.type)) {
      return NextResponse.json({
        ok: true,
        attachment_id: fila.id,
        preview: null,
        aviso:
          "Guardamos el archivo. Para ver la vista previa en pantalla, mándalo como foto JPG o PNG.",
      });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ ok: true, attachment_id: fila.id, preview: null });
    }

    let leida: NotaLeida | null = null;
    let fallo: string | null = null;
    try {
      // Timeout explícito: el default del SDK son 10 min con reintentos, y eso
      // es justo lo que deja la pantalla colgada.
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        timeout: 90_000,
        maxRetries: 1,
      });
      const msg = await anthropic.messages.create({
        model: VISION_MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: archivo.type as "image/jpeg" | "image/png" | "image/webp",
                  data: Buffer.from(buf).toString("base64"),
                },
              },
              {
                type: "text",
                text: "Estructura esta nota tal como está escrita. No inventes campos que no aparezcan.",
              },
            ],
          },
        ],
      });
      const raw = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      leida = parseJson(raw);
      if (!leida) fallo = "La respuesta del modelo no vino en el formato esperado.";
    } catch (e) {
      fallo = e instanceof Error ? e.message : "Falló la lectura";
      console.error("[descubrimiento/foto] IA:", fallo);
    }

    await supabase
      .from("discovery_attachments")
      .update({
        ai_processed: Boolean(leida),
        ai_result: leida ?? null,
        ai_error: fallo,
      })
      .eq("id", fila.id);

    return NextResponse.json({ ok: true, attachment_id: fila.id, preview: leida });
  } catch (err) {
    console.error("[descubrimiento/foto] error:", err);
    return NextResponse.json({ error: "Error al procesar la imagen." }, { status: 500 });
  }
}
