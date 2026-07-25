import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authRequired } from '../middleware/auth.js';
import { getDb, wsId, validateWorkspaceAccess, slugify } from '../utils/helper.js';
import { DEFAULT_PROFILE } from '../engines/ontology.js';

const router = Router();

function serializeGraph(g) {
  return {
    id: g.id,
    workspaceId: g.workspace_id,
    name: g.name,
    slug: g.slug,
    description: g.description || '',
    visibility: g.visibility || 'public',
    createdAt: g.created_at,
    updatedAt: g.updated_at || g.created_at,
    nodeCount: g.node_count ?? undefined,
    edgeCount: g.edge_count ?? undefined,
    canEdit: g.can_edit == null ? undefined : !!g.can_edit
  };
}

router.get('/graphs', (req, res) => {
  try {
    const db = getDb();
    const wid = wsId(req);
    const authenticated = req.user && req.user.id !== 'anon';
    let rows;

    if (authenticated && validateWorkspaceAccess(req, wid)) {
      rows = db.prepare(`
        SELECT g.*,
               (SELECT COUNT(*) FROM nodes n WHERE n.graph_id = g.id) AS node_count,
               (SELECT COUNT(*) FROM edges e WHERE e.graph_id = g.id) AS edge_count,
               CASE WHEN g.workspace_id = ? THEN 1 ELSE 0 END AS can_edit
        FROM graphs g
        WHERE g.workspace_id = ? OR COALESCE(g.visibility, 'public') = 'public'
        ORDER BY can_edit DESC, g.created_at DESC
      `).all(wid, wid);
    } else {
      rows = db.prepare(`
        SELECT g.*,
               (SELECT COUNT(*) FROM nodes n WHERE n.graph_id = g.id) AS node_count,
               (SELECT COUNT(*) FROM edges e WHERE e.graph_id = g.id) AS edge_count
        FROM graphs g
        WHERE COALESCE(g.visibility, 'public') = 'public'
        ORDER BY g.created_at DESC
      `).all();
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    }

    res.json(rows.map(serializeGraph));
  } catch (e) {
    console.error('GET /graphs error:', e.message);
    res.status(500).json({ error: 'Failed to fetch graphs' });
  }
});

router.post('/graphs', authRequired, (req, res) => {
  try {
    const db = getDb();
    const wid = wsId(req);
    if (!validateWorkspaceAccess(req, wid)) return res.status(403).json({ error: 'Access denied' });

    const { name, description, visibility = 'public' } = req.body || {};
    if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'name required' });
    if (!['public', 'private'].includes(visibility)) return res.status(400).json({ error: 'visibility must be public or private' });

    const id = randomUUID();
    let slug = slugify(name);
    const base = slug;
    let i = 2;
    while (db.prepare('SELECT 1 FROM graphs WHERE slug = ?').get(slug)) slug = `${base}-${i++}`;

    db.prepare(`
      INSERT INTO graphs (id, workspace_id, name, slug, description, visibility, settings_json)
      VALUES (?, ?, ?, ?, ?, ?, '{}')
    `).run(id, wid, String(name).trim(), slug, String(description || '').trim(), visibility);

    db.prepare('INSERT OR REPLACE INTO ontology (workspace_id, graph_id, profile_json) VALUES (?, ?, ?)')
      .run(wid, id, JSON.stringify(DEFAULT_PROFILE));

    res.status(201).json(serializeGraph(db.prepare('SELECT * FROM graphs WHERE id = ?').get(id)));
  } catch (e) {
    console.error('POST /graphs error:', e.message);
    res.status(500).json({ error: 'Failed to create graph' });
  }
});

router.patch('/graphs/:id', authRequired, (req, res) => {
  try {
    const db = getDb();
    const graph = db.prepare('SELECT * FROM graphs WHERE id = ?').get(req.params.id);
    if (!graph) return res.status(404).json({ error: 'Graph not found' });
    if (!validateWorkspaceAccess(req, graph.workspace_id)) return res.status(403).json({ error: 'Access denied' });

    const name = req.body?.name == null ? graph.name : String(req.body.name).trim();
    const description = req.body?.description == null ? graph.description : String(req.body.description).trim();
    const visibility = req.body?.visibility == null ? graph.visibility : req.body.visibility;
    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    if (!['public', 'private'].includes(visibility)) return res.status(400).json({ error: 'visibility must be public or private' });

    db.prepare("UPDATE graphs SET name = ?, description = ?, visibility = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name, description, visibility, graph.id);
    res.json(serializeGraph(db.prepare('SELECT * FROM graphs WHERE id = ?').get(graph.id)));
  } catch (e) {
    console.error('PATCH /graphs/:id error:', e.message);
    res.status(500).json({ error: 'Failed to update graph' });
  }
});

router.delete('/graphs/:id', authRequired, (req, res) => {
  try {
    const db = getDb();
    const graph = db.prepare('SELECT * FROM graphs WHERE id = ?').get(req.params.id);
    if (!graph) return res.status(404).json({ error: 'Graph not found' });
    if (!validateWorkspaceAccess(req, graph.workspace_id)) return res.status(403).json({ error: 'Access denied' });
    db.prepare('DELETE FROM graphs WHERE id = ?').run(graph.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /graphs/:id error:', e.message);
    res.status(500).json({ error: 'Failed to delete graph' });
  }
});

export default router;
