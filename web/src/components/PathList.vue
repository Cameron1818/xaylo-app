<script setup>
const props = defineProps({
  topPaths: { type: Array, required: true },
  activePathKey: { type: String, default: null },
  selectedPathKey: { type: String, default: null },
  goal: { type: Object, required: true },
})

const emit = defineEmits(['hover', 'leave', 'select'])
</script>

<template>
  <div class="pathlist">
    <h2 class="pathlist-title">Session journeys</h2>
    <p class="pathlist-sub">Hover to trace a route · click to keep it selected. Click again to show all.</p>
    <ul class="pathlist-list">
      <li
        v-for="p in topPaths"
        :key="p.key"
      >
        <button
          type="button"
          class="path-row"
          :class="{ active: activePathKey === p.key, selected: selectedPathKey === p.key, dim: activePathKey && activePathKey !== p.key }"
          :aria-pressed="selectedPathKey === p.key"
          @mouseenter="emit('hover', p.key)"
          @mouseleave="emit('leave')"
          @focus="emit('hover', p.key)"
          @blur="emit('leave')"
          @click="emit('select', p.key)"
        >
          <span class="path-steps">
            <template v-for="(page, i) in p.pages" :key="page.id + i">
              <span class="step">
                <span class="step-icon">{{ page.icon }}</span>
                <span class="step-label">{{ page.label }}</span>
              </span>
              <span v-if="i < p.pages.length - 1" class="arrow">→</span>
            </template>
          </span>
          <span class="journey-tags">
            <span v-if="selectedPathKey === p.key" class="selected-tag">Selected</span>
            <span :class="{ converted: p.converted }">{{ p.converted ? goal.label : 'Left before conversion' }}</span>
            <span v-if="p.hasLoop" class="loop-tag">↩ Repeat visits</span>
          </span>
          <span class="path-meta">
            <span class="path-sessions">{{ p.sessions.toLocaleString() }} sessions</span>
            <span class="path-share">{{ (p.share * 100).toFixed(1) }}% of shown</span>
          </span>
        </button>
      </li>
      <li v-if="!topPaths.length" class="path-empty">No paths match the current filters.</li>
    </ul>
  </div>
</template>

<style scoped>
.pathlist {
  background: rgba(20, 20, 32, 0.6);
  border: 1px solid #2a2a42;
  border-radius: 14px;
  padding: 18px 18px 8px;
  width: 100%;
  max-width: 380px;
  backdrop-filter: blur(6px);
}

.pathlist-title {
  margin: 0 0 2px;
  font-size: 16px;
  color: #fff6d8;
}
.pathlist-sub {
  margin: 0 0 14px;
  font-size: 12px;
  color: #7d82a3;
}

.pathlist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 480px;
  overflow-y: auto;
}

.path-row {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  font: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
}
.path-row:hover,
.path-row.active {
  background: #2a2a4a;
  transform: translateX(2px);
}
.path-row.dim {
  opacity: 0.4;
}
.path-row.selected { border-color: #e8b923; }
.path-row:focus-visible { outline: 2px solid #e8b923; outline-offset: -2px; }
.journey-tags .selected-tag { color: #fff6d8; background: #665217; }

.path-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
}
.step {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: #eef0ff;
  font-weight: 600;
  white-space: nowrap;
}
.step-icon {
  font-size: 13px;
}
.arrow {
  color: #565a77;
  font-size: 11px;
}

.journey-tags { display: flex; flex-wrap: wrap; gap: 6px; font-size: 10px; color: #9aa0c3; }
.journey-tags span { background: #252538; padding: 3px 6px; border-radius: 4px; }
.journey-tags .converted { color: #e8b923; }
.journey-tags .loop-tag { color: #c4adff; }
.path-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #9aa0c3;
}
.path-sessions {
  font-weight: 700;
  color: #e8b923;
}

.path-empty {
  color: #6a6f90;
  font-size: 13px;
  text-align: center;
  padding: 24px 8px;
}
</style>
