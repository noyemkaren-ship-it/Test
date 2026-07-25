import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired, requireAdmin } from '../middleware/auth.js';
import { getRateLimitStats } from '../middleware/security.js';
import { getDb, wsId, validateWorkspaceAccess, slugify } from '../utils/helper.js';
import { DEFAULT_PROFILE } from '../engines/ontology.js';

const router = Router();
router.use('/admin', authRequired, requireAdmin);

router.get('/admin/summary', (req, res) => {
  try {
    const db = getDb();
    const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    const count = (table, where = '', params = []) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ''}`).get(...params).count;
    const recentQuestions = db.prepare('SELECT id, message, answer, model, ts, graph_id FROM questions ORDER BY ts DESC LIMIT 8').all();
    res.json({
      stats: {
        users: count('users'),
        workspaces: count('workspaces'),
        graphs: count('graphs'),
        nodes: count('nodes'),
        edges: count('edges'),
        documents: count('documents'),
        questions: count('questions'),
        publicGraphs: count('graphs', "COALESCE(visibility, 'public') = 'public'")
      },
      recentQuestions,
      rateLimit: getRateLimitStats(),
      version: '3.0.0'
    });
  } catch (e) {
    console.error('Admin summary error:', e.message);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

router.get('/admin/users', (_req, res) => {
  try {
    const users = getDb().prepare(`
      SELECT u.id, u.email, u.name, u.role, u.workspace_id, u.created_at,
             (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS memberships_count
      FROM users u ORDER BY u.created_at DESC
    `).all();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.patch('/admin/users/:id', (req, res) => {
  try {
    const db = getDb();
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const role = req.body?.role ?? target.role;
    const name = req.body?.name == null ? target.name : String(req.body.name).trim();
    if (!['member', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    db.prepare('UPDATE users SET name = ?, role = ? WHERE id = ?').run(name || target.name, role, target.id);
    res.json({ ok: true, id: target.id, name: name || target.name, role });
  } catch (e) { res.status(500).json({ error: 'Failed to update user' }); }
});

router.delete('/admin/users/:id', (req, res) => {
  try {
    const db = getDb();
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === (req.user.sub || req.user.id)) return res.status(400).json({ error: 'You cannot delete your own account here' });
    if (target.role === 'admin') return res.status(409).json({ error: 'Demote admin before deleting' });
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete user' }); }
});

router.post('/admin/import-graph', (req, res) => {
  try {
    const db = getDb();
    const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    const { workspaceId, tab = 'tobe', graphId, graph, nodes, edges, replace = false } = req.body || {};
    if (!Array.isArray(nodes) || !Array.isArray(edges)) return res.status(400).json({ error: 'nodes and edges arrays required' });
    const targetWs = workspaceId ? String(workspaceId) : wid;
    if (!validateWorkspaceAccess(req, targetWs)) return res.status(403).json({ error: 'Access denied' });
    if (nodes.length > 5000 || edges.length > 10000) return res.status(413).json({ error: 'Knowledge Package too large' });

    let gid = graphId ? String(graphId) : null;
    let remappedNodes = 0;
    let remappedEdges = 0;
    const tx = db.transaction(() => {
      let current = gid ? db.prepare('SELECT * FROM graphs WHERE id = ?').get(gid) : null;
      if (current && current.workspace_id !== targetWs) throw new Error('Target graph belongs to another workspace');

      if (!current) {
        gid = gid || randomUUID();
        const graphName = String(graph?.name || req.body?.name || `Imported domain ${new Date().toISOString().slice(0, 10)}`).trim().slice(0, 180);
        if (!graphName) throw new Error('Graph name required');
        let slug = slugify(graph?.slug || graphName);
        const base = slug; let n = 2;
        while (db.prepare('SELECT 1 FROM graphs WHERE slug = ? AND id != ?').get(slug, gid)) slug = `${base}-${n++}`;
        db.prepare(`INSERT INTO graphs (id, workspace_id, name, slug, description, visibility) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(gid, targetWs, graphName, slug, String(graph?.description || '').slice(0, 2000), graph?.visibility === 'private' ? 'private' : 'public');
        current = db.prepare('SELECT * FROM graphs WHERE id = ?').get(gid);
      } else if (graph) {
        const name = String(graph.name || current.name).trim().slice(0, 180) || current.name;
        const description = graph.description == null ? current.description : String(graph.description).slice(0, 2000);
        const visibility = graph.visibility == null ? current.visibility : (graph.visibility === 'private' ? 'private' : 'public');
        db.prepare("UPDATE graphs SET name = ?, description = ?, visibility = ?, updated_at = datetime('now') WHERE id = ?")
          .run(name, description, visibility, gid);
      }

      db.prepare('INSERT OR REPLACE INTO ontology (workspace_id, graph_id, profile_json) VALUES (?, ?, ?)')
        .run(targetWs, gid, JSON.stringify(graph?.ontology || DEFAULT_PROFILE));

      if (replace) {
        db.prepare('DELETE FROM edges WHERE graph_id = ? AND workspace_id = ?').run(gid, targetWs);
        db.prepare('DELETE FROM nodes WHERE graph_id = ? AND workspace_id = ?').run(gid, targetWs);
      }

      const packageIds = new Set();
      const nodeMap = new Map();
      for (const node of nodes) {
        if (!node?.id || !node?.label) throw new Error('Every node needs id and label');
        const sourceId = String(node.id);
        if (packageIds.has(sourceId)) throw new Error(`Duplicate node id in package: ${sourceId}`);
        packageIds.add(sourceId);
        const existing = db.prepare('SELECT graph_id FROM nodes WHERE id = ?').get(sourceId);
        let finalId = sourceId;
        if (existing && existing.graph_id !== gid) {
          finalId = randomUUID();
          remappedNodes += 1;
        }
        nodeMap.set(sourceId, finalId);
      }

      const insertNode = db.prepare(`
        INSERT OR REPLACE INTO nodes
        (id, workspace_id, project_id, graph_id, tab, label, kind, layer, node_kind, description, badge, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const node of nodes) {
        const sourceId = String(node.id);
        const projectId = node.projectId && db.prepare('SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?').get(String(node.projectId), targetWs)
          ? String(node.projectId) : null;
        insertNode.run(
          nodeMap.get(sourceId), targetWs, projectId, gid, String(node.tab || tab).slice(0, 60),
          String(node.label).slice(0, 300), String(node.kind || '').slice(0, 120), String(node.layer || 'Knowledge').slice(0, 120),
          String(node.nodeKind || node.node_kind || 'domain').slice(0, 120), String(node.description || '').slice(0, 4000),
          node.badge == null ? null : String(node.badge).slice(0, 80), JSON.stringify(node.data || {})
        );
      }

      const insertEdge = db.prepare(`
        INSERT OR REPLACE INTO edges (id, workspace_id, graph_id, tab, source, target, label)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const edge of edges) {
        if (!edge?.source || !edge?.target) throw new Error('Every edge needs source and target');
        const source = nodeMap.get(String(edge.source)) || String(edge.source);
        const target = nodeMap.get(String(edge.target)) || String(edge.target);
        if (!db.prepare('SELECT 1 FROM nodes WHERE id = ? AND graph_id = ? AND workspace_id = ?').get(source, gid, targetWs) ||
            !db.prepare('SELECT 1 FROM nodes WHERE id = ? AND graph_id = ? AND workspace_id = ?').get(target, gid, targetWs)) {
          throw new Error(`Edge references node outside target graph: ${edge.source} -> ${edge.target}`);
        }
        let edgeId = edge.id ? String(edge.id) : randomUUID();
        const existing = db.prepare('SELECT graph_id FROM edges WHERE id = ?').get(edgeId);
        if (existing && existing.graph_id !== gid) { edgeId = randomUUID(); remappedEdges += 1; }
        insertEdge.run(edgeId, targetWs, gid, String(edge.tab || tab).slice(0, 60), source, target, String(edge.label || '').slice(0, 300));
      }
      db.prepare("UPDATE graphs SET updated_at = datetime('now') WHERE id = ?").run(gid);
    });
    tx();
    const createdGraph = db.prepare('SELECT * FROM graphs WHERE id = ?').get(gid);
    res.status(201).json({ ok: true, graph: createdGraph, nodes: nodes.length, edges: edges.length, remappedNodes, remappedEdges });
  } catch (e) {
    console.error('Import graph error:', e.message);
    res.status(400).json({ error: e.message || 'Failed to import graph' });
  }
});

router.post('/admin/nodes', (req, res) => {
  try {
    const db = getDb(); const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    const { id = randomUUID(), tab = 'tobe', label, kind = '', layer = 'Knowledge', nodeKind = 'domain', description = '', badge = null, graphId, projectId } = req.body || {};
    if (!label) return res.status(400).json({ error: 'label required' });
    if (graphId) {
      const graph = db.prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(graphId);
      if (!graph || graph.workspace_id !== wid) return res.status(400).json({ error: 'Invalid graphId' });
    }
    if (projectId) {
      const project = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId);
      if (!project || project.workspace_id !== wid) return res.status(400).json({ error: 'Invalid projectId' });
    }
    const existing = db.prepare('SELECT workspace_id, graph_id FROM nodes WHERE id = ?').get(String(id));
    if (existing) return res.status(409).json({ error: 'Node id already exists' });

    db.prepare(`INSERT INTO nodes (id, workspace_id, project_id, graph_id, tab, label, kind, layer, node_kind, description, badge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(String(id), wid, projectId || null, graphId || null, String(tab).slice(0, 60), String(label).slice(0, 300), String(kind).slice(0, 120), String(layer).slice(0, 120), String(nodeKind).slice(0, 120), String(description).slice(0, 5000), badge == null ? null : String(badge).slice(0, 120));
    res.status(201).json({ id: String(id), label: String(label) });
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'Node id already exists' });
    res.status(500).json({ error: 'Failed to create node' });
  }
});

router.post('/admin/edges', (req, res) => {
  try {
    const db = getDb(); const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    const { id = randomUUID(), graphId, tab = 'tobe', source, target, label = '' } = req.body || {};
    if (!source || !target) return res.status(400).json({ error: 'source and target required' });
    if (!graphId) return res.status(400).json({ error: 'graphId required' });
    const graph = db.prepare('SELECT workspace_id FROM graphs WHERE id = ?').get(graphId);
    if (!graph || graph.workspace_id !== wid) return res.status(400).json({ error: 'Invalid graphId' });
    const expected = String(source) === String(target) ? 1 : 2;
    const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE graph_id = ? AND workspace_id = ? AND id IN (?, ?)')
      .get(graphId, wid, String(source), String(target)).c;
    if (nodeCount !== expected) return res.status(400).json({ error: 'Both nodes must belong to graph' });
    db.prepare('INSERT INTO edges (id, workspace_id, graph_id, tab, source, target, label) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(String(id), wid, String(graphId), String(tab).slice(0, 60), String(source), String(target), String(label).slice(0, 300));
    res.status(201).json({ id, source, target, label });
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'Edge id already exists' });
    res.status(500).json({ error: 'Failed to create edge' });
  }
});

router.delete('/admin/nodes/:id', (req, res) => {
  try {
    const db = getDb(); const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM edges WHERE workspace_id = ? AND (source = ? OR target = ?)').run(wid, req.params.id, req.params.id);
      db.prepare('DELETE FROM nodes WHERE id = ? AND workspace_id = ?').run(req.params.id, wid);
    });
    tx(); res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete node' }); }
});

router.delete('/admin/edges/:id', (req, res) => {
  try {
    const db = getDb(); const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });
    db.prepare('DELETE FROM edges WHERE id = ? AND workspace_id = ?').run(req.params.id, wid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete edge' }); }
});

export default router;
