import { randomUUID } from 'crypto';
import { DEFAULT_PROFILE } from '../engines/ontology.js';
import { materializeOntologyTypes } from './ontologyTypes.js';

const ECOSYSTEMS = [
  { slug: 'greenmarket', name: 'GreenMarket', domain: 'Marketplace', component: 'Order Service', scenario: 'Проверка цепочки каталог → заказ → доставка' },
  { slug: 'taxi', name: 'Taxi', domain: 'Mobility', component: 'Dispatch Engine', scenario: 'Проверка назначения водителя и ETA' },
  { slug: 'platform-core', name: 'Platform Core', domain: 'Knowledge Platform', component: 'Graph Engine', scenario: 'Проверка хранения и проекций графа' },
  { slug: 'fsm-engine', name: 'FSM Engine', domain: 'Workflow', component: 'Transition Runtime', scenario: 'Проверка переходов Work Item' },
  { slug: 'voice', name: 'Voice', domain: 'Conversational AI', component: 'Voice Gateway', scenario: 'Проверка распознавания и маршрутизации интента' },
  { slug: 'map', name: 'Map', domain: 'Geospatial', component: 'Map Renderer', scenario: 'Проверка объектов и пространственных связей' }
];

export function ensureInternalValidationProjects(db) {
  if (!db.prepare("SELECT 1 FROM workspaces WHERE id='ws-default'").get()) return 0;
  let portfolio = db.prepare("SELECT id FROM portfolios WHERE workspace_id='ws-default' AND name='Internal Validation' LIMIT 1").get();
  if (!portfolio) {
    portfolio = { id: randomUUID() };
    db.prepare("INSERT INTO portfolios (id,workspace_id,name) VALUES (?,'ws-default','Internal Validation')").run(portfolio.id);
  }
  let program = db.prepare("SELECT id FROM programs WHERE workspace_id='ws-default' AND portfolio_id=? AND name='Platform Validation' LIMIT 1").get(portfolio.id);
  if (!program) {
    program = { id: randomUUID() };
    db.prepare("INSERT INTO programs (id,workspace_id,portfolio_id,name,description,status) VALUES (?,'ws-default',?,'Platform Validation','Internal ecosystems used to validate Graph Platform','active')")
      .run(program.id, portfolio.id);
  }

  let created = 0;
  for (const ecosystem of ECOSYSTEMS) {
    if (db.prepare('SELECT 1 FROM graphs WHERE slug=?').get(ecosystem.slug)) continue;
    db.transaction(() => {
      const projectId = randomUUID();
      const graphId = randomUUID();
      db.prepare('INSERT INTO projects (id,workspace_id,portfolio_id,program_id,name) VALUES (?,\'ws-default\',?,?,?)')
        .run(projectId, portfolio.id, program.id, ecosystem.name);
      db.prepare(`INSERT INTO graphs
        (id,workspace_id,project_id,name,slug,description,visibility,settings_json)
        VALUES (?,'ws-default',?,?,?,?, 'public',?)`).run(
          graphId, projectId, ecosystem.name, ecosystem.slug,
          `${ecosystem.scenario}. Внутренний проект апробации Graph Platform.`,
          JSON.stringify({ builtIn: true, internalValidation: true })
        );
      db.prepare('INSERT INTO ontology (workspace_id,graph_id,profile_json) VALUES (\'ws-default\',?,?)')
        .run(graphId, JSON.stringify(DEFAULT_PROFILE));
      materializeOntologyTypes(db, 'ws-default', graphId, DEFAULT_PROFILE);

      const nodeIds = {
        domain: `validation-${ecosystem.slug}-domain`,
        component: `validation-${ecosystem.slug}-component`,
        scenario: `validation-${ecosystem.slug}-scenario`,
        metric: `validation-${ecosystem.slug}-metric`
      };
      const insertNode = db.prepare(`INSERT INTO nodes
        (id,workspace_id,project_id,graph_id,tab,label,kind,layer,node_kind,description,data_json)
        VALUES (?,'ws-default',?,?,'tobe',?,?,?,?,?,?)`);
      insertNode.run(nodeIds.domain, projectId, graphId, ecosystem.domain, 'Domain', 'Knowledge', 'domain', 'Предметная модель', JSON.stringify({ position: { x: 0, y: 0 } }));
      insertNode.run(nodeIds.component, projectId, graphId, ecosystem.component, 'Component', 'Implementation', 'service', 'Исполняемый компонент', JSON.stringify({ position: { x: 380, y: 0 } }));
      insertNode.run(nodeIds.scenario, projectId, graphId, 'Validation Scenario', 'Scenario', 'Project', 'step', ecosystem.scenario, JSON.stringify({ position: { x: 760, y: 0 } }));
      insertNode.run(nodeIds.metric, projectId, graphId, 'Acceptance Metric', 'Metric', 'Resource', 'note', 'Измеримый критерий результата', JSON.stringify({ position: { x: 1140, y: 0 } }));
      const insertEdge = db.prepare("INSERT INTO edges (id,workspace_id,graph_id,tab,source,target,label) VALUES (?,'ws-default',?,'tobe',?,?,?)");
      insertEdge.run(randomUUID(), graphId, nodeIds.domain, nodeIds.component, 'defines');
      insertEdge.run(randomUUID(), graphId, nodeIds.component, nodeIds.scenario, 'validated by');
      insertEdge.run(randomUUID(), graphId, nodeIds.scenario, nodeIds.metric, 'measured by');

      const issueId = randomUUID();
      const changeId = randomUUID();
      db.prepare(`INSERT INTO issues
        (id,workspace_id,project_id,graph_id,type,title,description,status,severity)
        VALUES (?,'ws-default',?,?, 'KnowledgeDefect',?,?, 'open','medium')`)
        .run(issueId, projectId, graphId, `Validate ${ecosystem.name} knowledge`, ecosystem.scenario);
      db.prepare(`INSERT INTO changes
        (id,workspace_id,project_id,graph_id,title,description,status,risk_level,estimated_hours,budget,metrics_json)
        VALUES (?,'ws-default',?,?,?,?, 'proposed','low',8,0,?)`)
        .run(changeId, projectId, graphId, `Complete ${ecosystem.name} validation`, ecosystem.scenario, JSON.stringify({ acceptanceCoverage: 100 }));
      db.prepare('INSERT INTO change_artifacts (change_id,node_id,perspective) VALUES (?,?,\'component\')').run(changeId, nodeIds.component);
      db.prepare('INSERT INTO change_artifacts (change_id,node_id,perspective) VALUES (?,?,\'test\')').run(changeId, nodeIds.scenario);
      db.prepare(`INSERT INTO work_items
        (id,workspace_id,project_id,graph_id,issue_id,change_id,type,title,status,layer,related_node_ids_json,estimated_hours,required_specialists_json,budget,critical_path,risk_level,updated_at)
        VALUES (?,'ws-default',?,?,?,?, 'Task',?,'open','Project',?,8,?,0,1,'low',datetime('now'))`)
        .run(randomUUID(), projectId, graphId, issueId, changeId, `Run ${ecosystem.name} acceptance scenario`, JSON.stringify([nodeIds.component, nodeIds.scenario]), JSON.stringify(['Domain Expert', 'Developer']));
    })();
    created++;
  }
  return created;
}

export function listInternalValidationProjects() {
  return ECOSYSTEMS.map(item => ({ ...item }));
}
