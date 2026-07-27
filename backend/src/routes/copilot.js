import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb, jparse, jstr, wsId, graphId, validateWorkspaceAccess, validateGraphAccess, tokenize } from '../utils/helper.js';
import { createStoreAdapter } from '../utils/storeAdapter.js';
import { buildContext } from '../ai/builder.js';
import { callLLM, buildSystemPrompt } from '../engines/llm.js';
import { answerLocal } from '../ai/copilot.js';
import { validateChatBody } from '../middleware/security.js';
import { authRequired } from '../middleware/auth.js';
import { rankChunks } from '../engines/rag.js';

const router = Router();

function safeSessionId(req, authenticated) {
  const raw = req.headers['x-session-id'] || req.body?.sessionId;
  if (raw) return String(raw).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 120) || randomUUID();
  if (authenticated) return `user:${req.user.sub || req.user.id}`;
  // No cross-user history for anonymous API clients that do not provide a session ID.
  return `guest:${randomUUID()}`;
}

function recentHistory(db, wid, gid, sessionId, limit = 6) {
  let sql = 'SELECT message, answer FROM questions WHERE workspace_id = ? AND session_id = ?';
  const params = [wid, sessionId];
  if (gid) { sql += ' AND graph_id = ?'; params.push(gid); }
  sql += ' ORDER BY ts DESC LIMIT ?'; params.push(limit);
  return db.prepare(sql).all(...params).reverse().flatMap(row => [
    { role: 'user', content: row.message || '' },
    { role: 'assistant', content: row.answer || '' }
  ]);
}

router.post('/copilot/chat', validateChatBody, async (req, res) => {
  try {
    const db = getDb();
    const { message, actorId, selectedNodeIds, role, tab } = req.body || {};
    const requestedWid = wsId(req);
    const gid = graphId(req);
    const authenticated = !!(req.user?.id && req.user.id !== 'anon');
    const graphMeta = gid ? db.prepare('SELECT id, workspace_id, name, slug, description, visibility FROM graphs WHERE id = ?').get(gid) : null;

    if (gid && (!graphMeta || !validateGraphAccess(req, gid))) return res.status(403).json({ error: 'Access denied to this graph' });
    if (!gid && authenticated && !validateWorkspaceAccess(req, requestedWid)) return res.status(403).json({ error: 'Access denied to this workspace' });

    const wid = graphMeta?.workspace_id || requestedWid;
    const hasWorkspaceAccess = authenticated && validateWorkspaceAccess(req, wid);
    const storeAdapter = createStoreAdapter(wid, { graphId: gid || null, publicOnly: !hasWorkspaceAccess });
    const context = buildContext({ store: storeAdapter, actorId, selectedNodeIds, role });
    if (tab) context.nodes = context.nodes.filter(n => !n.tab || n.tab === tab);

    const qTokens = tokenize(message || '');
    let chunkSql = 'SELECT * FROM chunks WHERE workspace_id = ?';
    const chunkParams = [wid];
    if (gid) { chunkSql += ' AND graph_id = ?'; chunkParams.push(gid); }
    else if (!hasWorkspaceAccess) chunkSql += " AND graph_id IN (SELECT id FROM graphs WHERE COALESCE(visibility, 'public') = 'public')";
    const allChunks = db.prepare(chunkSql).all(...chunkParams);
    const ragHits = rankChunks(allChunks, qTokens, { limit: 6, parseJson: value => jparse(value, []) });

    const contextText = [
      graphMeta ? `Домен: ${graphMeta.name} (${graphMeta.slug}) - ${graphMeta.description || ''}` : 'Домен: доступные опубликованные графы',
      'Узлы:',
      ...context.nodes.slice(0, 45).map(n => `- [${n.layer || '-'}/${n.tab || '-'}] ${n.label}: ${n.description || n.kind || ''}`),
      'Связи:',
      ...context.edges.slice(0, 50).map(e => `- ${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ''}`),
      'Work Items:',
      ...context.workItems.slice(0, 20).map(w => `- (${w.type}/${w.status}) ${w.title}`),
      'RAG:',
      ...ragHits.map(h => `- ${h.text.slice(0, 500)}`)
    ].join('\n');

    const sessionId = safeSessionId(req, authenticated);
    const history = recentHistory(db, wid, gid, sessionId, 5);
    const startedAt = Date.now();
    const llm = await callLLM({ system: buildSystemPrompt(), user: message || '', contextText, sessionId, history });

    let answer; let model = llm.model;
    if (llm.text) {
      answer = llm.text;
    } else {
      const local = answerLocal({ message, context, store: storeAdapter, ragHits });
      answer = local.answer;
      model = local.model || 'graph-copilot-local-v2';
      if (llm.reason) answer += `\n\nСистемная заметка: ${llm.reason}`;
    }

    const completedAt = Date.now();
    const usage = llm.usage || {};
    const promptTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
    const completionTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
    const totalTokens = Number(usage.total_tokens || (promptTokens + completionTokens));
    const provider = llm.usedExternal ? 'external-openai-compatible' : (llm.text ? 'offline-ai' : 'graph-local');
    const intent = String(req.body?.intent || (/\b(why|почему)\b/i.test(message || '') ? 'explain' : /\b(find|show|найди|покажи)\b/i.test(message || '') ? 'retrieve' : 'question')).slice(0, 80);
    const qid = randomUUID();
    let conversation = db.prepare(`SELECT * FROM conversations
      WHERE workspace_id=? AND session_id=? AND ((graph_id=? ) OR (graph_id IS NULL AND ? IS NULL)) LIMIT 1`)
      .get(wid, sessionId, gid || null, gid || null);
    const conversationId = conversation?.id || randomUUID();
    const answerId = randomUUID();
    const sources = { nodes: context.nodeIds, rag: ragHits.map(h => h.documentId), offline: llm.sources || [] };
    db.transaction(() => {
      if (!conversation) {
        db.prepare(`INSERT INTO conversations
          (id,workspace_id,graph_id,session_id,title,actor_id,role) VALUES (?,?,?,?,?,?,?)`)
          .run(conversationId, wid, gid || null, sessionId, String(message || 'Graph Copilot').slice(0, 120), actorId || null, role || null);
      } else {
        db.prepare("UPDATE conversations SET updated_at=datetime('now'),actor_id=COALESCE(?,actor_id),role=COALESCE(?,role) WHERE id=?")
          .run(actorId || null, role || null, conversationId);
      }
      db.prepare(`
        INSERT INTO questions
        (id, workspace_id, graph_id, conversation_id, session_id, message, answer, model, actor_id, role, intent, tab,
         selected_node_ids_json, context_node_ids_json, rag_chunk_ids_json, provider, cost, prompt_tokens,
         completion_tokens, total_tokens, latency_ms, diagram, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        qid, wid, gid || null, conversationId, sessionId, message || '', answer, model, actorId || null, role || null,
        intent, tab || null, jstr(selectedNodeIds || []), jstr(context.nodeIds), jstr(ragHits.map(h => h.chunkId)),
        provider, Number(usage.cost || 0), promptTokens, completionTokens, totalTokens, completedAt - startedAt,
        req.body?.diagram ? String(req.body.diagram).slice(0, 20000) : null, completedAt
      );
      db.prepare(`INSERT INTO answers
        (id,conversation_id,question_id,workspace_id,graph_id,text,model,confidence,sources_json)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(answerId, conversationId, qid, wid, gid || null, answer, model, llm.confidence ?? null, jstr(sources));
      db.prepare(`INSERT INTO reasoning_steps
        (id,conversation_id,question_id,kind,summary,evidence_json) VALUES (?,?,?,?,?,?)`)
        .run(randomUUID(), conversationId, qid, 'context', `Graph Context Builder selected ${context.nodeIds.length} nodes and ${ragHits.length} RAG chunks`, jstr({ nodeIds: context.nodeIds, ragChunkIds: ragHits.map(h => h.chunkId), provider }));
    })();

    res.json({
      answer,
      model,
      usedExternalLLM: !!llm.usedExternal,
      offline: !llm.usedExternal,
      confidence: llm.confidence ?? null,
      sources,
      retrieval: llm.retrieval || { ragHits: ragHits.length },
      questionId: qid,
      answerId,
      conversationId,
      sessionId,
      usage: { promptTokens, completionTokens, totalTokens, cost: Number(usage.cost || 0), latencyMs: completedAt - startedAt }
    });
  } catch (e) {
    console.error('POST /copilot/chat:', e);
    res.status(500).json({ error: 'Copilot request failed' });
  }
});

router.get('/conversations', authRequired, (req, res) => {
  try {
    const db = getDb(); const wid = wsId(req); const gid = graphId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    let sql = `SELECT c.*,
      (SELECT COUNT(*) FROM questions q WHERE q.conversation_id=c.id) question_count,
      (SELECT COUNT(*) FROM decisions d WHERE d.conversation_id=c.id) decision_count
      FROM conversations c WHERE c.workspace_id=?`;
    const params = [wid];
    if (gid) { sql += ' AND c.graph_id=?'; params.push(gid); }
    sql += ' ORDER BY c.updated_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (e) { res.status(500).json({ error: 'Failed to load conversations' }); }
});

router.post('/conversations', authRequired, (req, res) => {
  try {
    const db = getDb(); const wid = wsId(req); const gid = graphId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    if (gid && !validateGraphAccess(req, gid, { write: true })) return res.status(403).json({ error: 'Graph write access denied' });
    const id = randomUUID();
    const sessionId = safeSessionId(req, true);
    db.prepare(`INSERT INTO conversations (id,workspace_id,graph_id,session_id,title,actor_id,role)
      VALUES (?,?,?,?,?,?,?)`).run(id, wid, gid || null, sessionId, String(req.body?.title || 'Graph Copilot conversation').slice(0, 160), req.body?.actorId || null, req.body?.role || null);
    res.status(201).json({ id, workspaceId: wid, graphId: gid || null, sessionId });
  } catch (e) { res.status(409).json({ error: e.message }); }
});

router.get('/conversations/:id', authRequired, (req, res) => {
  try {
    const db = getDb(); const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    const conversation = db.prepare('SELECT * FROM conversations WHERE id=? AND workspace_id=?').get(req.params.id, wid);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const questions = db.prepare('SELECT * FROM questions WHERE conversation_id=? ORDER BY ts').all(conversation.id);
    const answers = db.prepare('SELECT * FROM answers WHERE conversation_id=? ORDER BY created_at').all(conversation.id)
      .map(row => ({ ...row, sources: jparse(row.sources_json, {}) }));
    const reasoning = db.prepare('SELECT * FROM reasoning_steps WHERE conversation_id=? ORDER BY created_at').all(conversation.id)
      .map(row => ({ ...row, evidence: jparse(row.evidence_json, {}) }));
    const decisions = db.prepare('SELECT * FROM decisions WHERE conversation_id=? ORDER BY created_at').all(conversation.id);
    res.json({ ...conversation, questions, answers, reasoning, decisions });
  } catch (e) { res.status(500).json({ error: 'Failed to load conversation' }); }
});

router.get('/answers', authRequired, (req, res) => {
  const db = getDb(); const wid = wsId(req); const gid = graphId(req);
  if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
  let sql = 'SELECT * FROM answers WHERE workspace_id=?'; const params = [wid];
  if (gid) { sql += ' AND graph_id=?'; params.push(gid); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params).map(row => ({ ...row, sources: jparse(row.sources_json, {}) })));
});

router.patch('/answers/:id/feedback', authRequired, (req, res) => {
  const db = getDb(); const wid = wsId(req);
  if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
  const feedback = String(req.body?.feedback || '').trim().slice(0, 2000);
  const row = db.prepare('SELECT id,question_id FROM answers WHERE id=? AND workspace_id=?').get(req.params.id, wid);
  if (!row) return res.status(404).json({ error: 'Answer not found' });
  db.transaction(() => {
    db.prepare('UPDATE answers SET feedback=? WHERE id=?').run(feedback, row.id);
    db.prepare('UPDATE questions SET feedback=? WHERE id=?').run(feedback, row.question_id);
  })();
  res.json({ ok: true, id: row.id, feedback });
});

router.get('/conversations/:id/decisions', authRequired, (req, res) => {
  const db = getDb(); const wid = wsId(req);
  if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
  const conversation = db.prepare('SELECT id FROM conversations WHERE id=? AND workspace_id=?').get(req.params.id, wid);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  res.json(db.prepare('SELECT * FROM decisions WHERE conversation_id=? ORDER BY created_at').all(conversation.id));
});

router.post('/conversations/:id/decisions', authRequired, (req, res) => {
  const db = getDb(); const wid = wsId(req);
  if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
  const conversation = db.prepare('SELECT id FROM conversations WHERE id=? AND workspace_id=?').get(req.params.id, wid);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const title = String(req.body?.title || '').trim().slice(0, 240);
  if (!title) return res.status(400).json({ error: 'title required' });
  const id = randomUUID();
  db.prepare(`INSERT INTO decisions (id,conversation_id,answer_id,title,rationale,status,created_by)
    VALUES (?,?,?,?,?,?,?)`).run(id, conversation.id, req.body?.answerId || null, title, String(req.body?.rationale || '').slice(0, 4000), String(req.body?.status || 'proposed').slice(0, 40), req.user?.sub || req.user?.id);
  res.status(201).json(db.prepare('SELECT * FROM decisions WHERE id=?').get(id));
});

router.get('/copilot/history', (req, res) => {
  try {
    const db = getDb(); const wid = wsId(req); const gid = graphId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    let sql = 'SELECT * FROM questions WHERE workspace_id = ?'; const params = [wid];
    if (gid) { sql += ' AND graph_id = ?'; params.push(gid); }
    sql += ' ORDER BY ts DESC LIMIT 100';
    res.json(db.prepare(sql).all(...params));
  } catch (e) { res.status(500).json({ error: 'Failed to load history' }); }
});

export default router;
