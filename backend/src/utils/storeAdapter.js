import { getDb, jparse } from './helper.js';

export function createStoreAdapter(workspaceId, { graphId = null, publicOnly = false } = {}) {
  const db = getDb();

  function scope(tableAlias = '') {
    const p = tableAlias ? `${tableAlias}.` : '';
    const clauses = [`${p}workspace_id = ?`];
    const params = [workspaceId];
    if (graphId) {
      clauses.push(`${p}graph_id = ?`);
      params.push(graphId);
    } else if (publicOnly) {
      clauses.push(`${p}graph_id IN (SELECT id FROM graphs WHERE COALESCE(visibility, 'public') = 'public')`);
    }
    return { where: clauses.join(' AND '), params };
  }

  const nodeScope = scope();
  const edgeScope = scope();
  const wiScope = scope();
  const reviewScope = scope();

  return {
    getNodes: () => db.prepare(`SELECT * FROM nodes WHERE ${nodeScope.where}`).all(...nodeScope.params).map(n => ({
      id: n.id, label: n.label, kind: n.kind, layer: n.layer, tab: n.tab,
      nodeKind: n.node_kind, description: n.description, graphId: n.graph_id
    })),

    getEdges: () => db.prepare(`SELECT * FROM edges WHERE ${edgeScope.where}`).all(...edgeScope.params),

    getNode: (id) => {
      const n = db.prepare(`SELECT * FROM nodes WHERE id = ? AND ${nodeScope.where}`).get(id, ...nodeScope.params);
      return n ? { id: n.id, label: n.label, kind: n.kind, layer: n.layer, tab: n.tab, description: n.description, graphId: n.graph_id } : null;
    },

    getWorkItems: () => db.prepare(`SELECT * FROM work_items WHERE ${wiScope.where}`).all(...wiScope.params).map(w => ({
      id: w.id, type: w.type, title: w.title, status: w.status, layer: w.layer,
      relatedNodeIds: jparse(w.related_node_ids_json, []), actorIds: jparse(w.actor_ids_json, []), graphId: w.graph_id
    })),

    getReviews: () => db.prepare(`SELECT * FROM reviews WHERE ${reviewScope.where}`).all(...reviewScope.params).map(r => ({
      id: r.id, scope: jparse(r.scope_json, {}), text: r.text, graphId: r.graph_id
    })),

    getNeighbors(nodeId) {
      const related = new Set([nodeId]);
      for (const e of this.getEdges()) {
        if (e.source === nodeId) related.add(e.target);
        if (e.target === nodeId) related.add(e.source);
      }
      return [...related];
    },

    computeInterestScope(aid) {
      const actor = db.prepare('SELECT * FROM actors WHERE id = ? AND workspace_id = ?').get(aid, workspaceId);
      if (!actor) return { actorId: aid, nodeIds: [], workItemIds: [], roles: [] };
      const wis = this.getWorkItems().filter(w => w.actorIds.includes(aid));
      const nodeIds = new Set();
      wis.forEach(w => w.relatedNodeIds.forEach(id => nodeIds.add(id)));
      [...nodeIds].forEach(id => this.getNeighbors(id).forEach(n => nodeIds.add(n)));
      return { actorId: aid, nodeIds: [...nodeIds], workItemIds: wis.map(w => w.id), roles: jparse(actor.roles_json, []) };
    },

    getSubgraph(ids) {
      const set = new Set(ids);
      return {
        nodes: this.getNodes().filter(n => set.has(n.id)),
        edges: this.getEdges().filter(e => set.has(e.source) && set.has(e.target))
      };
    }
  };
}
