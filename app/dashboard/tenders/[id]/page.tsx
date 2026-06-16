'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'
import * as XLSX from 'xlsx'

function fmt(n: number) {
  if (!n && n !== 0) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}
function fmtN(n: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)
}

export default function TenderPage({ params }: { params: { id: string } }) {
  const [tender, setTender] = useState<any>(null)
  const [sections, setSections] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [priceResults, setPriceResults] = useState<Record<string, any>>({})
  const [tab, setTab] = useState<'items' | 'prices'>('items')
  const [searching, setSearching] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [logs, setLogs] = useState<{ text: string; type: string }[]>([])
  const [summary, setSummary] = useState<any>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async () => {
      const sb = createClient()
      const { data: t } = await sb.from('tenders').select('*').eq('id', params.id).single()
      if (!t) return
      setTender(t)

      const { data: its } = await sb.from('tender_items').select('*').eq('tender_id', params.id).order('sort_order')
      const allItems = its || []
      setItems(allItems)

      // Группируем по разделам
      const secMap: Record<string, any> = {}
      for (const item of allItems) {
        const key = item.section_number || item.section_name || '0'
        if (!secMap[key]) secMap[key] = { number: item.section_number, name: item.section_name, items: [], total: 0 }
        secMap[key].items.push(item)
        secMap[key].total += item.total || 0
      }
      setSections(Object.values(secMap))

      // Загружаем кешированные цены из materials
      const { data: profile } = await sb.from('profiles').select('org_id').single()
      if (profile?.org_id) {
        const { data: mats } = await sb.from('materials').select('*').eq('org_id', profile.org_id)
        if (mats?.length) {
          const cached: Record<string, any> = {}
          for (const m of mats) {
            cached[m.name.toLowerCase()] = {
              price: m.last_price,
              source: m.last_source,
              url: m.last_source_url,
              total: m.last_price * 1,
              from_db: true,
            }
          }
          setPriceResults(cached)
        }
      }
    }
    load()
  }, [params.id])

  function addLog(text: string, type: string) {
    setLogs(prev => [...prev, { text, type }])
    setTimeout(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, 50)
  }

  async function searchAllPrices() {
    if (searching || !items.length) return
    setSearching(true)
    setLogs([])
    const startTime = Date.now()
    addLog('Запуск поиска цен...', 'log-s')
    addLog('Шаг 1: ищем в базе расценок компании', 'log-s')
    addLog('Шаг 2: остальное — AI поиск в Яндексе', 'log-s')

    const sb = createClient()
    const { data: profile } = await sb.from('profiles').select('org_id').single()

    const BATCH = 3
    const results = { ...priceResults }

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH)
      setSearchText(`${i + 1}–${Math.min(i + BATCH, items.length)} из ${items.length}`)
      addLog(`[${i + 1}–${Math.min(i + BATCH, items.length)}/${items.length}] ${batch.map((m: any) => m.name.split(' ').slice(0, 3).join(' ')).join(', ')}...`, 'log-s')

      try {
        const res = await fetch(
          'https://latlduzqzoqijpvmeecb.supabase.co/functions/v1/search-prices',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              materials: batch.map((item: any) => ({
                name: item.name,
                unit: item.unit,
                quantity: item.quantity,
              })),
              org_id: profile?.org_id,
            })
          }
        )
        const { results: apiResults } = await res.json()

        for (const r of (apiResults || [])) {
          const key = r.name.toLowerCase()
          const item = batch.find((m: any) => m.name.toLowerCase() === key)
          if (r.price) {
            results[key] = {
              price: r.price,
              source: r.source,
              url: r.url,
              note: r.note,
              total: r.price * (item?.quantity || 1),
              from_db: r.from_db,
            }
            const srcLabel = r.from_db ? '[База расценок]' : `[AI: ${r.source || 'интернет'}]`
            const fromWarning = r.price_is_from ? " ⚠️ цена «от»" : ""
            const typeLabel = r.item_type === "work" ? "🔧" : "📦"
            addLog(`✓ ${r.name.slice(0, 50)} — ${fmt(r.price)}/${r.unit || 'ед.'} ${srcLabel}`, 'log-ok')
          } else {
            addLog(`✗ ${r.name?.slice(0, 50)} — не найдено`, 'log-err')
          }
        }
      } catch (e: any) {
        addLog(`Ошибка: ${e.message}`, 'log-err')
      }

      setPriceResults({ ...results })
      updateSummary(results)
      await new Promise(r => setTimeout(r, 200))
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
    const found = Object.values(results).filter((r: any) => r.price > 0).length
    addLog(`✓ Готово за ${elapsed} сек. Найдено: ${found}/${items.length}`, 'log-ok')
    setSearchText('')
    setSearching(false)
    updateSummary(results)
  }

  function updateSummary(results: Record<string, any>) {
    const found = items.filter((m: any) => results[m.name.toLowerCase()]?.price > 0)
    const fromDB = found.filter((m: any) => results[m.name.toLowerCase()]?.from_db)
    const fromAI = found.filter((m: any) => !results[m.name.toLowerCase()]?.from_db)
    const total = found.reduce((a: number, m: any) => {
      const r = results[m.name.toLowerCase()]
      return a + (r?.price || 0) * (m.quantity || 1)
    }, 0)
    setSummary({ found: found.length, fromDB: fromDB.length, fromAI: fromAI.length, total: items.length, totalCost: total, missing: items.length - found.length })
  }

  function updatePrice(key: string, val: string, qty: number) {
    const p = parseFloat(val) || 0
    const newResults = {
      ...priceResults,
      [key]: { ...(priceResults[key] || {}), price: p, total: p * qty, source: priceResults[key]?.source || 'вручную' }
    }
    setPriceResults(newResults)
    updateSummary(newResults)
  }

  function exportKP() {
    if (!tender) return
    const rows: any[][] = [['Наименование', 'Ед.', 'Кол-во', 'Цена СМР', 'Итого СМР', 'Цена найдена', 'Источник', 'Ссылка']]
    for (const item of items) {
      const key = item.name.toLowerCase()
      const res = priceResults[key]
      rows.push([
        item.name,
        item.unit || '',
        item.quantity,
        item.smr_price || 0,
        item.total || 0,
        res?.price || '',
        res?.source || '',
        res?.url || '',
      ])
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [50, 8, 10, 12, 14, 12, 20, 40].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'КП')
    XLSX.writeFile(wb, `КП_${(tender.title || 'export').slice(0, 30)}.xlsx`)
  }

  if (!tender) return (
    <div className="loading-screen">
      <div className="loading-logo">T</div>
      <div className="loading-text">Загружаем тендер...</div>
    </div>
  )

  return (
    <>
      <div className="topbar">
        <Link href="/dashboard/tenders" className="btn btn-sm" style={{ padding: '6px 10px' }}>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><polyline points="15 18 9 12 15 6"/></svg>
        </Link>
        <div style={{ flex: 1 }}>
          <div className="topbar-title">{tender.title?.length > 60 ? tender.title.slice(0, 60) + '…' : tender.title}</div>
          <div className="topbar-sub">{[tender.customer, tender.platform, tender.deadline ? 'до ' + tender.deadline : ''].filter(Boolean).join(' · ')}</div>
        </div>
        <button className="btn" onClick={exportKP}>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Экспорт КП
        </button>
      </div>

      <div style={{ padding: '16px 24px 0' }}>
        <div className="stats" style={{ marginBottom: 12 }}>
          <div className="stat"><div className="stat-label">Позиций</div><div className="stat-val">{items.length}</div></div>
          <div className="stat"><div className="stat-label">Разделов</div><div className="stat-val">{sections.length}</div></div>
          <div className="stat"><div className="stat-label">Итого СМР</div><div className="stat-val green">{fmt(tender.total_smr || 0)}</div></div>
          <div className="stat"><div className="stat-label">Итого</div><div className="stat-val green">{fmt(tender.total || 0)}</div></div>
        </div>
        <div className="tabs">
          <button className={`tab-btn ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>Работы</button>
          <button className={`tab-btn ${tab === 'prices' ? 'active' : ''}`} onClick={() => setTab('prices')}>Поиск цен ✦</button>
        </div>
      </div>

      {/* ВКЛАДКА: РАБОТЫ */}
      {tab === 'items' && (
        <div className="card" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderBottom: 'none', boxShadow: 'none' }}>
          <div className="tbl-wrap">
            <table>
              <thead><tr>
                <th>Наименование работы</th>
                <th style={{ width: 60 }}>Ед.</th>
                <th style={{ width: 90, textAlign: 'right' }}>Кол-во</th>
                <th style={{ width: 110, textAlign: 'right' }}>Цена ₽</th>
                <th style={{ width: 130, textAlign: 'right' }}>Итого ₽</th>
              </tr></thead>
              <tbody>
                {sections.map(s => (
                  <>
                    {s.name && (
                      <tr key={s.number} className="sec-row">
                        <td colSpan={4}>{s.number ? `${s.number}. ` : ''}{s.name}</td>
                        <td className="td-mono td-right" style={{ paddingRight: 12 }}>{fmtN(s.total)} ₽</td>
                      </tr>
                    )}
                    {s.items.map((item: any) => (
                      <tr key={item.id}>
                        <td style={{ paddingLeft: s.name ? 20 : 12 }}>{item.name}</td>
                        <td style={{ color: 'var(--ink3)' }}>{item.unit || ''}</td>
                        <td className="td-mono td-right">{fmtN(item.quantity)}</td>
                        <td className="td-mono td-right">{fmtN(item.smr_price || 0)}</td>
                        <td className="td-mono td-right td-green">{fmtN(item.total || 0)}</td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <div className="totals-bar">
            <div><div className="tot-label">Позиций</div><div className="tot-val">{items.length}</div></div>
            <div><div className="tot-label">Разделов</div><div className="tot-val">{sections.length}</div></div>
            <div><div className="tot-label">Итого СМР</div><div className="tot-val">{fmt(tender.total_smr || 0)}</div></div>
            <div><div className="tot-label">ИТОГО</div><div className="tot-val accent">{fmt(tender.total || 0)}</div></div>
          </div>
        </div>
      )}

      {/* ВКЛАДКА: ПОИСК ЦЕН */}
      {tab === 'prices' && (
        <>
          <div className="price-toolbar">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Поиск цен — База расценок + AI Яндекс</div>
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
                Сначала ищем в вашей базе расценок, затем AI ищет в интернете со ссылками
              </div>
            </div>
            {searching && (
              <div className="spinner-wrap">
                <div className="spinner"/>
                <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{searchText}</span>
              </div>
            )}
            <button className="btn btn-blue" onClick={searchAllPrices} disabled={searching}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {searching ? 'Ищем...' : 'Найти все цены'}
            </button>
            <button className="btn btn-sm" onClick={exportKP}>↓ Excel</button>
          </div>

          {logs.length > 0 && (
            <div className="ai-log" ref={logRef}>
              {logs.map((l, i) => <div key={i} className={l.type}>{l.text}</div>)}
            </div>
          )}

          <div className="tbl-wrap">
            <table>
              <thead><tr>
                <th style={{ width: 36 }}>#</th>
                <th>Позиция</th>
                <th style={{ width: 55 }}>Ед.</th>
                <th style={{ width: 80, textAlign: 'right' }}>Кол-во</th>
                <th style={{ width: 130, textAlign: 'right' }}>Найденная цена</th>
                <th style={{ width: 130 }}>Источник</th>
                <th style={{ width: 130, textAlign: 'right' }}>Стоимость</th>
                <th style={{ width: 80, textAlign: 'center' }}>Статус</th>
              </tr></thead>
              <tbody>
                {items.map((item: any, i: number) => {
                  const key = item.name.toLowerCase()
                  const res = priceResults[key]
                  return (
                    <tr key={item.id || i} style={res?.price ? { background: 'rgba(22,105,68,.03)' } : {}}>
                      <td className="td-mono" style={{ color: 'var(--ink3)' }}>{i + 1}</td>
                      <td style={{ fontSize: 13, maxWidth: 300 }}>{item.name}</td>
                      <td style={{ color: 'var(--ink3)' }}>{item.unit || ''}</td>
                      <td className="td-mono td-right">{fmtN(item.quantity)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <input
                            className="price-input"
                            type="number"
                            value={res?.price || ''}
                            placeholder="0.00"
                            onChange={e => updatePrice(key, e.target.value, item.quantity)}
                          />
                        </div>
                      </td>
                      <td>
                        {res?.url ? (
                          <a href={res.url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 11, color: 'var(--blue)', textDecoration: 'none', display: 'block', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={res.source}>
                            🔗 {res.source}
                          </a>
                        ) : res?.source ? (
                          <span className="src-chip">{res.source}</span>
                        ) : null}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {res?.price
                          ? <span className="td-mono td-green">{fmt(res.price * (item.quantity || 1))}</span>
                          : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {res?.price
                          ? <span className={`badge ${res.from_db ? 'badge-blue' : 'badge-green'}`}>
                              {res.from_db ? 'база' : 'AI'}
                            </span>
                          : <span className="badge badge-gray">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {summary && (
            <div className="summary-box">
              <div><div className="tot-label">Найдено</div><div className="tot-val">{summary.found} / {summary.total}</div></div>
              <div><div className="tot-label">Из базы расценок</div><div className="tot-val">{summary.fromDB}</div></div>
              <div><div className="tot-label">Найдено AI</div><div className="tot-val accent">{summary.fromAI}</div></div>
              <div><div className="tot-label">Стоимость</div><div className="tot-val accent">{fmt(summary.totalCost)}</div></div>
            </div>
          )}
        </>
      )}
    </>
  )
}
