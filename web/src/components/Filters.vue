<script setup>
const props = defineProps({
  pages: { type: Array, required: true },
  goalOptions: { type: Array, required: true },
  goalId: { type: String, required: true },
  minSessions: { type: Number, required: true },
  maxPathSessions: { type: Number, required: true },
  showReturnTraffic: { type: Boolean, default: true },
  journeyType: { type: String, default: 'all' },
  focusId: { type: String, default: null },
})

const emit = defineEmits(['update:goalId', 'update:minSessions', 'update:focusId', 'update:showReturnTraffic', 'update:journeyType'])
</script>

<template>
  <div class="filters">
    <div class="filter-group">
      <label for="goal-select">Conversion goal</label>
      <select
        id="goal-select"
        :value="goalId"
        @change="emit('update:goalId', $event.target.value)"
      >
        <option v-for="p in goalOptions" :key="p.id" :value="p.id">{{ p.icon }} {{ p.label }}</option>
      </select>
    </div>

    <div class="filter-group">
      <label for="focus-select">Focus page</label>
      <select
        id="focus-select"
        :value="focusId || ''"
        @change="emit('update:focusId', $event.target.value || null)"
      >
        <option value="">All pages</option>
        <option v-for="p in pages" :key="p.id" :value="p.id">{{ p.icon }} {{ p.label }}</option>
      </select>
    </div>

    <div class="filter-group">
      <label for="journey-type">Journeys</label>
      <select id="journey-type" :value="journeyType" @change="emit('update:journeyType', $event.target.value)">
        <option value="all">All journeys</option>
        <option value="converted">Reached conversion</option>
        <option value="looping">With repeat visits</option>
      </select>
    </div>
    <div class="filter-group return-toggle">
      <label for="return-traffic">
        <input id="return-traffic" type="checkbox" :checked="showReturnTraffic" @change="emit('update:showReturnTraffic', $event.target.checked)" />
        Include revisit traffic
      </label>
      <small>Returns to pages already visited</small>
    </div>

    <div class="filter-group slider-group">
      <label for="min-sessions">
        Min. sessions per path
        <span class="filter-value">{{ minSessions.toLocaleString() }}</span>
      </label>
      <input
        id="min-sessions"
        type="range"
        min="0"
        :max="maxPathSessions"
        :step="Math.max(1, Math.round(maxPathSessions / 100))"
        :value="minSessions"
        @input="emit('update:minSessions', Number($event.target.value))"
      />
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: flex-end;
  background: rgba(20, 20, 32, 0.6);
  border: 1px solid #2a2a42;
  border-radius: 14px;
  padding: 14px 18px;
  backdrop-filter: blur(6px);
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 160px;
}
.return-toggle { align-self: center; }
.return-toggle label { align-items: center; justify-content: flex-start; cursor: pointer; }
.return-toggle input { accent-color: #b7a2ed; }
.return-toggle small { font-size: 11px; color: #7d82a3; }
.slider-group {
  flex: 1 1 220px;
  min-width: 200px;
}

.filter-group label {
  font-size: 11px;
  color: #9aa0c3;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.filter-value {
  color: #e8b923;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0;
}

select {
  appearance: none;
  background: #1a1a2e;
  border: 1px solid #3a3a55;
  color: #eef0ff;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s ease;
}
select:hover,
select:focus {
  border-color: #e8b923;
}

input[type='range'] {
  appearance: none;
  width: 100%;
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, #e8b923, #ff5d4e);
  outline: none;
  cursor: pointer;
}
input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff6d8;
  border: 2px solid #e8b923;
  cursor: pointer;
}
input[type='range']::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff6d8;
  border: 2px solid #e8b923;
  cursor: pointer;
}
</style>
