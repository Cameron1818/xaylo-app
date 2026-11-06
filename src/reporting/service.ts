import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getEnv } from '../config/env.js';
import { assertActive, httpError } from '../security/access.js';
import { businessContext, crmSummary } from '../ghl/reporting.js';
import { googleReport } from '../google/reporting.js';
import { selectedAccount } from '../google/client.js';
import { trafficSummary } from './traffic.js';
import { generateAnalysis } from './ai.js';
import { promptVersion } from './prompts.js';
import { requireAnalysisAccess, reserveReport, releaseReport } from '../billing/entitlements.js';
import { reportPeriod, reportInput, type Period } from './period.js';

export const contextSchema = z.object({ services: z.string().max(3000).default(''), audience: z.string().max(3000).default(''), goals: z.string().max(3000).default(''),
  constraints: z.string().max(3000).default(''), conversionDefinition: z.string().max(1000).default(''), segmentFieldIds: z.array(z.string().min(1).max(100)).max(10).default([]) }).strict();
export async function getContext(locationId: string) {
  const result = await pool.query('SELECT reporting_context FROM installations WHERE location_id=$1 AND status=\'active\'', [locationId]);
  if (!result.rows[0]) throw httpError(403, 'Location is not installed');
  return contextSchema.parse(result.rows[0].reporting_context);
}
type Source<T> = { status: 'available'; data: T } | { status: 'unavailable'; message: string };
async function source<T>(operation: () => Promise<T>): Promise<Source<T>> {
  try { return { status: 'available', data: await operation() }; }
  catch (error) {
    if (error instanceof Error && error.message.includes('another location')) throw error;
    return { status: 'unavailable', message: error instanceof Error && 'statusCode' in error ? error.message : 'Source data is unavailable' };
  }
}
export async function clientContext(locationId: string) {
  return { strategy: await getContext(locationId), business: await source(() => businessContext(locationId)) };
}
export async function connectedSources(locationId: string) {
  const workspace = await pool.query("SELECT ghl_location_id FROM installations WHERE location_id=$1 AND status='active'", [locationId]);
  if (!workspace.rows[0]) throw httpError(403, 'Workspace is not active');
  const accounts = await pool.query('SELECT customer_id,name,currency,time_zone FROM google_accounts WHERE location_id=$1 ORDER BY name', [locationId]);
  return { ghlConnected: Boolean(workspace.rows[0].ghl_location_id), googleAdsAccounts: accounts.rows };
}
export async function overview(locationId: string, input: z.infer<typeof reportInput>, period: Period = reportPeriod(input.days)) {
  await assertActive(locationId);
  await requireAnalysisAccess(locationId, input.days);
  // Reject foreign account references before fetching any source or invoking AI.
  if (input.customerId) await selectedAccount(locationId, input.customerId);
  const context = await getContext(locationId);
  const [traffic, business, crm, ads] = await Promise.all([
    trafficSummary(locationId, period), source(() => businessContext(locationId)), source(() => crmSummary(locationId, period, context.segmentFieldIds)),
    input.customerId ? source(() => googleReport(locationId, input.customerId!, period)) : Promise.resolve({ status: 'unavailable' as const, message: 'No Google Ads account selected for this report' })
  ]);
  const limitations = [...traffic.limitations];
  if (business.status === 'unavailable') limitations.push(business.message);
  if (crm.status === 'unavailable') limitations.push(crm.message); else limitations.push(...crm.data.limitations);
  if (ads.status === 'unavailable') limitations.push(ads.message); else limitations.push(...ads.data.limitations);
  let mappingCoverage = null;
  if (input.customerId) {
    const account = await selectedAccount(locationId, input.customerId);
    const campaignIds = new Set(ads.status === 'available' ? ads.data.rows.map(row => row.campaignId) : []);
    const googleChannels = traffic.channels.filter(row => row.source.toLowerCase() === 'google');
    const mapped = googleChannels.filter(row => campaignIds.has(row.campaignId || account.campaign_mappings[row.campaign] || ''));
    const total = googleChannels.reduce((n, row) => n + row.sessions, 0);
    const linked = mapped.reduce((n, row) => n + row.sessions, 0);
    mappingCoverage = { googleSessions: total, campaignMappedSessions: linked, fraction: total ? linked / total : null,
      method: 'Explicit xaylo_campaign_id or configured UTM campaign mapping', source: 'xaylo' };
  }
  return { period, context, traffic, business, crm, ads, mappingCoverage, limitations, aiConfigured: Boolean(getEnv().OPENAI_API_KEY && getEnv().AI_MODEL) };
}
export function evidenceSnapshot(data: Awaited<ReturnType<typeof overview>>) {
  const evidence: Record<string, unknown> = Object.create(null);
  evidence['traffic.totals'] = { source: data.traffic.source, sourceReference: data.traffic.sourceReference, fetchedAt: data.traffic.fetchedAt, period: data.period,
    sessions: data.traffic.sessions, conversions: data.traffic.conversions, conversionRate: data.traffic.conversionRate, attributionModel: data.traffic.attributionModel,
    contactLinkedConversions: data.traffic.contactLinkedConversions, contactLinkCoverage: data.traffic.contactLinkCoverage };
  data.traffic.channels.slice(0, 25).forEach((row, index) => { evidence[`traffic.channel.${index}`] = row; });
  data.traffic.landingPages.slice(0, 25).forEach((row, index) => { evidence[`traffic.landing.${index}`] = row; });
  if (data.crm.status === 'available') {
    const { fetchedAt, sourceReference, contacts, opportunities } = data.crm.data;
    evidence['crm.summary'] = { fetchedAt, sourceReference, period: data.period, contacts, opportunities };
  }
  if (data.ads.status === 'available') {
    const { sourceReference, fetchedAt, account, period, totals, truncated, rows } = data.ads.data;
    evidence['ads.totals'] = { sourceReference, fetchedAt, account, period, totals, truncated };
    rows.slice(0, 25).forEach((row, index) => { evidence[`ads.campaign.${index}`] = row; });
  }
  if (data.mappingCoverage) evidence['attribution.coverage'] = data.mappingCoverage;
  return evidence;
}
export async function createReport(locationId: string, userId: string, input: z.infer<typeof reportInput>) {
  if (input.customerId) await selectedAccount(locationId, input.customerId);
  const reservation = await reserveReport(locationId, input.days);
  try {
    const data = await overview(locationId, input);
    const evidence = evidenceSnapshot(data);
    const business = data.business.status === 'available' ? data.business.data.business : {};
    const analysis = await generateAnalysis({ business, strategy: data.context, period: data.period }, evidence, data.limitations);
    for (const item of [...analysis.trafficAnalysis.findings, ...analysis.marketingRecommendations]) {
      const sparseTraffic = item.evidenceIds.some(id => id.startsWith('traffic.')) && data.traffic.sessions < 30;
      const partialCrm = item.evidenceIds.some(id => id.startsWith('crm.')) && data.crm.status === 'available' && (!data.crm.data.contacts.complete || !data.crm.data.opportunities.complete);
      const partialAds = item.evidenceIds.some(id => id.startsWith('ads.')) && data.ads.status === 'available' && data.ads.data.truncated;
      if (sparseTraffic || partialCrm || partialAds) item.confidence = 'low';
    }
    analysis.dataQuality = [...new Set([...data.limitations, ...analysis.dataQuality])];
    const id = randomUUID();
    const contextVersion = createHash('sha256').update(JSON.stringify(data.context)).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const active = await client.query("SELECT 1 FROM installations WHERE location_id=$1 AND status='active' FOR UPDATE", [locationId]);
      if (!active.rowCount) throw httpError(403, 'Workspace is not active');
      await client.query(`INSERT INTO reports(id,location_id,created_by,period,prompt_version,model,analysis,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, locationId, userId, data.period, promptVersion, getEnv().AI_MODEL, analysis,
          { metrics: evidence, contextVersion, businessSourceReference: data.business.status === 'available' ? data.business.data.sourceReference : null, limitations: data.limitations, detailLimit: 25 }]);
      const completed = await client.query("UPDATE report_usage SET status='completed',report_id=$3 WHERE location_id=$1 AND id=$2 AND status='pending' AND expires_at>now() RETURNING id", [locationId, reservation, id]);
      if (!completed.rowCount) throw httpError(409, 'Report reservation expired. Try again.');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return getReport(locationId, id);
  } catch (error) { await releaseReport(locationId, reservation); throw error; }
}
export async function listReports(locationId: string) {
  return (await pool.query('SELECT id,created_at,period,prompt_version,model FROM reports WHERE location_id=$1 ORDER BY created_at DESC LIMIT 50', [locationId])).rows;
}
export async function getReport(locationId: string, id: string) {
  const result = await pool.query('SELECT id,created_at,period,prompt_version,model,analysis,evidence FROM reports WHERE location_id=$1 AND id=$2', [locationId, z.string().uuid().parse(id)]);
  if (!result.rows[0]) throw httpError(404, 'Report not found');
  return result.rows[0];
}
