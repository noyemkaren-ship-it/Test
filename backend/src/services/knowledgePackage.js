import { randomUUID } from 'crypto';
import { DEFAULT_PROFILE } from '../engines/ontology.js';
import { jstr, slugify } from '../utils/helper.js';
import { ensureWorkspaceProject } from './hierarchy.js';
import { materializeOntologyTypes } from './ontologyTypes.js';

export const IMPORT_LIMITS = Object.freeze({ maxNodes: 5000, maxEdges: 10000, maxDataBytes: 20_000 });

export class KnowledgePackageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'KnowledgePackageError';
    this.status = status;
  }
}

const BLOCKED_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])х(?:у|y)[йиеяёю][\p{L}]*/iu,
  /(?:^|[^\p{L}\p{N}])п(?:и|1)зд[\p{L}]*/iu,
  /(?:^|[^\p{L}\p{N}])(?:е|ё)б(?:а|о|у|л)[\p{L}]*/iu,
  /(?:^|[^\p{L}\p{N}])бл(?:я|а)(?:д|т)[\p{L}]*/iu,
  /(?:^|[^\p{L}\p{N}])(?:сука|гандон)[\p{L}]*/iu,
  /(?:^|[^\p{L}\p{N}])(?:fuck|shit|cunt|nigg)[\p{L}]*/iu
];

const DANGEROUS_PATTERNS = [/<\s*script/iu, /javascript\s*:/iu, /on(?:error|load|click)\s*=/iu];
const SAFE_TABS = new Set(['asis', 'process', 'tobe', 'ai']);
const FORBIDDEN_DATA_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function compactText(value, fallback = '', max = 500) {
  if (value == null) return fallback;
  return String(value).trim().slice(0, max);
}

function normalizeForModeration(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[0@]/g, match => match === '0' ? 'о' : 'а')
    .replace(/[3]/g, 'з')
    .replace(/[_*~`'".\-]+/g, ' ');
}

function assertAllowedText(value, location) {
  const normalized = normalizeForModeration(value);
  if (DANGEROUS_PATTERNS.some(pattern => pattern.test(normalized))) {
    throw new KnowledgePackageError(`Опасная HTML/JavaScript-конструкция: ${location}`);
  }
  if (BLOCKED_PATTERNS.some(pattern => pattern.test(normalized))) {
    throw new KnowledgePackageError(`Нецензурное содержимое: ${location}`, 422);
  }
}

function sanitizeData(value, depth = 0) {
  if (depth > 6) throw new KnowledgePackageError('node.data is nested too deeply');
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 200).map(item => sanitizeData(item, depth + 1));
  if (typeof value !== 'object') return null;
  const output = {};
  for (const [key, nested] of Object.entries(value).slice(0, 200)) {
    if (FORBIDDEN_DATA_KEYS.has(key)) continue;
    output[String(key).slice(0, 100)] = sanitizeData(nested, depth + 1);
  }
  return output;
}

export function normalizeKnowledgePackage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new KnowledgePackageError('JSON должен содержать объект Knowledge Package');
  }
  assertAllowedText(JSON.stringify(raw), 'package');
  const graph = raw.graph && typeof raw.graph === 'object' && !Array.isArray(raw.graph) ? raw.graph : {};
  const nodes = raw.nodes;
  const edges = raw.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new KnowledgePackageError('В JSON обязательны массивы nodes и edges');
  }
  if (nodes.length === 0) throw new KnowledgePackageError('Граф должен содержать хотя бы один узел');
  if (nodes.length > IMPORT_LIMITS.maxNodes || edges.length > IMPORT_LIMITS.maxEdges) {
    throw new KnowledgePackageError('Knowledge Package превышает допустимый размер', 413);
  }

  const name = compactText(graph.name || raw.name, '', 180);
  if (name.length < 2) throw new KnowledgePackageError('Укажите название графа в graph.name или name');
  const description = compactText(graph.description ?? raw.description, '', 2000);
  assertAllowedText(name, 'graph.name');
  assertAllowedText(description, 'graph.description');

  const ids = new Set();
  const cleanNodes = nodes.map((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new KnowledgePackageError(`Некорректный узел: nodes[${index}]`);
    const sourceId = compactText(node.id, '', 240);
    const label = compactText(node.label, '', 300);
    if (!sourceId || !label) throw new KnowledgePackageError(`Для nodes[${index}] обязательны id и label`);
    if (ids.has(sourceId)) throw new KnowledgePackageError(`Повторяющийся node.id: ${sourceId}`);
    ids.add(sourceId);
    const descriptionText = compactText(node.description, '', 4000);
    assertAllowedText(label, `nodes[${index}].label`);
    assertAllowedText(descriptionText, `nodes[${index}].description`);
    const data = sanitizeData(node.data && typeof node.data === 'object' ? node.data : {});
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > IMPORT_LIMITS.maxDataBytes) {
      throw new KnowledgePackageError(`Слишком большой объект data: nodes[${index}]`);
    }
    return {
      sourceId,
      tab: SAFE_TABS.has(String(node.tab)) ? String(node.tab) : 'tobe',
      label,
      kind: compactText(node.kind, '', 120),
      layer: compactText(node.layer, 'Knowledge', 120) || 'Knowledge',
      nodeKind: compactText(node.nodeKind || node.node_kind, 'domain', 120) || 'domain',
      description: descriptionText,
      badge: node.badge == null ? null : compactText(node.badge, '', 80),
      data
    };
  });

  const cleanEdges = edges.map((edge, index) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) throw new KnowledgePackageError(`Некорректная связь: edges[${index}]`);
    const source = compactText(edge.source, '', 240);
    const target = compactText(edge.target, '', 240);
    if (!source || !target) throw new KnowledgePackageError(`Для edges[${index}] обязательны source и target`);
    if (source === target) throw new KnowledgePackageError(`Петля на одном узле запрещена: edges[${index}]`);
    if (!ids.has(source) || !ids.has(target)) throw new KnowledgePackageError(`Связь ссылается на отсутствующий узел: ${source} → ${target}`);
    const label = compactText(edge.label, '', 300);
    assertAllowedText(label, `edges[${index}].label`);
    return { source, target, label, tab: SAFE_TABS.has(String(edge.tab)) ? String(edge.tab) : 'tobe' };
  });

  const ontology = graph.ontology && typeof graph.ontology === 'object' && !Array.isArray(graph.ontology)
    ? sanitizeData(graph.ontology)
    : DEFAULT_PROFILE;
  return { name, description, nodes: cleanNodes, edges: cleanEdges, ontology };
}

export function importPrivateKnowledgePackage(db, workspaceId, raw, { sourceFileName = '' } = {}) {
  const pkg = normalizeKnowledgePackage(raw);
  const graphId = randomUUID();
  let slug = slugify(pkg.name);
  const baseSlug = slug;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM graphs WHERE slug = ?').get(slug)) slug = `${baseSlug}-${suffix++}`;
  const nodeMap = new Map(pkg.nodes.map(node => [node.sourceId, randomUUID()]));
  const importedAt = new Date().toISOString();
  let projectId;

  const transaction = db.transaction(() => {
    projectId = ensureWorkspaceProject(db, workspaceId, pkg.name);
    db.prepare(`
      INSERT INTO graphs (id, workspace_id, project_id, name, slug, description, visibility, settings_json)
      VALUES (?, ?, ?, ?, ?, ?, 'private', ?)
    `).run(graphId, workspaceId, projectId, pkg.name, slug, pkg.description, jstr({ importedAt, sourceFileName: compactText(sourceFileName, '', 240), importMode: 'member-private' }));
    db.prepare('INSERT OR REPLACE INTO ontology (workspace_id, graph_id, profile_json) VALUES (?, ?, ?)')
      .run(workspaceId, graphId, jstr(pkg.ontology));
    materializeOntologyTypes(db, workspaceId, graphId, pkg.ontology);

    const insertNode = db.prepare(`
      INSERT INTO nodes
        (id, workspace_id, project_id, graph_id, tab, label, kind, layer, node_kind, description, badge, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const node of pkg.nodes) {
      insertNode.run(
        nodeMap.get(node.sourceId), workspaceId, projectId, graphId, node.tab, node.label, node.kind,
        node.layer, node.nodeKind, node.description, node.badge, jstr(node.data)
      );
    }

    const insertEdge = db.prepare(`
      INSERT INTO edges (id, workspace_id, graph_id, tab, source, target, label)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const edge of pkg.edges) {
      insertEdge.run(randomUUID(), workspaceId, graphId, edge.tab, nodeMap.get(edge.source), nodeMap.get(edge.target), edge.label);
    }
  });
  transaction();

  return {
    ok: true,
    graph: { id: graphId, workspaceId, projectId, name: pkg.name, slug, description: pkg.description, visibility: 'private', canEdit: true },
    nodes: pkg.nodes.length,
    edges: pkg.edges.length,
    moderation: 'passed'
  };
}
