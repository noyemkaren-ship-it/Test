export default function TopBar({
  user,
  token,
  health,
  onLogin,
  onLogout,
  onAdmin,
  onReviews,
  onHome
}: {
  user: any
  token: string
  health: any
  onLogin: () => void
  onLogout: () => void
  onAdmin: () => void
  onReviews: () => void
  onHome: () => void
}) {
  return (
    <header className="topbar product-topbar">
      <button type="button" className="brand-lockup" onClick={onHome} aria-label="Graph Platform home">
        <span className="brand-mark"><span>G</span></span>
        <span>
          <strong>Graph Platform</strong>
          <small>Knowledge Operating System</small>
        </span>
      </button>

      <nav className="topbar-nav" aria-label="Основная навигация">
        <button type="button" className="nav-link" onClick={onHome}>Платформа</button>
        <button type="button" className="nav-link" onClick={onReviews}>Отзывы</button>
        {user?.role === 'admin' && <button type="button" className="nav-link admin-link" onClick={onAdmin}>Console</button>}
      </nav>

      <div className="topbar-profile">
        <span className={`service-pill ${health?.ok ? 'online' : ''}`}>
          <span className="service-dot" /> {health?.ok ? `API v${health.version || ''}` : 'API'}
        </span>
        {token && user ? (
          <div className="profile-menu-inline">
            <div className="profile-chip">
              <span className="profile-avatar">{(user.name || user.email || '?')[0].toUpperCase()}</span>
              <div className="profile-meta">
                <div className="profile-name">{user.name || user.email}</div>
                <div className="profile-role">{user.role || 'member'}</div>
              </div>
            </div>
            <button type="button" className="btn-quiet" onClick={onLogout}>Выйти</button>
          </div>
        ) : (
          <button type="button" className="btn-primary compact" onClick={onLogin}>Войти</button>
        )}
      </div>
    </header>
  )
}
