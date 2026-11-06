// Count sessions once per page/transition; keep repeated traversals separately.
export function buildPaths(data, goalId) {
  const merged = new Map()
  for (const path of data.paths) {
    const goalIndex = path.steps.indexOf(goalId)
    const steps = goalIndex < 0 ? [...path.steps] : path.steps.slice(0, goalIndex + 1)
    if (!steps.length) continue
    const key = steps.join('>')
    if (merged.has(key)) merged.get(key).sessions += path.sessions
    else merged.set(key, {
      key, steps, sessions: path.sessions,
      converted: goalIndex >= 0,
      hasLoop: new Set(steps).size < steps.length,
    })
  }
  return [...merged.values()].sort((a, b) => b.sessions - a.sessions)
}

export function buildGraph(paths, goalId) {
  const edgeWeights = new Map()
  const nodeWeights = new Map([[goalId, 0]])
  const exits = new Map()
  for (const path of paths) {
    for (const id of new Set(path.steps)) {
      nodeWeights.set(id, (nodeWeights.get(id) || 0) + path.sessions)
    }
    if (!path.converted) {
      const last = path.steps.at(-1)
      exits.set(last, (exits.get(last) || 0) + path.sessions)
    }
    const seenEdges = new Set()
    const seenVisits = new Set([path.steps[0]])
    const seenKinds = new Set()
    path.steps.slice(0, -1).forEach((from, i) => {
      const to = path.steps[i + 1]
      const key = `${from}>${to}`
      if (!edgeWeights.has(key)) edgeWeights.set(key, { from, to, weight: 0, traversals: 0, pathKeys: new Set(), forward: { weight: 0, traversals: 0, pathKeys: new Set() }, returning: { weight: 0, traversals: 0, pathKeys: new Set() } })
      const edge = edgeWeights.get(key)
      const kind = seenVisits.has(to) ? 'returning' : 'forward'
      const flow = edge[kind]
      flow.traversals += path.sessions
      flow.pathKeys.add(path.key)
      if (!seenKinds.has(`${key}:${kind}`)) flow.weight += path.sessions
      seenKinds.add(`${key}:${kind}`)
      seenVisits.add(to)
      edge.traversals += path.sessions
      if (!seenEdges.has(key)) edge.weight += path.sessions
      edge.pathKeys.add(path.key)
      seenEdges.add(key)
    })
  }
  return { edgeWeights, nodeWeights, exits }
}

// Session totals already deduplicate first visits and revisits on the same step.
export function directedFlows(graph, includeRevisits = true) {
  return [...graph.edgeWeights.values()].map((edge) => ({
    ...edge,
    ...(includeRevisits ? {} : edge.forward),
    id: `${edge.from}>${edge.to}`,
    firstVisitTraversals: edge.forward.traversals,
    revisitTraversals: includeRevisits ? edge.returning.traversals : 0,
  })).filter((edge) => edge.weight > 0)
}

// Reverse breadth-first distances stay finite even when journeys contain cycles.
// Derive these from the full cohort, so display filters never rearrange the rings.
export function buildLayout(graph, goalId) {
  const ring = new Map([[goalId, 0]])
  const incoming = new Map()
  for (const edge of graph.edgeWeights.values()) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, [])
    incoming.get(edge.to).push(edge.from)
  }
  const queue = [goalId]
  for (let i = 0; i < queue.length; i++) {
    for (const from of incoming.get(queue[i]) || []) {
      if (ring.has(from)) continue
      ring.set(from, ring.get(queue[i]) + 1)
      queue.push(from)
    }
  }
  const reachable = new Set(ring.keys())
  const outerRing = Math.max(1, ...ring.values())
  // Keep non-converting destinations alongside the page sending them traffic.
  // They are browsing branches, not an extra step away from a reachable goal.
  for (const id of graph.nodeWeights.keys()) {
    if (ring.has(id)) continue
    const sources = [...graph.edgeWeights.values()]
      .filter((edge) => edge.to === id && reachable.has(edge.from))
      .sort((a, b) => b.weight - a.weight)
    ring.set(id, sources.length ? Math.max(1, ring.get(sources[0].from)) : outerRing)
  }
  const treeParent = new Map()
  for (const id of graph.nodeWeights.keys()) {
    if (id === goalId) continue
    const inward = [...graph.edgeWeights.values()]
      .filter((edge) => edge.from === id && ring.get(edge.to) < ring.get(id))
      .sort((a, b) => b.weight - a.weight)
    treeParent.set(id, inward[0]?.to || goalId)
  }
  return { ring, treeParent, reachable }
}
