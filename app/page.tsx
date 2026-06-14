'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const check = async () => {
      const sb = createClient()
      const { data: { session } } = await sb.auth.getSession()
      router.replace(session ? '/dashboard' : '/auth')
    }
    check()
  }, [router])

  return (
    <div className="loading-screen">
      <div className="loading-logo">T</div>
      <div className="loading-text">Загружаем TenderPro...</div>
    </div>
  )
}
