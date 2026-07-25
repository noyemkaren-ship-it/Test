import { useState } from 'react'
import { apiUrl } from '../config'
import { usePreferences } from '../preferences'

export default function LoginPage({
  onSuccess,
  onBack
}: {
  onSuccess: (token: string, user: any) => void
  onBack: () => void
}) {
  const { tr } = usePreferences()
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
        setErr(data.error || tr('Не удалось выполнить вход', 'Sign-in failed'))
        return
      }
      if (data.token) {
        localStorage.setItem('gp_token', data.token)
        onSuccess(data.token, data.user)
      }
    } catch {
      setErr(tr('Backend недоступен. Проверьте API_URL и сервер.', 'Backend is unavailable. Check API_URL and the server.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page premium-auth">
      <div className="auth-orbit auth-orbit-one" />
      <div className="auth-orbit auth-orbit-two" />
      <div className="auth-card premium-auth-card">
        <button type="button" className="auth-back" onClick={onBack}>← {tr('Вернуться к платформе', 'Back to platform')}</button>
        <div className="auth-brand"><span className="brand-mark"><span>G</span></span></div>
        <p className="eyebrow">Private workspace access</p>
        <h1>{mode === 'login' ? tr('Добро пожаловать', 'Welcome back') : tr('Создать аккаунт', 'Create an account')}</h1>
        <p className="hint">
          {mode === 'login'
            ? tr('Публичные домены доступны без входа. Авторизация открывает workspace, историю, шаблоны и управление.', 'Public domains are available without signing in. Authentication unlocks your workspace, history, templates and controls.')
            : tr('Новый аккаунт получает роль member. Административные права назначаются отдельно.', 'A new account starts as a member. Admin permissions are assigned separately.')}
        </p>

        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErr('') }}>{tr('Вход', 'Sign in')}</button>
          <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setErr('') }}>{tr('Регистрация', 'Register')}</button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <label><span>{tr('Имя', 'Name')}</span><input className="field" value={name} onChange={e => setName(e.target.value)} placeholder={tr('Имя или команда', 'Name or team')} autoComplete="name" /></label>
          )}
          <label><span>Email</span><input className="field" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" placeholder="you@company.com" /></label>
          <label>
            <span>{tr('Пароль', 'Password')}</span>
            <input className="field" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" />
            {mode === 'register' && <small className="field-help">{tr('8+ символов, заглавная и строчная буква, цифра.', '8+ characters with uppercase, lowercase and a number.')}</small>}
          </label>
          {err && <div className="auth-err">{err}</div>}
          <button type="submit" className="btn-primary auth-submit" disabled={loading}>{loading ? tr('Проверяем…', 'Checking…') : mode === 'login' ? tr('Войти в workspace', 'Open workspace') : tr('Создать аккаунт', 'Create account')}</button>
        </form>
      </div>
    </div>
  )
}
