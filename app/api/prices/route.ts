import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    
    // Вызываем Supabase Edge Function
    const res = await fetch(
      'https://latlduzqzoqijpvmeecb.supabase.co/functions/v1/search-prices',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    
    const data = await res.json()
    return NextResponse.json(data)
    
  } catch (err: any) {
    console.error('Price proxy error:', err)
    return NextResponse.json({ results: [] })
  }
}
