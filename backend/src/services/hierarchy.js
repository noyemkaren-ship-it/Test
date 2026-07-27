import { randomUUID } from 'crypto';

export function ensureWorkspaceProject(db, workspaceId, projectName = 'Graph Project', requestedProjectId = null) {
  if (requestedProjectId) {
    const project = db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=?').get(String(requestedProjectId), workspaceId);
    if (!project) throw new Error('projectId does not belong to this workspace');
    return project.id;
  }

  let portfolio = db.prepare("SELECT id FROM portfolios WHERE workspace_id=? AND name='Default Portfolio' LIMIT 1").get(workspaceId);
  if (!portfolio) {
    portfolio = { id: randomUUID() };
    db.prepare("INSERT INTO portfolios (id,workspace_id,name) VALUES (?,?,'Default Portfolio')").run(portfolio.id, workspaceId);
  }
  let program = db.prepare("SELECT id FROM programs WHERE workspace_id=? AND portfolio_id=? AND name='Default Program' LIMIT 1").get(workspaceId, portfolio.id);
  if (!program) {
    program = { id: randomUUID() };
    db.prepare("INSERT INTO programs (id,workspace_id,portfolio_id,name,description,status) VALUES (?,?,?,'Default Program','Automatic hierarchy root','active')")
      .run(program.id, workspaceId, portfolio.id);
  }
  const projectId = randomUUID();
  db.prepare('INSERT INTO projects (id,workspace_id,portfolio_id,program_id,name) VALUES (?,?,?,?,?)')
    .run(projectId, workspaceId, portfolio.id, program.id, String(projectName || 'Graph Project').slice(0, 160));
  return projectId;
}

export function ensureAllGraphHierarchy(db) {
  const graphs = db.prepare('SELECT id,workspace_id,name FROM graphs WHERE project_id IS NULL').all();
  const update = db.prepare('UPDATE graphs SET project_id=? WHERE id=?');
  for (const graph of graphs) update.run(ensureWorkspaceProject(db, graph.workspace_id, graph.name), graph.id);
  return graphs.length;
}
