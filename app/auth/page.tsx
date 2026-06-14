'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function AuthPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'login' | 'signup'>('login')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState(false)

  // Login fields
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')

  // Signup fields
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPass, setRegPass] = useState('')

  const sb = createClient()

  async function doLogin() {
    if (!email || !pass) return setMsg({ text: 'Заполните все поля', ok: false })
    setLoading(true)
    setMsg({ text: 'Входим...', ok: true })
    const { error } = await sb.auth.signInWithPassword({ email, password: pass })
    setLoading(false)
    if (error) setMsg({ text: 'Неверный email или пароль', ok: false })
    else router.replace('/dashboard')
  }

  async function doSignup() {
    if (!company || !regEmail || !regPass) return setMsg({ text: 'Заполните все поля', ok: false })
    if (regPass.length < 6) return setMsg({ text: 'Пароль минимум 6 символов', ok: false })
    setLoading(true)
    setMsg({ text: 'Создаём аккаунт...', ok: true })
    const { data, error } = await sb.auth.signUp({
      email: regEmail,
      password: regPass,
      options: { data: { company_name: company, full_name: name } }
    })
    setLoading(false)
    if (error) {
      setMsg({ text: error.message, ok: false })
    } else if (data.session) {
      router.replace('/dashboard')
    } else {
      setMsg({ text: '✓ Аккаунт создан! Проверьте email и подтвердите регистрацию, затем войдите.', ok: true })
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-icon">T</div>
          <div className="auth-title-big">TenderPro</div>
        </div>
        <div className="auth-sub">Платформа для тендерных закупок</div>

        <div className="auth-tabs">
          <button className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setMsg(null) }}>Войти</button>
          <button className={`auth-tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => { setTab('signup'); setMsg(null) }}>Регистрация</button>
        </div>

        {msg && (
          <div className={`auth-msg ${msg.ok ? 'ok' : 'err'}`} style={{ display: 'block' }}>
            {msg.text}
          </div>
        )}

        {tab === 'login' && (
          <div>
            <div className="auth-field">
              <label className="auth-label">Email</label>
              <input className="auth-input" type="email" placeholder="your@company.ru" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()} />
            </div>
            <div className="auth-field">
              <label className="auth-label">Пароль</label>
              <input className="auth-input" type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()} />
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={doLogin} disabled={loading}>
              {loading ? 'Входим...' : 'Войти'}
            </button>
          </div>
        )}

        {tab === 'signup' && (
          <div>
            <div className="auth-field">
              <label className="auth-label">Название компании</label>
              <input className="auth-input" placeholder="ООО СтройПрофи" value={company} onChange={e => setCompany(e.target.value)} />
            </div>
            <div className="auth-field">
              <label className="auth-label">Ваше имя</label>
              <input className="auth-input" placeholder="Иван Иванов" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="auth-field">
              <label className="auth-label">Email</label>
              <input className="auth-input" type="email" placeholder="your@company.ru" value={regEmail} onChange={e => setRegEmail(e.target.value)} />
            </div>
            <div className="auth-field">
              <label className="auth-label">Пароль</label>
              <input className="auth-input" type="password" placeholder="минимум 6 символов" value={regPass} onChange={e => setRegPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSignup()} />
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={doSignup} disabled={loading}>
              {loading ? 'Создаём...' : 'Создать аккаунт'}
            </button>
            <div className="auth-note">Регистрируясь, вы принимаете условия использования</div>
          </div>
        )}
      </div>
    </div>
  )
}
