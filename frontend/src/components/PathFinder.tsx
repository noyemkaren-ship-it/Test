import { useState } from 'react'

function bfs(edges: any[], from: string, to: string): string[] | null {
  if (from === to) return [from]
  const adj = new Map<string, string[]>()
  edges.forEach(e => {
    if (!adj.has(e.source)) adj.set(e.source, [])
    if (!adj.has(e.target)) adj.set(e.target, [])
    adj.get(e.source)!.push(e.target)
    adj.get(e.target)!.push(e.source)
  })
  const q = [from]
  const prev = new Map<string, string | null>([[from, null]])
  while (q.length) {
    const cur = q.shift()!
    for (const nb of adj.get(cur) || []) {
      if (prev.has(nb)) continue
      prev.set(nb, cur)
      if (nb === to) {
        const path = [to]
        let p: string | null = cur
        while (p) {
          path.push(p)
          p = prev.get(p) ?? null
        }
        return path.reverse()
      }
      q.push(nb)
    }
  }
  return null
}

export default function PathFinder({
  nodes,
  edges,
  onPath
}: {
  nodes: any[]
  edges: any[]
  onPath: (ids: string[]) => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [msg, setMsg] = useState('')

  function find() {
    if (!from || !to) return
    const path = bfs(edges, from, to)
    if (!path) {
      setMsg('Путь не найден на этой вкладке')
      onPath([])
      return
    }
    setMsg(`Путь: ${path.length - 1} шаг(ов)`)
    onPath(path)
  }

  return (
    <div className="panel">
      <h3>Путь между узлами</h3>
      <p className="sub-hint">Кратчайший путь по связям текущего графа</p>
      <div className="path-row">
        <select className="field" value={from} onChange={e => setFrom(e.target.value)}>
          <option value="">Откуда</option>
          {nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <select className="field" value={to} onChange={e => setTo(e.target.value)}>
          <option value="">Куда</option>
          {nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <button type="button" className="chip on" onClick={find}>Найти</button>
      </div>
      {msg && <p className="sub-hint">{msg}</p>}
    </div>
  )
}
