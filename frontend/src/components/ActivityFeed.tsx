import { useEffect, useState } from 'react'
import { apiUrl } from '../config'

export default function ActivityFeed({ headers }: { headers: () => Record<string, string> }) {
  const [items, setItems] = useState<any[]>([])

  useEffect(() => {
    fetch(apiUrl('/api/copilot/history'), { headers: headers() })
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d.slice(0, 8) : []))
      .catch(() => setItems([]))
  }, [])

  return (
    <div className="panel">
      <h3>Лента вопросов Copilot</h3>
      <p className="sub-hint">История Question-объектов (аналитика домена)</p>
      <div className="activity-list">
        {items.map((q: any) => (
          <div key={q.id} className="activity-item">
            <div className="activity-q">{q.message}</div>
            <div className="activity-meta">{q.model} · {q.ts ? new Date(q.ts).toLocaleString('ru-RU') : ''}</div>
          </div>
        ))}
        {!items.length && <p className="muted">Пока пусто — задайте вопрос в чате справа</p>}
      </div>
      <button type="button" className="chip" onClick={() => {
        fetch(apiUrl('/api/copilot/history'), { headers: headers() })
          .then(r => r.json())
          .then(d => setItems(Array.isArray(d) ? d.slice(0, 8) : []))
      }}>Обновить</button>
    </div>
  )
}
