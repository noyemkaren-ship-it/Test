import { Router } from 'express';
import { getDb, jparse } from '../utils/helper.js';

const router = Router();

function publicGraphSelect(extra = '') {
  return `
    SELECT g.id, g.name, g.slug, g.description, g.visibility, g.created_at, g.updated_at,
           COUNT(DISTINCT n.id) AS node_count,
           COUNT(DISTINCT e.id) AS edge_count
    FROM graphs g
    LEFT JOIN nodes n ON n.graph_id = g.id
    LEFT JOIN edges e ON e.graph_id = g.id
    WHERE COALESCE(g.visibility, 'public') = 'public' ${extra}
  `;
}

router.get('/public/domains', (_req, res) => {
  try {
    const rows = getDb().prepare(`${publicGraphSelect()} GROUP BY g.id ORDER BY g.name COLLATE NOCASE`).all();
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json(rows.map(g => ({
      id: g.id,
      slug: g.slug,
      name: g.name,
      description: g.description || '',
      visibility: 'public',
      stats: { nodes: g.node_count || 0, edges: g.edge_count || 0 },
      createdAt: g.created_at,
      updatedAt: g.updated_at || g.created_at
    })));
  } catch (e) {
    console.error('GET /public/domains error:', e.message);
    res.status(500).json({ error: 'Failed to load public domains' });
  }
});

router.get('/public/domains/:slug', (req, res) => {
  try {
    const row = getDb().prepare(`${publicGraphSelect('AND g.slug = ?')} GROUP BY g.id LIMIT 1`).get(req.params.slug);
    if (!row) return res.status(404).json({ error: 'Domain not found' });
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description || '',
      visibility: 'public',
      stats: { nodes: row.node_count || 0, edges: row.edge_count || 0 }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load domain' });
  }
});

router.get('/public/domains/:slug/graph', (req, res) => {
  try {
    const db = getDb();
    const graph = db.prepare("SELECT id, name, slug, description FROM graphs WHERE slug = ? AND COALESCE(visibility, 'public') = 'public' LIMIT 1").get(req.params.slug);
    if (!graph) return res.status(404).json({ error: 'Domain not found' });
    const tab = String(req.query.tab || 'tobe');
    const nodes = db.prepare(`
      SELECT id, tab, label, kind, layer, node_kind, description, badge, data_json
      FROM nodes WHERE graph_id = ? AND (? = '' OR tab = ?)
    `).all(graph.id, tab, tab).map(n => ({
      id: n.id,
      tab: n.tab,
      label: n.label,
      kind: n.kind,
      layer: n.layer,
      nodeKind: n.node_kind,
      description: n.description,
      badge: n.badge,
      data: jparse(n.data_json, {})
    }));
    const edges = db.prepare(`
      SELECT id, tab, source, target, label FROM edges
      WHERE graph_id = ? AND (? = '' OR tab = ?)
    `).all(graph.id, tab, tab);
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    res.json({ graph, tab, nodes, edges });
  } catch (e) {
    console.error('GET public graph error:', e.message);
    res.status(500).json({ error: 'Failed to load public graph' });
  }
});

export default router;
