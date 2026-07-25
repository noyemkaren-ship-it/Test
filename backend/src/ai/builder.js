export function buildContext({ store, actorId, selectedNodeIds = [], role }) {
  let nodeIds = new Set(selectedNodeIds || []);
  if (actorId) {
    const scope = store.computeInterestScope(actorId);
    scope.nodeIds.forEach(id => nodeIds.add(id));
  }
  const ROLE_SEEDS = {
    econ: ['econ', 'cb', 'rep', 'ctrl', 'ods', 'ai', 'core'],
    aian: ['aian', 'ai', 'stand', 'valid', 'core'],
    mgmt: ['core', 'reg', 'ods', 'rep', 'ctrl', 'dom', 'proc', 'ai']
  };
  if (role && ROLE_SEEDS[role]) ROLE_SEEDS[role].forEach(id => nodeIds.add(id));
  nodeIds.add('core');
  const expanded = new Set(nodeIds);
  [...nodeIds].forEach(id => store.getNeighbors(id).forEach(n => expanded.add(n)));
  const subgraph = store.getSubgraph([...expanded]);
  const workItems = store.getWorkItems().filter(w => w.relatedNodeIds?.some(id => expanded.has(id)));
  const reviews = store.getReviews().filter(r => expanded.has(r.scope?.artifactId));
  return {
    nodeIds: [...expanded],
    nodes: subgraph.nodes,
    edges: subgraph.edges,
    workItems,
    reviews,
    actorId: actorId || null,
    role: role || null
  };
}
