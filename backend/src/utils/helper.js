import { getDb as getDatabase, setDb as setDatabase } from '../db/database.js';
import { hasPermission } from '../services/authorization.js';

export const getDb = getDatabase;
export const setDb = setDatabase;

export function wsId(req) {
  const headerWs = req.headers['x-workspace-id'];
  if (headerWs && req.user?.id && req.user.id !== 'anon') return String(headerWs);
  if (req.user?.workspaceId) return req.user.workspaceId;
  if (req.user?.id && req.user.id !== 'anon' && req.user.id !== 'api') {
    const membership = getDb().prepare('SELECT workspace_id FROM memberships WHERE user_id = ? LIMIT 1').get(req.user.sub || req.user.id);
    if (membership) return membership.workspace_id;
  }
  return 'ws-default';
}

export function graphId(req) {
  return req.headers['x-graph-id'] || req.user?.activeGraphId || req.query.graph_id || null;
}

export function isAuthenticated(req) {
  return !!(req.user && !['anon'].includes(req.user.id));
}

export function validateWorkspaceAccess(req, targetWsId) {
  if (!req.user || req.user.id === 'anon') return false;
  if (req.user.id === 'api' || req.user.role === 'service' || req.user.role === 'admin') return true;
  const membership = getDb().prepare(
    'SELECT 1 FROM memberships WHERE user_id = ? AND workspace_id = ?'
  ).get(req.user.sub || req.user.id, targetWsId);
  return !!membership;
}

export function isPublicGraph(targetGraphId) {
  if (!targetGraphId) return false;
  const graph = getDb().prepare("SELECT 1 FROM graphs WHERE id = ? AND COALESCE(visibility, 'public') = 'public'").get(targetGraphId);
  return !!graph;
}

export function validateGraphAccess(req, targetGraphId, { write = false } = {}) {
  if (!targetGraphId) return write ? false : validateWorkspaceAccess(req, wsId(req));
  const graph = getDb().prepare('SELECT workspace_id, visibility FROM graphs WHERE id = ?').get(targetGraphId);
  if (!graph) return false;
  if (!write && graph.visibility !== 'private') return true;
  if (!validateWorkspaceAccess(req, graph.workspace_id)) return false;
  return hasPermission(req, graph.workspace_id, write ? 'graph.write' : 'graph.read', {
    graphId: targetGraphId,
    objectType: 'graph',
    objectId: targetGraphId
  });
}

export function validateReadAccess(req, targetWsId, targetGraphId = null) {
  if (validateWorkspaceAccess(req, targetWsId)) return true;
  if (targetGraphId) return isPublicGraph(targetGraphId);
  return false;
}

export function getGraphFilter(req) {
  const gid = graphId(req);
  return gid ? { clause: 'AND graph_id = ?', param: gid } : { clause: '', param: null };
}

export function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

export function chunkText(text, size = 120, overlap = 24) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  const step = Math.max(1, size - overlap);
  for (let i = 0; i < words.length; i += step) {
    const t = words.slice(i, i + size).join(' ');
    if (t.trim().length > 20) out.push(t);
    if (i + size >= words.length) break;
  }
  return out;
}

export function jparse(str, fallback = null) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

export function jstr(obj) { return JSON.stringify(obj ?? null); }

export function slugify(value) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return base || 'domain';
}

export function validateSecrets() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'graph-platform-dev-secret-change-me') {
      throw new Error('JWT_SECRET must be set in production');
    }
    if (!process.env.API_KEY || process.env.API_KEY === 'dev-api-key') {
      throw new Error('API_KEY must be set in production');
    }
    if (process.env.OFFLINE_AI_ENABLED === '1' && (!process.env.OFFLINE_AI_KEY || ['offline-dev-key', 'change-me-offline-key'].includes(process.env.OFFLINE_AI_KEY))) {
      throw new Error('OFFLINE_AI_KEY must be set in production');
    }
    if (!String(process.env.CORS_ORIGINS || '').trim()) {
      throw new Error('CORS_ORIGINS must be set explicitly in production');
    }
  }
  return true;
}
