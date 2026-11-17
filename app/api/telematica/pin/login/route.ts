// POST /api/telematica/pin/login  { slug, pin }
// Revisa el NIP de /flotilla/<slug> y deja la cookie de sesión de solo lectura.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { makePinToken, pinCookieName, PIN_SESSION_DAYS } from "@/lib/pinAccess";

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug ?? "").toLowerCase();
  const pin = String(body.pin ?? "").replace(/\D/g, "");
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return NextResponse.json({ error: "Liga inválida" }, { status: 400 });
  if (pin.length !== 6) return NextResponse.json({ error: "El NIP es de 6 dígitos" }, { status: 400 });

  const { data, error } = await supabaseAdmin().rpc("telematica_pin_check", { p_slug: slug, p_pin: pin });
  if (error) return NextResponse.json({ error: "No se pudo revisar el NIP. Intenta de nuevo." }, { status: 500 });
  const r = (data ?? [])[0] as
    | { status: string; access_id: string; session_version: number; expires_at: string; locked_until: string | null }
    | undefined;

  switch (r?.status) {
    case "ok": break;
    case "incorrecto": return NextResponse.json({ error: "NIP incorrecto" }, { status: 401 });
    case "bloqueado": return NextResponse.json({ error: `Demasiados intentos. Vuelve a intentar después de las ${fmtHora(r.locked_until!)}.` }, { status: 429 });
    case "vencido": return NextResponse.json({ error: "Este acceso temporal ya venció. Pide uno nuevo a LUKON." }, { status: 403 });
    default: return NextResponse.json({ error: "Liga inválida" }, { status: 404 });
  }

  const exp = Math.min(Date.now() + PIN_SESSION_DAYS * 864e5, new Date(r.expires_at).getTime());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(pinCookieName(slug), makePinToken(r.access_id, r.session_version, Math.floor(exp / 1000)), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: new Date(exp),
  });
  return res;
}
