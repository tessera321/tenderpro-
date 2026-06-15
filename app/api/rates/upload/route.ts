import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File
    const orgId = form.get('org_id') as string

    if (!file || !orgId) {
      return NextResponse.json({ success: false, error: 'Нет файла или org_id' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Файл пустой или не распознан' })
    }

    // Auto-detect column mapping by header names
    const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim())

    function findCol(keys: string[]): string | null {
      for (const key of keys) {
        const found = Object.keys(rows[0]).find(h => h.toLowerCase().includes(key))
        if (found) return found
      }
      return null
    }

    const nameCol = findCol(['наименование', 'название', 'позиция', 'материал', 'name', 'item', 'description'])
    const unitCol = findCol(['ед', 'единица', 'unit', 'мера'])
    const priceCol = findCol(['цена', 'стоимость', 'price', 'cost', 'руб'])
    const catCol = findCol(['категория', 'раздел', 'группа', 'category', 'section'])

    const items = rows
      .map(row => ({
        org_id: orgId,
        name: nameCol ? String(row[nameCol]).trim() : '',
        unit: unitCol ? String(row[unitCol]).trim() : '',
        price: priceCol ? parseFloat(String(row[priceCol]).replace(/[^\d.]/g, '')) || null : null,
        category: catCol ? String(row[catCol]).trim() : '',
        source: file.name,
      }))
      .filter(item => item.name && item.name.length > 1)

    if (items.length === 0) {
      return NextResponse.json({ success: false, error: 'Не удалось распознать позиции. Проверьте заголовки столбцов.' })
    }

    const { error } = await sb.from('price_list_items').insert(items)
    if (error) return NextResponse.json({ success: false, error: error.message })

    return NextResponse.json({ success: true, count: items.length })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Ошибка сервера'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
