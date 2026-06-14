'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

function fmt(n: number) {
  if (!n) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}

export default function MaterialsPage() {
  const [materials, setMaterials] = useState<any[]>([])

  useEffect(() => {
    const load = async () => {
      const sb = createClient()
      const { data: profile } = await sb.from('profiles').select('org_id').single()
      if (!profile?.org_id) return
      const { data } = await sb.from('materials').select('*').eq('org_id', profile.org_id).order('name')
      setMaterials(data || [])
    }
    load()
  }, [])

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">База цен материалов</div>
        <div className="topbar-sub">накапливается автоматически после каждого поиска</div>
      </div>
      <div className="content">
        <div className="card">
          {materials.length === 0 ? (
            <div className="empty">
              <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
              </svg>
              <div className="empty-title">База пуста</div>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4 }}>
                Загрузите тендер и нажмите «Найти все цены» — материалы сохранятся автоматически
              </div>
            </div>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Материал</th>
                    <th style={{ width: 60 }}>Ед.</th>
                    <th style={{ textAlign: 'right', width: 130 }}>Последняя цена</th>
                    <th>Источник</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Обновлено</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map(m => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td style={{ color: 'var(--ink3)' }}>{m.unit || ''}</td>
                      <td className="td-mono td-right td-green">{fmt(m.last_price)}</td>
                      <td>{m.last_source ? <span className="badge badge-blue">{m.last_source}</span> : '—'}</td>
                      <td className="td-mono td-right" style={{ fontSize: 11, color: 'var(--ink3)' }}>
                        {m.price_updated_at ? new Date(m.price_updated_at).toLocaleDateString('ru-RU') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
