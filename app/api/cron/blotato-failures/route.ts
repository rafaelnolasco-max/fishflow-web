import { NextResponse } from 'next/server'
import { syncFailedPosts } from '@/lib/failedPostsSync'

export const runtime = 'nodejs'
export const maxDuration = 60

// Detección + alerta + reintento de publicaciones fallidas de Blotato.
// Lo dispara el cron de Vercel cada 5 minutos (ver vercel.json).
//
// Mismo candado que /api/cron/enlace-digest: si CRON_SECRET está configurado,
// se exige el header Authorization que Vercel manda solo.

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  }

  const resultado = await syncFailedPosts()
  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 500 })
}
