const KB = {
  'граф знаний': 'Центральное хранилище: каждое понятие один раз. Формы ссылаются, не копируют.',
  'control knowledge': 'Домен контроля: контрольные отчёты, КС, DELTA. Инструмент экономиста.',
  'interest scope': 'Вычисляемая область интересов Actor из графа, не хранится как атрибут.',
  'actor': 'Human | AIAgent | Service | ExternalSystem. Роль на связи Actor↔Object. Заказчик ≠ Owner.',
  'pipe': 'Поток изменения. Намеренно НЕ формализован жёстко в онтологии.',
  'fsm': 'FSM Engine: жизненные циклы Task/Defect/Review/ChangeRequest/KnowledgeDefect и др.',
  'ontology': 'Default First → Configure Second → Extend Third. Расширения только аддитивные.',
  'rag': 'Документы режутся на chunks, lexical retrieval + контекст графа → LLM Gateway.',
  'transformation graph': 'Knowledge + Implementation + Project + Resource с общими ID.',
  '0409101': 'Оборотная ведомость. Пилотная форма платформы.',
  'workspace': 'Workspace → Portfolio → Project → Graph. Multi-tenant масштаб.'
};

export function answerLocal({ message, context, store, ragHits = [] }) {
  const m = (message || '').toLowerCase();
  if (/привет|здравствуй|hello|^hi$/.test(m)) {
    return { answer: 'Привет! Я Graph Copilot. Могу объяснить граф знаний, слои, Actor, Interest Scope, Control Knowledge, Pipe и архитектуру.', model: 'local-v2', sources: ['greet'] };
  }
  if (/кто ты|ты кто|who are you|представься/.test(m)) {
    return { answer: 'Я ассистент Graph Platform: отвечаю по контексту графа и RAG. Если внешний LLM недоступен — работаю локально.', model: 'local-v2', sources: ['identity'] };
  }
  const parts = [];
  const sources = [];
  for (const [k, v] of Object.entries(KB)) {
    if (m.includes(k)) { parts.push(v); sources.push(k); }
  }
  const nodes = store.getNodes();
  nodes.filter(n => m.includes((n.label || '').toLowerCase()) || m.includes(n.id)).forEach(n => {
    parts.push(`Узел «${n.label}» [${n.layer}/${n.tab || '-'}]: ${n.description || n.kind}`);
    sources.push(n.id);
  });
  if (ragHits.length) {
    parts.push('Из документов (RAG):\n' + ragHits.map(h => `• ${h.text.slice(0, 220)}`).join('\n'));
  }
  if (!parts.length) {
    parts.push('Контекст графа:\n' + context.nodes.slice(0, 10).map(n => `• ${n.label}: ${n.description || n.kind}`).join('\n'));
    parts.push('Уточните вопрос или задайте OPENAI_API_KEY для внешнего LLM.');
  }
  return { answer: parts.join('\n\n'), model: 'graph-copilot-local-v2', sources };
}
