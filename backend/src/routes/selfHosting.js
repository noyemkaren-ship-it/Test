import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb, wsId, validateWorkspaceAccess } from '../utils/helper.js';
import { getSelfHostingStatus, syncSelfHosting } from '../services/selfHosting.js';

const router = Router();

router.get('/self-host/status', (_req, res) => {
  const db = getDb();
  const status = getSelfHostingStatus();
  const sources = status.graphId ? db.prepare('SELECT COUNT(*) count FROM self_host_sources WHERE graph_id=?').get(status.graphId)?.count || 0 : 0;
  res.json({ ...status, sources });
});

router.get('/self-host/sources', (req, res) => {
  const status = getSelfHostingStatus();
  if (!status.graphId) return res.json([]);
  res.json(getDb().prepare('SELECT path,kind,content_hash AS contentHash,node_id AS nodeId,last_synced_at AS lastSyncedAt FROM self_host_sources WHERE graph_id=? ORDER BY path').all(status.graphId));
});

router.post('/self-host/sync', authRequired, (req, res) => {
  const wid = wsId(req);
  if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
  res.json(syncSelfHosting(getDb()));
});

export default router;
