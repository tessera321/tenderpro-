'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'

interface RateItem {
  id: string
  name: string
  unit: string
  price: number
  category: string
  source: string
  created_at: string
}

interface PriceList {
  id: string
  name: string
  items_count: number
  created_at: string
}

export default function RatesPage() {
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [rates, setRates] = useState<RateItem[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [orgId, setOrgId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const init = async () => {
      const sb = createClient()
      const { data: { session } } = await sb.auth.getSession()
      if (!session) return
      const { data: profile } = await sb.from('profiles').select('org_id').eq('id', session.user.id).single()
      if (profile?.org_id) {
        setOrgId(profile.org_id)
        await loadRates(profile.org_id)
      }
    }
    init()
  }, [])

  async function loadRates(oid: string) {
    setLoading(true)
    const sb = createClient()
    const { data } = await sb
      .from('price_list_items')
      .select('*')
      .eq('org_id', oid)
      .order('created_at', { ascending: false })
    if (data) {
      setRates(data)
      const cats = Array.from(new Set(data.map((r: RateItem) => r.category).filter(Boolean)))
      setCategories(cats)
    }
    setLoading(false)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !orgId) return
    setUploading(true)
    setUploadMsg('Разбираю файл...')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('org_id', orgId)

    try {
      const res = await fetch('/api/rates/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (json.success) {
        setUploadMsg(`Загружено ${json.count} позиций`)
        await loadRates(orgId)
      } else {
        setUploadMsg(json.error || 'Ошибка при загрузке')
      }
    } catch {
      setUploadMsg('Ошибка соединения')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    setTimeout(() => setUploadMsg(''), 4000)
  }

  async function deleteRate(id: string) {
    const sb = createClient()
    await sb.from('price_list_items').delete().eq('id', id)
    setRates(prev => prev.filter(r => r.id !== id))
  }

  const filtered = rates.filter(r => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = !category || r.category === category
    return matchSearch && matchCat
  })

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">База расценок</h1>
          <p className="page-sub">Загружайте прайс-листы в формате Excel или CSV</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {uploadMsg && (
            <span style={{ fontSize: 13, color: uploading ? '#6b7280' : '#10b981' }}>{uploadMsg}</span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
          <button
            className="btn-primary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Загрузка...' : '+ Загрузить прайс-лист'}
          </button>
        </div>
      </div>

      {rates.length === 0 && !loading ? (
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </div>
          <h3>Прайс-листы не загружены</h3>
          <p>Загрузите Excel или CSV файл с вашими расценками.<br/>Система автоматически распознает формат и сохранит позиции.</p>
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
            Загрузить прайс-лист
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            <input
              className="search-input"
              placeholder="Поиск по наименованию..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            {categories.length > 0 && (
              <select
                className="search-input"
                value={category}
                onChange={e => setCategory(e.target.value)}
                style={{ width: 200 }}
              >
                <option value="">Все категории</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>

          {loading ? (
            <div className="loading">Загрузка...</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Наименование</th>
                    <th>Категория</th>
                    <th>Ед. изм.</th>
                    <th>Цена</th>
                    <th>Источник</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: '#9ca3af', padding: 32 }}>Ничего не найдено</td></tr>
                  ) : filtered.map(r => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td><span className="tag">{r.category || '—'}</span></td>
                      <td>{r.unit || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{r.price ? `${r.price.toLocaleString('ru-RU')} ₽` : '—'}</td>
                      <td style={{ color: '#9ca3af', fontSize: 12 }}>{r.source || '—'}</td>
                      <td>
                        <button
                          onClick={() => deleteRate(r.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, lineHeight: 1 }}
                          title="Удалить"
                        >×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '12px 0', color: '#9ca3af', fontSize: 13 }}>
                Показано {filtered.length} из {rates.length} позиций
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
