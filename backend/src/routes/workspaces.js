import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired } from '../middleware/auth.js';
import { getDb, jstr, jparse, wsId, validateWorkspaceAccess } from '../utils/helper.js';
import { DEFAULT_PROFILE } from '../engines/ontology.js';

const router = Router();

function requireWorkspace(req, res, target = wsId(req)) {
  if (!validateWorkspaceAccess(req, target)) {
    res.status(403).json({ error: 'Access denied' });
    return false;
  }
  return true;
}

router.get('/workspaces', (req, res) => {
  if (!req.user?.id || req.user.id === 'anon' || req.user.id === 'api') return res.json([]);
  const rows = getDb().prepare(`
    SELECT w.*, m.role AS membership_role
    FROM workspaces w
    JOIN memberships m ON m.workspace_id = w.id
    WHERE m.user_id = ?
    ORDER BY w.created_at DESC
  `).all(req.user.sub || req.user.id);
  res.json(rows);
});

router.post('/workspaces', authRequired, (req, res) => {
  const db = getDb();
  const id = randomUUID();
  const name = String(req.body?.name || 'New Workspace').trim().slice(0, 160);
  const type = String(req.body?.type || 'studio').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'name required' });

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO workspaces (id, name, type) VALUES (?, ?, ?)').run(id, name, type);
    const uid = req.user.sub || req.user.id;
    if (uid && uid !== 'api') {
      db.prepare('INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)').run(uid, id, 'admin');
    }
    db.prepare('INSERT OR REPLACE INTO ontology (workspace_id, graph_id, profile_json) VALUES (?, NULL, ?)')
      .run(id, jstr(DEFAULT_PROFILE));
  });
  tx();
  res.status(201).json({ id, name, type });
});

router.get('/workspaces/:wsId/actors', authRequired, (req, res) => {
  const db = getDb();
  const wid = req.params.wsId;
  if (!requireWorkspace(req, res, wid)) return;

  const unassignedTo = String(req.query.unassigned_to || '');
  let actors = db.prepare('SELECT * FROM actors WHERE workspace_id = ? ORDER BY name').all(wid)
    .map(a => ({ id: a.id, type: a.type, name: a.name, roles: jparse(a.roles_json, []), graphId: a.graph_id }));

  if (unassignedTo) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(unassignedTo, wid);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const graphIds = new Set(db.prepare(`
      SELECT DISTINCT graph_id FROM nodes
      WHERE workspace_id = ? AND project_id = ? AND graph_id IS NOT NULL
    `).all(wid, unassignedTo).map(r => r.graph_id));
    const bound = new Set(db.prepare(
      'SELECT actor_id FROM role_bindings WHERE workspace_id = ? AND object_id = ?'
    ).all(wid, unassignedTo).map(r => r.actor_id));

    actors = actors.filter(a => {
      const graphMatch = graphIds.size === 0 || !a.graphId || graphIds.has(a.graphId);
      return graphMatch && !bound.has(a.id);
    });
  }
  res.json(actors);
});

router.get('/projects', authRequired, (req, res) => {
  const wid = wsId(req);
  if (!requireWorkspace(req, res, wid)) return;
  res.json(getDb().prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at DESC').all(wid));
});

router.get('/projects/:projectId/actors', authRequired, (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!requireWorkspace(req, res, project.workspace_id)) return;
  const rows = db.prepare(`
    SELECT rb.id AS binding_id, rb.role, a.id AS actor_id, a.name, a.type, a.roles_json
    FROM role_bindings rb
    JOIN actors a ON a.id = rb.actor_id AND a.workspace_id = rb.workspace_id
    WHERE rb.workspace_id = ? AND rb.object_id = ?
    ORDER BY a.name
  `).all(project.workspace_id, project.id);
  res.json(rows.map(r => ({
    bindingId: r.binding_id,
    actorId: r.actor_id,
    name: r.name,
    type: r.type,
    role: r.role,
    roles: jparse(r.roles_json, [])
  })));
});

router.get('/workspaces/:wsId/templates', authRequired, (req, res) => {
  const wid = req.params.wsId;
  if (!requireWorkspace(req, res, wid)) return;
  const rows = getDb().prepare(`
    SELECT id, workspace_id, graph_id, name, description, source_project_id, version, created_at, updated_at
    FROM templates WHERE workspace_id = ? ORDER BY updated_at DESC
  `).all(wid);
  res.json(rows);
});

router.get('/templates/:id', authRequired, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Template not found' });
  if (!requireWorkspace(req, res, row.workspace_id)) return;
  res.json({
    id: row.id,
    workspaceId: row.workspace_id,
    graphId: row.graph_id,
    name: row.name,
    description: row.description || '',
    sourceProjectId: row.source_project_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    snapshot: jparse(row.snapshot_json, {})
  });
});

router.post('/workspaces/:wsId/templates', authRequired, (req, res) => {
  const db = getDb();
  const wid = req.params.wsId;
  if (!requireWorkspace(req, res, wid)) return;

  const name = String(req.body?.name || '').trim().slice(0, 160);
  const description = String(req.body?.description || '').trim().slice(0, 1200);
  const sourceProjectId = req.body?.sourceProjectId ? String(req.body.sourceProjectId) : null;
  if (!name) return res.status(400).json({ error: 'name required' });

  if (sourceProjectId) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(sourceProjectId, wid);
    if (!project) return res.status(400).json({ error: 'Invalid sourceProjectId' });
  }

  const projectClause = sourceProjectId ? ' AND project_id = ?' : '';
  const args = sourceProjectId ? [wid, sourceProjectId] : [wid];
  const nodes = db.prepare(`SELECT * FROM nodes WHERE workspace_id = ?${projectClause}`).all(...args);
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = db.prepare('SELECT * FROM edges WHERE workspace_id = ?').all(wid)
    .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  const workItems = db.prepare(`SELECT * FROM work_items WHERE workspace_id = ?${projectClause}`).all(...args);
  const sourceGraphId = nodes.find(n => n.graph_id)?.graph_id || null;
  const ont = sourceGraphId
    ? db.prepare('SELECT profile_json FROM ontology WHERE workspace_id = ? AND graph_id = ?').get(wid, sourceGraphId)
    : db.prepare('SELECT profile_json FROM ontology WHERE workspace_id = ? LIMIT 1').get(wid);

  const snapshot = {
    format: 'graph-platform-template',
    version: 1,
    graphId: sourceGraphId,
    nodes: nodes.map(n => ({
      id: n.id, tab: n.tab, label: n.label, kind: n.kind, layer: n.layer,
      nodeKind: n.node_kind, description: n.description, badge: n.badge,
      graphId: n.graph_id, data: jparse(n.data_json, {})
    })),
    edges: edges.map(e => ({ id: e.id, tab: e.tab, source: e.source, target: e.target, label: e.label, graphId: e.graph_id })),
    workItems: workItems.map(w => ({
      id: w.id, type: w.type, title: w.title, status: w.status, layer: w.layer,
      actorIds: jparse(w.actor_ids_json, []), relatedNodeIds: jparse(w.related_node_ids_json, []), graphId: w.graph_id
    })),
    ontology: ont ? jparse(ont.profile_json, DEFAULT_PROFILE) : DEFAULT_PROFILE,
    frozenAt: new Date().toISOString()
  };

  const id = randomUUID();
  db.prepare(`
    INSERT INTO templates (id, workspace_id, graph_id, name, description, source_project_id, snapshot_json, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, wid, sourceGraphId, name, description, sourceProjectId, jstr(snapshot));
  res.status(201).json({ id, name, version: 1, nodes: snapshot.nodes.length, edges: snapshot.edges.length });
});

router.delete('/templates/:id', authRequired, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT workspace_id FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Template not found' });
  if (!requireWorkspace(req, res, row.workspace_id)) return;
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/projects', authRequired, (req, res) => {
  const db = getDb();
  const wid = wsId(req);
  if (!requireWorkspace(req, res, wid)) return;
  const name = String(req.body?.name || '').trim().slice(0, 160);
  const templateId = req.body?.templateId ? String(req.body.templateId) : null;
  const portfolioId = req.body?.portfolioId ? String(req.body.portfolioId) : null;
  if (!name) return res.status(400).json({ error: 'name required' });

  const projectId = randomUUID();
  let templateVersion = null;
  let nodesCreated = 0;
  let edgesCreated = 0;
  let workItemsCreated = 0;

  const tx = db.transaction(() => {
    let template = null;
    let snapshot = null;
    if (templateId) {
      template = db.prepare('SELECT * FROM templates WHERE id = ? AND workspace_id = ?').get(templateId, wid);
      if (!template) throw new Error('Template not found');
      snapshot = jparse(template.snapshot_json, {});
      templateVersion = template.version || 1;
    }

    if (portfolioId) {
      const portfolio = db.prepare('SELECT id FROM portfolios WHERE id = ? AND workspace_id = ?').get(portfolioId, wid);
      if (!portfolio) throw new Error('Portfolio not found');
    }

    db.prepare(`INSERT INTO projects (id, workspace_id, portfolio_id, name, template_id, template_version)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(projectId, wid, portfolioId, name, templateId, templateVersion);

    if (!snapshot) return;
    const nodeMap = new Map();
    const nodeInsert = db.prepare(`
      INSERT INTO nodes (id, workspace_id, project_id, graph_id, tab, label, kind, layer, node_kind, description, badge, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const node of Array.isArray(snapshot.nodes) ? snapshot.nodes : []) {
      const newId = randomUUID();
      nodeMap.set(node.id, newId);
      nodeInsert.run(
        newId, wid, projectId, node.graphId || template.graph_id || snapshot.graphId || null,
        node.tab || 'tobe', String(node.label || 'Untitled'), node.kind || '', node.layer || 'Knowledge',
        node.nodeKind || 'domain', node.description || '', node.badge || null, jstr(node.data || {})
      );
      nodesCreated++;
    }

    const edgeInsert = db.prepare('INSERT INTO edges (id, workspace_id, graph_id, tab, source, target, label) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const edge of Array.isArray(snapshot.edges) ? snapshot.edges : []) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;
      edgeInsert.run(randomUUID(), wid, edge.graphId || template.graph_id || snapshot.graphId || null, edge.tab || 'tobe', source, target, edge.label || '');
      edgesCreated++;
    }

    const wiInsert = db.prepare(`
      INSERT INTO work_items (id, workspace_id, project_id, graph_id, type, title, status, layer, actor_ids_json, related_node_ids_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    for (const item of Array.isArray(snapshot.workItems) ? snapshot.workItems : []) {
      const related = (item.relatedNodeIds || []).map(id => nodeMap.get(id)).filter(Boolean);
      wiInsert.run(
        randomUUID(), wid, projectId, item.graphId || template.graph_id || snapshot.graphId || null,
        item.type || 'Task', item.title || 'Task', item.status || 'open', item.layer || 'Project',
        jstr(item.actorIds || []), jstr(related)
      );
      workItemsCreated++;
    }
  });

  try {
    tx();
    res.status(201).json({ id: projectId, name, templateVersion, nodesCreated, edgesCreated, workItemsCreated });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to create project' });
  }
});

export default router;
