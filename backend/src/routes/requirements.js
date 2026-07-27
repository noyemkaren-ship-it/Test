import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired } from '../middleware/auth.js';
import {
  getDb, wsId, graphId, validateWorkspaceAccess, validateGraphAccess, jparse, jstr
} from '../utils/helper.js';
import { getAllowedTransitions, transition } from '../engines/fsm.js';

const router = Router();
const ACTOR_TYPES = new Set(['Human', 'AIAgent', 'Service', 'ExternalSystem']);
const ISSUE_TYPES = new Set(['Problem', 'Risk', 'Constraint', 'KnowledgeDefect']);
const PERSPECTIVES = new Set(['form', 'indicator', 'sql', 'test', 'document', 'architecture', 'component']);

function str(value, fallback = '', max = 1000) {
  return value == null ? fallback : String(value).trim().slice(0, max);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function resolveScope(req, res, { write = false, graphRequired = false } = {}) {
  const db = getDb();
  const wid = wsId(req);
  const gid = graphId(req);
  if (write && !validateWorkspaceAccess(req, wid)) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  if (gid) {
    const graph = db.prepare('SELECT id, workspace_id, project_id, visibility FROM graphs WHERE id = ?').get(String(gid));
    if (!graph || graph.workspace_id !== wid || !validateGraphAccess(req, graph.id, { write })) {
      res.status(403).json({ error: 'Graph access denied' });
      return null;
    }
    return { db, wid, gid: graph.id, projectId: graph.project_id || null };
  }
  if (graphRequired) {
    res.status(400).json({ error: 'Select a graph first' });
    return null;
  }
  if (!validateWorkspaceAccess(req, wid)) {
    res.status(403).json({ error: 'Workspace access denied' });
    return null;
  }
  return { db, wid, gid: null, projectId: null };
}

function scopedRows(scope, table, order = 'rowid DESC') {
  let sql = `SELECT * FROM ${table} WHERE workspace_id = ?`;
  const params = [scope.wid];
  if (scope.gid) { sql += ' AND graph_id = ?'; params.push(scope.gid); }
  return scope.db.prepare(`${sql} ORDER BY ${order}`).all(...params);
}

function verifyProject(scope, projectId) {
  if (!projectId) return null;
  return scope.db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(String(projectId), scope.wid)?.id || null;
}

function serializeWorkItem(row) {
  return {
    id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, graphId: row.graph_id,
    issueId: row.issue_id, changeId: row.change_id, pipeId: row.pipe_id, releaseId: row.release_id,
    type: row.type, title: row.title, status: row.status, layer: row.layer,
    actorIds: jparse(row.actor_ids_json, []), relatedNodeIds: jparse(row.related_node_ids_json, []),
    estimatedHours: row.estimated_hours || 0,
    requiredSpecialists: jparse(row.required_specialists_json, []), budget: row.budget || 0,
    deadline: row.deadline, criticalPath: !!row.critical_path, riskLevel: row.risk_level || 'medium',
    updatedAt: row.updated_at
  };
}

function serializeChange(row, db) {
  return {
    id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, graphId: row.graph_id,
    title: row.title, description: row.description || '', executorActorId: row.executor_actor_id,
    deadline: row.deadline, status: row.status, riskLevel: row.risk_level,
    estimatedHours: row.estimated_hours || 0, budget: row.budget || 0,
    metrics: jparse(row.metrics_json, {}),
    artifacts: db.prepare('SELECT node_id AS nodeId, perspective FROM change_artifacts WHERE change_id = ? ORDER BY perspective, node_id').all(row.id),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

// Ontology types are materialized as queryable first-class entities.
router.get('/node-types', (req, res) => {
  const scope = resolveScope(req, res, { graphRequired: true });
  if (!scope) return;
  res.json(scope.db.prepare('SELECT id, label, layer, config_json, created_at FROM node_types WHERE workspace_id = ? AND graph_id = ? ORDER BY label').all(scope.wid, scope.gid)
    .map(row => ({ ...row, config: jparse(row.config_json, {}) })));
});

router.post('/node-types', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true, graphRequired: true });
  if (!scope) return;
  const id = str(req.body?.id || randomUUID(), '', 100);
  const label = str(req.body?.label, '', 160);
  if (!id || !label) return res.status(400).json({ error: 'id and label required' });
  scope.db.prepare(`INSERT INTO node_types (id, workspace_id, graph_id, label, layer, config_json)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(graph_id, id) DO UPDATE SET label=excluded.label, layer=excluded.layer, config_json=excluded.config_json`)
    .run(id, scope.wid, scope.gid, label, str(req.body?.layer, 'Knowledge', 80), jstr(req.body?.config || {}));
  res.status(201).json({ id, label, graphId: scope.gid });
});

router.get('/edge-types', (req, res) => {
  const scope = resolveScope(req, res, { graphRequired: true });
  if (!scope) return;
  res.json(scope.db.prepare('SELECT id, label, config_json, created_at FROM edge_types WHERE workspace_id = ? AND graph_id = ? ORDER BY label').all(scope.wid, scope.gid)
    .map(row => ({ ...row, config: jparse(row.config_json, {}) })));
});

router.post('/edge-types', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true, graphRequired: true });
  if (!scope) return;
  const id = str(req.body?.id || randomUUID(), '', 100);
  const label = str(req.body?.label, '', 160);
  if (!id || !label) return res.status(400).json({ error: 'id and label required' });
  scope.db.prepare(`INSERT INTO edge_types (id, workspace_id, graph_id, label, config_json)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(graph_id, id) DO UPDATE SET label=excluded.label, config_json=excluded.config_json`)
    .run(id, scope.wid, scope.gid, label, jstr(req.body?.config || {}));
  res.status(201).json({ id, label, graphId: scope.gid });
});

router.post('/actors', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true, graphRequired: true });
  if (!scope) return;
  const type = str(req.body?.type, 'Human', 40);
  const name = str(req.body?.name, '', 160);
  if (!ACTOR_TYPES.has(type)) return res.status(400).json({ error: 'type must be Human, AIAgent, Service or ExternalSystem' });
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = randomUUID();
  scope.db.prepare('INSERT INTO actors (id, workspace_id, graph_id, type, name, roles_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, scope.wid, scope.gid, type, name, jstr(req.body?.roles || []));
  res.status(201).json({ id, graphId: scope.gid, type, name, roles: req.body?.roles || [] });
});

router.patch('/actors/:id', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true, graphRequired: true });
  if (!scope) return;
  const row = scope.db.prepare('SELECT * FROM actors WHERE id = ? AND workspace_id = ? AND graph_id = ?').get(req.params.id, scope.wid, scope.gid);
  if (!row) return res.status(404).json({ error: 'Actor not found' });
  const type = str(req.body?.type, row.type, 40);
  if (!ACTOR_TYPES.has(type)) return res.status(400).json({ error: 'Invalid actor type' });
  scope.db.prepare('UPDATE actors SET type=?, name=?, roles_json=? WHERE id=?')
    .run(type, str(req.body?.name, row.name, 160), jstr(req.body?.roles ?? jparse(row.roles_json, [])), row.id);
  res.json({ id: row.id, ok: true });
});

router.delete('/actors/:id', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true, graphRequired: true });
  if (!scope) return;
  const result = scope.db.prepare('DELETE FROM actors WHERE id=? AND workspace_id=? AND graph_id=?').run(req.params.id, scope.wid, scope.gid);
  if (!result.changes) return res.status(404).json({ error: 'Actor not found' });
  res.json({ ok: true });
});

router.get('/issues', (req, res) => {
  const scope = resolveScope(req, res);
  if (!scope) return;
  res.json(scopedRows(scope, 'issues', 'updated_at DESC').map(row => ({
    id: row.id, projectId: row.project_id, graphId: row.graph_id, type: row.type, title: row.title,
    description: row.description || '', status: row.status, severity: row.severity,
    ownerActorId: row.owner_actor_id, createdAt: row.created_at, updatedAt: row.updated_at
  })));
});

router.post('/issues', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true, graphRequired: true });
  if (!scope) return;
  const type = str(req.body?.type, 'Problem', 40);
  const title = str(req.body?.title, '', 240);
  if (!ISSUE_TYPES.has(type)) return res.status(400).json({ error: 'Invalid issue type' });
  if (!title) return res.status(400).json({ error: 'title required' });
  const projectId = verifyProject(scope, req.body?.projectId || scope.projectId);
  const id = randomUUID();
  scope.db.prepare(`INSERT INTO issues
    (id,workspace_id,project_id,graph_id,type,title,description,status,severity,owner_actor_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id, scope.wid, projectId, scope.gid, type, title, str(req.body?.description, '', 4000),
      str(req.body?.status, 'open', 40), str(req.body?.severity, 'medium', 40), req.body?.ownerActorId || null
    );
  res.status(201).json(scope.db.prepare('SELECT * FROM issues WHERE id=?').get(id));
});

router.patch('/issues/:id', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true });
  if (!scope) return;
  const row = scope.db.prepare('SELECT * FROM issues WHERE id=? AND workspace_id=?').get(req.params.id, scope.wid);
  if (!row || (scope.gid && row.graph_id !== scope.gid)) return res.status(404).json({ error: 'Issue not found' });
  const type = str(req.body?.type, row.type, 40);
  if (!ISSUE_TYPES.has(type)) return res.status(400).json({ error: 'Invalid issue type' });
  scope.db.prepare(`UPDATE issues SET type=?,title=?,description=?,status=?,severity=?,owner_actor_id=?,updated_at=datetime('now') WHERE id=?`)
    .run(type, str(req.body?.title, row.title, 240), str(req.body?.description, row.description, 4000), str(req.body?.status, row.status, 40), str(req.body?.severity, row.severity, 40), req.body?.ownerActorId === undefined ? row.owner_actor_id : req.body.ownerActorId, row.id);
  res.json(scope.db.prepare('SELECT * FROM issues WHERE id=?').get(row.id));
});

router.delete('/issues/:id', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true });
  if (!scope) return;
  const result = scope.db.prepare('DELETE FROM issues WHERE id=? AND workspace_id=?').run(req.params.id, scope.wid);
  if (!result.changes) return res.status(404).json({ error: 'Issue not found' });
  res.json({ ok: true });
});

router.get('/changes', (req, res) => {
  const scope = resolveScope(req, res);
  if (!scope) return;
  res.json(scopedRows(scope, 'changes', 'updated_at DESC').map(row => serializeChange(row, scope.db)));
});

router.post('/changes', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true, graphRequired: true });
  if (!scope) return;
  const title = str(req.body?.title, '', 240);
  if (!title) return res.status(400).json({ error: 'title required' });
  const artifacts = Array.isArray(req.body?.artifacts) ? req.body.artifacts : [];
  if (artifacts.some(a => !a?.nodeId || !PERSPECTIVES.has(a.perspective))) return res.status(400).json({ error: 'Invalid change artifact' });
  const validNodes = new Set(scope.db.prepare('SELECT id FROM nodes WHERE workspace_id=? AND graph_id=?').all(scope.wid, scope.gid).map(row => row.id));
  if (artifacts.some(a => !validNodes.has(String(a.nodeId)))) return res.status(400).json({ error: 'Artifact node belongs to another graph' });
  const id = randomUUID();
  scope.db.transaction(() => {
    scope.db.prepare(`INSERT INTO changes
      (id,workspace_id,project_id,graph_id,title,description,executor_actor_id,deadline,status,risk_level,estimated_hours,budget,metrics_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, scope.wid, verifyProject(scope, req.body?.projectId || scope.projectId), scope.gid, title,
        str(req.body?.description, '', 4000), req.body?.executorActorId || null, req.body?.deadline || null,
        str(req.body?.status, 'proposed', 40), str(req.body?.riskLevel, 'medium', 40),
        num(req.body?.estimatedHours), num(req.body?.budget), jstr(req.body?.metrics || {})
      );
    const insert = scope.db.prepare('INSERT INTO change_artifacts (change_id,node_id,perspective) VALUES (?,?,?)');
    for (const artifact of artifacts) insert.run(id, String(artifact.nodeId), artifact.perspective);
  })();
  res.status(201).json(serializeChange(scope.db.prepare('SELECT * FROM changes WHERE id=?').get(id), scope.db));
});

router.patch('/changes/:id', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true });
  if (!scope) return;
  const row = scope.db.prepare('SELECT * FROM changes WHERE id=? AND workspace_id=?').get(req.params.id, scope.wid);
  if (!row || (scope.gid && row.graph_id !== scope.gid)) return res.status(404).json({ error: 'Change not found' });
  scope.db.prepare(`UPDATE changes SET title=?,description=?,executor_actor_id=?,deadline=?,status=?,risk_level=?,estimated_hours=?,budget=?,metrics_json=?,updated_at=datetime('now') WHERE id=?`)
    .run(str(req.body?.title, row.title, 240), str(req.body?.description, row.description, 4000), req.body?.executorActorId === undefined ? row.executor_actor_id : req.body.executorActorId, req.body?.deadline === undefined ? row.deadline : req.body.deadline, str(req.body?.status, row.status, 40), str(req.body?.riskLevel, row.risk_level, 40), num(req.body?.estimatedHours, row.estimated_hours), num(req.body?.budget, row.budget), jstr(req.body?.metrics ?? jparse(row.metrics_json, {})), row.id);
  res.json(serializeChange(scope.db.prepare('SELECT * FROM changes WHERE id=?').get(row.id), scope.db));
});

router.delete('/changes/:id', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true });
  if (!scope) return;
  const result = scope.db.prepare('DELETE FROM changes WHERE id=? AND workspace_id=?').run(req.params.id, scope.wid);
  if (!result.changes) return res.status(404).json({ error: 'Change not found' });
  res.json({ ok: true });
});

router.post('/work-items', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true, graphRequired: true });
  if (!scope) return;
  const title = str(req.body?.title, '', 240);
  if (!title) return res.status(400).json({ error: 'title required' });
  const issueId = req.body?.issueId || null;
  if (issueId && !scope.db.prepare('SELECT 1 FROM issues WHERE id=? AND workspace_id=? AND graph_id=?').get(issueId, scope.wid, scope.gid)) return res.status(400).json({ error: 'Invalid issueId' });
  const id = randomUUID();
  scope.db.prepare(`INSERT INTO work_items
    (id,workspace_id,project_id,graph_id,issue_id,change_id,pipe_id,release_id,type,title,status,layer,actor_ids_json,related_node_ids_json,estimated_hours,required_specialists_json,budget,deadline,critical_path,risk_level,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      id, scope.wid, verifyProject(scope, req.body?.projectId || scope.projectId), scope.gid, issueId,
      req.body?.changeId || null, req.body?.pipeId || null, req.body?.releaseId || null,
      str(req.body?.type, 'Task', 80), title, str(req.body?.status, 'open', 60), str(req.body?.layer, 'Project', 80),
      jstr(req.body?.actorIds || []), jstr(req.body?.relatedNodeIds || []), num(req.body?.estimatedHours),
      jstr(req.body?.requiredSpecialists || []), num(req.body?.budget), req.body?.deadline || null,
      req.body?.criticalPath ? 1 : 0, str(req.body?.riskLevel, 'medium', 40)
    );
  res.status(201).json(serializeWorkItem(scope.db.prepare('SELECT * FROM work_items WHERE id=?').get(id)));
});

router.patch('/work-items/:id', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true });
  if (!scope) return;
  const row = scope.db.prepare('SELECT * FROM work_items WHERE id=? AND workspace_id=?').get(req.params.id, scope.wid);
  if (!row || (scope.gid && row.graph_id !== scope.gid)) return res.status(404).json({ error: 'Work item not found' });
  scope.db.prepare(`UPDATE work_items SET issue_id=?,change_id=?,pipe_id=?,release_id=?,type=?,title=?,status=?,layer=?,actor_ids_json=?,related_node_ids_json=?,estimated_hours=?,required_specialists_json=?,budget=?,deadline=?,critical_path=?,risk_level=?,updated_at=datetime('now') WHERE id=?`).run(
    req.body?.issueId === undefined ? row.issue_id : req.body.issueId, req.body?.changeId === undefined ? row.change_id : req.body.changeId,
    req.body?.pipeId === undefined ? row.pipe_id : req.body.pipeId, req.body?.releaseId === undefined ? row.release_id : req.body.releaseId,
    str(req.body?.type, row.type, 80), str(req.body?.title, row.title, 240), str(req.body?.status, row.status, 60), str(req.body?.layer, row.layer, 80),
    jstr(req.body?.actorIds ?? jparse(row.actor_ids_json, [])), jstr(req.body?.relatedNodeIds ?? jparse(row.related_node_ids_json, [])),
    num(req.body?.estimatedHours, row.estimated_hours), jstr(req.body?.requiredSpecialists ?? jparse(row.required_specialists_json, [])),
    num(req.body?.budget, row.budget), req.body?.deadline === undefined ? row.deadline : req.body.deadline,
    req.body?.criticalPath === undefined ? row.critical_path : (req.body.criticalPath ? 1 : 0), str(req.body?.riskLevel, row.risk_level, 40), row.id
  );
  res.json(serializeWorkItem(scope.db.prepare('SELECT * FROM work_items WHERE id=?').get(row.id)));
});

router.get('/work-items/:id/transitions', (req, res) => {
  const scope = resolveScope(req, res);
  if (!scope) return;
  const row = scope.db.prepare('SELECT id,type,status,graph_id FROM work_items WHERE id=? AND workspace_id=?').get(req.params.id, scope.wid);
  if (!row || (scope.gid && row.graph_id !== scope.gid)) return res.status(404).json({ error: 'Work item not found' });
  res.json({ id: row.id, type: row.type, status: row.status, allowed: getAllowedTransitions(row.type, row.status, scope.wid, row.graph_id) });
});

router.post('/work-items/:id/transition', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true });
  if (!scope) return;
  const row = scope.db.prepare('SELECT * FROM work_items WHERE id=? AND workspace_id=?').get(req.params.id, scope.wid);
  if (!row || (scope.gid && row.graph_id !== scope.gid)) return res.status(404).json({ error: 'Work item not found' });
  const result = transition(row.type, row.status, String(req.body?.event || '').toUpperCase(), scope.wid, row.graph_id);
  if (!result.ok) return res.status(409).json(result);
  scope.db.prepare("UPDATE work_items SET status=?,updated_at=datetime('now') WHERE id=?").run(result.to, row.id);
  res.json({ ...result, id: row.id, type: row.type });
});

router.delete('/work-items/:id', authRequired, (req, res) => {
  const scope = resolveScope(req, res, { write: true });
  if (!scope) return;
  const result = scope.db.prepare('DELETE FROM work_items WHERE id=? AND workspace_id=?').run(req.params.id, scope.wid);
  if (!result.changes) return res.status(404).json({ error: 'Work item not found' });
  res.json({ ok: true });
});

const EXECUTION = {
  programs: {
    order: 'updated_at DESC',
    create(scope, body) {
      const id = randomUUID();
      if (body?.portfolioId && !scope.db.prepare('SELECT 1 FROM portfolios WHERE id=? AND workspace_id=?').get(body.portfolioId, scope.wid)) {
        throw new Error('Portfolio not found in workspace');
      }
      scope.db.prepare('INSERT INTO programs (id,workspace_id,portfolio_id,name,description,status) VALUES (?,?,?,?,?,?)')
        .run(id, scope.wid, body?.portfolioId || null, str(body?.name, 'Program', 180), str(body?.description, '', 2000), str(body?.status, 'active', 40));
      return id;
    }
  },
  sprints: {
    order: 'start DESC',
    create(scope, body) {
      const id = randomUUID();
      scope.db.prepare('INSERT INTO sprints (id,workspace_id,project_id,graph_id,name,status,start,end,work_item_ids_json) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, scope.wid, verifyProject(scope, body?.projectId || scope.projectId), scope.gid, str(body?.name, 'Sprint', 180), str(body?.status, 'planned', 40), body?.start || null, body?.end || null, '[]');
      return id;
    }
  },
  pipes: {
    order: 'rowid DESC',
    create(scope, body) {
      const id = randomUUID();
      scope.db.prepare('INSERT INTO pipes (id,workspace_id,project_id,graph_id,name,stages_json,work_item_ids_json) VALUES (?,?,?,?,?,?,?)')
        .run(id, scope.wid, verifyProject(scope, body?.projectId || scope.projectId), scope.gid, str(body?.name, 'Pipe', 180), jstr(body?.stages || []), '[]');
      return id;
    }
  },
  releases: {
    order: 'target_date DESC',
    create(scope, body) {
      const id = randomUUID();
      scope.db.prepare('INSERT INTO releases (id,workspace_id,project_id,graph_id,name,status,target_date) VALUES (?,?,?,?,?,?,?)')
        .run(id, scope.wid, verifyProject(scope, body?.projectId || scope.projectId), scope.gid, str(body?.name, 'Release', 180), str(body?.status, 'planned', 40), body?.targetDate || null);
      return id;
    }
  }
};

for (const [name, config] of Object.entries(EXECUTION)) {
  router.get(`/${name}`, (req, res) => {
    const scope = resolveScope(req, res);
    if (!scope) return;
    const listScope = name === 'programs' ? { ...scope, gid: null } : scope;
    res.json(scopedRows(listScope, name, config.order).map(row => ({
      ...row,
      stages: row.stages_json == null ? undefined : jparse(row.stages_json, []),
      workItemIds: row.work_item_ids_json == null ? undefined : jparse(row.work_item_ids_json, [])
    })));
  });
  router.post(`/${name}`, authRequired, (req, res) => {
    const scope = resolveScope(req, res, { write: true, graphRequired: name !== 'programs' });
    if (!scope) return;
    try {
      const id = config.create(scope, req.body);
      res.status(201).json(scope.db.prepare(`SELECT * FROM ${name} WHERE id=?`).get(id));
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.patch(`/${name}/:id`, authRequired, (req, res) => {
    const scope = resolveScope(req, res, { write: true });
    if (!scope) return;
    const row = scope.db.prepare(`SELECT * FROM ${name} WHERE id=? AND workspace_id=?`).get(req.params.id, scope.wid);
    if (!row || (name !== 'programs' && scope.gid && row.graph_id !== scope.gid)) return res.status(404).json({ error: `${name} object not found` });
    if (name === 'programs') {
      scope.db.prepare("UPDATE programs SET name=?,description=?,status=?,updated_at=datetime('now') WHERE id=?")
        .run(str(req.body?.name, row.name, 180), str(req.body?.description, row.description, 2000), str(req.body?.status, row.status, 40), row.id);
    } else if (name === 'sprints') {
      scope.db.prepare('UPDATE sprints SET name=?,status=?,start=?,end=? WHERE id=?')
        .run(str(req.body?.name, row.name, 180), str(req.body?.status, row.status, 40), req.body?.start === undefined ? row.start : req.body.start, req.body?.end === undefined ? row.end : req.body.end, row.id);
    } else if (name === 'pipes') {
      scope.db.prepare('UPDATE pipes SET name=?,stages_json=? WHERE id=?')
        .run(str(req.body?.name, row.name, 180), jstr(req.body?.stages ?? jparse(row.stages_json, [])), row.id);
    } else if (name === 'releases') {
      scope.db.prepare("UPDATE releases SET name=?,status=?,target_date=?,updated_at=datetime('now') WHERE id=?")
        .run(str(req.body?.name, row.name, 180), str(req.body?.status, row.status, 40), req.body?.targetDate === undefined ? row.target_date : req.body.targetDate, row.id);
    }
    res.json(scope.db.prepare(`SELECT * FROM ${name} WHERE id=?`).get(row.id));
  });
  router.delete(`/${name}/:id`, authRequired, (req, res) => {
    const scope = resolveScope(req, res, { write: true });
    if (!scope) return;
    const result = scope.db.prepare(`DELETE FROM ${name} WHERE id=? AND workspace_id=?`).run(req.params.id, scope.wid);
    if (!result.changes) return res.status(404).json({ error: `${name} object not found` });
    res.json({ ok: true });
  });
}

function linkRoute(path, table, leftColumn, rightColumn, leftTable, rightTable) {
  router.post(path, authRequired, (req, res) => {
    const scope = resolveScope(req, res, { write: true });
    if (!scope) return;
    const leftId = req.params.id;
    const rightId = str(req.body?.id || req.body?.pipeId || req.body?.workItemId, '', 200);
    if (!rightId) return res.status(400).json({ error: 'linked object id required' });
    if (!scope.db.prepare(`SELECT 1 FROM ${leftTable} WHERE id=? AND workspace_id=?`).get(leftId, scope.wid)) return res.status(404).json({ error: `${leftTable} object not found` });
    if (!scope.db.prepare(`SELECT 1 FROM ${rightTable} WHERE id=? AND workspace_id=?`).get(rightId, scope.wid)) return res.status(404).json({ error: `${rightTable} object not found` });
    scope.db.prepare(`INSERT OR IGNORE INTO ${table} (${leftColumn},${rightColumn}) VALUES (?,?)`).run(leftId, rightId);
    res.status(201).json({ ok: true, [leftColumn]: leftId, [rightColumn]: rightId });
  });
}

linkRoute('/sprints/:id/pipes', 'sprint_pipes', 'sprint_id', 'pipe_id', 'sprints', 'pipes');
linkRoute('/sprints/:id/work-items', 'sprint_work_items', 'sprint_id', 'work_item_id', 'sprints', 'work_items');
linkRoute('/pipes/:id/work-items', 'pipe_work_items', 'pipe_id', 'work_item_id', 'pipes', 'work_items');
linkRoute('/issues/:id/pipes', 'issue_pipes', 'issue_id', 'pipe_id', 'issues', 'pipes');

router.get('/execution-graph', (req, res) => {
  const scope = resolveScope(req, res);
  if (!scope) return;
  const filter = scope.gid ? ' AND graph_id = ?' : '';
  const params = scope.gid ? [scope.wid, scope.gid] : [scope.wid];
  res.json({
    workspace: scope.db.prepare('SELECT * FROM workspaces WHERE id=?').get(scope.wid),
    portfolios: scope.db.prepare('SELECT * FROM portfolios WHERE workspace_id=?').all(scope.wid),
    programs: scope.db.prepare('SELECT * FROM programs WHERE workspace_id=?').all(scope.wid),
    projects: scope.db.prepare('SELECT * FROM projects WHERE workspace_id=?').all(scope.wid),
    pipes: scope.db.prepare(`SELECT * FROM pipes WHERE workspace_id=?${filter}`).all(...params),
    releases: scope.db.prepare(`SELECT * FROM releases WHERE workspace_id=?${filter}`).all(...params),
    sprints: scope.db.prepare(`SELECT * FROM sprints WHERE workspace_id=?${filter}`).all(...params),
    sprintPipes: scope.db.prepare('SELECT sp.* FROM sprint_pipes sp JOIN sprints s ON s.id=sp.sprint_id WHERE s.workspace_id=?').all(scope.wid),
    sprintWorkItems: scope.db.prepare('SELECT sw.* FROM sprint_work_items sw JOIN sprints s ON s.id=sw.sprint_id WHERE s.workspace_id=?').all(scope.wid),
    pipeWorkItems: scope.db.prepare('SELECT pw.* FROM pipe_work_items pw JOIN pipes p ON p.id=pw.pipe_id WHERE p.workspace_id=?').all(scope.wid)
  });
});

router.get('/transformation-metrics', (req, res) => {
  const scope = resolveScope(req, res);
  if (!scope) return;
  const filter = scope.gid ? ' AND graph_id=?' : '';
  const params = scope.gid ? [scope.wid, scope.gid] : [scope.wid];
  const layers = scope.db.prepare(`SELECT COALESCE(layer,'Unassigned') layer, COUNT(*) nodes FROM nodes WHERE workspace_id=?${filter} GROUP BY layer`).all(...params);
  const work = scope.db.prepare(`SELECT COUNT(*) items, COALESCE(SUM(estimated_hours),0) estimatedHours, COALESCE(SUM(budget),0) budget, COALESCE(SUM(critical_path),0) criticalPathItems FROM work_items WHERE workspace_id=?${filter}`).get(...params);
  const changes = scope.db.prepare(`SELECT COUNT(*) changes, COALESCE(SUM(estimated_hours),0) estimatedHours, COALESCE(SUM(budget),0) budget FROM changes WHERE workspace_id=?${filter}`).get(...params);
  res.json({ layers, resources: work, changes });
});

export default router;
