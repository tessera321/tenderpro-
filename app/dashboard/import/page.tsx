'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import * as XLSX from 'xlsx'

function fmt(n: number) {
  if (!n) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}

// Предобработка строк прямо на фронтенде — до отправки на сервер
function extractMeaningfulRows(rows: any[][]): any[][] {
  const unitWords = ['м2', 'м3', 'пог.м', 'пог. м', 'шт', 'шт.', 'т', 'кг', 'км', 'компл', 'компл.', 'л', 'м', 'пм', 'п.м', 'п.м.']
  const result: any[][] = []

  for (const row of rows) {
    if (!row) continue
    let hasName = false
    let hasUnit = false
    let hasQty = false

    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] ?? '').trim()
      if (!cell || cell === 'null') continue
      if (!hasName && cell.length > 10 && !/^[\d.,\s]+$/.test(cell) && !/^Л\d/.test(cell)) hasName = true
      if (!hasUnit && unitWords.some(u => cell.toLowerCase() === u.toLowerCase())) {
        hasUnit = true
        for (let k = j + 1; k < Math.min(j + 5, row.length); k++) {
          const n = parseFloat(String(row[k] ?? '').replace(',', '.'))
          if (!isNaN(n) && n > 0) { hasQty = true; break }
        }
      }
    }

    if (hasName && hasUnit) {
      // Сжимаем строку — берём только непустые ячейки
      const compact = row.map(v => {
        const s = String(v ?? '').trim()
        return s === 'null' ? '' : s.substring(0, 80)
      }).filter((v, i) => i < 20) // максимум 20 колонок
      result.push(compact)
    }
  }

  return result.slice(0, 80) // максимум 80 строк
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
      setProgress(25)
      setStatus('Анализируем структуру...')

      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const allRows = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: null,
        raw: false,
        blankrows: false
      }) as any[][]

      // Извлекаем только значимые строки прямо на фронтенде
      const meaningfulRows = allRows

      setProgress(40)
      setStatus(`Найдено ${meaningfulRows.length} позиций, отправляем в AI...`)

      if (allRows.length === 0) {
        throw new Error('Не удалось найти позиции в файле. Убедитесь что файл содержит наименования работ с единицами измерения.')
      }

      const sb = createClient()
      const { data: profile } = await sb.from('profiles').select('org_id').single()
      if (!profile?.org_id) throw new Error('Профиль не найден')

      const res = await fetch(
        'https://latlduzqzoqijpvmeecb.supabase.co/functions/v1/parse-tender',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: meaningfulRows, // Отправляем только отфильтрованные строки
            filename: file.name,
            org_id: profile.org_id,
            tender_meta: {
              title: titleVal || undefined,
              customer: customer || undefined,
              platform: platform || undefined,
              deadline: deadline || undefined,
            }
          })
        }
      )

      setProgress(80)
      setStatus('Сохраняем в базу...')

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Ошибка сервера: ${res.status}`)
      }

      const parsed = await res.json()
      if (parsed.error) throw new Error(parsed.error)
      if (!parsed.items?.length) throw new Error('AI не смог распознать позиции. Попробуйте добавить название объекта вручную.')

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
              <input className="form-input" placeholder="ЖК BESIDE 2.0 — наливные полы" value={titleVal} onChange={e => setTitleVal(e.target.value)} />
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
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) processFile(f)
          }}
        >
          <svg width="38" height="38" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--ink3)' }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div className="upload-title">Загрузите файл от заказчика</div>
          <div className="upload-sub">
            Любой Excel <strong>.xlsx</strong> — ведомость работ, оферта, РСС, ТКП.<br/>
            AI автоматически найдёт позиции, объёмы и единицы измерения.
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }}
          />
        </div>

        {progress > 0 && !result && !error && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{status}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{progress}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: progress + '%' }} />
            </div>
            {progress >= 40 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink3)' }}>
                Claude анализирует структуру и извлекает позиции — 15–30 секунд...
              </div>
            )}
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
              <div className="card-title" style={{ color: 'var(--green)' }}>Тендер разобран и сохранён</div>
            </div>
            <div className="card-body">
              {result.title && (
                <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--ink2)' }}>
                  <b>Объект:</b> {result.title}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>
                <div><div className="stat-label">Позиций</div><div style={{ fontSize: 24, fontWeight: 700 }}>{result.items?.length || 0}</div></div>
                <div><div className="stat-label">С ценами</div><div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }}>{result.items?.filter((i: any) => i.smr_price > 0).length || 0}</div></div>
                <div><div className="stat-label">Итого</div><div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }}>{fmt(result.items?.reduce((s: number, i: any) => s + (i.total || 0), 0) || 0)}</div></div>
              </div>

              <div style={{ background: 'var(--bg)', borderRadius: 'var(--r)', padding: '12px', marginBottom: 14, maxHeight: 200, overflowY: 'auto', fontSize: 12 }}>
                {result.items?.slice(0, 10).map((item: any, i: number) => (
                  <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--ink3)', minWidth: 20 }}>{i + 1}</span>
                    <span style={{ flex: 1 }}>{item.name?.slice(0, 60)}{item.name?.length > 60 ? '…' : ''}</span>
                    <span style={{ color: 'var(--ink3)' }}>{item.unit}</span>
                    <span style={{ color: 'var(--ink3)', minWidth: 40 }}>{item.quantity}</span>
                  </div>
                ))}
                {result.items?.length > 10 && (
                  <div style={{ padding: '6px 0', color: 'var(--ink3)', textAlign: 'center' }}>+ ещё {result.items.length - 10} позиций</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                {result.tender_id && (
                  <button className="btn btn-primary" onClick={() => router.push(`/dashboard/tenders/${result.tender_id}`)}>
                    Открыть тендер → найти цены ✦
                  </button>
                )}
                <button className="btn" onClick={() => { setResult(null); setProgress(0); setStatus('') }}>
                  Загрузить другой файл
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
