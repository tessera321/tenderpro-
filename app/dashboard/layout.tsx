'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [userEmail, setUserEmail] = useState('')
  const [counts, setCounts] = useState({ tenders: 0, mats: 0 })

  useEffect(() => {
    const init = async () => {
      const sb = createClient()
      const { data: { session } } = await sb.auth.getSession()
      if (!session) { router.replace('/auth'); return }
      setUserEmail(session.user.email || '')

      const { data: profile } = await sb.from('profiles').select('org_id').eq('id', session.user.id).single()
      if (profile?.org_id) {
        const [{ count: tc }, { count: mc }] = await Promise.all([
          sb.from('tenders').select('*', { count: 'exact', head: true }).eq('org_id', profile.org_id),
          sb.from('materials').select('*', { count: 'exact', head: true }).eq('org_id', profile.org_id),
        ])
        setCounts({ tenders: tc || 0, mats: mc || 0 })
      }
    }
    init()
  }, [router, pathname])

  async function logout() {
    const sb = createClient()
    await sb.auth.signOut()
    router.replace('/auth')
  }

  const navItems = [
    { href: '/dashboard', label: 'Дашборд', icon: <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg> },
    { href: '/dashboard/tenders', label: 'Все заявки', icon: <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>, badge: counts.tenders },
    { href: '/dashboard/materials', label: 'База цен', icon: <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>, badge: counts.mats },
  ]

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-logo">
          <div className="sb-icon">T</div>
          <span className="sb-title">TenderPro</span>
        </div>
        <nav className="sb-nav">
          <div className="sb-section">
            <div className="sb-label">Тендеры</div>
            {navItems.map(item => (
              <Link key={item.href} href={item.href} className={`sb-item ${pathname === item.href ? 'active' : ''}`}>
                {item.icon}
                <span>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && <span className="sb-badge">{item.badge}</span>}
              </Link>
            ))}
          </div>
          <div className="sb-section">
            <div className="sb-label">Инструменты</div>
            <Link href="/dashboard/import" className={`sb-item ${pathname === '/dashboard/import' ? 'active' : ''}`}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>Загрузить ТЗ</span>
            </Link>
          </div>
        </nav>
        <div className="sb-foot">
          <div className="sb-user">{userEmail}</div>
          <button className="sb-logout" onClick={logout}>Выйти</button>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  )
}
