<script setup>
import { reactive, ref, watch } from 'vue'

const props = defineProps({ journeys: { type: Array, required: true }, api: { type: Function, required: true } })
const emit = defineEmits(['changed'])
const selectedId = ref(null)
const error = ref('')
const notice = ref('')
const tagsText = ref('')
const empty = () => ({ name: '', slug: '', status: 'draft', priority: 0,
  rules: { utmSource: '', utmCampaign: '', utmMedium: '', utmTerm: '', utmContent: '', pathContains: '', referrerContains: '', requiredTag: '' },
  content: { headline: '', description: '', ctaText: '', ctaUrl: '', agentContext: '', emailAngle: '' } })
const form = reactive(empty())
function choose(journey) {
  selectedId.value = journey.id
  Object.assign(form, { name: journey.name, slug: journey.slug, status: journey.status, priority: journey.priority,
    rules: { ...empty().rules, ...journey.rules }, content: { ...journey.content } })
  tagsText.value = journey.addTags.join(', ')
  error.value = ''; notice.value = ''
}
function reset() { selectedId.value = null; Object.assign(form, empty()); tagsText.value = ''; error.value = ''; notice.value = '' }
watch(() => props.journeys, current => {
  if (selectedId.value) { const match = current.find(journey => journey.id === selectedId.value); if (match) choose(match) }
})
async function save() {
  try {
    const payload = { ...form, rules: { ...form.rules }, content: { ...form.content }, addTags: tagsText.value.split(',').map(tag => tag.trim()).filter(Boolean) }
    const journey = await props.api(selectedId.value ? `/api/journeys/${selectedId.value}` : '/api/journeys',
      { method: selectedId.value ? 'PUT' : 'POST', body: JSON.stringify(payload) })
    selectedId.value = journey.id; error.value = ''; notice.value = 'Journey saved'; emit('changed')
  } catch (cause) { error.value = cause.message }
}
async function remove() {
  if (!selectedId.value || !confirm('Delete this journey?')) return
  try { await props.api(`/api/journeys/${selectedId.value}`, { method: 'DELETE' }); reset(); emit('changed') }
  catch (cause) { error.value = cause.message }
}
</script>

<template>
  <div class="layout">
    <aside class="panel"><div class="aside-head"><h2>All journeys</h2><button @click="reset">New</button></div><p v-if="!journeys.length" class="muted">Create your first journey.</p><button v-for="journey in journeys" :key="journey.id" class="journey" :class="{ selected: selectedId === journey.id }" @click="choose(journey)"><strong>{{ journey.name }}</strong><small>{{ journey.status }} · priority {{ journey.priority }}</small></button></aside>
    <section class="panel"><h2>{{ selectedId ? 'Edit journey' : 'New journey' }}</h2><p class="muted">Filled match fields must all match. Higher priority wins.</p><div v-if="error" class="error">{{ error }}</div><form @submit.prevent="save">
      <div class="row"><label>Name<input v-model="form.name" required maxlength="120" placeholder="Paid search: personalisation"></label><label>Slug<input v-model="form.slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="paid-search"></label></div>
      <div class="row"><label>Status<select v-model="form.status"><option value="draft">Draft</option><option value="published">Published</option></select></label><label>Priority<input v-model.number="form.priority" type="number" min="-1000" max="1000"></label></div>
      <h3>Match visitor intent</h3><div class="row"><label>UTM source<input v-model="form.rules.utmSource" placeholder="google"></label><label>UTM campaign<input v-model="form.rules.utmCampaign" placeholder="spring"></label></div>
      <div class="row"><label>UTM medium<input v-model="form.rules.utmMedium" placeholder="cpc"></label><label>UTM term<input v-model="form.rules.utmTerm"></label></div><label>UTM content<input v-model="form.rules.utmContent"></label>
      <div class="row"><label>Page path contains<input v-model="form.rules.pathContains" placeholder="/services"></label><label>Referrer contains<input v-model="form.rules.referrerContains" placeholder="example.com"></label></div><label>Required contact tag<input v-model="form.rules.requiredTag" placeholder="interested:personalisation"></label>
      <h3>Journey content</h3><label>Headline<input v-model="form.content.headline" maxlength="240"></label><label>Description<textarea v-model="form.content.description" rows="3" maxlength="1000"></textarea></label>
      <div class="row"><label>Button text<input v-model="form.content.ctaText" maxlength="100"></label><label>Button URL<input v-model="form.content.ctaUrl" type="url" placeholder="https://example.com/book"></label></div>
      <label>AI agent context<textarea v-model="form.content.agentContext" rows="2" maxlength="1000"></textarea></label><label>Email angle<textarea v-model="form.content.emailAngle" rows="2" maxlength="1000"></textarea></label><label>GHL tags to add on conversion<input v-model="tagsText" placeholder="xaylo:interested, xaylo:high-intent"></label>
      <div class="actions"><button type="submit">Save journey</button><button v-if="selectedId" type="button" class="danger" @click="remove">Delete</button><span>{{ notice }}</span></div>
    </form></section>
  </div>
</template>

<style scoped>
.layout{display:grid;grid-template-columns:minmax(230px,1fr) minmax(0,2fr);gap:18px}.panel{background:#171827;border:1px solid #303144;border-radius:14px;padding:24px}.aside-head,.actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.aside-head h2{margin:0}.journey{display:block;width:100%;text-align:left;margin-top:10px;background:#202237;color:#fff;border:1px solid #34364c}.journey.selected{border-color:#e8b923}.journey strong,.journey small{display:block}.journey small{color:#aeb2c8;margin-top:3px}.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:block;color:#c7cbe0;font-size:13px;margin:12px 0}input,textarea,select{display:block;width:100%;background:#0d0e1a;border:1px solid #3a3d54;border-radius:8px;color:#fff;padding:10px 12px;margin-top:5px;font:inherit}textarea{resize:vertical}input:focus,textarea:focus,select:focus{outline:2px solid #e8b923}h2{font-size:20px;margin:0 0 6px}h3{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#e8b923;margin:25px 0 12px}button{background:#e8b923;color:#111;border:0;border-radius:8px;padding:10px 15px;font-weight:800;cursor:pointer}.danger{background:#47252d;color:#ffe0e4}.muted{color:#aeb2c8;font-size:13px}.error{color:#ffcdd4;margin:10px 0}.actions span{color:#e8b923;font-size:13px}@media(max-width:850px){.layout,.row{grid-template-columns:1fr}}
</style>
