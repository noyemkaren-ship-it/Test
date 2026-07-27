import { usePreferences } from '../preferences'

export default function PlatformPanel({ actors, workItems, engines, layers, onTransition }: any) {
  const { tr } = usePreferences()
  return (
    <>
      <div className="panel">
        <h3>{tr('Движки', 'Engines')}</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(engines || []).map((e: any) => (
            <span key={typeof e === 'string' ? e : (e.id || e.title)} className={`badge ${typeof e === 'string' || e.status === 'active' ? 'ok' : 'warn'}`}>
              {typeof e === 'string' ? e : `${e.title}: ${e.status}`}
            </span>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>{tr('Слои Transformation Graph', 'Transformation Graph layers')}</h3>
        <div className="grid-2">
          {(layers || []).map((l: any) => (
            <div key={typeof l === 'string' ? l : (l.id || l.title)} className="card">
              <strong>{typeof l === 'string' ? l : l.title}</strong>
              {typeof l !== 'string' && <p>{l.desc}</p>}
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Actors</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(actors || []).map((a: any) => (
            <span key={a.id} className="badge">{a.name} · {a.type}</span>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Work Items + FSM</h3>
        {(workItems || []).map((w: any) => (
          <div key={w.id} className="card" style={{ marginBottom: 8 }}>
            <span className="badge">{w.type}</span>{' '}
            <span className="badge">{w.status}</span>
            <div style={{ marginTop: 6, fontWeight: 600 }}>{w.title}</div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(w.allowedTransitions || []).map((ev: string) => (
                <button key={ev} type="button" className="chip" onClick={() => onTransition?.(w.id, ev)}>{ev}</button>
              ))}
              {!w.allowedTransitions?.length && <small className="muted">{tr('Финальное состояние', 'Final state')}</small>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
