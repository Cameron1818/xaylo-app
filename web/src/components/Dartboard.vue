<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  nodes: { type: Array, required: true },
  edges: { type: Array, required: true },
  roads: { type: Array, required: true },
  convertedSessions: { type: Number, default: 0 },
  goal: { type: Object, required: true },
  center: { type: Number, required: true },
  bullRadius: { type: Number, required: true },
  maxRing: { type: Number, required: true },
  ringRadius: { type: Function, required: true },
  highlightSet: { type: Object, default: null },
  centerHovered: { type: Boolean, default: false },
})

const emit = defineEmits(['hover-node', 'leave', 'hover-center', 'leave-center', 'hover-edge'])

const hoveredEdgeId = ref(null)
const gradientById = computed(() => new Map(props.edges.map((edge, index) => [edge.id, `edgeGrad-${index}`])))

const RIM = computed(() => props.ringRadius(Math.max(props.maxRing, 1)) + 45)

function polar(r, angle) {
  return { x: props.center + r * Math.cos(angle), y: props.center + r * Math.sin(angle) }
}

// Purely decorative dartboard backdrop -- fixed segment count, independent
// of the data, so it always reads as a dartboard no matter the funnel shape.
const DECO_SEGMENTS = 20
const decoWedges = computed(() => {
  const rim = RIM.value
  const list = []
  for (let i = 0; i < DECO_SEGMENTS; i++) {
    const start = (i / DECO_SEGMENTS) * Math.PI * 2 - Math.PI / 2
    const end = ((i + 1) / DECO_SEGMENTS) * Math.PI * 2 - Math.PI / 2
    const o1 = polar(rim, start)
    const o2 = polar(rim, end)
    list.push({ i, d: `M ${props.center} ${props.center} L ${o1.x} ${o1.y} A ${rim} ${rim} 0 0 1 ${o2.x} ${o2.y} Z` })
  }
  return list
})
const decoBand = computed(() => {
  const list = []
  const r1 = RIM.value - 10
  const r2 = RIM.value
  for (let i = 0; i < DECO_SEGMENTS; i++) {
    const start = (i / DECO_SEGMENTS) * Math.PI * 2 - Math.PI / 2
    const end = ((i + 1) / DECO_SEGMENTS) * Math.PI * 2 - Math.PI / 2
    const i1 = polar(r1, start)
    const o1 = polar(r2, start)
    const o2 = polar(r2, end)
    const i2 = polar(r1, end)
    list.push({ i, d: `M ${i1.x} ${i1.y} L ${o1.x} ${o1.y} A ${r2} ${r2} 0 0 1 ${o2.x} ${o2.y} L ${i2.x} ${i2.y} A ${r1} ${r1} 0 0 0 ${i1.x} ${i1.y} Z` })
  }
  return list
})

const ringGuides = computed(() => {
  const list = []
  for (let r = 1; r <= props.maxRing; r++) {
    const radius = props.ringRadius(r)
    const labelPos = polar(radius, -Math.PI / 2 + 0.11)
    list.push({ r, radius, labelX: labelPos.x, labelY: labelPos.y })
  }
  return list
})

function isEdgeDim(edge) {
  if (hoveredEdgeId.value) return hoveredEdgeId.value !== edge.id
  if (props.centerHovered) return false
  if (!props.highlightSet) return false
  return !props.highlightSet.edgeIds.has(edge.id)
}
function isEdgeActive(edge) {
  if (hoveredEdgeId.value) return hoveredEdgeId.value === edge.id
  if (props.centerHovered) return true
  return !!props.highlightSet?.edgeIds.has(edge.id)
}
function isNodeDim(id) {
  if (hoveredEdgeId.value) {
    const e = props.edges.find((x) => x.id === hoveredEdgeId.value)
    return !!e && e.from !== id && e.to !== id
  }
  if (props.centerHovered) return false
  if (!props.highlightSet) return false
  return !props.highlightSet.nodeIds.has(id)
}
function isNodeActive(id) {
  if (hoveredEdgeId.value) {
    const e = props.edges.find((x) => x.id === hoveredEdgeId.value)
    return !!e && (e.from === id || e.to === id)
  }
  return !!props.highlightSet?.nodeIds.has(id)
}

function labelAnchor(angle) {
  const c = Math.cos(angle)
  if (c > 0.15) return 'start'
  if (c < -0.15) return 'end'
  return 'middle'
}
function labelDx(angle) {
  const c = Math.cos(angle)
  if (c > 0.15) return 6
  if (c < -0.15) return -6
  return 0
}

watch(() => props.edges, () => {
  hoveredEdgeId.value = null
  emit('hover-edge', null)
})
</script>

<template>
  <svg
    class="dartboard"
    viewBox="-90 -45 780 690"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Dartboard funnel path diagram"
  >
    <defs>
      <radialGradient id="bullGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffe08a" />
        <stop offset="55%" stop-color="#e8b923" />
        <stop offset="100%" stop-color="#a9780f" />
      </radialGradient>
      <radialGradient id="innerBull" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ff6b5b" />
        <stop offset="100%" stop-color="#c0392b" />
      </radialGradient>
      <filter id="softGlow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="4.5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="bigGlow" x="-150%" y="-150%" width="400%" height="400%">
        <feGaussianBlur stdDeviation="8" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <linearGradient
        v-for="e in edges"
        :key="'grad-' + e.id"
        :id="gradientById.get(e.id)"
        gradientUnits="userSpaceOnUse"
        :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
      >
        <stop offset="0%" :stop-color="e.isExitBranch ? '#40495d' : '#315b59'" />
        <stop offset="100%" :stop-color="e.isExitBranch ? '#55617a' : '#68734c'" />
      </linearGradient>
    </defs>

    <!-- decorative dartboard backdrop -->
    <circle :cx="center" :cy="center" :r="RIM + 14" class="rim" />
    <g class="deco-wedges">
      <path v-for="w in decoWedges" :key="'dw-' + w.i" :d="w.d" class="deco-wedge" :class="{ even: w.i % 2 === 0 }" />
      <path v-for="b in decoBand" :key="'db-' + b.i" :d="b.d" class="deco-band" :class="b.i % 2 === 0 ? 'band-red' : 'band-green'" />
    </g>

    <!-- ring guides: one per "N steps from goal" -->
    <g class="ring-guides">
      <circle v-for="g in ringGuides" :key="'ring-' + g.r" :cx="center" :cy="center" :r="g.radius" class="ring-guide" />
    </g>

    <!-- Each road has one shared bed and independently interactive carriageways. -->
    <g class="roads">
      <g v-for="road in roads" :key="road.id" class="road">
        <path :d="road.d" :stroke-width="road.strokeWidth" class="road-bed" :class="{ dim: road.lanes.every(isEdgeDim) }" />
        <g v-for="e in road.lanes" :key="e.id" class="carriageway" :data-edge-id="e.id" :class="{ dim: isEdgeDim(e), active: isEdgeActive(e) }">
          <path :d="e.d" :stroke-width="e.strokeWidth + 0.8" class="road-border" />
          <path
            :d="e.d"
            :stroke="`url(#${gradientById.get(e.id)})`"
            :stroke-width="e.strokeWidth"
            class="edge"
            @mouseenter="hoveredEdgeId = e.id; emit('hover-edge', e.id)"
            @mouseleave="hoveredEdgeId = null; emit('hover-edge', null)"
          />
          <g class="direction-markers" aria-hidden="true">
            <path
              v-for="(marker, i) in e.markers" :key="i"
              d="M -3 -1.8 L 0 0 L -3 1.8"
              :transform="`translate(${marker.x} ${marker.y}) rotate(${marker.angle})`"
            />
          </g>
          <g class="particles" aria-hidden="true">
            <circle v-for="p in Math.max(1, Math.round(e.intensity * 4))" :key="p" class="particle" :r="Math.min(1.8, e.strokeWidth * 0.2)">
              <animateMotion :path="e.d" dur="5s" :begin="`${-p * 1.3}s`" repeatCount="indefinite" />
            </circle>
          </g>
        </g>
      </g>
    </g>

    <!-- page nodes -->
    <g class="nodes">
      <g
        v-for="n in nodes"
        :key="'node-' + n.id"
        class="node-group"
        :class="{ dim: isNodeDim(n.id), active: isNodeActive(n.id), 'exit-node': !n.hasRoute }"
        @mouseenter="emit('hover-node', n.id)"
        @mouseleave="emit('leave')"
        @click="emit('hover-node', n.id)"
      >
        <circle :cx="n.x" :cy="n.y" :r="n.nodeRadius" class="node-circle" />
        <text :x="n.x" :y="n.y + 1" class="node-icon" text-anchor="middle" dominant-baseline="middle">{{ n.icon }}</text>
        <text
          :x="n.labelX" :y="n.labelY - 5"
          :dx="labelDx(n.angle)"
          class="node-label" :text-anchor="labelAnchor(n.angle)" dominant-baseline="middle"
        >{{ n.label }}</text>
        <text
          :x="n.labelX" :y="n.labelY + 10"
          :dx="labelDx(n.angle)"
          class="node-sublabel" :text-anchor="labelAnchor(n.angle)" dominant-baseline="middle"
        >{{ n.weight.toLocaleString() }} sessions{{ !n.hasRoute ? ' · exit' : '' }}</text>
      </g>
    </g>

    <!-- bullseye: the configurable funnel goal -->
    <g
      class="bullseye"
      :class="{ active: centerHovered }"
      @mouseenter="emit('hover-center')"
      @mouseleave="emit('leave-center')"
    >
      <circle :cx="center" :cy="center" :r="bullRadius" fill="url(#bullGlow)" class="bull-outer" />
      <circle :cx="center" :cy="center" :r="bullRadius * 0.5" fill="url(#innerBull)" class="bull-inner" />
      <text :x="center" :y="center - 6" text-anchor="middle" class="goal-icon">{{ goal.icon }}</text>
      <text :x="center" :y="center + 34" text-anchor="middle" class="goal-count">{{ convertedSessions.toLocaleString() }} total</text>
      <text :x="center" :y="center + 15" text-anchor="middle" class="goal-label">{{ goal.shortLabel || goal.label }}</text>
    </g>
  </svg>
</template>

<style scoped>
.dartboard {
  width: 100%;
  height: auto;
  max-width: 720px;
  overflow: visible;
  user-select: none;
}

.rim {
  fill: #14141f;
  stroke: #3a3a55;
  stroke-width: 2;
}

.deco-wedge {
  fill: #1c1c2e;
  pointer-events: none;
}
.deco-wedge.even {
  fill: #20203350;
}
.deco-band {
  pointer-events: none;
  opacity: 0.8;
}
.band-red { fill: #7a2a22; }
.band-green { fill: #17513a; }

.ring-guide {
  fill: none;
  stroke: #3a3a55;
  stroke-width: 1;
  stroke-dasharray: 2 6;
  pointer-events: none;
}
.ring-label {
  fill: #6a6f90;
  font-size: 10px;
  letter-spacing: 0.3px;
  pointer-events: none;
  text-transform: uppercase;
}

.road-bed, .road-border, .edge {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.road-bed { stroke: #0b111b; pointer-events: none; transition: opacity 0.2s ease; }
.road-border { stroke: #8ca99b; stroke-opacity: 0.7; pointer-events: none; }
.carriageway { transition: opacity 0.2s ease; }
.carriageway.dim, .road-bed.dim { opacity: 0.1; }
.carriageway.active .road-border { stroke: #fff1bd; stroke-opacity: 1; }
.carriageway.active .edge { filter: brightness(1.35); }
.edge { cursor: pointer; }
.particles, .direction-markers { pointer-events: none; }
.direction-markers path { fill: none; stroke: #fff3cc; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }
.particle { fill: #fff3cc; }
.goal-count { fill: #2a1608; font-size: 10px; font-weight: 700; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .particles { display: none; }
}

.node-group {
  cursor: pointer;
  transition: opacity 0.25s ease, transform 0.25s ease;
  transform-box: fill-box;
  transform-origin: center;
}
.node-group.dim {
  opacity: 0.22;
}
.node-group.active {
  transform: scale(1.1);
}

.node-circle {
  fill: #0f0f1a;
  stroke: #e8b923;
  stroke-width: 2.5;
  transition: filter 0.25s ease, stroke 0.25s ease;
}
.exit-node .node-circle { stroke: #a7b7d7; }
.node-group.active .node-circle {
  filter: url(#softGlow);
  stroke: #ff5d4e;
}

.node-icon {
  font-size: 16px;
  pointer-events: none;
}

.node-label {
  fill: #eef0ff;
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
  letter-spacing: 0.2px;
}

.node-sublabel {
  fill: #9aa0c3;
  font-size: 10px;
  pointer-events: none;
}

.bullseye {
  cursor: pointer;
}
.bull-outer {
  stroke: #fff3c4;
  stroke-width: 1.5;
  animation: pulse 2.6s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}
.bull-inner {
  stroke: #ffd8cf;
  stroke-width: 1.5;
}
.bullseye.active .bull-outer,
.bullseye.active .bull-inner {
  filter: url(#bigGlow);
}

.goal-icon {
  font-size: 20px;
  pointer-events: none;
}
.goal-label {
  fill: #2a1608;
  font-size: 12px;
  font-weight: 800;
  pointer-events: none;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}
</style>
