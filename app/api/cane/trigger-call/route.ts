import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { appointment_id } = await req.json()

  if (!appointment_id) {
    return NextResponse.json({ error: 'appointment_id requerido' }, { status: 400 })
  }

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/trigger-appointment-call`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointment_id }),
    }
  )

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
