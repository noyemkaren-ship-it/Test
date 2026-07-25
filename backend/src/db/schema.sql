PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'company',
  parent_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS graphs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  portfolio_id TEXT REFERENCES portfolios(id) ON DELETE SET NULL,
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
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
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
  tab TEXT,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  layer TEXT,
  actor_ids_json TEXT DEFAULT '[]',
  related_node_ids_json TEXT DEFAULT '[]',
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
  date TEXT
);

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT,
  start TEXT,
  end TEXT,
  work_item_ids_json TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS pipes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT,
  stages_json TEXT DEFAULT '[]',
  work_item_ids_json TEXT DEFAULT '[]'
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

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  graph_id TEXT REFERENCES graphs(id) ON DELETE SET NULL,
  session_id TEXT,
  message TEXT,
  answer TEXT,
  model TEXT,
  actor_id TEXT,
  role TEXT,
  selected_node_ids_json TEXT DEFAULT '[]',
  context_node_ids_json TEXT DEFAULT '[]',
  rag_chunk_ids_json TEXT DEFAULT '[]',
  ts INTEGER
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

CREATE INDEX IF NOT EXISTS idx_graphs_ws ON graphs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_graphs_visibility ON graphs(visibility);
CREATE INDEX IF NOT EXISTS idx_nodes_ws_tab ON nodes(workspace_id, tab);
CREATE INDEX IF NOT EXISTS idx_edges_ws_tab ON edges(workspace_id, tab);
CREATE INDEX IF NOT EXISTS idx_chunks_ws ON chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wi_ws ON work_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ratings_ws ON ratings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_role_bindings_ws ON role_bindings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_templates_ws ON templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_nodes_graph ON nodes(graph_id);
CREATE INDEX IF NOT EXISTS idx_edges_graph ON edges(graph_id);
CREATE INDEX IF NOT EXISTS idx_chunks_graph ON chunks(graph_id);
CREATE INDEX IF NOT EXISTS idx_ontology_graph ON ontology(graph_id);
CREATE INDEX IF NOT EXISTS idx_questions_graph ON questions(graph_id);
CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);
