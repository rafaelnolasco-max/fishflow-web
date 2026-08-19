import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireClientAccess } from "@/lib/apiAuth";
import { transcribeStoredAudio, deleteStoredAudio } from "@/lib/sessionPipeline";
import { buildTherapyFlowPrompt, THERAPY_FLOW_SYSTEM, type TherapyFlowHistory } from "@/lib/therapyFlowPrompt";

export const runtime = "nodejs"; // ffmpeg requiere runtime Node, no edge
export const maxDuration = 800;  // transcripción + IA en sesiones de ~1 h

// ════════════════════════════════════════════════════════════════════════════
// Therapy Flow — upload-session
// ════════════════════════════════════════════════════════════════════════════
// El paciente sube el audio de SU sesión (normalmente el .m4a de Notas de Voz)
// y aquí se convierte en su expediente personal:
//   1. candado de acceso + cuota del mes
//   2. transcripción (lib/sessionPipeline: streaming + transcode en una pasada)
//   3. las dos lecturas con Claude (lib/therapyFlowPrompt, NO el de TherapyOS)
//   4. se guarda la sesión y se borra el audio original
//
// A diferencia de TherapyOS, aquí no hay paso de aprobación: el dueño del
// expediente es quien lo lee.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MODEL = "claude-sonnet-4-6";

type Config = {
  client_id: string;
  keep_audio: boolean;
  audio_retention_days: number;
  monthly_session_cap: number;
  max_minutes_session: number;
  sessions_used_month: number;
  month_anchor: string;
};

/** Primer día del mes actual en CDMX (UTC-6 fijo, sin horario de verano). */
function currentMonthAnchor(): string {
  const cdmx = new Date(Date.now() - 6 * 60 * 60 * 1000);
  return `${cdmx.getUTCFullYear()}-${String(cdmx.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function POST(req: NextRequest) {
  try {
    const { patient_id, storage_path, session_date, duration_seconds, mood_before } =
      (await req.json()) as {
        patient_id: string;
        storage_path: string;
        session_date: string;
        duration_seconds?: number;
        mood_before?: number;
      };

    if (!patient_id || !storage_path || !session_date) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: patient_id, storage_path, session_date" },
        { status: 400 },
      );
    }

    // ── 1. Paciente → client_id, y que sea un expediente autogestionado ───────
    const { data: patient, error: pErr } = await supabaseAdmin
      .from("patients")
      .select("id, client_id, self_managed")
      .eq("id", patient_id)
      .single();
    if (pErr || !patient) {
      return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
    }
    if (!patient.self_managed) {
      // Un expediente de TherapyOS no entra por aquí: ese flujo es del terapeuta.
      return NextResponse.json({ error: "Este expediente no es autogestionado" }, { status: 403 });
    }

    const auth = await requireClientAccess(patient.client_id);
    if (!auth.ok) return auth.response;

    // ── 2. Cuota del mes ──────────────────────────────────────────────────────
    const { data: cfgRow } = await supabaseAdmin
      .from("therapy_self_config")
      .select("client_id, keep_audio, audio_retention_days, monthly_session_cap, max_minutes_session, sessions_used_month, month_anchor")
      .eq("client_id", patient.client_id)
      .single();
    const cfg = cfgRow as Config | null;
    if (!cfg) {
      return NextResponse.json({ error: "Cuenta sin configurar" }, { status: 409 });
    }

    const anchor = currentMonthAnchor();
    // Si cambió el mes, el contador arranca de cero antes de validar.
    const usedThisMonth = cfg.month_anchor === anchor ? cfg.sessions_used_month : 0;

    if (usedThisMonth >= cfg.monthly_session_cap) {
      await deleteStoredAudio("audio", storage_path);
      return NextResponse.json(
        {
          error: `Llegaste al límite de ${cfg.monthly_session_cap} sesiones este mes. Se renueva el día 1.`,
          quota: true,
        },
        { status: 429 },
      );
    }

    if (typeof duration_seconds === "number") {
      if (duration_seconds < 60) {
        await deleteStoredAudio("audio", storage_path);
        return NextResponse.json(
          { error: "La grabación es demasiado corta para ser una sesión." },
          { status: 422 },
        );
      }
      if (duration_seconds > cfg.max_minutes_session * 60) {
        await deleteStoredAudio("audio", storage_path);
        return NextResponse.json(
          { error: `La grabación pasa de ${cfg.max_minutes_session} minutos. Súbela recortada.` },
          { status: 413 },
        );
      }
    }

    // ── 3. Transcribir ────────────────────────────────────────────────────────
    const tx = await transcribeStoredAudio({
      clientId: patient.client_id,
      module: "therapy_self",
      refId: patient_id,
      storagePath: storage_path,
      sourceType: "upload",
      language: "es",
    });

    if (!tx.ok) {
      await deleteStoredAudio("audio", storage_path);
      if (tx.reason === "empty") {
        return NextResponse.json(
          {
            error: "No se escuchó voz en el archivo. Revisa que sea la grabación correcta y que el micrófono haya captado audio.",
            empty: true,
          },
          { status: 422 },
        );
      }
      return NextResponse.json({ error: `No se pudo transcribir: ${tx.message}` }, { status: 502 });
    }

    // ── 4. Historial para dar continuidad ─────────────────────────────────────
    const { data: history } = await supabaseAdmin
      .from("sessions")
      .select("session_number, session_date, session_title, clinical_read, commitments, patterns_detected, session_prep")
      .eq("patient_id", patient_id)
      .order("session_date", { ascending: false })
      .limit(3);

    // ── 5. Las dos lecturas ───────────────────────────────────────────────────
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
    }

    // El default del SDK son 10 min con 2 reintentos: eso es lo que cuelga la
    // página. Aquí el corte es explícito.
    const ac = new AbortController();
    const killer = setTimeout(() => ac.abort(), 240_000);
    let raw = "";
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          system: THERAPY_FLOW_SYSTEM,
          messages: [
            {
              role: "user",
              content: buildTherapyFlowPrompt(tx.transcript, (history ?? []) as TherapyFlowHistory[]),
            },
          ],
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        console.error("Claude API error:", detail.slice(0, 500));
        return NextResponse.json({ error: "Error al generar tus notas" }, { status: 502 });
      }
      const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
      raw = data.content?.[0]?.text ?? "";
    } finally {
      clearTimeout(killer);
    }

    let parsed: Record<string, unknown>;
    try {
      // Claude a veces incluye markdown fences — las removemos
      const clean = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error("terapia upload-session: JSON inválido de Claude:", e, raw.slice(0, 400));
      return NextResponse.json({ error: "Las notas llegaron en un formato inesperado" }, { status: 502 });
    }

    // ── 6. Guardar la sesión ──────────────────────────────────────────────────
    const retentionMs = cfg.audio_retention_days * 24 * 60 * 60 * 1000;
    const { data: session, error: sErr } = await supabaseAdmin
      .from("sessions")
      .insert({
        patient_id,
        client_id: patient.client_id,
        session_date,
        source_type: "self_upload",
        transcript: tx.transcript,
        transcription_id: tx.transcriptionId,
        raw_summary: parsed,
        session_title: parsed.session_title ?? null,
        patient_summary: parsed.patient_summary ?? null,
        clinical_read: parsed.clinical_read ?? null,
        session_prep: parsed.session_prep ?? null,
        emotional_state: parsed.emotional_state ?? null,
        commitments: parsed.commitments ?? [],
        patterns_detected: parsed.patterns_detected ?? [],
        topics: parsed.topics ?? [],
        connections_to_prev: parsed.connections_to_prev ?? null,
        risk_flags: parsed.risk_flags ?? [],
        mood_before: typeof mood_before === "number" ? mood_before : null,
        ai_processed: true,
        // Si el usuario decidió conservar el audio, lo guardamos con fecha de
        // caducidad. El default de la cuenta es no conservarlo.
        audio_path: cfg.keep_audio ? storage_path : null,
        audio_delete_at: cfg.keep_audio ? new Date(Date.now() + retentionMs).toISOString() : null,
      })
      .select()
      .single();

    if (sErr || !session) {
      console.error("terapia upload-session insert:", sErr);
      return NextResponse.json({ error: "No se pudo guardar la sesión" }, { status: 500 });
    }

    // ── 7. El audio original se va salvo que el usuario pida conservarlo ──────
    if (!cfg.keep_audio) await deleteStoredAudio("audio", storage_path);

    // ── 8. Contador del mes ───────────────────────────────────────────────────
    const { error: cErr } = await supabaseAdmin
      .from("therapy_self_config")
      .update({ sessions_used_month: usedThisMonth + 1, month_anchor: anchor })
      .eq("client_id", patient.client_id);
    if (cErr) console.error("terapia upload-session cuota:", cErr);

    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    console.error("terapia upload-session error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
