import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'graph.db');

let _db;

function migrate(db) {
  const migrations = [
    "ALTER TABLE projects ADD COLUMN template_id TEXT",
    "ALTER TABLE projects ADD COLUMN template_version INTEGER",
    "ALTER TABLE graphs ADD COLUMN settings_json TEXT DEFAULT '{}'",
    "ALTER TABLE graphs ADD COLUMN visibility TEXT DEFAULT 'public'",
    "ALTER TABLE graphs ADD COLUMN updated_at TEXT",
    "ALTER TABLE nodes ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE edges ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE actors ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE work_items ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE reviews ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE documents ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE chunks ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE ontology ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE role_bindings ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE questions ADD COLUMN graph_id TEXT REFERENCES graphs(id)",
    "ALTER TABLE questions ADD COLUMN session_id TEXT",
    "ALTER TABLE templates ADD COLUMN graph_id TEXT REFERENCES graphs(id)"
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* already applied */ }
  }

  // Older demo databases can contain NULL visibility after a migration.
  try { db.exec("UPDATE graphs SET visibility = 'public' WHERE visibility IS NULL OR visibility = ''"); } catch {}
  try { db.exec("UPDATE graphs SET updated_at = COALESCE(updated_at, created_at, datetime('now'))"); } catch {}

  // Backfill graph ownership for databases created by pre-v3 demo seeds. Exact IDs are
  // intentionally used so customer data is never guessed into an arbitrary domain.
  try { db.exec("UPDATE work_items SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND project_id='prj-bank'"); } catch {}
  try { db.exec("UPDATE work_items SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND project_id='prj-law'"); } catch {}
  try { db.exec("UPDATE documents SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND project_id='prj-bank'"); } catch {}
  try { db.exec("UPDATE documents SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND project_id='prj-law'"); } catch {}
  try { db.exec("UPDATE chunks SET graph_id = (SELECT graph_id FROM documents WHERE documents.id = chunks.document_id) WHERE graph_id IS NULL"); } catch {}
  try { db.exec("UPDATE actors SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND id IN ('act-lawyer','act-partner','act-paralegal','act-legal-ai','act-court-sys')"); } catch {}
  try { db.exec("UPDATE actors SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND workspace_id='ws-default' AND id NOT IN ('act-lawyer','act-partner','act-paralegal','act-legal-ai','act-court-sys')"); } catch {}
  try { db.exec("UPDATE reviews SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND scope_json LIKE '%prj-bank%'"); } catch {}
  try { db.exec("UPDATE reviews SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND scope_json LIKE '%prj-law%'"); } catch {}
  try { db.exec("UPDATE role_bindings SET graph_id = (SELECT graph_id FROM nodes WHERE nodes.id = role_bindings.object_id) WHERE graph_id IS NULL AND object_id IN (SELECT id FROM nodes)"); } catch {}
  try { db.exec("UPDATE role_bindings SET graph_id = (SELECT id FROM graphs WHERE slug='bank' LIMIT 1) WHERE graph_id IS NULL AND object_id='prj-bank'"); } catch {}
  try { db.exec("UPDATE role_bindings SET graph_id = (SELECT id FROM graphs WHERE slug='law' LIMIT 1) WHERE graph_id IS NULL AND object_id='prj-law'"); } catch {}

  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_graphs_slug_unique ON graphs(slug)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_graphs_visibility ON graphs(visibility)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_questions_graph ON questions(graph_id)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_graph ON chunks(graph_id)'); } catch {}
}

export function getDb() {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  _db.exec(schema);
  migrate(_db);
  return _db;
}

export function setDb(db) {
  _db = db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}

export function jparse(s, fallback = null) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

export function jstr(v) {
  return JSON.stringify(v ?? null);
}
