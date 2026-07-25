import { getDb, jstr } from './database.js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DEFAULT_PROFILE } from '../engines/ontology.js';

function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

function chunkText(text, size = 80) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += size) {
    const t = words.slice(i, i + size).join(' ');
    if (t.trim().length > 15) chunks.push(t);
  }
  return chunks;
}

export function seedIfEmpty() {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS c FROM workspaces').get();
  if (row.c > 0) return false;

  const BANK_GRAPH_ID = '592b3031-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const LAW_GRAPH_ID = '837826d5-1256-4275-975f-2e72e8d05bd2';
  const LAW_PROJECT_ID = 'prj-law';

  const insertWs = db.prepare('INSERT INTO workspaces (id, name, type) VALUES (?, ?, ?)');
  const insertPf = db.prepare('INSERT INTO portfolios (id, workspace_id, name) VALUES (?, ?, ?)');
  const insertPr = db.prepare('INSERT INTO projects (id, workspace_id, portfolio_id, name) VALUES (?, ?, ?, ?)');
  const insertUser = db.prepare('INSERT INTO users (id, email, password_hash, name, role, workspace_id) VALUES (?, ?, ?, ?, ?, ?)');
  const insertMem = db.prepare('INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)');
  const insertActor = db.prepare('INSERT INTO actors (id, workspace_id, graph_id, type, name, roles_json) VALUES (?, ?, ?, ?, ?, ?)');
  const insertNode = db.prepare(`INSERT INTO nodes (id, workspace_id, project_id, graph_id, tab, label, kind, layer, node_kind, description, badge)
    VALUES (@id, @workspace_id, @project_id, @graph_id, @tab, @label, @kind, @layer, @node_kind, @description, @badge)`);
  const insertEdge = db.prepare(`INSERT INTO edges (id, workspace_id, graph_id, tab, source, target, label) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertWI = db.prepare(`INSERT INTO work_items (id, workspace_id, project_id, graph_id, type, title, status, layer, actor_ids_json, related_node_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertRev = db.prepare(`INSERT INTO reviews (id, workspace_id, graph_id, n, scope_json, author_id, status, text, answer, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertOnt = db.prepare('INSERT OR REPLACE INTO ontology (workspace_id, graph_id, profile_json) VALUES (?, ?, ?)');
  const insertDoc = db.prepare(`INSERT INTO documents (id, workspace_id, project_id, graph_id, title, length, node_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertChunk = db.prepare(`INSERT INTO chunks (id, document_id, workspace_id, graph_id, idx, text, tokens_json, node_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertGraph = db.prepare('INSERT OR IGNORE INTO graphs (id, workspace_id, name, slug, description) VALUES (?, ?, ?, ?, ?)');

  const tx = db.transaction(() => {
    // ===== WORKSPACES =====
    insertWs.run('ws-default', 'Bank Knowledge Workspace', 'company');
    insertWs.run('ws-demo', 'Demo Studio', 'studio');

    // ===== GRAPHS =====
    insertGraph.run(BANK_GRAPH_ID, 'ws-default', 'Bank', 'bank', 'Банковский домен — регуляторная отчётность');
    insertGraph.run(LAW_GRAPH_ID, 'ws-default', 'Law', 'law', 'Юридический домен — управление делами');

    // ===== PORTFOLIOS & PROJECTS =====
    insertPf.run('pf-main', 'ws-default', 'Reporting Portfolio');
    insertPr.run('prj-bank', 'ws-default', 'pf-main', 'Regulatory Reporting');
    insertPr.run(LAW_PROJECT_ID, 'ws-default', null, 'Legal Case Management');
    insertPr.run('prj-demo', 'ws-demo', null, 'Demo Project');

    // ===== USERS =====
    const adminId = 'user-admin';
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'Admin1234!');
    if (!adminPassword) throw new Error('ADMIN_INITIAL_PASSWORD must be set for first production bootstrap');
    insertUser.run(adminId, 'admin@graph.local', bcrypt.hashSync(adminPassword, process.env.NODE_ENV === 'production' ? 12 : 10), 'Admin', 'admin', 'ws-default');
    insertMem.run(adminId, 'ws-default', 'admin');
    insertMem.run(adminId, 'ws-demo', 'admin');

    // ===== ONTOLOGY =====
    insertOnt.run('ws-default', BANK_GRAPH_ID, jstr(DEFAULT_PROFILE));
    insertOnt.run('ws-default', LAW_GRAPH_ID, jstr({
      ...DEFAULT_PROFILE,
      name: 'Legal Profile',
      roles: ['Заказчик', 'Юрист', 'Партнёр', 'Паралегал', 'Эксперт'],
      nodeTypes: ['core', 'domain', 'entity', 'service'],
      workItemTypes: ['Task', 'Risk', 'Deadline', 'Hearing', 'Filing'],
      actorTypes: ['Human', 'AIAgent', 'ExternalSystem'],
      layers: ['Knowledge', 'Implementation', 'Resource', 'Project']
    }));
    insertOnt.run('ws-demo', null, jstr(DEFAULT_PROFILE));

    // ===== ACTORS =====
    const actors = [
      // Bank actors
      ['act-val', 'ws-default', 'Human', 'Валерий (практик)', ['Заказчик', 'Эксперт']],
      ['act-econ', 'ws-default', 'Human', 'Экономист', ['Owner']],
      ['act-aian', 'ws-default', 'Human', 'Инженер ИИ', ['Owner']],
      ['act-ai', 'ws-default', 'AIAgent', 'Graph Copilot', ['Ассистент']],
      ['act-dev', 'ws-default', 'Human', 'Разработчик', ['Исполнитель']],
      ['act-cb-sys', 'ws-default', 'ExternalSystem', 'KLIKO / ЦБ канал', ['External']],
      ['act-owner', 'ws-default', 'Human', 'Owner платформы', ['Owner']],
      // Law actors
      ['act-lawyer', 'ws-default', 'Human', 'Анна (юрист)', ['Owner', 'Эксперт']],
      ['act-partner', 'ws-default', 'Human', 'Партнёр практики', ['Заказчик']],
      ['act-paralegal', 'ws-default', 'Human', 'Паралегал', ['Исполнитель']],
      ['act-legal-ai', 'ws-default', 'AIAgent', 'Legal Copilot', ['Ассистент']],
      ['act-court-sys', 'ws-default', 'ExternalSystem', 'ГАС Правосудие', ['External']]
    ];
    const lawActors = new Set(['act-lawyer', 'act-partner', 'act-paralegal', 'act-legal-ai', 'act-court-sys']);
    actors.forEach(a => insertActor.run(a[0], a[1], lawActors.has(a[0]) ? LAW_GRAPH_ID : BANK_GRAPH_ID, a[2], a[3], jstr(a[4])));

    // ===== BANK NODES =====
    const bankNodes = [
      // asis
      { id: 'a-auditor', tab: 'asis', label: 'Аудитор ЦБ', kind: 'Внешняя', layer: 'Resource', node_kind: 'role', description: 'Проверка цифр вручную', badge: null },
      { id: 'a-tech', tab: 'asis', label: 'Технолог', kind: 'Банк', layer: 'Resource', node_kind: 'role', description: 'ТЗ по нормативке', badge: null },
      { id: 'a-dev', tab: 'asis', label: 'Разработчик', kind: 'Банк', layer: 'Resource', node_kind: 'role', description: 'SQL расчёт', badge: null },
      { id: 'a-econ', tab: 'asis', label: 'Экономист', kind: 'Банк', layer: 'Resource', node_kind: 'role', description: 'Сдача формы', badge: null },
      { id: 'a-cb', tab: 'asis', label: 'ЦБ РФ', kind: 'Внешняя', layer: 'Knowledge', node_kind: 'role', description: 'Регулятор', badge: null },
      { id: 'a-abs', tab: 'asis', label: 'АБС', kind: 'Источник', layer: 'Implementation', node_kind: 'domain', description: 'Счета и проводки', badge: null },
      { id: 'a-ods', tab: 'asis', label: 'ODS', kind: 'Данные', layer: 'Implementation', node_kind: 'domain', description: 'ETL слой', badge: null },
      { id: 'a-frw', tab: 'asis', label: 'Расчётный фреймворк', kind: 'Расчёт', layer: 'Implementation', node_kind: 'domain', description: 'Настройки + SQL', badge: null },
      { id: 'a-f101', tab: 'asis', label: 'Форма 0409101', kind: 'Результат', layer: 'Knowledge', node_kind: 'domain', description: 'КС и ФЛК', badge: null },
      { id: 'a-heads', tab: 'asis', label: 'Знания в головах', kind: 'Люди', layer: 'Resource', node_kind: 'note', description: 'Носители опыта', badge: null },
      // process
      { id: 's1', tab: 'process', label: 'Срез 101 синтетика', kind: 'Шаг', layer: 'Project', node_kind: 'step', description: 'Стенд и КС', badge: 'done' },
      { id: 's2', tab: 'process', label: 'Вторая форма', kind: 'Шаг', layer: 'Project', node_kind: 'step', description: 'Не похожа на 101', badge: 'next' },
      { id: 's3', tab: 'process', label: 'ODS Knowledge Model', kind: 'Шаг', layer: 'Project', node_kind: 'step', description: 'Внутри контура', badge: 'inside' },
      { id: 's4', tab: 'process', label: 'Конвертация SQL', kind: 'Шаг', layer: 'Project', node_kind: 'step', description: 'Внутренний диалект', badge: 'inside' },
      { id: 's5', tab: 'process', label: 'Боевая сверка', kind: 'Шаг', layer: 'Project', node_kind: 'step', description: 'Реальные данные', badge: 'inside' },
      { id: 's6', tab: 'process', label: 'Программа', kind: 'Шаг', layer: 'Project', node_kind: 'step', description: 'Масштаб', badge: 'inside' },
      { id: 'p-aian', tab: 'process', label: 'Инженер ИИ', kind: 'Центр', layer: 'Resource', node_kind: 'role', description: 'Ведёт переход', badge: null },
      // tobe
      { id: 'core', tab: 'tobe', label: 'Граф знаний', kind: 'Ядро', layer: 'Knowledge', node_kind: 'core', description: 'Знание один раз', badge: null },
      { id: 'reg', tab: 'tobe', label: 'Regulatory Knowledge', kind: 'Нормативка', layer: 'Knowledge', node_kind: 'domain', description: '809-П, 6406-У, ФЛК', badge: null },
      { id: 'ods', tab: 'tobe', label: 'ODS Knowledge', kind: 'Модель', layer: 'Knowledge', node_kind: 'domain', description: 'Lineage', badge: null },
      { id: 'rep', tab: 'tobe', label: 'Reporting Knowledge', kind: 'Формы', layer: 'Knowledge', node_kind: 'domain', description: '0409101', badge: null },
      { id: 'ctrl', tab: 'tobe', label: 'Control Knowledge', kind: 'Контроль', layer: 'Knowledge', node_kind: 'domain', description: 'КС, DELTA', badge: null },
      { id: 'dom', tab: 'tobe', label: 'Banking Domain', kind: 'Понятия', layer: 'Knowledge', node_kind: 'domain', description: 'Счета, СПОД', badge: null },
      { id: 'proc', tab: 'tobe', label: 'Process Knowledge', kind: 'Регламенты', layer: 'Knowledge', node_kind: 'domain', description: 'ETL, расчёт', badge: null },
      { id: 'ai', tab: 'tobe', label: 'AI Knowledge', kind: 'ИИ', layer: 'Knowledge', node_kind: 'domain', description: 'Промты, eval', badge: null },
      { id: 'stand', tab: 'tobe', label: 'Synthetic Stand', kind: 'Сервис', layer: 'Implementation', node_kind: 'service', description: 'Синтетика', badge: null },
      { id: 'valid', tab: 'tobe', label: 'Validation', kind: 'Сервис', layer: 'Implementation', node_kind: 'service', description: 'Эталоны', badge: null },
      { id: 'migr', tab: 'tobe', label: 'Migration', kind: 'Сервис', layer: 'Implementation', node_kind: 'service', description: 'В контур', badge: null },
      { id: 'econ', tab: 'tobe', label: 'Экономист', kind: 'Роль', layer: 'Resource', node_kind: 'role', description: 'Сдаёт форму', badge: null },
      { id: 'aian', tab: 'tobe', label: 'Инженер ИИ', kind: 'Роль', layer: 'Resource', node_kind: 'role', description: 'Модель знаний', badge: null },
      { id: 'cb', tab: 'tobe', label: 'ЦБ РФ', kind: 'Внешняя', layer: 'Knowledge', node_kind: 'role', description: 'Регулятор', badge: null },
      { id: 'self-graph', tab: 'tobe', label: 'Graph Engine', kind: 'Platform', layer: 'Implementation', node_kind: 'service', description: 'Self-host', badge: null },
      { id: 'self-copilot', tab: 'tobe', label: 'Graph Copilot', kind: 'Platform', layer: 'Implementation', node_kind: 'service', description: 'Self-host chat', badge: null }
    ];

    for (const n of bankNodes) {
      insertNode.run({
        id: n.id,
        workspace_id: 'ws-default',
        project_id: 'prj-bank',
        graph_id: BANK_GRAPH_ID,
        tab: n.tab,
        label: n.label,
        kind: n.kind,
        layer: n.layer,
        node_kind: n.node_kind,
        description: n.description,
        badge: n.badge
      });
    }

    // ===== BANK EDGES =====
    const bankEdges = [
      ['ae1', BANK_GRAPH_ID, 'asis', 'a-abs', 'a-ods', 'ETL'],
      ['ae2', BANK_GRAPH_ID, 'asis', 'a-ods', 'a-frw', 'данные'],
      ['ae3', BANK_GRAPH_ID, 'asis', 'a-frw', 'a-f101', 'расчёт'],
      ['ae4', BANK_GRAPH_ID, 'asis', 'a-econ', 'a-f101', 'сдача'],
      ['ae5', BANK_GRAPH_ID, 'asis', 'a-f101', 'a-cb', 'KLIKO'],
      ['ae6', BANK_GRAPH_ID, 'asis', 'a-tech', 'a-dev', 'ТЗ'],
      ['pe1', BANK_GRAPH_ID, 'process', 's1', 's2', 'ядро'],
      ['pe2', BANK_GRAPH_ID, 'process', 's2', 's3', 'контур'],
      ['pe3', BANK_GRAPH_ID, 'process', 's3', 's4', 'SQL'],
      ['pe4', BANK_GRAPH_ID, 'process', 's4', 's5', 'сверка'],
      ['pe5', BANK_GRAPH_ID, 'process', 's5', 's6', 'программа'],
      ['pe6', BANK_GRAPH_ID, 'process', 'p-aian', 's1', 'ведёт'],
      ['te1', BANK_GRAPH_ID, 'tobe', 'reg', 'core', 'объекты'],
      ['te2', BANK_GRAPH_ID, 'tobe', 'ods', 'core', 'объекты'],
      ['te3', BANK_GRAPH_ID, 'tobe', 'rep', 'core', 'проекции'],
      ['te4', BANK_GRAPH_ID, 'tobe', 'ctrl', 'core', 'объекты'],
      ['te5', BANK_GRAPH_ID, 'tobe', 'dom', 'core', 'объекты'],
      ['te6', BANK_GRAPH_ID, 'tobe', 'proc', 'core', 'объекты'],
      ['te7', BANK_GRAPH_ID, 'tobe', 'ai', 'core', 'обход'],
      ['te8', BANK_GRAPH_ID, 'tobe', 'stand', 'core', 'проверка'],
      ['te9', BANK_GRAPH_ID, 'tobe', 'valid', 'core', 'эталоны'],
      ['te10', BANK_GRAPH_ID, 'tobe', 'migr', 'core', 'перенос'],
      ['te11', BANK_GRAPH_ID, 'tobe', 'econ', 'ctrl', 'инструмент'],
      ['te12', BANK_GRAPH_ID, 'tobe', 'econ', 'cb', 'сдача'],
      ['te13', BANK_GRAPH_ID, 'tobe', 'aian', 'ai', 'модель'],
      ['te14', BANK_GRAPH_ID, 'tobe', 'aian', 'core', 'наполнение'],
      ['te15', BANK_GRAPH_ID, 'tobe', 'self-graph', 'core', 'self-host'],
      ['te16', BANK_GRAPH_ID, 'tobe', 'self-copilot', 'ai', 'self-host']
    ];
    bankEdges.forEach(e => insertEdge.run(e[0], 'ws-default', e[1], e[2], e[3], e[4], e[5]));

    // ===== LAW NODES (Юридический домен) =====
    const lawNodes = [
      { id: 'case', tab: 'tobe', label: 'Legal Case', kind: 'Дело', layer: 'Knowledge', node_kind: 'core', description: 'Центральный граф дела', badge: null },
      { id: 'client', tab: 'tobe', label: 'Client', kind: 'Участник', layer: 'Knowledge', node_kind: 'entity', description: 'Истец или доверитель', badge: null },
      { id: 'opponent', tab: 'tobe', label: 'Opponent', kind: 'Участник', layer: 'Knowledge', node_kind: 'entity', description: 'Ответчик', badge: null },
      { id: 'court', tab: 'tobe', label: 'Court', kind: 'Орган', layer: 'Knowledge', node_kind: 'entity', description: 'Суд', badge: null },
      { id: 'judge', tab: 'tobe', label: 'Judge', kind: 'Участник', layer: 'Knowledge', node_kind: 'entity', description: 'Судья', badge: null },
      { id: 'events', tab: 'tobe', label: 'Timeline', kind: 'События', layer: 'Knowledge', node_kind: 'domain', description: 'Хронология', badge: null },
      { id: 'facts', tab: 'tobe', label: 'Facts', kind: 'Факты', layer: 'Knowledge', node_kind: 'domain', description: 'Юридически значимые факты', badge: null },
      { id: 'claims', tab: 'tobe', label: 'Claims', kind: 'Требования', layer: 'Knowledge', node_kind: 'domain', description: 'Исковые требования', badge: null },
      { id: 'arguments', tab: 'tobe', label: 'Arguments', kind: 'Аргументы', layer: 'Knowledge', node_kind: 'domain', description: 'Правовые позиции', badge: null },
      { id: 'documents', tab: 'tobe', label: 'Documents', kind: 'Документы', layer: 'Knowledge', node_kind: 'domain', description: 'Все документы', badge: null },
      { id: 'contracts', tab: 'tobe', label: 'Contracts', kind: 'Договоры', layer: 'Knowledge', node_kind: 'domain', description: 'Договоры', badge: null },
      { id: 'letters', tab: 'tobe', label: 'Correspondence', kind: 'Переписка', layer: 'Knowledge', node_kind: 'domain', description: 'Email, WhatsApp', badge: null },
      { id: 'evidence', tab: 'tobe', label: 'Evidence', kind: 'Доказательства', layer: 'Knowledge', node_kind: 'domain', description: 'Фото, видео, экспертизы', badge: null },
      { id: 'laws', tab: 'tobe', label: 'Legislation', kind: 'Нормы', layer: 'Knowledge', node_kind: 'domain', description: 'Законы', badge: null },
      { id: 'practice', tab: 'tobe', label: 'Court Practice', kind: 'Практика', layer: 'Knowledge', node_kind: 'domain', description: 'Судебная практика', badge: null },
      { id: 'experts', tab: 'tobe', label: 'Expert Opinions', kind: 'Экспертизы', layer: 'Knowledge', node_kind: 'domain', description: 'Заключения', badge: null },
      { id: 'risks', tab: 'tobe', label: 'Risks', kind: 'Риски', layer: 'Knowledge', node_kind: 'domain', description: 'Риски дела', badge: null },
      { id: 'probability', tab: 'tobe', label: 'Outcome Prediction', kind: 'Прогноз', layer: 'Knowledge', node_kind: 'domain', description: 'Вероятности', badge: null },
      { id: 'strategy', tab: 'tobe', label: 'Strategy', kind: 'Стратегия', layer: 'Knowledge', node_kind: 'domain', description: 'План защиты', badge: null },
      { id: 'actions', tab: 'tobe', label: 'Action Plan', kind: 'План', layer: 'Knowledge', node_kind: 'domain', description: 'Следующие действия', badge: null },
      { id: 'deadlines', tab: 'tobe', label: 'Deadlines', kind: 'Сроки', layer: 'Knowledge', node_kind: 'domain', description: 'Процессуальные сроки', badge: null },
      { id: 'reasoner', tab: 'tobe', label: 'Legal Reasoner', kind: 'Сервис', layer: 'Implementation', node_kind: 'service', description: 'Логический вывод', badge: null },
      { id: 'generator', tab: 'tobe', label: 'Document Generator', kind: 'Сервис', layer: 'Implementation', node_kind: 'service', description: 'Подготовка документов', badge: null },
      { id: 'copilot', tab: 'tobe', label: 'Legal Copilot', kind: 'Платформа', layer: 'Implementation', node_kind: 'service', description: 'ИИ помощник', badge: null }
    ];

    for (const n of lawNodes) {
      insertNode.run({
        id: n.id,
        workspace_id: 'ws-default',
        project_id: LAW_PROJECT_ID,
        graph_id: LAW_GRAPH_ID,
        tab: n.tab,
        label: n.label,
        kind: n.kind,
        layer: n.layer,
        node_kind: n.node_kind,
        description: n.description,
        badge: n.badge
      });
    }

    // ===== LAW EDGES =====
    const lawEdges = [
      ['le1', LAW_GRAPH_ID, 'tobe', 'client', 'case', 'инициирует'],
      ['le2', LAW_GRAPH_ID, 'tobe', 'opponent', 'case', 'участник'],
      ['le3', LAW_GRAPH_ID, 'tobe', 'court', 'case', 'рассматривает'],
      ['le4', LAW_GRAPH_ID, 'tobe', 'judge', 'court', 'ведёт'],
      ['le5', LAW_GRAPH_ID, 'tobe', 'events', 'case', 'хронология'],
      ['le6', LAW_GRAPH_ID, 'tobe', 'facts', 'events', 'следуют из'],
      ['le7', LAW_GRAPH_ID, 'tobe', 'claims', 'facts', 'основаны на'],
      ['le8', LAW_GRAPH_ID, 'tobe', 'arguments', 'claims', 'обосновывают'],
      ['le9', LAW_GRAPH_ID, 'tobe', 'documents', 'facts', 'подтверждают'],
      ['le10', LAW_GRAPH_ID, 'tobe', 'contracts', 'documents', 'вид'],
      ['le11', LAW_GRAPH_ID, 'tobe', 'letters', 'documents', 'вид'],
      ['le12', LAW_GRAPH_ID, 'tobe', 'evidence', 'facts', 'доказывают'],
      ['le13', LAW_GRAPH_ID, 'tobe', 'experts', 'evidence', 'подтверждают'],
      ['le14', LAW_GRAPH_ID, 'tobe', 'laws', 'arguments', 'основание'],
      ['le15', LAW_GRAPH_ID, 'tobe', 'practice', 'arguments', 'поддерживает'],
      ['le16', LAW_GRAPH_ID, 'tobe', 'risks', 'claims', 'ослабляют'],
      ['le17', LAW_GRAPH_ID, 'tobe', 'probability', 'strategy', 'оценивает'],
      ['le18', LAW_GRAPH_ID, 'tobe', 'strategy', 'case', 'определяет'],
      ['le19', LAW_GRAPH_ID, 'tobe', 'actions', 'strategy', 'реализует'],
      ['le20', LAW_GRAPH_ID, 'tobe', 'deadlines', 'actions', 'ограничивают'],
      ['le21', LAW_GRAPH_ID, 'tobe', 'reasoner', 'case', 'анализирует'],
      ['le22', LAW_GRAPH_ID, 'tobe', 'generator', 'strategy', 'готовит документы'],
      ['le23', LAW_GRAPH_ID, 'tobe', 'copilot', 'reasoner', 'использует']
    ];
    lawEdges.forEach(e => insertEdge.run(e[0], 'ws-default', e[1], e[2], e[3], e[4], e[5]));

    // ===== BANK WORK ITEMS =====
    insertWI.run('wi-1', 'ws-default', 'prj-bank', BANK_GRAPH_ID, 'ChangeRequest', 'Выделить Control Knowledge', 'done', 'Knowledge', jstr(['act-val']), jstr(['ctrl', 'core']));
    insertWI.run('wi-2', 'ws-default', 'prj-bank', BANK_GRAPH_ID, 'KnowledgeDefect', 'Разрыв Process ↔ ETL', 'open', 'Knowledge', jstr(['act-aian']), jstr(['proc']));
    insertWI.run('wi-3', 'ws-default', 'prj-bank', BANK_GRAPH_ID, 'Task', 'Interest Scope auto', 'open', 'Implementation', jstr(['act-ai']), jstr(['core']));
    insertWI.run('wi-4', 'ws-default', 'prj-bank', BANK_GRAPH_ID, 'Risk', 'Знания в головах', 'open', 'Resource', jstr(['act-val']), jstr(['a-heads']));

    // ===== LAW WORK ITEMS =====
    insertWI.run('wi-law-1', 'ws-default', LAW_PROJECT_ID, LAW_GRAPH_ID, 'Task', 'Анализ судебной практики', 'open', 'Knowledge', jstr(['act-lawyer']), jstr(['practice', 'arguments']));
    insertWI.run('wi-law-2', 'ws-default', LAW_PROJECT_ID, LAW_GRAPH_ID, 'Risk', 'Пропуск процессуального срока', 'open', 'Knowledge', jstr(['act-partner']), jstr(['deadlines', 'risks']));
    insertWI.run('wi-law-3', 'ws-default', LAW_PROJECT_ID, LAW_GRAPH_ID, 'Filing', 'Подготовка искового заявления', 'done', 'Knowledge', jstr(['act-paralegal']), jstr(['claims', 'generator']));

    // ===== BANK REVIEWS =====
    insertRev.run('r1', 'ws-default', BANK_GRAPH_ID, 1, jstr({ projectId: 'prj-bank', artifactId: 'stand', version: 'v1' }), 'act-val', 'accepted', 'Центр — платформа знаний', 'Схема перестроена', '16.07');
    insertRev.run('r2', 'ws-default', BANK_GRAPH_ID, 2, jstr({ projectId: 'prj-bank', artifactId: 'core', version: 'v5' }), 'act-val', 'accepted', 'Проекции по ролям', 'Role switcher', '17.07');

    // ===== LAW REVIEWS =====
    insertRev.run('r-law-1', 'ws-default', LAW_GRAPH_ID, 1, jstr({ projectId: LAW_PROJECT_ID, artifactId: 'strategy', version: 'v1' }), 'act-lawyer', 'accepted', 'Стратегия защиты', 'План утверждён', '20.07');
    insertRev.run('r-law-2', 'ws-default', LAW_GRAPH_ID, 2, jstr({ projectId: LAW_PROJECT_ID, artifactId: 'claims', version: 'v2' }), 'act-partner', 'pending', 'Уточнить требования', null, '21.07');

    // ===== ROLE BINDINGS =====
    try {
      const insRB = db.prepare('INSERT OR IGNORE INTO role_bindings (id, workspace_id, graph_id, actor_id, object_id, role) VALUES (?, ?, ?, ?, ?, ?)');
      // Bank
      insRB.run('rb1', 'ws-default', BANK_GRAPH_ID, 'act-val', 'prj-bank', 'Заказчик');
      insRB.run('rb2', 'ws-default', BANK_GRAPH_ID, 'act-owner', 'prj-bank', 'Owner');
      insRB.run('rb3', 'ws-default', BANK_GRAPH_ID, 'act-econ', 'a-f101', 'Owner');
      insRB.run('rb4', 'ws-default', BANK_GRAPH_ID, 'act-val', 'core', 'Заказчик');
      // Law
      insRB.run('rb-law-1', 'ws-default', LAW_GRAPH_ID, 'act-partner', LAW_PROJECT_ID, 'Заказчик');
      insRB.run('rb-law-2', 'ws-default', LAW_GRAPH_ID, 'act-lawyer', LAW_PROJECT_ID, 'Owner');
      insRB.run('rb-law-3', 'ws-default', LAW_GRAPH_ID, 'act-lawyer', 'case', 'Owner');
    } catch (e) { /* table may be new */ }

    // ===== RAG DOCUMENTS =====
    const docs = [
      {
        title: 'Архитектура Graph Platform',
        content: 'Graph Platform: Graph Engine, FSM Engine, Review Engine, Ontology Engine, RAG Engine, Visualization Engine, LLM Gateway. PI выше React Flow. Default First, Configure Second, Extend Third. Transformation Graph: Knowledge, Implementation, Project, Resource. Interest Scope вычисляется. Actor = Human | AIAgent | Service. Pipe не формализована жёстко. DeepSeek и OpenAI через единый LLM Gateway.',
        nodes: ['core', 'self-graph', 'self-copilot']
      },
      {
        title: 'Форма 0409101 и контроль',
        content: 'Форма 0409101 — оборотная ведомость. КС — контрольные соотношения. ФЛК — форматно-логический контроль ЦБ. Control Knowledge — контрольные отчёты, КС, DELTA. Экономист отвечает за сдачу. ODS — единый слой. Lineage — путь цифры до операции.',
        nodes: ['rep', 'ctrl', 'ods', 'econ']
      },
      {
        title: 'Переход As-is to To-be',
        content: 'Шаги: синтетика 101, вторая форма, ODS Knowledge Model, конвертация SQL, боевая сверка, программа. Инженер ИИ ведёт синтетику, модель, eval и обучение. В as-is знания в ТЗ и головах.',
        nodes: ['s1', 's2', 'p-aian', 'a-heads']
      },
      {
        title: 'Юридический граф знаний',
        content: 'Legal Case — центральный узел дела. Связи: Client → Case, Court → Case, Facts → Timeline. Documents подтверждают Facts. Legislation и Court Practice обосновывают Arguments. Legal Reasoner анализирует Case через логический вывод. Document Generator готовит процессуальные документы. Legal Copilot — ИИ-ассистент юриста.',
        nodes: ['case', 'facts', 'arguments', 'laws', 'reasoner', 'copilot']
      }
    ];
    for (const d of docs) {
      const id = randomUUID();
      const isLaw = d.nodes.includes('case') || d.nodes.includes('reasoner');
      const docGraphId = isLaw ? LAW_GRAPH_ID : BANK_GRAPH_ID;
      const docProjectId = isLaw ? LAW_PROJECT_ID : 'prj-bank';
      insertDoc.run(id, 'ws-default', docProjectId, docGraphId, d.title, d.content.length, jstr(d.nodes));
      chunkText(d.content).forEach((text, i) => {
        insertChunk.run(randomUUID(), id, 'ws-default', docGraphId, i, text, jstr(tokenize(text)), jstr(d.nodes));
      });
    }
  });

  tx();
  console.log('✅ Seed complete: Bank + Law domains ready');
  return true;
}