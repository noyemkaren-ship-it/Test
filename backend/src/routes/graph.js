import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired } from '../middleware/auth.js';
import { getDb, wsId, graphId, validateWorkspaceAccess, validateGraphAccess, jparse, jstr } from '../utils/helper.js';

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

function serializeNode(n) {
  return {
    id: n.id, tab: n.tab, label: n.label, kind: n.kind, layer: n.layer,
    nodeKind: n.node_kind, description: n.description, badge: n.badge,
    workspaceId: n.workspace_id, projectId: n.project_id, graphId: n.graph_id,
    data: jparse(n.data_json, {})
  };
}

function serializeEdge(e) {
  return {
    id: e.id, workspaceId: e.workspace_id, graphId: e.graph_id,
    tab: e.tab, source: e.source, target: e.target, label: e.label || ''
  };
}

function writeScope(req, res) {
  const gid = graphId(req);
  if (!gid) {
    res.status(400).json({ error: 'Select a graph before editing' });
    return null;
  }
  const graph = getDb().prepare('SELECT id, workspace_id FROM graphs WHERE id = ?').get(String(gid));
  if (!graph) {
    res.status(404).json({ error: 'Graph not found' });
    return null;
  }
  if (!validateGraphAccess(req, graph.id, { write: true })) {
    res.status(403).json({ error: 'Graph write access denied' });
    return null;
  }
  return { gid: graph.id, wid: graph.workspace_id };
}

function text(value, fallback = '', max = 500) {
  if (value == null) return fallback;
  return String(value).trim().slice(0, max);
}

function validPosition(position) {
  if (!position || typeof position !== 'object') return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) return null;
  return { x, y };
}

function touchGraph(db, gid) {
  db.prepare("UPDATE graphs SET updated_at = datetime('now') WHERE id = ?").run(gid);
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
    res.json(rows.map(serializeNode));
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
    res.json(db.prepare(sql).all(...params).map(serializeEdge));
  } catch (e) {
    console.error('GET edges:', e.message);
    res.status(500).json({ error: 'Failed to fetch edges' });
  }
});

router.post('/graph/nodes', authRequired, (req, res) => {
  try {
    const db = getDb();
    const scope = writeScope(req, res);
    if (!scope) return;
    const label = text(req.body?.label, '', 200);
    if (!label) return res.status(400).json({ error: 'label required' });

    const projectId = req.body?.projectId ? text(req.body.projectId, '', 200) : null;
    if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, scope.wid)) {
      return res.status(400).json({ error: 'projectId does not belong to this workspace' });
    }
    const suppliedData = req.body?.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data) ? req.body.data : {};
    const position = validPosition(req.body?.position || suppliedData.position);
    const data = { ...suppliedData, ...(position ? { position } : {}) };
    const id = randomUUID();
    db.prepare(`
      INSERT INTO nodes
        (id, workspace_id, project_id, graph_id, tab, label, kind, layer, node_kind, description, badge, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, scope.wid, projectId, scope.gid,
      text(req.body?.tab, 'tobe', 50) || 'tobe', label,
      text(req.body?.kind, 'Concept', 100) || 'Concept',
      text(req.body?.layer, 'Knowledge', 100) || 'Knowledge',
      text(req.body?.nodeKind, 'default', 50) || 'default',
      text(req.body?.description, '', 2000), text(req.body?.badge, '', 50), jstr(data)
    );
    touchGraph(db, scope.gid);
    res.status(201).json(serializeNode(db.prepare('SELECT * FROM nodes WHERE id = ?').get(id)));
  } catch (e) {
    console.error('POST nodes:', e.message);
    res.status(500).json({ error: 'Failed to create node' });
  }
});

router.patch('/graph/nodes/:id', authRequired, (req, res) => {
  try {
    const db = getDb();
    const scope = writeScope(req, res);
    if (!scope) return;
    const current = db.prepare('SELECT * FROM nodes WHERE id = ? AND workspace_id = ? AND graph_id = ?')
      .get(req.params.id, scope.wid, scope.gid);
    if (!current) return res.status(404).json({ error: 'Node not found in selected graph' });

    const label = text(req.body?.label, current.label, 200);
    if (!label) return res.status(400).json({ error: 'label cannot be empty' });
    const projectId = req.body?.projectId === undefined ? current.project_id : (req.body.projectId ? text(req.body.projectId, '', 200) : null);
    if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, scope.wid)) {
      return res.status(400).json({ error: 'projectId does not belong to this workspace' });
    }
    const currentData = jparse(current.data_json, {});
    const suppliedData = req.body?.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data) ? req.body.data : {};
    const requestedPosition = req.body?.position === undefined ? suppliedData.position : req.body.position;
    const position = requestedPosition === undefined ? currentData.position : validPosition(requestedPosition);
    if (requestedPosition !== undefined && !position) return res.status(400).json({ error: 'position must contain finite x and y coordinates' });
    const data = { ...currentData, ...suppliedData, ...(position ? { position } : {}) };

    db.prepare(`
      UPDATE nodes SET project_id = ?, tab = ?, label = ?, kind = ?, layer = ?, node_kind = ?,
        description = ?, badge = ?, data_json = ?
      WHERE id = ? AND workspace_id = ? AND graph_id = ?
    `).run(
      projectId,
      text(req.body?.tab, current.tab, 50), label,
      text(req.body?.kind, current.kind, 100), text(req.body?.layer, current.layer, 100),
      text(req.body?.nodeKind, current.node_kind, 50), text(req.body?.description, current.description, 2000),
      text(req.body?.badge, current.badge, 50), jstr(data), current.id, scope.wid, scope.gid
    );
    touchGraph(db, scope.gid);
    res.json(serializeNode(db.prepare('SELECT * FROM nodes WHERE id = ?').get(current.id)));
  } catch (e) {
    console.error('PATCH node:', e.message);
    res.status(500).json({ error: 'Failed to update node' });
  }
});

router.delete('/graph/nodes/:id', authRequired, (req, res) => {
  try {
    const db = getDb();
    const scope = writeScope(req, res);
    if (!scope) return;
    const current = db.prepare('SELECT id FROM nodes WHERE id = ? AND workspace_id = ? AND graph_id = ?')
      .get(req.params.id, scope.wid, scope.gid);
    if (!current) return res.status(404).json({ error: 'Node not found in selected graph' });
    const remove = db.transaction(() => {
      const removedEdges = db.prepare('DELETE FROM edges WHERE workspace_id = ? AND graph_id = ? AND (source = ? OR target = ?)')
        .run(scope.wid, scope.gid, current.id, current.id).changes;
      db.prepare('DELETE FROM nodes WHERE id = ? AND workspace_id = ? AND graph_id = ?').run(current.id, scope.wid, scope.gid);
      touchGraph(db, scope.gid);
      return removedEdges;
    });
    res.json({ ok: true, id: current.id, deletedEdges: remove() });
  } catch (e) {
    console.error('DELETE node:', e.message);
    res.status(500).json({ error: 'Failed to delete node' });
  }
});

router.post('/graph/edges', authRequired, (req, res) => {
  try {
    const db = getDb();
    const scope = writeScope(req, res);
    if (!scope) return;
    const source = text(req.body?.source, '', 200);
    const target = text(req.body?.target, '', 200);
    if (!source || !target) return res.status(400).json({ error: 'source and target required' });
    if (source === target) return res.status(400).json({ error: 'Self-relations are not supported' });
    const count = db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE workspace_id = ? AND graph_id = ? AND id IN (?, ?)')
      .get(scope.wid, scope.gid, source, target)?.c || 0;
    if (count !== 2) return res.status(400).json({ error: 'Both nodes must belong to the selected graph' });
    const existing = db.prepare('SELECT id FROM edges WHERE workspace_id = ? AND graph_id = ? AND source = ? AND target = ?')
      .get(scope.wid, scope.gid, source, target);
    if (existing) return res.status(409).json({ error: 'Relation already exists', id: existing.id });
    const id = randomUUID();
    db.prepare('INSERT INTO edges (id, workspace_id, graph_id, tab, source, target, label) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, scope.wid, scope.gid, text(req.body?.tab, 'tobe', 50) || 'tobe', source, target, text(req.body?.label, '', 200));
    touchGraph(db, scope.gid);
    res.status(201).json(serializeEdge(db.prepare('SELECT * FROM edges WHERE id = ?').get(id)));
  } catch (e) {
    console.error('POST edge:', e.message);
    res.status(500).json({ error: 'Failed to create relation' });
  }
});

router.patch('/graph/edges/:id', authRequired, (req, res) => {
  try {
    const db = getDb();
    const scope = writeScope(req, res);
    if (!scope) return;
    const current = db.prepare('SELECT * FROM edges WHERE id = ? AND workspace_id = ? AND graph_id = ?')
      .get(req.params.id, scope.wid, scope.gid);
    if (!current) return res.status(404).json({ error: 'Relation not found in selected graph' });
    const source = text(req.body?.source, current.source, 200);
    const target = text(req.body?.target, current.target, 200);
    if (source === target) return res.status(400).json({ error: 'Self-relations are not supported' });
    const count = db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE workspace_id = ? AND graph_id = ? AND id IN (?, ?)')
      .get(scope.wid, scope.gid, source, target)?.c || 0;
    if (count !== 2) return res.status(400).json({ error: 'Both nodes must belong to the selected graph' });
    const duplicate = db.prepare('SELECT id FROM edges WHERE workspace_id = ? AND graph_id = ? AND source = ? AND target = ? AND id <> ?')
      .get(scope.wid, scope.gid, source, target, current.id);
    if (duplicate) return res.status(409).json({ error: 'Relation already exists', id: duplicate.id });
    db.prepare('UPDATE edges SET tab = ?, source = ?, target = ?, label = ? WHERE id = ? AND workspace_id = ? AND graph_id = ?')
      .run(text(req.body?.tab, current.tab, 50), source, target, text(req.body?.label, current.label, 200), current.id, scope.wid, scope.gid);
    touchGraph(db, scope.gid);
    res.json(serializeEdge(db.prepare('SELECT * FROM edges WHERE id = ?').get(current.id)));
  } catch (e) {
    console.error('PATCH edge:', e.message);
    res.status(500).json({ error: 'Failed to update relation' });
  }
});

router.delete('/graph/edges/:id', authRequired, (req, res) => {
  try {
    const db = getDb();
    const scope = writeScope(req, res);
    if (!scope) return;
    const result = db.prepare('DELETE FROM edges WHERE id = ? AND workspace_id = ? AND graph_id = ?')
      .run(req.params.id, scope.wid, scope.gid);
    if (!result.changes) return res.status(404).json({ error: 'Relation not found in selected graph' });
    touchGraph(db, scope.gid);
    res.json({ ok: true, id: req.params.id });
  } catch (e) {
    console.error('DELETE edge:', e.message);
    res.status(500).json({ error: 'Failed to delete relation' });
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
