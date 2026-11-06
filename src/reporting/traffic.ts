import { pool } from '../db/pool.js';
import type { TrafficEvent } from '../traffic/aggregate.js';
import type { Period } from './period.js';
import { ratio } from './period.js';

type Event = TrafficEvent & { properties?: Record<string, any>; contact_id?: string | null };
type Attribution = { source: string; medium: string; campaign: string; campaignId: string };
type Session = { attribution: Attribution; converted: boolean; contactLinked: boolean; landingPage: string; pages: string[] };
const attribution = (properties: Event['properties']): Attribution => {
  const touch = properties?.attribution?.lastNonDirect || properties || {};
  return { source: touch.utmSource || 'unattributed', medium: touch.utmMedium || 'unknown', campaign: touch.utmCampaign || '', campaignId: touch.campaignId || '' };
};
export function summarizeTraffic(events: Event[]) {
  const sessions = new Map<string, Session>();
  const current = new Map<string, { last: number; sequence: number }>();
  for (const event of events) {
    if (!['page_view', 'conversion'].includes(event.event_type) || !event.page_url) continue;
    let page: string;
    try { const url = new URL(event.page_url); page = `${url.origin}${url.pathname}`; } catch { continue; }
    const time = new Date(event.created_at).getTime();
    if (!Number.isFinite(time)) continue;
    const root = `${event.visitor_id}:${event.session_id || 'legacy'}`;
    const old = current.get(root);
    const sequence = old && time - old.last <= 1800000 ? old.sequence : (old?.sequence ?? -1) + 1;
    current.set(root, { last: time, sequence });
    const key = `${root}:${sequence}`;
    const session = sessions.get(key) || { attribution: attribution(event.properties), converted: false, contactLinked: false, landingPage: page, pages: [] };
    if (session.converted) continue;
    session.attribution = attribution(event.properties);
    session.contactLinked ||= Boolean(event.contact_id);
    session.pages.push(page);
    session.converted = event.event_type === 'conversion';
    sessions.set(key, session);
  }
  const channels = new Map<string, Attribution & { sessions: number; conversions: number; contactLinkedConversions: number }>();
  const landingPages = new Map<string, { page: string; sessions: number; conversions: number }>();
  let converted = 0, contactLinkedConversions = 0, identifiedCampaignSessions = 0;
  for (const session of sessions.values()) {
    const key = JSON.stringify(session.attribution);
    const channel = channels.get(key) || { ...session.attribution, sessions: 0, conversions: 0, contactLinkedConversions: 0 };
    channel.sessions++;
    channel.conversions += Number(session.converted);
    channel.contactLinkedConversions += Number(session.converted && session.contactLinked);
    channels.set(key, channel);
    const landing = landingPages.get(session.landingPage) || { page: session.landingPage, sessions: 0, conversions: 0 };
    landing.sessions++; landing.conversions += Number(session.converted); landingPages.set(session.landingPage, landing);
    converted += Number(session.converted);
    contactLinkedConversions += Number(session.converted && session.contactLinked);
    identifiedCampaignSessions += Number(Boolean(session.attribution.campaignId));
  }
  return { attributionModel: 'last-non-direct', sessions: sessions.size, conversions: converted, conversionRate: ratio(converted, sessions.size),
    contactLinkedConversions, contactLinkCoverage: ratio(contactLinkedConversions, converted), identifiedCampaignSessions,
    channels: [...channels.values()].sort((a, b) => b.sessions - a.sessions).map(row => ({ ...row, conversionRate: ratio(row.conversions, row.sessions) })),
    landingPages: [...landingPages.values()].sort((a, b) => b.sessions - a.sessions).map(row => ({ ...row, conversionRate: ratio(row.conversions, row.sessions) })) };
}
export async function trafficSummary(locationId: string, period: Period) {
  const result = await pool.query<Event>(`SELECT id,visitor_id,session_id,event_type,page_url,created_at,properties,contact_id FROM events
    WHERE location_id=$1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at,id`, [locationId, period.start, period.end]);
  return { ...summarizeTraffic(result.rows), period, fetchedAt: new Date().toISOString(), source: 'xaylo',
    sourceReference: `xaylo:traffic:${locationId}`, limitations: ['Browser tracking can be blocked. Conversion counts are confirmed browser events, not verified sales. Legacy events may have incomplete attribution.'] };
}
