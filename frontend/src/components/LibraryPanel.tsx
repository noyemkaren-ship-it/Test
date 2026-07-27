import { useEffect, useState } from 'react'
import { apiUrl } from '../config'

/**
 * Workspace library:
 * A) Bind existing Actor to Project (no copy)
 * B) Templates: save snapshot / create project from template
 */
export default function LibraryPanel({
  headers,
  workspaceId,
  projects
}: {
  headers: () => Record<string, string>
  workspaceId: string
  projects: any[]
}) {
  const [projectId, setProjectId] = useState('')
  const [projectActors, setProjectActors] = useState<any[]>([])
  const [candidates, setCandidates] = useState<any[]>([])
  const [role, setRole] = useState('Исполнитель')
  const [templates, setTemplates] = useState<any[]>([])
  const [tplName, setTplName] = useState('')
  const [tplDesc, setTplDesc] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [selectedTpl, setSelectedTpl] = useState('')
  const [msg, setMsg] = useState('')
  const [detail, setDetail] = useState<any>(null)

  useEffect(() => {
    if (projects[0] && !projectId) setProjectId(projects[0].id)
  }, [projects])

  async function loadProjectActors() {
    if (!projectId) return
    const res = await fetch(apiUrl(`/api/projects/${projectId}/actors`), { headers: headers() })
    const data = await res.json().catch(() => [])
    setProjectActors(res.ok && Array.isArray(data) ? data : [])
  }

  async function loadCandidates() {
    if (!projectId) return
    const res = await fetch(
      apiUrl(`/api/workspaces/${workspaceId}/actors?unassigned_to=${encodeURIComponent(projectId)}`),
      { headers: headers() }
    )
    const data = await res.json().catch(() => [])
    setCandidates(res.ok && Array.isArray(data) ? data : [])
  }

  async function loadTemplates() {
    const res = await fetch(apiUrl(`/api/workspaces/${workspaceId}/templates`), { headers: headers() })
    const data = await res.json().catch(() => [])
    setTemplates(res.ok && Array.isArray(data) ? data : [])
  }

  useEffect(() => {
    loadProjectActors().catch(() => {})
    loadCandidates().catch(() => {})
    loadTemplates().catch(() => {})
  }, [workspaceId, projectId])

  async function bindActor(actorId: string) {
    const res = await fetch(apiUrl('/api/role-bindings'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ actorId, objectId: projectId, role })
    })
    if (res.ok) {
      setMsg('Actor привязан к проекту (без копирования)')
      loadProjectActors()
      loadCandidates()
    } else {
      const e = await res.json()
      setMsg(e.error || 'Ошибка привязки')
    }
  }

  async function unbind(bindingId: string) {
    if (!confirm('Отвязать Actor от проекта? (Actor останется в workspace)')) return
    const res = await fetch(apiUrl(`/api/role-bindings/${bindingId}`), {
      method: 'DELETE',
      headers: headers()
    })
    if (res.ok) {
      setMsg('Отвязка выполнена — Actor не удалён')
      loadProjectActors()
      loadCandidates()
    }
  }

  async function saveTemplate() {
    if (!tplName.trim()) return
    const res = await fetch(apiUrl(`/api/workspaces/${workspaceId}/templates`), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: tplName,
        description: tplDesc,
        sourceProjectId: projectId || null
      })
    })
    if (res.ok) {
      const d = await res.json()
      setMsg(`Шаблон сохранён: ${d.nodes} узлов, v${d.version}`)
      setTplName('')
      loadTemplates()
    } else setMsg('Не удалось сохранить шаблон (нужен login?)')
  }

  async function viewTpl(id: string) {
    const res = await fetch(apiUrl(`/api/templates/${id}`), { headers: headers() })
    setDetail(await res.json())
  }

  async function deleteTpl(id: string) {
    if (!confirm('Удалить шаблон?')) return
    await fetch(apiUrl(`/api/templates/${id}`), { method: 'DELETE', headers: headers() })
    setDetail(null)
    loadTemplates()
    setMsg('Шаблон удалён')
  }

  async function createFromTemplate() {
    if (!selectedTpl || !newProjectName.trim()) {
      setMsg('Укажите имя проекта и шаблон')
      return
    }
    const res = await fetch(apiUrl('/api/projects'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: newProjectName, templateId: selectedTpl })
    })
    if (res.ok) {
      const d = await res.json()
      setMsg(
        `Проект создан из шаблона v${d.templateVersion}: ${d.nodesCreated} узлов (независимая копия)`
      )
      setNewProjectName('')
    } else {
      const e = await res.json()
      setMsg(e.error || 'Ошибка создания')
    }
  }

  return (
    <div className="panel">
      <h3>Библиотека Workspace</h3>
      <p className="sub-hint">
        Actor не копируется — только role-binding на Project. Шаблоны = snapshot (не live-link).
      </p>

      <div className="toolbar">
        <span className="rolebar-label">Проект</span>
        <select className="field" value={projectId} onChange={e => setProjectId(e.target.value)}>
          {projects.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          {!projects.length && <option value="">Нет проектов</option>}
        </select>
      </div>

      <h3 style={{ marginTop: 14 }}>A · Actor ↔ Project</h3>
      <div className="toolbar">
        <select className="field" value={role} onChange={e => setRole(e.target.value)}>
          {['Заказчик', 'Owner', 'Исполнитель', 'Эксперт', 'Ассистент'].map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <p className="sub-hint">Привязаны к проекту</p>
      <div className="activity-list">
        {projectActors.map(a => (
          <div key={a.bindingId} className="activity-item">
            <div className="activity-q">{a.name} · {a.type} · {a.role}</div>
            <div className="activity-meta">
              actor_id: {a.actorId}
              <button type="button" className="chip" style={{ marginLeft: 8 }} onClick={() => unbind(a.bindingId)}>
                Отвязать
              </button>
            </div>
          </div>
        ))}
        {!projectActors.length && <p className="muted">Пока никто не привязан</p>}
      </div>
      <p className="sub-hint">Добавить существующего Actor</p>
      <div className="activity-list">
        {candidates.map(a => (
          <div key={a.id} className="activity-item">
            <div className="activity-q">{a.name} · {a.type}</div>
            <button type="button" className="chip on" onClick={() => bindActor(a.id)}>
              Привязать
            </button>
          </div>
        ))}
        {!candidates.length && <p className="muted">Все Actor уже привязаны или список пуст</p>}
      </div>

      <h3 style={{ marginTop: 18 }}>B · Шаблоны (snapshot)</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        <input className="field" placeholder="Название шаблона" value={tplName} onChange={e => setTplName(e.target.value)} />
        <input className="field" placeholder="Описание" value={tplDesc} onChange={e => setTplDesc(e.target.value)} />
        <button type="button" className="chip on" onClick={saveTemplate}>
          Сохранить текущий проект как шаблон
        </button>
      </div>

      <div className="activity-list" style={{ marginTop: 12 }}>
        {templates.map((t: any) => (
          <div key={t.id} className="activity-item">
            <div className="activity-q">{t.name} · v{t.version}</div>
            <div className="activity-meta">{t.description || '—'} · {t.updated_at}</div>
            <div className="toolbar" style={{ marginTop: 6 }}>
              <button type="button" className="chip" onClick={() => viewTpl(t.id)}>Состав</button>
              <button type="button" className="chip" onClick={() => setSelectedTpl(t.id)}>Выбрать</button>
              <button type="button" className="chip" onClick={() => deleteTpl(t.id)}>Удалить</button>
            </div>
          </div>
        ))}
        {!templates.length && <p className="muted">Шаблонов пока нет</p>}
      </div>

      {detail && (
        <div className="card" style={{ marginTop: 10 }}>
          <strong>{detail.name}</strong>
          <p>
            Узлов: {detail.summary?.nodes}, связей: {detail.summary?.edges}, WI: {detail.summary?.workItems}
          </p>
          <p className="muted">Заморожен: {detail.snapshot?.frozenAt}</p>
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>Создать проект из шаблона</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        <input
          className="field"
          placeholder="Имя нового проекта"
          value={newProjectName}
          onChange={e => setNewProjectName(e.target.value)}
        />
        <select className="field" value={selectedTpl} onChange={e => setSelectedTpl(e.target.value)}>
          <option value="">— шаблон —</option>
          {templates.map((t: any) => (
            <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>
          ))}
        </select>
        <button type="button" className="chip on" onClick={createFromTemplate}>
          Создать независимую копию
        </button>
      </div>

      {msg && <p className="sub-hint" style={{ marginTop: 10 }}>{msg}</p>}
    </div>
  )
}
