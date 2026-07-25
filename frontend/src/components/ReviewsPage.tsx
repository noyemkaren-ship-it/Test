import { useEffect, useState, useCallback } from 'react'
import { apiUrl } from '../config'

export default function ReviewsPage({
  headers,
  onBack
}: {
  headers: () => Record<string, string>
  onBack: () => void
}) {
  const [score, setScore] = useState(5)
  const [comment, setComment] = useState('')
  const [name, setName] = useState('')
  const [avg, setAvg] = useState(0)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(apiUrl('/api/ratings'), { headers: headers() })
      if (!res.ok) {
        setError(`Ошибка загрузки: ${res.status}`)
        return
      }
      const data = await res.json()
      setAvg(Number(data.average) || 0)
      setCount(Number(data.count) || 0)
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      setError('Backend недоступен')
      setItems([])
    }
  }, [headers])

  useEffect(() => {
    load()
  }, [load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMsg('')
    setError('')
    try {
      const res = await fetch(apiUrl('/api/ratings'), {
        method: 'POST',
        headers: {
          ...headers(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          score,
          comment: comment.trim(),
          userName: name.trim() || 'Гость',
          page: 'reviews'
        })
      })
      if (res.ok) {
        setMsg('Спасибо! Отзыв сохранён')
        setComment('')
        setName('')
        setScore(5)
        await load()
        setTimeout(() => setMsg(''), 3000)
      } else {
        const err = await res.json().catch(() => ({}))
        setMsg(err.error || 'Не удалось сохранить')
      }
    } catch {
      setMsg('Backend недоступен')
    }
    setLoading(false)
  }

  return (
    <div className="reviews-page">
      <header className="reviews-hero">
        <div>
          <p className="eyebrow">Graph Platform · Feedback</p>
          <h1>Отзывы и оценки</h1>
          <p className="hint">
            Оцените платформу от 1 до 5 и оставьте комментарий. Средняя:{' '}
            <strong>{avg ? avg.toFixed(2) : '—'}</strong> · голосов: {count}
          </p>
        </div>
        <button type="button" className="chip" onClick={onBack}>← На платформу</button>
      </header>

      <div className="reviews-grid">
        <form className="panel reviews-form" onSubmit={submit}>
          <h3>Оставить отзыв</h3>
          <div className="star-row">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                className={`star-btn ${score >= n ? 'on' : ''}`}
                onClick={() => setScore(n)}
              >
                ★
              </button>
            ))}
            <span className="star-label">{score} из 5</span>
          </div>
          <input
            className="field"
            placeholder="Ваше имя"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
          />
          <textarea
            className="field"
            placeholder="Что понравилось / что улучшить…"
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={4}
            maxLength={2000}
          />
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Отправка...' : 'Отправить отзыв'}
          </button>
          {msg && <p className="sub-hint" style={{ color: msg.includes('Спасибо') ? 'var(--ok)' : 'var(--danger)' }}>{msg}</p>}
          {error && <p className="sub-hint" style={{ color: 'var(--danger)' }}>{error}</p>}
        </form>

        <div className="panel">
          <h3>Все отзывы ({items.length})</h3>
          <div className="reviews-list">
            {items.map((r: any) => (
              <article key={r.id} className="review-card">
                <div className="review-top">
                  <span className="review-stars">{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</span>
                  <span className="review-name">{r.user_name || 'Аноним'}</span>
                </div>
                <p className="review-text">{r.comment || 'Без комментария'}</p>
                <time className="review-date">{r.created_at}</time>
              </article>
            ))}
            {!items.length && !error && <p className="muted">Пока нет отзывов — будьте первым</p>}
          </div>
        </div>
      </div>
    </div>
  )
}