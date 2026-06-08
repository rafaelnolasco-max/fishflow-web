// ════════════════════════════════════════════════════════════════════════════
// FishFlow — Núcleo de transcripción Whisper (COMPARTIDO, agnóstico al cliente)
// ════════════════════════════════════════════════════════════════════════════
// Única fuente de verdad para transcribir audio con OpenAI Whisper.
// No sabe de ningún cliente ni módulo: recibe un buffer y devuelve texto.
// Lo consumen: transcribe-audio (genérico). Sparc se migra aquí en el futuro.
//
// Modelo whisper-1 (~$0.006 USD/min). Acepta webm, mp4, m4a, ogg, mp3, wav.
// .opus/.oga se renombran a .ogg (mismo códec Opus en contenedor OGG).

export const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";

export async function transcribeAudio(
  audioBuffer: ArrayBuffer,
  filename: string,
  openaiKey: string,
  language = "es",
): Promise<{ transcript: string; error?: string }> {
  const safeName = filename.replace(/\.opus$/i, ".ogg").replace(/\.oga$/i, ".ogg");

  const formData = new FormData();
  // Sin forzar MIME: Whisper infiere el formato por la extensión del nombre.
  formData.append("file", new Blob([audioBuffer]), safeName);
  formData.append("model", "whisper-1");
  formData.append("language", language);

  const res = await fetch(WHISPER_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    return { transcript: "", error: `HTTP ${res.status}: ${errText.substring(0, 300)}` };
  }

  const text = (await res.json()).text?.trim() ?? "";
  return { transcript: text };
}
