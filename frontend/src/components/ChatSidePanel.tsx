import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '../config'
import { usePreferences } from '../preferences'

type Message = {
  role: 'user' | 'bot'
  text: string
  model?: string
  offline?: boolean
  confidence?: number | null
}

export default function ChatSidePanel({ selectedNodeIds, tab, headers }: any) {
  const { tr } = usePreferences()
  const suggestions = [
    tr('Объясни этот граф как руководителю', 'Explain this graph to an executive'),
    tr('Что здесь является главным риском?', 'What is the main risk here?'),
    tr('Как работает Interest Scope?', 'How does Interest Scope work?'),
    tr('Что важно для разработчика?', 'What matters to a developer?')
  ]
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'bot',
      text: tr(
        'Я Graph Copilot. Вижу контекст текущего графа и RAG. Если внешний LLM недоступен, переключаюсь на локальный hybrid AI без отправки данных наружу.',
        'I’m Graph Copilot. I can see the current graph and RAG context. If the external LLM is unavailable, I switch to local hybrid AI without sending data outside.'
      ),
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
        text: data.answer || tr('Ответ пуст.', 'The answer is empty.'),
        model: data.model || 'local',
        offline: !!data.offline,
        confidence: data.confidence
      }])
    } catch (error: any) {
      setMessages(current => [...current, {
        role: 'bot',
        text: error?.message === 'Copilot unavailable'
          ? tr('Copilot сейчас недоступен.', 'Copilot is currently unavailable.')
          : tr('Не удалось связаться с Copilot. Проверьте backend и offline-ai service.', 'Could not reach Copilot. Check the backend and offline AI service.'),
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
          <p>{selectedNodeIds?.length ? `${selectedNodeIds.length} ${tr('узлов в контексте', 'nodes in context')} · ${tab}` : `${tr('контекст графа', 'graph context')} · ${tab}`}</p>
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
                  {typeof m.confidence === 'number' && <span>{Math.round(m.confidence * 100)}% {tr('уверенность', 'confidence')}</span>}
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
        {suggestions.map(s => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
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
          placeholder={tr('Спросите по графу, роли, процессу или RAG…', 'Ask about the graph, role, process or RAG…')}
          disabled={loading}
          rows={2}
        />
        <button type="submit" disabled={loading || !input.trim()} aria-label={tr('Отправить', 'Send')}>↗</button>
      </form>
      <div className="chat-privacy">Local fallback · graph-aware context · source-grounded answers</div>
    </aside>
  )
}
