import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb, wsId, validateWorkspaceAccess } from '../utils/helper.js';

const router = Router();

function ratingsWorkspace(req, res) {
  const wid = wsId(req);
  // The default product-rating feed is intentionally public. Other tenants remain private.
  if (wid !== 'ws-default' && !validateWorkspaceAccess(req, wid)) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return wid;
}

router.get('/ratings', (req, res) => {
  const wid = ratingsWorkspace(req, res); if (!wid) return;
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM ratings WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100').all(wid);
    const stats = db.prepare('SELECT AVG(score) AS avg, COUNT(*) AS count FROM ratings WHERE workspace_id = ?').get(wid);
    res.json({ items: rows, average: stats?.avg || 0, count: stats?.count || 0 });
  } catch {
    res.json({ items: [], average: 0, count: 0 });
  }
});

router.post('/ratings', (req, res) => {
  const wid = ratingsWorkspace(req, res); if (!wid) return;
  const score = Number(req.body?.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) return res.status(400).json({ error: 'score 1..5 required' });
  const id = randomUUID();
  const uid = req.user?.id && req.user.id !== 'anon' ? (req.user.sub || req.user.id) : null;
  const name = String(req.body?.userName || req.user?.email || 'anon').trim().slice(0, 120) || 'anon';
  const comment = String(req.body?.comment || '').trim().slice(0, 2000);
  const page = String(req.body?.page || 'platform').trim().slice(0, 120);
  getDb().prepare('INSERT INTO ratings (id, workspace_id, user_id, user_name, score, comment, page) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, wid, uid, name, score, comment, page);
  res.status(201).json({ id, score });
});

export default router;
