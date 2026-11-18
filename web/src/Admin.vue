<script setup>
import { ref, onMounted, watch } from 'vue'
const props = defineProps({ api: { type: Function, required: true } })
const sections = ['Accounts', 'Users', 'Payments', 'Settings', 'Audit']
const section = ref('Accounts')
const error = ref(''), notice = ref(''), busy = ref(false)
const q = ref(''), page = ref(0)
const accounts = ref([]), users = ref([]), invoices = ref([]), audit = ref([]), settings = ref(null)
const hasMore = ref(false), invoiceAfter = ref([])
const detail = ref(null), billing = ref(null)
const aiKey = ref(''), aiModel = ref('')
const trialDays = ref(7), refundIntent = ref(''), refundAmount = ref('')

const date = value => value ? new Date(value).toLocaleDateString() : '—'
const money = (amount, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((amount || 0) / 100)
async function run(task, message = '') {
  busy.value = true; error.value = ''; notice.value = ''
  try { const result = await task(); if (message) notice.value = message; return result }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
const query = () => `q=${encodeURIComponent(q.value)}&page=${page.value}`
async function loadAccounts() { await run(async () => { const r = await props.api(`/api/admin/accounts?${query()}`); accounts.value = r.accounts; hasMore.value = r.hasMore }) }
async function loadUsers() { await run(async () => { const r = await props.api(`/api/admin/users?${query()}`); users.value = r.users; hasMore.value = r.hasMore }) }
async function loadInvoices(after) {
  await run(async () => { const r = await props.api(`/api/admin/payments${after ? `?after=${after}` : ''}`); invoices.value = r.invoices; hasMore.value = r.hasMore })
}
async function loadSettings() {
  await run(async () => { settings.value = await props.api('/api/admin/settings'); aiModel.value = settings.value.ai.model; aiKey.value = '' })
}
async function loadAudit() { await run(async () => { audit.value = (await props.api('/api/admin/audit')).entries }) }
function load() {
  hasMore.value = false; page.value = 0; invoiceAfter.value = []
  return ({ Accounts: loadAccounts, Users: loadUsers, Payments: () => loadInvoices(), Settings: loadSettings, Audit: loadAudit })[section.value]()
}
function turn(delta) { page.value = Math.max(0, page.value + delta); return section.value === 'Users' ? loadUsers() : loadAccounts() }
function nextInvoices() { invoiceAfter.value.push(invoices.value[invoices.value.length - 1].id); return loadInvoices(invoiceAfter.value[invoiceAfter.value.length - 1]) }
function prevInvoices() { invoiceAfter.value.pop(); return loadInvoices(invoiceAfter.value[invoiceAfter.value.length - 1]) }

async function open(id) {
  detail.value = null; billing.value = null
  await run(async () => {
    detail.value = await props.api(`/api/admin/accounts/${encodeURIComponent(id)}`)
    billing.value = await props.api(`/api/admin/accounts/${encodeURIComponent(id)}/billing`).catch(cause => ({ error: cause.message, subscriptions: [], invoices: [] }))
  })
}
async function accountAction(path, body, message, method = 'POST') {
  const id = detail.value.account.location_id
  const done = await run(() => props.api(`/api/admin/accounts/${encodeURIComponent(id)}/${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), message)
  if (done) { await open(id); loadAccounts() }
}
async function suspend(on) { if (!on || confirm('Suspend this account? Its members will be signed out and blocked.')) await accountAction(on ? 'suspend' : 'unsuspend', null, on ? 'Account suspended' : 'Account restored') }
async function cancelSub(immediately) { if (confirm(immediately ? 'Cancel the subscription immediately?' : 'Cancel at the end of the billing period?')) await accountAction('billing/cancel', { immediately }, 'Cancellation sent to Stripe') }
async function extendTrial() { await accountAction('billing/extend-trial', { days: Number(trialDays.value) }, 'Trial extended') }
async function refund() {
  if (!confirm('Issue this refund in Stripe?')) return
  const amount = refundAmount.value ? Math.round(Number(refundAmount.value) * 100) : undefined
  await accountAction('billing/refund', { paymentIntent: refundIntent.value.trim(), ...(amount ? { amount } : {}) }, 'Refund issued')
}
async function deleteAccount() {
  const id = detail.value.account.location_id
  if (prompt(`Permanently delete this account and all of its data? Type ${id} to confirm.`) !== id) return
  if (await run(() => props.api(`/api/admin/accounts/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: id }) }), 'Account deleted')) { detail.value = null; loadAccounts() }
}
async function revoke(user) { if (await run(() => props.api(`/api/admin/users/${user.id}/revoke-sessions`, { method: 'POST' }), `Signed ${user.email} out everywhere`)) loadUsers() }
async function removeUser(user) { if (confirm(`Delete ${user.email}?`) && await run(() => props.api(`/api/admin/users/${user.id}`, { method: 'DELETE' }), 'User deleted')) loadUsers() }
async function saveSettings() {
  const body = { aiModel: aiModel.value }
  if (aiKey.value) body.aiApiKey = aiKey.value
  if (await run(() => props.api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }), 'Settings saved')) loadSettings()
}
async function clearKey() { if (confirm('Remove the stored key? The environment value (if any) will be used.') && await run(() => props.api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ aiApiKey: '' }) }), 'Stored key removed')) loadSettings() }
watch(section, () => { detail.value = null; q.value = ''; error.value = ''; notice.value = ''; load() })
onMounted(load)
</script>

<template>
  <section class="admin">
    <span class="eyebrow">ADMIN</span><h1>Administration</h1>
    <nav class="subtabs"><button v-for="item in sections" :key="item" :class="{ active: section === item }" @click="section = item">{{ item }}</button></nav>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>

    <div v-if="section === 'Accounts' && !detail" class="panel">
      <form class="search" @submit.prevent="page = 0; loadAccounts()"><input v-model="q" placeholder="Search by email or account id"><button>Search</button></form>
      <table><thead><tr><th>Account</th><th>Members</th><th>Plan</th><th>Reports</th><th>Created</th></tr></thead><tbody>
        <tr v-for="a in accounts" :key="a.location_id" class="row" @click="open(a.location_id)">
          <td><code>{{ a.location_id }}</code><span v-if="a.suspended_at" class="tag bad">suspended</span><span v-if="a.status !== 'active'" class="tag">{{ a.status }}</span></td>
          <td>{{ a.emails.join(', ') || '—' }}</td><td>{{ a.stripe_subscription_id ? 'Subscribed' : 'Free' }}</td><td>{{ a.reports }}</td><td>{{ date(a.created_at) }}</td></tr>
        <tr v-if="!accounts.length"><td colspan="5" class="muted">No accounts found.</td></tr></tbody></table>
      <div class="pager"><button :disabled="!page" @click="turn(-1)">← Previous</button><button :disabled="!hasMore" @click="turn(1)">Next →</button></div>
    </div>

    <div v-if="section === 'Accounts' && detail" class="panel">
      <button class="link" @click="detail = null">← All accounts</button>
      <h2><code>{{ detail.account.location_id }}</code><span v-if="detail.account.suspended_at" class="tag bad">suspended</span></h2>
      <p class="muted">Created {{ date(detail.account.created_at) }} · Trial started {{ date(detail.account.trial_started_at) }} · {{ detail.journeys }} journeys · {{ detail.account.ghl_location_id ? 'HighLevel linked' : 'Email account' }}</p>
      <h3>Members</h3><ul><li v-for="m in detail.members" :key="m.id">{{ m.email }} <span class="tag">{{ m.role }}</span></li></ul>
      <h3>Report usage</h3><ul><li v-for="u in detail.usage" :key="u.window_key">{{ u.window_key }}: {{ u.count }}</li><li v-if="!detail.usage.length" class="muted">None yet</li></ul>
      <h3>Billing</h3>
      <p v-if="billing?.error" class="error">{{ billing.error }}</p>
      <p v-else-if="!billing?.customerId" class="muted">No Stripe customer yet.</p>
      <template v-else>
        <table><thead><tr><th>Subscription</th><th>Status</th><th>Renews / ends</th></tr></thead><tbody>
          <tr v-for="s in billing.subscriptions" :key="s.id"><td><code>{{ s.id }}</code></td><td>{{ s.status }}<span v-if="s.cancelAtPeriodEnd" class="tag">cancels at period end</span></td><td>{{ date(s.currentPeriodEnd) }}</td></tr></tbody></table>
        <table><thead><tr><th>Invoice</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead><tbody>
          <tr v-for="i in billing.invoices" :key="i.id"><td><a v-if="i.url" :href="i.url" target="_blank" rel="noopener noreferrer">{{ i.number || i.id }}</a><template v-else>{{ i.number || i.id }}</template></td><td>{{ i.status }}</td><td>{{ money(i.amountPaid || i.amountDue, i.currency) }}</td><td>{{ date(i.created) }}</td></tr></tbody></table>
      </template>
      <div class="actions">
        <template v-if="detail.account.stripe_subscription_id"><button :disabled="busy" @click="cancelSub(false)">Cancel at period end</button><button class="danger" :disabled="busy" @click="cancelSub(true)">Cancel now</button></template>
        <label class="inline">Extend trial by <input v-model="trialDays" type="number" min="1" max="90"> days</label><button :disabled="busy" @click="extendTrial">Extend</button>
      </div>
      <form v-if="billing?.customerId" class="actions" @submit.prevent="refund"><input v-model="refundIntent" placeholder="Payment intent id (pi_…)" required><input v-model="refundAmount" type="number" step="0.01" min="0.01" placeholder="Amount (blank = full)"><button class="danger" :disabled="busy">Refund</button></form>
      <h3>Account actions</h3>
      <div class="actions"><button :disabled="busy" @click="suspend(!detail.account.suspended_at)">{{ detail.account.suspended_at ? 'Restore account' : 'Suspend account' }}</button><button class="danger" :disabled="busy" @click="deleteAccount">Delete account…</button></div>
      <h3>Admin history</h3><ul><li v-for="(a, n) in detail.audit" :key="n">{{ date(a.created_at) }} · {{ a.action }} · {{ a.admin_email }}</li><li v-if="!detail.audit.length" class="muted">No admin actions yet</li></ul>
    </div>

    <div v-if="section === 'Users'" class="panel">
      <form class="search" @submit.prevent="page = 0; loadUsers()"><input v-model="q" placeholder="Search by email"><button>Search</button></form>
      <table><thead><tr><th>Email</th><th>Workspaces</th><th>Sessions</th><th>Joined</th><th></th></tr></thead><tbody>
        <tr v-for="u in users" :key="u.id"><td>{{ u.email }}<span v-if="u.isAdmin" class="tag">admin</span></td><td><button v-for="w in u.workspaces" :key="w" class="link" @click="section = 'Accounts'; $nextTick(() => open(w))"><code>{{ w }}</code></button></td><td>{{ u.sessions }}</td><td>{{ date(u.created_at) }}</td>
          <td class="end"><button :disabled="busy || !u.sessions" @click="revoke(u)">Sign out</button><button v-if="!u.isAdmin" class="danger" :disabled="busy" @click="removeUser(u)">Delete</button></td></tr>
        <tr v-if="!users.length"><td colspan="5" class="muted">No users found.</td></tr></tbody></table>
      <div class="pager"><button :disabled="!page" @click="turn(-1)">← Previous</button><button :disabled="!hasMore" @click="turn(1)">Next →</button></div>
    </div>

    <div v-if="section === 'Payments'" class="panel">
      <table><thead><tr><th>Invoice</th><th>Customer</th><th>Account</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead><tbody>
        <tr v-for="i in invoices" :key="i.id"><td><a v-if="i.url" :href="i.url" target="_blank" rel="noopener noreferrer">{{ i.number || i.id }}</a><template v-else>{{ i.number || i.id }}</template></td><td>{{ i.email || '—' }}</td>
          <td><button v-if="i.accountId" class="link" @click="section = 'Accounts'; $nextTick(() => open(i.accountId))"><code>{{ i.accountId }}</code></button><template v-else>—</template></td><td>{{ i.status }}</td><td>{{ money(i.amountPaid || i.amountDue, i.currency) }}</td><td>{{ date(i.created) }}</td></tr>
        <tr v-if="!invoices.length"><td colspan="6" class="muted">No invoices.</td></tr></tbody></table>
      <div class="pager"><button :disabled="!invoiceAfter.length" @click="prevInvoices">← Newer</button><button :disabled="!hasMore" @click="nextInvoices">Older →</button></div>
    </div>

    <div v-if="section === 'Settings' && settings" class="panel narrow">
      <h2>AI provider</h2>
      <p class="muted">Current key: <code>{{ settings.ai.keyMasked || 'not set' }}</code> ({{ settings.ai.keySource === 'db' ? 'stored in the database, encrypted' : settings.ai.keySource === 'env' ? 'from the server environment' : 'none' }}). A stored key overrides the environment.</p>
      <form @submit.prevent="saveSettings">
        <label>Replace API key<input v-model="aiKey" type="password" autocomplete="off" placeholder="Leave blank to keep the current key"></label>
        <label>Model<input v-model="aiModel" placeholder="e.g. gpt-5"></label>
        <div class="actions"><button :disabled="busy">Save</button><button v-if="settings.ai.keySource === 'db'" type="button" class="danger" :disabled="busy" @click="clearKey">Remove stored key</button></div>
      </form>
      <h2>Platform</h2>
      <p class="muted">Stripe: {{ settings.billing.stripeConfigured ? 'configured' : 'not configured' }} · Free trial: {{ settings.billing.freeTrialDays }} days · Paid reports/month: {{ settings.billing.paidReportsPerMonth }} (set via server environment)</p>
      <p class="muted">Admins (<code>ADMIN_EMAILS</code>): {{ settings.admins.join(', ') }}</p>
    </div>

    <div v-if="section === 'Audit'" class="panel">
      <table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th></tr></thead><tbody>
        <tr v-for="(a, n) in audit" :key="n"><td>{{ new Date(a.created_at).toLocaleString() }}</td><td>{{ a.admin_email }}</td><td>{{ a.action }}</td><td><code>{{ a.target || '—' }}</code></td></tr>
        <tr v-if="!audit.length"><td colspan="4" class="muted">No admin activity yet.</td></tr></tbody></table>
    </div>
  </section>
</template>

<style scoped>
.admin{max-width:1100px}.eyebrow{font-size:11px;letter-spacing:.15em;color:#e8b923}h1{font-size:36px}h2{font-size:20px}h3{font-size:14px;margin:22px 0 8px;color:#b8bdd0}.panel{padding:24px;border:1px solid #303144;border-radius:14px;background:#171827;margin-top:16px;overflow-x:auto}.narrow{max-width:620px}
.subtabs{display:flex;gap:6px;flex-wrap:wrap}.subtabs button,.pager button,.actions button,.search button,.end button{background:transparent;border:1px solid #3a3d54;color:#d4d7e8;padding:8px 12px;border-radius:7px;cursor:pointer}.subtabs button.active{border-color:#e8b923;color:#e8b923}button:disabled{opacity:.45;cursor:not-allowed}
.danger{border-color:#7a3340!important;color:#ff9aa8!important}.link{background:none;border:0;color:#e8d17e;cursor:pointer;padding:0 6px 0 0;font:inherit}.search,.actions,.pager{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0}.search input{flex:1;min-width:200px}
input{background:#10111d;border:1px solid #303144;color:#fff;border-radius:7px;padding:8px 10px;font:inherit}label{display:grid;gap:6px;margin:12px 0;color:#b8bdd0;font-size:14px}label.inline{display:flex;align-items:center;gap:6px;margin:0}label.inline input{width:70px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0}th{text-align:left;color:#8b90a8;font-weight:500;padding:8px;border-bottom:1px solid #303144}td{padding:9px 8px;border-bottom:1px solid #23243a;vertical-align:top}.row{cursor:pointer}.row:hover{background:#1d1f33}.end{white-space:nowrap}.end button{margin-left:6px}
.tag{margin-left:8px;padding:2px 7px;border-radius:99px;background:#26283d;color:#b8bdd0;font-size:11px}.tag.bad{background:#4a1f29;color:#ff9aa8}.muted{color:#8b90a8}.notice{color:#7fe0a0}code{font-size:12px}ul{margin:0;padding-left:18px;line-height:1.8}
</style>
