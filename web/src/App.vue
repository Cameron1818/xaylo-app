<script setup>
import { ref, computed, onMounted } from 'vue'
import TrafficView from './TrafficView.vue'
import JourneyManager from './JourneyManager.vue'
import Reports from './Reports.vue'
import Connections from './Connections.vue'
import AccountAccess from './AccountAccess.vue'
import Billing from './Billing.vue'

const tabs = ['Overview', 'Reports', 'Journeys', 'Tracking', 'Connections', 'Billing', 'Settings']
const tab = ref(new URLSearchParams(location.search).has('billing') ? 'Billing' : 'Overview')
const token = ref('')
const status = ref('Connecting…')
const error = ref('')
const journeys = ref([])
const events = ref([])
const settings = ref(null)
const traffic = ref(null)
const days = ref(30)
const origins = ref('')
const savingSettings = ref(false)
const isPreview = ref(false)
const standalone = ref(false)
const connecting = ref(true)
const logoUrl = '/assets/xaylo-logo.png'
const totalSessions = computed(() => traffic.value?.paths.reduce((sum, path) => sum + path.sessions, 0) || 0)
const conversions = computed(() => traffic.value?.paths.filter(path => path.steps.includes('xaylo:conversion')).reduce((sum, path) => sum + path.sessions, 0) || 0)
const snippet = computed(() => settings.value ? `<script async src="${location.origin}/assets/tracker.js" data-site-key="${settings.value.siteKey}"></` + 'script>' : '')

async function api(path, options = {}) {
  let response = await fetch(path, { ...options, headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token.value}`, ...options.headers } })
  if (response.status === 401 && standalone.value) {
    const refreshed = await fetch('/api/auth/session', { method: 'POST' })
    if (refreshed.ok) { token.value = (await refreshed.json()).token; response = await fetch(path, { ...options, headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token.value}`, ...options.headers } }) }
    else { token.value = ''; status.value = 'Sign in'; throw new Error('Your session expired. Sign in again.') }
  }
  const body = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`)
  return body
}
async function load() {
  const [journeyData, locationSettings, activity] = await Promise.all([api('/api/journeys'), api('/api/settings'), api('/api/events')])
  journeys.value = journeyData.journeys
  settings.value = locationSettings
  origins.value = locationSettings.allowedOrigins.join('\n')
  events.value = activity.events
  await loadTraffic()
}
async function loadTraffic() {
  try { traffic.value = await api(`/api/traffic?days=${days.value}`); error.value = '' }
  catch (cause) { error.value = cause.message }
}
async function saveOrigins() {
  savingSettings.value = true
  try {
    const allowedOrigins = origins.value.split('\n').map(value => value.trim()).filter(Boolean)
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ allowedOrigins }) })
    settings.value = { ...settings.value, allowedOrigins }
    error.value = ''
  } catch (cause) { error.value = cause.message }
  finally { savingSettings.value = false }
}
async function requestGhlContext() {
  return new Promise((resolve, reject) => {
    if (window.parent === window) return reject(new Error('Open this page inside HighLevel.'))
    const timeout = setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('HighLevel did not provide user context.')) }, 10000)
    function handler(event) {
      if (event.source === window.parent && event.data?.message === 'REQUEST_USER_DATA_RESPONSE') {
        clearTimeout(timeout); window.removeEventListener('message', handler); resolve(event.data.payload)
      }
    }
    window.addEventListener('message', handler)
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
  })
}
async function connect() {
  const login = new URLSearchParams(location.hash.slice(1)).get('signin')
  if (login) {
    history.replaceState(null, '', '/app')
    const response = await fetch('/api/auth/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: login }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Sign-in link expired')
    token.value = result.token; status.value = result.email; standalone.value = true
  }
  if (!token.value && window.parent === window) {
    const response = await fetch('/api/auth/session', { method: 'POST' })
    if (response.ok) { const result = await response.json(); token.value = result.token; status.value = result.email; standalone.value = true }
  }
  if (!token.value && window.parent === window && location.hostname === 'localhost') {
    const preview = await fetch('/api/dev/session')
    if (preview.ok) { token.value = (await preview.json()).token; status.value = 'Local preview'; isPreview.value = true }
  }
  if (!token.value && window.parent === window) { status.value = 'Sign in'; return }
  if (!token.value) {
    const encryptedData = await requestGhlContext()
    const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ encryptedData }) })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Sign in failed')
    token.value = body.token
    status.value = 'Connected'
  }
  await load()
}
async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }) } finally { token.value = ''; standalone.value = false; journeys.value = []; traffic.value = null; settings.value = null; status.value = 'Sign in' }
}
onMounted(() => { connect().catch(cause => { status.value = 'Connection failed'; error.value = cause.message }).finally(() => { connecting.value = false }) })
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand"><img class="brand-logo" :src="logoUrl" alt="Xaylo"><small>Journeys</small></div>
      <nav v-if="token" aria-label="Dashboard"><button v-for="item in tabs" :key="item" :class="{ active: tab === item }" @click="tab = item">{{ item }}</button></nav>
      <span class="connection">{{ status }}</span><button v-if="standalone && token" class="logout" @click="logout">Sign out</button>
      <a class="guide-link" href="/guide" target="_blank" rel="noopener noreferrer">Guide ↗</a>
    </header>
    <main>
      <div v-if="error" class="error" role="alert">{{ error }}</div>
      <div v-if="!token && connecting" class="empty">Connecting to your Xaylo workspace…</div>
      <AccountAccess v-else-if="!token" />
      <template v-else>
        <section v-if="tab === 'Overview'">
          <div class="section-title"><div><span class="eyebrow">DASHBOARD</span><h1>Overview</h1><p>See how visitors move through your website and where they convert.</p><button class="analysis-link" @click="tab = 'Reports'">Traffic analysis & marketing recommendations →</button></div><label class="period">Period<select v-model.number="days" @change="loadTraffic"><option :value="7">Last 7 days</option><option :value="30">Last 30 days</option><option :value="90">Last 90 days</option></select></label></div>
          <p v-if="isPreview && totalSessions" class="preview-note">Local test data · {{ totalSessions.toLocaleString() }} visitor journeys</p>
          <div class="metrics"><div class="metric"><span>Sessions</span><strong>{{ totalSessions.toLocaleString() }}</strong></div><div class="metric"><span>Conversions</span><strong>{{ conversions.toLocaleString() }}</strong></div><div class="metric"><span>Conversion rate</span><strong>{{ totalSessions ? (conversions / totalSessions * 100).toFixed(1) : '0.0' }}%</strong></div><div class="metric"><span>Published journeys</span><strong>{{ journeys.filter(j => j.status === 'published').length }}</strong></div></div>
          <div v-if="traffic && totalSessions" class="board-card"><TrafficView :key="days" :traffic="traffic" /></div>
          <div v-else class="empty"><strong>Your visitor journey map is ready.</strong><p>Add the tracker to your website to see real visits and conversions here.</p><button @click="tab = 'Tracking'">Set up tracking</button></div>
        </section>
        <section v-else-if="tab === 'Reports'"><Reports :api="api" @subscribe="tab = 'Billing'" /></section>
        <section v-else-if="tab === 'Billing'"><Billing :api="api" /></section>
        <section v-else-if="tab === 'Connections'"><Connections :api="api" /></section>
        <section v-else-if="tab === 'Journeys'"><div class="section-title"><div><span class="eyebrow">BUILD</span><h1>Journeys</h1><p>Match visitor intent to a page, conversation and follow-up.</p></div></div><JourneyManager :journeys="journeys" :api="api" @changed="load" /></section>
        <section v-else-if="tab === 'Tracking'"><div class="section-title"><div><span class="eyebrow">CONNECT</span><h1>Tracking</h1><p>Install the script and choose which page elements Xaylo can personalise.</p></div></div><div class="panel"><h2>Website script</h2><p>Paste this into your site header after adding its origin under Settings.</p><textarea class="code" rows="3" readonly :value="snippet" @focus="$event.target.select()"></textarea><p>Mark page elements with <code>data-xaylo-headline</code>, <code>data-xaylo-description</code>, <code>data-xaylo-cta</code> and <code>data-xaylo-cta-link</code>.</p><p>Call <code>window.Xaylo.conversion()</code> after a confirmed conversion. GHL tags are added only when a signed contact token is present.</p></div><div class="panel"><h2>Recent activity</h2><div v-if="!events.length" class="muted">No tracked visits yet.</div><div v-for="event in events" :key="event.id" class="event"><span>{{ new Date(event.created_at).toLocaleString() }}</span><strong>{{ event.event_type }}</strong><span>{{ event.page_url }}</span></div></div></section>
        <section v-else><div class="section-title"><div><span class="eyebrow">ACCOUNT</span><h1>Settings</h1><p>Manage website origins for this installed sub-account.</p></div></div><div class="panel narrow"><h2>Website origins</h2><p>Enter each exact origin on a separate line, including <code>https://</code>.</p><form @submit.prevent="saveOrigins"><textarea v-model="origins" rows="5" placeholder="https://example.com"></textarea><button type="submit" :disabled="savingSettings">Save origins</button></form><p class="muted">Location ID: {{ settings?.locationId }}</p></div></section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.guide-link{font-size:12px;color:#e8d17e;white-space:nowrap;text-decoration:none}.guide-link:hover{text-decoration:underline}.logout{background:transparent;border:1px solid #3a3d54;color:#d4d7e8;padding:8px;border-radius:7px;cursor:pointer}.analysis-link{background:transparent;border:0;color:#e8b923;padding:0;cursor:pointer;font:inherit}.shell{min-height:100vh}.topbar{display:flex;align-items:center;gap:28px;padding:12px clamp(16px,3vw,42px);border-bottom:1px solid #303144;background:#10111d;position:sticky;top:0;z-index:20}.brand{display:flex;align-items:center;gap:8px;white-space:nowrap}.brand-logo{display:block;width:160px;height:32px;object-fit:contain;mix-blend-mode:screen}.brand small{font-size:11px;font-weight:500;color:#8d93a7;margin-left:3px}.topbar nav{display:flex;gap:5px;flex:1;overflow:auto}.topbar nav button{background:transparent;border:0;color:#abb0c7;border-radius:8px;padding:10px 14px;cursor:pointer;font:inherit;white-space:nowrap}.topbar nav button:hover,.topbar nav button.active{background:#27283b;color:#fff}.topbar nav button.active{box-shadow:inset 0 -2px #e8b923}.connection{font-size:12px;color:#e8b923;white-space:nowrap}main{max-width:1600px;margin:auto;padding:32px clamp(16px,3vw,42px) 70px}.section-title{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:24px}.eyebrow{font-size:11px;color:#e8b923;letter-spacing:.2em;font-weight:800}h1{font-size:clamp(28px,4vw,42px);margin:4px 0}h2{font-size:19px}p{color:#aeb2c8}.preview-note{display:inline-block;margin:0 0 16px;padding:7px 12px;border:1px solid #5a5228;border-radius:99px;color:#e8b923;font-size:12px}.period{color:#aeb2c8;font-size:12px}.period select{display:block;margin-top:5px;background:#1d1e2f;color:white;border:1px solid #3a3d54;border-radius:7px;padding:9px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}.metric,.panel,.board-card,.empty{background:#171827;border:1px solid #303144;border-radius:14px}.metric{padding:20px}.metric span{display:block;color:#aaaec5;font-size:12px}.metric strong{display:block;font-size:29px;margin-top:5px}.board-card{overflow:hidden}.board-card :deep(.app){padding:22px;min-height:0}.board-card :deep(.app-header){display:none}.board-card :deep(.app-footer){display:none}.panel{padding:25px;margin-bottom:18px}.panel.narrow{max-width:750px}.panel textarea{display:block;width:100%;background:#0e0f1b;border:1px solid #3a3d54;border-radius:8px;color:#fff;padding:12px;font:inherit;margin:12px 0}.panel .code{font-family:ui-monospace,monospace;font-size:12px}.panel button,.empty button{background:#e8b923;border:0;border-radius:8px;padding:10px 17px;font-weight:800;cursor:pointer}.panel code{color:#e8b923}.muted{color:#8d93a7}.event{display:flex;gap:18px;flex-wrap:wrap;border-top:1px solid #303144;padding:11px 0;color:#aeb2c8;font-size:12px}.event strong{color:#fff}.empty{padding:55px 30px;text-align:center}.empty strong{font-size:21px}.error{border:1px solid #b44755;background:#421f2a;color:#ffe5e7;padding:12px 16px;border-radius:9px;margin-bottom:18px}@media(max-width:900px){.topbar{flex-wrap:wrap;gap:7px}.connection{display:none}.topbar nav{order:2;width:100%;flex:auto}.metrics{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.metrics{grid-template-columns:1fr 1fr}.metric{padding:14px}.metric strong{font-size:22px}.section-title{display:block}.period{display:inline-block;margin-top:12px}}
</style>
