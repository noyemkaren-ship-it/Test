import { useState } from 'react'
import { apiUrl } from '../config'

export default function LoginPage({
  onSuccess,
  onBack
}: {
  onSuccess: (token: string, user: any) => void
  onBack: () => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const body = mode === 'login' ? { email, password } : { email, password, name: name || email.split('@')[0] }
      const res = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(data.error || 'Не удалось выполнить вход')
        return
      }
      if (data.token) {
        localStorage.setItem('gp_token', data.token)
        onSuccess(data.token, data.user)
      }
    } catch {
      setErr('Backend недоступен. Проверьте API_URL и сервер.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page premium-auth">
      <div className="auth-orbit auth-orbit-one" />
      <div className="auth-orbit auth-orbit-two" />
      <div className="auth-card premium-auth-card">
        <button type="button" className="auth-back" onClick={onBack}>← Вернуться к платформе</button>
        <div className="auth-brand"><span className="brand-mark"><span>G</span></span></div>
        <p className="eyebrow">Private workspace access</p>
        <h1>{mode === 'login' ? 'Добро пожаловать' : 'Создать аккаунт'}</h1>
        <p className="hint">
          {mode === 'login'
            ? 'Публичные домены доступны без входа. Авторизация открывает workspace, историю, шаблоны и управление.'
            : 'Новый аккаунт получает роль member. Административные права назначаются отдельно.'}
        </p>

        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErr('') }}>Вход</button>
          <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setErr('') }}>Регистрация</button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <label><span>Имя</span><input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="Имя или команда" autoComplete="name" /></label>
          )}
          <label><span>Email</span><input className="field" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" placeholder="you@company.com" /></label>
          <label>
            <span>Пароль</span>
            <input className="field" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" />
            {mode === 'register' && <small className="field-help">8+ символов, заглавная и строчная буква, цифра.</small>}
          </label>
          {err && <div className="auth-err">{err}</div>}
          <button type="submit" className="btn-primary auth-submit" disabled={loading}>{loading ? 'Проверяем…' : mode === 'login' ? 'Войти в workspace' : 'Создать аккаунт'}</button>
        </form>
      </div>
    </div>
  )
}
