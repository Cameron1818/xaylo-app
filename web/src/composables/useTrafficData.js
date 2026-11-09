import { ref, computed, watch } from 'vue'
import { buildRoadLayout } from './roadLayout.js'
import { buildJourneyLayout } from './journeyLayout.js'
import { buildPaths, buildGraph, buildLayout, directedFlows } from './trafficModel.js'

const MIN_NODE_R = 11
const MAX_NODE_R = 21

function lerp(min, max, t) {
  return min + (max - min) * t
}

export function useTrafficData(rawData) {
  const pages = rawData.pages
  const pagesById = Object.fromEntries(pages.map((p) => [p.id, p]))

  const goalOptions = computed(() => pages.filter((p) => p.isConversion === true))
  const goalId = ref(goalOptions.value.find((p) => p.id === rawData.defaultGoal)?.id || goalOptions.value[0]?.id)
  const minSessions = ref(0)
  const focusId = ref(null)
  const showReturnTraffic = ref(true)
  const journeyType = ref('all')
  const goal = computed(() => pagesById[goalId.value])
  watch(goalId, () => {
    minSessions.value = 0
    focusId.value = null
  })

  const allPaths = computed(() => buildPaths(rawData, goalId.value))
  const maxPathSessions = computed(() => Math.max(0, ...allPaths.value.map((p) => p.sessions)))
  const visiblePaths = computed(() => allPaths.value.filter((p) =>
    p.sessions >= minSessions.value &&
    (journeyType.value === 'all' || (journeyType.value === 'converted' ? p.converted : p.hasLoop))
  ))
  const totalSessions = computed(() => allPaths.value.reduce((sum, p) => sum + p.sessions, 0))
  const convertedSessions = computed(() => allPaths.value.reduce((sum, p) => sum + (p.converted ? p.sessions : 0), 0))
  const conversionRate = computed(() => totalSessions.value ? convertedSessions.value / totalSessions.value : 0)
  const visibleSessions = computed(() => visiblePaths.value.reduce((sum, p) => sum + p.sessions, 0))
  const fullGraph = computed(() => buildGraph(allPaths.value, goalId.value))
  const layout = computed(() => buildLayout(fullGraph.value, goalId.value))
  const funnelStages = computed(() => (goal.value.funnelSteps || [pages.find((p) => p.isEntry)?.id, goalId.value])
    .filter((id, i, ids) => pagesById[id] && ids.indexOf(id) === i)
    .map((id) => ({ ...pagesById[id], sessions: fullGraph.value.nodeWeights.get(id) || 0 })))

  const graph = computed(() => {
    const current = buildGraph(visiblePaths.value, goalId.value)
    const childrenOf = new Map()
    for (const [id, parent] of layout.value.treeParent) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, [])
      childrenOf.get(parent).push(id)
    }
    return {
      ...current, ...layout.value, childrenOf,
      subtreeWeight: fullGraph.value.nodeWeights,
      nodeIds: new Set(current.nodeWeights.keys()),
    }
  })

  const journeyLayout = computed(() => buildJourneyLayout(pages, fullGraph.value, layout.value, goalId.value))

  const nodes = computed(() => {
    const { ring, nodeWeights, exits, nodeIds } = graph.value
    const maxWeight = Math.max(1, ...[...fullGraph.value.nodeWeights.values()])
    const list = []
    for (const id of nodeIds) {
      if (id === goalId.value) continue
      const r = ring.get(id)
      const weight = nodeWeights.get(id) || 0
      const t = weight / maxWeight
      const nodeRadius = lerp(MIN_NODE_R, MAX_NODE_R, t)
      const pos = journeyLayout.value.positions.get(id)
      const page = pagesById[id] || { id, label: id, icon: '\u2022' }
      list.push({
        ...page,
        ring: r,
        hasRoute: layout.value.reachable.has(id),
        x: pos.x,
        y: pos.y,
        labelX: pos.x,
        labelY: pos.y + nodeRadius + 22,
        weight,
        exits: exits.get(id) || 0,
        intensity: t,
        nodeRadius,
      })
    }
    return list.sort((a, b) => a.ring - b.ring)
  })

  const nodesById = computed(() => Object.fromEntries(nodes.value.map((n) => [n.id, n])))

  const roads = computed(() => {
    const positions = {
      ...nodesById.value,
      [goalId.value]: journeyLayout.value.goalPosition,
    }
    const flows = directedFlows(graph.value, showReturnTraffic.value).map((edge) => ({
      ...edge,
      isExitBranch: !layout.value.reachable.has(edge.to),
      isPrimary: graph.value.treeParent.get(edge.from) === edge.to,
    }))
    return buildRoadLayout(flows, positions, 0, 'horizontal')
  })
  const edges = computed(() => roads.value.flatMap((road) => road.lanes))

  const topPaths = computed(() =>
    visiblePaths.value.map((p) => ({
      ...p,
      share: visibleSessions.value ? p.sessions / visibleSessions.value : 0,
      pages: p.steps.map((id) => pagesById[id] || { id, label: id, icon: '\u2022' }),
    }))
  )

  function highlightForNode(nodeId) {
    if (!nodeId) return null
    const pathKeys = new Set(visiblePaths.value.filter((p) => p.steps.includes(nodeId)).map((p) => p.key))
    return highlightForPathKeys(pathKeys)
  }

  function highlightForPathKey(pathKey) {
    if (!pathKey) return null
    return highlightForPathKeys(new Set([pathKey]))
  }

  function highlightForPathKeys(pathKeys) {
    const nodeSet = new Set()
    const edgeSet = new Set()
    for (const p of visiblePaths.value) {
      if (!pathKeys.has(p.key)) continue
      p.steps.forEach((id, i) => {
        nodeSet.add(id)
        if (i < p.steps.length - 1) {
          const to = p.steps[i + 1]
          const returning = p.steps.slice(0, i + 1).includes(to)
          if (showReturnTraffic.value || !returning) edgeSet.add(`${id}>${to}`)
        }
      })
    }
    return { nodeIds: nodeSet, edgeIds: edgeSet }
  }

  return {
    pages,
    goalId,
    goalOptions,
    goal,
    minSessions,
    maxPathSessions,
    focusId,
    period: rawData.period,
    nodes,
    edges,
    roads,
    topPaths,
    totalSessions,
    convertedSessions,
    conversionRate,
    visibleSessions,
    funnelStages,
    showReturnTraffic,
    journeyType,
    mapWidth: computed(() => journeyLayout.value.width),
    mapHeight: computed(() => journeyLayout.value.height),
    goalPosition: computed(() => journeyLayout.value.goalPosition),
    highlightForNode,
    highlightForPathKey,
    highlightForPathKeys,
  }
}
