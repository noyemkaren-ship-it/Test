import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { apiUrl } from '../config'
import { usePreferences } from '../preferences'

type Props = {
  headers: () => Record<string, string>
  graph: any | null
  nodes: any[]
  canEdit: boolean
}

type Tab = 'issues' | 'changes' | 'execution' | 'reviews'

export default function DeliveryControlPanel({ headers, graph, nodes, canEdit }: Props) {
  const { tr } = usePreferences()
  const [tab, setTab] = useState<Tab>('issues')
  const [data, setData] = useState<any>({ issues: [], changes: [], workItems: [], sprints: [], pipes: [], releases: [], reviews: [], metrics: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issue, setIssue] = useState({ type: 'KnowledgeDefect', title: '', severity: 'medium' })
  const [work, setWork] = useState({ title: '', issueId: '', estimatedHours: '8', budget: '0', deadline: '', criticalPath: false })
  const [change, setChange] = useState({ title: '', nodeId: '', perspective: 'component', estimatedHours: '8', budget: '0', deadline: '' })
  const [execution, setExecution] = useState({ kind: 'sprints', name: '', start: '', end: '', targetDate: '' })
  const [review, setReview] = useState({ text: '', objectId: '', epic: 'Delivery', feature: 'Acceptance', artifact: 'Graph artifact', version: 'v1', fragment: 'Acceptance fragment' })

  const load = useCallback(async () => {
    if (!graph?.id) return
    const paths = ['/issues', '/changes', '/work-items', '/sprints', '/pipes', '/releases', '/reviews', '/transformation-metrics']
    try {
      const results = await Promise.all(paths.map(path => fetch(apiUrl(`/api${path}`), { headers: headers() }).then(async res => res.ok ? res.json() : [])))
      setData({ issues: results[0], changes: results[1], workItems: results[2], sprints: results[3], pipes: results[4], releases: results[5], reviews: results[6], metrics: results[7] })
    } catch {
      setError(tr('Не удалось загрузить операционный контур', 'Could not load delivery controls'))
    }
  }, [graph?.id, headers, tr])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    setChange(value => ({ ...value, nodeId: nodes[0]?.id || '' }))
    setReview(value => ({ ...value, objectId: nodes[0]?.id || '' }))
  }, [graph?.id, nodes])

  async function request(path: string, body: any, method = 'POST') {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(apiUrl(`/api${path}`), { method, headers: headers(), body: JSON.stringify(body) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `${response.status}`)
      await load()
      return payload
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('Операция не выполнена', 'Operation failed'))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  async function createIssue(event: FormEvent) {
    event.preventDefault()
    if (!issue.title.trim()) return
    await request('/issues', { ...issue, projectId: graph.projectId })
    setIssue(value => ({ ...value, title: '' }))
  }

  async function createWork(event: FormEvent) {
    event.preventDefault()
    if (!work.title.trim()) return
    await request('/work-items', {
      ...work, projectId: graph.projectId, issueId: work.issueId || null,
      estimatedHours: Number(work.estimatedHours), budget: Number(work.budget), layer: 'Project',
      type: work.issueId ? 'KnowledgeDefect' : 'Task', requiredSpecialists: ['Owner', 'Executor']
    })
    setWork(value => ({ ...value, title: '' }))
  }

  async function createChange(event: FormEvent) {
    event.preventDefault()
    if (!change.title.trim() || !change.nodeId) return
    await request('/changes', {
      title: change.title, projectId: graph.projectId, deadline: change.deadline || null,
      estimatedHours: Number(change.estimatedHours), budget: Number(change.budget),
      metrics: { coverageTarget: 100 }, artifacts: [{ nodeId: change.nodeId, perspective: change.perspective }]
    })
    setChange(value => ({ ...value, title: '' }))
  }

  async function createExecution(event: FormEvent) {
    event.preventDefault()
    if (!execution.name.trim()) return
    await request(`/${execution.kind}`, {
      name: execution.name, projectId: graph.projectId, start: execution.start || null,
      end: execution.end || null, targetDate: execution.targetDate || null,
      stages: execution.kind === 'pipes' ? ['Backlog', 'Analysis', 'Delivery', 'Done'] : undefined
    })
    setExecution(value => ({ ...value, name: '' }))
  }

  async function createReview(event: FormEvent) {
    event.preventDefault()
    if (!review.text.trim()) return
    const epic = await request('/epics', { projectId: graph.projectId, graphId: graph.id, name: review.epic })
    const feature = await request('/features', { epicId: epic.id, graphId: graph.id, name: review.feature })
    const artifact = await request('/artifacts', { featureId: feature.id, graphId: graph.id, nodeId: review.objectId || null, name: review.artifact })
    const version = await request('/artifact-versions', { artifactId: artifact.id, version: review.version })
    const fragment = await request('/fragments', { versionId: version.id, nodeId: review.objectId || null, label: review.fragment })
    await request('/reviews', {
      text: review.text,
      scope: {
        projectId: graph.projectId, epicId: epic.id, featureId: feature.id, artifactId: artifact.id,
        versionId: version.id, fragmentId: fragment.id, objectId: review.objectId || null, version: review.version
      }
    })
    setReview(value => ({ ...value, text: '' }))
  }

  const totals = useMemo(() => ({
    issues: data.issues.length,
    changes: data.changes.length,
    execution: data.sprints.length + data.pipes.length + data.releases.length,
    reviews: data.reviews.length
  }), [data])

  if (!canEdit || !graph) return null

  return (
    <details className="delivery-control" open>
      <summary>
        <span><b>◎</b><span><strong>{tr('Контур управления', 'Delivery control')}</strong><small>{tr('Issue · Change · Sprint/Pipe · Review', 'Issue · Change · Sprint/Pipe · Review')}</small></span></span>
        <span className="delivery-summary-metrics"><b>{data.metrics?.resources?.estimatedHours || 0}h</b><b>{data.metrics?.resources?.budget || 0} ₽</b></span>
      </summary>
      <div className="delivery-tabs">
        {(['issues', 'changes', 'execution', 'reviews'] as Tab[]).map(item => (
          <button key={item} type="button" className={tab === item ? 'on' : ''} onClick={() => setTab(item)}>
            {item === 'issues' ? tr('Проблемы', 'Issues') : item === 'changes' ? tr('Изменения', 'Changes') : item === 'execution' ? tr('Исполнение', 'Execution') : tr('Ревью', 'Reviews')}
            <b>{totals[item]}</b>
          </button>
        ))}
      </div>

      <div className="delivery-body">
        {tab === 'issues' && <>
          <form className="delivery-form" onSubmit={createIssue}>
            <select className="field" value={issue.type} onChange={e => setIssue({ ...issue, type: e.target.value })}><option>Problem</option><option>Risk</option><option>Constraint</option><option>KnowledgeDefect</option></select>
            <input className="field grow" value={issue.title} onChange={e => setIssue({ ...issue, title: e.target.value })} placeholder={tr('Что мешает результату?', 'What blocks the outcome?')} />
            <select className="field" value={issue.severity} onChange={e => setIssue({ ...issue, severity: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
            <button className="btn-primary compact" disabled={busy}>＋ Issue</button>
          </form>
          <form className="delivery-form" onSubmit={createWork}>
            <select className="field" value={work.issueId} onChange={e => setWork({ ...work, issueId: e.target.value })}><option value="">{tr('Без родительского Issue', 'No parent Issue')}</option>{data.issues.map((item: any) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
            <input className="field grow" value={work.title} onChange={e => setWork({ ...work, title: e.target.value })} placeholder="Work Item" />
            <input className="field mini" type="number" min="0" value={work.estimatedHours} onChange={e => setWork({ ...work, estimatedHours: e.target.value })} title={tr('Часы', 'Hours')} />
            <input className="field mini" type="number" min="0" value={work.budget} onChange={e => setWork({ ...work, budget: e.target.value })} title={tr('Бюджет', 'Budget')} />
            <label className="delivery-check"><input type="checkbox" checked={work.criticalPath} onChange={e => setWork({ ...work, criticalPath: e.target.checked })} /> Critical</label>
            <button className="btn-secondary compact" disabled={busy}>＋ Work</button>
          </form>
          <div className="delivery-list">{data.issues.map((item: any) => <article key={item.id}><span className={`delivery-type ${item.severity}`}>{item.type}</span><strong>{item.title}</strong><small>{item.status} · {item.severity}</small></article>)}</div>
        </>}

        {tab === 'changes' && <>
          <form className="delivery-form" onSubmit={createChange}>
            <input className="field grow" value={change.title} onChange={e => setChange({ ...change, title: e.target.value })} placeholder={tr('Название изменения', 'Change title')} />
            <select className="field" value={change.nodeId} onChange={e => setChange({ ...change, nodeId: e.target.value })}>{nodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
            <select className="field" value={change.perspective} onChange={e => setChange({ ...change, perspective: e.target.value })}><option value="form">Form</option><option value="indicator">Indicator</option><option value="sql">SQL</option><option value="test">Test</option><option value="document">Document</option><option value="architecture">Architecture</option><option value="component">Component</option></select>
            <input className="field mini" type="number" min="0" value={change.estimatedHours} onChange={e => setChange({ ...change, estimatedHours: e.target.value })} />
            <button className="btn-primary compact" disabled={busy}>＋ Change</button>
          </form>
          <div className="delivery-list">{data.changes.map((item: any) => <article key={item.id}><span className={`delivery-type ${item.riskLevel}`}>CHANGE</span><strong>{item.title}</strong><small>{item.status} · {item.estimatedHours}h · {item.artifacts?.map((a: any) => a.perspective).join(', ')}</small></article>)}</div>
        </>}

        {tab === 'execution' && <>
          <form className="delivery-form" onSubmit={createExecution}>
            <select className="field" value={execution.kind} onChange={e => setExecution({ ...execution, kind: e.target.value })}><option value="sprints">Sprint</option><option value="pipes">Pipe</option><option value="releases">Release</option></select>
            <input className="field grow" value={execution.name} onChange={e => setExecution({ ...execution, name: e.target.value })} placeholder={tr('Название', 'Name')} />
            {execution.kind === 'sprints' && <><input className="field" type="date" value={execution.start} onChange={e => setExecution({ ...execution, start: e.target.value })} /><input className="field" type="date" value={execution.end} onChange={e => setExecution({ ...execution, end: e.target.value })} /></>}
            {execution.kind === 'releases' && <input className="field" type="date" value={execution.targetDate} onChange={e => setExecution({ ...execution, targetDate: e.target.value })} />}
            <button className="btn-primary compact" disabled={busy}>＋ {execution.kind.slice(0, -1)}</button>
          </form>
          <div className="delivery-columns"><div><h4>Sprints</h4>{data.sprints.map((item: any) => <span key={item.id}>{item.name} <small>{item.status}</small></span>)}</div><div><h4>Pipes</h4>{data.pipes.map((item: any) => <span key={item.id}>{item.name} <small>{item.stages?.length || 0} stages</small></span>)}</div><div><h4>Releases</h4>{data.releases.map((item: any) => <span key={item.id}>{item.name} <small>{item.target_date || item.status}</small></span>)}</div></div>
          <div className="delivery-list">{data.metrics?.transformationSets?.map((set: any) => <article key={set.id}><span className={`delivery-type ${set.complete ? 'approved' : 'high'}`}>4× GRAPH</span><strong>{set.name}</strong><small>{set.independentGraphs}/4 independent · {set.alignments} alignments</small></article>)}</div>
        </>}

        {tab === 'reviews' && <>
          <form className="delivery-form" onSubmit={createReview}>
            <input className="field grow" value={review.text} onChange={e => setReview({ ...review, text: e.target.value })} placeholder={tr('Что нужно проверить?', 'What needs review?')} />
            <input className="field" value={review.epic} onChange={e => setReview({ ...review, epic: e.target.value })} placeholder="Epic" />
            <input className="field" value={review.feature} onChange={e => setReview({ ...review, feature: e.target.value })} placeholder="Feature" />
            <select className="field" value={review.objectId} onChange={e => setReview({ ...review, objectId: e.target.value })}>{nodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
            <input className="field" value={review.artifact} onChange={e => setReview({ ...review, artifact: e.target.value })} placeholder="Artifact" />
            <input className="field mini" value={review.version} onChange={e => setReview({ ...review, version: e.target.value })} />
            <input className="field" value={review.fragment} onChange={e => setReview({ ...review, fragment: e.target.value })} placeholder="Fragment" />
            <button className="btn-primary compact" disabled={busy}>＋ Review</button>
          </form>
          <div className="delivery-list">{data.reviews.map((item: any) => <article key={item.id}><span className={`delivery-type ${item.status}`}>REVIEW</span><strong>{item.text}</strong><small>{item.status} · {item.scopes?.some((s: any) => s.fragmentId) ? 'Project → Epic → Feature → Artifact → Version → Fragment' : item.scopes?.map((s: any) => s.version).filter(Boolean).join(', ') || 'legacy scope'}</small><div className="delivery-row-actions"><button type="button" onClick={() => request(`/reviews/${item.id}/votes`, { vote: 'approve' })}>✓ {tr('Голос', 'Vote')}</button>{item.status === 'open' && <button type="button" onClick={() => request(`/reviews/${item.id}/transition`, { event: 'start' })}>{tr('Начать', 'Start')}</button>}{item.status === 'in_review' && <button type="button" onClick={() => request(`/reviews/${item.id}/transition`, { event: 'approve' })}>{tr('Утвердить', 'Approve')}</button>}</div></article>)}</div>
        </>}
        {error && <p className="editor-error delivery-error">{error}</p>}
      </div>
    </details>
  )
}
