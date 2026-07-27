import { useMemo, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  Handle,
  Position,
  type Connection
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { expandFocus, getPersonaFocus } from '../graphFocus'
import { fallbackGraphPosition, separateGraphNodes } from '../graphLayout'

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

function NodeView({ data }: any) {
  const hl = data.highlight || ''
  const kind = data.nodeKind || 'default'
  return (
    <div className={`gp-node gp-${kind} ${hl === 'hl' ? 'is-hl' : ''} ${hl === 'root' ? 'is-root' : ''} ${hl === 'dim' ? 'is-dim' : ''}`}>
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

function GraphInner({
  nodes,
  edges,
  pinned,
  selectedEdgeId,
  highlightIds = [],
  roleView,
  activeTab,
  relationDepth = 1,
  motion = true,
  canEdit = false,
  onPin,
  onSelectEdge,
  onMoveNode,
  onConnectNodes
}: any) {
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
  const validEdges = useMemo(
    () => edges.filter((edge: any) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    [edges, nodeIds]
  )
  const focus = useMemo(() => {
    if (pinned) return expandFocus([pinned], validEdges, relationDepth)
    if (highlightIds?.length) return new Set<string>(highlightIds)
    return getPersonaFocus(nodes, validEdges, roleView, relationDepth)
  }, [nodes, validEdges, pinned, highlightIds, roleView, relationDepth])

  const rfNodes = useMemo(() => {
    const layout = LAYOUT[tab] || {}
    const desiredPositions = nodes.map((n: any, i: number) => {
      const stored = n.data?.position
      const hasStoredPosition = Number.isFinite(Number(stored?.x)) && Number.isFinite(Number(stored?.y))
      return {
        id: n.id,
        position: hasStoredPosition
          ? { x: Number(stored.x), y: Number(stored.y) }
          : (layout[n.id] || fallbackGraphPosition(i))
      }
    })
    const safePositions = separateGraphNodes(desiredPositions)

    return nodes.map((n: any, i: number) => {
      let highlight = ''
      if (focus.size > 0) highlight = focus.has(n.id) ? (n.id === pinned ? 'root' : 'hl') : 'dim'
      const pos = safePositions.get(n.id) || fallbackGraphPosition(i)
      return {
        id: n.id,
        type: (n.nodeKind && (nodeTypes as any)[n.nodeKind]) ? n.nodeKind : 'default',
        position: pos,
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
  }, [nodes, pinned, tab, focus])

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(rfNodes)

  useEffect(() => {
    setFlowNodes(rfNodes)
  }, [rfNodes, setFlowNodes])

  const rfEdges = useMemo(() => {
    return validEdges.map((e: any) => {
      const active = focus.size > 0 && focus.has(e.source) && focus.has(e.target)
      const dimmed = focus.size > 0 && !active
      return {
        id: e.id || `${tab}-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        label: dimmed ? undefined : e.label || undefined,
        animated: !!active && motion,
        type: 'smoothstep' as const,
        style: {
          stroke: active ? 'var(--graph-edge-active)' : 'var(--graph-edge)',
          strokeWidth: active ? 3 : 1.6,
          opacity: dimmed ? 0.12 : 0.95
        },
        labelStyle: { fill: 'var(--graph-label)', fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: 'var(--graph-label-bg)', fillOpacity: 0.94 },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 4,
        selected: e.id === selectedEdgeId,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: active ? 'var(--graph-edge-active)' : 'var(--graph-edge)',
          width: 18,
          height: 18
        }
      }
    })
  }, [validEdges, focus, tab, motion, selectedEdgeId])

  const onNodeClick = useCallback(
    (_: any, node: any) => onPin(pinned === node.id ? null : node.id),
    [pinned, onPin]
  )

  const onEdgeClick = useCallback(
    (_: any, edge: any) => {
      onSelectEdge?.(edge.id === selectedEdgeId ? null : edge.id)
      onPin(null)
    },
    [onPin, onSelectEdge, selectedEdgeId]
  )

  const onConnect = useCallback((connection: Connection) => {
    if (canEdit && connection.source && connection.target) onConnectNodes?.(connection)
  }, [canEdit, onConnectNodes])

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={onNodeClick}
      onNodeDragStop={(_, node) => onMoveNode?.(node.id, node.position)}
      onEdgeClick={onEdgeClick}
      onConnect={onConnect}
      onPaneClick={() => { onPin(null); onSelectEdge?.(null) }}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={canEdit}
      edgesFocusable
      nodesDraggable
      panOnDrag
      zoomOnScroll
      deleteKeyCode={null}
    >
      <Background gap={18} size={1} color="var(--graph-grid)" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        nodeColor={(n) => (n.data?.highlight === 'hl' || n.data?.highlight === 'root' ? 'var(--graph-edge-active)' : 'var(--graph-minimap-node)')}
        maskColor="var(--graph-minimap-mask)"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10 }}
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
