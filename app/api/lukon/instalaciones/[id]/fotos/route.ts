// POST   /api/lukon/instalaciones/[id]/fotos   multipart: file, stage, kind  → sube una foto
// DELETE /api/lukon/instalaciones/[id]/fotos?photo=<uuid>                   → borra una foto (solo en curso)
// La pestaña comprime a ~1600 px JPEG antes de subir (cabe en el límite de 4.5 MB de Vercel).

import { NextRequest, NextResponse } from "next/server";
import { requireClientAccess } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { LUKON_ID, BUCKET, PHOTO_STEPS, signPhotos } from "@/lib/installations";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireClientAccess(LUKON_ID);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: inst } = await db.from("telematica_installations").select("id, client_id, status").eq("id", id).eq("client_id", LUKON_ID).maybeSingle();
  if (!inst) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  if (!["programada", "en_sitio"].includes(inst.status)) return NextResponse.json({ error: "La orden ya está cerrada; no se pueden agregar fotos" }, { status: 400 });

  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  const stage = String(fd?.get("stage") ?? "");
  const kind = String(fd?.get("kind") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta la foto" }, { status: 400 });
  if (!PHOTO_STEPS.some(s => s.stage === stage && s.kind === kind)) return NextResponse.json({ error: "Tipo de foto inválido" }, { status: 400 });
  if (!/^image\//.test(file.type)) return NextResponse.json({ error: "El archivo no es una imagen" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "La foto pesa más de 8 MB" }, { status: 400 });

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `lukon/${id}/${stage}-${kind}-${Date.now()}.${ext}`;
  const up = await db.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  const { data, error } = await db.from("telematica_installation_photos")
    .insert({ installation_id: id, client_id: inst.client_id, stage, kind, path, created_by: auth.email })
    .select("id, stage, kind, path, created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const [signed] = await signPhotos(db, [data]);
  return NextResponse.json({ photo: signed });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireClientAccess(LUKON_ID);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const photoId = req.nextUrl.searchParams.get("photo");
  const db = supabaseAdmin();
  const { data: inst } = await db.from("telematica_installations").select("status").eq("id", id).eq("client_id", LUKON_ID).maybeSingle();
  if (!inst) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  if (!["programada", "en_sitio"].includes(inst.status)) return NextResponse.json({ error: "La orden ya está cerrada" }, { status: 400 });
  const { data: ph } = await db.from("telematica_installation_photos").select("id, path").eq("id", photoId ?? "").eq("installation_id", id).maybeSingle();
  if (!ph) return NextResponse.json({ error: "Foto no encontrada" }, { status: 404 });
  await db.storage.from(BUCKET).remove([ph.path]);
  const { error } = await db.from("telematica_installation_photos").delete().eq("id", ph.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
