'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import * as XLSX from 'xlsx'

function fmt(n: number) {
  if (!n) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}

function toNum(v: any): number {
  if (!v && v !== 0) return 0
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function toStr(v: any): string {
  const s = String(v ?? '').trim()
  return (s === 'null' || s === 'undefined' || s === 'nan') ? '' : s
}

// ============================================================
// ДЕТЕРМИНИРОВАННЫЙ ПАРСЕР — читает по номерам колонок
// Работает для стандартного формата оферты с колонками:
// 0=№, 1=раздел, 2=наименование, 4=тип_материала, 5=комментарий,
// 6=ед.изм, 7=норма, 8=кол-во, 10=валюта, 11=мат/ед, 12=смр/ед,
// 13=итого/ед, 14=мат_всего, 15=смр_всего, 16=итого_всего
// ============================================================
function parseOferta(rows: any[][]): { items: any[], total: number } | null {
  // Ищем строку заголовка (где есть "Наименование работ" или "№ п/п")
  let headerRow = -1
  let colMap: Record<string, number> = {}

  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const row = rows[i]
    for (let j = 0; j < row.length; j++) {
      const cell = toStr(row[j]).toLowerCase()
      if (cell.includes('наименование работ') || cell.includes('наименование вида работ')) {
        headerRow = i
        colMap.name = j
      }
      if (cell === '№ п/п') colMap.num = j
      if (cell === '№ раздела') colMap.section = j
      if (cell.includes('комментарий') && !cell.includes('участник')) colMap.comment = j
      if (cell.startsWith('ед.') || cell === 'ед. изм') colMap.unit = j
      if (cell.includes('общее кол') || cell === 'объем' || cell.includes('кол-во')) colMap.qty = j
    }
    if (headerRow >= 0) break
  }

  if (headerRow < 0) return null

  // Ищем подзаголовки (строка после заголовка с "Материалы", "СМР", "Всего")
  for (let i = headerRow + 1; i < Math.min(headerRow + 5, rows.length); i++) {
    const row = rows[i]
    for (let j = 0; j < row.length; j++) {
      const cell = toStr(row[j]).toLowerCase()
      if (cell === 'смр') colMap.smr_unit = j
      if (cell === 'всего' && !colMap.total_unit) colMap.total_unit = j
      if (cell === 'материалы' && !colMap.mat_unit) colMap.mat_unit = j
    }
  }

  // Дефолтные значения если не нашли через заголовки
  if (colMap.num === undefined) colMap.num = 0
  if (colMap.section === undefined) colMap.section = 1
  if (colMap.name === undefined) colMap.name = 2
  if (colMap.comment === undefined) colMap.comment = 5
  if (colMap.unit === undefined) colMap.unit = 6
  if (colMap.qty === undefined) colMap.qty = 8
  if (colMap.mat_unit === undefined) colMap.mat_unit = 11
  if (colMap.smr_unit === undefined) colMap.smr_unit = 12
  if (colMap.total_unit === undefined) colMap.total_unit = 13
  // Итоговые суммы
  const totalAllCol = 16

  const items: any[] = []
  let grandTotal = 0

  for (let i = headerRow + 2; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length < 3) continue

    const num = toStr(row[colMap.num])
    const name = toStr(row[colMap.name])
    const unit = toStr(row[colMap.unit])
    const comment = toStr(row[colMap.comment])

    // Позиция основной таблицы: имеет номер п/п И наименование
    const hasNum = num && /^\d+$/.test(num)
    const hasName = name.length > 2
    const hasUnit = unit.length > 0 && unit.length < 20

    if (!hasNum || !hasName) continue

    const qty = toNum(row[colMap.qty])
    const matPrice = toNum(row[colMap.mat_unit])
    const smrPrice = toNum(row[colMap.smr_unit])
    const totalPrice = toNum(row[colMap.total_unit]) || (matPrice + smrPrice)
    const totalAll = toNum(row[totalAllCol]) || (qty * totalPrice)

    // Пропускаем строки-итоги разделов (итоговая стоимость совпадает с нашим grandTotal)
    if (!hasUnit && totalAll > 1000000) continue

    items.push({
      name: name.replace(/\n/g, ' '),
      unit: hasUnit ? unit : '',
      quantity: qty,
      smr_price: smrPrice,
      mat_price: matPrice,
      total_price: totalPrice,
      total: totalAll,
      comment: comment || '',
      type: name.toLowerCase().includes('раствор') || name.toLowerCase().includes('материал') ||
            name.toLowerCase().includes('цемент') || name.toLowerCase().includes('бентонит') ||
            name.toLowerCase().includes('вода') ? 'material' : 'work'
    })

    if (totalAll > 0 && totalAll < 100_000_000) grandTotal += totalAll
  }

  return { items, total: grandTotal }
}

// ============================================================
// УНИВЕРСАЛЬНЫЙ ПАРСЕР ЧЕРЕЗ CLAUDE (fallback)
// ============================================================
async function parseViaAI(rows: any[][], filename: string, orgId: string, tenderMeta: any) {
  const allLines = rows
    .map((row: any[], i: number) => {
      const cells = (row || [])
        .map((v: any) => String(v ?? '').trim().replace(/\n/g, ' '))
        .filter((v: string) => v && v !== 'null')
        .map((v: string) => v.substring(0, 80))
      return cells.length > 0 ? `${i}|${cells.join('\t')}` : ''
    })
    .filter(Boolean)
    .join('\n')

  const res = await fetch(
    'https://latlduzqzoqijpvmeecb.supabase.co/functions/v1/parse-tender',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, filename, org_id: orgId, tender_meta: tenderMeta })
    }
  )
  if (!res.ok) throw new Error(`Ошибка API: ${res.status}`)
  return await res.json()
}

export default function ImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [titleVal, setTitleVal] = useState('')
  const [customer, setCustomer] = useState('')
  const [platform, setPlatform] = useState('')
  const [deadline, setDeadline] = useState('')

  async function processFile(file: File) {
    setResult(null)
    setError('')
    setProgress(10)
    setStatus('Читаем файл...')

    try {
      const buf = await file.arrayBuffer()
      setProgress(20)
      setStatus('Парсим структуру...')

      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, {
        header: 1, defval: null, raw: false, blankrows: true
      }) as any[][]

      setProgress(40)

      const sb = createClient()
      const { data: profile } = await sb.from('profiles').select('org_id').single()
      if (!profile?.org_id) throw new Error('Профиль не найден')

      const tenderMeta = {
        title: titleVal || undefined,
        customer: customer || undefined,
        platform: platform || undefined,
        deadline: deadline || undefined,
      }

      // ШАГ 1: пробуем детерминированный парсер
      setStatus('Анализируем структуру таблицы...')
      const detResult = parseOferta(rows)

      let parsed: any

      if (detResult && detResult.items.length >= 3) {
        // Детерминированный парсер сработал — сохраняем в базу
        setProgress(60)
        setStatus(`Найдено ${detResult.items.length} позиций, сохраняем...`)

        const title = titleVal || file.name.replace(/\.[^.]+$/, '')
        const { data: tender, error: tErr } = await sb.from('tenders').insert({
          org_id: profile.org_id,
          title: title.substring(0, 200),
          customer: customer || '',
          platform: platform || null,
          deadline: deadline || null,
          status: 'new',
          total: detResult.total,
          total_smr: detResult.items.reduce((s, i) => s + (i.smr_price || 0) * (i.quantity || 0), 0),
        }).select().single()

        if (tErr) throw new Error(tErr.message)

        for (const item of detResult.items) {
          await sb.from('tender_items').insert({
            tender_id: tender.id,
            name: item.name.substring(0, 200),
            unit: item.unit,
            quantity: item.quantity,
            smr_price: item.smr_price,
            total_smr: item.smr_price * item.quantity,
            total_mat: item.mat_price * item.quantity,
            total: item.total,
            section_name: item.comment || null,
          })
        }

        parsed = {
          title,
          items: detResult.items,
          tender_id: tender.id,
          parser: 'deterministic'
        }
      } else {
        // ШАГ 2: fallback на AI парсер
        setProgress(50)
        setStatus('Нестандартная структура — отправляем в AI...')
        parsed = await parseViaAI(rows, file.name, profile.org_id, tenderMeta)
        if (parsed.error) throw new Error(parsed.error)
        if (!parsed.items?.length) throw new Error('Не удалось найти позиции в файле')
      }

      setProgress(100)
      setStatus('Готово!')
      setResult(parsed)

    } catch (e: any) {
      setError(e.message)
      setProgress(0)
      setStatus('')
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Новый тендер</div>
      </div>
      <div className="content" style={{ maxWidth: 700 }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div className="card-title">Данные тендера</div></div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <div>
              <label className="form-label">Название / объект (необязательно — определится из файла)</label>
              <input className="form-input" placeholder="ЖК BESIDE 2.0 — дорожные покрытия" value={titleVal} onChange={e => setTitleVal(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label">Заказчик</label>
                <input className="form-input" placeholder="ООО ГК ФСК" value={customer} onChange={e => setCustomer(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Площадка</label>
                <select className="form-input" value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option value="">— выбрать —</option>
                  <option>Tender.pro</option>
                  <option>САФМАР</option>
                  <option>РОСЭЛТОРГ</option>
                  <option>B2B-Center</option>
                  <option>Прямое приглашение</option>
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Дедлайн</label>
              <input className="form-input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
            </div>
          </div>
        </div>

        <div
          className={`upload-zone ${dragging ? 'drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault(); setDragging(false)
            const f = e.dataTransfer.files[0]; if (f) processFile(f)
          }}
        >
          <svg width="38" height="38" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--ink3)' }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div className="upload-title">Загрузите файл от заказчика</div>
          <div className="upload-sub">
            Любой Excel <strong>.xlsx</strong> — ведомость работ, оферта, РСС, смета.<br/>
            Детерминированный парсер + AI как запасной вариант.
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
        </div>

        {progress > 0 && !result && !error && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{status}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{progress}%</span>
            </div>
            <div className="progress-bar"><div className="progress-fill" style={{ width: progress + '%' }} /></div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, background: 'var(--red-l)', color: 'var(--red)', padding: '12px 16px', borderRadius: 'var(--r)', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {result && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head" style={{ background: 'var(--green-l)' }}>
              <svg width="18" height="18" fill="none" stroke="var(--green)" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              <div className="card-title" style={{ color: 'var(--green)' }}>
                Тендер разобран и сохранён
                {result.parser === 'deterministic' && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 8, opacity: 0.7 }}>точный парсер</span>}
              </div>
            </div>
            <div className="card-body">
              {result.title && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--ink2)' }}><b>Объект:</b> {result.title}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>
                <div><div className="stat-label">Позиций</div><div style={{ fontSize: 24, fontWeight: 700 }}>{result.items?.length || 0}</div></div>
                <div><div className="stat-label">С ценами СМР</div><div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }}>{result.items?.filter((i: any) => (i.smr_price || 0) > 0).length || 0}</div></div>
                <div><div className="stat-label">Итого</div><div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }}>{fmt(result.items?.reduce((s: number, i: any) => s + (i.total || 0), 0) || 0)}</div></div>
              </div>
              <div style={{ background: 'var(--bg)', borderRadius: 'var(--r)', padding: '12px', marginBottom: 14, maxHeight: 200, overflowY: 'auto', fontSize: 12 }}>
                {result.items?.slice(0, 10).map((item: any, i: number) => (
                  <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--ink3)', minWidth: 20 }}>{i + 1}</span>
                    <span style={{ flex: 1 }}>{item.name?.slice(0, 60)}{item.name?.length > 60 ? '…' : ''}</span>
                    <span style={{ color: 'var(--ink3)' }}>{item.unit}</span>
                    <span style={{ color: 'var(--ink3)', minWidth: 40 }}>{item.quantity}</span>
                    <span style={{ color: 'var(--green)', minWidth: 80, textAlign: 'right' }}>{item.total > 0 ? fmt(item.total) : ''}</span>
                  </div>
                ))}
                {result.items?.length > 10 && <div style={{ padding: '6px 0', color: 'var(--ink3)', textAlign: 'center' }}>+ ещё {result.items.length - 10} позиций</div>}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {result.tender_id && (
                  <button className="btn btn-primary" onClick={() => router.push(`/dashboard/tenders/${result.tender_id}`)}>
                    Открыть тендер → найти цены ✦
                  </button>
                )}
                <button className="btn" onClick={() => { setResult(null); setProgress(0); setStatus('') }}>Загрузить другой файл</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
