import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired } from '../middleware/auth.js';
import { getDb, jparse, jstr, wsId, graphId, validateWorkspaceAccess, validateGraphAccess, tokenize, chunkText } from '../utils/helper.js';

const router = Router();

function ragScope(req, res) {
  const wid = wsId(req);
  const gid = graphId(req);
  if (!validateWorkspaceAccess(req, wid)) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  if (gid) {
    const graph = getDb().prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(gid);
    if (!graph || graph.workspace_id !== wid || !validateGraphAccess(req, gid)) {
      res.status(403).json({ error: 'Access denied to graph' });
      return null;
    }
  }
  return { wid, gid };
}

router.get('/rag/documents', authRequired, (req, res) => {
  const scope = ragScope(req, res); if (!scope) return;
  const { wid, gid } = scope;
  let sql = 'SELECT * FROM documents WHERE workspace_id = ?'; const params = [wid];
  if (gid) { sql += ' AND graph_id = ?'; params.push(gid); }
  sql += ' ORDER BY created_at DESC';
  res.json(getDb().prepare(sql).all(...params).map(d => ({ ...d, nodeIds: jparse(d.node_ids_json, []) })));
});

router.post('/rag/ingest', authRequired, (req, res) => {
  const db = getDb();
  const scope = ragScope(req, res); if (!scope) return;
  const { wid, gid } = scope;
  if (gid && !validateGraphAccess(req, gid, { write: true })) return res.status(403).json({ error: 'Write access denied' });

  const title = String(req.body?.title || 'Untitled').trim().slice(0, 240) || 'Untitled';
  const content = String(req.body?.content || '');
  const projectId = req.body?.projectId ? String(req.body.projectId) : null;
  const nodeIds = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds.map(String).slice(0, 500) : [];
  if (!content.trim()) return res.status(400).json({ error: 'content required' });
  if (content.length > 1_000_000) return res.status(413).json({ error: 'document too large' });
  if (projectId) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, wid);
    if (!project) return res.status(400).json({ error: 'Invalid projectId' });
  }

  const id = randomUUID();
  const parts = chunkText(content);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO documents (id, workspace_id, project_id, graph_id, title, length, node_ids_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, wid, projectId, gid || null, title, content.length, jstr(nodeIds));
    const insertChunk = db.prepare(`INSERT INTO chunks (id, document_id, workspace_id, graph_id, idx, text, tokens_json, node_ids_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    parts.forEach((text, i) => insertChunk.run(randomUUID(), id, wid, gid || null, i, text, jstr(tokenize(text)), jstr(nodeIds)));
  });
  tx();
  res.status(201).json({ document: { id, title, graphId: gid || null }, chunks: parts.length });
});

router.get('/rag/search', authRequired, (req, res) => {
  const scope = ragScope(req, res); if (!scope) return;
  const { wid, gid } = scope;
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const qTokens = tokenize(q);
  let sql = 'SELECT * FROM chunks WHERE workspace_id = ?'; const params = [wid];
  if (gid) { sql += ' AND graph_id = ?'; params.push(gid); }
  const chunks = getDb().prepare(sql).all(...params);
  const scored = chunks.map(c => {
    let score = 0;
    const tokens = new Set(jparse(c.tokens_json, []));
    const lower = String(c.text || '').toLowerCase();
    for (const t of qTokens) {
      if (tokens.has(t)) score += 1.25;
      if (lower.includes(t)) score += 0.35;
    }
    return { chunkId: c.id, documentId: c.document_id, text: c.text, score, nodeIds: jparse(c.node_ids_json, []), graphId: c.graph_id };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.min(20, Number(req.query.limit) || 6));
  res.json(scored);
});

export default router;
