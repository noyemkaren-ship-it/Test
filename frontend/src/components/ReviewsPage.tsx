import { useEffect, useState, useCallback } from 'react'
import { apiUrl } from '../config'
import { usePreferences } from '../preferences'

export default function ReviewsPage({
  headers,
  onBack
}: {
  headers: () => Record<string, string>
  onBack: () => void
}) {
  const { tr } = usePreferences()
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
        setError(tr(`Ошибка загрузки: ${res.status}`, `Loading error: ${res.status}`))
        return
      }
      const data = await res.json()
      setAvg(Number(data.average) || 0)
      setCount(Number(data.count) || 0)
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      setError(tr('Backend недоступен', 'Backend is unavailable'))
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
          userName: name.trim() || tr('Гость', 'Guest'),
          page: 'reviews'
        })
      })
      if (res.ok) {
        setMsg(tr('Спасибо! Отзыв сохранён', 'Thank you! Your review was saved'))
        setComment('')
        setName('')
        setScore(5)
        await load()
        setTimeout(() => setMsg(''), 3000)
      } else {
        const err = await res.json().catch(() => ({}))
        setMsg(err.error || tr('Не удалось сохранить', 'Could not save the review'))
      }
    } catch {
      setMsg(tr('Backend недоступен', 'Backend is unavailable'))
    }
    setLoading(false)
  }

  return (
    <div className="reviews-page">
      <header className="reviews-hero">
        <div>
          <p className="eyebrow">Graph Platform · Feedback</p>
          <h1>{tr('Отзывы и оценки', 'Reviews and ratings')}</h1>
          <p className="hint">
            {tr('Оцените платформу от 1 до 5 и оставьте комментарий. Средняя:', 'Rate the platform from 1 to 5 and leave a comment. Average:')}{' '}
            <strong>{avg ? avg.toFixed(2) : '—'}</strong> · {tr('голосов', 'votes')}: {count}
          </p>
        </div>
        <button type="button" className="chip" onClick={onBack}>← {tr('На платформу', 'Back to platform')}</button>
      </header>

      <div className="reviews-grid">
        <form className="panel reviews-form" onSubmit={submit}>
          <h3>{tr('Оставить отзыв', 'Leave a review')}</h3>
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
            <span className="star-label">{score} {tr('из 5', 'of 5')}</span>
          </div>
          <input
            className="field"
            placeholder={tr('Ваше имя', 'Your name')}
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
          />
          <textarea
            className="field"
            placeholder={tr('Что понравилось / что улучшить…', 'What worked well / what should improve…')}
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={4}
            maxLength={2000}
          />
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? tr('Отправка...', 'Sending...') : tr('Отправить отзыв', 'Send review')}
          </button>
          {msg && <p className="sub-hint" style={{ color: msg.includes('Спасибо') || msg.includes('Thank') ? 'var(--ok)' : 'var(--danger)' }}>{msg}</p>}
          {error && <p className="sub-hint" style={{ color: 'var(--danger)' }}>{error}</p>}
        </form>

        <div className="panel">
          <h3>{tr('Все отзывы', 'All reviews')} ({items.length})</h3>
          <div className="reviews-list">
            {items.map((r: any) => (
              <article key={r.id} className="review-card">
                <div className="review-top">
                  <span className="review-stars">{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</span>
                  <span className="review-name">{r.user_name || tr('Аноним', 'Anonymous')}</span>
                </div>
                <p className="review-text">{r.comment || tr('Без комментария', 'No comment')}</p>
                <time className="review-date">{r.created_at}</time>
              </article>
            ))}
            {!items.length && !error && <p className="muted">{tr('Пока нет отзывов — будьте первым', 'No reviews yet — be the first')}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
