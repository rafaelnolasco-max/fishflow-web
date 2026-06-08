// ════════════════════════════════════════════════════════════════════════════
// FishFlow — transcribe-audio (Edge Function GENÉRICA, agnóstica al cliente)
// ════════════════════════════════════════════════════════════════════════════
// Servicio de transcripción compartido multi-tenant. NO conoce TherapyOS, Sparc
// ni ningún módulo: recibe audio en Storage, lo transcribe con Whisper, guarda
// en la tabla `transcriptions` y (opcional) avisa al módulo vía callback_url.
//
// POST body:
//   { client_id, module, storage_path,            // requeridos
//     ref_id?, storage_bucket='audio', filename?,  // opcionales
//     transcription_id?, language='es', callback_url? }
//
// El que decide qué hacer con el texto es el módulo (en su callback). Aquí solo
// se transcribe. Así cualquier cliente futuro reusa lo mismo sin tocar esto.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { transcribeAudio } from "../_shared/transcribe.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json();
    const {
      transcription_id,
      client_id,
      module,
      ref_id,
      storage_bucket = "audio",
      storage_path,
      filename,
      language = "es",
      callback_url,
    } = body ?? {};

    if (!client_id || !module || !storage_path) {
      return json({ error: "Faltan client_id, module o storage_path" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return json({ error: "OPENAI_API_KEY no configurada en el Edge Function" }, 500);
    }

    // ── 1) Fila de transcripción: reusar o crear ──────────────────────────────
    let txId: string | undefined = transcription_id;
    if (!txId) {
      const { data, error } = await supabase
        .from("transcriptions")
        .insert({
          client_id,
          module,
          ref_id: ref_id ?? null,
          source_type: "recorder",
          storage_bucket,
          storage_path,
          status: "processing",
          language,
        })
        .select("id")
        .single();
      if (error) return json({ error: `No se pudo crear transcription: ${error.message}` }, 500);
      txId = data.id as string;
    } else {
      await supabase
        .from("transcriptions")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", txId);
    }

    // ── 2) Descargar audio de Storage ─────────────────────────────────────────
    const { data: file, error: dlErr } = await supabase.storage
      .from(storage_bucket)
      .download(storage_path);

    if (dlErr || !file) {
      const msg = `Storage: ${dlErr?.message ?? "sin datos"}`;
      await supabase.from("transcriptions")
        .update({ status: "error", error: msg, updated_at: new Date().toISOString() })
        .eq("id", txId);
      return json({ error: msg, transcription_id: txId }, 502);
    }

    // ── 3) Transcribir ────────────────────────────────────────────────────────
    const name = filename ?? storage_path.split("/").pop() ?? "audio.webm";
    const { transcript, error: wErr } = await transcribeAudio(
      await file.arrayBuffer(),
      name,
      openaiKey,
      language,
    );

    if (wErr || !transcript) {
      const msg = wErr ?? "Whisper devolvió texto vacío";
      await supabase.from("transcriptions")
        .update({ status: "error", error: msg, updated_at: new Date().toISOString() })
        .eq("id", txId);
      return json({ error: msg, transcription_id: txId }, 502);
    }

    // ── 4) Guardar transcripción ──────────────────────────────────────────────
    await supabase.from("transcriptions")
      .update({ status: "done", transcript, updated_at: new Date().toISOString() })
      .eq("id", txId);

    // ── 5) Callback opcional — el módulo decide qué hacer con el texto ─────────
    let callback_result: unknown = null;
    if (callback_url) {
      try {
        const r = await fetch(callback_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ transcription_id: txId, client_id, module, ref_id, transcript }),
        });
        callback_result = { status: r.status };
      } catch (e) {
        callback_result = { error: String(e) };
      }
    }

    return json({ transcription_id: txId, status: "done", transcript, callback_result }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
