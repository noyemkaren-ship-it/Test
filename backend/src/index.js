import './config/env.js';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import {
  getDb, validateSecrets, wsId, graphId,
  validateWorkspaceAccess, validateGraphAccess, jparse, jstr
} from './utils/helper.js';
import { seedIfEmpty } from './db/seed.js';
import { authOptional, authRequired } from './middleware/auth.js';
import { securityHeaders, rateLimit } from './middleware/security.js';
import { listMachines, getAllowedTransitions, transition, clearMachinesCache } from './engines/fsm.js';
import { DEFAULT_PROFILE, loadProfile, extendProfile } from './engines/ontology.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import workspacesRoutes from './routes/workspaces.js';
import graphRoutes from './routes/graph.js';
import copilotRoutes from './routes/copilot.js';
import ragRoutes from './routes/rag.js';
import ratingsRoutes from './routes/ratings.js';
import graphsRoutes from './routes/graphs.js';
import publicRoutes from './routes/public.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

validateSecrets();
const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',').map(v => v.trim()).filter(Boolean);
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(securityHeaders);
app.use(rateLimit());
app.use(authOptional);

const db = getDb();
const seeded = seedIfEmpty();
if (seeded) console.log('SQLite seeded');

app.get('/api/health', (_req, res) => {
  const key = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  const graphs = db.prepare('SELECT COUNT(*) AS c FROM graphs').get()?.c || 0;
  res.json({
    ok: true,
    version: '3.0.0',
    db: 'sqlite',
    graphs,
    llmConfigured: !!key,
    llmMode: key ? 'hybrid-external-first' : 'offline-first',
    engines: ['Graph', 'FSM', 'Ontology', 'RAG', 'Hybrid Offline AI', 'Auth', 'Workspace', 'Templates'],
    publicDomains: true,
    tenantIsolation: 'membership + public-read'
  });
});

// Public-first resources and graph CRUD.
app.use('/api', publicRoutes);
app.use('/api', graphsRoutes);

// FSM. Guest reads require an explicitly selected public graph; members may use workspace scope.
function fsmScope(req) {
  const gid = graphId(req);
  if (gid) {
    const graph = db.prepare('SELECT id, workspace_id FROM graphs WHERE id = ?').get(gid);
    if (!graph || !validateGraphAccess(req, gid)) return null;
    return { wid: graph.workspace_id, gid };
  }
  const wid = wsId(req);
  if (!validateWorkspaceAccess(req, wid)) return null;
  return { wid, gid: null };
}

app.get('/api/fsm/machines', (req, res) => {
  try {
    const scope = fsmScope(req);
    if (!scope) return res.status(403).json({ error: 'Graph or workspace access required' });
    res.json(listMachines(scope.wid, scope.gid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/fsm/:id/transitions', (req, res) => {
  try {
    const scope = fsmScope(req);
    if (!scope) return res.status(403).json({ error: 'Graph or workspace access required' });
    res.json({ type: req.params.id, allowed: getAllowedTransitions(req.params.id, req.query.status || 'open', scope.wid, scope.gid) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fsm/:id/transition', authRequired, (req, res) => {
  try {
    const wid = wsId(req);
    const gid = graphId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    if (gid && !validateGraphAccess(req, gid, { write: true })) return res.status(403).json({ error: 'Graph write access denied' });
    res.json(transition(req.params.id, req.body.from, req.body.event, wid, gid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ontology. Guests can read ontology only for an explicitly public graph.
app.get('/api/ontology', (req, res) => {
  try {
    const wid = wsId(req);
    const gid = graphId(req);
    if (gid) {
      if (!validateGraphAccess(req, gid)) return res.status(403).json({ error: 'Access denied' });
      const row = db.prepare('SELECT * FROM ontology WHERE graph_id = ? LIMIT 1').get(gid);
      return res.json(row ? loadProfile(jparse(row.profile_json, null)) : DEFAULT_PROFILE);
    }
    if (!validateWorkspaceAccess(req, wid)) return res.json(DEFAULT_PROFILE);
    const row = db.prepare('SELECT * FROM ontology WHERE workspace_id = ? LIMIT 1').get(wid);
    res.json(row ? loadProfile(jparse(row.profile_json, null)) : DEFAULT_PROFILE);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ontology/extend', authRequired, (req, res) => {
  try {
    const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    let gid = graphId(req);
    if (!gid) gid = db.prepare('SELECT id FROM graphs WHERE workspace_id = ? LIMIT 1').get(wid)?.id || null;
    if (!gid || !validateGraphAccess(req, gid, { write: true })) return res.status(400).json({ error: 'Valid graph required' });
    const row = db.prepare('SELECT * FROM ontology WHERE workspace_id = ? AND graph_id = ?').get(wid, gid);
    const extended = extendProfile(row ? jparse(row.profile_json, null) : null, req.body);
    db.prepare('INSERT OR REPLACE INTO ontology (workspace_id, graph_id, profile_json) VALUES (?, ?, ?)').run(wid, gid, jstr(extended));
    clearMachinesCache(wid);
    res.json(extended);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reviews are readable for an explicitly selected public graph. Writes require workspace access.
app.get('/api/reviews', (req, res) => {
  try {
    let wid = wsId(req); const gid = graphId(req);
    if (gid) {
      const graph = db.prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(gid);
      if (!graph || !validateGraphAccess(req, gid)) return res.json([]);
      wid = graph.workspace_id;
    } else if (!validateWorkspaceAccess(req, wid)) {
      return res.json([]);
    }
    let sql = 'SELECT * FROM reviews WHERE workspace_id = ?'; const params = [wid];
    if (gid) { sql += ' AND graph_id = ?'; params.push(gid); }
    res.json(db.prepare(`${sql} ORDER BY date DESC`).all(...params) || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reviews', authRequired, (req, res) => {
  try {
    const wid = wsId(req); const gid = graphId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    if (gid) {
      const graph = db.prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(gid);
      if (!graph || graph.workspace_id !== wid || !validateGraphAccess(req, gid, { write: true })) {
        return res.status(403).json({ error: 'Write access denied' });
      }
    }
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    const id = randomUUID();
    db.prepare('INSERT INTO reviews (id, workspace_id, graph_id, author_id, text, status, date) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))')
      .run(id, wid, gid || null, req.user?.sub || req.user?.id, text.slice(0, 4000), 'open');
    res.status(201).json({ id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Role bindings are public only when tied to an explicitly selected published graph.
app.get('/api/role-bindings', (req, res) => {
  try {
    let wid = wsId(req); const gid = graphId(req);
    if (gid) {
      const graph = db.prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(gid);
      if (!graph || !validateGraphAccess(req, gid)) return res.json([]);
      wid = graph.workspace_id;
    } else if (!validateWorkspaceAccess(req, wid)) {
      return res.json([]);
    }
    let sql = 'SELECT * FROM role_bindings WHERE workspace_id = ?'; const params = [wid];
    if (gid) { sql += ' AND graph_id = ?'; params.push(gid); }
    res.json(db.prepare(sql).all(...params) || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/role-bindings', authRequired, (req, res) => {
  try {
    const wid = wsId(req); const gid = graphId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    if (gid) {
      const graph = db.prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(gid);
      if (!graph || graph.workspace_id !== wid || !validateGraphAccess(req, gid, { write: true })) {
        return res.status(403).json({ error: 'Write access denied' });
      }
    }
    const actorId = String(req.body?.actorId || '');
    const objectId = String(req.body?.objectId || req.body?.edgeId || '');
    const role = String(req.body?.role || '').trim().slice(0, 100);
    if (!actorId || !objectId || !role) return res.status(400).json({ error: 'actorId, objectId and role required' });
    const actor = db.prepare('SELECT id, graph_id FROM actors WHERE id = ? AND workspace_id = ?').get(actorId, wid);
    if (!actor) return res.status(400).json({ error: 'Actor not found in workspace' });
    if (gid && actor.graph_id && actor.graph_id !== gid) return res.status(400).json({ error: 'Actor belongs to another graph' });
    const id = randomUUID();
    db.prepare('INSERT INTO role_bindings (id, workspace_id, graph_id, actor_id, object_id, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, wid, gid || actor.graph_id || null, actorId, objectId, role);
    res.status(201).json({ id, ok: true });
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'Role binding already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/role-bindings/:id', authRequired, (req, res) => {
  try {
    const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    const result = db.prepare('DELETE FROM role_bindings WHERE id = ? AND workspace_id = ?').run(req.params.id, wid);
    if (!result.changes) return res.status(404).json({ error: 'Role binding not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use('/api', authRoutes);
app.use('/api', adminRoutes);
app.use('/api', workspacesRoutes);
app.use('/api', graphRoutes);
app.use('/api', copilotRoutes);
app.use('/api', ragRoutes);
app.use('/api', ratingsRoutes);

app.use((err, _req, res, _next) => {
  console.error('Unhandled request error:', err.message);
  res.status(err.message === 'Origin not allowed by CORS' ? 403 : 500).json({ error: 'Request failed' });
});

if (process.env.NODE_ENV !== 'test' || process.env.START_SERVER_IN_TEST === '1') {
  app.listen(PORT, '0.0.0.0', () => console.log(`Graph Platform v3.0 http://localhost:${PORT}`));
}

export default app;
