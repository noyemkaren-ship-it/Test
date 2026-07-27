PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'company',
  parent_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS graphs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  portfolio_id TEXT REFERENCES portfolios(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  portfolio_id TEXT REFERENCES portfolios(id) ON DELETE SET NULL,
  program_id TEXT REFERENCES programs(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  template_id TEXT,
  template_version INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('Human','AIAgent','Service','ExternalSystem')),
  name TEXT NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS node_types (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  layer TEXT NOT NULL DEFAULT 'Knowledge',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (graph_id, id)
);

CREATE TABLE IF NOT EXISTS edge_types (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (graph_id, id)
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  node_type_id TEXT,
  tab TEXT,
  label TEXT NOT NULL,
  kind TEXT,
  layer TEXT,
  node_kind TEXT,
  description TEXT,
  badge TEXT,
  data_json TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  edge_type_id TEXT,
  tab TEXT,
  source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  label TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('Problem','Risk','Constraint','KnowledgeDefect')),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  severity TEXT NOT NULL DEFAULT 'medium',
  owner_actor_id TEXT REFERENCES actors(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  executor_actor_id TEXT REFERENCES actors(id) ON DELETE SET NULL,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  estimated_hours REAL NOT NULL DEFAULT 0,
  budget REAL NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS change_artifacts (
  change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  perspective TEXT NOT NULL CHECK(perspective IN ('form','indicator','sql','test','document','architecture','component')),
  PRIMARY KEY (change_id, node_id, perspective)
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  change_id TEXT REFERENCES changes(id) ON DELETE SET NULL,
  pipe_id TEXT REFERENCES pipes(id) ON DELETE SET NULL,
  release_id TEXT REFERENCES releases(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  layer TEXT,
  actor_ids_json TEXT DEFAULT '[]',
  related_node_ids_json TEXT DEFAULT '[]',
  estimated_hours REAL NOT NULL DEFAULT 0,
  required_specialists_json TEXT NOT NULL DEFAULT '[]',
  budget REAL NOT NULL DEFAULT 0,
  deadline TEXT,
  critical_path INTEGER NOT NULL DEFAULT 0 CHECK(critical_path IN (0,1)),
  risk_level TEXT NOT NULL DEFAULT 'medium',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  n INTEGER,
  scope_json TEXT,
  author_id TEXT,
  status TEXT,
  text TEXT,
  answer TEXT,
  date TEXT,
  executor_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_scopes (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  artifact_id TEXT,
  object_id TEXT,
  version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_history (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  actor_id TEXT,
  event TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_votes (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  vote TEXT NOT NULL CHECK(vote IN ('approve','reject','abstain')),
  comment TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(review_id, actor_id)
);

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  start TEXT,
  end TEXT,
  work_item_ids_json TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS pipes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  name TEXT,
  stages_json TEXT DEFAULT '[]',
  work_item_ids_json TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  target_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprint_pipes (
  sprint_id TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  pipe_id TEXT NOT NULL REFERENCES pipes(id) ON DELETE CASCADE,
  PRIMARY KEY (sprint_id, pipe_id)
);

CREATE TABLE IF NOT EXISTS sprint_work_items (
  sprint_id TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  PRIMARY KEY (sprint_id, work_item_id)
);

CREATE TABLE IF NOT EXISTS pipe_work_items (
  pipe_id TEXT NOT NULL REFERENCES pipes(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  stage TEXT,
  PRIMARY KEY (pipe_id, work_item_id)
);

CREATE TABLE IF NOT EXISTS issue_pipes (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  pipe_id TEXT NOT NULL REFERENCES pipes(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, pipe_id)
);

CREATE TABLE IF NOT EXISTS ontology (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT,
  profile_json TEXT NOT NULL,
  PRIMARY KEY (workspace_id, graph_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  length INTEGER,
  node_ids_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  idx INTEGER,
  text TEXT NOT NULL,
  tokens_json TEXT DEFAULT '[]',
  node_ids_json TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Graph Copilot conversation',
  actor_id TEXT,
  role TEXT,
  intent TEXT,
  tab TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, graph_id, session_id)
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  graph_id TEXT REFERENCES graphs(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  session_id TEXT,
  message TEXT,
  answer TEXT,
  model TEXT,
  actor_id TEXT,
  role TEXT,
  selected_node_ids_json TEXT DEFAULT '[]',
  context_node_ids_json TEXT DEFAULT '[]',
  rag_chunk_ids_json TEXT DEFAULT '[]',
  provider TEXT,
  cost REAL NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  feedback TEXT,
  diagram TEXT,
  ts INTEGER
);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  model TEXT,
  confidence REAL,
  sources_json TEXT NOT NULL DEFAULT '{}',
  feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reasoning_steps (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  question_id TEXT REFERENCES questions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'context',
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  answer_id TEXT REFERENCES answers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  rationale TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposed',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS self_host_sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(graph_id, path)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
  comment TEXT,
  page TEXT DEFAULT 'platform',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  role TEXT NOT NULL,
  UNIQUE(workspace_id, actor_id, object_id, role)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_project_id TEXT,
  snapshot_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS trg_role_customer_owner_insert
BEFORE INSERT ON role_bindings
WHEN NEW.role IN ('Owner','Заказчик','Customer') AND EXISTS (
  SELECT 1 FROM role_bindings rb
  WHERE rb.workspace_id=NEW.workspace_id AND rb.actor_id=NEW.actor_id AND rb.object_id=NEW.object_id
    AND ((NEW.role='Owner' AND rb.role IN ('Заказчик','Customer')) OR (NEW.role IN ('Заказчик','Customer') AND rb.role='Owner'))
)
BEGIN
  SELECT RAISE(ABORT, 'Customer and Owner must be different actors');
END;

CREATE TRIGGER IF NOT EXISTS trg_role_customer_owner_update
BEFORE UPDATE OF role,actor_id,object_id ON role_bindings
WHEN NEW.role IN ('Owner','Заказчик','Customer') AND EXISTS (
  SELECT 1 FROM role_bindings rb
  WHERE rb.id<>NEW.id AND rb.workspace_id=NEW.workspace_id AND rb.actor_id=NEW.actor_id AND rb.object_id=NEW.object_id
    AND ((NEW.role='Owner' AND rb.role IN ('Заказчик','Customer')) OR (NEW.role IN ('Заказчик','Customer') AND rb.role='Owner'))
)
BEGIN
  SELECT RAISE(ABORT, 'Customer and Owner must be different actors');
END;

CREATE INDEX IF NOT EXISTS idx_graphs_ws ON graphs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_graphs_visibility ON graphs(visibility);
CREATE INDEX IF NOT EXISTS idx_nodes_ws_tab ON nodes(workspace_id, tab);
CREATE INDEX IF NOT EXISTS idx_edges_ws_tab ON edges(workspace_id, tab);
CREATE INDEX IF NOT EXISTS idx_chunks_ws ON chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wi_ws ON work_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_issues_ws_graph ON issues(workspace_id, graph_id);
CREATE INDEX IF NOT EXISTS idx_changes_ws_graph ON changes(workspace_id, graph_id);
CREATE INDEX IF NOT EXISTS idx_programs_ws ON programs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_releases_ws ON releases(workspace_id);
CREATE INDEX IF NOT EXISTS idx_review_scopes_review ON review_scopes(review_id);
CREATE INDEX IF NOT EXISTS idx_review_history_review ON review_history(review_id);
CREATE INDEX IF NOT EXISTS idx_ratings_ws ON ratings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_role_bindings_ws ON role_bindings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_templates_ws ON templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_nodes_graph ON nodes(graph_id);
CREATE INDEX IF NOT EXISTS idx_edges_graph ON edges(graph_id);
CREATE INDEX IF NOT EXISTS idx_chunks_graph ON chunks(graph_id);
CREATE INDEX IF NOT EXISTS idx_ontology_graph ON ontology(graph_id);
CREATE INDEX IF NOT EXISTS idx_questions_graph ON questions(graph_id);
CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_ws_graph ON conversations(workspace_id, graph_id);
CREATE INDEX IF NOT EXISTS idx_answers_conversation ON answers(conversation_id);
CREATE INDEX IF NOT EXISTS idx_self_host_graph ON self_host_sources(graph_id);
