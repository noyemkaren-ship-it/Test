import { apiUrl } from './config'
import { useCallback, useEffect, useMemo, useState } from 'react'
import FlowCanvas from './components/FlowCanvas'
import ChatSidePanel from './components/ChatSidePanel'
import Glossary from './components/Glossary'
import PlatformPanel from './components/PlatformPanel'
import NodeInspector from './components/NodeInspector'
import ActivityFeed from './components/ActivityFeed'
import PathFinder from './components/PathFinder'
import AdminPage from './components/AdminPage'
import LibraryPanel from './components/LibraryPanel'
import LoginPage from './components/LoginPage'
import ReviewsPage from './components/ReviewsPage'
import TopBar from './components/TopBar'
import BottomNav from './components/BottomNav'
import ProfilePage from './components/ProfilePage'
import SettingsPage from './components/SettingsPage'
import { usePreferences } from './preferences'
import { getPersonaFocus } from './graphFocus'

type Page = 'app' | 'admin' | 'login' | 'reviews' | 'profile' | 'settings'

function pageFromHash(): Page {
  const h = window.location.hash
  if (h === '#/admin') return 'admin'
  if (h === '#/login') return 'login'
  if (h === '#/reviews') return 'reviews'
  if (h === '#/profile') return 'profile'
  if (h === '#/settings') return 'settings'
  return 'app'
}

function humanDomainName(graph: any) {
  if (graph.slug === 'bank') return 'Banking'
  if (graph.slug === 'law') return 'Legal'
  return graph.name || graph.slug || 'Domain'
}

export default function App() {
  const { language, tr, relationDepth, motion } = usePreferences()
  const [tab, setTab] = useState('tobe')
  const [nodes, setNodes] = useState<any[]>([])
  const [edges, setEdges] = useState<any[]>([])
  const [pinned, setPinned] = useState<string | null>(null)
  const [highlightIds, setHighlightIds] = useState<string[]>([])
  const [layer, setLayer] = useState('all')
  const [roleView, setRoleView] = useState<string | null>(null)
  const [actors, setActors] = useState<any[]>([])
  const [workItems, setWorkItems] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [workspaceId, setWorkspaceId] = useState(localStorage.getItem('gp_ws') || 'ws-default')
  const [token, setToken] = useState(localStorage.getItem('gp_token') || '')
  const [user, setUser] = useState<any>(null)
  const [health, setHealth] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [present, setPresent] = useState(false)
  const [toast, setToast] = useState('')
  const [graphKey, setGraphKey] = useState(0)
  const [graphLoading, setGraphLoading] = useState(false)
  const [page, setPage] = useState<Page>(() => pageFromHash())
  const [graphs, setGraphs] = useState<any[]>([])
  const [activeGraphId, setActiveGraphId] = useState(localStorage.getItem('gp_graph') || '')
  const [sessionId] = useState(() => {
    const existing = localStorage.getItem('gp_session')
    if (existing) return existing
    const created = globalThis.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem('gp_session', created)
    return created
  })
  const tabs = useMemo(() => [
    { id: 'asis', label: 'As is', hint: tr('Текущее состояние', 'Current state') },
    { id: 'process', label: 'Process', hint: tr('Трансформация', 'Transformation') },
    { id: 'tobe', label: 'To be', hint: tr('Целевая модель', 'Target model') }
  ], [language]) // eslint-disable-line react-hooks/exhaustive-deps
  const notes: Record<string, string> = {
    asis: tr('Фиксирует реальность: системы, роли, знания и разрывы до трансформации.', 'Maps today’s systems, roles, knowledge and transformation gaps.'),
    process: tr('Показывает путь изменений: пилоты, перенос знаний и переходные этапы.', 'Shows pilots, knowledge transfer and every transition stage.'),
    tobe: tr('Целевая operating model: знания, реализация, проекты и ресурсы связаны одним графом.', 'The target operating model connects knowledge, delivery, projects and resources in one graph.')
  }
  const personas = useMemo(() => [
    { id: 'all', icon: '◎', label: tr('Общий вид', 'Overview'), hint: tr('Вся система', 'Entire system') },
    { id: 'mgmt', icon: '◇', label: tr('Руководитель', 'Executive'), hint: tr('Риски и решения', 'Risks & decisions') },
    { id: 'analyst', icon: '◫', label: tr('Аналитик', 'Analyst'), hint: tr('Данные и отчёты', 'Data & reports') },
    { id: 'dev', icon: '⌘', label: tr('Разработчик', 'Developer'), hint: tr('Системы и API', 'Systems & APIs') },
    { id: 'aian', icon: '✦', label: tr('Инженер ИИ', 'AI Engineer'), hint: tr('RAG, модели, eval', 'RAG, models, eval') }
  ], [language]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeGraph = useMemo(() => graphs.find(g => g.id === activeGraphId) || null, [graphs, activeGraphId])
  const layerOptions = useMemo(() => Array.from(new Set(nodes.map(n => n.layer).filter(Boolean))), [nodes])
  const publicGraphs = useMemo(() => graphs.filter(g => (g.visibility || 'public') === 'public'), [graphs])

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (workspaceId) h['X-Workspace-Id'] = workspaceId
    if (activeGraphId) h['X-Graph-Id'] = activeGraphId
    if (sessionId) h['X-Session-Id'] = sessionId
    if (token) h.Authorization = `Bearer ${token}`
    return h
  }, [token, workspaceId, activeGraphId, sessionId])

  function showToast(text: string) {
    setToast(text)
    window.setTimeout(() => setToast(''), 2600)
  }

  function go(target: Page) {
    if (target === 'admin' && user?.role !== 'admin') {
      showToast(tr('Для Console нужен admin-доступ', 'Admin access is required for Console'))
      target = 'login'
    }
    if (target === 'profile' && !token) target = 'login'
    const map: Record<Page, string> = { app: '#/', admin: '#/admin', login: '#/login', reviews: '#/reviews', profile: '#/profile', settings: '#/settings' }
    window.location.hash = map[target]
    setPage(target)
  }

  async function bootstrap() {
    try {
      const h = await fetch(apiUrl('/api/health')).then(r => r.json())
      setHealth(h)
    } catch {
      setHealth({ ok: false })
    }

    if (!token) return
    try {
      const res = await fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error('session expired')
      const data = await res.json()
      setUser(data.user || null)
      if (data.user?.workspaceId) setWorkspaceId(data.user.workspaceId)
    } catch {
      localStorage.removeItem('gp_token')
      setToken('')
      setUser(null)
    }
  }

  async function loadGraphs() {
    try {
      const res = await fetch(apiUrl('/api/graphs'), { headers: headers() })
      if (!res.ok) throw new Error('graphs request failed')
      const data = await res.json()
      const list = Array.isArray(data) ? data : []
      setGraphs(list)
      if (activeGraphId && !list.some(g => g.id === activeGraphId)) setActiveGraphId('')
    } catch (e) {
      console.error('loadGraphs', e)
    }
  }

  async function loadGraph(nextTab = tab) {
    setGraphLoading(true)
    setPinned(null)
    setHighlightIds([])
    try {
      const params = new URLSearchParams({ tab: nextTab })
      if (activeGraphId) params.set('graph_id', activeGraphId)
      const [nRes, eRes] = await Promise.all([
        fetch(apiUrl(`/api/graph/nodes?${params.toString()}`), { headers: headers() }),
        fetch(apiUrl(`/api/graph/edges?${params.toString()}`), { headers: headers() })
      ])
      const [n, e] = await Promise.all([nRes.json(), eRes.json()])
      setNodes(Array.isArray(n) ? n : [])
      setEdges(Array.isArray(e) ? e : [])
      setGraphKey(k => k + 1)
    } catch (e) {
      console.error('loadGraph', e)
      setNodes([])
      setEdges([])
    } finally {
      setGraphLoading(false)
    }
  }

  async function refreshMeta() {
    try {
      const [actorsResult, workResult] = await Promise.all([
        fetch(apiUrl('/api/actors'), { headers: headers() }).then(r => r.json()).catch(() => []),
        fetch(apiUrl('/api/work-items'), { headers: headers() }).then(r => r.json()).catch(() => [])
      ])
      setActors(Array.isArray(actorsResult) ? actorsResult : [])
      setWorkItems(Array.isArray(workResult) ? workResult : [])

      if (token) {
        const p = await fetch(apiUrl('/api/projects'), { headers: headers() }).then(r => r.json()).catch(() => [])
        setProjects(Array.isArray(p) ? p : [])
      } else {
        setProjects([])
      }
    } catch (e) {
      console.error('refreshMeta', e)
    }
  }

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    bootstrap()
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.title = tr('Graph Platform — живая система знаний', 'Graph Platform — living knowledge system')
  }, [language]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { localStorage.setItem('gp_token', token) }, [token])
  useEffect(() => { localStorage.setItem('gp_graph', activeGraphId) }, [activeGraphId])
  useEffect(() => { localStorage.setItem('gp_ws', workspaceId) }, [workspaceId])

  useEffect(() => { loadGraphs() }, [token, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadGraph(tab); refreshMeta() }, [tab, activeGraphId, token, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  function logout() {
    localStorage.removeItem('gp_token')
    localStorage.removeItem('gp_graph')
    setToken('')
    setUser(null)
    setActiveGraphId('')
    setWorkspaceId('ws-default')
    showToast(tr('Сессия завершена', 'Session closed'))
    go('app')
  }

  const q = search.trim().toLowerCase()
  const visibleNodes = useMemo(() => {
    let list = layer === 'all' ? nodes : nodes.filter(n => n.layer === layer)
    if (q) list = list.filter(n => [n.label, n.kind, n.description, n.layer].some(value => String(value || '').toLowerCase().includes(q)))
    return list
  }, [nodes, layer, q])

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map(n => n.id))
    return edges.filter(e => ids.has(e.source) && ids.has(e.target))
  }, [edges, visibleNodes])

  const selectedNode = nodes.find(n => n.id === pinned) || null
  const personaCounts = useMemo(() => Object.fromEntries(personas.map(persona => [
    persona.id,
    persona.id === 'all'
      ? visibleNodes.length
      : getPersonaFocus(visibleNodes, visibleEdges, persona.id, relationDepth).size
  ])), [personas, visibleNodes, visibleEdges, relationDepth])

  const renderPage = (content: React.ReactNode, currentPage: Page) => (
    <div className="app-shell has-bottom-nav">
      {content}
      <BottomNav page={currentPage} isAdmin={user?.role === 'admin'} isLoggedIn={!!token} onNavigate={go} />
    </div>
  )

  if (page === 'login') return renderPage(
    <LoginPage
      onBack={() => go('app')}
      onSuccess={(tk, u) => {
        setToken(tk)
        setUser(u || null)
        if (u?.workspaceId) setWorkspaceId(u.workspaceId)
        showToast(tr('Workspace открыт', 'Workspace opened'))
        go('app')
      }}
    />,
    'login'
  )

  if (page === 'reviews') return renderPage(
    <>
      <TopBar user={user} token={token} health={health} onLogin={() => go('login')} onLogout={logout} onAdmin={() => go('admin')} onReviews={() => go('reviews')} onSettings={() => go('settings')} onHome={() => go('app')} />
      <ReviewsPage headers={headers} onBack={() => go('app')} />
    </>,
    'reviews'
  )

  if (page === 'admin') return renderPage(<AdminPage token={token} onBack={() => go('app')} />, 'admin')

  if (page === 'profile') return renderPage(
    <>
      <TopBar user={user} token={token} health={health} onLogin={() => go('login')} onLogout={logout} onAdmin={() => go('admin')} onReviews={() => go('reviews')} onSettings={() => go('settings')} onHome={() => go('app')} />
      <ProfilePage user={user} onLogout={logout} onBack={() => go('app')} />
    </>,
    'profile'
  )

  if (page === 'settings') return renderPage(
    <>
      <TopBar user={user} token={token} health={health} onLogin={() => go('login')} onLogout={logout} onAdmin={() => go('admin')} onReviews={() => go('reviews')} onSettings={() => go('settings')} onHome={() => go('app')} />
      <SettingsPage onBack={() => go('app')} />
    </>,
    'settings'
  )

  return (
    <div className={`app-shell has-bottom-nav product-shell ${present ? 'present' : ''}`}>
      {!present && <TopBar user={user} token={token} health={health} onLogin={() => go('login')} onLogout={logout} onAdmin={() => go('admin')} onReviews={() => go('reviews')} onSettings={() => go('settings')} onHome={() => go('app')} />}

      <main className="app-main product-main">
	        {!present && (
	          <section className="product-hero">
	            <div className="hero-copy">
	              <div className="hero-kicker"><span className="pulse-dot" /> Knowledge Intelligence Platform</div>
	              <h1>{tr('Смотрите на систему', 'See the system')} <span>{tr('с любой точки зрения.', 'from every point of view.')}</span></h1>
	              <p>
	                {tr(
	                  'Graph Platform связывает знания, процессы, команды и AI в живую карту — с персональными проекциями для руководителя, аналитика, разработчика и инженера ИИ.',
	                  'Graph Platform connects knowledge, processes, teams and AI in one living map — with dedicated perspectives for executives, analysts, developers and AI engineers.'
	                )}
	              </p>
	              <div className="hero-actions">
	                <button type="button" className="btn-primary" onClick={() => document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' })}>{tr('Исследовать граф', 'Explore the graph')} <span aria-hidden>↘</span></button>
	                <button type="button" className="btn-secondary" onClick={() => go('settings')}>{tr('Настроить вид', 'Personalize view')} <span aria-hidden>⚙</span></button>
	              </div>
	              <div className="trust-row">
	                <span>◉ {tr('Публичные домены без входа', 'Public domains, no sign-in')}</span>
	                <span>◆ {tr('Гибридный offline AI', 'Hybrid offline AI')}</span>
	                <span>◇ {tr('Безопасные workspace', 'Tenant-safe workspaces')}</span>
	              </div>
	            </div>

	            <div className="hero-visual">
	              <img src="/images/graph-collaboration.webp" alt={tr('Команда исследует пространственный граф знаний', 'A team explores a spatial knowledge graph')} decoding="async" fetchPriority="high" />
	              <div className="hero-visual-shade" />
	              <div className="hero-console" aria-label={tr('Состояние платформы', 'Platform status')}>
	                <div className="console-top"><span>LIVE CONTEXT</span><span className={health?.ok ? 'online-text' : 'muted'}>{health?.ok ? '● ONLINE' : '○ CHECKING'}</span></div>
	                <div className="console-kpis">
	                  <div><b>{nodes.length}</b><small>{tr('узлов', 'nodes')}</small></div>
	                  <div><b>{edges.length}</b><small>{tr('связей', 'relations')}</small></div>
	                  <div><b>{publicGraphs.length}</b><small>{tr('доменов', 'domains')}</small></div>
	                </div>
	                <div className="console-line"><span>Graph + RAG</span><i /><em>{tr('готово', 'ready')}</em></div>
	              </div>
	            </div>
	          </section>
	        )}

        {!present && (
	          <section className="domain-section" aria-labelledby="domains-title">
	            <div className="section-heading">
	              <div><p className="eyebrow">Public knowledge catalog</p><h2 id="domains-title">{tr('Домены знаний', 'Knowledge domains')}</h2></div>
	              <button type="button" className={`btn-quiet ${!activeGraphId ? 'active' : ''}`} onClick={() => setActiveGraphId('')}>{tr('Все домены', 'All domains')}</button>
            </div>
            <div className="domain-grid">
              {graphs.map((graph, index) => (
                <button key={graph.id} type="button" className={`domain-card ${activeGraphId === graph.id ? 'active' : ''}`} onClick={() => setActiveGraphId(graph.id)}>
                  <span className="domain-number">0{index + 1}</span>
                  <span className="domain-icon">{graph.slug === 'bank' ? '₿' : graph.slug === 'law' ? '§' : '◇'}</span>
                  <strong>{humanDomainName(graph)}</strong>
	                  <small>{graph.description || tr('Домен знаний', 'Knowledge domain')}</small>
	                  <span className="domain-meta"><b>{graph.nodeCount ?? '—'}</b> {tr('узлов', 'nodes')} · <b>{graph.edgeCount ?? '—'}</b> {tr('связей', 'links')} · {graph.visibility || 'public'}</span>
	                </button>
	              ))}
	              {!graphs.length && <div className="domain-empty">{tr('API доступен, но опубликованных доменов пока нет.', 'The API is available, but there are no published domains yet.')}</div>}
	            </div>
	          </section>
	        )}

	        {!present && (
	          <section className="perspective-story">
	            <div className="story-photo">
	              <img src="/images/graph-connections.webp" alt={tr('Рука выбирает связь в графе знаний', 'A hand selects a relation in a knowledge graph')} loading="lazy" decoding="async" />
	              <span className="story-photo-label"><i /> {tr('Живой контекст', 'Living context')}</span>
	            </div>
	            <div className="story-copy">
	              <p className="eyebrow">{tr('Ролевые проекции', 'Role perspectives')}</p>
	              <h2>{tr('Один граф. Разные вопросы. Никакого информационного шума.', 'One graph. Different questions. Zero information noise.')}</h2>
	              <p>{tr(
	                'Выберите рабочую роль — платформа выделит значимые узлы, активирует относящиеся к ним связи и приглушит всё второстепенное. Клик по любому узлу раскрывает его контекст до двух уровней.',
	                'Choose a working role and the platform highlights meaningful nodes, activates their relations and quiets everything else. Click any node to reveal up to two levels of context.'
	              )}</p>
	              <div className="story-stats">
	                <div><strong>4</strong><span>{tr('ролевые линзы', 'role lenses')}</span></div>
	                <div><strong>{relationDepth}×</strong><span>{tr('глубина связей', 'relation depth')}</span></div>
	                <div><strong>∞</strong><span>{tr('контекстов', 'contexts')}</span></div>
	              </div>
	            </div>
	          </section>
	        )}

	        <section id="workspace" className={`graph-workspace ${present ? 'presentation-mode' : ''}`}>
          {!present && (
            <aside className="graph-sidebar">
	              <div className="side-head"><span className="side-icon">⌘</span><div><strong>Graph Control</strong><small>{activeGraph ? humanDomainName(activeGraph) : tr('Все публичные домены', 'All public domains')}</small></div></div>

	              <label className="control-label">{tr('Домен / граф', 'Domain / graph')}
	                <select className="field control-field" value={activeGraphId} onChange={e => setActiveGraphId(e.target.value)}>
	                  <option value="">{tr('Все опубликованные', 'All published')}</option>
                  {graphs.map(g => <option key={g.id} value={g.id}>{g.name} · {g.visibility || 'public'}</option>)}
                </select>
              </label>

	              <label className="control-label">{tr('Поиск', 'Search')}
	                <input className="field control-field" value={search} onChange={e => setSearch(e.target.value)} placeholder={tr('Узел, слой, описание…', 'Node, layer, description…')} />
              </label>

              <div className="control-group">
	                <span className="control-label plain">{tr('Состояние', 'State')}</span>
	                <div className="segmented vertical-on-mobile">
	                  {tabs.map(t => <button key={t.id} type="button" title={t.hint} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
	                </div>
	                <p className="control-help">{notes[tab]}</p>
	              </div>

	              <div className="control-group">
	                <span className="control-label plain">{tr('Проекция слоя', 'Layer projection')}</span>
	                <div className="filter-stack">
	                  <button type="button" className={layer === 'all' ? 'on' : ''} onClick={() => setLayer('all')}><span>{tr('Все слои', 'All layers')}</span><b>{nodes.length}</b></button>
                  {layerOptions.map(name => (
                    <button key={name} type="button" className={layer === name ? 'on' : ''} onClick={() => setLayer(String(name))}>
                      <span>{String(name)}</span><b>{nodes.filter(n => n.layer === name).length}</b>
                    </button>
                  ))}
                </div>
              </div>

	              <div className="control-group context-control">
	                <span className="control-label plain">{tr('Глубина контекста', 'Context depth')}</span>
	                <button type="button" className="context-depth-button" onClick={() => go('settings')}>
	                  <span><b>{relationDepth}×</b>{tr('уровня связей', 'relation levels')}</span><i>⚙</i>
	                </button>
	              </div>

	              <div className="side-status">
	                <div><span className="service-dot" /> <b>{visibleNodes.length}</b> {tr('видимых узлов', 'visible nodes')}</div>
	                <div>{tr('Связи', 'Relations')} <b>{visibleEdges.length}</b></div>
	              </div>
            </aside>
          )}

          <div className="graph-stage">
            <div className="stage-toolbar">
              <div>
	                <p className="eyebrow">{tr('Интерактивная карта', 'Interactive map')}</p>
	                <h2>{activeGraph?.name || tr('Междоменная карта знаний', 'Cross-domain knowledge map')}</h2>
              </div>
              <div className="stage-actions">
	                {graphLoading && <span className="loading-pill">{tr('Синхронизация…', 'Syncing…')}</span>}
	                <button type="button" className="btn-quiet" onClick={() => setPresent(!present)}>{present ? tr('Выйти', 'Exit') : tr('Презентация', 'Present')}</button>
	              </div>
	            </div>

	            {!present && (
	              <div className="perspective-dock" aria-label={tr('Выбор ролевой проекции', 'Role perspective selector')}>
	                <div className="perspective-dock-label"><span>{tr('Смотреть как', 'View as')}</span><small>{tr('Связанные узлы подсветятся автоматически', 'Related nodes highlight automatically')}</small></div>
	                <div className="perspective-buttons">
	                  {personas.map(persona => {
	                    const active = persona.id === 'all' ? !roleView : roleView === persona.id
	                    return (
	                      <button
	                        key={persona.id}
	                        type="button"
	                        className={active ? 'active' : ''}
	                        aria-pressed={active}
	                        onClick={() => {
	                          setRoleView(persona.id === 'all' ? null : persona.id)
	                          setPinned(null)
	                          setHighlightIds([])
	                        }}
	                      >
	                        <span className="persona-icon" aria-hidden>{persona.icon}</span>
	                        <span><strong>{persona.label}</strong><small>{persona.hint}</small></span>
	                        <b>{personaCounts[persona.id] || 0}</b>
	                      </button>
	                    )
	                  })}
	                </div>
	              </div>
	            )}

	            <div className={`flow-wrap premium-flow ${present ? 'flow-present' : ''}`}>
	              {!visibleNodes.length ? (
	                <div className="flow-empty premium-empty"><span>◇</span><strong>{tr('Нет узлов в этой проекции', 'No nodes in this perspective')}</strong><small>{tr('Смените домен, состояние или слой.', 'Change the domain, state or layer.')}</small></div>
	              ) : (
                <FlowCanvas
                  key={`graph-${tab}-${layer}-${graphKey}`}
                  nodes={visibleNodes}
                  edges={visibleEdges}
                  pinned={pinned}
                  highlightIds={highlightIds}
	                  roleView={roleView}
	                  activeTab={tab}
	                  relationDepth={relationDepth}
	                  motion={motion}
                  onPin={(id: string | null) => { setPinned(id); setHighlightIds(id ? [id] : []) }}
                />
              )}
            </div>

            {!present && (
              <div className="stage-foot">
                <span><i className="legend-dot knowledge" /> Knowledge</span>
                <span><i className="legend-dot implementation" /> Implementation</span>
                <span><i className="legend-dot project" /> Project</span>
                <span><i className="legend-dot resource" /> Resource</span>
	                <span className="stage-hint">{tr('Нажмите узел → увидеть связанные элементы', 'Click a node → reveal its context')}</span>
              </div>
            )}
          </div>
        </section>

        {!present && selectedNode && (
          <NodeInspector
            node={selectedNode}
            edges={edges}
            nodes={nodes}
            onClose={() => { setPinned(null); setHighlightIds([]) }}
            onFocusRelated={(ids: string[]) => { setHighlightIds(ids); setPinned(ids[0] || null) }}
          />
        )}

        {!present && (
	          <>
	            <section className="utility-grid">
	              <div className="utility-column"><PathFinder nodes={nodes} edges={edges} onPath={(ids: string[]) => { setHighlightIds(ids); if (ids[0]) setPinned(ids[0]); showToast(ids.length ? tr('Путь найден', 'Path found') : tr('Путь не найден', 'Path not found')) }} /></div>
	              <div className="utility-column"><Glossary onSelect={(ids: string[]) => { setHighlightIds(ids); setPinned(ids[0] || null); showToast(tr('Контекст подсвечен', 'Context highlighted')) }} activeIds={highlightIds} /></div>
	            </section>

            <section id="copilot" className="copilot-product-section">
              <div className="copilot-copy">
                <p className="eyebrow">Graph-native intelligence</p>
	                <h2>{tr('Copilot понимает не страницу. Он понимает контекст.', 'Copilot understands more than the page. It understands context.')}</h2>
	                <p>{tr(
	                  'Текущий домен, выбранные узлы, связи, Work Items и RAG передаются как единый контекст. Если облачный LLM недоступен, тот же контекст получает локальный hybrid AI.',
	                  'The current domain, selected nodes, relations, Work Items and RAG become one shared context. If the cloud LLM is unavailable, the same context is handled by local hybrid AI.'
	                )}</p>
                <div className="ai-capabilities">
                  <span>BM25 + fuzzy retrieval</span><span>Graph context</span><span>Conversation memory</span><span>Source-aware answers</span>
                </div>
              </div>
              <div className="copilot-shell">
                <ChatSidePanel selectedNodeIds={pinned ? [pinned] : highlightIds} tab={tab} headers={headers} />
              </div>
            </section>

            <section className="insight-grid">
              <ActivityFeed headers={headers} />
              <PlatformPanel actors={actors} workItems={workItems} engines={health?.engines || []} layers={layerOptions} onTransition={async (id: string, event: string) => {
                const res = await fetch(apiUrl(`/api/fsm/${id}/transition`), { method: 'POST', headers: headers(), body: JSON.stringify({ event }) })
	                if (!res.ok) showToast(tr('Для изменения FSM нужен доступ', 'Access is required to update the FSM'))
              }} />
            </section>

            {token ? (
              <section className="private-workspace-section">
                <div className="section-heading"><div><p className="eyebrow">Authenticated workspace</p><h2>Library & reusable assets</h2></div><span className="service-pill online"><span className="service-dot" /> private</span></div>
                <LibraryPanel headers={headers} workspaceId={workspaceId} projects={projects} />
              </section>
	            ) : (
	              <section className="login-cta">
	                <div><p className="eyebrow">Private layer</p><h2>{tr('Публичный граф — без регистрации. Управление — после входа.', 'Explore public graphs freely. Sign in when you need control.')}</h2><p>{tr('Авторизация открывает workspace, шаблоны, роли, историю и административные операции, не закрывая публичный каталог.', 'Authentication unlocks workspaces, templates, roles, history and administration without hiding the public catalog.')}</p></div>
	                <button type="button" className="btn-primary" onClick={() => go('login')}>{tr('Открыть workspace', 'Open workspace')}</button>
              </section>
            )}

            <footer className="product-footer">
              <div><span className="brand-mark small"><span>G</span></span><strong>Graph Platform</strong></div>
              <p>Graph · Ontology · RAG · FSM · Hybrid AI · Workspace · Knowledge Packages</p>
              <small>Public read / protected write architecture</small>
            </footer>
          </>
        )}
      </main>

      {toast && <div className="toast premium-toast">{toast}</div>}
      {!present && <BottomNav page="app" isAdmin={user?.role === 'admin'} isLoggedIn={!!token} onNavigate={go} />}
    </div>
  )
}
