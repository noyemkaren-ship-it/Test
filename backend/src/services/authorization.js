import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';

const PERMISSIONS = [
  ['workspace.read', 'Read workspace metadata'],
  ['workspace.manage', 'Manage workspace and membership'],
  ['project.read', 'Read projects'],
  ['project.write', 'Create and update projects'],
  ['project.manage', 'Delete projects and manage sharing'],
  ['graph.read', 'Read graph objects'],
  ['graph.write', 'Create and update graph objects'],
  ['graph.manage', 'Delete, publish and import graphs'],
  ['review.read', 'Read reviews'],
  ['review.write', 'Create and update reviews'],
  ['review.vote', 'Vote and transition reviews'],
  ['rag.read', 'Read knowledge sources'],
  ['rag.write', 'Import knowledge sources'],
  ['ai.use', 'Use Graph Copilot'],
  ['rbac.manage', 'Manage roles, assignments and object ACL'],
  ['audit.read', 'Read security audit log']
];

const ROLE_RULES = [
  ['viewer', null, ['workspace.read', 'project.read', 'graph.read', 'review.read', 'rag.read', 'ai.use']],
  ['reviewer', 'viewer', ['review.write', 'review.vote']],
  ['editor', 'reviewer', ['project.write', 'graph.write', 'rag.write']],
  ['workspace_admin', 'editor', ['workspace.manage', 'project.manage', 'graph.manage', 'rbac.manage', 'audit.read']]
];

export function ensureWorkspaceRbac(db, workspaceId) {
  if (!workspaceId || !db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId)) return;
  const addPermission = db.prepare('INSERT OR IGNORE INTO rbac_permissions (id,name,description) VALUES (?,?,?)');
  for (const [name, description] of PERMISSIONS) addPermission.run(`perm:${name}`, name, description);
  const ids = new Map();
  for (const [name] of ROLE_RULES) {
    const id = `role:${workspaceId}:${name}`;
    ids.set(name, id);
    db.prepare('INSERT OR IGNORE INTO rbac_roles (id,workspace_id,name,is_system) VALUES (?,?,?,1)').run(id, workspaceId, name);
  }
  for (const [name, parent, permissions] of ROLE_RULES) {
    const roleId = ids.get(name);
    db.prepare('UPDATE rbac_roles SET parent_role_id=? WHERE id=?').run(parent ? ids.get(parent) : null, roleId);
    for (const permission of permissions) {
      db.prepare(`INSERT OR IGNORE INTO rbac_role_permissions (role_id,permission_id,effect)
        VALUES (?,?, 'allow')`).run(roleId, `perm:${permission}`);
    }
  }
}

export function userId(req) {
  return req.user?.sub || req.user?.id || null;
}

export function effectivePermissions(req, workspaceId, context = {}) {
  const db = getDb();
  const uid = userId(req);
  if (!uid || uid === 'anon') return { permissions: [], roles: [], source: 'anonymous' };
  if (uid === 'api' || req.user?.role === 'service') {
    return { permissions: PERMISSIONS.map(([name]) => name), roles: ['service'], source: 'service' };
  }
  ensureWorkspaceRbac(db, workspaceId);
  const membership = db.prepare('SELECT role FROM memberships WHERE user_id=? AND workspace_id=?').get(uid, workspaceId);
  if (!membership) return { permissions: [], roles: [], source: 'no-membership' };
  const defaultRole = membership.role === 'admin' ? 'workspace_admin' : 'editor';
  const scopeRows = db.prepare(`SELECT role_id,scope_type,scope_id FROM rbac_assignments
    WHERE workspace_id=? AND user_id=?`).all(workspaceId, uid);
  const matchingAssignments = [];
  for (const row of scopeRows) {
    const matches = row.scope_type === 'workspace' && row.scope_id === workspaceId
      || row.scope_type === 'project' && context.projectId && row.scope_id === context.projectId
      || row.scope_type === 'graph' && context.graphId && row.scope_id === context.graphId
      || row.scope_type === 'object' && context.objectId && row.scope_id === context.objectId;
    if (matches) matchingAssignments.push(row.role_id);
  }
  const roleIds = new Set(matchingAssignments.length ? matchingAssignments : [`role:${workspaceId}:${defaultRole}`]);
  const inherited = new Set();
  const visit = id => {
    if (!id || inherited.has(id)) return;
    inherited.add(id);
    visit(db.prepare('SELECT parent_role_id FROM rbac_roles WHERE id=? AND workspace_id=?').get(id, workspaceId)?.parent_role_id);
  };
  for (const id of roleIds) visit(id);
  const permissions = new Map();
  for (const roleId of inherited) {
    for (const row of db.prepare(`SELECT p.name,rp.effect FROM rbac_role_permissions rp
      JOIN rbac_permissions p ON p.id=rp.permission_id WHERE rp.role_id=?`).all(roleId)) {
      if (row.effect === 'deny' || !permissions.has(row.name)) permissions.set(row.name, row.effect);
    }
  }
  return {
    permissions: [...permissions].filter(([, effect]) => effect === 'allow').map(([name]) => name).sort(),
    roles: [...inherited].map(id => db.prepare('SELECT name FROM rbac_roles WHERE id=?').get(id)?.name).filter(Boolean),
    roleIds: [...inherited],
    source: `membership:${membership.role}`
  };
}

export function hasPermission(req, workspaceId, permission, context = {}) {
  const effective = effectivePermissions(req, workspaceId, context);
  if (!effective.permissions.includes(permission)) return false;
  if (!context.objectType || !context.objectId) return true;
  const db = getDb();
  const uid = userId(req);
  const rows = db.prepare(`SELECT subject_type,subject_id,effect FROM object_acl
    WHERE workspace_id=? AND object_type=? AND object_id=? AND permission=?`).all(
      workspaceId, context.objectType, String(context.objectId), permission
    );
  const applies = rows.filter(row => row.subject_type === 'user' && row.subject_id === uid
    || row.subject_type === 'role' && effective.roleIds?.includes(row.subject_id));
  if (applies.some(row => row.effect === 'deny')) return false;
  if (applies.some(row => row.effect === 'allow')) return true;
  return true;
}

export function auditSecurity(workspaceId, req, action, decision, details = {}) {
  getDb().prepare(`INSERT INTO security_audit_log
    (id,workspace_id,actor_user_id,action,object_type,object_id,decision,details_json)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      randomUUID(), workspaceId, userId(req), action, details.objectType || null,
      details.objectId ? String(details.objectId) : null, decision, JSON.stringify(details)
    );
}

export function requirePermission(permission, contextResolver = () => ({})) {
  return (req, res, next) => {
    const context = contextResolver(req) || {};
    const workspaceId = context.workspaceId || req.headers['x-workspace-id'] || req.user?.workspaceId;
    if (workspaceId && hasPermission(req, String(workspaceId), permission, context)) return next();
    if (workspaceId) auditSecurity(String(workspaceId), req, permission, 'deny', context);
    return res.status(403).json({ error: 'Permission denied', required: permission });
  };
}

export const permissionCatalog = () => PERMISSIONS.map(([name, description]) => ({ name, description }));
