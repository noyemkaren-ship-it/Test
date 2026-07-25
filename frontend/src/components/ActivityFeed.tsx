import { useEffect, useState } from 'react'
import { apiUrl } from '../config'
import { usePreferences } from '../preferences'

export default function ActivityFeed({ headers }: { headers: () => Record<string, string> }) {
  const { language, tr } = usePreferences()
  const [items, setItems] = useState<any[]>([])

  useEffect(() => {
    fetch(apiUrl('/api/copilot/history'), { headers: headers() })
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d.slice(0, 8) : []))
      .catch(() => setItems([]))
  }, [])

  return (
    <div className="panel">
      <h3>{tr('Лента вопросов Copilot', 'Copilot question feed')}</h3>
      <p className="sub-hint">{tr('История вопросов и аналитика домена', 'Question history and domain analytics')}</p>
      <div className="activity-list">
        {items.map((q: any) => (
          <div key={q.id} className="activity-item">
            <div className="activity-q">{q.message}</div>
            <div className="activity-meta">{q.model} · {q.ts ? new Date(q.ts).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US') : ''}</div>
          </div>
        ))}
        {!items.length && <p className="muted">{tr('Пока пусто — задайте вопрос в чате справа', 'Nothing here yet — ask a question in the chat')}</p>}
      </div>
      <button type="button" className="chip" onClick={() => {
        fetch(apiUrl('/api/copilot/history'), { headers: headers() })
          .then(r => r.json())
          .then(d => setItems(Array.isArray(d) ? d.slice(0, 8) : []))
      }}>{tr('Обновить', 'Refresh')}</button>
    </div>
  )
}
