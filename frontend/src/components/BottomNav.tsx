/** Нижняя панель навигации (как WB) — всегда видна */
export default function BottomNav({
  page,
  isAdmin,
  isLoggedIn,
  onNavigate
}: {
  page: string
  isAdmin: boolean
  isLoggedIn: boolean
  onNavigate: (p: 'app' | 'reviews' | 'login' | 'admin' | 'profile') => void
}) {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      <button
        type="button"
        className={`bnav-item ${page === 'app' ? 'on' : ''}`}
        onClick={() => onNavigate('app')}
      >
        <span className="bnav-icon" aria-hidden>◈</span>
        <span className="bnav-label">Граф</span>
      </button>

      <button
        type="button"
        className={`bnav-item ${page === 'reviews' ? 'on' : ''}`}
        onClick={() => onNavigate('reviews')}
      >
        <span className="bnav-icon star" aria-hidden>★</span>
        <span className="bnav-label">Отзывы</span>
      </button>

      <button
        type="button"
        className={`bnav-item ${page === 'login' || page === 'profile' ? 'on' : ''}`}
        onClick={() => onNavigate(isLoggedIn ? 'profile' : 'login')}
      >
        <span className="bnav-icon" aria-hidden>☺</span>
        <span className="bnav-label">{isLoggedIn ? 'Профиль' : 'Вход'}</span>
      </button>

      {isAdmin && (
        <button
          type="button"
          className={`bnav-item admin ${page === 'admin' ? 'on' : ''}`}
          onClick={() => onNavigate('admin')}
        >
          <span className="bnav-icon" aria-hidden>🛡</span>
          <span className="bnav-label">Админ</span>
        </button>
      )}
    </nav>
  )
}
