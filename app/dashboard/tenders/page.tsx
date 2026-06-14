'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

function fmt(n: number) {
  if (!n) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}

export default function TendersPage() {
  const [tenders, setTenders] = useState<any[]>([])

  useEffect(() => {
    const load = async () => {
      const sb = createClient()
      const { data: profile } = await sb.from('profiles').select('org_id').single()
      if (!profile?.org_id) return
      const { data } = await sb.from('tenders').select('*').eq('org_id', profile.org_id).order('created_at', { ascending: false })
      setTenders(data || [])
    }
    load()
  }, [])

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Все заявки</div>
        <Link href="/dashboard/import" className="btn btn-primary">+ Новый тендер</Link>
      </div>
      <div className="content">
        <div className="card">
          {tenders.length === 0 ? (
            <div className="empty">
              <div className="empty-title">Нет тендеров</div>
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
