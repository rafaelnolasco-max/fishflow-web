import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";

// ════════════════════════════════════════════════════════════════════════════
// HireFlow — parse-cv
// ════════════════════════════════════════════════════════════════════════════
// Recibe un CV (PDF o Word .docx) en base64 → extrae el texto plano:
//   · PDF  → unpdf (pdf.js, serverless-friendly)
//   · DOCX → jszip (un .docx es un zip; leemos word/document.xml)
// Además, best-effort, usa Claude para extraer nombre/email/teléfono/LinkedIn
// y así prellenar el formulario del candidato. Si la IA falla, igual regresa el texto.

export const runtime = "nodejs";
export const maxDuration = 60;

const HIRING_MODEL = "claude-sonnet-4-6";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");
}

async function extractDocx(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("DOCX inválido: falta word/document.xml");
  let xml = await file.async("string");
  xml = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "");
  const text = decodeEntities(xml)
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

async function extractPdf(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const result = await extractText(pdf, { mergePages: true });
  const text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  return (text ?? "").trim();
}

async function extractFields(cvText: string): Promise<Record<string, string> | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HIRING_MODEL,
        max_tokens: 400,
        system: "Extraes datos de contacto de un CV. Respondes ÚNICAMENTE con JSON válido, sin markdown.",
        messages: [{ role: "user", content:
          `Del siguiente CV extrae los datos de contacto. Devuelve JSON con EXACTAMENTE estas claves (usa "" si no aparece):
{"full_name":"","email":"","phone":"","linkedin":""}

CV:
${cvText.slice(0, 6000)}` }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content: Array<{ text: string }> };
    const raw = (data.content?.[0]?.text ?? "").replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(raw) as Record<string, string>;
    return {
      full_name: parsed.full_name ?? "",
      email: parsed.email ?? "",
      phone: parsed.phone ?? "",
      linkedin: parsed.linkedin ?? "",
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { filename, mime, dataBase64 } = (await req.json()) as {
      filename?: string; mime?: string; dataBase64?: string;
    };
    if (!dataBase64) {
      return NextResponse.json({ error: "Falta el archivo (dataBase64)" }, { status: 400 });
    }

    const buf = Buffer.from(dataBase64, "base64");
    const name = (filename ?? "").toLowerCase();
    const isPdf = name.endsWith(".pdf") || mime === "application/pdf";
    const isDocx = name.endsWith(".docx") || (mime ?? "").includes("wordprocessingml");

    let text = "";
    if (isPdf) {
      text = await extractPdf(buf);
    } else if (isDocx) {
      text = await extractDocx(buf);
    } else {
      return NextResponse.json({ error: "Formato no soportado. Sube un PDF o un Word (.docx)." }, { status: 415 });
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "No se pudo extraer texto del archivo (¿es un PDF escaneado sin texto?)" }, { status: 422 });
    }

    const fields = await extractFields(text);
    return NextResponse.json({ text, fields }, { status: 200 });
  } catch (err) {
    console.error("hireflow/parse-cv error:", err);
    return NextResponse.json({ error: "No se pudo procesar el archivo" }, { status: 500 });
  }
}
