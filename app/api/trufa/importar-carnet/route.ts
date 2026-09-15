import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  IMPORTAR_MODEL, IMPORTAR_SYSTEM_PROMPT, buildImportarPrompt, parseCarnet, contar,
} from "@/lib/importarCarnet";

// ════════════════════════════════════════════════════════════════════════════
// Trufa — importar un carnet de papel
// ════════════════════════════════════════════════════════════════════════════
// Recibe las fotos del carnet en base64 y devuelve un BORRADOR estructurado.
// NO ESCRIBE NADA EN LA BASE, a propósito: quien guarda es la pantalla de
// revisión, después de que una persona confirmó. Un lote mal leído que entra
// solo al historial no se vuelve a cuestionar nunca.

export const runtime = "nodejs";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

const CLAUDE_TIMEOUT_MS = 240_000;
const MAX_IMAGENES = 8;
const MAX_BYTES_TOTAL = 3.5 * 1024 * 1024; // el cuerpo de una ruta de Vercel topa en 4.5 MB

type Imagen = { media_type: string; data: string };

async function esDueno(petId: string, userId: string, email: string | undefined): Promise<boolean> {
  const { data: pet } = await supabaseAdmin
    .from("vet_pets").select("id, owner_user_id").eq("id", petId).maybeSingle();
  if (!pet) return false;
  if (pet.owner_user_id === userId) return true;
  const { data: link } = await supabaseAdmin
    .from("vet_pet_owners").select("id").eq("pet_id", petId)
    .or(`user_id.eq.${userId}${email ? `,email.ilike.${email}` : ""}`).maybeSingle();
  return !!link;
}

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { pet_id, imagenes } = (await req.json()) as { pet_id?: string; imagenes: Imagen[] };

    // pet_id es opcional: al dar de alta una mascota nueva todavía no existe la
    // fila, y la lectura del carnet es justo lo que la va a llenar.
    if (pet_id && !(await esDueno(pet_id, user.id, user.email))) {
      return NextResponse.json({ error: "Sin acceso a esta mascota" }, { status: 403 });
    }

    if (!Array.isArray(imagenes) || imagenes.length === 0) {
      return NextResponse.json({ error: "No llegó ninguna foto" }, { status: 400 });
    }
    if (imagenes.length > MAX_IMAGENES) {
      return NextResponse.json(
        { error: `Máximo ${MAX_IMAGENES} fotos por vez. Mándalas en tandas.` }, { status: 413 },
      );
    }
    const bytes = imagenes.reduce((n, i) => n + (i.data?.length ?? 0), 0) * 0.75;
    if (bytes > MAX_BYTES_TOTAL) {
      return NextResponse.json(
        { error: "Las fotos pesan demasiado juntas. Mándalas en tandas más chicas." }, { status: 413 },
      );
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
    }

    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

    const contenido = [
      ...imagenes.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.media_type || "image/jpeg", data: img.data },
      })),
      { type: "text" as const, text: buildImportarPrompt(hoy) },
    ];

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: IMPORTAR_MODEL,
          max_tokens: 8000,
          system: IMPORTAR_SYSTEM_PROMPT,
          messages: [{ role: "user", content: contenido }],
        }),
      });
    } catch (e) {
      console.error("importar-carnet — timeout:", e);
      return NextResponse.json(
        { error: "La lectura tardó demasiado. Intenta con menos fotos por tanda." }, { status: 504 },
      );
    }

    if (!res.ok) {
      console.error("importar-carnet — Claude:", (await res.text()).slice(0, 500));
      return NextResponse.json({ error: "No se pudo leer el carnet" }, { status: 502 });
    }

    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    const texto = data.content?.find((c) => c.type === "text")?.text ?? "";
    const carnet = parseCarnet(texto, hoy);
    if (!carnet) {
      return NextResponse.json({ error: "La lectura no se pudo interpretar" }, { status: 422 });
    }

    return NextResponse.json({ carnet, registros: contar(carnet) }, { status: 200 });
  } catch (err) {
    console.error("importar-carnet:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
