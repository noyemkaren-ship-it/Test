import { usePreferences } from '../preferences'

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
  onNavigate: (p: 'app' | 'reviews' | 'login' | 'admin' | 'profile' | 'settings') => void
}) {
  const { tr } = usePreferences()

  return (
    <nav className="bottom-nav" aria-label={tr('Основная навигация', 'Main navigation')}>
      <button
        type="button"
        className={`bnav-item ${page === 'app' ? 'on' : ''}`}
        onClick={() => onNavigate('app')}
      >
        <span className="bnav-icon" aria-hidden>◈</span>
        <span className="bnav-label">{tr('Граф', 'Graph')}</span>
      </button>

      <button
        type="button"
        className={`bnav-item ${page === 'reviews' ? 'on' : ''}`}
        onClick={() => onNavigate('reviews')}
      >
        <span className="bnav-icon star" aria-hidden>★</span>
        <span className="bnav-label">{tr('Отзывы', 'Reviews')}</span>
      </button>

      <button
        type="button"
        className={`bnav-item ${page === 'login' || page === 'profile' ? 'on' : ''}`}
        onClick={() => onNavigate(isLoggedIn ? 'profile' : 'login')}
      >
        <span className="bnav-icon" aria-hidden>☺</span>
        <span className="bnav-label">{isLoggedIn ? tr('Профиль', 'Profile') : tr('Вход', 'Sign in')}</span>
      </button>

      <button
        type="button"
        className={`bnav-item ${page === 'settings' ? 'on' : ''}`}
        onClick={() => onNavigate('settings')}
      >
        <span className="bnav-icon" aria-hidden>⚙</span>
        <span className="bnav-label">{tr('Настройки', 'Settings')}</span>
      </button>

      {isAdmin && (
        <button
          type="button"
          className={`bnav-item admin ${page === 'admin' ? 'on' : ''}`}
          onClick={() => onNavigate('admin')}
        >
          <span className="bnav-icon" aria-hidden>🛡</span>
          <span className="bnav-label">{tr('Админ', 'Admin')}</span>
        </button>
      )}
    </nav>
  )
}
