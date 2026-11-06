<script setup>
defineProps({
  data: { type: Object, default: null },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  isGoal: { type: Boolean, default: false },
  isEdge: { type: Boolean, default: false },
  totalSessions: { type: Number, default: 0 },
})

function fmt(n) {
  return n.toLocaleString()
}
</script>

<template>
  <transition name="tip-fade">
    <div v-if="data" class="tooltip" :style="{ left: x + 'px', top: y + 'px' }">
      <template v-if="isGoal">
        <div class="tip-head">
          <span class="tip-icon">{{ data.icon }}</span>
          <span class="tip-title">{{ data.label }}</span>
        </div>
        <p class="tip-desc">{{ data.description || 'The funnel goal every path below is routing toward.' }}</p>
        <div class="tip-row highlight"><span>Total sessions reaching goal</span><strong>{{ fmt(totalSessions) }}</strong></div>
      </template>
      <template v-else-if="isEdge">
        <div class="tip-head">
          <span class="tip-icon">{{ data.fromIcon }}</span>
          <span class="tip-title">{{ data.fromLabel }} → {{ data.toLabel }}</span>
          <span class="tip-icon">{{ data.toIcon }}</span>
        </div>
        <div class="tip-row highlight"><span>Sessions on this step</span><strong>{{ fmt(data.weight) }}</strong></div>
        <div class="tip-row"><span>{{ data.includesRevisits ? 'Total traversals (incl. repeats)' : 'Shown traversals (first visits only)' }}</span><strong>{{ fmt(data.traversals) }}</strong></div>
        <div class="tip-row"><span>First visits</span><strong>{{ fmt(data.firstVisitTraversals) }}</strong></div>
        <div class="tip-row"><span>Revisits</span><strong>{{ data.includesRevisits ? fmt(data.revisitTraversals) : 'Hidden' }}</strong></div>
        <p class="tip-note">Visit counts include repeated trips; each session is counted once above.</p>
        <div v-if="data.isExitBranch" class="tip-row"><span>Browsing branch · no conversion observed</span></div>
      </template>
      <template v-else>
        <div class="tip-head">
          <span class="tip-icon">{{ data.icon }}</span>
          <span class="tip-title">{{ data.label }}</span>
        </div>
        <div class="tip-row highlight"><span>Sessions through this page</span><strong>{{ fmt(data.weight) }}</strong></div>
        <div class="tip-row"><span>Left from this page</span><strong>{{ fmt(data.exits) }}</strong></div>
        <div class="tip-row"><span>Share of all sessions</span><strong>{{ totalSessions ? ((data.weight / totalSessions) * 100).toFixed(1) : '0' }}%</strong></div>
      </template>
    </div>
  </transition>
</template>

<style scoped>
.tooltip {
  position: fixed;
  transform: translate(-50%, calc(-100% - 16px));
  background: rgba(18, 18, 30, 0.96);
  border: 1px solid #e8b92355;
  border-radius: 10px;
  padding: 12px 14px;
  min-width: 200px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  z-index: 50;
  backdrop-filter: blur(6px);
}

.tip-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-weight: 700;
  color: #fff6d8;
}
.tip-icon {
  font-size: 16px;
}
.tip-title {
  flex: 1;
  font-size: 14px;
}

.tip-note { max-width: 280px; margin: 7px 0 0; font-size: 11px; line-height: 1.4; color: #9aa0c3; }

.tip-desc {
  font-size: 12px;
  color: #b9bedb;
  margin: 0 0 8px;
  line-height: 1.4;
}

.tip-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 12.5px;
  color: #9aa0c3;
  padding: 2px 0;
}
.tip-row strong {
  color: #eef0ff;
}
.tip-row.highlight {
  margin: 0 -14px 4px;
  padding: 6px 14px;
  background: #e8b92322;
  border-top: 1px solid #e8b92333;
  border-bottom: 1px solid #e8b92333;
}
.tip-row.highlight span {
  color: #ffe08a;
  font-weight: 600;
}
.tip-row.highlight strong {
  color: #ffe08a;
  font-size: 13.5px;
}

.tip-fade-enter-active,
.tip-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.tip-fade-enter-from,
.tip-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% - 8px));
}
</style>
