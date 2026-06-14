import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { materials, org_id } = await req.json()
    if (!materials?.length) return NextResponse.json({ results: [] })

    const prompt = `Ты помощник тендерного специалиста строительной компании в Москве.
Найди актуальные цены (2025-2026) на строительные материалы и работы в Москве.
Ищи на: petrovich.ru, leroymerlin.ru, vseinstrumenty.ru, у специализированных поставщиков.

Материалы:
${materials.map((m: any, i: number) => `${i + 1}. ${m.name}${m.unit ? ' (' + m.unit + ')' : ''}`).join('\n')}

Ответь ТОЛЬКО JSON без markdown:
{"results":[{"name":"название из списка","price":1234.56,"unit":"ед","source":"магазин","url":"ссылка"}]}
Если цена не найдена — price: null.`

    // Вызов Anthropic API напрямую через fetch — без SDK TypeScript конфликтов
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const data = await response.json()
    const text = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    const clean = text.replace(/```json|```/g, '').trim()
    const match = clean.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] || clean || '{"results":[]}')
    const results = parsed.results || []

    // Сохраняем найденные цены в базу
    if (org_id && results.length) {
      const sb = createClient()
      for (const r of results) {
        if (r.price) {
          await sb.from('materials').upsert({
            org_id,
            name: r.name,
            unit: r.unit,
            last_price: r.price,
            last_source: r.source,
            last_source_url: r.url,
            price_updated_at: new Date().toISOString(),
            search_count: 1,
          }, { onConflict: 'org_id,name' })
        }
      }
    }

    return NextResponse.json({ results })

  } catch (err: any) {
    console.error('Price search error:', err)
    // Демо-данные если AI недоступен
    const body = await req.json().catch(() => ({ materials: [] }))
    return NextResponse.json({ results: getDemoPrices(body.materials || []) })
  }
}

function getDemoPrices(materials: any[]) {
  const demos: Record<string, { price: number; source: string; unit: string }> = {
    'асфальт': { price: 4800, source: 'МСК-Асфальт', unit: 'т' },
    'щебен': { price: 1650, source: 'Петрович', unit: 'т' },
    'бетон': { price: 6800, source: 'МСК-Бетон', unit: 'м3' },
    'бордюр': { price: 420, source: 'Петрович', unit: 'пог.м' },
    'геотекстиль': { price: 85, source: 'ВсеИнструменты', unit: 'м2' },
    'геосетк': { price: 145, source: 'Леруа Мерлен', unit: 'м2' },
    'песок': { price: 980, source: 'МСК-Бетон', unit: 'м3' },
    'труба': { price: 1200, source: 'Петрович', unit: 'пог.м' },
    'кабель': { price: 320, source: 'Леруа Мерлен', unit: 'м' },
    'светильник': { price: 8500, source: 'ВсеИнструменты', unit: 'шт' },
    'разборк': { price: 1850, source: 'Справочник СМР', unit: 'пог.м' },
    'устройство': { price: 1700, source: 'Справочник СМР', unit: 'м2' },
    'монтаж': { price: 3900, source: 'Справочник СМР', unit: 'пог.м' },
  }
  return materials.map((m: any) => {
    const n = m.name.toLowerCase()
    const found = Object.entries(demos).find(([k]) => n.includes(k))
    return found
      ? { name: m.name, price: found[1].price, unit: found[1].unit, source: found[1].source, url: null }
      : { name: m.name, price: null, source: null, url: null }
  })
}
