import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('SQLite schema and all versioned migrations are applied', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-platform-migrations-'));
  process.env.SQLITE_PATH = path.join(directory, 'schema.sqlite');
  const { getDb, closeDb } = await import('../src/db/database.js');
  const db = getDb();
  try {
    const versions = db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all();
    assert.deepEqual(versions.map(row => row.version), [1, 2, 3, 4, 5, 6, 7]);
    const requiredTables = [
      'nodes', 'edges', 'node_types', 'edge_types', 'actors', 'workspaces', 'portfolios', 'programs',
      'projects', 'graphs', 'issues', 'work_items', 'changes', 'reviews', 'review_scopes', 'review_history',
      'review_votes', 'sprints', 'pipes', 'releases', 'conversations', 'questions', 'answers',
      'reasoning_steps', 'decisions', 'self_host_sources'
    ];
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of requiredTables) assert.ok(tables.has(table), `${table} must exist`);
    const workColumns = new Set(db.prepare('PRAGMA table_info(work_items)').all().map(row => row.name));
    for (const column of ['issue_id', 'change_id', 'estimated_hours', 'required_specialists_json', 'budget', 'deadline', 'critical_path', 'risk_level']) {
      assert.ok(workColumns.has(column), `work_items.${column} must exist`);
    }
    const questionColumns = new Set(db.prepare('PRAGMA table_info(questions)').all().map(row => row.name));
    for (const column of ['conversation_id', 'intent', 'actor_id', 'role', 'tab', 'diagram', 'cost', 'total_tokens', 'latency_ms', 'feedback']) {
      assert.ok(questionColumns.has(column), `questions.${column} must exist`);
    }
    const edgeForeignKeys = new Set(db.prepare('PRAGMA foreign_key_list(edges)').all().map(row => row.from));
    assert.ok(edgeForeignKeys.has('source') && edgeForeignKeys.has('target'));
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    closeDb();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
