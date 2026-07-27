import { randomUUID } from 'crypto';

export function ensureReviewMetadata(db) {
  const reviews = db.prepare('SELECT * FROM reviews').all();
  let repaired = 0;
  const insertScope = db.prepare(`INSERT INTO review_scopes
    (id,review_id,workspace_id,project_id,artifact_id,object_id,version) VALUES (?,?,?,?,?,?,?)`);
  const insertHistory = db.prepare(`INSERT INTO review_history
    (id,review_id,actor_id,event,from_status,to_status,payload_json,created_at)
    VALUES (?,?,?,'created',NULL,?,'{}',COALESCE(?,datetime('now')))`);
  db.transaction(() => {
    for (const review of reviews) {
      const normalizedStatus = review.status === 'accepted' ? 'approved' : (review.status || 'open');
      if (normalizedStatus !== review.status) db.prepare('UPDATE reviews SET status=? WHERE id=?').run(normalizedStatus, review.id);
      if (!db.prepare('SELECT 1 FROM review_scopes WHERE review_id=? LIMIT 1').get(review.id)) {
        let scope = {};
        try { scope = JSON.parse(review.scope_json || '{}'); } catch { scope = {}; }
        insertScope.run(randomUUID(), review.id, review.workspace_id, scope.projectId || null, scope.artifactId || null, scope.objectId || scope.artifactId || null, scope.version || null);
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
