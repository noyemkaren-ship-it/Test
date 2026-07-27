import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { usePreferences } from '../preferences'

type Props = {
  nodes: any[]
  selectedNode: any | null
  selectedEdge: any | null
  activeGraph: any | null
  isLoggedIn: boolean
  canEdit: boolean
  tab: string
  onLogin: () => void
  onCreateGraph: (name: string) => Promise<void>
  onCreateNode: (input: any) => Promise<void>
  onUpdateNode: (id: string, input: any) => Promise<void>
  onDeleteNode: (id: string) => Promise<void>
  onCreateEdge: (input: any) => Promise<void>
  onUpdateEdge: (id: string, input: any) => Promise<void>
  onDeleteEdge: (id: string) => Promise<void>
  onClearSelection: () => void
}

const EMPTY_NODE = { label: '', kind: 'Concept', layer: 'Knowledge', nodeKind: 'default', description: '' }

export default function GraphEditorPanel(props: Props) {
  const { tr } = usePreferences()
  const [mode, setMode] = useState<'idle' | 'node' | 'edge' | 'graph'>('idle')
  const [nodeForm, setNodeForm] = useState(EMPTY_NODE)
  const [edgeForm, setEdgeForm] = useState({ source: '', target: '', label: '' })
  const [graphName, setGraphName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!props.selectedNode) return
    setMode('node')
    setNodeForm({
      label: props.selectedNode.label || '',
      kind: props.selectedNode.kind || 'Concept',
      layer: props.selectedNode.layer || 'Knowledge',
      nodeKind: props.selectedNode.nodeKind || 'default',
      description: props.selectedNode.description || ''
    })
    setError('')
  }, [props.selectedNode])

  useEffect(() => {
    if (!props.selectedEdge) return
    setMode('edge')
    setEdgeForm({ source: props.selectedEdge.source || '', target: props.selectedEdge.target || '', label: props.selectedEdge.label || '' })
    setError('')
  }, [props.selectedEdge])

  const sortedNodes = useMemo(() => [...props.nodes].sort((a, b) => String(a.label).localeCompare(String(b.label))), [props.nodes])

  function startNode() {
    props.onClearSelection()
    setNodeForm(EMPTY_NODE)
    setMode('node')
    setError('')
  }

  function startEdge() {
    props.onClearSelection()
    setEdgeForm({ source: sortedNodes[0]?.id || '', target: sortedNodes[1]?.id || '', label: '' })
    setMode('edge')
    setError('')
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
      setMode('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Операция не выполнена', 'Operation failed'))
    } finally {
      setBusy(false)
    }
  }

  function submitNode(event: FormEvent) {
    event.preventDefault()
    if (!nodeForm.label.trim()) return setError(tr('Введите название узла', 'Enter a node title'))
    run(() => props.selectedNode
      ? props.onUpdateNode(props.selectedNode.id, { ...nodeForm, tab: props.tab })
      : props.onCreateNode({ ...nodeForm, tab: props.tab }))
  }

  function submitEdge(event: FormEvent) {
    event.preventDefault()
    if (!edgeForm.source || !edgeForm.target || edgeForm.source === edgeForm.target) {
      return setError(tr('Выберите два разных узла', 'Choose two different nodes'))
    }
    run(() => props.selectedEdge
      ? props.onUpdateEdge(props.selectedEdge.id, { ...edgeForm, tab: props.tab })
      : props.onCreateEdge({ ...edgeForm, tab: props.tab }))
  }

  function submitGraph(event: FormEvent) {
    event.preventDefault()
    if (graphName.trim().length < 2) return setError(tr('Введите название графа', 'Enter a graph name'))
    run(async () => { await props.onCreateGraph(graphName); setGraphName('') })
  }

  if (!props.isLoggedIn) {
    return (
      <div className="editor-panel editor-panel-locked">
        <div><span className="editor-status">READ ONLY</span><strong>{tr('Просмотр открыт. Изменения — после входа.', 'Viewing is public. Sign in to make changes.')}</strong></div>
        <button type="button" className="btn-primary compact" onClick={props.onLogin}>{tr('Войти и редактировать', 'Sign in to edit')}</button>
      </div>
    )
  }

  if (!props.canEdit) {
    return (
      <div className="editor-panel editor-panel-locked">
        <div><span className="editor-status">WORKSPACE</span><strong>{tr('Выберите свой граф или создайте новый.', 'Select a graph you own or create a new one.')}</strong></div>
        {mode !== 'graph' ? (
          <button type="button" className="btn-primary compact" onClick={() => { setMode('graph'); setError('') }}>{tr('Создать рабочий граф', 'Create workspace graph')}</button>
        ) : (
          <form className="editor-inline-form" onSubmit={submitGraph}>
            <input className="field" value={graphName} onChange={e => setGraphName(e.target.value)} placeholder={tr('Название графа', 'Graph name')} autoFocus />
            <button type="submit" className="btn-primary compact" disabled={busy}>{busy ? '…' : tr('Создать', 'Create')}</button>
            <button type="button" className="btn-quiet" onClick={() => setMode('idle')}>{tr('Отмена', 'Cancel')}</button>
            {error && <span className="editor-error">{error}</span>}
          </form>
        )}
      </div>
    )
  }

  return (
    <div className="editor-panel">
      <div className="editor-panel-head">
        <div><span className="editor-status live">EDIT MODE</span><strong>{props.activeGraph?.name}</strong><small>{tr('Перетащите узел — позиция сохранится. Автораскладка не допускает наложений.', 'Drag a node to save its position. Auto-layout prevents overlaps.')}</small></div>
        <div className="editor-actions">
          <button type="button" className={mode === 'node' && !props.selectedNode ? 'chip on' : 'chip'} onClick={startNode}>＋ {tr('Узел', 'Node')}</button>
          <button type="button" className={mode === 'edge' && !props.selectedEdge ? 'chip on' : 'chip'} onClick={startEdge} disabled={props.nodes.length < 2}>↗ {tr('Связь', 'Relation')}</button>
        </div>
      </div>

      {mode === 'node' && (
        <form className="editor-form" onSubmit={submitNode}>
          <label>{tr('Название', 'Title')}<input className="field" value={nodeForm.label} onChange={e => setNodeForm({ ...nodeForm, label: e.target.value })} autoFocus /></label>
          <label>{tr('Тип', 'Type')}<input className="field" value={nodeForm.kind} onChange={e => setNodeForm({ ...nodeForm, kind: e.target.value })} /></label>
          <label>{tr('Слой', 'Layer')}
            <select className="field" value={nodeForm.layer} onChange={e => setNodeForm({ ...nodeForm, layer: e.target.value })}>
              <option>Knowledge</option><option>Implementation</option><option>Project</option><option>Resource</option>
            </select>
          </label>
          <label>{tr('Форма', 'Shape')}
            <select className="field" value={nodeForm.nodeKind} onChange={e => setNodeForm({ ...nodeForm, nodeKind: e.target.value })}>
              <option value="default">Default</option><option value="core">Core</option><option value="service">Service</option><option value="domain">Domain</option><option value="note">Note</option><option value="step">Step</option><option value="role">Role</option>
            </select>
          </label>
          <label className="editor-wide">{tr('Описание', 'Description')}<textarea className="field" rows={2} value={nodeForm.description} onChange={e => setNodeForm({ ...nodeForm, description: e.target.value })} /></label>
          <div className="editor-form-actions">
            <button type="submit" className="btn-primary compact" disabled={busy}>{busy ? '…' : props.selectedNode ? tr('Сохранить', 'Save') : tr('Добавить узел', 'Add node')}</button>
            {props.selectedNode && <button type="button" className="btn-danger compact" disabled={busy} onClick={() => confirm(tr('Удалить узел и его связи?', 'Delete the node and its relations?')) && run(() => props.onDeleteNode(props.selectedNode.id))}>{tr('Удалить', 'Delete')}</button>}
            <button type="button" className="btn-quiet" onClick={() => { props.onClearSelection(); setMode('idle') }}>{tr('Закрыть', 'Close')}</button>
          </div>
          {error && <span className="editor-error editor-wide">{error}</span>}
        </form>
      )}

      {mode === 'edge' && (
        <form className="editor-form edge-editor-form" onSubmit={submitEdge}>
          <label>{tr('Откуда', 'Source')}<select className="field" value={edgeForm.source} onChange={e => setEdgeForm({ ...edgeForm, source: e.target.value })}>{sortedNodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
          <label>{tr('Куда', 'Target')}<select className="field" value={edgeForm.target} onChange={e => setEdgeForm({ ...edgeForm, target: e.target.value })}>{sortedNodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
          <label>{tr('Название связи', 'Relation label')}<input className="field" value={edgeForm.label} onChange={e => setEdgeForm({ ...edgeForm, label: e.target.value })} /></label>
          <div className="editor-form-actions">
            <button type="submit" className="btn-primary compact" disabled={busy}>{busy ? '…' : props.selectedEdge ? tr('Сохранить', 'Save') : tr('Добавить связь', 'Add relation')}</button>
            {props.selectedEdge && <button type="button" className="btn-danger compact" disabled={busy} onClick={() => confirm(tr('Удалить эту связь?', 'Delete this relation?')) && run(() => props.onDeleteEdge(props.selectedEdge.id))}>{tr('Удалить', 'Delete')}</button>}
            <button type="button" className="btn-quiet" onClick={() => { props.onClearSelection(); setMode('idle') }}>{tr('Закрыть', 'Close')}</button>
          </div>
          {error && <span className="editor-error editor-wide">{error}</span>}
        </form>
      )}
    </div>
  )
}
