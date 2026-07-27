export type GraphPoint = { x: number; y: number }

export type GraphLayoutNode = {
  id: string
  position?: Partial<GraphPoint> | null
}

/**
 * Conservative card bounds plus a visible safety corridor for edges and labels.
 * Node cards are capped by CSS, so these values are intentionally a little larger.
 */
export const GRAPH_LAYOUT = Object.freeze({
  nodeWidth: 260,
  nodeHeight: 220,
  horizontalGap: 80,
  verticalGap: 60,
  stepX: 340,
  stepY: 280,
  maxCoordinate: 1_000_000
})

function finiteCoordinate(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(-GRAPH_LAYOUT.maxCoordinate, Math.min(GRAPH_LAYOUT.maxCoordinate, parsed))
}

export function fallbackGraphPosition(index: number): GraphPoint {
  return {
    x: 40 + (index % 4) * GRAPH_LAYOUT.stepX,
    y: 40 + Math.floor(index / 4) * GRAPH_LAYOUT.stepY
  }
}

export function graphPositionsOverlap(a: GraphPoint, b: GraphPoint) {
  return (
    a.x < b.x + GRAPH_LAYOUT.nodeWidth + GRAPH_LAYOUT.horizontalGap &&
    a.x + GRAPH_LAYOUT.nodeWidth + GRAPH_LAYOUT.horizontalGap > b.x &&
    a.y < b.y + GRAPH_LAYOUT.nodeHeight + GRAPH_LAYOUT.verticalGap &&
    a.y + GRAPH_LAYOUT.nodeHeight + GRAPH_LAYOUT.verticalGap > b.y
  )
}

function bucketKey(x: number, y: number) {
  return `${Math.floor(x / GRAPH_LAYOUT.stepX)}:${Math.floor(y / GRAPH_LAYOUT.stepY)}`
}

function ringOffsets(ring: number) {
  if (ring === 0) return [{ x: 0, y: 0 }]
  const offsets: GraphPoint[] = []
  for (let y = -ring; y <= ring; y += 1) {
    for (let x = -ring; x <= ring; x += 1) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue
      offsets.push({ x, y })
    }
  }
  return offsets.sort((a, b) => {
    const distanceA = a.x * a.x + a.y * a.y
    const distanceB = b.x * b.x + b.y * b.y
    if (distanceA !== distanceB) return distanceA - distanceB
    const directionA = (a.y < 0 ? 2 : 0) + (a.x < 0 ? 1 : 0)
    const directionB = (b.y < 0 ? 2 : 0) + (b.x < 0 ? 1 : 0)
    return directionA - directionB
  })
}

/**
 * Frontend safety net for broken/imported layouts.
 * Keeps every safe coordinate unchanged and moves only nodes that collide.
 */
export function separateGraphNodes(nodes: GraphLayoutNode[]) {
  const buckets = new Map<string, GraphPoint[]>()
  const result = new Map<string, GraphPoint>()
  const searchRings = Math.max(12, Math.ceil(Math.sqrt(nodes.length)) + 6)

  function nearby(position: GraphPoint) {
    const cellX = Math.floor(position.x / GRAPH_LAYOUT.stepX)
    const cellY = Math.floor(position.y / GRAPH_LAYOUT.stepY)
    const candidates: GraphPoint[] = []
    for (let y = cellY - 1; y <= cellY + 1; y += 1) {
      for (let x = cellX - 1; x <= cellX + 1; x += 1) {
        candidates.push(...(buckets.get(`${x}:${y}`) || []))
      }
    }
    return candidates
  }

  function isFree(position: GraphPoint) {
    return !nearby(position).some(existing => graphPositionsOverlap(position, existing))
  }

  function occupy(position: GraphPoint) {
    const key = bucketKey(position.x, position.y)
    const bucket = buckets.get(key) || []
    bucket.push(position)
    buckets.set(key, bucket)
  }

  nodes.forEach((node, index) => {
    const fallback = fallbackGraphPosition(index)
    const desired = {
      x: finiteCoordinate(node.position?.x, fallback.x),
      y: finiteCoordinate(node.position?.y, fallback.y)
    }
    let placed: GraphPoint | null = null

    for (let ring = 0; ring <= searchRings && !placed; ring += 1) {
      for (const offset of ringOffsets(ring)) {
        const candidate = {
          x: desired.x + offset.x * GRAPH_LAYOUT.stepX,
          y: desired.y + offset.y * GRAPH_LAYOUT.stepY
        }
        if (isFree(candidate)) {
          placed = candidate
          break
        }
      }
    }

    // Extremely dense graphs still get a deterministic, non-overlapping escape lane.
    if (!placed) {
      placed = { ...desired }
      do {
        placed = { x: placed.x, y: placed.y + GRAPH_LAYOUT.stepY }
      } while (!isFree(placed))
    }

    result.set(node.id, placed)
    occupy(placed)
  })

  return result
}
