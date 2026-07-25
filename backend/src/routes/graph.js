import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired } from '../middleware/auth.js';
import { getDb, wsId, graphId, validateWorkspaceAccess, validateGraphAccess, jparse } from '../utils/helper.js';

const router = Router();

function readScope(req, alias = '') {
  const db = getDb();
  const gid = graphId(req);
  const wid = wsId(req);
  const p = alias ? `${alias}.` : '';

  if (gid) {
    const graph = db.prepare('SELECT id, workspace_id, visibility FROM graphs WHERE id = ?').get(gid);
    if (!graph || !validateGraphAccess(req, gid)) return null;
    return { where: `${p}workspace_id = ? AND ${p}graph_id = ?`, params: [graph.workspace_id, gid], wid: graph.workspace_id, gid };
  }

  if (validateWorkspaceAccess(req, wid)) {
    return { where: `${p}workspace_id = ?`, params: [wid], wid, gid: null };
  }

  // Guests may read only rows explicitly attached to published graphs.
  return {
    where: `${p}graph_id IN (SELECT id FROM graphs WHERE COALESCE(visibility, 'public') = 'public')`,
    params: [],
    wid: 'ws-default',
    gid: null,
    publicOnly: true
  };
}

router.get('/graph/nodes', (req, res) => {
  try {
    const db = getDb();
    const scope = readScope(req, 'n');
    if (!scope) return res.status(403).json({ error: 'Access denied' });
    let sql = `SELECT n.* FROM nodes n WHERE ${scope.where}`;
    const params = [...scope.params];
    if (req.query.tab) { sql += ' AND n.tab = ?'; params.push(req.query.tab); }
    if (req.query.layer) { sql += ' AND n.layer = ?'; params.push(req.query.layer); }
    const rows = db.prepare(sql).all(...params);
    res.json(rows.map(n => ({
      id: n.id, tab: n.tab, label: n.label, kind: n.kind, layer: n.layer,
      nodeKind: n.node_kind, description: n.description, badge: n.badge,
      workspaceId: n.workspace_id, projectId: n.project_id, graphId: n.graph_id,
      data: jparse(n.data_json, {})
    })));
  } catch (e) {
    console.error('GET nodes:', e.message);
    res.status(500).json({ error: 'Failed to fetch nodes' });
  }
});

router.get('/graph/edges', (req, res) => {
  try {
    const db = getDb();
    const scope = readScope(req, 'e');
    if (!scope) return res.status(403).json({ error: 'Access denied' });
    let sql = `SELECT e.* FROM edges e WHERE ${scope.where}`;
    const params = [...scope.params];
    if (req.query.tab) { sql += ' AND e.tab = ?'; params.push(req.query.tab); }
    res.json(db.prepare(sql).all(...params));
  } catch (e) {
    console.error('GET edges:', e.message);
    res.status(500).json({ error: 'Failed to fetch edges' });
  }
});

router.get('/graph/neighbors/:id', (req, res) => {
  try {
    const db = getDb();
    const scope = readScope(req, 'e');
    if (!scope) return res.status(403).json({ error: 'Access denied' });
    const edges = db.prepare(`SELECT e.* FROM edges e WHERE ${scope.where}`).all(...scope.params);
    const related = new Set([req.params.id]);
    for (const e of edges) {
      if (e.source === req.params.id) related.add(e.target);
      if (e.target === req.params.id) related.add(e.source);
    }
    res.json({ nodeId: req.params.id, neighbors: [...related] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch neighbors' });
  }
});

router.get('/actors', (req, res) => {
  try {
    const db = getDb();
    const gid = graphId(req);
    let wid = wsId(req);
    if (gid) {
      const graph = db.prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(gid);
      if (!graph || !validateGraphAccess(req, gid)) return res.json([]);
      wid = graph.workspace_id;
      const rows = db.prepare('SELECT * FROM actors WHERE workspace_id = ? AND graph_id = ? ORDER BY name').all(wid, gid);
      return res.json(rows.map(a => ({ id: a.id, type: a.type, name: a.name, roles: jparse(a.roles_json, []), graphId: a.graph_id })));
    }
    if (!validateWorkspaceAccess(req, wid)) return res.json([]);
    const rows = db.prepare('SELECT * FROM actors WHERE workspace_id = ? ORDER BY name').all(wid);
    res.json(rows.map(a => ({ id: a.id, type: a.type, name: a.name, roles: jparse(a.roles_json, []), graphId: a.graph_id })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch actors' }); }
});

router.get('/interest-scope/:actorId', (req, res) => {
  try {
    const db = getDb();
    const gid = graphId(req);
    let wid = wsId(req);
    if (gid) {
      const graph = db.prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(gid);
      if (!graph || !validateGraphAccess(req, gid)) return res.status(403).json({ error: 'Access denied' });
      wid = graph.workspace_id;
    } else if (!validateWorkspaceAccess(req, wid)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const actor = gid
      ? db.prepare('SELECT * FROM actors WHERE id = ? AND workspace_id = ? AND graph_id = ?').get(req.params.actorId, wid, gid)
      : db.prepare('SELECT * FROM actors WHERE id = ? AND workspace_id = ?').get(req.params.actorId, wid);
    if (!actor) return res.status(404).json({ error: 'not found' });

    let wiSql = 'SELECT * FROM work_items WHERE workspace_id = ?';
    const wiParams = [wid];
    if (gid) { wiSql += ' AND graph_id = ?'; wiParams.push(gid); }
    const wis = db.prepare(wiSql).all(...wiParams).filter(w => jparse(w.actor_ids_json, []).includes(actor.id));
    const nodeIds = new Set();
    wis.forEach(w => jparse(w.related_node_ids_json, []).forEach(id => nodeIds.add(id)));
    let edgeSql = 'SELECT * FROM edges WHERE workspace_id = ?';
    const edgeParams = [wid];
    if (gid) { edgeSql += ' AND graph_id = ?'; edgeParams.push(gid); }
    for (const e of db.prepare(edgeSql).all(...edgeParams)) {
      if (nodeIds.has(e.source)) nodeIds.add(e.target);
      if (nodeIds.has(e.target)) nodeIds.add(e.source);
    }
    res.json({ actorId: actor.id, roles: jparse(actor.roles_json, []), nodeIds: [...nodeIds], workItemIds: wis.map(w => w.id) });
  } catch (e) { res.status(500).json({ error: 'Failed to calculate interest scope' }); }
});

router.get('/work-items', (req, res) => {
  try {
    const db = getDb();
    const gid = graphId(req);
    let wid = wsId(req);
    if (gid) {
      const graph = db.prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(gid);
      if (!graph || !validateGraphAccess(req, gid)) return res.json([]);
      wid = graph.workspace_id;
    } else if (!validateWorkspaceAccess(req, wid)) {
      return res.json([]);
    }

    let sql = 'SELECT * FROM work_items WHERE workspace_id = ?';
    const params = [wid];
    if (gid) { sql += ' AND graph_id = ?'; params.push(gid); }
    let rows = db.prepare(sql).all(...params);
    if (req.query.layer) rows = rows.filter(w => w.layer === req.query.layer);
    res.json(rows.map(w => ({
      id: w.id, type: w.type, title: w.title, status: w.status, layer: w.layer,
      actorIds: jparse(w.actor_ids_json, []), relatedNodeIds: jparse(w.related_node_ids_json, []), graphId: w.graph_id
    })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch work items' }); }
});

router.get('/portfolios', authRequired, (req, res) => {
  const db = getDb(); const wid = wsId(req);
  if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
  res.json(db.prepare('SELECT * FROM portfolios WHERE workspace_id = ? ORDER BY created_at DESC').all(wid));
});

router.post('/portfolios', authRequired, (req, res) => {
  const db = getDb(); const wid = wsId(req);
  if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
  const id = randomUUID(); const name = String(req.body?.name || 'Portfolio').trim();
  db.prepare('INSERT INTO portfolios (id, workspace_id, name) VALUES (?, ?, ?)').run(id, wid, name);
  res.status(201).json({ id, workspaceId: wid, name });
});

export default router;
