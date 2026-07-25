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

const TABS = [
  { id: 'asis', label: 'As is', hint: 'Текущее состояние' },
  { id: 'process', label: 'Process', hint: 'Трансформация' },
  { id: 'tobe', label: 'To be', hint: 'Целевая модель' }
]

const NOTES: Record<string, string> = {
  asis: 'Фиксирует реальность: системы, роли, знания и разрывы до трансформации.',
  process: 'Показывает путь изменений: пилоты, перенос знаний и переходные этапы.',
  tobe: 'Целевая knowledge operating model: знания, реализация, проекты и ресурсы связаны одним графом.'
}

type Page = 'app' | 'admin' | 'login' | 'reviews' | 'profile'

function pageFromHash(): Page {
  const h = window.location.hash
  if (h === '#/admin') return 'admin'
  if (h === '#/login') return 'login'
  if (h === '#/reviews') return 'reviews'
  if (h === '#/profile') return 'profile'
  return 'app'
}

function humanDomainName(graph: any) {
  if (graph.slug === 'bank') return 'Banking'
  if (graph.slug === 'law') return 'Legal'
  return graph.name || graph.slug || 'Domain'
}

export default function App() {
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
      showToast('Для Console нужен admin-доступ')
      target = 'login'
    }
    if (target === 'profile' && !token) target = 'login'
    const map: Record<Page, string> = { app: '#/', admin: '#/admin', login: '#/login', reviews: '#/reviews', profile: '#/profile' }
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
    showToast('Сессия завершена')
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
  const roles = tab === 'tobe'
    ? [{ id: 'mgmt', label: 'Руководство' }, { id: 'econ', label: 'Экономист' }, { id: 'aian', label: 'Инженер ИИ' }, { id: 'dev', label: 'Разработчик' }]
    : []

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
        showToast('Workspace открыт')
        go('app')
      }}
    />,
    'login'
  )

  if (page === 'reviews') return renderPage(
    <>
      <TopBar user={user} token={token} health={health} onLogin={() => go('login')} onLogout={logout} onAdmin={() => go('admin')} onReviews={() => go('reviews')} onHome={() => go('app')} />
      <ReviewsPage headers={headers} onBack={() => go('app')} />
    </>,
    'reviews'
  )

  if (page === 'admin') return renderPage(<AdminPage token={token} onBack={() => go('app')} />, 'admin')

  if (page === 'profile') return renderPage(
    <>
      <TopBar user={user} token={token} health={health} onLogin={() => go('login')} onLogout={logout} onAdmin={() => go('admin')} onReviews={() => go('reviews')} onHome={() => go('app')} />
      <ProfilePage user={user} onLogout={logout} onBack={() => go('app')} />
    </>,
    'profile'
  )

  return (
    <div className={`app-shell has-bottom-nav product-shell ${present ? 'present' : ''}`}>
      {!present && <TopBar user={user} token={token} health={health} onLogin={() => go('login')} onLogout={logout} onAdmin={() => go('admin')} onReviews={() => go('reviews')} onHome={() => go('app')} />}

      <main className="app-main product-main">
        {!present && (
          <section className="product-hero">
            <div className="hero-copy">
              <div className="hero-kicker"><span className="pulse-dot" /> Knowledge Operating System</div>
              <h1>Знания, процессы и AI — <span>в одном живом графе.</span></h1>
              <p>
                Graph Platform превращает разрозненные регламенты, данные, роли и проекты в управляемую модель,
                где человек и Copilot работают с одной системой контекста.
              </p>
              <div className="hero-actions">
                <button type="button" className="btn-primary" onClick={() => document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' })}>Открыть граф</button>
                <button type="button" className="btn-secondary" onClick={() => document.getElementById('copilot')?.scrollIntoView({ behavior: 'smooth' })}>Спросить Copilot</button>
              </div>
              <div className="trust-row">
                <span>◉ Public domains без login</span>
                <span>◆ Hybrid offline AI</span>
                <span>◇ Tenant-safe writes</span>
              </div>
            </div>

            <div className="hero-console" aria-label="Состояние платформы">
              <div className="console-top"><span>LIVE PLATFORM</span><span className={health?.ok ? 'online-text' : 'muted'}>{health?.ok ? '● ONLINE' : '○ CHECKING'}</span></div>
              <div className="console-metric"><strong>{publicGraphs.length}</strong><span>published domains</span></div>
              <div className="console-grid">
                <div><b>{nodes.length}</b><small>nodes in view</small></div>
                <div><b>{edges.length}</b><small>relations</small></div>
                <div><b>{health?.llmMode === 'offline-first' ? 'LOCAL' : 'HYBRID'}</b><small>AI mode</small></div>
                <div><b>{health?.version || '3.0'}</b><small>platform</small></div>
              </div>
              <div className="console-line"><span>Graph engine</span><i /><em>ready</em></div>
              <div className="console-line"><span>RAG + context</span><i /><em>ready</em></div>
              <div className="console-line"><span>Offline intelligence</span><i /><em>ready</em></div>
            </div>
          </section>
        )}

        {!present && (
          <section className="domain-section" aria-labelledby="domains-title">
            <div className="section-heading">
              <div><p className="eyebrow">Public knowledge catalog</p><h2 id="domains-title">Домены</h2></div>
              <button type="button" className={`btn-quiet ${!activeGraphId ? 'active' : ''}`} onClick={() => setActiveGraphId('')}>Все домены</button>
            </div>
            <div className="domain-grid">
              {graphs.map((graph, index) => (
                <button key={graph.id} type="button" className={`domain-card ${activeGraphId === graph.id ? 'active' : ''}`} onClick={() => setActiveGraphId(graph.id)}>
                  <span className="domain-number">0{index + 1}</span>
                  <span className="domain-icon">{graph.slug === 'bank' ? '₿' : graph.slug === 'law' ? '§' : '◇'}</span>
                  <strong>{humanDomainName(graph)}</strong>
                  <small>{graph.description || 'Knowledge domain'}</small>
                  <span className="domain-meta"><b>{graph.nodeCount ?? '—'}</b> nodes · <b>{graph.edgeCount ?? '—'}</b> links · {graph.visibility || 'public'}</span>
                </button>
              ))}
              {!graphs.length && <div className="domain-empty">API доступен, но опубликованных доменов пока нет.</div>}
            </div>
          </section>
        )}

        <section id="workspace" className={`graph-workspace ${present ? 'presentation-mode' : ''}`}>
          {!present && (
            <aside className="graph-sidebar">
              <div className="side-head"><span className="side-icon">⌘</span><div><strong>Graph Control</strong><small>{activeGraph ? humanDomainName(activeGraph) : 'All public domains'}</small></div></div>

              <label className="control-label">Domain / graph
                <select className="field control-field" value={activeGraphId} onChange={e => setActiveGraphId(e.target.value)}>
                  <option value="">Все опубликованные</option>
                  {graphs.map(g => <option key={g.id} value={g.id}>{g.name} · {g.visibility || 'public'}</option>)}
                </select>
              </label>

              <label className="control-label">Search
                <input className="field control-field" value={search} onChange={e => setSearch(e.target.value)} placeholder="Узел, слой, описание…" />
              </label>

              <div className="control-group">
                <span className="control-label plain">State</span>
                <div className="segmented vertical-on-mobile">
                  {TABS.map(t => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
                </div>
                <p className="control-help">{NOTES[tab]}</p>
              </div>

              <div className="control-group">
                <span className="control-label plain">Layer projection</span>
                <div className="filter-stack">
                  <button type="button" className={layer === 'all' ? 'on' : ''} onClick={() => setLayer('all')}><span>All layers</span><b>{nodes.length}</b></button>
                  {layerOptions.map(name => (
                    <button key={name} type="button" className={layer === name ? 'on' : ''} onClick={() => setLayer(String(name))}>
                      <span>{String(name)}</span><b>{nodes.filter(n => n.layer === name).length}</b>
                    </button>
                  ))}
                </div>
              </div>

              {!!roles.length && (
                <div className="control-group">
                  <span className="control-label plain">Role projection</span>
                  <select className="field control-field" value={roleView || ''} onChange={e => setRoleView(e.target.value || null)}>
                    <option value="">Без проекции</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
              )}

              <div className="side-status">
                <div><span className="service-dot" /> <b>{visibleNodes.length}</b> visible nodes</div>
                <div>Relations <b>{visibleEdges.length}</b></div>
              </div>
            </aside>
          )}

          <div className="graph-stage">
            <div className="stage-toolbar">
              <div>
                <p className="eyebrow">Transformation graph</p>
                <h2>{activeGraph?.name || 'Cross-domain knowledge map'}</h2>
              </div>
              <div className="stage-actions">
                {graphLoading && <span className="loading-pill">Syncing…</span>}
                <button type="button" className="btn-quiet" onClick={() => setPresent(!present)}>{present ? 'Выйти' : 'Презентация'}</button>
              </div>
            </div>

            <div className={`flow-wrap premium-flow ${present ? 'flow-present' : ''}`}>
              {!visibleNodes.length ? (
                <div className="flow-empty premium-empty"><span>◇</span><strong>Нет узлов в этой проекции</strong><small>Смените домен, состояние или слой.</small></div>
              ) : (
                <FlowCanvas
                  key={`graph-${tab}-${layer}-${graphKey}`}
                  nodes={visibleNodes}
                  edges={visibleEdges}
                  pinned={pinned}
                  highlightIds={highlightIds}
                  roleView={layer === 'all' ? roleView : null}
                  activeTab={tab}
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
                <span className="stage-hint">Click node → focus context</span>
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
              <div className="utility-column"><PathFinder nodes={nodes} edges={edges} onPath={(ids: string[]) => { setHighlightIds(ids); if (ids[0]) setPinned(ids[0]); showToast(ids.length ? 'Путь найден' : 'Путь не найден') }} /></div>
              <div className="utility-column"><Glossary onSelect={(ids: string[]) => { setHighlightIds(ids); setPinned(ids[0] || null); showToast('Контекст подсвечен') }} activeIds={highlightIds} /></div>
            </section>

            <section id="copilot" className="copilot-product-section">
              <div className="copilot-copy">
                <p className="eyebrow">Graph-native intelligence</p>
                <h2>Copilot понимает не страницу. Он понимает контекст.</h2>
                <p>Текущий домен, выбранные узлы, связи, Work Items и RAG передаются как единый контекст. При недоступности облачного LLM тот же контекст получает локальный hybrid AI.</p>
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
                if (!res.ok) showToast('Для изменения FSM нужен доступ')
              }} />
            </section>

            {token ? (
              <section className="private-workspace-section">
                <div className="section-heading"><div><p className="eyebrow">Authenticated workspace</p><h2>Library & reusable assets</h2></div><span className="service-pill online"><span className="service-dot" /> private</span></div>
                <LibraryPanel headers={headers} workspaceId={workspaceId} projects={projects} />
              </section>
            ) : (
              <section className="login-cta">
                <div><p className="eyebrow">Private layer</p><h2>Публичный граф — без регистрации. Управление — после входа.</h2><p>Авторизация открывает workspace, шаблоны, role bindings, историю и административные операции, не закрывая публичный каталог.</p></div>
                <button type="button" className="btn-primary" onClick={() => go('login')}>Открыть workspace</button>
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
