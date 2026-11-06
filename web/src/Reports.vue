<script setup>
import { ref, onMounted } from 'vue'
const emit = defineEmits(['subscribe'])
const access = ref(null)
const props = defineProps({ api: { type: Function, required: true } })
const days = ref(7), accountId = ref(''), accounts = ref([]), data = ref(null), reports = ref([]), selected = ref(null)
const error = ref(''), loading = ref(false), generating = ref(false)
const percent = value => value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`
const amount = (value, currency) => value === null || value === undefined ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
async function load() {
  loading.value = true; error.value = ''
  try {
    access.value = await props.api('/api/billing')
    reports.value = (await props.api('/api/reports')).reports
    if (!access.value.canAnalyse) { data.value = null; return }
    data.value = await props.api(`/api/analysis?days=${days.value}${accountId.value ? `&customerId=${accountId.value}` : ''}`)
  } catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}
async function generate() {
  generating.value = true; error.value = ''
  try {
    selected.value = await props.api('/api/reports', { method: 'POST', body: JSON.stringify({ days: days.value, ...(accountId.value ? { customerId: accountId.value } : {}) }) })
    reports.value = (await props.api('/api/reports')).reports
    access.value = await props.api('/api/billing')
  } catch (cause) { error.value = cause.message }
  finally { generating.value = false }
}
async function open(id) { try { selected.value = await props.api(`/api/reports/${id}`) } catch (cause) { error.value = cause.message } }
async function remove() {
  if (!selected.value || !confirm('Delete this saved report?')) return
  try { await props.api(`/api/reports/${selected.value.id}`, { method: 'DELETE' }); selected.value = null; reports.value = (await props.api('/api/reports')).reports }
  catch (cause) { error.value = cause.message }
}
onMounted(async () => {
  try { accounts.value = (await props.api('/api/google')).accounts; accountId.value = accounts.value[0]?.customer_id || '' }
  catch (cause) { error.value = cause.message }
  await load()
})
</script>
<template>
  <div class="reporting">
    <div class="section-title"><div><span class="eyebrow">UNDERSTAND & IMPROVE</span><h1>Analysis & reports</h1><p>Understand your traffic, advertising and sales outcomes, then decide what to improve.</p></div></div>
    <div class="toolbar"><label>Period<select v-model.number="days" @change="load"><option :value="7">Last 7 days</option><option :value="30" :disabled="access && access.maxLookbackDays < 30">Last 30 days</option><option :value="90" :disabled="access && access.maxLookbackDays < 90">Last 90 days</option></select></label><label>Google Ads account<select v-model="accountId" @change="load"><option value="">Traffic and CRM only</option><option v-for="account in accounts" :key="account.customer_id" :value="account.customer_id">{{ account.name }} · {{ account.currency }}</option></select></label><button :disabled="loading || generating" @click="load">Refresh analysis</button><button class="primary" :disabled="generating || loading || !data?.aiConfigured || !access?.canGenerate" @click="generate">{{ generating ? 'Writing your report…' : 'Generate AI report' }}</button></div>
    <p v-if="access && !access.paid" class="notice">{{ access.trialActive ? access.reportsRemaining + ' free AI report remaining' : 'Your trial has ended' }}{{ access.trialExpiresAt && access.trialActive ? ' · trial ends ' + new Date(access.trialExpiresAt).toLocaleDateString() : '' }}. <button @click="emit('subscribe')">View subscription</button></p>
    <div v-if="error" role="alert" class="error">{{ error }}</div><p v-if="loading" role="status">Reading your connected sources…</p>
    <template v-if="data">
      <p v-if="!data.aiConfigured" class="notice">AI reports are not configured for this installation yet. Your source analysis is available below.</p>
      <div class="metrics"><div><span>Website sessions</span><strong>{{ data.traffic.sessions.toLocaleString() }}</strong></div><div><span>Website conversions</span><strong>{{ data.traffic.conversions.toLocaleString() }}</strong></div><div><span>Website conversion rate</span><strong>{{ percent(data.traffic.conversionRate) }}</strong></div><div><span>Conversions linked to a CRM contact</span><strong>{{ percent(data.traffic.contactLinkCoverage) }}</strong></div></div>
      <div class="panel"><h2>Acquisition & campaign traffic</h2><p>Last non-direct attribution · website events · updated {{ new Date(data.traffic.fetchedAt).toLocaleString() }}</p><div class="scroll"><table><thead><tr><th>Source / medium</th><th>UTM campaign</th><th>Sessions</th><th>Website conversions</th><th>Conversion rate</th></tr></thead><tbody><tr v-for="(row, index) in data.traffic.channels" :key="index"><td>{{ row.source }} / {{ row.medium }}</td><td>{{ row.campaign || '—' }}</td><td>{{ row.sessions }}</td><td>{{ row.conversions }}</td><td>{{ percent(row.conversionRate) }}</td></tr></tbody></table></div><p v-if="!data.traffic.channels.length">No tracked traffic in this period.</p></div>
      <div class="panel"><h2>Landing-page performance</h2><div class="scroll"><table><thead><tr><th>Entry page</th><th>Sessions</th><th>Website conversions</th><th>Conversion rate</th></tr></thead><tbody><tr v-for="row in data.traffic.landingPages" :key="row.page"><td>{{ row.page }}</td><td>{{ row.sessions }}</td><td>{{ row.conversions }}</td><td>{{ percent(row.conversionRate) }}</td></tr></tbody></table></div></div>
      <div class="panel"><h2>Google Ads performance</h2><template v-if="data.ads.status === 'available'"><p>{{ data.ads.data.account.name }} · {{ data.ads.data.account.currency }} · {{ data.ads.data.period.timeZone }} · updated {{ new Date(data.ads.data.fetchedAt).toLocaleString() }}</p><div class="metrics"><div><span>Spend</span><strong>{{ amount(data.ads.data.totals.spend, data.ads.data.account.currency) }}</strong></div><div><span>Google conversions</span><strong>{{ data.ads.data.totals.conversions.toLocaleString() }}</strong></div><div><span>Cost per Google conversion</span><strong>{{ amount(data.ads.data.totals.cpa, data.ads.data.account.currency) }}</strong></div><div><span>Google ROAS</span><strong>{{ data.ads.data.totals.roas === null ? '—' : data.ads.data.totals.roas.toFixed(2) + '×' }}</strong></div></div><div class="scroll"><table><thead><tr><th>Campaign</th><th>Spend</th><th>Clicks</th><th>CTR</th><th>Google conversions</th><th>CPA</th></tr></thead><tbody><tr v-for="row in data.ads.data.rows" :key="row.campaignId"><td>{{ row.campaign }}</td><td>{{ amount(row.spend, data.ads.data.account.currency) }}</td><td>{{ row.clicks }}</td><td>{{ percent(row.ctr) }}</td><td>{{ row.conversions }}</td><td>{{ amount(row.cpa, data.ads.data.account.currency) }}</td></tr></tbody></table></div></template><p v-else>{{ data.ads.message }}</p><p v-if="data.mappingCoverage">Google website sessions mapped to a reported Ads campaign: {{ percent(data.mappingCoverage.fraction) }} ({{ data.mappingCoverage.campaignMappedSessions }} of {{ data.mappingCoverage.googleSessions }}).</p></div>
      <div class="panel"><h2>CRM outcomes</h2><template v-if="data.crm.status === 'available'"><p>{{ data.business.status === 'available' ? data.business.data.business.name : 'HighLevel' }} · updated {{ new Date(data.crm.data.fetchedAt).toLocaleString() }}</p><p>{{ data.crm.data.contacts.count }} contacts created in the reporting period{{ data.crm.data.contacts.complete ? '' : ' (partial)' }}. {{ data.crm.data.opportunities.count }} opportunities created in the period{{ data.crm.data.opportunities.complete ? '' : ' (partial)' }}.</p><div class="scroll"><table><thead><tr><th>Current opportunity status</th><th>Count</th><th>Pipeline value (currency unverified)</th></tr></thead><tbody><tr v-for="(row, name) in data.crm.data.opportunities.statuses" :key="name"><td>{{ name }}</td><td>{{ row.count }}</td><td>{{ row.monetaryValue.toLocaleString() }}</td></tr></tbody></table></div><p>Pipeline value is not collected revenue.</p></template><p v-else>{{ data.crm.message }}</p></div>
      <details class="panel"><summary>Source coverage & limitations</summary><ul><li v-for="(item, index) in data.limitations" :key="index">{{ item }}</li></ul></details>
    </template>
    <div class="report-layout"><aside class="panel"><h2>Saved reports</h2><p v-if="!reports.length">Generate a report to save your analysis and recommendations.</p><button v-for="report in reports" :key="report.id" class="saved" :class="{ active: selected?.id === report.id }" @click="open(report.id)">{{ new Date(report.created_at).toLocaleString() }}<small>{{ report.period.days }} days</small></button></aside>
      <article v-if="selected" class="panel"><div class="report-head"><div><h2>Marketing report</h2><p>{{ new Date(selected.created_at).toLocaleString() }} · {{ selected.period.days }} days</p></div><button @click="remove">Delete report</button></div><h3>Traffic analysis</h3><p class="prose">{{ selected.analysis.trafficAnalysis.summary }}</p><div v-for="(finding, index) in selected.analysis.trafficAnalysis.findings" :key="index" class="finding"><p>{{ finding.observation }}</p><small>{{ finding.confidence }} confidence · {{ finding.evidenceIds.join(', ') }}</small></div><h3>Recommended next steps</h3><div v-for="(item, index) in selected.analysis.marketingRecommendations" :key="index" class="finding"><span class="badge">{{ item.priority }} priority</span><h4>{{ item.action }}</h4><p>{{ item.rationale }}</p><small>{{ item.confidence }} confidence · {{ item.evidenceIds.join(', ') }}</small></div><h3>Data quality</h3><ul><li v-for="(item, index) in selected.analysis.dataQuality" :key="index">{{ item }}</li></ul><details><summary>Supporting metrics & report provenance</summary><p>Model: {{ selected.model }} · Prompt: {{ selected.prompt_version }}. Channel, landing-page and campaign evidence is limited to the leading 25 rows.</p><pre>{{ JSON.stringify(selected.evidence.metrics, null, 2) }}</pre></details></article>
    </div>
  </div>
</template>
<style scoped>
.toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-bottom:24px}label{display:grid;gap:7px;color:#b9bdd0;font-size:13px}select,button{background:#202237;color:#eef0ff;border:1px solid #3a3d54;border-radius:8px;padding:10px;font:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}.primary{background:#e8b923;color:#141521;font-weight:700}.panel{padding:24px;background:#171827;border:1px solid #303144;border-radius:14px;margin-bottom:18px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0}.metrics>div{background:#171827;border:1px solid #303144;border-radius:10px;padding:18px}.metrics span,.metrics strong{display:block}.metrics span{color:#aeb2c8;font-size:12px}.metrics strong{font-size:25px;margin-top:7px}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:12px;border-bottom:1px solid #303144;white-space:nowrap}th{color:#aeb2c8}td:first-child{white-space:normal;min-width:180px;overflow-wrap:anywhere}p,li{color:#b9bdd0;line-height:1.65}h1{font-size:36px;margin:6px 0}h2{font-size:20px;margin-top:0}h3{margin-top:28px;color:#e8b923}h4{font-size:16px;margin:10px 0}.eyebrow{color:#e8b923;font-size:11px;letter-spacing:.15em}.report-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:18px}.saved{display:block;text-align:left;width:100%;margin:10px 0}.saved small{display:block;margin-top:5px;color:#aeb2c8}.saved.active{border-color:#e8b923}.report-head{display:flex;justify-content:space-between;gap:12px}.finding{border-top:1px solid #303144;padding:16px 0}.finding small{color:#989fb8}.badge{font-size:11px;color:#e8b923}.prose{white-space:pre-line}.error,.notice{padding:14px;border:1px solid #a65c56;border-radius:9px;color:#ffdfd7}summary{cursor:pointer;color:#c8cce1}pre{font-size:11px;overflow:auto;max-height:400px;background:#0d0e19;padding:15px}details li{margin-top:8px}@media(max-width:900px){.metrics{grid-template-columns:1fr 1fr}.report-layout{grid-template-columns:1fr}.report-head{flex-wrap:wrap}}
</style>
