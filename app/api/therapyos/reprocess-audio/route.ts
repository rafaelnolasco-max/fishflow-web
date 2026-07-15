import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

// ════════════════════════════════════════════════════════════════════════════
// TherapyOS — reprocess-audio
// ════════════════════════════════════════════════════════════════════════════
// Red de seguridad para grabaciones huérfanas: audios que SÍ subieron a Storage
// pero cuya transcripción falló (p. ej. la subida se cayó en el momento
// equivocado y no quedó fila en `transcriptions`).
//
//   GET  ?patient_id=...  → lista los .webm del paciente en Storage y marca
//                           cuáles ya tienen transcripción 'done' y cuáles son
//                           huérfanos (recuperables).
//   POST { patient_id, storage_path, session_date }
//                         → re-dispara el mismo pipeline de record-session
//                           (troceo ffmpeg + Whisper + borrador de sesión).
//
// No reimplementa la transcripción: reenvía a record-session para garantizar
// comportamiento idéntico al flujo normal de la grabadora.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

// ── GET ?diag=1: diagnóstico de ffmpeg en el entorno serverless ─────────────
async function ffmpegDiag() {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const mod = await import("ffmpeg-static");
  const ffmpegPath = (mod.default ?? mod) as unknown as string | null;
  const out: Record<string, unknown> = {
    ffmpegPath,
    cwd: process.cwd(),
    exists_ffmpegPath: ffmpegPath ? fs.existsSync(ffmpegPath) : false,
  };
  const candidates = [
    ffmpegPath ? path.dirname(ffmpegPath) : null,
    path.join(process.cwd(), "node_modules/ffmpeg-static"),
    "/var/task/node_modules/ffmpeg-static",
  ].filter(Boolean) as string[];
  out.dirs = candidates.map((d) => {
    try {
      return { dir: d, entries: fs.readdirSync(d) };
    } catch (e) {
      return { dir: d, error: String(e) };
    }
  });
  return out;
}

// ── GET: descubrir audios huérfanos de un paciente ──────────────────────────
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("diag") === "1") {
    return NextResponse.json(await ffmpegDiag());
  }
  const patient_id = req.nextUrl.searchParams.get("patient_id");
  if (!patient_id) {
    return NextResponse.json({ error: "Falta patient_id" }, { status: 400 });
  }

  const { data: patient, error: pErr } = await supabaseAdmin
    .from("patients")
    .select("id, client_id, full_name")
    .eq("id", patient_id)
    .single();
  if (pErr || !patient) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }

  const prefix = `${patient.client_id}/therapy_session/${patient_id}`;
  const { data: files, error: lsErr } = await supabaseAdmin.storage
    .from("audio")
    .list(prefix, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
  if (lsErr) {
    return NextResponse.json({ error: `Storage: ${lsErr.message}` }, { status: 502 });
  }

  // Transcripciones existentes de este paciente para cruzar por storage_path
  const { data: txs } = await supabaseAdmin
    .from("transcriptions")
    .select("storage_path, status")
    .eq("module", "therapy_session")
    .eq("ref_id", patient_id);
  const byPath = new Map((txs ?? []).map((t) => [t.storage_path, t.status]));

  const result = (files ?? [])
    .filter((f) => f.name.endsWith(".webm"))
    .map((f) => {
      const storage_path = `${prefix}/${f.name}`;
      const tx_status = byPath.get(storage_path) ?? null;
      return {
        storage_path,
        created_at: f.created_at,
        size_bytes: (f.metadata?.size as number) ?? null,
        tx_status, // null | 'processing' | 'error' | 'empty' | 'done'
        orphan: tx_status !== "done", // recuperable si no hay transcripción exitosa
      };
    });

  return NextResponse.json({ patient: patient.full_name, files: result });
}

// ── POST: re-disparar el pipeline sobre un audio existente ──────────────────
export async function POST(req: NextRequest) {
  const { patient_id, storage_path, session_date } = (await req.json()) as {
    patient_id?: string;
    storage_path?: string;
    session_date?: string;
  };

  if (!patient_id || !storage_path) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: patient_id, storage_path" },
      { status: 400 },
    );
  }

  // Fecha de sesión: la provista, o la del nombre del archivo, o hoy.
  const fromName = storage_path.match(/(\d{4}-\d{2}-\d{2})T/)?.[1];
  const date = session_date ?? fromName ?? new Date().toISOString().slice(0, 10);

  const res = await fetch(`${APP_URL}/api/therapyos/record-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patient_id, storage_path, session_date: date }),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
