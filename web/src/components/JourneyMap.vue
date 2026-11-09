<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  nodes: { type: Array, required: true }, edges: { type: Array, required: true }, roads: { type: Array, required: true },
  convertedSessions: { type: Number, default: 0 }, goal: { type: Object, required: true },
  goalPosition: { type: Object, required: true }, mapWidth: { type: Number, required: true }, mapHeight: { type: Number, required: true },
  highlightSet: { type: Object, default: null }, centerHovered: { type: Boolean, default: false },
})
const emit = defineEmits(['hover-node', 'leave', 'hover-center', 'leave-center', 'hover-edge', 'pointer-position'])
const hoveredEdgeId = ref(null)
const motionAllowed = ref(false)
let motionPreference
function updateMotionPreference() { motionAllowed.value = !motionPreference.matches }
onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  updateMotionPreference()
  motionPreference.addEventListener('change', updateMotionPreference)
})
onBeforeUnmount(() => motionPreference?.removeEventListener('change', updateMotionPreference))
const prefix = `journey-${Math.random().toString(36).slice(2, 10)}`
const gradients = computed(() => new Map(props.edges.map((edge, index) => [edge.id, `${prefix}-route-${index}`])))
const palettes = { primary: ['#b78037', '#f1c44d'], alternative: ['#8170bd', '#b7a2ed'], exit: ['#58657d', '#7b879e'] }
function particleCount(edge) { return 1 + Math.round(edge.intensity * 2) }
function travelDuration(edge) { return Math.max(3, Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1) / 55) }
function tone(edge) {
  if (edge.isExitBranch) return 'exit'
  return edge.isPrimary && edge.revisitTraversals <= edge.firstVisitTraversals ? 'primary' : 'alternative'
}
function isEdgeDim(edge) {
  if (hoveredEdgeId.value) return hoveredEdgeId.value !== edge.id
  if (props.centerHovered) return false
  return !!props.highlightSet && !props.highlightSet.edgeIds.has(edge.id)
}
function isEdgeActive(edge) { return hoveredEdgeId.value ? hoveredEdgeId.value === edge.id : props.centerHovered || !!props.highlightSet?.edgeIds.has(edge.id) }
function isNodeDim(id) {
  if (hoveredEdgeId.value) { const edge = props.edges.find(item => item.id === hoveredEdgeId.value); return !!edge && edge.from !== id && edge.to !== id }
  return !props.centerHovered && !!props.highlightSet && !props.highlightSet.nodeIds.has(id)
}
function isNodeActive(id) {
  if (hoveredEdgeId.value) { const edge = props.edges.find(item => item.id === hoveredEdgeId.value); return !!edge && (edge.from === id || edge.to === id) }
  return !!props.highlightSet?.nodeIds.has(id)
}
function nodeTone(node) { return !node.hasRoute ? 'exit' : node.isEntry || props.edges.some(edge => edge.to === node.id && tone(edge) === 'primary') ? 'primary' : 'alternative' }
function pageName(page) {
  let name = page.shortLabel || page.label || page.id
  try {
    const url = new URL(page.id)
    if (!page.shortLabel && (name === page.id || name === `${url.host}${url.pathname}`)) {
      name = url.pathname === '/' ? 'Home' : decodeURIComponent(url.pathname).replace(/^\/|\/$/g, '').replace(/\//g, ' / ').replace(/[-_]/g, ' ')
      name = name.charAt(0).toUpperCase() + name.slice(1)
    }
  } catch {}
  return name.length > 24 ? `${name.slice(0, 22)}…` : name
}
function pointerPosition(event) {
  if (event.type !== 'focus') return
  const box = event.currentTarget.getBoundingClientRect()
  emit('pointer-position', { clientX: box.x + box.width / 2, clientY: box.y })
}
function inspectEdge(edge, event) { hoveredEdgeId.value = edge.id; emit('hover-edge', edge.id); pointerPosition(event) }
function leaveEdge() { hoveredEdgeId.value = null; emit('hover-edge', null) }
function inspectNode(node, event) { emit('hover-node', node.id); pointerPosition(event) }
function inspectGoal(event) { emit('hover-center'); pointerPosition(event) }
watch(() => props.edges, leaveEdge)
</script>

<template>
  <div class="map-scroll" tabindex="0" role="region" aria-label="Visitor journey map. Scroll horizontally on smaller screens.">
    <svg class="journey-map" :viewBox="`0 0 ${mapWidth} ${mapHeight}`" :style="{ minWidth: `${Math.min(mapWidth, 850)}px` }" xmlns="http://www.w3.org/2000/svg" role="group" :aria-labelledby="`${prefix}-title ${prefix}-description`">
      <title :id="`${prefix}-title`">Visitor journeys to {{ goal.shortLabel || goal.label }}</title>
      <desc :id="`${prefix}-description`">Gold and orange curves show main routes. Purple curves show alternative and return routes. Muted dashed curves lead to pages with no observed route to conversion. Line width represents sessions; arrows follow travel direction. Focus or hover a route or page for its details.</desc>
      <defs>
        <pattern :id="`${prefix}-grid`" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M 38 0 L 0 0 0 38" fill="none" stroke="#323748" stroke-width="0.6"/></pattern>
        <linearGradient v-for="edge in edges" :key="edge.id" :id="gradients.get(edge.id)" gradientUnits="userSpaceOnUse" :x1="edge.x1" :y1="edge.y1" :x2="Math.abs(edge.x2 - edge.x1) < 1 ? edge.x2 + 1 : edge.x2" :y2="edge.y2">
          <stop offset="0%" :stop-color="palettes[tone(edge)][0]"/><stop offset="100%" :stop-color="palettes[tone(edge)][1]"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" :fill="`url(#${prefix}-grid)`" class="map-grid" aria-hidden="true"/>
      <text x="36" y="35" class="stage-label" aria-hidden="true">VISITOR PAGES</text>
      <text :x="mapWidth - 36" y="35" text-anchor="end" class="stage-label goal-stage" aria-hidden="true">{{ goal.shortLabel || goal.label }}</text>
      <g class="routes">
        <g v-for="road in roads" :key="road.id" class="road">
          <g v-for="edge in road.lanes" :key="edge.id" class="route" :data-edge-id="edge.id" :class="[tone(edge), { dim: isEdgeDim(edge), active: isEdgeActive(edge) }]">
            <path :d="edge.d" :stroke-width="5 + edge.intensity * 9" class="route-bed"/>
            <path :d="edge.d" :stroke="`url(#${gradients.get(edge.id)})`" :stroke-width="1.8 + edge.intensity * 3.5" class="route-line"/>
            <g class="direction-markers" aria-hidden="true"><path v-for="(marker, index) in edge.markers" :key="index" d="M -3.5 -2.5 L 0 0 L -3.5 2.5" :transform="`translate(${marker.x} ${marker.y}) rotate(${marker.angle})`"/></g>
            <g v-if="motionAllowed" class="route-particles" aria-hidden="true">
              <circle v-for="particle in particleCount(edge)" :key="particle" r="2.6" class="traffic-particle">
                <animateMotion :path="edge.d" :dur="`${travelDuration(edge)}s`" :begin="`${-(particle - 1) / particleCount(edge) * travelDuration(edge)}s`" repeatCount="indefinite" calcMode="paced"/>
              </circle>
            </g>
            <path :d="edge.d" :stroke-width="Math.max(16, edge.strokeWidth)" class="route-hit" tabindex="0" role="button" :aria-label="`${edge.weight.toLocaleString()} sessions from ${edge.from} to ${edge.to}. Inspect route details.`" @mouseenter="inspectEdge(edge, $event)" @mouseleave="leaveEdge" @focus="inspectEdge(edge, $event)" @blur="leaveEdge" @click="inspectEdge(edge, $event)" @keydown.enter.prevent="inspectEdge(edge, $event)" @keydown.space.prevent="inspectEdge(edge, $event)"/>
          </g>
        </g>
      </g>
      <g class="nodes">
        <g v-for="node in nodes" :key="node.id" class="node-group" :data-node-id="node.id" :class="[nodeTone(node), { dim: isNodeDim(node.id), active: isNodeActive(node.id) }]" tabindex="0" role="button" :aria-label="`${node.label}: ${node.weight.toLocaleString()} sessions. Inspect page details.`" @mouseenter="inspectNode(node, $event)" @mouseleave="emit('leave')" @focus="inspectNode(node, $event)" @blur="emit('leave')" @click="inspectNode(node, $event)" @keydown.enter.prevent="inspectNode(node, $event)" @keydown.space.prevent="inspectNode(node, $event)">
          <title>{{ node.label }}</title>
          <circle :cx="node.x" :cy="node.y" :r="node.nodeRadius + 6" class="node-halo"/>
          <circle :cx="node.x" :cy="node.y" :r="node.nodeRadius" class="node-circle"/>
          <circle :cx="node.x" :cy="node.y" r="3.5" class="node-dot"/>
          <text :x="node.labelX" :y="node.labelY" text-anchor="middle" class="node-label">{{ pageName(node) }}</text>
          <text :x="node.labelX" :y="node.labelY + 17" text-anchor="middle" class="node-sublabel">{{ node.weight.toLocaleString() }} sessions{{ !node.hasRoute ? ' · exit' : '' }}</text>
        </g>
      </g>
      <g class="conversion-node" :class="{ active: centerHovered, dim: highlightSet && !highlightSet.nodeIds.has(goal.id) && !centerHovered }" tabindex="0" role="button" :aria-label="`${goal.label}: ${convertedSessions.toLocaleString()} total conversions. Inspect conversion details.`" @mouseenter="inspectGoal" @mouseleave="emit('leave-center')" @focus="inspectGoal" @blur="emit('leave-center')" @click="inspectGoal" @keydown.enter.prevent="inspectGoal" @keydown.space.prevent="inspectGoal">
        <circle :cx="goalPosition.x" :cy="goalPosition.y" r="34" class="goal-halo"/>
        <circle :cx="goalPosition.x" :cy="goalPosition.y" r="26" class="goal-circle"/>
        <path :d="`M ${goalPosition.x - 9} ${goalPosition.y} l 6 6 l 12 -13`" class="goal-check"/>
        <text :x="goalPosition.x" :y="goalPosition.y + 49" text-anchor="middle" class="goal-label">{{ pageName(goal) }}</text>
        <text :x="goalPosition.x" :y="goalPosition.y + 67" text-anchor="middle" class="node-sublabel">{{ convertedSessions.toLocaleString() }} total</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.route-particles { pointer-events: none; }
.traffic-particle { fill: currentColor; stroke: #151824; stroke-width: .7; }
@media (prefers-reduced-motion: reduce) { .route-particles { display: none; } }
.map-scroll{width:100%;overflow-x:auto;overscroll-behavior-x:contain;border:1px solid #2c3040;border-radius:12px;background:#151824;scrollbar-color:#5c536e #151824}.map-scroll:focus-visible{outline:2px solid #b7a2ed;outline-offset:3px}.journey-map{display:block;width:100%;height:auto;user-select:none}.map-grid{opacity:.4;pointer-events:none}.stage-label{fill:#7b859a;font-size:10px;font-weight:600;letter-spacing:1.7px;text-transform:uppercase}.goal-stage{fill:#b49c67}.route{color:#e8bc42;transition:opacity .18s}.route.alternative{color:#b7a2ed}.route.exit{color:#7b879e}.route.dim{opacity:.1}.route-bed,.route-line,.route-hit{fill:none;stroke-linecap:round;stroke-linejoin:round}.route-bed{stroke:currentColor;stroke-opacity:.09;pointer-events:none}.route-line{pointer-events:none;opacity:.85}.route.exit .route-line{stroke-dasharray:4 7;opacity:.7}.route.active .route-bed{stroke-opacity:.22}.route.active .route-line{opacity:1;filter:brightness(1.2)}.route-hit{stroke:transparent;cursor:pointer;outline:none}.route:has(.route-hit:focus-visible) .route-line{stroke:#fff0c1;opacity:1}.direction-markers{pointer-events:none}.direction-markers path{fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}.node-group{color:#e8bc42;cursor:pointer;transition:opacity .18s;outline:none}.node-group.alternative{color:#b7a2ed}.node-group.exit{color:#7b879e}.node-group.dim,.conversion-node.dim{opacity:.2}.node-circle{fill:#191d2a;stroke:currentColor;stroke-width:2}.node-halo{fill:currentColor;opacity:.06;pointer-events:none}.node-dot{fill:currentColor;pointer-events:none}.node-group.active .node-halo,.node-group:focus-visible .node-halo{opacity:.2}.node-group.active .node-circle,.node-group:focus-visible .node-circle{stroke-width:3}.node-label{fill:#d3d8e3;font-size:13px;font-weight:550;pointer-events:none}.node-sublabel{fill:#8d98ad;font-size:10px;pointer-events:none}.conversion-node{cursor:pointer;outline:none;transition:opacity .18s}.goal-halo{fill:#e8bc42;opacity:.07}.goal-circle{fill:#232431;stroke:#e8bc42;stroke-width:2}.goal-check{fill:none;stroke:#f1c44d;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}.goal-label{fill:#e8cb83;font-size:13px;font-weight:600;pointer-events:none}.conversion-node.active .goal-halo,.conversion-node:focus-visible .goal-halo{opacity:.2}.conversion-node.active .goal-circle,.conversion-node:focus-visible .goal-circle{stroke:#ffdc79;stroke-width:3}@media(prefers-reduced-motion:reduce){.route,.node-group,.conversion-node{transition:none}}
</style>
