import { randomUUID } from 'crypto';

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function addColumn(db, table, definition) {
  const column = definition.trim().split(/\s+/)[0];
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

const migrations = [
  {
    version: 1,
    name: 'legacy-v3-graph-scoping',
    up(db) {
      const columns = [
        ['projects', 'template_id TEXT'],
        ['projects', 'template_version INTEGER'],
        ['graphs', "settings_json TEXT DEFAULT '{}'"],
        ['graphs', "visibility TEXT DEFAULT 'public'"],
        ['graphs', 'updated_at TEXT'],
        ['nodes', 'graph_id TEXT REFERENCES graphs(id)'],
        ['edges', 'graph_id TEXT REFERENCES graphs(id)'],
        ['actors', 'graph_id TEXT REFERENCES graphs(id)'],
        ['work_items', 'graph_id TEXT REFERENCES graphs(id)'],
        ['reviews', 'graph_id TEXT REFERENCES graphs(id)'],
        ['documents', 'graph_id TEXT REFERENCES graphs(id)'],
        ['chunks', 'graph_id TEXT REFERENCES graphs(id)'],
        ['ontology', 'graph_id TEXT REFERENCES graphs(id)'],
        ['role_bindings', 'graph_id TEXT REFERENCES graphs(id)'],
        ['questions', 'graph_id TEXT REFERENCES graphs(id)'],
        ['questions', 'session_id TEXT'],
        ['templates', 'graph_id TEXT REFERENCES graphs(id)']
      ];
      for (const [table, definition] of columns) addColumn(db, table, definition);

      db.exec("UPDATE graphs SET visibility = 'public' WHERE visibility IS NULL OR visibility = ''");
      db.exec("UPDATE graphs SET updated_at = COALESCE(updated_at, created_at, datetime('now'))");
      db.exec("UPDATE work_items SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND project_id='prj-bank'");
      db.exec("UPDATE work_items SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND project_id='prj-law'");
      db.exec("UPDATE documents SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND project_id='prj-bank'");
      db.exec("UPDATE documents SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND project_id='prj-law'");
      db.exec('UPDATE chunks SET graph_id = (SELECT graph_id FROM documents WHERE documents.id = chunks.document_id) WHERE graph_id IS NULL');
      db.exec("UPDATE actors SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND id IN ('act-lawyer','act-partner','act-paralegal','act-legal-ai','act-court-sys')");
      db.exec("UPDATE actors SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND workspace_id='ws-default' AND id NOT IN ('act-lawyer','act-partner','act-paralegal','act-legal-ai','act-court-sys')");
      db.exec("UPDATE reviews SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND scope_json LIKE '%prj-bank%'");
      db.exec("UPDATE reviews SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND scope_json LIKE '%prj-law%'");
      db.exec('UPDATE role_bindings SET graph_id = (SELECT graph_id FROM nodes WHERE nodes.id = role_bindings.object_id) WHERE graph_id IS NULL AND object_id IN (SELECT id FROM nodes)');
      db.exec("UPDATE role_bindings SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND object_id='prj-bank'");
      db.exec("UPDATE role_bindings SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND object_id='prj-law'");
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_graphs_slug_unique ON graphs(slug)');
    }
  },
  {
    version: 2,
    name: 'requirements-completion-sqlite',
    up(db) {
      const columns = [
        ['graphs', 'project_id TEXT REFERENCES projects(id)'],
        ['projects', 'program_id TEXT REFERENCES programs(id)'],
        ['nodes', 'node_type_id TEXT'],
        ['edges', 'edge_type_id TEXT'],
        ['work_items', 'issue_id TEXT REFERENCES issues(id)'],
        ['work_items', 'change_id TEXT REFERENCES changes(id)'],
        ['work_items', 'pipe_id TEXT REFERENCES pipes(id)'],
        ['work_items', 'release_id TEXT REFERENCES releases(id)'],
        ['work_items', 'estimated_hours REAL NOT NULL DEFAULT 0'],
        ['work_items', "required_specialists_json TEXT NOT NULL DEFAULT '[]'"],
        ['work_items', 'budget REAL NOT NULL DEFAULT 0'],
        ['work_items', 'deadline TEXT'],
        ['work_items', 'critical_path INTEGER NOT NULL DEFAULT 0'],
        ['work_items', "risk_level TEXT NOT NULL DEFAULT 'medium'"],
        ['reviews', 'executor_id TEXT'],
        ['reviews', 'updated_at TEXT'],
        ['questions', 'conversation_id TEXT REFERENCES conversations(id)'],
        ['questions', 'provider TEXT'],
        ['questions', 'cost REAL NOT NULL DEFAULT 0'],
        ['questions', 'prompt_tokens INTEGER NOT NULL DEFAULT 0'],
        ['questions', 'completion_tokens INTEGER NOT NULL DEFAULT 0'],
        ['questions', 'total_tokens INTEGER NOT NULL DEFAULT 0'],
        ['questions', 'latency_ms INTEGER NOT NULL DEFAULT 0'],
        ['questions', 'feedback TEXT'],
        ['questions', 'diagram TEXT']
      ];
      for (const [table, definition] of columns) addColumn(db, table, definition);

      db.exec('CREATE INDEX IF NOT EXISTS idx_graphs_project ON graphs(project_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_work_items_issue ON work_items(issue_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_work_items_change ON work_items(change_id)');
      db.exec("UPDATE graphs SET project_id = (SELECT MIN(project_id) FROM nodes WHERE nodes.graph_id = graphs.id AND project_id IS NOT NULL) WHERE project_id IS NULL");
      db.exec("UPDATE reviews SET updated_at = COALESCE(updated_at, date, datetime('now'))");

      const reviews = db.prepare('SELECT id, workspace_id, scope_json, author_id, status, date FROM reviews').all();
      const insertScope = db.prepare(`INSERT OR IGNORE INTO review_scopes
        (id, review_id, workspace_id, project_id, artifact_id, object_id, version) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const insertHistory = db.prepare(`INSERT OR IGNORE INTO review_history
        (id, review_id, actor_id, event, from_status, to_status, payload_json, created_at)
        VALUES (?, ?, ?, 'created', NULL, ?, '{}', COALESCE(?, datetime('now')))`);
      for (const review of reviews) {
        let scope = {};
        try { scope = JSON.parse(review.scope_json || '{}'); } catch { scope = {}; }
        insertScope.run(`scope-${review.id}`, review.id, review.workspace_id, scope.projectId || null, scope.artifactId || null, scope.objectId || scope.artifactId || null, scope.version || null);
        insertHistory.run(`history-${review.id}`, review.id, review.author_id || null, review.status || 'open', review.date || null);
      }

      const questions = db.prepare('SELECT * FROM questions ORDER BY ts').all();
      const conversations = new Map();
      const insertConversation = db.prepare(`INSERT OR IGNORE INTO conversations
        (id, workspace_id, graph_id, session_id, title, actor_id, role) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const insertAnswer = db.prepare(`INSERT OR IGNORE INTO answers
        (id, conversation_id, question_id, workspace_id, graph_id, text, model, sources_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`);
      for (const question of questions) {
        const key = `${question.workspace_id}:${question.graph_id || ''}:${question.session_id || question.id}`;
        let conversationId = conversations.get(key);
        if (!conversationId) {
          conversationId = randomUUID();
          conversations.set(key, conversationId);
          insertConversation.run(conversationId, question.workspace_id, question.graph_id || null, question.session_id || `legacy:${question.id}`, String(question.message || 'Graph Copilot').slice(0, 120), question.actor_id || null, question.role || null);
        }
        db.prepare('UPDATE questions SET conversation_id = ? WHERE id = ?').run(conversationId, question.id);
        insertAnswer.run(`answer-${question.id}`, conversationId, question.id, question.workspace_id, question.graph_id || null, question.answer || '', question.model || null);
      }
    }
  },
  {
    version: 3,
    name: 'issue-pipe-execution-links',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS issue_pipes (
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        pipe_id TEXT NOT NULL REFERENCES pipes(id) ON DELETE CASCADE,
        PRIMARY KEY (issue_id, pipe_id)
      )`);
    }
  },
  {
    version: 4,
    name: 'execution-object-scoping',
    up(db) {
      addColumn(db, 'sprints', 'project_id TEXT REFERENCES projects(id)');
      addColumn(db, 'sprints', 'graph_id TEXT REFERENCES graphs(id)');
      addColumn(db, 'sprints', "status TEXT NOT NULL DEFAULT 'planned'");
      addColumn(db, 'pipes', 'project_id TEXT REFERENCES projects(id)');
      addColumn(db, 'pipes', 'graph_id TEXT REFERENCES graphs(id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sprints_ws_graph ON sprints(workspace_id, graph_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_pipes_ws_graph ON pipes(workspace_id, graph_id)');
    }
  },
  {
    version: 5,
    name: 'copilot-question-semantics',
    up(db) {
      addColumn(db, 'questions', 'intent TEXT');
      addColumn(db, 'questions', 'tab TEXT');
    }
  },
  {
    version: 6,
    name: 'customer-owner-separation',
    up(db) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS trg_role_customer_owner_insert
        BEFORE INSERT ON role_bindings
        WHEN NEW.role IN ('Owner','Заказчик','Customer') AND EXISTS (
          SELECT 1 FROM role_bindings rb
          WHERE rb.workspace_id=NEW.workspace_id AND rb.actor_id=NEW.actor_id AND rb.object_id=NEW.object_id
            AND ((NEW.role='Owner' AND rb.role IN ('Заказчик','Customer')) OR (NEW.role IN ('Заказчик','Customer') AND rb.role='Owner'))
        )
        BEGIN SELECT RAISE(ABORT, 'Customer and Owner must be different actors'); END`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS trg_role_customer_owner_update
        BEFORE UPDATE OF role,actor_id,object_id ON role_bindings
        WHEN NEW.role IN ('Owner','Заказчик','Customer') AND EXISTS (
          SELECT 1 FROM role_bindings rb
          WHERE rb.id<>NEW.id AND rb.workspace_id=NEW.workspace_id AND rb.actor_id=NEW.actor_id AND rb.object_id=NEW.object_id
            AND ((NEW.role='Owner' AND rb.role IN ('Заказчик','Customer')) OR (NEW.role IN ('Заказчик','Customer') AND rb.role='Owner'))
        )
        BEGIN SELECT RAISE(ABORT, 'Customer and Owner must be different actors'); END`);
    }
  },
  {
    version: 7,
    name: 'edge-endpoint-foreign-keys',
    up(db) {
      const foreignKeys = db.prepare('PRAGMA foreign_key_list(edges)').all();
      if (foreignKeys.some(key => key.from === 'source') && foreignKeys.some(key => key.from === 'target')) return;
      db.exec('DROP INDEX IF EXISTS idx_edges_ws_tab');
      db.exec('DROP INDEX IF EXISTS idx_edges_graph');
      db.exec('ALTER TABLE edges RENAME TO edges_before_endpoint_fk');
      db.exec(`CREATE TABLE edges (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
        edge_type_id TEXT,
        tab TEXT,
        source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        label TEXT
      )`);
      db.exec(`INSERT INTO edges (id,workspace_id,graph_id,edge_type_id,tab,source,target,label)
        SELECT e.id,e.workspace_id,e.graph_id,e.edge_type_id,e.tab,e.source,e.target,e.label
        FROM edges_before_endpoint_fk e
        JOIN nodes source_node ON source_node.id=e.source
        JOIN nodes target_node ON target_node.id=e.target`);
      db.exec('DROP TABLE edges_before_endpoint_fk');
      db.exec('CREATE INDEX idx_edges_ws_tab ON edges(workspace_id,tab)');
      db.exec('CREATE INDEX idx_edges_graph ON edges(graph_id)');
    }
  },
  {
    version: 8,
    name: 'complete-review-scope-hierarchy',
    up(db) {
      addColumn(db, 'review_scopes', 'epic_id TEXT REFERENCES epics(id)');
      addColumn(db, 'review_scopes', 'feature_id TEXT REFERENCES features(id)');
      addColumn(db, 'review_scopes', 'version_id TEXT REFERENCES artifact_versions(id)');
      addColumn(db, 'review_scopes', 'fragment_id TEXT REFERENCES fragments(id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_review_hierarchy ON review_scopes(project_id,epic_id,feature_id,artifact_id,version_id,fragment_id)');
    }
  },
  {
    version: 9,
    name: 'coordinated-transformation-and-workspace-sharing',
    up(db) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_transformation_sets_project ON transformation_sets(workspace_id,project_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_workspace_resources_ws ON workspace_resources(workspace_id)');
    }
  },
  {
    version: 10,
    name: 'hierarchical-rbac-and-object-acl',
    up(db) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_rbac_assignments_user ON rbac_assignments(workspace_id,user_id,scope_type,scope_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_object_acl_object ON object_acl(workspace_id,object_type,object_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_security_audit_ws ON security_audit_log(workspace_id,created_at)');
    }
  }
];

export function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    })();
  }
}

export function listMigrations() {
  return migrations.map(({ version, name }) => ({ version, name }));
}
