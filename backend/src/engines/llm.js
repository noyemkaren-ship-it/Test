/**
 * LLM Gateway v3
 * 1) OpenAI-compatible provider (DeepSeek/OpenAI/etc.) when configured.
 * 2) Graph-aware local Hybrid Offline AI with the SAME context when external LLM is unavailable.
 */
const OFFLINE_URL = (process.env.OFFLINE_AI_URL || 'http://127.0.0.1:5005').replace(/\/$/, '');
const OFFLINE_KEY = process.env.OFFLINE_AI_KEY || 'offline-dev-key';

export async function callOfflineAI({ message, contextText = '', sessionId = 'default', history = [] }) {
  try {
    const res = await fetch(`${OFFLINE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Offline-Key': OFFLINE_KEY },
      body: JSON.stringify({
        message,
        context: contextText.slice(0, 60000),
        sessionId,
        history: Array.isArray(history) ? history.slice(-8) : []
      }),
      signal: AbortSignal.timeout(Number(process.env.OFFLINE_AI_TIMEOUT_MS || 12000))
    });
    if (!res.ok) {
      const text = await res.text();
      return { text: null, model: 'offline-hybrid-rag-v3', usedExternal: false, fallback: true, reason: `Offline AI HTTP ${res.status}: ${text.slice(0, 140)}` };
    }
    const data = await res.json();
    return {
      text: data.answer || data.text || '',
      model: data.model || 'offline-hybrid-rag-v3',
      usedExternal: false,
      fallback: true,
      sources: data.sources || [],
      confidence: data.confidence ?? null,
      retrieval: data.retrieval || null,
      reason: null
    };
  } catch (e) {
    return { text: null, model: 'offline-hybrid-rag-v3', usedExternal: false, fallback: true, reason: `Offline AI unavailable: ${e.message || e}` };
  }
}

// backwards compatibility
export async function callOfflineRNN(message) {
  return callOfflineAI({ message });
}

export async function callLLM({ system, user, contextText, sessionId = 'default', history = [] }) {
  const key = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  const base = (process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  if (!key) {
    const offline = await callOfflineAI({ message: user, contextText, sessionId, history });
    if (offline.text) return offline;
    return { text: null, model: 'local-kb', usedExternal: false, fallback: true, reason: offline.reason || 'Offline AI unavailable' };
  }

  const payload = {
    model,
    temperature: Number(process.env.LLM_TEMPERATURE || 0.18),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Контекст Graph Platform:\n${contextText}\n\nВопрос пользователя:\n${user}` }
    ]
  };

  try {
    let res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || 45000))
    });
    if (res.status === 404) {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || 45000))
      });
    }
    if (!res.ok) {
      const err = await res.text();
      const offline = await callOfflineAI({ message: user, contextText, sessionId, history });
      if (offline.text) {
        offline.reason = `External LLM HTTP ${res.status}; switched to offline AI`;
        return offline;
      }
      return { text: null, model, usedExternal: false, reason: `LLM HTTP ${res.status}: ${err.slice(0, 180)}` };
    }
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      model,
      usedExternal: true,
      fallback: false,
      usage: data.usage || null,
      confidence: null
    };
  } catch (e) {
    const offline = await callOfflineAI({ message: user, contextText, sessionId, history });
    if (offline.text) {
      offline.reason = `External LLM unavailable (${e.message || e}); switched to offline AI`;
      return offline;
    }
    return { text: null, model, usedExternal: false, reason: String(e.message || e) };
  }
}

export function buildSystemPrompt() {
  return `Ты Graph Copilot v3 платформы знаний Graph Platform.
Отвечай по переданному контексту графа, Work Items и RAG. Не выдумывай отсутствующие факты.
Сначала дай прямой ответ, затем при необходимости 2-4 опорных пункта. Отмечай ограничения данных.
Учитывай: Domain/Graph изоляцию, Actor + role bindings, Interest Scope, Transformation Graph,
Default First ontology, FSM и публичный read-only доступ к опубликованным доменам.
Основной язык ответа - русский, если пользователь не пишет на другом языке.`;
}
