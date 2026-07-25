import { getDb, jparse } from '../utils/helper.js';

const DEFAULT_MACHINES = {
  Task: {
    initial: 'open',
    states: {
      open: { on: { START: 'in_progress', CANCEL: 'cancelled' } },
      in_progress: { on: { DONE: 'done', BLOCK: 'blocked', CANCEL: 'cancelled' } },
      blocked: { on: { UNBLOCK: 'in_progress', CANCEL: 'cancelled' } },
      done: { on: { REOPEN: 'open' } },
      cancelled: { on: { REOPEN: 'open' } }
    }
  },
  Defect: {
    initial: 'open',
    states: {
      open: { on: { CONFIRM: 'confirmed', REJECT: 'rejected' } },
      confirmed: { on: { FIX: 'in_progress' } },
      in_progress: { on: { RESOLVE: 'resolved', REOPEN: 'confirmed' } },
      resolved: { on: { CLOSE: 'closed', REOPEN: 'confirmed' } },
      rejected: { on: { REOPEN: 'open' } },
      closed: { on: { REOPEN: 'open' } }
    }
  },
  ReviewComment: {
    initial: 'open',
    states: {
      open: { on: { ACCEPT: 'accepted', REJECT: 'rejected', WORK: 'in_progress' } },
      in_progress: { on: { ACCEPT: 'accepted', REJECT: 'rejected' } },
      accepted: { on: {} },
      rejected: { on: { REOPEN: 'open' } }
    }
  },
  ChangeRequest: {
    initial: 'open',
    states: {
      open: { on: { APPROVE: 'approved', REJECT: 'rejected' } },
      approved: { on: { START: 'in_progress' } },
      in_progress: { on: { DONE: 'done' } },
      done: { on: {} },
      rejected: { on: { REOPEN: 'open' } }
    }
  },
  KnowledgeDefect: {
    initial: 'open',
    states: {
      open: { on: { TRIAGE: 'triaged' } },
      triaged: { on: { FIX: 'in_progress', DEFER: 'deferred' } },
      in_progress: { on: { RESOLVE: 'resolved' } },
      resolved: { on: { CLOSE: 'closed' } },
      deferred: { on: { REOPEN: 'open' } },
      closed: { on: {} }
    }
  },
  Risk: {
    initial: 'open',
    states: {
      open: { on: { MITIGATE: 'mitigating', ACCEPT: 'accepted' } },
      mitigating: { on: { CLOSE: 'closed' } },
      accepted: { on: { CLOSE: 'closed' } },
      closed: { on: {} }
    }
  },
  TechnicalDebt: {
    initial: 'open',
    states: {
      open: { on: { SCHEDULE: 'scheduled', WONTFIX: 'wontfix' } },
      scheduled: { on: { START: 'in_progress' } },
      in_progress: { on: { DONE: 'done' } },
      done: { on: {} },
      wontfix: { on: { REOPEN: 'open' } }
    }
  },
  Improvement: {
    initial: 'open',
    states: {
      open: { on: { START: 'in_progress', DEFER: 'deferred' } },
      in_progress: { on: { DONE: 'done' } },
      deferred: { on: { REOPEN: 'open' } },
      done: { on: {} }
    }
  }
};

const machinesCache = new Map();

function loadMachinesFromOntology(workspaceId, graphId = null) {
  try {
    const db = getDb();
    const row = graphId
      ? db.prepare('SELECT profile_json FROM ontology WHERE workspace_id = ? AND graph_id = ?').get(workspaceId, graphId)
      : db.prepare('SELECT profile_json FROM ontology WHERE workspace_id = ? ORDER BY graph_id IS NULL DESC LIMIT 1').get(workspaceId);
    
    if (!row || !row.profile_json) {
      return { ...DEFAULT_MACHINES };
    }
    
    const ontology = jparse(row.profile_json, {});
    
    if (ontology.fsmMachines && typeof ontology.fsmMachines === 'object') {
      return {
        ...DEFAULT_MACHINES,
        ...ontology.fsmMachines
      };
    }
    
    return { ...DEFAULT_MACHINES };
  } catch (error) {
    console.error('loadMachinesFromOntology error:', error.message);
    return { ...DEFAULT_MACHINES };
  }
}

export function getMachine(type, workspaceId = 'ws-default', graphId = null) {
  try {
    const cacheKey = `${workspaceId}:${graphId || '_'}:${type}`;
    
    if (machinesCache.has(cacheKey)) {
      return machinesCache.get(cacheKey);
    }
    
    const machines = loadMachinesFromOntology(workspaceId, graphId);
    const machine = machines[type] || machines['Task'] || DEFAULT_MACHINES['Task'];
    
    machinesCache.set(cacheKey, machine);
    return machine;
  } catch (error) {
    console.error('getMachine error:', error.message);
    return DEFAULT_MACHINES['Task'];
  }
}

export function clearMachinesCache(workspaceId = null) {
  try {
    if (workspaceId) {
      for (const key of machinesCache.keys()) {
        if (key.startsWith(`${workspaceId}:`)) {
          machinesCache.delete(key);
        }
      }
    } else {
      machinesCache.clear();
    }
  } catch (error) {
    machinesCache.clear();
  }
}

export function getAllowedTransitions(type, currentStatus, workspaceId = 'ws-default', graphId = null) {
  try {
    const m = getMachine(type, workspaceId, graphId);
    const state = m.states[currentStatus] || m.states[m.initial];
    return Object.keys(state.on || {});
  } catch (error) {
    return [];
  }
}

export function transition(type, currentStatus, event, workspaceId = 'ws-default', graphId = null) {
  try {
    const m = getMachine(type, workspaceId, graphId);
    const state = m.states[currentStatus];
    
    if (!state) {
      return {
        ok: false,
        error: `Unknown status: ${currentStatus}`,
        allowed: []
      };
    }
    
    const next = state.on?.[event];
    
    if (!next) {
      return {
        ok: false,
        error: `Event ${event} not allowed from ${currentStatus}`,
        allowed: Object.keys(state.on || {})
      };
    }
    
    return { ok: true, from: currentStatus, to: next, event };
  } catch (error) {
    return { ok: false, error: error.message, allowed: [] };
  }
}

export function listMachines(workspaceId = 'ws-default', graphId = null) {
  try {
    const machines = loadMachinesFromOntology(workspaceId, graphId);
    
    return Object.entries(machines).map(([type, m]) => ({
      type,
      initial: m.initial,
      states: Object.keys(m.states || {}),
      transitions: Object.fromEntries(
        Object.entries(m.states || {}).map(([s, cfg]) => [s, Object.keys(cfg?.on || {})])
      ),
      source: DEFAULT_MACHINES[type] ? 'default' : 'custom'
    }));
  } catch (error) {
    console.error('listMachines error:', error.message);
    return [];
  }
}