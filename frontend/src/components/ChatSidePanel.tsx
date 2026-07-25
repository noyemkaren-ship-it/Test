import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '../config'

type Message = {
  role: 'user' | 'bot'
  text: string
  model?: string
  offline?: boolean
  confidence?: number | null
}

const SUGGESTIONS = [
  'Объясни этот граф как руководителю',
  'Что здесь является главным риском?',
  'Как работает Interest Scope?',
  'Чем Заказчик отличается от Owner?'
]

export default function ChatSidePanel({ selectedNodeIds, tab, headers }: any) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'bot',
      text: 'Я Graph Copilot. Вижу контекст текущего графа и RAG. Если внешний LLM недоступен, переключаюсь на локальный hybrid AI без отправки данных наружу.',
      model: 'Graph Copilot'
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  async function send(text?: string) {
    const message = (text ?? input).trim()
    if (!message || loading) return
    setInput('')
    setMessages(current => [...current, { role: 'user', text: message }])
    setLoading(true)
    try {
      const res = await fetch(apiUrl('/api/copilot/chat'), {
        method: 'POST',
        headers: typeof headers === 'function' ? headers() : headers,
        body: JSON.stringify({ message, selectedNodeIds: selectedNodeIds || [], actorId: 'act-ai', tab })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Copilot unavailable')
      setMessages(current => [...current, {
        role: 'bot',
        text: data.answer || 'Ответ пуст.',
        model: data.model || 'local',
        offline: !!data.offline,
        confidence: data.confidence
      }])
    } catch (error: any) {
      setMessages(current => [...current, {
        role: 'bot',
        text: error?.message === 'Copilot unavailable'
          ? 'Copilot сейчас недоступен.'
          : 'Не удалось связаться с Copilot. Проверьте backend и offline-ai service.',
        model: 'connection-error'
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <aside className="app-chat premium-chat">
      <div className="chat-head premium-chat-head">
        <div className="ai-avatar">✦</div>
        <div>
          <h2>Graph Copilot</h2>
          <p>{selectedNodeIds?.length ? `${selectedNodeIds.length} node context · ${tab}` : `graph context · ${tab}`}</p>
        </div>
        <span className="ai-live"><i /> live</span>
      </div>

      <div className="chat-messages premium-messages">
        {messages.map((m, i) => (
          <div key={i} className={`message-row ${m.role}`}>
            {m.role === 'bot' && <span className="message-avatar">✦</span>}
            <div className={`msg ${m.role}`}>
              <div>{m.text}</div>
              {m.role === 'bot' && m.model && (
                <div className="message-meta">
                  <span>{m.offline ? 'LOCAL' : 'AI'}</span>
                  <span>{m.model}</span>
                  {typeof m.confidence === 'number' && <span>{Math.round(m.confidence * 100)}% confidence</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="message-row bot">
            <span className="message-avatar">✦</span>
            <div className="msg bot typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-suggestions premium-suggestions">
        {SUGGESTIONS.map(s => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
      </div>

      <form className="chat-form premium-chat-form" onSubmit={e => { e.preventDefault(); send() }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Спросите по графу, роли, процессу или RAG…"
          disabled={loading}
          rows={2}
        />
        <button type="submit" disabled={loading || !input.trim()} aria-label="Отправить">↗</button>
      </form>
      <div className="chat-privacy">Local fallback · graph-aware context · source-grounded answers</div>
    </aside>
  )
}
