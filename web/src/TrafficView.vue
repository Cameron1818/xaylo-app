<script setup>
import { ref, computed, watch } from 'vue'
import { useTrafficData } from './composables/useTrafficData'
import JourneyMap from './components/JourneyMap.vue'
import PathList from './components/PathList.vue'
import Filters from './components/Filters.vue'
import Tooltip from './components/Tooltip.vue'
const props = defineProps({ traffic: { type: Object, required: true } })

const {
  pages,
  goalId,
  goalOptions,
  goal,
  minSessions,
  maxPathSessions,
  focusId,
  period,
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
  mapWidth,
  mapHeight,
  goalPosition,
  highlightForNode,
  highlightForPathKey,
  highlightForPathKeys,
} = useTrafficData(props.traffic)

const pagesById = computed(() => Object.fromEntries(pages.map((p) => [p.id, p])))

const hoveredNodeId = ref(null)
const hoveredEdgeId = ref(null)
const hoveredPathKey = ref(null)
const selectedPathKey = ref(null)
const activePathKey = computed(() => hoveredPathKey.value || selectedPathKey.value)
const centerHovered = ref(false)
const mouse = ref({ x: 0, y: 0 })

function onHoverNode(id) {
  hoveredNodeId.value = id
}
function onLeave() {
  hoveredNodeId.value = null
}
function onHoverEdge(id) {
  hoveredEdgeId.value = id
}
function onHoverCenter() {
  centerHovered.value = true
}
function onLeaveCenter() {
  centerHovered.value = false
}
function onHoverPath(key) {
  hoveredPathKey.value = key
}
function onLeavePath() {
  hoveredPathKey.value = null
}
function onSelectPath(key) {
  selectedPathKey.value = selectedPathKey.value === key ? null : key
  hoveredPathKey.value = null
}
watch(topPaths, paths => {
  if (!paths.some(path => path.key === selectedPathKey.value)) selectedPathKey.value = null
  if (!paths.some(path => path.key === hoveredPathKey.value)) hoveredPathKey.value = null
})
function onMouseMove(e) {
  mouse.value = { x: e.clientX, y: e.clientY }
}

const activeHighlight = computed(() => {
  if (activePathKey.value) return highlightForPathKey(activePathKey.value)
  if (hoveredEdgeId.value) {
    const edge = edges.value.find((e) => e.id === hoveredEdgeId.value)
    if (edge) return highlightForPathKeys(edge.pathKeys)
  }
  if (hoveredNodeId.value) return highlightForNode(hoveredNodeId.value)
  if (focusId.value) return highlightForNode(focusId.value)
  return null
})

const hoveredNode = computed(() => nodes.value.find((n) => n.id === hoveredNodeId.value) || null)
const hoveredEdge = computed(() => {
  const e = edges.value.find((x) => x.id === hoveredEdgeId.value)
  if (!e) return null
  const from = pagesById.value[e.from]
  const to = e.to === goalId.value ? goal.value : pagesById.value[e.to]
  return {
    weight: e.weight,
    traversals: e.traversals,
    firstVisitTraversals: e.firstVisitTraversals,
    revisitTraversals: e.revisitTraversals,
    includesRevisits: showReturnTraffic.value,
    isExitBranch: e.isExitBranch,
    fromIcon: from?.icon,
    fromLabel: from?.label,
    toIcon: to?.icon,
    toLabel: to?.shortLabel || to?.label,
  }
})

const tooltipData = computed(() => hoveredEdge.value || hoveredNode.value)
const topPage = computed(() => [...nodes.value].sort((a, b) => b.weight - a.weight)[0])
</script>

<template>
  <div class="app" @mousemove="onMouseMove">
    <header class="app-header">
      <div class="title-block">
        <h1>Traffic journeys</h1>
        <p>Explore how visitors browse, compare and return before <strong>{{ goal.label }}</strong>.</p>
      </div>
      <div class="stats">
        <div class="stat-card">
          <span class="stat-label">Period</span>
          <span class="stat-value">{{ period }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Total sessions</span>
          <span class="stat-value">{{ totalSessions.toLocaleString() }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">{{ goal.label }}</span>
          <span class="stat-value">{{ convertedSessions.toLocaleString() }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Conversion rate</span>
          <span class="stat-value">{{ (conversionRate * 100).toFixed(1) }}%</span>
        </div>
        <div class="stat-card" v-if="topPage">
          <span class="stat-label">Top contributor</span>
          <span class="stat-value">{{ topPage.icon }} {{ topPage.label }}</span>
        </div>
      </div>
    </header>

    <Filters
      :pages="pages"
      :goal-options="goalOptions"
      :goal-id="goalId"
      :min-sessions="minSessions"
      :max-path-sessions="maxPathSessions"
      :focus-id="focusId"
      :show-return-traffic="showReturnTraffic"
      :journey-type="journeyType"
      @update:show-return-traffic="showReturnTraffic = $event"
      @update:journey-type="journeyType = $event"
      @update:goal-id="goalId = $event"
      @update:min-sessions="minSessions = $event"
      @update:focus-id="focusId = $event"
    />

    <section class="funnel-summary" aria-label="Page reach across all sessions">
      <div v-for="stage in funnelStages" :key="stage.id" class="funnel-stage">
        <span>{{ stage.icon }} {{ stage.label }}</span>
        <strong>{{ stage.sessions.toLocaleString() }} <small>{{ totalSessions ? (stage.sessions / totalSessions * 100).toFixed(1) : '0.0' }}%</small></strong>
        <div class="reach-track"><div :style="{ width: `${totalSessions ? stage.sessions / totalSessions * 100 : 0}%` }"></div></div>
      </div>
      <p>Page reach · each session counted once per page, including return visits. Totals above always cover all sessions.</p>
    </section>

    <main class="app-main">
      <div class="board-wrap">
        <div class="map-heading"><div><h2>Visitor journeys</h2><p>Follow the paths from your website pages to conversion.</p></div></div>
        <div class="board-legend">
          <span><i class="primary-key"></i> Main routes</span>
          <span><i class="alternative-key"></i> Alternative & return routes</span>
          <span><b class="direction-key">→</b> Travel direction</span>
          <span v-if="!showReturnTraffic">First visits only</span>
          <span><i class="exit-key"></i> Exit branch</span>
        </div>
        <JourneyMap
          :nodes="nodes"
          :edges="edges"
          :roads="roads"
          :goal="goal"
          :converted-sessions="convertedSessions"
          :goal-position="goalPosition"
          :map-width="mapWidth"
          :map-height="mapHeight"
          :highlight-set="activeHighlight"
          :center-hovered="centerHovered"
          @pointer-position="onMouseMove"
          @hover-node="onHoverNode"
          @leave="onLeave"
          @hover-edge="onHoverEdge"
          @hover-center="onHoverCenter"
          @leave-center="onLeaveCenter"
        />
        <p class="board-caption">{{ visibleSessions.toLocaleString() }} of {{ totalSessions.toLocaleString() }} sessions shown · {{ topPaths.length }} journeys. Thicker lines carry more sessions. Gold/orange lines show main routes; purple lines show alternative and return routes. Moving dots show travel direction, not live visitors. Hover a line to see first visits and revisits.{{ showReturnTraffic ? '' : ' Revisit traffic is hidden; session totals are unchanged.' }}</p>
      </div>

      <PathList
        :top-paths="topPaths"
        :active-path-key="activePathKey"
        :selected-path-key="selectedPathKey"
        :goal="goal"
        @hover="onHoverPath"
        @leave="onLeavePath"
        @select="onSelectPath"
      />
    </main>

    <Tooltip
      :data="tooltipData"
      :x="mouse.x"
      :y="mouse.y"
      :is-edge="!!hoveredEdge"
      :total-sessions="totalSessions"
    />
    <Tooltip
      v-if="centerHovered"
      :data="goal"
      :x="mouse.x"
      :y="mouse.y"
      is-goal
      :total-sessions="convertedSessions"
    />

  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 32px clamp(16px, 4vw, 56px) 40px;
}

.app-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
}

.title-block h1 {
  margin: 0 0 6px;
  font-size: clamp(22px, 3vw, 30px);
  letter-spacing: 0.3px;
}
.title-block p {
  margin: 0;
  color: #9aa0c3;
  max-width: 560px;
  font-size: 14px;
  line-height: 1.5;
}
.title-block strong {
  color: #e8b923;
}

.stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.stat-card {
  background: rgba(20, 20, 32, 0.6);
  border: 1px solid #2a2a42;
  border-radius: 12px;
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 120px;
}
.stat-label {
  font-size: 11px;
  color: #7d82a3;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.stat-value {
  font-size: 16px;
  font-weight: 700;
  color: #fff6d8;
}

.app-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.board-wrap {
  gap: 16px;
  display: flex;
  justify-content: center;
  min-width: 0;
  flex-direction: column;
  align-items: center;
}

.app-footer {
  text-align: center;
  color: #565a77;
  font-size: 12px;
  margin-top: auto;
}
</style>

<style scoped>
.funnel-summary { display: flex; flex-wrap: wrap; gap: 18px; padding: 18px; border: 1px solid #2a2a42; border-radius: 14px; background: #14142099; }
.funnel-stage { flex: 1 1 150px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #b9bedb; }
.funnel-stage strong { font-size: 22px; color: #fff6d8; }
.funnel-stage small { font-size: 12px; color: #9aa0c3; margin-left: 8px; }
.reach-track { height: 5px; border-radius: 5px; background: #2a2a42; overflow: hidden; }
.reach-track div { height: 100%; background: #e8b923; border-radius: inherit; }
.funnel-summary p { flex-basis: 100%; margin: 0; font-size: 12px; color: #9aa0c3; }
.board-legend { width:100%; display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 18px; font-size: 12px; color: #b9bedb; }
.board-legend i { display: inline-block; width: 18px; height: 4px; border-radius: 4px; vertical-align: middle; margin-right: 5px; }
.board-legend .primary-key { background: linear-gradient(90deg, #b78037, #f1c44d); }
.board-legend .alternative-key { background: linear-gradient(90deg, #8170bd, #b7a2ed); }
.map-heading { width:100%; }
.map-heading h2 { margin:0 0 7px; font-size:18px; font-weight:600; color:#e1e4ed; }
.map-heading p { margin:0; font-size:12px; color:#8d98ad; }
.direction-key { color: #fff6d8; margin-right: 5px; }
.exit-key { background: repeating-linear-gradient(90deg, #7b879e 0 4px, transparent 4px 7px); }
.board-caption { max-width: 850px; margin:0; color: #9aa0c3; font-size: 12px; line-height: 1.6; text-align: center; }
</style>
