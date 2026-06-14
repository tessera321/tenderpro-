'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

function fmt(n: number) {
  if (!n) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ tenders: 0, mats: 0 })
  const [tenders, setTenders] = useState<any[]>([])

  useEffect(() => {
    const load = async () => {
      const sb = createClient()
      const { data: profile } = await sb.from('profiles').select('org_id').single()
      if (!profile?.org_id) return
      const [{ count: tc }, { count: mc }, { data: t }] = await Promise.all([
        sb.from('tenders').select('*', { count: 'exact', head: true }).eq('org_id', profile.org_id),
        sb.from('materials').select('*', { count: 'exact', head: true }).eq('org_id', profile.org_id),
        sb.from('tenders').select('*').eq('org_id', profile.org_id).order('created_at', { ascending: false }).limit(5),
      ])
      setStats({ tenders: tc || 0, mats: mc || 0 })
      setTenders(t || [])
    }
    load()
  }, [])

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Дашборд</div>
        <Link href="/dashboard/import" className="btn btn-primary">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Новый тендер
        </Link>
      </div>
      <div className="content">
        <div className="stats">
          <div className="stat"><div className="stat-label">Тендеров</div><div className="stat-val">{stats.tenders}</div><div className="stat-sub">в базе</div></div>
          <div className="stat"><div className="stat-label">Цен в базе</div><div className="stat-val green">{stats.mats}</div><div className="stat-sub">материалов</div></div>
          <div className="stat"><div className="stat-label">Время на КП</div><div className="stat-val green">2–3 ч</div><div className="stat-sub">было 24+ часа</div></div>
          <div className="stat"><div className="stat-label">Экономия</div><div className="stat-val green">21 ч</div><div className="stat-sub">на каждом тендере</div></div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Последние тендеры</div>
            <Link href="/dashboard/tenders" className="btn btn-sm">Все →</Link>
          </div>
          {tenders.length === 0 ? (
            <div className="empty">
              <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <div className="empty-title">Нет тендеров</div>
              <div style={{ marginTop: 12 }}>
                <Link href="/dashboard/import" className="btn btn-primary">Загрузить первый ТЗ</Link>
              </div>
            </div>
          ) : tenders.map(t => (
            <Link key={t.id} href={`/dashboard/tenders/${t.id}`} className="t-item">
              <div>
                <div className="t-name">{t.title?.length > 80 ? t.title.slice(0, 80) + '…' : t.title}</div>
                <div className="t-meta">{[t.customer, t.platform, t.deadline ? 'до ' + t.deadline : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="t-total">{fmt(t.total || 0)}</div>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
