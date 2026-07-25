import { useEffect, useMemo, useState } from 'react'
import { apiUrl } from '../config'

type AdminTab = 'overview' | 'domains' | 'import' | 'users' | 'ai' | 'system'

export default function AdminPage({ token, onBack }: { token: string; onBack: () => void }) {
  const [tab, setTab] = useState<AdminTab>('overview')
  const [summary, setSummary] = useState<any>(null)
  const [health, setHealth] = useState<any>(null)
  const [graphs, setGraphs] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [questions, setQuestions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [importJson, setImportJson] = useState('')
  const [importGraphId, setImportGraphId] = useState('')
  const [replaceGraph, setReplaceGraph] = useState(false)
  const [newGraph, setNewGraph] = useState({ name: '', description: '', visibility: 'public' })
  const [userSearch, setUserSearch] = useState('')
  const [aiSearch, setAiSearch] = useState('')

  const hdrs = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  })

  function notify(text: string, isError = false) {
    if (isError) { setError(text); setMsg('') } else { setMsg(text); setError('') }
    window.setTimeout(() => { setMsg(''); setError('') }, 3600)
  }

  async function jsonFetch(path: string, init?: RequestInit) {
    const res = await fetch(apiUrl(path), { ...init, headers: { ...hdrs(), ...(init?.headers || {}) } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [s, g, u, q, h] = await Promise.all([
        jsonFetch('/api/admin/summary'),
        jsonFetch('/api/graphs'),
        jsonFetch('/api/admin/users'),
        jsonFetch('/api/copilot/history'),
        fetch(apiUrl('/api/health')).then(r => r.json())
      ])
      setSummary(s)
      setGraphs(Array.isArray(g) ? g : [])
      setUsers(Array.isArray(u) ? u : [])
      setQuestions(Array.isArray(q) ? q : [])
      setHealth(h)
    } catch (e: any) {
      notify(e.message || 'Не удалось загрузить Console', true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function createGraph(e: React.FormEvent) {
    e.preventDefault()
    if (!newGraph.name.trim()) return
    try {
      await jsonFetch('/api/graphs', { method: 'POST', body: JSON.stringify(newGraph) })
      setNewGraph({ name: '', description: '', visibility: 'public' })
      notify('Домен создан')
      loadAll()
    } catch (e: any) { notify(e.message, true) }
  }

  async function updateGraph(graph: any, changes: any) {
    try {
      await jsonFetch(`/api/graphs/${graph.id}`, { method: 'PATCH', body: JSON.stringify(changes) })
      notify('Настройки домена сохранены')
      loadAll()
    } catch (e: any) { notify(e.message, true) }
  }

  async function deleteGraph(graph: any) {
    if (!window.confirm(`Удалить домен «${graph.name}» и связанные данные?`)) return
    try {
      await jsonFetch(`/api/graphs/${graph.id}`, { method: 'DELETE' })
      notify('Домен удалён')
      loadAll()
    } catch (e: any) { notify(e.message, true) }
  }

  async function importGraph(e: React.FormEvent) {
    e.preventDefault()
    try {
      const pkg = JSON.parse(importJson)
      const payload = {
        graphId: importGraphId || pkg.graphId || undefined,
        graph: pkg.graph || { name: pkg.name, description: pkg.description, visibility: pkg.visibility },
        tab: pkg.tab || 'tobe',
        nodes: pkg.nodes || [],
        edges: pkg.edges || [],
        replace: replaceGraph
      }
      const result = await jsonFetch('/api/admin/import-graph', { method: 'POST', body: JSON.stringify(payload) })
      notify(`Импорт завершён: ${result.nodes} nodes · ${result.edges} edges`)
      setImportJson('')
      setImportGraphId('')
      setReplaceGraph(false)
      loadAll()
    } catch (e: any) {
      notify(e instanceof SyntaxError ? 'JSON невалиден' : e.message, true)
    }
  }

  async function exportGraph(graph: any) {
    try {
      const h = { ...hdrs(), 'X-Graph-Id': graph.id }
      const [nodes, edges, ontology] = await Promise.all([
        fetch(apiUrl(`/api/graph/nodes?graph_id=${encodeURIComponent(graph.id)}`), { headers: h }).then(r => r.json()),
        fetch(apiUrl(`/api/graph/edges?graph_id=${encodeURIComponent(graph.id)}`), { headers: h }).then(r => r.json()),
        fetch(apiUrl(`/api/ontology?graph_id=${encodeURIComponent(graph.id)}`), { headers: h }).then(r => r.json())
      ])
      const pkg = {
        format: 'graph-platform-knowledge-package',
        version: 3,
        exportedAt: new Date().toISOString(),
        graph: { id: graph.id, name: graph.name, slug: graph.slug, description: graph.description, visibility: graph.visibility, ontology },
        nodes,
        edges
      }
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `${graph.slug || 'domain'}-knowledge-package.json`
      a.click()
      URL.revokeObjectURL(href)
      notify('Knowledge Package экспортирован')
    } catch { notify('Ошибка экспорта', true) }
  }

  async function updateUser(user: any, role: string) {
    try {
      await jsonFetch(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role }) })
      notify(`Роль ${user.email} → ${role}`)
      loadAll()
    } catch (e: any) { notify(e.message, true) }
  }

  async function deleteUser(user: any) {
    if (!window.confirm(`Удалить пользователя ${user.email}?`)) return
    try {
      await jsonFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      notify('Пользователь удалён')
      loadAll()
    } catch (e: any) { notify(e.message, true) }
  }

  function readImportFile(file?: File) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImportJson(String(reader.result || ''))
    reader.readAsText(file)
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter(u => [u.email, u.name, u.role, u.workspace_id].some(v => String(v || '').toLowerCase().includes(q)))
  }, [users, userSearch])

  const filteredQuestions = useMemo(() => {
    const q = aiSearch.trim().toLowerCase()
    if (!q) return questions
    return questions.filter(item => [item.message, item.answer, item.model].some(v => String(v || '').toLowerCase().includes(q)))
  }, [questions, aiSearch])

  const importPreview = useMemo(() => {
    try {
      if (!importJson.trim()) return null
      const pkg = JSON.parse(importJson)
      return { nodes: Array.isArray(pkg.nodes) ? pkg.nodes.length : 0, edges: Array.isArray(pkg.edges) ? pkg.edges.length : 0, name: pkg.graph?.name || pkg.name || 'New domain' }
    } catch { return { invalid: true } }
  }, [importJson])

  const tabs: { id: AdminTab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '◫' },
    { id: 'domains', label: 'Domains', icon: '◇' },
    { id: 'import', label: 'Knowledge', icon: '⇅' },
    { id: 'users', label: 'Users', icon: '◎' },
    { id: 'ai', label: 'AI Ops', icon: '✦' },
    { id: 'system', label: 'System', icon: '⌁' }
  ]

  const stats = summary?.stats || {}

  return (
    <div className="admin-console">
      <aside className="admin-sidebar">
        <button className="admin-brand" onClick={onBack}><span className="brand-mark"><span>G</span></span><span><strong>Graph Platform</strong><small>Admin Console</small></span></button>
        <nav>
          {tabs.map(item => (
            <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="admin-side-foot">
          <span className={`service-pill ${health?.ok ? 'online' : ''}`}><span className="service-dot" /> {health?.ok ? 'System healthy' : 'System check'}</span>
          <button type="button" className="btn-quiet" onClick={onBack}>← Платформа</button>
        </div>
      </aside>

      <main className="admin-content">
        <header className="admin-console-head">
          <div><p className="eyebrow">Operations & governance</p><h1>{tabs.find(t => t.id === tab)?.label}</h1></div>
          <div className="admin-head-actions">
            {loading && <span className="loading-pill">Syncing…</span>}
            <button type="button" className="btn-secondary compact" onClick={loadAll}>↻ Refresh</button>
          </div>
        </header>

        {(msg || error) && <div className={`console-notice ${error ? 'error' : 'success'}`}>{error || msg}</div>}

        {tab === 'overview' && (
          <>
            <section className="admin-kpis">
              {[
                ['Published', stats.publicGraphs ?? 0, 'public domains'],
                ['Knowledge', stats.nodes ?? 0, 'nodes'],
                ['Relations', stats.edges ?? 0, 'edges'],
                ['Users', stats.users ?? 0, 'accounts'],
                ['AI', stats.questions ?? 0, 'questions'],
                ['RAG', stats.documents ?? 0, 'documents']
              ].map(([label, value, unit]) => (
                <div className="admin-kpi" key={String(label)}><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>
              ))}
            </section>

            <section className="admin-two-col">
              <div className="console-card">
                <div className="card-head"><div><p className="eyebrow">Domain portfolio</p><h2>Knowledge landscape</h2></div><button className="btn-quiet" onClick={() => setTab('domains')}>Manage →</button></div>
                <div className="domain-ops-list">
                  {graphs.slice(0, 6).map(g => (
                    <div key={g.id} className="domain-ops-row"><span className={`visibility-dot ${g.visibility || 'public'}`} /><div><strong>{g.name}</strong><small>{g.slug} · {g.nodeCount ?? 0} nodes · {g.edgeCount ?? 0} links</small></div><span>{g.visibility || 'public'}</span></div>
                  ))}
                </div>
              </div>
              <div className="console-card">
                <div className="card-head"><div><p className="eyebrow">AI telemetry</p><h2>Recent intelligence</h2></div><button className="btn-quiet" onClick={() => setTab('ai')}>Inspect →</button></div>
                <div className="ai-ops-list">
                  {(summary?.recentQuestions || []).slice(0, 6).map((q: any) => (
                    <div key={q.id}><span className="ai-op-icon">✦</span><div><strong>{q.message || 'Question'}</strong><small>{q.model || 'model'} · {q.ts ? new Date(q.ts).toLocaleString('ru-RU') : ''}</small></div></div>
                  ))}
                  {!summary?.recentQuestions?.length && <p className="muted">AI history пока пуст.</p>}
                </div>
              </div>
            </section>
          </>
        )}

        {tab === 'domains' && (
          <section className="admin-two-col domains-layout">
            <div className="console-card sticky-card">
              <p className="eyebrow">Create domain</p><h2>Новый граф знаний</h2>
              <form className="console-form" onSubmit={createGraph}>
                <label>Название<input className="field" value={newGraph.name} onChange={e => setNewGraph(v => ({ ...v, name: e.target.value }))} placeholder="Risk Intelligence" /></label>
                <label>Описание<textarea className="field" rows={4} value={newGraph.description} onChange={e => setNewGraph(v => ({ ...v, description: e.target.value }))} placeholder="Что хранит этот домен и для кого он нужен" /></label>
                <label>Доступ<select className="field" value={newGraph.visibility} onChange={e => setNewGraph(v => ({ ...v, visibility: e.target.value }))}><option value="public">Public — read без login</option><option value="private">Private — members only</option></select></label>
                <button className="btn-primary" type="submit">Создать домен</button>
              </form>
            </div>

            <div className="console-card">
              <div className="card-head"><div><p className="eyebrow">{graphs.length} total</p><h2>Domain registry</h2></div></div>
              <div className="domain-admin-list">
                {graphs.map(g => (
                  <article className="domain-admin-card" key={g.id}>
                    <div className="domain-admin-main">
                      <span className="domain-admin-icon">◇</span>
                      <div><h3>{g.name}</h3><p>{g.description || 'Без описания'}</p><small>{g.slug} · {g.nodeCount ?? 0} nodes · {g.edgeCount ?? 0} links</small></div>
                    </div>
                    <div className="domain-admin-controls">
                      <select className="field mini-field" value={g.visibility || 'public'} onChange={e => updateGraph(g, { visibility: e.target.value })}><option value="public">Public</option><option value="private">Private</option></select>
                      <button className="btn-quiet" onClick={() => exportGraph(g)}>Export</button>
                      <button className="btn-danger" onClick={() => deleteGraph(g)}>Delete</button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === 'import' && (
          <section className="admin-two-col knowledge-import-layout">
            <div className="console-card">
              <p className="eyebrow">Knowledge Package v3</p><h2>Import / merge</h2>
              <p className="muted">Загрузите JSON из Graph Platform, ChatGPT или собственного генератора. Если graphId отсутствует, backend создаст новый домен.</p>
              <label className="file-drop">
                <span>⇧</span><strong>Выбрать JSON</strong><small>или вставить содержимое справа</small>
                <input type="file" accept="application/json,.json" onChange={e => readImportFile(e.target.files?.[0])} />
              </label>
              <label className="control-label">Target domain<select className="field" value={importGraphId} onChange={e => setImportGraphId(e.target.value)}><option value="">Создать новый</option>{graphs.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
              <label className="check-row"><input type="checkbox" checked={replaceGraph} onChange={e => setReplaceGraph(e.target.checked)} /><span><strong>Replace mode</strong><small>Сначала удалить текущие nodes/edges target-графа.</small></span></label>
              {importPreview && !('invalid' in importPreview) && <div className="import-preview"><span>Package</span><strong>{importPreview.name}</strong><small>{importPreview.nodes} nodes · {importPreview.edges} edges</small></div>}
              {importPreview && 'invalid' in importPreview && <div className="console-notice error">JSON пока невалиден.</div>}
            </div>
            <form className="console-card" onSubmit={importGraph}>
              <div className="card-head"><div><p className="eyebrow">Raw package</p><h2>JSON payload</h2></div></div>
              <textarea className="json-editor" value={importJson} onChange={e => setImportJson(e.target.value)} placeholder={'{\n  "graph": { "name": "Domain" },\n  "nodes": [],\n  "edges": []\n}'} spellCheck={false} />
              <button className="btn-primary" type="submit" disabled={!importJson.trim()}>Импортировать Knowledge Package</button>
            </form>
          </section>
        )}

        {tab === 'users' && (
          <section className="console-card">
            <div className="card-head"><div><p className="eyebrow">Identity & RBAC</p><h2>{users.length} accounts</h2></div><input className="field search-field" value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search user…" /></div>
            <div className="user-table-wrap"><table className="console-table"><thead><tr><th>User</th><th>Workspace</th><th>Memberships</th><th>Role</th><th /></tr></thead><tbody>
              {filteredUsers.map(u => <tr key={u.id}><td><div className="table-user"><span>{(u.name || u.email || '?')[0].toUpperCase()}</span><div><strong>{u.name}</strong><small>{u.email}</small></div></div></td><td>{u.workspace_id}</td><td>{u.memberships_count ?? 1}</td><td><select className="field mini-field" value={u.role} onChange={e => updateUser(u, e.target.value)}><option value="member">member</option><option value="admin">admin</option></select></td><td>{u.role !== 'admin' && <button className="btn-danger" onClick={() => deleteUser(u)}>Delete</button>}</td></tr>)}
            </tbody></table></div>
          </section>
        )}

        {tab === 'ai' && (
          <section className="console-card">
            <div className="card-head"><div><p className="eyebrow">Copilot operations</p><h2>AI request history</h2></div><input className="field search-field" value={aiSearch} onChange={e => setAiSearch(e.target.value)} placeholder="Search prompt / model…" /></div>
            <div className="ai-history-grid">
              {filteredQuestions.map(q => (
                <article key={q.id} className="ai-history-card"><div className="ai-history-top"><span className="ai-op-icon">✦</span><span>{q.model || 'unknown'}</span><time>{q.ts ? new Date(q.ts).toLocaleString('ru-RU') : ''}</time></div><h3>{q.message || '—'}</h3><p>{q.answer || '—'}</p><small>{q.graph_id ? `graph ${String(q.graph_id).slice(0, 8)}` : 'workspace context'}</small></article>
              ))}
              {!filteredQuestions.length && <div className="domain-empty">Запросов не найдено.</div>}
            </div>
          </section>
        )}

        {tab === 'system' && (
          <section className="admin-two-col">
            <div className="console-card system-card"><p className="eyebrow">Runtime</p><h2>Platform health</h2>{[
              ['Backend API', health?.ok ? 'online' : 'offline'],
              ['Version', health?.version || summary?.version || '—'],
              ['Database', health?.db || 'sqlite'],
              ['LLM mode', health?.llmMode || '—'],
              ['Public domains API', health?.publicDomains ? 'enabled' : 'unknown'],
              ['Tenant isolation', health?.tenantIsolation || '—']
            ].map(([k, v]) => <div className="system-row" key={String(k)}><span>{k}</span><strong>{v}</strong></div>)}</div>
            <div className="console-card system-card"><p className="eyebrow">Abuse protection</p><h2>Rate limiter</h2><div className="system-row"><span>Tracked IPs</span><strong>{summary?.rateLimit?.totalIPs ?? 0}</strong></div><div className="system-row"><span>Blocked IPs</span><strong>{summary?.rateLimit?.blockedIPs ?? 0}</strong></div><div className="system-row"><span>External LLM</span><strong>{health?.llmConfigured ? 'configured' : 'offline-first'}</strong></div><p className="muted system-note">Secrets и API keys намеренно не отображаются в Console.</p></div>
          </section>
        )}
      </main>
    </div>
  )
}
