// Positions come from the full graph so filters never move a page underneath
// the pointer. Distance from the goal places conversion toward the right.
export function buildJourneyLayout(pages, graph, layout, goalId) {
  const maxDistance = Math.max(1, ...layout.ring.values())
  const width = Math.max(900, maxDistance * 175 + 180)
  const columns = new Map()
  const pageOrder = new Map(pages.map((page, index) => [page.id, index]))
  for (const id of graph.nodeWeights.keys()) {
    const column = maxDistance - (layout.ring.get(id) ?? maxDistance)
    if (!columns.has(column)) columns.set(column, [])
    columns.get(column).push(id)
  }
  const largestColumn = Math.max(1, ...[...columns.values()].map(ids => ids.length))
  const height = Math.max(430, largestColumn * 110 + 100)
  const positions = new Map()
  for (const [column, ids] of columns) {
    ids.sort((a, b) => (graph.nodeWeights.get(b) || 0) - (graph.nodeWeights.get(a) || 0) || (pageOrder.get(a) ?? 0) - (pageOrder.get(b) ?? 0))
    ids.forEach((id, index) => {
      // Put the busiest page in the middle and alternate supporting pages above/below.
      const slot = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? -1 : 1)
      const offset = ids.length % 2 === 0 ? 55 : 0
      positions.set(id, { x: 90 + column / maxDistance * (width - 180), y: height / 2 + slot * 110 + offset, ring: layout.ring.get(id) || 0 })
    })
  }
  return { width, height, positions, goalPosition: positions.get(goalId) || { x: width - 90, y: height / 2, ring: 0 } }
}
