'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import * as XLSX from 'xlsx'

function cv(v: any) { return (v == null || String(v).trim() === '' || String(v) === 'nan') ? null : String(v).trim() }
function tn(v: any) { const n = parseFloat(v); return isNaN(n) ? 0 : n }

function fmt(n: number) {
  if (!n) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}

function parseVedomost(rows: any[][], filename: string) {
  let title = '', customer = ''
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const line = rows[i].filter(v => v).join(' ')
    if (/предмет тендера/i.test(line)) title = line.replace(/предмет тендера:\s*/i, '').trim().slice(0, 200)
    if (/^объект:/i.test(line.trim())) customer = line.replace(/объект:\s*/i, '').trim()
  }
  const sections: any[] = []; let curSec: any = null, curItem: any = null
  for (const row of rows) {
    const num = cv(row[0]), secNum = cv(row[1]), code = cv(row[2]), name = cv(row[3])
    const matType = cv(row[4]), unit = cv(row[6])
    const qty = tn(row[9]), prSmr = tn(row[12]), totSmr = tn(row[15]), totAll = tn(row[16])
    if (!name || !num) continue
    if (/итого/i.test(name)) continue
    const isCustMat = matType && /поставка заказчика/i.test(matType)
    const isSection = secNum && !code && !unit && totAll > 0 && !matType
    const isWork = unit && !isCustMat && (prSmr > 0 || totSmr > 0)
    if (isSection) {
      curSec = { number: secNum, name, items: [], total_smr: tn(row[15]), total_mat: tn(row[14]), total: totAll }
      sections.push(curSec); curItem = null
    } else if (isWork) {
      if (!curSec) { curSec = { number: '0', name: 'Основные работы', items: [], total_smr: 0, total_mat: 0, total: 0 }; sections.push(curSec) }
      curItem = { number: num, name, unit, quantity: qty, smr_price: prSmr, total_smr: totSmr, total_mat: tn(row[14]), total: totAll, materials: [] }
      curSec.items.push(curItem)
    } else if (!isCustMat && unit && curItem && !isSection && !isWork) {
      curItem.materials.push({ name, unit, quantity: qty, is_customer_supply: false })
    }
  }
  const vs = sections.filter(s => s.items?.length > 0)
  const allItems = vs.flatMap((s: any) => s.items)
  return {
    title: title || filename.replace(/\.xlsx?/, ''),
    customer,
    sections: vs,
    totals: {
      sections: vs.length,
      items: allItems.length,
      total_smr: vs.reduce((a: number, s: any) => a + (s.total_smr || 0), 0),
      total: vs.reduce((a: number, s: any) => a + (s.total || 0), 0),
    }
  }
}

export default function ImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<any>(null)
  const [titleVal, setTitleVal] = useState('')
  const [customer, setCustomer] = useState('')
  const [platform, setPlatform] = useState('')
  const [deadline, setDeadline] = useState('')

  async function processFile(file: File) {
    setResult(null)
    setProgress(10); setStatus('Читаем файл...')
    const buf = await file.arrayBuffer()
    setProgress(30); setStatus('Парсим структуру...')
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][]
    setProgress(60); setStatus('Распознаём работы...')
    const parsed = parseVedomost(rows, file.name)
    if (titleVal) parsed.title = titleVal
    if (customer) parsed.customer = customer
    setProgress(80); setStatus('Сохраняем в базу...')
    const id = await saveTender(parsed)
    setProgress(100); setStatus('Готово!')
    setResult({ ...parsed, id })
  }

  async function saveTender(parsed: any) {
    const sb = createClient()
    const { data: profile } = await sb.from('profiles').select('org_id').single()
    if (!profile?.org_id) throw new Error('Профиль не найден')

    const { data: tender } = await sb.from('tenders').insert({
      org_id: profile.org_id,
      title: parsed.title,
      customer: parsed.customer || customer,
      platform: platform || null,
      deadline: deadline || null,
      status: 'new',
      total: parsed.totals.total,
      total_smr: parsed.totals.total_smr,
    }).select().single()
    if (!tender) throw new Error('Ошибка создания тендера')

    for (const section of parsed.sections) {
      for (const item of section.items) {
        const { data: si } = await sb.from('tender_items').insert({
          tender_id: tender.id,
          section_number: section.number,
          section_name: section.name,
          item_number: item.number,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          smr_price: item.smr_price,
          total_smr: item.total_smr,
          total_mat: item.total_mat,
          total: item.total,
        }).select().single()
        if (si && item.materials?.length) {
          await sb.from('tender_item_materials').insert(
            item.materials.map((m: any) => ({
              tender_id: tender.id,
              item_id: si.id,
              name: m.name,
              unit: m.unit,
              quantity: m.quantity,
              is_customer_supply: false,
              price_status: 'pending',
            }))
          )
        }
      }
    }
    return tender.id
  }

  return (
    <>
      <div className="topbar"><div className="topbar-title">Новый тендер</div></div>
      <div className="content" style={{ maxWidth: 700 }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div className="card-title">Данные тендера</div></div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <div>
              <label className="form-label">Название / объект</label>
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
                  <option>Tender.pro</option><option>САФМАР</option>
                  <option>РОСЭЛТОРГ</option><option>B2B-Center</option>
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
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
        >
          <svg width="38" height="38" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--ink3)' }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div className="upload-title">Загрузите ведомость работ или РСС</div>
          <div className="upload-sub">Excel <strong>.xlsx</strong> — разберём автоматически</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
        </div>

        {progress > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{status}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{progress}%</span>
            </div>
            <div className="progress-bar"><div className="progress-fill" style={{ width: progress + '%' }} /></div>
          </div>
        )}

        {result && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head" style={{ background: 'var(--green-l)' }}>
              <svg width="18" height="18" fill="none" stroke="var(--green)" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              <div className="card-title" style={{ color: 'var(--green)' }}>Тендер сохранён в базе данных</div>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
                <div><div className="stat-label">Разделов</div><div style={{ fontSize: 20, fontWeight: 650 }}>{result.totals.sections}</div></div>
                <div><div className="stat-label">Позиций</div><div style={{ fontSize: 20, fontWeight: 650 }}>{result.totals.items}</div></div>
                <div><div className="stat-label">Итого</div><div style={{ fontSize: 20, fontWeight: 650, color: 'var(--green)' }}>{fmt(result.totals.total)}</div></div>
              </div>
              <button className="btn btn-primary" onClick={() => router.push(`/dashboard/tenders/${result.id}`)}>
                Открыть тендер → найти цены ✦
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
