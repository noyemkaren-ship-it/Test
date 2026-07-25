type GraphNode = {
  id: string
  label?: string
  kind?: string
  layer?: string
  description?: string
  nodeKind?: string
}

type GraphEdge = {
  source: string
  target: string
}

const PERSONA_PROFILES: Record<string, { ids: string[]; keywords: string[] }> = {
  mgmt: {
    ids: ['core', 'reg', 'ods', 'rep', 'ctrl', 'dom', 'proc', 'ai'],
    keywords: ['руковод', 'management', 'manager', 'owner', 'заказчик', 'customer', 'risk', 'control', 'стратег']
  },
  analyst: {
    ids: ['econ', 'cb', 'rep', 'ctrl', 'ods', 'ai', 'core'],
    keywords: ['аналит', 'analyst', 'эконом', 'report', 'отчет', 'форм', 'data', 'данн', 'metric', 'контрол']
  },
  dev: {
    ids: ['proc', 'rep', 'ods', 'ctrl', 'stand', 'core', 'self-graph'],
    keywords: ['разработ', 'developer', 'dev', 'implementation', 'service', 'api', 'process', 'процесс', 'code', 'систем']
  },
  aian: {
    ids: ['aian', 'p-aian', 'ai', 'stand', 'valid', 'core', 'migr', 'self-copilot'],
    keywords: ['инженер ии', 'ai engineer', 'artificial', 'copilot', 'rag', 'model', 'модел', 'eval', 'synthetic', 'knowledge', 'знан']
  }
}

export function expandFocus(seedIds: Iterable<string>, edges: GraphEdge[], depth: number) {
  const focused = new Set(seedIds)
  let frontier = new Set(focused)

  for (let step = 0; step < depth; step += 1) {
    const next = new Set<string>()
    edges.forEach(edge => {
      if (frontier.has(edge.source) && !focused.has(edge.target)) next.add(edge.target)
      if (frontier.has(edge.target) && !focused.has(edge.source)) next.add(edge.source)
    })
    next.forEach(id => focused.add(id))
    frontier = next
    if (!frontier.size) break
  }

  return focused
}

export function getPersonaFocus(nodes: GraphNode[], edges: GraphEdge[], persona: string | null, depth = 1) {
  if (!persona || persona === 'all') return new Set<string>()
  const profile = PERSONA_PROFILES[persona]
  if (!profile) return new Set<string>()
  const nodeIds = new Set(nodes.map(node => node.id))
  const seeds = new Set(profile.ids.filter(id => nodeIds.has(id)))

  nodes.forEach(node => {
    const text = [node.id, node.label, node.kind, node.layer, node.description, node.nodeKind]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (profile.keywords.some(keyword => text.includes(keyword))) seeds.add(node.id)
  })

  return expandFocus(seeds, edges, depth)
}
