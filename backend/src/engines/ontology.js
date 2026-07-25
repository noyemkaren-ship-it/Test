/**
 * Ontology Engine — Default First, Configure Second, Extend Third
 * FSM machines are part of ontology, extensible via /api/ontology/extend
 */

export const DEFAULT_PROFILE = {
  principle: 'Default First → Configure Second → Extend Third',
  id: 'default-v1',
  name: 'Platform Default Profile',
  version: '1.0.0',
  
  reviewScopeLevels: ['Project', 'Epic', 'Feature', 'Artifact', 'Version', 'Fragment'],
  
  issueHierarchy: {
    Issue: 'umbrella (knowledge/process level, longer lifecycle)',
    WorkItem: 'executable unit under Issue (Task, Defect, …) with own FSM'
  },
  
  roleOnRelation: 'Role binds to Actor↔Object link, not globally to person',
  
  roles: [
    'Заказчик', 'Owner', 'Исполнитель', 'Эксперт', 'Ассистент', 'External',
    'Рецензент', 'Аудитор', 'Экономист', 'Технолог', 'Разработчик', 'Инженер ИИ', 'Руководитель'
  ],
  
  nodeTypes: [
    { id: 'domain', label: 'Domain', layer: 'Knowledge' },
    { id: 'core', label: 'Core', layer: 'Knowledge' },
    { id: 'service', label: 'Service', layer: 'Implementation' },
    { id: 'role', label: 'Role', layer: 'Resource' },
    { id: 'note', label: 'Note', layer: 'Knowledge' },
    { id: 'step', label: 'Step', layer: 'Project' },
    { id: 'act', label: 'Activity', layer: 'Project' }
  ],
  
  edgeTypes: [
    { id: 'relates', label: 'relates' },
    { id: 'owns', label: 'owns' },
    { id: 'implements', label: 'implements' },
    { id: 'depends', label: 'depends' },
    { id: 'reviews', label: 'reviews' }
  ],
  
  workItemTypes: [
    'Task', 'Defect', 'ReviewComment', 'Risk', 'TechnicalDebt',
    'ChangeRequest', 'Improvement', 'KnowledgeDefect'
  ],
  
  actorTypes: ['Human', 'AIAgent', 'Service', 'ExternalSystem'],
  
  layers: ['Knowledge', 'Implementation', 'Project', 'Resource'],
  
  interestScopeRules: {
    expandHops: 1,
    includeWorkItems: true,
    includeReviews: true
  },
  
  aiAgents: [
    { id: 'graph-copilot', name: 'Graph Copilot', type: 'AIAgent' }
  ],
  
  fsmMachines: {},

  extensions: []
};

export function loadProfile(stored) {
  if (!stored) return structuredClone(DEFAULT_PROFILE);
  
  const base = structuredClone(DEFAULT_PROFILE);
  
  if (stored.name) base.name = stored.name;
  if (stored.version) base.version = stored.version;
  
  if (stored.fsmMachines && typeof stored.fsmMachines === 'object') {
    base.fsmMachines = { ...stored.fsmMachines };
  }
  
  if (stored.extensions?.length) {
    base.extensions = [...stored.extensions];
    
    for (const ext of stored.extensions) {
      if (ext.nodeTypes) {
        const existingIds = new Set(base.nodeTypes.map(n => n.id));
        for (const nt of ext.nodeTypes) {
          if (!existingIds.has(nt.id)) {
            base.nodeTypes.push(nt);
            existingIds.add(nt.id);
          }
        }
      }
      
      if (ext.edgeTypes) {
        const existingIds = new Set(base.edgeTypes.map(e => e.id));
        for (const et of ext.edgeTypes) {
          if (!existingIds.has(et.id)) {
            base.edgeTypes.push(et);
            existingIds.add(et.id);
          }
        }
      }
      
      if (ext.roles) {
        const existingRoles = new Set(base.roles);
        for (const role of ext.roles) {
          if (!existingRoles.has(role)) {
            base.roles.push(role);
            existingRoles.add(role);
          }
        }
      }
      
      if (ext.workItemTypes) {
        const existingTypes = new Set(base.workItemTypes);
        for (const type of ext.workItemTypes) {
          if (!existingTypes.has(type)) {
            base.workItemTypes.push(type);
            existingTypes.add(type);
          }
        }
      }
      
      if (ext.actorTypes) {
        const existingTypes = new Set(base.actorTypes);
        for (const type of ext.actorTypes) {
          if (!existingTypes.has(type)) {
            base.actorTypes.push(type);
            existingTypes.add(type);
          }
        }
      }
      
      if (ext.fsmMachines && typeof ext.fsmMachines === 'object') {
        base.fsmMachines = {
          ...base.fsmMachines,
          ...ext.fsmMachines
        };
      }
    }
  }
  
  return base;
}

export function extendProfile(current, extension) {
  const profile = loadProfile(current);
  
  profile.extensions = profile.extensions || [];
  profile.extensions.push({
    id: extension.id || `ext-${Date.now()}`,
    at: new Date().toISOString(),
    ...extension
  });
  
  if (extension.name) profile.name = extension.name;
  if (extension.version) profile.version = extension.version;
  
  return profile;
}

export function validateExtension(extension) {
  const errors = [];
  
  if (extension.workItemTypes) {
    for (const type of extension.workItemTypes) {
      if (!extension.fsmMachines?.[type]) {
        errors.push(`WorkItemType "${type}" added without FSM machine — will use Task lifecycle as default`);
      }
    }
  }
  
  if (extension.fsmMachines) {
    for (const [type, machine] of Object.entries(extension.fsmMachines)) {
      if (!machine.initial) {
        errors.push(`FSM machine "${type}" has no initial state`);
      }
      if (!machine.states || Object.keys(machine.states).length === 0) {
        errors.push(`FSM machine "${type}" has no states`);
      }
      if (!machine.states[machine.initial]) {
        errors.push(`FSM machine "${type}" initial state "${machine.initial}" not found in states`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings: errors.filter(e => e.includes('will use Task lifecycle'))
  };
}