import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  NOTA_VET_MODEL, NOTA_VET_SYSTEM_PROMPT, buildNotaVetPrompt,
  parseNotaVet, transcripcionVacia,
} from "@/lib/notaVeterinaria";

// ════════════════════════════════════════════════════════════════════════════
// Trufa — consulta grabada por el dueño
// ════════════════════════════════════════════════════════════════════════════
// audio en Storage → transcribe-audio (Whisper compartido) → nota para el dueño
// → vet_appointments + vet_visit_summaries.
//
// A diferencia de /api/sieckvet/record-visit, aquí NO hay veterinario que
// apruebe el borrador: lo que sale se le muestra al dueño tal cual. Por eso la
// ruta valida ella misma que quien llama sea dueño de la mascota, y el prompt
// de lib/notaVeterinaria.ts tiene prohibido inventar dosis.

export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Tope propio de la llamada a Claude. Sin esto, la función se queda colgada
// hasta maxDuration y el usuario ve una pantalla congelada sin explicación.
const CLAUDE_TIMEOUT_MS = 90_000;

/** ¿Este usuario es dueño de esta mascota? Se resuelve con service role, así
 *  que no depende de la RLS: es el candado de la ruta, no un reflejo de ella. */
async function esDueno(petId: string, userId: string, email: string | undefined): Promise<boolean> {
  const { data: pet } = await supabaseAdmin
    .from("vet_pets").select("id, owner_user_id").eq("id", petId).maybeSingle();
  if (!pet) return false;
  if (pet.owner_user_id === userId) return true;

  const { data: link } = await supabaseAdmin
    .from("vet_pet_owners")
    .select("id")
    .eq("pet_id", petId)
    .or(`user_id.eq.${userId}${email ? `,email.ilike.${email}` : ""}`)
    .maybeSingle();
  return !!link;
}

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { pet_id, storage_path, filename, duration_seconds, motivo, vet_name } =
      (await req.json()) as {
        pet_id: string; storage_path: string; filename?: string;
        duration_seconds?: number; motivo?: string; vet_name?: string;
      };

    if (!pet_id || !storage_path) {
      return NextResponse.json({ error: "Faltan pet_id o storage_path" }, { status: 400 });
    }
    if (!(await esDueno(pet_id, user.id, user.email))) {
      return NextResponse.json({ error: "Sin acceso a esta mascota" }, { status: 403 });
    }
    if (typeof duration_seconds === "number" && duration_seconds < 15) {
      return NextResponse.json(
        { error: "La grabación es demasiado corta para sacar algo útil." }, { status: 422 },
      );
    }
    // El audio vive bajo la mascota: si la ruta no corresponde, alguien está
    // intentando procesar la grabación de otra.
    if (!storage_path.startsWith(`${pet_id}/trufa/`)) {
      return NextResponse.json({ error: "Ruta de audio inválida" }, { status: 400 });
    }

    const { data: pet } = await supabaseAdmin
      .from("vet_pets")
      .select("id, client_id, name, species, breed, owner_name")
      .eq("id", pet_id).single();
    if (!pet) return NextResponse.json({ error: "Mascota no encontrada" }, { status: 404 });

    // ── 1. La cita a la que cuelga todo ────────────────────────────────────────
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("vet_appointments")
      .insert({
        client_id: pet.client_id,
        pet_id,
        scheduled_at: new Date().toISOString(),
        reason: motivo?.trim() || null,
        status: "completed",
        notes: vet_name?.trim() ? `Veterinario: ${vet_name.trim()}` : null,
      })
      .select("id").single();
    if (apptErr || !appt) {
      console.error("trufa consulta — cita:", apptErr);
      return NextResponse.json({ error: "No se pudo registrar la consulta" }, { status: 500 });
    }

    // ── 2. Transcribir con el Edge Function compartido ─────────────────────────
    const txRes = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({
        client_id: pet.client_id, module: "trufa_consulta", ref_id: appt.id,
        storage_path, filename,
      }),
    });
    const txData = await txRes.json();
    if (!txRes.ok || !txData.transcript) {
      return NextResponse.json(
        { error: `No se pudo transcribir: ${txData.error ?? "sin transcripción"}` }, { status: 502 },
      );
    }
    if (transcripcionVacia(txData.transcript)) {
      if (txData.transcription_id) {
        await supabaseAdmin.from("transcriptions")
          .update({ status: "empty", error: "Sin voz detectada" })
          .eq("id", txData.transcription_id);
      }
      return NextResponse.json({
        error: "No se escuchó voz en la grabación. Acerca el teléfono al veterinario e intenta de nuevo.",
        empty: true,
      }, { status: 422 });
    }

    // ── 3. Padecimientos del carnet, como contexto ─────────────────────────────
    const { data: conds } = await supabaseAdmin
      .from("vet_conditions").select("name").eq("pet_id", pet_id).eq("status", "activo");

    // ── 4. Nota para el dueño ──────────────────────────────────────────────────
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
    }

    let claudeRes: Response;
    try {
      claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: NOTA_VET_MODEL,
          max_tokens: 2000,
          system: NOTA_VET_SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildNotaVetPrompt({
            petName: pet.name, species: pet.species, breed: pet.breed,
            ownerName: pet.owner_name,
            padecimientos: (conds ?? []).map((c) => c.name as string),
            motivo: motivo?.trim() || null,
            transcript: txData.transcript,
          }) }],
        }),
      });
    } catch (e) {
      console.error("trufa consulta — Claude timeout:", e);
      return NextResponse.json(
        { error: "El resumen tardó demasiado. La grabación quedó guardada; vuelve a intentarlo." },
        { status: 504 },
      );
    }

    if (!claudeRes.ok) {
      console.error("trufa consulta — Claude:", await claudeRes.text());
      return NextResponse.json({ error: "No se pudo generar el resumen" }, { status: 502 });
    }

    const claudeData = (await claudeRes.json()) as { content: Array<{ text: string }> };
    const nota = parseNotaVet(claudeData.content?.[0]?.text ?? "");
    if (!nota) {
      return NextResponse.json({ error: "El resumen no se pudo leer" }, { status: 422 });
    }

    // ── 5. Guardar ─────────────────────────────────────────────────────────────
    // approved_at se llena solo: en Trufa no hay veterinario que revise, así que
    // dejarlo en null marcaría para siempre una aprobación que nadie va a dar.
    const { data: summary, error: sErr } = await supabaseAdmin
      .from("vet_visit_summaries")
      .insert({
        client_id: pet.client_id,
        appointment_id: appt.id,
        transcription_id: txData.transcription_id ?? null,
        source_type: "trufa_owner",
        transcript: txData.transcript,
        raw_summary: nota,
        owner_summary: nota.resumen,
        ai_processed: true,
        approved_at: new Date().toISOString(),
      })
      .select().single();
    if (sErr) {
      console.error("trufa consulta — resumen:", sErr);
      return NextResponse.json({ error: "No se pudo guardar el resumen" }, { status: 500 });
    }

    return NextResponse.json({ summary, appointment_id: appt.id }, { status: 201 });
  } catch (err) {
    console.error("trufa consulta:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
