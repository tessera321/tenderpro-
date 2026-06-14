'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'
import * as XLSX from 'xlsx'

function fmt(n: number) {
  if (!n && n !== 0) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}
function fmtN(n: number) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n) }

export default function TenderPage({ params }: { params: { id: string } }) {
  const [tender, setTender] = useState<any>(null)
  const [sections, setSections] = useState<any[]>([])
  const [purchaseMats, setPurchaseMats] = useState<any[]>([])
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
      const [{ data: t }, { data: items }, { data: mats }] = await Promise.all([
        sb.from('tenders').select('*').eq('id', params.id).single(),
        sb.from('tender_items').select('*').eq('tender_id', params.id).order('sort_order'),
        sb.from('tender_item_materials').select('*').eq('tender_id', params.id),
      ])
      if (!t) return
      setTender(t)

      // Group items by section
      const itemMap: Record<string, any> = {}
      for (const item of (items || [])) { item.materials = []; itemMap[item.id] = item }
      for (const mat of (mats || [])) { if (itemMap[mat.item_id]) itemMap[mat.item_id].materials.push(mat) }

      const secMap: Record<string, any> = {}
      for (const item of Object.values(itemMap)) {
        const key = item.section_number || '0'
        if (!secMap[key]) secMap[key] = { number: item.section_number, name: item.section_name, items: [], total: 0 }
        secMap[key].items.push(item)
        secMap[key].total += item.total || 0
      }
      setSections(Object.values(secMap))

      // Build purchase materials list
      const matMap: Record<string, any> = {}
      for (const item of Object.values(itemMap)) {
        for (const mat of (item.materials || [])) {
          if (mat.is_customer_supply) continue
          const key = mat.name.trim().toLowerCase()
          if (!matMap[key]) matMap[key] = { name: mat.name, unit: mat.unit, quantity: 0 }
          matMap[key].quantity += mat.quantity || 0
        }
      }
      // Fallback: use items if no materials
      if (Object.keys(matMap).length === 0) {
        for (const item of Object.values(itemMap)) {
          const key = item.name.trim().toLowerCase().slice(0, 80)
          matMap[key] = { name: item.name, unit: item.unit, quantity: item.quantity }
        }
      }
      setPurchaseMats(Object.values(matMap))

      // Check cached prices from DB
      const { data: profile } = await sb.from('profiles').select('org_id').single()
      if (profile?.org_id) {
        const names = Object.keys(matMap)
        const { data: cachedMats } = await sb.from('materials').select('name, last_price, last_source').eq('org_id', profile.org_id)
        if (cachedMats?.length) {
          const cached: Record<string, any> = {}
          for (const cm of cachedMats) {
            const key = cm.name.toLowerCase()
            if (matMap[key] && cm.last_price) {
              cached[key] = { price: cm.last_price, source: cm.last_source || 'база', total: cm.last_price * matMap[key].quantity }
            }
          }
          if (Object.keys(cached).length) setPriceResults(cached)
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
    if (searching || !purchaseMats.length) return
    setSearching(true)
    setLogs([])
    const startTime = Date.now()
    addLog('Запуск AI-поиска цен по Москве 2025–2026...', 'log-s')

    const sb = createClient()
    const { data: profile } = await sb.from('profiles').select('org_id').single()

    const BATCH = 5
    const results = { ...priceResults }

    for (let i = 0; i < purchaseMats.length; i += BATCH) {
      const batch = purchaseMats.slice(i, i + BATCH)
      setSearchText(`Ищем ${i + 1}–${Math.min(i + BATCH, purchaseMats.length)} из ${purchaseMats.length}...`)
      addLog(`[${i + 1}–${Math.min(i + BATCH, purchaseMats.length)}/${purchaseMats.length}] ${batch.map((m: any) => m.name.split(' ').slice(0, 3).join(' ')).join(', ')}...`, 'log-s')

      try {
        const res = await fetch('https://latlduzqzoqijpvmeecb.supabase.co/functions/v1/search-prices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ materials: batch, org_id: profile?.org_id })
        })
        const { results: apiResults } = await res.json()
        for (const r of (apiResults || [])) {
          const key = r.name.toLowerCase()
          const m = purchaseMats.find((m: any) => m.name.toLowerCase() === key)
          if (r.price && m) {
            results[key] = { price: r.price, source: r.source, total: r.price * m.quantity }
            addLog(`✓ ${r.name.slice(0, 45)} — ${fmt(r.price)}/${r.unit || 'ед.'} [${r.source}]`, 'log-ok')
          } else {
            addLog(`✗ ${r.name?.slice(0, 45) || key} — не найдено`, 'log-err')
          }
        }
      } catch (e: any) {
        addLog(`Ошибка: ${e.message}`, 'log-err')
      }

      setPriceResults({ ...results })
      updateSummary(results)
      await new Promise(r => setTimeout(r, 300))
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
    const found = Object.values(results).filter((r: any) => r.price > 0).length
    addLog(`Готово за ${elapsed} сек. Найдено: ${found}/${purchaseMats.length}`, 'log-ok')
    setSearchText('')
    setSearching(false)
    updateSummary(results)
  }

  function updateSummary(results: Record<string, any>) {
    const found = purchaseMats.filter((m: any) => results[m.name.toLowerCase()]?.price > 0)
    const total = found.reduce((a: number, m: any) => { const r = results[m.name.toLowerCase()]; return a + (r?.total || 0) }, 0)
    setSummary({ found: found.length, total: purchaseMats.length, totalCost: total, missing: purchaseMats.length - found.length })
  }

  function updatePrice(key: string, val: string, qty: number) {
    const p = parseFloat(val) || 0
    const newResults = { ...priceResults, [key]: { ...(priceResults[key] || {}), price: p, total: p * qty, source: priceResults[key]?.source || 'вручную' } }
    setPriceResults(newResults)
    updateSummary(newResults)
  }

  function exportKP() {
    if (!tender) return
    const rows: any[][] = [['№', 'Наименование', 'Ед.', 'Кол-во', 'СМР/ед.', 'Итого']]
    for (const s of sections) {
      rows.push([s.number, s.name, '', '', '', s.total])
      for (const item of s.items) rows.push([item.item_number || '', item.name, item.unit || '', item.quantity, item.smr_price || 0, item.total || 0])
    }
    rows.push(['', 'ИТОГО', '', '', '', tender.total || 0])
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [6, 50, 6, 10, 12, 14].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, 'Смета')
    const pRows = [['Материал', 'Ед.', 'Кол-во', 'Цена', 'Источник', 'Итого']]
    for (const m of purchaseMats) { const r = priceResults[m.name.toLowerCase()]; pRows.push([m.name, m.unit || '', m.quantity, r?.price || '', r?.source || '', r?.total || '']) }
    const ws2 = XLSX.utils.aoa_to_sheet(pRows)
    ws2['!cols'] = [50, 8, 12, 14, 16, 16].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws2, 'Цены материалов')
    XLSX.writeFile(wb, `КП_${(tender.title || 'export').slice(0, 30)}.xlsx`)
  }

  if (!tender) return <div className="loading-screen"><div className="loading-logo">T</div><div className="loading-text">Загружаем тендер...</div></div>

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
          <div className="stat"><div className="stat-label">Разделов</div><div className="stat-val">{sections.length}</div></div>
          <div className="stat"><div className="stat-label">Позиций</div><div className="stat-val">{sections.reduce((a, s) => a + s.items.length, 0)}</div></div>
          <div className="stat"><div className="stat-label">Итого СМР</div><div className="stat-val green">{fmt(tender.total_smr || 0)}</div></div>
          <div className="stat"><div className="stat-label">Итого всего</div><div className="stat-val green">{fmt(tender.total || 0)}</div></div>
        </div>
        <div className="tabs">
          <button className={`tab-btn ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>Работы</button>
          <button className={`tab-btn ${tab === 'prices' ? 'active' : ''}`} onClick={() => setTab('prices')}>Поиск цен ✦</button>
        </div>
      </div>

      {tab === 'items' && (
        <div className="card" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderBottom: 'none', boxShadow: 'none' }}>
          <div className="tbl-wrap">
            <table>
              <thead><tr>
                <th>Наименование работы</th>
                <th style={{ width: 60 }}>Ед.</th>
                <th style={{ width: 90, textAlign: 'right' }}>Кол-во</th>
                <th style={{ width: 110, textAlign: 'right' }}>СМР/ед. ₽</th>
                <th style={{ width: 120, textAlign: 'right' }}>Итого ₽</th>
              </tr></thead>
              <tbody>
                {sections.map(s => <>
                  <tr key={s.number} className="sec-row"><td colSpan={4}>{s.number}. {s.name}</td><td className="td-mono td-right" style={{ paddingRight: 12 }}>{fmtN(s.total)} ₽</td></tr>
                  {s.items.map((item: any) => (
                    <tr key={item.id}>
                      <td style={{ paddingLeft: 20 }}>{item.name}</td>
                      <td style={{ color: 'var(--ink3)' }}>{item.unit || ''}</td>
                      <td className="td-mono td-right">{fmtN(item.quantity)}</td>
                      <td className="td-mono td-right">{fmtN(item.smr_price)}</td>
                      <td className="td-mono td-right td-green">{fmtN(item.total)}</td>
                    </tr>
                  ))}
                </>)}
              </tbody>
            </table>
          </div>
          <div className="totals-bar">
            <div><div className="tot-label">Разделов</div><div className="tot-val">{sections.length}</div></div>
            <div><div className="tot-label">Позиций</div><div className="tot-val">{sections.reduce((a, s) => a + s.items.length, 0)}</div></div>
            <div><div className="tot-label">Итого СМР</div><div className="tot-val">{fmt(tender.total_smr || 0)}</div></div>
            <div><div className="tot-label">ИТОГО</div><div className="tot-val accent">{fmt(tender.total || 0)}</div></div>
          </div>
        </div>
      )}

      {tab === 'prices' && (
        <>
          <div className="price-toolbar">
            <div className="price-toolbar-title">AI-поиск цен — Москва 2025–2026</div>
            {searching && <div className="spinner-wrap"><div className="spinner"/><span>{searchText}</span></div>}
            <button className="btn btn-blue" onClick={searchAllPrices} disabled={searching}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {searching ? 'Ищем...' : 'Найти все цены (AI)'}
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
                <th>Материал / позиция</th>
                <th style={{ width: 55 }}>Ед.</th>
                <th style={{ width: 100, textAlign: 'right' }}>Кол-во</th>
                <th style={{ width: 150, textAlign: 'right' }}>Цена за ед.</th>
                <th style={{ width: 80 }}>Источник</th>
                <th style={{ width: 140, textAlign: 'right' }}>Стоимость</th>
                <th style={{ width: 90, textAlign: 'center' }}>Статус</th>
              </tr></thead>
              <tbody>
                {purchaseMats.map((m: any, i: number) => {
                  const key = m.name.toLowerCase()
                  const res = priceResults[key]
                  return (
                    <tr key={i} style={res?.price ? { background: 'rgba(22,105,68,.03)' } : {}}>
                      <td className="td-mono" style={{ color: 'var(--ink3)' }}>{i + 1}</td>
                      <td style={{ fontSize: 13, maxWidth: 280 }}>{m.name}</td>
                      <td style={{ color: 'var(--ink3)' }}>{m.unit || ''}</td>
                      <td className="td-mono td-right">{fmtN(m.quantity)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <input
                            className="price-input"
                            type="number"
                            value={res?.price || ''}
                            placeholder="0.00"
                            onChange={e => updatePrice(key, e.target.value, m.quantity)}
                          />
                          {res?.source && <span className="src-chip">{res.source}</span>}
                        </div>
                      </td>
                      <td/>
                      <td style={{ textAlign: 'right' }}>{res?.total ? <span className="td-mono td-green">{fmt(res.total)}</span> : '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        {res?.price
                          ? <span className="badge badge-green">найдено</span>
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
              <div><div className="tot-label">Стоимость</div><div className="tot-val accent">{fmt(summary.totalCost)}</div></div>
              <div><div className="tot-label">Не найдено</div><div className="tot-val">{summary.missing > 0 ? `${summary.missing} позиций` : 'все ✓'}</div></div>
              <div><div className="tot-label">База обновлена</div><div className="tot-val">✓</div></div>
            </div>
          )}
        </>
      )}
    </>
  )
}
