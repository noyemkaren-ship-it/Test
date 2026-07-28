import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired } from '../middleware/auth.js';
import { getDb, wsId, jparse, jstr, validateWorkspaceAccess } from '../utils/helper.js';
import {
  auditSecurity, effectivePermissions, ensureWorkspaceRbac, hasPermission, permissionCatalog, userId
} from '../services/authorization.js';

const router = Router();
const LAYERS = ['Knowledge', 'Implementation', 'Project', 'Resource'];

function access(req, res, permission = 'workspace.read', context = {}) {
  const wid = String(context.workspaceId || wsId(req));
  if (!validateWorkspaceAccess(req, wid) || !hasPermission(req, wid, permission, context)) {
    auditSecurity(wid, req, permission, 'deny', context);
    res.status(403).json({ error: 'Permission denied', required: permission });
    return null;
  }
  return { db: getDb(), wid };
}

function text(value, fallback, max = 240) {
  return String(value || fallback || '').trim().slice(0, max);
}

function projectIn(db, wid, id) {
  return id && db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=?').get(String(id), wid);
}

// Project → Epic → Feature → Artifact → Version → Fragment.
router.get('/review-hierarchy', authRequired, (req, res) => {
  const s = access(req, res, 'review.read');
  if (!s) return;
  const projectId = req.query.project_id ? String(req.query.project_id) : null;
  const args = projectId ? [s.wid, projectId] : [s.wid];
  const filter = projectId ? ' AND project_id=?' : '';
  res.json({
    projects: s.db.prepare('SELECT id,name FROM projects WHERE workspace_id=? ORDER BY name').all(s.wid),
    epics: s.db.prepare(`SELECT * FROM epics WHERE workspace_id=?${filter} ORDER BY created_at`).all(...args),
    features: s.db.prepare(`SELECT * FROM features WHERE workspace_id=?${filter} ORDER BY created_at`).all(...args),
    artifacts: s.db.prepare(`SELECT * FROM artifacts WHERE workspace_id=?${filter} ORDER BY created_at`).all(...args),
    versions: s.db.prepare(`SELECT av.* FROM artifact_versions av JOIN artifacts a ON a.id=av.artifact_id WHERE a.workspace_id=?${projectId ? ' AND a.project_id=?' : ''} ORDER BY av.created_at`).all(...args),
    fragments: s.db.prepare(`SELECT f.* FROM fragments f JOIN artifact_versions av ON av.id=f.artifact_version_id JOIN artifacts a ON a.id=av.artifact_id WHERE a.workspace_id=?${projectId ? ' AND a.project_id=?' : ''} ORDER BY f.created_at`).all(...args)
  });
});

router.post('/epics', authRequired, (req, res) => {
  const s = access(req, res, 'review.write'); if (!s) return;
  const project = projectIn(s.db, s.wid, req.body?.projectId);
  if (!project) return res.status(400).json({ error: 'Valid projectId required' });
  const id = randomUUID();
  s.db.prepare('INSERT INTO epics (id,workspace_id,project_id,graph_id,name,status) VALUES (?,?,?,?,?,?)')
    .run(id, s.wid, project.id, req.body?.graphId || null, text(req.body?.name, 'Epic'), text(req.body?.status, 'planned', 40));
  res.status(201).json({ id, projectId: project.id });
});

router.post('/features', authRequired, (req, res) => {
  const s = access(req, res, 'review.write'); if (!s) return;
  const epic = s.db.prepare('SELECT * FROM epics WHERE id=? AND workspace_id=?').get(req.body?.epicId, s.wid);
  if (!epic) return res.status(400).json({ error: 'Valid epicId required' });
  const id = randomUUID();
  s.db.prepare('INSERT INTO features (id,workspace_id,project_id,epic_id,graph_id,name,status) VALUES (?,?,?,?,?,?,?)')
    .run(id, s.wid, epic.project_id, epic.id, req.body?.graphId || epic.graph_id, text(req.body?.name, 'Feature'), text(req.body?.status, 'planned', 40));
  res.status(201).json({ id, epicId: epic.id, projectId: epic.project_id });
});

router.post('/artifacts', authRequired, (req, res) => {
  const s = access(req, res, 'review.write'); if (!s) return;
  const feature = s.db.prepare('SELECT * FROM features WHERE id=? AND workspace_id=?').get(req.body?.featureId, s.wid);
  if (!feature) return res.status(400).json({ error: 'Valid featureId required' });
  if (req.body?.nodeId && !s.db.prepare('SELECT 1 FROM nodes WHERE id=? AND workspace_id=?').get(req.body.nodeId, s.wid)) return res.status(400).json({ error: 'nodeId belongs to another workspace' });
  const id = randomUUID();
  s.db.prepare('INSERT INTO artifacts (id,workspace_id,project_id,feature_id,graph_id,node_id,name,type) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, s.wid, feature.project_id, feature.id, req.body?.graphId || feature.graph_id, req.body?.nodeId || null, text(req.body?.name, 'Artifact'), text(req.body?.type, 'document', 80));
  res.status(201).json({ id, featureId: feature.id, projectId: feature.project_id });
});

router.post('/artifact-versions', authRequired, (req, res) => {
  const s = access(req, res, 'review.write'); if (!s) return;
  const artifact = s.db.prepare('SELECT * FROM artifacts WHERE id=? AND workspace_id=?').get(req.body?.artifactId, s.wid);
  if (!artifact) return res.status(400).json({ error: 'Valid artifactId required' });
  const version = text(req.body?.version, '', 80);
  if (!version) return res.status(400).json({ error: 'version required' });
  const id = randomUUID();
  s.db.prepare('INSERT INTO artifact_versions (id,artifact_id,version,status,payload_json) VALUES (?,?,?,?,?)')
    .run(id, artifact.id, version, text(req.body?.status, 'draft', 40), jstr(req.body?.payload || {}));
  res.status(201).json({ id, artifactId: artifact.id, version });
});

router.post('/fragments', authRequired, (req, res) => {
  const s = access(req, res, 'review.write'); if (!s) return;
  const version = s.db.prepare(`SELECT av.*,a.workspace_id FROM artifact_versions av JOIN artifacts a ON a.id=av.artifact_id
    WHERE av.id=? AND a.workspace_id=?`).get(req.body?.versionId, s.wid);
  if (!version) return res.status(400).json({ error: 'Valid versionId required' });
  const id = randomUUID();
  s.db.prepare('INSERT INTO fragments (id,artifact_version_id,node_id,label,selector_json) VALUES (?,?,?,?,?)')
    .run(id, version.id, req.body?.nodeId || null, text(req.body?.label, 'Fragment'), jstr(req.body?.selector || {}));
  res.status(201).json({ id, versionId: version.id });
});

router.get('/transformation-sets', authRequired, (req, res) => {
  const s = access(req, res, 'project.read'); if (!s) return;
  const sets = s.db.prepare('SELECT * FROM transformation_sets WHERE workspace_id=? ORDER BY created_at DESC').all(s.wid);
  res.json(sets.map(set => ({ ...set, graphs: s.db.prepare('SELECT * FROM transformation_graphs WHERE set_id=? ORDER BY layer').all(set.id).map(g => ({ ...g, settings: jparse(g.settings_json, {}) })) })));
});

router.post('/transformation-sets', authRequired, (req, res) => {
  const s = access(req, res, 'project.write'); if (!s) return;
  const project = projectIn(s.db, s.wid, req.body?.projectId);
  if (!project) return res.status(400).json({ error: 'Valid projectId required' });
  const id = randomUUID();
  const graphs = [];
  s.db.transaction(() => {
    s.db.prepare('INSERT INTO transformation_sets (id,workspace_id,project_id,name,status) VALUES (?,?,?,?,?)')
      .run(id, s.wid, project.id, text(req.body?.name, `${project.name} transformation`), 'active');
    const insert = s.db.prepare('INSERT INTO transformation_graphs (id,set_id,workspace_id,project_id,layer,name,settings_json) VALUES (?,?,?,?,?,?,?)');
    for (const layer of LAYERS) {
      const graphId = randomUUID();
      insert.run(graphId, id, s.wid, project.id, layer, `${layer} Graph`, '{}');
      graphs.push({ id: graphId, layer, name: `${layer} Graph` });
    }
  })();
  res.status(201).json({ id, projectId: project.id, graphs });
});

router.get('/transformation-sets/:id', authRequired, (req, res) => {
  const s = access(req, res, 'project.read'); if (!s) return;
  const set = s.db.prepare('SELECT * FROM transformation_sets WHERE id=? AND workspace_id=?').get(req.params.id, s.wid);
  if (!set) return res.status(404).json({ error: 'Transformation set not found' });
  const graphs = s.db.prepare('SELECT * FROM transformation_graphs WHERE set_id=? ORDER BY layer').all(set.id).map(graph => ({
    ...graph,
    nodes: s.db.prepare(`SELECT n.* FROM transformation_graph_nodes tgn JOIN nodes n ON n.id=tgn.node_id
      WHERE tgn.transformation_graph_id=?`).all(graph.id)
  }));
  const alignments = s.db.prepare('SELECT * FROM transformation_alignments WHERE set_id=? ORDER BY created_at').all(set.id);
  res.json({ ...set, graphs, alignments, invariant: { requiredLayers: LAYERS, graphCount: graphs.length, complete: graphs.length === 4 && new Set(graphs.map(g => g.layer)).size === 4 } });
});

router.post('/transformation-graphs/:id/nodes', authRequired, (req, res) => {
  const s = access(req, res, 'graph.write'); if (!s) return;
  const graph = s.db.prepare('SELECT * FROM transformation_graphs WHERE id=? AND workspace_id=?').get(req.params.id, s.wid);
  const node = s.db.prepare('SELECT * FROM nodes WHERE id=? AND workspace_id=?').get(req.body?.nodeId, s.wid);
  if (!graph || !node) return res.status(400).json({ error: 'Valid transformation graph and nodeId required' });
  s.db.prepare('INSERT OR IGNORE INTO transformation_graph_nodes (transformation_graph_id,node_id) VALUES (?,?)').run(graph.id, node.id);
  res.status(201).json({ transformationGraphId: graph.id, nodeId: node.id });
});

router.post('/transformation-sets/:id/alignments', authRequired, (req, res) => {
  const s = access(req, res, 'graph.write'); if (!s) return;
  const source = s.db.prepare('SELECT * FROM transformation_graphs WHERE id=? AND set_id=? AND workspace_id=?').get(req.body?.sourceGraphId, req.params.id, s.wid);
  const target = s.db.prepare('SELECT * FROM transformation_graphs WHERE id=? AND set_id=? AND workspace_id=?').get(req.body?.targetGraphId, req.params.id, s.wid);
  if (!source || !target || source.id === target.id) return res.status(400).json({ error: 'Alignment requires two different graphs from the same set' });
  const sourceBound = s.db.prepare('SELECT 1 FROM transformation_graph_nodes WHERE transformation_graph_id=? AND node_id=?').get(source.id, req.body?.sourceNodeId);
  const targetBound = s.db.prepare('SELECT 1 FROM transformation_graph_nodes WHERE transformation_graph_id=? AND node_id=?').get(target.id, req.body?.targetNodeId);
  if (!sourceBound || !targetBound) return res.status(400).json({ error: 'Both nodes must be members of their transformation graphs' });
  const id = randomUUID();
  s.db.prepare(`INSERT INTO transformation_alignments
    (id,set_id,source_graph_id,source_node_id,target_graph_id,target_node_id,relation) VALUES (?,?,?,?,?,?,?)`)
    .run(id, req.params.id, source.id, req.body.sourceNodeId, target.id, req.body.targetNodeId, text(req.body?.relation, 'traces-to', 80));
  res.status(201).json({ id, setId: req.params.id });
});

router.get('/workspace-resources', authRequired, (req, res) => {
  const s = access(req, res, 'project.read'); if (!s) return;
  res.json(s.db.prepare(`SELECT wr.*,COUNT(prl.project_id) project_count FROM workspace_resources wr
    LEFT JOIN project_resource_links prl ON prl.resource_id=wr.id WHERE wr.workspace_id=? GROUP BY wr.id ORDER BY wr.updated_at DESC`).all(s.wid)
    .map(row => ({ ...row, payload: jparse(row.payload_json, {}) })));
});

router.post('/workspace-resources', authRequired, (req, res) => {
  const s = access(req, res, 'project.write'); if (!s) return;
  const id = randomUUID();
  s.db.prepare('INSERT INTO workspace_resources (id,workspace_id,type,name,payload_json,source_graph_id) VALUES (?,?,?,?,?,?)')
    .run(id, s.wid, text(req.body?.type, 'knowledge', 80), text(req.body?.name, 'Shared resource'), jstr(req.body?.payload || {}), req.body?.sourceGraphId || null);
  res.status(201).json({ id, workspaceId: s.wid });
});

router.post('/workspace-resources/:id/projects/:projectId', authRequired, (req, res) => {
  const s = access(req, res, 'project.manage'); if (!s) return;
  const resource = s.db.prepare('SELECT 1 FROM workspace_resources WHERE id=? AND workspace_id=?').get(req.params.id, s.wid);
  const project = projectIn(s.db, s.wid, req.params.projectId);
  if (!resource || !project) return res.status(404).json({ error: 'Resource or project not found in workspace' });
  s.db.prepare('INSERT OR REPLACE INTO project_resource_links (project_id,resource_id,usage_role) VALUES (?,?,?)')
    .run(project.id, req.params.id, text(req.body?.usageRole, 'shared', 80));
  res.status(201).json({ resourceId: req.params.id, projectId: project.id });
});

router.post('/projects/:projectId/shared-nodes/:nodeId', authRequired, (req, res) => {
  const s = access(req, res, 'project.manage'); if (!s) return;
  const project = projectIn(s.db, s.wid, req.params.projectId);
  const node = s.db.prepare('SELECT 1 FROM nodes WHERE id=? AND workspace_id=?').get(req.params.nodeId, s.wid);
  if (!project || !node) return res.status(404).json({ error: 'Project or node not found in workspace' });
  s.db.prepare('INSERT OR REPLACE INTO project_node_links (project_id,node_id,usage_role) VALUES (?,?,?)')
    .run(project.id, req.params.nodeId, text(req.body?.usageRole, 'reference', 80));
  res.status(201).json({ projectId: project.id, nodeId: req.params.nodeId });
});

router.get('/projects/:projectId/shared-resources', authRequired, (req, res) => {
  const s = access(req, res, 'project.read'); if (!s) return;
  const project = projectIn(s.db, s.wid, req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({
    resources: s.db.prepare(`SELECT wr.*,prl.usage_role FROM project_resource_links prl JOIN workspace_resources wr ON wr.id=prl.resource_id WHERE prl.project_id=?`).all(project.id),
    nodes: s.db.prepare(`SELECT n.*,pnl.usage_role FROM project_node_links pnl JOIN nodes n ON n.id=pnl.node_id WHERE pnl.project_id=?`).all(project.id)
  });
});

router.get('/rbac/permissions', authRequired, (req, res) => {
  const s = access(req, res, 'workspace.read'); if (!s) return;
  ensureWorkspaceRbac(s.db, s.wid);
  res.json(permissionCatalog());
});

router.get('/rbac/roles', authRequired, (req, res) => {
  const s = access(req, res, 'workspace.read'); if (!s) return;
  ensureWorkspaceRbac(s.db, s.wid);
  res.json(s.db.prepare(`SELECT r.id,r.name,r.parent_role_id AS parentRoleId,r.is_system AS isSystem,
    GROUP_CONCAT(p.name) AS directPermissions FROM rbac_roles r LEFT JOIN rbac_role_permissions rp ON rp.role_id=r.id
    LEFT JOIN rbac_permissions p ON p.id=rp.permission_id WHERE r.workspace_id=? GROUP BY r.id ORDER BY r.name`).all(s.wid));
});

router.post('/rbac/assignments', authRequired, (req, res) => {
  const s = access(req, res, 'rbac.manage'); if (!s) return;
  ensureWorkspaceRbac(s.db, s.wid);
  const role = s.db.prepare('SELECT id FROM rbac_roles WHERE id=? AND workspace_id=?').get(req.body?.roleId, s.wid);
  const member = s.db.prepare('SELECT 1 FROM memberships WHERE user_id=? AND workspace_id=?').get(req.body?.userId, s.wid);
  const scopeType = text(req.body?.scopeType, 'workspace', 40);
  const scopeId = text(req.body?.scopeId, s.wid, 200);
  if (!role || !member || !['workspace','project','graph','object'].includes(scopeType)) return res.status(400).json({ error: 'Valid member, role and scope required' });
  const id = randomUUID();
  s.db.prepare('INSERT INTO rbac_assignments (id,workspace_id,user_id,role_id,scope_type,scope_id) VALUES (?,?,?,?,?,?)')
    .run(id, s.wid, req.body.userId, role.id, scopeType, scopeId);
  auditSecurity(s.wid, req, 'rbac.assignment.create', 'allow', { objectType: scopeType, objectId: scopeId, roleId: role.id });
  res.status(201).json({ id });
});

router.post('/rbac/memberships', authRequired, (req, res) => {
  const s = access(req, res, 'workspace.manage'); if (!s) return;
  const user = s.db.prepare('SELECT id FROM users WHERE id=?').get(req.body?.userId);
  if (!user) return res.status(400).json({ error: 'Valid userId required' });
  const membershipRole = text(req.body?.membershipRole, 'member', 20);
  if (!['member','admin'].includes(membershipRole)) return res.status(400).json({ error: 'membershipRole must be member or admin' });
  s.db.prepare(`INSERT INTO memberships (user_id,workspace_id,role) VALUES (?,?,?)
    ON CONFLICT(user_id,workspace_id) DO UPDATE SET role=excluded.role`).run(user.id, s.wid, membershipRole);
  auditSecurity(s.wid, req, 'rbac.membership.write', 'allow', { objectType: 'workspace', objectId: s.wid, userId: user.id });
  res.status(201).json({ userId: user.id, workspaceId: s.wid, membershipRole });
});

router.post('/rbac/acl', authRequired, (req, res) => {
  const s = access(req, res, 'rbac.manage'); if (!s) return;
  const effect = text(req.body?.effect, '', 10);
  const subjectType = text(req.body?.subjectType, '', 10);
  if (!['allow','deny'].includes(effect) || !['user','role'].includes(subjectType)) return res.status(400).json({ error: 'Valid subjectType and effect required' });
  const id = randomUUID();
  s.db.prepare(`INSERT INTO object_acl (id,workspace_id,object_type,object_id,subject_type,subject_id,permission,effect)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,object_type,object_id,subject_type,subject_id,permission)
    DO UPDATE SET effect=excluded.effect`).run(id, s.wid, text(req.body?.objectType, '', 80), text(req.body?.objectId, '', 200), subjectType, text(req.body?.subjectId, '', 200), text(req.body?.permission, '', 100), effect);
  auditSecurity(s.wid, req, 'rbac.acl.write', 'allow', { objectType: req.body?.objectType, objectId: req.body?.objectId, effect });
  res.status(201).json({ id, effect });
});

router.delete('/rbac/acl/:id', authRequired, (req, res) => {
  const s = access(req, res, 'rbac.manage'); if (!s) return;
  const result = s.db.prepare('DELETE FROM object_acl WHERE id=? AND workspace_id=?').run(req.params.id, s.wid);
  if (!result.changes) return res.status(404).json({ error: 'ACL rule not found' });
  auditSecurity(s.wid, req, 'rbac.acl.delete', 'allow', { objectType: 'acl', objectId: req.params.id });
  res.json({ ok: true });
});

router.get('/rbac/effective', authRequired, (req, res) => {
  const s = access(req, res, 'workspace.read'); if (!s) return;
  res.json(effectivePermissions(req, s.wid, { graphId: req.query.graph_id, projectId: req.query.project_id, objectId: req.query.object_id }));
});

router.get('/rbac/audit-log', authRequired, (req, res) => {
  const s = access(req, res, 'audit.read'); if (!s) return;
  res.json(s.db.prepare('SELECT * FROM security_audit_log WHERE workspace_id=? ORDER BY created_at DESC LIMIT 200').all(s.wid).map(row => ({ ...row, details: jparse(row.details_json, {}) })));
});

router.get('/ai/capabilities', (_req, res) => {
  const mode = String(process.env.AI_EXECUTION_MODE || 'hybrid');
  res.json({
    requirement: 'Graph Copilot with graph/RAG context',
    offlineAi: {
      classification: 'optional architecture extension',
      enabled: process.env.OFFLINE_AI_ENABLED === '1',
      executionMode: mode,
      rationale: 'Privacy-preserving and availability fallback for isolated installations',
      optOut: 'Set OFFLINE_AI_ENABLED=0 or AI_EXECUTION_MODE=external/local',
      sendsDataExternally: false
    },
    externalAiConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY),
    decisionRecord: 'docs/adr/ADR-002-offline-ai.md'
  });
});

export default router;
