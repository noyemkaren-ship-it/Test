import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired } from '../middleware/auth.js';
import { getDb, wsId, graphId, validateWorkspaceAccess, validateGraphAccess, jparse, jstr } from '../utils/helper.js';
import { transitionReview } from '../engines/review.js';

const router = Router();

function scope(req, res, write = false) {
  const db = getDb();
  const gid = graphId(req);
  let wid = wsId(req);
  if (gid) {
    const graph = db.prepare('SELECT id,workspace_id FROM graphs WHERE id=?').get(String(gid));
    if (!graph || !validateGraphAccess(req, graph.id, { write })) {
      res.status(403).json({ error: 'Graph access denied' });
      return null;
    }
    wid = graph.workspace_id;
  } else if (!validateWorkspaceAccess(req, wid)) {
    res.status(403).json({ error: 'Workspace access denied' });
    return null;
  }
  return { db, wid, gid: gid ? String(gid) : null };
}

function actorId(req) {
  return String(req.body?.actorId || req.user?.sub || req.user?.id || 'anonymous').slice(0, 200);
}

function serializeReview(db, row) {
  return {
    id: row.id, workspaceId: row.workspace_id, graphId: row.graph_id, number: row.n,
    authorId: row.author_id, executorId: row.executor_id, status: row.status,
    text: row.text, answer: row.answer, date: row.date, updatedAt: row.updated_at,
    scopes: db.prepare(`SELECT id,project_id AS projectId,artifact_id AS artifactId,object_id AS objectId,version
      FROM review_scopes WHERE review_id=? ORDER BY created_at`).all(row.id),
    votes: db.prepare(`SELECT id,actor_id AS actorId,vote,comment,created_at AS createdAt
      FROM review_votes WHERE review_id=? ORDER BY created_at`).all(row.id)
  };
}

function findWritableReview(req, res, s) {
  const row = s.db.prepare('SELECT * FROM reviews WHERE id=? AND workspace_id=?').get(req.params.id, s.wid);
  if (!row || (s.gid && row.graph_id !== s.gid)) {
    res.status(404).json({ error: 'Review not found' });
    return null;
  }
  return row;
}

function history(db, reviewId, actor, event, fromStatus, toStatus, payload = {}) {
  db.prepare(`INSERT INTO review_history
    (id,review_id,actor_id,event,from_status,to_status,payload_json) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), reviewId, actor, event, fromStatus || null, toStatus || null, jstr(payload));
}

router.get('/reviews', (req, res) => {
  try {
    const s = scope(req, res, false);
    if (!s) return;
    let sql = 'SELECT * FROM reviews WHERE workspace_id=?';
    const params = [s.wid];
    if (s.gid) { sql += ' AND graph_id=?'; params.push(s.gid); }
    sql += " ORDER BY COALESCE(updated_at,date) DESC";
    res.json(s.db.prepare(sql).all(...params).map(row => serializeReview(s.db, row)));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/reviews', authRequired, (req, res) => {
  try {
    const s = scope(req, res, true);
    if (!s) return;
    const text = String(req.body?.text || '').trim().slice(0, 4000);
    if (!text) return res.status(400).json({ error: 'text required' });
    const rawScopes = Array.isArray(req.body?.scopes) ? req.body.scopes : [req.body?.scope || {}];
    const scopes = rawScopes.filter(item => item && typeof item === 'object');
    if (!scopes.length) return res.status(400).json({ error: 'review scope required' });
    const id = randomUUID();
    const author = actorId(req);
    const nextNumber = (s.db.prepare('SELECT COALESCE(MAX(n),0)+1 n FROM reviews WHERE workspace_id=?').get(s.wid)?.n || 1);
    s.db.transaction(() => {
      s.db.prepare(`INSERT INTO reviews
        (id,workspace_id,graph_id,n,scope_json,author_id,executor_id,status,text,answer,date,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(
          id, s.wid, s.gid, nextNumber, jstr(scopes[0]), author, req.body?.executorId || null,
          'open', text, String(req.body?.answer || '').slice(0, 4000) || null
        );
      const insertScope = s.db.prepare(`INSERT INTO review_scopes
        (id,review_id,workspace_id,project_id,artifact_id,object_id,version) VALUES (?,?,?,?,?,?,?)`);
      for (const item of scopes) insertScope.run(randomUUID(), id, s.wid, item.projectId || null, item.artifactId || null, item.objectId || item.artifactId || null, item.version || null);
      history(s.db, id, author, 'created', null, 'open', { scopes: scopes.length });
    })();
    res.status(201).json(serializeReview(s.db, s.db.prepare('SELECT * FROM reviews WHERE id=?').get(id)));
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.patch('/reviews/:id', authRequired, (req, res) => {
  try {
    const s = scope(req, res, true);
    if (!s) return;
    const row = findWritableReview(req, res, s);
    if (!row) return;
    const text = req.body?.text === undefined ? row.text : String(req.body.text).trim().slice(0, 4000);
    if (!text) return res.status(400).json({ error: 'text cannot be empty' });
    s.db.prepare(`UPDATE reviews SET text=?,answer=?,executor_id=?,updated_at=datetime('now') WHERE id=?`)
      .run(text, req.body?.answer === undefined ? row.answer : String(req.body.answer || '').slice(0, 4000), req.body?.executorId === undefined ? row.executor_id : req.body.executorId, row.id);
    history(s.db, row.id, actorId(req), 'updated', row.status, row.status, { fields: Object.keys(req.body || {}) });
    res.json(serializeReview(s.db, s.db.prepare('SELECT * FROM reviews WHERE id=?').get(row.id)));
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/reviews/:id/transition', authRequired, (req, res) => {
  try {
    const s = scope(req, res, true);
    if (!s) return;
    const row = findWritableReview(req, res, s);
    if (!row) return;
    const event = String(req.body?.event || '').toLowerCase();
    const result = transitionReview(row.status, event);
    if (!result.ok) return res.status(409).json({ error: result.error });
    if (event === 'approve') {
      const approval = s.db.prepare("SELECT COUNT(*) count FROM review_votes WHERE review_id=? AND vote='approve'").get(row.id)?.count || 0;
      if (!approval) return res.status(409).json({ error: 'At least one approval vote is required' });
    }
    s.db.prepare("UPDATE reviews SET status=?,updated_at=datetime('now') WHERE id=?").run(result.to, row.id);
    history(s.db, row.id, actorId(req), event, row.status, result.to, { comment: req.body?.comment || '' });
    res.json({ ...result, reviewId: row.id });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/reviews/:id/votes', authRequired, (req, res) => {
  try {
    const s = scope(req, res, true);
    if (!s) return;
    const row = findWritableReview(req, res, s);
    if (!row) return;
    const vote = String(req.body?.vote || '');
    if (!['approve', 'reject', 'abstain'].includes(vote)) return res.status(400).json({ error: 'vote must be approve, reject or abstain' });
    const actor = actorId(req);
    s.db.prepare(`INSERT INTO review_votes (id,review_id,actor_id,vote,comment)
      VALUES (?,?,?,?,?) ON CONFLICT(review_id,actor_id) DO UPDATE SET vote=excluded.vote,comment=excluded.comment,created_at=datetime('now')`)
      .run(randomUUID(), row.id, actor, vote, String(req.body?.comment || '').slice(0, 1000));
    history(s.db, row.id, actor, 'vote', row.status, row.status, { vote });
    res.status(201).json({ ok: true, reviewId: row.id, actorId: actor, vote });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.get('/reviews/:id/history', (req, res) => {
  const s = scope(req, res, false);
  if (!s) return;
  const row = s.db.prepare('SELECT id,graph_id FROM reviews WHERE id=? AND workspace_id=?').get(req.params.id, s.wid);
  if (!row || (s.gid && row.graph_id !== s.gid)) return res.status(404).json({ error: 'Review not found' });
  res.json(s.db.prepare(`SELECT id,actor_id AS actorId,event,from_status AS fromStatus,to_status AS toStatus,payload_json,created_at AS createdAt
    FROM review_history WHERE review_id=? ORDER BY created_at,id`).all(row.id).map(item => ({ ...item, payload: jparse(item.payload_json, {}) })));
});

router.delete('/reviews/:id', authRequired, (req, res) => {
  const s = scope(req, res, true);
  if (!s) return;
  const row = findWritableReview(req, res, s);
  if (!row) return;
  s.db.prepare('DELETE FROM reviews WHERE id=?').run(row.id);
  res.json({ ok: true });
});

export default router;
