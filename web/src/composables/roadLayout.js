const MEDIAN = 2.5
const SAMPLES = 80

function curvePoint(points, t) {
  const u = 1 - t
  const [a, b, c, d] = points
  return {
    x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y,
    dx: 3 * u ** 2 * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t ** 2 * (d.x - c.x),
    dy: 3 * u ** 2 * (b.y - a.y) + 6 * u * t * (c.y - b.y) + 3 * t ** 2 * (d.y - c.y),
  }
}

function offsetPoints(points, offset) {
  return points.map(({ x, y, dx, dy }) => {
    const length = Math.hypot(dx, dy) || 1
    return { x: x - dy / length * offset, y: y + dx / length * offset }
  })
}

function pathData(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ')
}

// Both directions derive from one curve, offset along its local normal.
// Reversing the samples gives arrows and particles the real travel direction.
export function buildRoadLayout(flows, positions, center, direction = 'radial') {
  const groups = new Map()
  const maxWeight = Math.max(1, ...flows.map((e) => e.weight))
  for (const flow of flows) {
    const id = JSON.stringify([flow.from, flow.to].sort())
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(flow)
  }
  const roads = []
  for (const [id, group] of groups) {
    // Stable orientation regardless of which direction has more traffic.
    group.sort((a, b) => a.from.localeCompare(b.from))
    const from = positions[group[0].from]
    const to = positions[group[0].to]
    if (!from || !to) continue
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy) || 1
    let controls
    if (group[0].from === group[0].to) {
      controls = [from, { x: from.x - 58, y: from.y - 80 }, { x: from.x + 58, y: from.y - 80 }, to]
    } else if (direction === 'horizontal') {
      controls = Math.abs(dx) < 40
        ? [from, { x: from.x + 65, y: from.y }, { x: to.x + 65, y: to.y }, to]
        : [from, { x: from.x + dx * 0.45, y: from.y }, { x: to.x - dx * 0.45, y: to.y }, to]
    } else if (from.ring === to.ring) {
      controls = [from,
        { x: from.x + dx / 3 - dy / length * 28, y: from.y + dy / 3 + dx / length * 28 },
        { x: from.x + dx * 2 / 3 - dy / length * 28, y: from.y + dy * 2 / 3 + dx / length * 28 }, to]
    } else {
      const radius = (from.radius + to.radius) / 2
      controls = [from,
        { x: center + radius * Math.cos(from.angle), y: center + radius * Math.sin(from.angle) },
        { x: center + radius * Math.cos(to.angle), y: center + radius * Math.sin(to.angle) }, to]
    }
    const samples = Array.from({ length: SAMPLES + 1 }, (_, i) => curvePoint(controls, i / SAMPLES))
    const paired = group.length === 2
    const widths = group.map((flow) => 5 + 13 * flow.weight / maxWeight)
    const lanes = group.map((flow, i) => {
      const offset = paired ? (i === 0 ? 1 : -1) * (MEDIAN + widths[i]) / 2 : 0
      const points = offsetPoints(samples, offset)
      if (i === 1) points.reverse()
      const markers = (length > 170 ? [0.35, 0.7] : [0.55]).map((fraction) => {
        const index = Math.round(SAMPLES * fraction)
        const p = points[index]
        const next = points[index + 1]
        return { x: p.x, y: p.y, angle: Math.atan2(next.y - p.y, next.x - p.x) * 180 / Math.PI }
      })
      return {
        ...flow, isPaired: paired, strokeWidth: widths[i], intensity: flow.weight / maxWeight,
        d: pathData(points), markers,
        x1: points[0].x, y1: points[0].y, x2: points.at(-1).x, y2: points.at(-1).y,
      }
    })
    roads.push({
      id, lanes, isPrimary: lanes.some((e) => e.isPrimary),
      d: pathData(offsetPoints(samples, paired ? (widths[0] - widths[1]) / 2 : 0)),
      strokeWidth: widths.reduce((a, b) => a + b, 0) + (paired ? MEDIAN : 0) + 2,
    })
  }
  return roads.sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary))
}
