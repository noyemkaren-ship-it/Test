import { usePreferences } from '../preferences'

export default function ProfilePage({
  user,
  onLogout,
  onBack
}: {
  user: any
  onLogout: () => void
  onBack: () => void
}) {
  const { tr } = usePreferences()
  if (!user) {
    return (
      <div className="profile-page">
        <p className="muted">{tr('Вы не вошли', 'You are not signed in')}</p>
        <button type="button" className="chip on" onClick={onBack}>{tr('Назад', 'Back')}</button>
      </div>
    )
  }
  return (
    <div className="profile-page">
      <div className="profile-hero-card">
        <div className="profile-big-avatar">
          {(user.name || user.email || '?')[0].toUpperCase()}
        </div>
        <h1>{user.name || tr('Пользователь', 'User')}</h1>
        <p className="profile-email">{user.email}</p>
        <span className={`role-pill ${user.role === 'admin' ? 'admin' : ''}`}>
          {user.role === 'admin' ? tr('🛡 Администратор', '🛡 Administrator') : tr('Участник', 'Member')}
        </span>
      </div>
      <div className="panel">
        <h3>{tr('Аккаунт', 'Account')}</h3>
        <div className="activity-item">
          <div className="activity-q">ID</div>
          <div className="activity-meta">{user.id}</div>
        </div>
        <div className="activity-item" style={{ marginTop: 8 }}>
          <div className="activity-q">Workspace</div>
          <div className="activity-meta">{user.workspaceId || '—'}</div>
        </div>
        <button type="button" className="auth-submit" style={{ marginTop: 16 }} onClick={onLogout}>
          {tr('Выйти из аккаунта', 'Sign out')}
        </button>
      </div>
      <button type="button" className="chip" style={{ marginTop: 12 }} onClick={onBack}>
        ← {tr('К графу', 'Back to graph')}
      </button>
    </div>
  )
}
