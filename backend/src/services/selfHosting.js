import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { DEFAULT_PROFILE } from '../engines/ontology.js';
import { ensureWorkspaceProject } from './hierarchy.js';
import { materializeOntologyTypes } from './ontologyTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '../../..');
const ALLOWED_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx', '.css', '.sql', '.md', '.txt', '.json', '.yml', '.yaml', '.py']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'data', '.git', '.vite', 'coverage']);
const MAX_FILES = 400;
let state = { running: false, graphId: null, root: null, files: 0, changed: 0, lastSyncAt: null, error: null };
let timer = null;

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableNodeId(relativePath) {
  return `self-file-${hash(relativePath).slice(0, 24)}`;
}

function collectFiles(root) {
  const output = [];
  const roots = ['README.md', 'AUDIT.md', 'Graph_Platform_Audit_Report.txt', 'package.json', 'backend/package.json', 'frontend/package.json', 'backend/src', 'frontend/src', 'test'];
  function visit(target) {
    if (output.length >= MAX_FILES || !fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
        visit(path.join(target, entry.name));
        if (output.length >= MAX_FILES) break;
      }
      return;
    }
    if (!ALLOWED_EXTENSIONS.has(path.extname(target).toLowerCase())) return;
    if (stat.size > 512_000) return;
    output.push(target);
  }
  for (const item of roots) visit(path.join(root, item));
  return [...new Set(output)].sort();
}

function categoryFor(relativePath) {
  if (/schema|migration|database/i.test(relativePath)) return 'architecture';
  if (/test|smoke|audit/i.test(relativePath)) return 'change';
  if (/\.md$|\.txt$/i.test(relativePath)) return 'documentation';
  return 'component';
}

function ensureSelfGraph(db) {
  const existing = db.prepare("SELECT id FROM graphs WHERE slug='graph-platform-self' LIMIT 1").get();
  if (existing) return existing.id;
  const graphId = randomUUID();
  const projectId = ensureWorkspaceProject(db, 'ws-default', 'Graph Platform Self-hosting');
  db.prepare(`INSERT INTO graphs
    (id,workspace_id,project_id,name,slug,description,visibility,settings_json)
    VALUES (?,'ws-default',?,'Graph Platform — Self-hosting','graph-platform-self',
      'Автоматически синхронизируемая карта компонентов, документации, изменений и архитектурных решений','public',?)`)
    .run(graphId, projectId, JSON.stringify({ builtIn: true, selfHosting: true, autoSync: true }));
  db.prepare('INSERT OR REPLACE INTO ontology (workspace_id,graph_id,profile_json) VALUES (?,?,?)')
    .run('ws-default', graphId, JSON.stringify(DEFAULT_PROFILE));
  materializeOntologyTypes(db, 'ws-default', graphId, DEFAULT_PROFILE);
  return graphId;
}

function ensureBaseNodes(db, graphId) {
  const nodes = [
    ['self-platform-root', 'Graph Platform', 'core', 'Implementation', 0, 0],
    ['self-category-architecture', 'Architecture Decisions', 'domain', 'Knowledge', 360, -240],
    ['self-category-change', 'Changes & Verification', 'domain', 'Project', 360, 0],
    ['self-category-component', 'Components', 'service', 'Implementation', 360, 240],
    ['self-category-documentation', 'Documentation', 'note', 'Knowledge', 360, 480]
  ];
  const insertNode = db.prepare(`INSERT OR IGNORE INTO nodes
    (id,workspace_id,project_id,graph_id,tab,label,kind,layer,node_kind,description,data_json)
    VALUES (?,'ws-default',(SELECT project_id FROM graphs WHERE id=?),?,'tobe',?,?,?,?,?,?)`);
  const insertEdge = db.prepare(`INSERT OR IGNORE INTO edges
    (id,workspace_id,graph_id,tab,source,target,label) VALUES (?,'ws-default',?,'tobe',?,?,?)`);
  for (const [id, label, kind, layer, x, y] of nodes) {
    insertNode.run(id, graphId, graphId, label, kind, layer, kind, 'Managed by Self-hosting Engine', JSON.stringify({ position: { x, y }, managed: true }));
    if (id !== 'self-platform-root') insertEdge.run(`edge-self-${id}`, graphId, 'self-platform-root', id, 'contains');
  }
}

export function syncSelfHosting(db, root = process.env.SELF_HOST_ROOT || DEFAULT_ROOT) {
  if (state.running) return state;
  state = { ...state, running: true, root, error: null, changed: 0 };
  try {
    if (!db.prepare("SELECT 1 FROM workspaces WHERE id='ws-default'").get()) return { ...state, running: false };
    const graphId = ensureSelfGraph(db);
    const files = collectFiles(root);
    let changed = 0;
    db.transaction(() => {
      ensureBaseNodes(db, graphId);
      const current = new Map(db.prepare('SELECT * FROM self_host_sources WHERE graph_id=?').all(graphId).map(row => [row.path, row]));
      const seen = new Set();
      const upsertSource = db.prepare(`INSERT INTO self_host_sources
        (id,workspace_id,graph_id,path,kind,content_hash,node_id,last_synced_at)
        VALUES (?,'ws-default',?,?,?,?,?,datetime('now'))
        ON CONFLICT(graph_id,path) DO UPDATE SET kind=excluded.kind,content_hash=excluded.content_hash,node_id=excluded.node_id,last_synced_at=datetime('now')`);
      const upsertNode = db.prepare(`INSERT INTO nodes
        (id,workspace_id,project_id,graph_id,tab,label,kind,layer,node_kind,description,data_json)
        VALUES (?,'ws-default',(SELECT project_id FROM graphs WHERE id=?),?,'tobe',?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET label=excluded.label,kind=excluded.kind,layer=excluded.layer,node_kind=excluded.node_kind,description=excluded.description,data_json=excluded.data_json`);
      const upsertEdge = db.prepare(`INSERT INTO edges
        (id,workspace_id,graph_id,tab,source,target,label) VALUES (?,'ws-default',?,'tobe',?,?,?)
        ON CONFLICT(id) DO UPDATE SET source=excluded.source,target=excluded.target,label=excluded.label`);
      files.forEach((absolutePath, index) => {
        const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
        const content = fs.readFileSync(absolutePath);
        const contentHash = hash(content);
        const kind = categoryFor(relativePath);
        const nodeId = stableNodeId(relativePath);
        const previous = current.get(relativePath);
        if (!previous || previous.content_hash !== contentHash) changed++;
        seen.add(relativePath);
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = 760 + column * 340;
        const y = -360 + row * 280;
        upsertNode.run(nodeId, graphId, graphId, path.basename(relativePath), kind, kind === 'component' ? 'Implementation' : kind === 'change' ? 'Project' : 'Knowledge', kind === 'component' ? 'service' : 'note', `${relativePath}\nSHA-256: ${contentHash}\nAutomatically synchronized`, JSON.stringify({ position: { x, y }, managed: true, path: relativePath, hash: contentHash }));
        upsertEdge.run(`self-edge-${hash(relativePath).slice(0, 24)}`, graphId, `self-category-${kind}`, nodeId, 'tracks');
        upsertSource.run(previous?.id || randomUUID(), graphId, relativePath, kind, contentHash, nodeId);
      });
      for (const [relativePath, source] of current) {
        if (seen.has(relativePath)) continue;
        db.prepare('DELETE FROM self_host_sources WHERE id=?').run(source.id);
        if (source.node_id) db.prepare('DELETE FROM nodes WHERE id=? AND graph_id=?').run(source.node_id, graphId);
        changed++;
      }
      db.prepare("UPDATE graphs SET updated_at=datetime('now') WHERE id=?").run(graphId);
    })();
    state = { running: false, graphId, root, files: files.length, changed, lastSyncAt: new Date().toISOString(), error: null };
  } catch (error) {
    state = { ...state, running: false, error: error.message, lastSyncAt: new Date().toISOString() };
  }
  return state;
}

export function startSelfHosting(db) {
  syncSelfHosting(db);
  const interval = Math.max(5000, Number(process.env.SELF_HOST_SYNC_INTERVAL_MS || 15000));
  if (!timer && process.env.SELF_HOST_WATCH !== '0') {
    timer = setInterval(() => syncSelfHosting(db), interval);
    timer.unref?.();
  }
  return state;
}

export function getSelfHostingStatus() {
  return { ...state, intervalMs: Math.max(5000, Number(process.env.SELF_HOST_SYNC_INTERVAL_MS || 15000)), automatic: process.env.SELF_HOST_WATCH !== '0' };
}
