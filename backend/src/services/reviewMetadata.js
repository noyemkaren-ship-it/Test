import { randomUUID } from 'crypto';

export function ensureReviewMetadata(db) {
  const reviews = db.prepare('SELECT * FROM reviews').all();
  let repaired = 0;
  const insertScope = db.prepare(`INSERT INTO review_scopes
    (id,review_id,workspace_id,project_id,epic_id,feature_id,artifact_id,version_id,fragment_id,object_id,version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertHistory = db.prepare(`INSERT INTO review_history
    (id,review_id,actor_id,event,from_status,to_status,payload_json,created_at)
    VALUES (?,?,?,'created',NULL,?,'{}',COALESCE(?,datetime('now')))`);
  db.transaction(() => {
    for (const review of reviews) {
      const normalizedStatus = review.status === 'accepted' ? 'approved' : (review.status || 'open');
      if (normalizedStatus !== review.status) db.prepare('UPDATE reviews SET status=? WHERE id=?').run(normalizedStatus, review.id);
      let scope = {};
      try { scope = JSON.parse(review.scope_json || '{}'); } catch { scope = {}; }
      const project = db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=?').get(scope.projectId, review.workspace_id)
        || db.prepare('SELECT id FROM projects WHERE workspace_id=? ORDER BY created_at LIMIT 1').get(review.workspace_id);
      const currentScope = db.prepare('SELECT * FROM review_scopes WHERE review_id=? LIMIT 1').get(review.id);
      if (project && (!currentScope || !currentScope.fragment_id)) {
        const epicId = `review-epic:${review.id}`;
        const featureId = `review-feature:${review.id}`;
        const artifactId = `review-artifact:${review.id}`;
        const versionId = `review-version:${review.id}`;
        const fragmentId = `review-fragment:${review.id}`;
        const sourceNodeId = db.prepare('SELECT id FROM nodes WHERE id=? AND workspace_id=?').get(scope.artifactId || scope.objectId, review.workspace_id)?.id || null;
        db.prepare('INSERT OR IGNORE INTO epics (id,workspace_id,project_id,graph_id,name,status) VALUES (?,?,?,?,?,?)')
          .run(epicId, review.workspace_id, project.id, review.graph_id || null, `Review #${review.n || review.id}`, 'active');
        db.prepare('INSERT OR IGNORE INTO features (id,workspace_id,project_id,epic_id,graph_id,name,status) VALUES (?,?,?,?,?,?,?)')
          .run(featureId, review.workspace_id, project.id, epicId, review.graph_id || null, 'Review subject', 'active');
        db.prepare('INSERT OR IGNORE INTO artifacts (id,workspace_id,project_id,feature_id,graph_id,node_id,name,type) VALUES (?,?,?,?,?,?,?,?)')
          .run(artifactId, review.workspace_id, project.id, featureId, review.graph_id || null, sourceNodeId, scope.artifactId || scope.objectId || 'Review artifact', 'graph-object');
        db.prepare('INSERT OR IGNORE INTO artifact_versions (id,artifact_id,version,status) VALUES (?,?,?,?)')
          .run(versionId, artifactId, scope.version || 'current', normalizedStatus === 'approved' ? 'approved' : 'review');
        db.prepare('INSERT OR IGNORE INTO fragments (id,artifact_version_id,node_id,label,selector_json) VALUES (?,?,?,?,?)')
          .run(fragmentId, versionId, sourceNodeId, 'Whole object', '{}');
        if (currentScope) {
          db.prepare(`UPDATE review_scopes SET project_id=?,epic_id=?,feature_id=?,artifact_id=?,version_id=?,fragment_id=?,object_id=?,version=? WHERE id=?`)
            .run(project.id, epicId, featureId, artifactId, versionId, fragmentId, scope.objectId || sourceNodeId, scope.version || 'current', currentScope.id);
        } else {
          insertScope.run(randomUUID(), review.id, review.workspace_id, project.id, epicId, featureId, artifactId, versionId, fragmentId, scope.objectId || sourceNodeId, scope.version || 'current');
        }
        repaired++;
      }
      if (!db.prepare('SELECT 1 FROM review_history WHERE review_id=? LIMIT 1').get(review.id)) {
        insertHistory.run(randomUUID(), review.id, review.author_id || null, normalizedStatus, review.date || null);
        repaired++;
      }
    }
  })();
  return repaired;
}
