import { usePreferences } from '../preferences'

export default function NodeInspector({
  node,
  edges,
  nodes,
  onClose,
  onFocusRelated
}: {
  node: any
  edges: any[]
  nodes: any[]
  onClose: () => void
  onFocusRelated: (ids: string[]) => void
}) {
  const { tr } = usePreferences()
  if (!node) return null
  const related = edges
    .filter(e => e.source === node.id || e.target === node.id)
    .map(e => {
      const otherId = e.source === node.id ? e.target : e.source
      const other = nodes.find(n => n.id === otherId)
      return { id: otherId, label: other?.label || otherId, edge: e.label || tr('связь', 'relation'), dir: e.source === node.id ? 'out' : 'in' }
    })

  return (
    <div className="panel inspector">
      <div className="inspector-head">
        <div><p className="eyebrow">{tr('Контекст графа', 'Graph context')}</p><h3>{tr('Инспектор узла', 'Node inspector')}</h3></div>
        <button type="button" className="chip" onClick={onClose}>{tr('Закрыть', 'Close')}</button>
      </div>
      <div className="insp-meta">
        <span className="badge">{node.nodeKind || 'node'}</span>
        <span className="badge">{node.layer}</span>
        {node.tab && <span className="badge">{node.tab}</span>}
      </div>
      <h2 className="insp-title">{node.label}</h2>
      <p className="insp-desc">{node.description || node.kind}</p>
      <div className="insp-section">
        <strong>{tr('Связи', 'Relations')} ({related.length})</strong>
        <ul className="insp-list">
          {related.map(r => (
            <li key={r.id + r.dir}>
              <button type="button" className="linkish" onClick={() => onFocusRelated([node.id, r.id])}>
                {r.dir === 'out' ? '→' : '←'} {r.label}
              </button>
              <span className="muted"> · {r.edge}</span>
            </li>
          ))}
          {!related.length && <li className="muted">{tr('Нет связей на этой вкладке', 'No relations in this view')}</li>}
        </ul>
      </div>
      <button
        type="button"
        className="chip on"
        onClick={() => onFocusRelated([node.id, ...related.map(r => r.id)])}
      >
        {tr('Подсветить все связи', 'Highlight all relations')}
      </button>
    </div>
  )
}
