export function normalizePosition(position) {
  if (!position || typeof position !== 'object') return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) return null;
  return { x, y };
}

export function relationEndpointsBelongToGraph(db, { workspaceId, graphId, source, target }) {
  if (!source || !target || source === target) return false;
  const count = db.prepare(`SELECT COUNT(*) count FROM nodes
    WHERE workspace_id=? AND graph_id=? AND id IN (?,?)`).get(workspaceId, graphId, source, target)?.count || 0;
  return count === 2;
}
