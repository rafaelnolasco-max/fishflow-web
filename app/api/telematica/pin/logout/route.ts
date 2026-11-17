// POST /api/telematica/pin/logout  { slug } — borra la sesión por NIP de este dispositivo.
import { NextRequest, NextResponse } from "next/server";
import { pinCookieName } from "@/lib/pinAccess";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(pinCookieName(String(body.slug ?? "")), "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
