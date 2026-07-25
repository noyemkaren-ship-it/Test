import { useMemo, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  Handle,
  Position
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const LAYOUT: Record<string, Record<string, { x: number; y: number }>> = {
  asis: {
    'a-auditor': { x: 40, y: 40 },
    'a-cb': { x: 900, y: 40 },
    'a-tech': { x: 40, y: 180 },
    'a-dev': { x: 280, y: 180 },
    'a-econ': { x: 700, y: 180 },
    'a-heads': { x: 40, y: 340 },
    'a-abs': { x: 280, y: 340 },
    'a-ods': { x: 500, y: 340 },
    'a-frw': { x: 720, y: 340 },
    'a-f101': { x: 900, y: 180 }
  },
  process: {
    'p-aian': { x: 40, y: 160 },
    s1: { x: 280, y: 40 },
    s2: { x: 500, y: 40 },
    s3: { x: 720, y: 40 },
    s4: { x: 500, y: 200 },
    s5: { x: 720, y: 200 },
    s6: { x: 940, y: 120 }
  },
  tobe: {
    reg: { x: 40, y: 40 },
    ods: { x: 40, y: 160 },
    rep: { x: 40, y: 280 },
    ctrl: { x: 40, y: 400 },
    dom: { x: 40, y: 520 },
    proc: { x: 260, y: 520 },
    ai: { x: 480, y: 520 },
    core: { x: 420, y: 220 },
    stand: { x: 700, y: 40 },
    valid: { x: 700, y: 160 },
    migr: { x: 700, y: 280 },
    'self-graph': { x: 700, y: 400 },
    'self-copilot': { x: 700, y: 520 },
    aian: { x: 940, y: 160 },
    econ: { x: 940, y: 320 },
    cb: { x: 940, y: 40 }
  }
}

const ROLE_VIEWS: Record<string, string[]> = {
  mgmt: ['core', 'reg', 'ods', 'rep', 'ctrl', 'dom', 'proc', 'ai'],
  econ: ['econ', 'cb', 'rep', 'ctrl', 'ods', 'ai', 'core'],
  aian: ['aian', 'ai', 'stand', 'valid', 'core', 'migr', 'self-copilot'],
  dev: ['proc', 'rep', 'ods', 'ctrl', 'stand', 'core', 'self-graph']
}

function NodeView({ data }: any) {
  const hl = data.highlight || ''
  const kind = data.nodeKind || 'default'
  return (
    <div className={`gp-node gp-${kind} ${hl === 'hl' ? 'is-hl' : ''} ${hl === 'dim' ? 'is-dim' : ''}`}>
      <Handle type="target" position={Position.Left} className="gp-handle" id="t" />
      {data.badge && <span className={`gp-badge gp-badge-${data.badge}`}>{data.badge}</span>}
      <div className="gp-kind">{data.kind}{data.layer ? ` · ${data.layer}` : ''}</div>
      <div className="gp-title">{data.label}</div>
      {data.description && <div className="gp-desc">{data.description}</div>}
      <Handle type="source" position={Position.Right} className="gp-handle" id="s" />
    </div>
  )
}

const nodeTypes = {
  role: NodeView,
  domain: NodeView,
  core: NodeView,
  service: NodeView,
  note: NodeView,
  step: NodeView,
  act: NodeView,
  default: NodeView
}

function GraphInner({ nodes, edges, pinned, highlightIds = [], roleView, activeTab, onPin }: any) {
  const { fitView } = useReactFlow()
  const tab = activeTab || 'tobe'

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        fitView({ padding: 0.18, duration: 200, maxZoom: 1 })
      } catch { /* */ }
    })
    return () => cancelAnimationFrame(id)
  }, [fitView])

  const nodeIds = useMemo(() => new Set(nodes.map((n: any) => n.id)), [nodes])

  const rfNodes = useMemo(() => {
    const layout = LAYOUT[tab] || {}
    const focus = new Set<string>()
    if (pinned) focus.add(pinned)
    ;(highlightIds || []).forEach((id: string) => focus.add(id))
    if (pinned) {
      edges.forEach((e: any) => {
        if (e.source === pinned && nodeIds.has(e.target)) focus.add(e.target)
        if (e.target === pinned && nodeIds.has(e.source)) focus.add(e.source)
      })
    }

    return nodes.map((n: any, i: number) => {
      let highlight = ''
      if (focus.size > 0) highlight = focus.has(n.id) ? 'hl' : 'dim'
      else if (roleView && tab === 'tobe') {
        const allowed = ROLE_VIEWS[roleView] || []
        highlight = allowed.includes(n.id) ? 'hl' : 'dim'
      }
      const pos = layout[n.id] || { x: 40 + (i % 4) * 230, y: 40 + Math.floor(i / 4) * 130 }
      return {
        id: n.id,
        type: (n.nodeKind && (nodeTypes as any)[n.nodeKind]) ? n.nodeKind : 'default',
        position: { x: pos.x, y: pos.y },
        data: {
          label: n.label,
          kind: n.kind,
          layer: n.layer,
          description: n.description,
          badge: n.badge,
          nodeKind: n.nodeKind,
          highlight
        },
        selected: n.id === pinned,
        draggable: true
      }
    })
  }, [nodes, edges, pinned, highlightIds, roleView, tab, nodeIds])

  const rfEdges = useMemo(() => {
    const valid = edges.filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target))
    const focus = new Set<string>()
    if (pinned) {
      focus.add(pinned)
      valid.forEach((e: any) => {
        if (e.source === pinned) focus.add(e.target)
        if (e.target === pinned) focus.add(e.source)
      })
    }
    ;(highlightIds || []).forEach((id: string) => focus.add(id))

    return valid.map((e: any) => {
      let active = false
      if (focus.size > 0) {
        active = e.source === pinned || e.target === pinned || (focus.has(e.source) && focus.has(e.target))
      } else if (roleView && tab === 'tobe') {
        const allowed = ROLE_VIEWS[roleView] || []
        active = allowed.includes(e.source) && allowed.includes(e.target)
      }
      const dimmed = focus.size > 0 && !active
      return {
        id: `${tab}-${e.id || e.source + '-' + e.target}`,
        source: e.source,
        target: e.target,
        label: dimmed ? undefined : e.label || undefined,
        animated: !!active,
        type: 'smoothstep' as const,
        style: {
          stroke: active ? '#5b9bd8' : '#5a6a7e',
          strokeWidth: active ? 2.8 : 1.8,
          opacity: dimmed ? 0.12 : 0.95
        },
        labelStyle: { fill: '#c5d0dc', fontSize: 11, fontWeight: 500 },
        labelBgStyle: { fill: '#1a2129', fillOpacity: 0.92 },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: active ? '#5b9bd8' : '#5a6a7e',
          width: 18,
          height: 18
        }
      }
    })
  }, [edges, pinned, highlightIds, roleView, tab, nodeIds])

  const onNodeClick = useCallback(
    (_: any, node: any) => onPin(pinned === node.id ? null : node.id),
    [pinned, onPin]
  )

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={() => onPin(null)}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      edgesFocusable={false}
      nodesDraggable
      panOnDrag
      zoomOnScroll
      deleteKeyCode={null}
    >
      <Background gap={18} size={1} color="#2a323d" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        nodeColor={(n) => (n.data?.highlight === 'hl' ? '#5b9bd8' : '#3a4555')}
        maskColor="rgba(0,0,0,0.45)"
        style={{ background: '#1a2129', border: '1px solid #2a323d', borderRadius: 8 }}
      />
    </ReactFlow>
  )
}

export default function FlowCanvas(props: any) {
  return (
    <div className="flow-root" style={{ width: '100%', height: '100%', minHeight: 480 }}>
      <ReactFlowProvider>
        <GraphInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}
