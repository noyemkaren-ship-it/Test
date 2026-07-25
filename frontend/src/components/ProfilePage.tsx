export default function ProfilePage({
  user,
  onLogout,
  onBack
}: {
  user: any
  onLogout: () => void
  onBack: () => void
}) {
  if (!user) {
    return (
      <div className="profile-page">
        <p className="muted">Вы не вошли</p>
        <button type="button" className="chip on" onClick={onBack}>Назад</button>
      </div>
    )
  }
  return (
    <div className="profile-page">
      <div className="profile-hero-card">
        <div className="profile-big-avatar">
          {(user.name || user.email || '?')[0].toUpperCase()}
        </div>
        <h1>{user.name || 'Пользователь'}</h1>
        <p className="profile-email">{user.email}</p>
        <span className={`role-pill ${user.role === 'admin' ? 'admin' : ''}`}>
          {user.role === 'admin' ? '🛡 Администратор' : 'Участник'}
        </span>
      </div>
      <div className="panel">
        <h3>Аккаунт</h3>
        <div className="activity-item">
          <div className="activity-q">ID</div>
          <div className="activity-meta">{user.id}</div>
        </div>
        <div className="activity-item" style={{ marginTop: 8 }}>
          <div className="activity-q">Workspace</div>
          <div className="activity-meta">{user.workspaceId || '—'}</div>
        </div>
        <button type="button" className="auth-submit" style={{ marginTop: 16 }} onClick={onLogout}>
          Выйти из аккаунта
        </button>
      </div>
      <button type="button" className="chip" style={{ marginTop: 12 }} onClick={onBack}>
        ← К графу
      </button>
    </div>
  )
}
