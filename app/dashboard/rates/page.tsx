'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import * as XLSX from 'xlsx'

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)
}

export default function RatesPage() {
  const [rates, setRates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [filter, setFilter] = useState('')
  const [catFilter, setCatFilter] = useState('все')
  const [showAdd, setShowAdd] = useState(false)
  const [newRate, setNewRate] = useState({ name: '', unit: '', price: '', category: '', type: 'work' })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadRates() }, [])

  async function loadRates() {
    setLoading(true)
    const sb = createClient()
    const { data: profile } = await sb.from('profiles').select('org_id').single()
    if (!profile?.org_id) { setLoading(false); return }
    const { data } = await sb.from('work_rates')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('category')
      .order('name')
    setRates(data || [])
    setLoading(false)
  }

  async function deleteRate(id: string) {
    const sb = createClient()
    await sb.from('work_rates').delete().eq('id', id)
    setRates(prev => prev.filter((r: any) => r.id !== id))
  }

  async function addRateManual() {
    if (!newRate.name || !newRate.price) return
    const sb = createClient()
    const { data: profile } = await sb.from('profiles').select('org_id').single()
    if (!profile?.org_id) return
    const { data } = await sb.from('work_rates').insert({
      org_id: profile.org_id,
      name: newRate.name,
      unit: newRate.unit,
      price: parseFloat(newRate.price),
      type: newRate.type,
      category: newRate.category || 'общее',
      source: 'вручную'
    }).select().single()
    if (data) setRates(prev => [...prev, data])
    setNewRate({ name: '', unit: '', price: '', category: '', type: 'work' })
    setShowAdd(false)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setProgress('Читаем файл...')

    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][]

    setProgress('Ищем расценки...')
    const sb = createClient()
    const { data: profile } = await sb.from('profiles').select('org_id').single()
    if (!profile?.org_id) { setUploading(false); return }

    const toInsert: any[] = []
    const seen = new Set<string>()

    const fname = file.name.toLowerCase()
    let category = 'общее'
    if (fname.includes('дорог')) category = 'дорожные работы'
    else if (fname.includes('благо')) category = 'благоустройство'
    else if (fname.includes('тепло') || fname.includes('тс')) category = 'теплоснабжение'
    else if (fname.includes('водо') || fname.includes('нк')) category = 'водоснабжение'
    else if (fname.includes('мкд') || fname.includes('монолит')) category = 'МКД'
    else if (fname.includes('гидро') || fname.includes('рсс')) category = 'гидроизоляция'
    else if (fname.includes('электр') || fname.includes('ер_')) category = 'электрика'
    else if (fname.includes('сет') || fname.includes('трубо')) category = 'сети'

    // Формат РСС (Г/Р/М)
    for (const row of rows) {
      if (!row || row.length < 4) continue
      const code = String(row[1] || '').trim().toUpperCase()
      const name = String(row[2] || '').trim()
      const unit = String(row[3] || '').trim()
      if (!name || name.length < 3) continue
      if (!['Р', 'М', 'Х'].includes(code)) continue
      const cleanUnit = unit.length > 20 ? '' : unit
      let price = parseFloat(String(row[code === 'Р' ? 8 : 7] || '').replace(/\s/g, '').replace(',', '.')) || 0
      if (!price) price = parseFloat(String(row[code === 'Р' ? 7 : 9] || '').replace(/\s/g, '').replace(',', '.')) || 0
      if (!price || price <= 0 || price > 10_000_000) continue
      if (seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      toInsert.push({ org_id: profile.org_id, name: name.slice(0, 200), unit: cleanUnit.slice(0, 30), price, type: code === 'Р' ? 'work' : 'material', category, source: file.name })
    }

    // Простой формат (Наименование | Ед | Цена)
    if (toInsert.length === 0) {
      setProgress('Пробуем простой формат...')
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        if (!row) continue
        for (let shift = 0; shift < 3; shift++) {
          const name = String(row[shift] || '').trim()
          const unit = String(row[shift + 1] || '').trim()
          const price = parseFloat(String(row[shift + 2] || '').replace(/\s/g, '').replace(',', '.'))
          if (name.length > 3 && unit.length > 0 && unit.length < 15 && price > 0 && price < 10_000_000) {
            if (!seen.has(name.toLowerCase())) {
              seen.add(name.toLowerCase())
              toInsert.push({ org_id: profile.org_id, name: name.slice(0, 200), unit: unit.slice(0, 30), price, type: 'work', category, source: file.name })
            }
            break
          }
        }
      }
    }

    setProgress(`Найдено ${toInsert.length} расценок, сохраняем...`)
    let saved = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50)
      await sb.from('work_rates').upsert(batch, { onConflict: 'org_id,name' })
      saved += batch.length
      setProgress(`Сохранено ${saved} из ${toInsert.length}...`)
    }

    setProgress(`✓ Загружено ${saved} расценок из "${file.name}"`)
    await loadRates()
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const categories = ['все', ...Array.from(new Set(rates.map((r: any) => r.category).filter(Boolean)))]
  const filtered = rates.filter((r: any) => {
    const matchCat = catFilter === 'все' || r.category === catFilter
    const matchSearch = !filter || r.name.toLowerCase().includes(filter.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">База расценок</div>
        <div className="topbar-sub">{rates.length} позиций · {Array.from(new Set(rates.map((r: any) => r.category))).filter(Boolean).length} категорий</div>
        <button className="btn" onClick={() => setShowAdd(true)}>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{width:14,height:14}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Добавить вручную
        </button>
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          {uploading ? 'Загружаем...' : 'Загрузить прайс-лист'}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm" style={{display:'none'}} onChange={handleFile} />
      </div>

      {uploading && (
        <div style={{background:'#e5f2ec',padding:'10px 24px',fontSize:13,color:'#166944',borderBottom:'1px solid rgba(24,24,26,.1)'}}>
          ⏳ {progress}
        </div>
      )}
      {!uploading && progress.startsWith('✓') && (
        <div style={{background:'#e5f2ec',padding:'10px 24px',fontSize:13,color:'#166944',borderBottom:'1px solid rgba(24,24,26,.1)',display:'flex',justifyContent:'space-between'}}>
          {progress}
          <button onClick={() => setProgress('')} style={{border:'none',background:'none',cursor:'pointer',color:'#166944',fontSize:12}}>✕</button>
        </div>
      )}

      {showAdd && (
        <div style={{background:'#fff',padding:'16px 24px',borderBottom:'1px solid rgba(24,24,26,.1)',display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
          <div><label className="form-label">Наименование</label><input className="form-input" placeholder="Устройство асфальтобетона" value={newRate.name} onChange={e => setNewRate(p => ({...p, name: e.target.value}))} style={{width:320}} /></div>
          <div><label className="form-label">Ед. изм.</label><input className="form-input" placeholder="м2" value={newRate.unit} onChange={e => setNewRate(p => ({...p, unit: e.target.value}))} style={{width:70}} /></div>
          <div><label className="form-label">Цена, ₽</label><input className="form-input" type="number" placeholder="1500" value={newRate.price} onChange={e => setNewRate(p => ({...p, price: e.target.value}))} style={{width:110}} /></div>
          <div><label className="form-label">Категория</label><input className="form-input" placeholder="дорожные работы" value={newRate.category} onChange={e => setNewRate(p => ({...p, category: e.target.value}))} style={{width:160}} /></div>
          <div><label className="form-label">Тип</label>
            <select className="form-input" value={newRate.type} onChange={e => setNewRate(p => ({...p, type: e.target.value}))} style={{width:120}}>
              <option value="work">Работа</option>
              <option value="material">Материал</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={addRateManual}>Добавить</button>
          <button className="btn" onClick={() => setShowAdd(false)}>Отмена</button>
        </div>
      )}

      <div className="content" style={{paddingTop:16}}>
        {!loading && rates.length === 0 && (
          <div className="card">
            <div className="empty">
              <svg width="44" height="44" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{color:'#9898a0'}}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
              <div className="empty-title">База расценок пуста</div>
              <div style={{fontSize:13,color:'#9898a0',marginTop:4,maxWidth:380,textAlign:'center',lineHeight:1.6}}>Загрузите ваши РСС файлы или прайс-листы в формате Excel</div>
              <button className="btn btn-primary" style={{marginTop:16}} onClick={() => fileRef.current?.click()}>Загрузить первый прайс-лист</button>
            </div>
          </div>
        )}

        {rates.length > 0 && (
          <>
            <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
              <input className="form-input" placeholder="Поиск по наименованию..." value={filter} onChange={e => setFilter(e.target.value)} style={{width:280}} />
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {categories.map(cat => (
                  <button key={cat} onClick={() => setCatFilter(cat)} style={{padding:'4px 12px',fontSize:12,borderRadius:20,cursor:'pointer',border:catFilter===cat?'1px solid #166944':'1px solid rgba(24,24,26,.15)',background:catFilter===cat?'#e5f2ec':'#fff',color:catFilter===cat?'#166944':'#4a4a50',fontFamily:'inherit',fontWeight:catFilter===cat?600:400}}>
                    {cat}
                  </button>
                ))}
              </div>
              <span style={{fontSize:12,color:'#9898a0',marginLeft:'auto'}}>Показано: {filtered.length} из {rates.length}</span>
            </div>
            <div className="card">
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Наименование</th>
                      <th style={{width:70}}>Ед.</th>
                      <th style={{width:120,textAlign:'right'}}>Цена, ₽</th>
                      <th style={{width:100}}>Тип</th>
                      <th style={{width:140}}>Категория</th>
                      <th style={{width:160}}>Источник</th>
                      <th style={{width:50}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r: any, i: number) => (
                      <tr key={r.id || i}>
                        <td style={{fontSize:13}}>{r.name}</td>
                        <td style={{color:'#9898a0'}}>{r.unit}</td>
                        <td className="td-mono td-right td-green">{fmt(r.price)} ₽</td>
                        <td><span className={`badge ${r.type==='work'?'badge-blue':'badge-green'}`}>{r.type==='work'?'работа':'материал'}</span></td>
                        <td style={{fontSize:12,color:'#4a4a50'}}>{r.category||'—'}</td>
                        <td style={{fontSize:11,color:'#9898a0',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.source}</td>
                        <td>{r.id&&<button onClick={()=>deleteRate(r.id)} style={{border:'none',background:'none',cursor:'pointer',color:'#9898a0',fontSize:16,padding:'0 4px'}} title="Удалить">✕</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
