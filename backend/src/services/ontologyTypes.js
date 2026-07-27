export function materializeOntologyTypes(db, workspaceId, graphId, profile) {
  if (!graphId || !profile) return { nodeTypes: 0, edgeTypes: 0 };
  const insertNodeType = db.prepare(`INSERT INTO node_types (id,workspace_id,graph_id,label,layer,config_json)
    VALUES (?,?,?,?,?,?) ON CONFLICT(graph_id,id) DO UPDATE SET label=excluded.label,layer=excluded.layer,config_json=excluded.config_json`);
  const insertEdgeType = db.prepare(`INSERT INTO edge_types (id,workspace_id,graph_id,label,config_json)
    VALUES (?,?,?,?,?) ON CONFLICT(graph_id,id) DO UPDATE SET label=excluded.label,config_json=excluded.config_json`);
  let nodeTypes = 0;
  let edgeTypes = 0;
  for (const type of Array.isArray(profile.nodeTypes) ? profile.nodeTypes : []) {
    if (!type?.id || !type?.label) continue;
    insertNodeType.run(String(type.id), workspaceId, graphId, String(type.label), String(type.layer || 'Knowledge'), JSON.stringify(type));
    nodeTypes++;
  }
  for (const type of Array.isArray(profile.edgeTypes) ? profile.edgeTypes : []) {
    if (!type?.id || !type?.label) continue;
    insertEdgeType.run(String(type.id), workspaceId, graphId, String(type.label), JSON.stringify(type));
    edgeTypes++;
  }
  return { nodeTypes, edgeTypes };
}

export function materializeAllOntologyTypes(db) {
  const rows = db.prepare('SELECT workspace_id,graph_id,profile_json FROM ontology WHERE graph_id IS NOT NULL').all();
  for (const row of rows) {
    let profile;
    try { profile = JSON.parse(row.profile_json); } catch { continue; }
    materializeOntologyTypes(db, row.workspace_id, row.graph_id, profile);
  }
  return rows.length;
}
