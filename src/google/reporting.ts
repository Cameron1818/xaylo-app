import { queryGoogle, selectedAccount } from './client.js';
import { adsDates, ratio, type Period } from '../reporting/period.js';

type Metrics = { impressions: number; clicks: number; spend: number; conversions: number; conversionValue: number };
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
export function adsMetrics(metrics: Record<string, unknown> = {}) {
  const values: Metrics = { impressions: number(metrics.impressions), clicks: number(metrics.clicks), spend: number(metrics.costMicros) / 1e6,
    conversions: number(metrics.conversions), conversionValue: number(metrics.conversionsValue) };
  return { ...values, ctr: ratio(values.clicks, values.impressions), cpc: ratio(values.spend, values.clicks), cpa: ratio(values.spend, values.conversions), roas: ratio(values.conversionValue, values.spend) };
}
export const adsLevels = ['campaign', 'adGroup', 'ad', 'keyword', 'searchTerm'] as const;
export type AdsLevel = typeof adsLevels[number];
export async function googleReport(locationId: string, id: string, period: Period, level: AdsLevel = 'campaign') {
  const account = await selectedAccount(locationId, id);
  const dates = adsDates(period, account.time_zone);
  const configurations: Record<AdsLevel, { from: string; select: string }> = {
    campaign: { from: 'campaign', select: 'campaign.id, campaign.name, campaign.status' },
    adGroup: { from: 'ad_group', select: 'campaign.id, campaign.name, ad_group.id, ad_group.name' },
    ad: { from: 'ad_group_ad', select: 'campaign.id, campaign.name, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.type' },
    keyword: { from: 'keyword_view', select: 'campaign.id, campaign.name, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type' },
    searchTerm: { from: 'search_term_view', select: 'campaign.id, campaign.name, ad_group.id, search_term_view.search_term' }
  };
  const config = configurations[level];
  const data = await queryGoogle(locationId, id, account.login_customer_id,
    `SELECT ${config.select}, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM ${config.from} WHERE segments.date BETWEEN '${dates.start}' AND '${dates.end}' ORDER BY metrics.cost_micros DESC`);
  const rows = data.rows.map(row => ({ campaignId: String(row.campaign?.id ?? ''), campaign: String(row.campaign?.name ?? ''),
    ...(row.adGroup ? { adGroupId: String(row.adGroup.id ?? ''), adGroup: String(row.adGroup.name ?? '') } : {}),
    ...(row.adGroupAd ? { adId: String(row.adGroupAd.ad?.id ?? ''), adType: String(row.adGroupAd.ad?.type ?? '') } : {}),
    ...(row.adGroupCriterion ? { keyword: String(row.adGroupCriterion.keyword?.text ?? ''), matchType: String(row.adGroupCriterion.keyword?.matchType ?? '') } : {}),
    ...(row.searchTermView ? { searchTerm: String(row.searchTermView.searchTerm ?? '') } : {}), ...adsMetrics(row.metrics) }));
  const total = rows.reduce((sum, row) => ({ impressions: sum.impressions + row.impressions, clicks: sum.clicks + row.clicks,
    costMicros: sum.costMicros + Math.round(row.spend * 1e6), conversions: sum.conversions + row.conversions, conversionsValue: sum.conversionsValue + row.conversionValue }),
    { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, conversionsValue: 0 });
  return { source: 'google-ads', sourceReference: `https://ads.google.com/aw/campaigns?ocid=${id}`, fetchedAt: new Date().toISOString(),
    account: { id, name: account.name, currency: account.currency, timeZone: account.time_zone }, period: dates, level,
    totals: adsMetrics(total), rows, truncated: data.truncated,
    limitations: [ 'Google Ads conversions use Google’s configured conversion actions and attribution windows. Today is partial.',
      ...(level === 'searchTerm' ? ['Google may withhold low-volume search terms. Search-term totals do not represent all campaign spend.'] : []),
      ...(data.truncated ? ['Results reached the configured page limit; totals are partial.'] : []) ] };
}
