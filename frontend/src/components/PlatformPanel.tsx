export default function PlatformPanel({ actors, workItems, engines, layers, onTransition }: any) {
  return (
    <>
      <div className="panel">
        <h3>Движки</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(engines || []).map((e: any) => (
            <span key={e.id} className={`badge ${e.status === 'active' ? 'ok' : 'warn'}`}>
              {e.title}: {e.status}
            </span>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Слои Transformation Graph</h3>
        <div className="grid-2">
          {(layers || []).map((l: any) => (
            <div key={l.id} className="card">
              <strong>{l.title}</strong>
              <p>{l.desc}</p>
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
              {['START', 'DONE', 'FIX', 'RESOLVE', 'CLOSE', 'ACCEPT'].map(ev => (
                <button key={ev} type="button" className="chip" onClick={() => onTransition?.(w.id, ev)}>{ev}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
