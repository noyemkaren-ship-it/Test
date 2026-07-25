import { usePreferences, type Accent, type Language, type RelationDepth, type ThemePreference } from '../preferences'

type Choice<T extends string | number> = {
  value: T
  icon: string
  title: string
  description: string
}

function ChoiceGrid<T extends string | number>({
  value,
  choices,
  onChange,
  ariaLabel
}: {
  value: T
  choices: Choice<T>[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div className="settings-choice-grid" role="radiogroup" aria-label={ariaLabel}>
      {choices.map(choice => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          data-value={choice.value}
          aria-checked={choice.value === value}
          className={`settings-choice ${choice.value === value ? 'active' : ''}`}
          onClick={() => onChange(choice.value)}
        >
          <span className="settings-choice-icon" aria-hidden>{choice.icon}</span>
          <span><strong>{choice.title}</strong><small>{choice.description}</small></span>
          <i className="choice-check" aria-hidden>✓</i>
        </button>
      ))}
    </div>
  )
}

export default function SettingsPage({ onBack }: { onBack: () => void }) {
  const {
    language,
    setLanguage,
    theme,
    setTheme,
    accent,
    setAccent,
    motion,
    setMotion,
    relationDepth,
    setRelationDepth,
    tr
  } = usePreferences()

  const languageChoices: Choice<Language>[] = [
    { value: 'ru', icon: 'RU', title: 'Русский', description: 'Интерфейс на русском языке' },
    { value: 'en', icon: 'EN', title: 'English', description: 'English interface language' }
  ]
  const themeChoices: Choice<ThemePreference>[] = [
    { value: 'dark', icon: '◐', title: tr('Тёмная', 'Dark'), description: tr('Глубокий контраст для графов', 'Deep contrast for graph work') },
    { value: 'light', icon: '○', title: tr('Светлая', 'Light'), description: tr('Чистый режим для дневной работы', 'Clean mode for daylight work') },
    { value: 'system', icon: '◒', title: tr('Системная', 'System'), description: tr('Следовать настройкам устройства', 'Follow your device settings') }
  ]
  const accentChoices: Choice<Accent>[] = [
    { value: 'violet', icon: '●', title: tr('Aurora', 'Aurora'), description: tr('Фиолетовый + бирюзовый', 'Violet + teal') },
    { value: 'cyan', icon: '●', title: tr('Signal', 'Signal'), description: tr('Голубой + мятный', 'Blue + mint') },
    { value: 'sunset', icon: '●', title: tr('Ember', 'Ember'), description: tr('Коралловый + золотой', 'Coral + gold') }
  ]
  const depthChoices: Choice<RelationDepth>[] = [
    { value: 1, icon: '1×', title: tr('Ближайшие', 'Direct'), description: tr('Только прямые связи узла', 'Only direct node relations') },
    { value: 2, icon: '2×', title: tr('Контекст', 'Context'), description: tr('Связи второго уровня', 'Second-degree relations') }
  ]

  return (
    <main className="settings-page">
      <section className="settings-hero">
        <div>
          <button type="button" className="settings-back" onClick={onBack}>← {tr('Вернуться к графу', 'Back to graph')}</button>
          <p className="eyebrow">{tr('Персональное пространство', 'Personal workspace')}</p>
          <h1>{tr('Настройки', 'Settings')}</h1>
          <p>{tr(
            'Настройте язык, тему и глубину визуального контекста. Выбор сохраняется на этом устройстве.',
            'Tune language, appearance and graph context depth. Your choices stay on this device.'
          )}</p>
        </div>
        <div className="settings-preview" aria-hidden>
          <span className="preview-orbit orbit-one" />
          <span className="preview-orbit orbit-two" />
          <span className="preview-core">G</span>
          <i className="preview-node n1" /><i className="preview-node n2" /><i className="preview-node n3" />
        </div>
      </section>

      <section className="settings-layout">
        <article className="settings-card">
          <div className="settings-card-head"><span>01</span><div><h2>{tr('Язык', 'Language')}</h2><p>{tr('Меняет основные элементы интерфейса.', 'Changes the main interface language.')}</p></div></div>
          <ChoiceGrid value={language} choices={languageChoices} onChange={setLanguage} ariaLabel={tr('Выбор языка', 'Language selection')} />
        </article>

        <article className="settings-card">
          <div className="settings-card-head"><span>02</span><div><h2>{tr('Тема', 'Theme')}</h2><p>{tr('Комфортный режим в любое время суток.', 'A comfortable mode at any time of day.')}</p></div></div>
          <ChoiceGrid value={theme} choices={themeChoices} onChange={setTheme} ariaLabel={tr('Выбор темы', 'Theme selection')} />
        </article>

        <article className="settings-card">
          <div className="settings-card-head"><span>03</span><div><h2>{tr('Акцент', 'Accent')}</h2><p>{tr('Цвет активных узлов и связей.', 'Color for active nodes and relations.')}</p></div></div>
          <ChoiceGrid value={accent} choices={accentChoices} onChange={setAccent} ariaLabel={tr('Выбор акцента', 'Accent selection')} />
        </article>

        <article className="settings-card">
          <div className="settings-card-head"><span>04</span><div><h2>{tr('Поведение графа', 'Graph behavior')}</h2><p>{tr('Управляйте глубиной контекста и движением.', 'Control context depth and motion.')}</p></div></div>
          <ChoiceGrid value={relationDepth} choices={depthChoices} onChange={setRelationDepth} ariaLabel={tr('Глубина связей', 'Relation depth')} />
          <label className="settings-toggle">
            <span><strong>{tr('Живые анимации', 'Live motion')}</strong><small>{tr('Анимировать активные связи и переходы', 'Animate active relations and transitions')}</small></span>
            <input type="checkbox" checked={motion} onChange={event => setMotion(event.target.checked)} />
            <i aria-hidden />
          </label>
        </article>
      </section>

      <div className="settings-note">
        <span>✓</span>
        <div><strong>{tr('Сохраняется автоматически', 'Saved automatically')}</strong><p>{tr('Настройки уже применены ко всей платформе.', 'Your settings are already applied across the platform.')}</p></div>
      </div>
    </main>
  )
}
