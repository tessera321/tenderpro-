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
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function toStr(v: any): string {
  const s = String(v ?? '').trim().replace(/\n/g, ' ')
  return (s === 'null' || s === 'undefined' || s === 'nan') ? '' : s
}

function parseOferta(rows: any[][]): { items: any[], total: number, totalSmr: number } | null {
  // 1. Ищем заголовочную строку
  let headerRow = -1
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const row = rows[i] || []
    const txt = row.map((v: any) => toStr(v).toLowerCase()).join(' ')
    if (txt.includes('наименование') && txt.includes('ед') && (txt.includes('кол') || txt.includes('объем'))) {
      headerRow = i
      break
    }
  }
  if (headerRow < 0) return null

  // 2. Ищем строку ИТОГО в конце — берём итог оттуда
  let grandTotal = 0
  let grandSmr = 0
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - 20); i--) {
    const row = rows[i] || []
    const txt = row.map((v: any) => toStr(v)).join(' ').toLowerCase()
    if (txt.includes('итого') || txt.includes('всего')) {
      // Ищем самое большое число в строке как итог
      for (let j = row.length - 1; j >= 0; j--) {
        const n = toNum(row[j])
        if (n > 10000) {
          grandTotal = n
          // СМР — предыдущая колонка
          if (j > 0) grandSmr = toNum(row[j - 1])
          break
        }
      }
      if (grandTotal > 0) break
    }
  }

  // 3. Собираем позиции — строки с номером п/п
  const items: any[] = []
  const COLS = { num: 0, section: 1, name: 2, matType: 4, comment: 5, unit: 6, norm: 7, qty: 8, matP: 11, smrP: 12, totalUnit: 13, totalAll: 16 }

  // Находим реальные индексы колонок из заголовка (адаптируемся к разным файлам)
  const hRow = rows[headerRow] || []
  const hRow2 = rows[headerRow + 1] || []
  let colUnit = 6, colQty = 8, colMatP = 11, colSmrP = 12, colTotalUnit = 13, colTotalAll = 16

  for (let j = 0; j < hRow.length; j++) {
    const h = toStr(hRow[j]).toLowerCase()
    if (h.includes('ед')) colUnit = j
    if (h.includes('кол') && h.includes('общ')) colQty = j
  }
  for (let j = 0; j < hRow2.length; j++) {
    const h = toStr(hRow2[j]).toLowerCase()
    if (h === 'смр') colSmrP = j
    if (h === 'материалы' && j > 8 && colMatP === 11) colMatP = j
    if (h === 'всего' && j > colSmrP) colTotalUnit = j
  }
  colTotalAll = colTotalUnit + 3  // Итого всего = итого/ед + 3 колонки

  for (let i = headerRow + 2; i < rows.length; i++) {
    const row = rows[i] || []
    const num = toStr(row[COLS.num])
    const name = toStr(row[COLS.name])
    if (!num || !/^\d+$/.test(num) || !name) continue

    const unit = toStr(row[colUnit])
    const matType = toStr(row[COLS.matType])
    const comment = toStr(row[COLS.comment])
    const qty = toNum(row[colQty])
    const matP = toNum(row[colMatP])
    const smrP = toNum(row[colSmrP])
    const totalUnit = toNum(row[colTotalUnit])

    // Итого позиции: берём из col16 или col13*qty или col11*qty (материалы)
    let total = toNum(row[colTotalAll])
    if (!total && matType) total = matP * qty  // материал без итога
    if (!total && totalUnit) total = totalUnit * qty

    items.push({
      name: name.substring(0, 200),
      unit,
      quantity: qty,
      smr_price: smrP,
      mat_price: matP,
      total_price: totalUnit || (smrP + matP),
      total,
      comment,
      type: matType ? 'material' : 'work'
    })
  }

  if (items.length < 2) return null
  // Если не нашли итог — суммируем листовые позиции (без дублирования)
  if (!grandTotal) grandTotal = items.reduce((s, i) => s + i.total, 0)

  return { items, total: grandTotal, totalSmr: grandSmr }
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
    setResult(null); setError(''); setProgress(10); setStatus('Читаем файл...')
    try {
      const buf = await file.arrayBuffer()
      setProgress(25); setStatus('Парсим структуру...')
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false, blankrows: true }) as any[][]
      setProgress(40)

      const sb = createClient()
      const { data: profile } = await sb.from('profiles').select('org_id').single()
      if (!profile?.org_id) throw new Error('Профиль не найден')

      const tenderMeta = { title: titleVal || undefined, customer: customer || undefined, platform: platform || undefined, deadline: deadline || undefined }

      // Шаг 1: детерминированный парсер
      setStatus('Анализируем структуру таблицы...')
      const detResult = parseOferta(rows)
      let parsed: any

      if (detResult && detResult.items.length >= 2) {
        setProgress(70); setStatus(`Найдено ${detResult.items.length} позиций, сохраняем...`)
        const title = titleVal || file.name.replace(/\.[^.]+$/, '')
        const { data: tender, error: tErr } = await sb.from('tenders').insert({
          org_id: profile.org_id,
          title: title.substring(0, 200),
          customer: customer || '',
          platform: platform || null,
          deadline: deadline || null,
          status: 'new',
          total: detResult.total,
          total_smr: detResult.totalSmr,
        }).select().single()
        if (tErr) throw new Error(tErr.message)

        for (const item of detResult.items) {
          await sb.from('tender_items').insert({
            tender_id: tender.id,
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            smr_price: item.smr_price,
            total_smr: item.smr_price * item.quantity,
            total_mat: item.mat_price * item.quantity,
            total: item.total,
            section_name: item.comment || null,
          })
        }
        parsed = { title, items: detResult.items, tender_id: tender.id, parser: 'deterministic', grandTotal: detResult.total }
      } else {
        // Шаг 2: AI fallback
        setProgress(50); setStatus('Нестандартная структура — отправляем в AI...')
        const res = await fetch('https://latlduzqzoqijpvmeecb.supabase.co/functions/v1/parse-tender', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows, filename: file.name, org_id: profile.org_id, tender_meta: tenderMeta })
        })
        if (!res.ok) throw new Error(`Ошибка API: ${res.status}`)
        parsed = await res.json()
        if (parsed.error) throw new Error(parsed.error)
        if (!parsed.items?.length) throw new Error('Не удалось найти позиции в файле')
      }

      setProgress(100); setStatus('Готово!')
      setResult(parsed)
    } catch (e: any) { setError(e.message); setProgress(0); setStatus('') }
  }

  const grandTotal = result?.grandTotal || result?.items?.reduce((s: number, i: any) => s + (i.total || 0), 0) || 0

  return (
    <>
      <div className="topbar"><div className="topbar-title">Новый тендер</div></div>
      <div className="content" style={{ maxWidth: 700 }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div className="card-title">Данные тендера</div></div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <div>
              <label className="form-label">Название / объект</label>
              <input className="form-input" placeholder="ЖК Рождественка — усиление кладки" value={titleVal} onChange={e => setTitleVal(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label className="form-label">Заказчик</label><input className="form-input" placeholder="ООО ГК ФСК" value={customer} onChange={e => setCustomer(e.target.value)} /></div>
              <div>
                <label className="form-label">Площадка</label>
                <select className="form-input" value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option value="">— выбрать —</option>
                  <option>Tender.pro</option><option>САФМАР</option><option>РОСЭЛТОРГ</option><option>B2B-Center</option><option>Прямое приглашение</option>
                </select>
              </div>
            </div>
            <div><label className="form-label">Дедлайн</label><input className="form-input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></div>
          </div>
        </div>

        <div className={`upload-zone ${dragging ? 'drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}>
          <svg width="38" height="38" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--ink3)' }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div className="upload-title">Загрузите файл от заказчика</div>
          <div className="upload-sub">Любой Excel <strong>.xlsx</strong> — оферта, ведомость, РСС, смета</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
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

        {error && <div style={{ marginTop: 12, background: 'var(--red-l)', color: 'var(--red)', padding: '12px 16px', borderRadius: 'var(--r)', fontSize: 13 }}>⚠️ {error}</div>}

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
                <div><div className="stat-label">Итого (из файла)</div><div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }}>{fmt(grandTotal)}</div></div>
              </div>
              <div style={{ background: 'var(--bg)', borderRadius: 'var(--r)', padding: '12px', marginBottom: 14, maxHeight: 220, overflowY: 'auto', fontSize: 12 }}>
                {result.items?.slice(0, 12).map((item: any, i: number) => (
                  <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: 'var(--ink3)', minWidth: 20 }}>{i + 1}</span>
                    <span style={{ flex: 1 }}>{item.name?.slice(0, 55)}{item.name?.length > 55 ? '…' : ''}</span>
                    <span style={{ color: 'var(--ink3)', minWidth: 40 }}>{item.unit}</span>
                    <span style={{ color: 'var(--green)', minWidth: 90, textAlign: 'right' }}>{item.total > 0 ? fmt(item.total) : ''}</span>
                  </div>
                ))}
                {result.items?.length > 12 && <div style={{ padding: '6px 0', color: 'var(--ink3)', textAlign: 'center' }}>+ ещё {result.items.length - 12} позиций</div>}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {result.tender_id && <button className="btn btn-primary" onClick={() => router.push(`/dashboard/tenders/${result.tender_id}`)}>Открыть тендер → найти цены ✦</button>}
                <button className="btn" onClick={() => { setResult(null); setProgress(0); setStatus('') }}>Загрузить другой файл</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
