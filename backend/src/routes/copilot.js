import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb, jparse, jstr, wsId, graphId, validateWorkspaceAccess, validateGraphAccess, tokenize } from '../utils/helper.js';
import { createStoreAdapter } from '../utils/storeAdapter.js';
import { buildContext } from '../ai/builder.js';
import { callLLM, buildSystemPrompt } from '../engines/llm.js';
import { answerLocal } from '../ai/copilot.js';
import { validateChatBody } from '../middleware/security.js';

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
    const ragHits = allChunks.map(c => {
      let score = 0;
      const tokens = new Set(jparse(c.tokens_json, []));
      const lower = String(c.text || '').toLowerCase();
      for (const t of qTokens) {
        if (tokens.has(t)) score += 1.25;
        if (lower.includes(t)) score += 0.35;
      }
      return { chunkId: c.id, documentId: c.document_id, text: c.text, score };
    }).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);

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

    const qid = randomUUID();
    db.prepare(`
      INSERT INTO questions
      (id, workspace_id, graph_id, session_id, message, answer, model, actor_id, role, selected_node_ids_json, context_node_ids_json, rag_chunk_ids_json, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      qid, wid, gid || null, sessionId, message || '', answer, model, actorId || null, role || null,
      jstr(selectedNodeIds || []), jstr(context.nodeIds), jstr(ragHits.map(h => h.chunkId)), Date.now()
    );

    res.json({
      answer,
      model,
      usedExternalLLM: !!llm.usedExternal,
      offline: !llm.usedExternal,
      confidence: llm.confidence ?? null,
      sources: { nodes: context.nodeIds, rag: ragHits.map(h => h.documentId), offline: llm.sources || [] },
      retrieval: llm.retrieval || { ragHits: ragHits.length },
      questionId: qid,
      sessionId,
      usage: llm.usage || null
    });
  } catch (e) {
    console.error('POST /copilot/chat:', e);
    res.status(500).json({ error: 'Copilot request failed' });
  }
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
