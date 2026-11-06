import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { httpError } from '../security/access.js';
import { ghlReader, ghlLocationId } from './client.js';
import type { Period } from '../reporting/period.js';

const businessSchema = z.object({ location: z.object({ id: z.string(), name: z.string().optional(), website: z.string().optional(), timezone: z.string().optional(),
  country: z.string().optional(), business: z.object({ name: z.string().optional() }).optional() }) });
export async function businessContext(locationId: string) {
  const externalId = await ghlLocationId(locationId);
  const read = await ghlReader(locationId);
  const { location } = businessSchema.parse(await read(`/locations/${encodeURIComponent(externalId)}`));
  if (location.id !== externalId) throw httpError(502, 'HighLevel returned data for another location');
  return { source: 'ghl', sourceReference: `ghl:location:${externalId}`, fetchedAt: new Date().toISOString(),
    business: { name: location.business?.name || location.name || '', website: location.website || '', timeZone: location.timezone || '', country: location.country || '' } };
}
const contactSchema = z.object({ id: z.string(), locationId: z.string(), tags: z.array(z.string()).optional(), source: z.string().nullable().optional(),
  searchAfter: z.array(z.union([z.string(), z.number()])).optional(), customFields: z.array(z.object({ id: z.string(), value: z.unknown() })).optional() });
export async function crmSummary(locationId: string, period: Period, segmentFieldIds: string[] = []) {
  const externalId = await ghlLocationId(locationId);
  const read = await ghlReader(locationId);
  const max = getEnv().REPORT_SOURCE_MAX_PAGES;
  const warnings: string[] = [];
  const tags: Record<string, number> = Object.create(null), sources: Record<string, number> = Object.create(null);
  const segments: Record<string, { name: string; counts: Record<string, number>; options: string[] }> = Object.create(null);
  let contacts = 0, contactsComplete = true;
  if (segmentFieldIds.length) {
    try {
      const data = z.object({ customFields: z.array(z.object({ id: z.string(), name: z.string(), dataType: z.string(), picklistOptions: z.array(z.string()).optional() })) })
        .parse(await read(`/locations/${encodeURIComponent(externalId)}/customFields`));
      for (const field of data.customFields) if (segmentFieldIds.includes(field.id) && field.picklistOptions?.length) {
        segments[field.id] = { name: field.name, counts: Object.create(null), options: field.picklistOptions };
      }
    } catch { warnings.push('Custom field segmentation is unavailable. Check locations/customFields.readonly permission.'); }
  }
  let after: (string | number)[] | undefined;
  const seen = new Set<string>();
  try {
    for (let page = 0; page < max; page++) {
      const data = z.object({ contacts: z.array(contactSchema) }).parse(await read('/contacts/search', {
        locationId: externalId, pageLimit: 500, ...(after ? { searchAfter: after } : { page: 1 }),
        filters: [{ field: 'dateAdded', operator: 'range', value: { gte: period.start, lte: period.end } }], sort: [{ field: 'dateAdded', direction: 'asc' }]
      }));
      for (const contact of data.contacts) {
        if (contact.locationId !== externalId) throw httpError(502, 'HighLevel returned data for another location');
        if (seen.has(contact.id)) continue;
        seen.add(contact.id); contacts++;
        for (const tag of new Set(contact.tags || [])) tags[tag] = (tags[tag] || 0) + 1;
        const source = contact.source || 'Unspecified'; sources[source] = (sources[source] || 0) + 1;
        for (const field of contact.customFields || []) {
          const segment = segments[field.id];
          if (!segment) continue;
          for (const value of new Set(Array.isArray(field.value) ? field.value : [field.value])) {
            if (typeof value === 'string' && segment.options.includes(value)) segment.counts[value] = (segment.counts[value] || 0) + 1;
          }
        }
      }
      if (data.contacts.length < 500) break;
      const next = data.contacts.at(-1)?.searchAfter;
      if (!next?.length || JSON.stringify(next) === JSON.stringify(after)) { contactsComplete = false; break; }
      after = next;
      if (page === max - 1) contactsComplete = false;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('another location')) throw error;
    contactsComplete = false; warnings.push('Contact analysis is partial or unavailable. Check contacts.readonly permission and source status.');
  }
  const pipelines: Record<string, string> = Object.create(null);
  try {
    const data = z.object({ pipelines: z.array(z.object({ id: z.string(), name: z.string() })) }).parse(await read(`/opportunities/pipelines?locationId=${encodeURIComponent(externalId)}`));
    for (const pipeline of data.pipelines) pipelines[pipeline.id] = pipeline.name;
  } catch { warnings.push('Pipeline names are unavailable.'); }
  const opportunitySchema = z.object({ id: z.string(), locationId: z.string(), pipelineId: z.string().optional(), status: z.string(), monetaryValue: z.coerce.number().finite().optional() });
  let opportunities = 0, opportunitiesComplete = true;
  const statuses: Record<string, { count: number; monetaryValue: number }> = Object.create(null);
  const pipelineCounts: Record<string, number> = Object.create(null);
  const seenOpportunities = new Set<string>();
  const date = (value: string) => { const [y, m, d] = value.slice(0, 10).split('-'); return `${m}-${d}-${y}`; };
  try {
    for (let page = 1; page <= max; page++) {
      const query = new URLSearchParams({ locationId: externalId, date: date(period.start), endDate: date(period.end), status: 'all', limit: '100', page: String(page) });
      const data = z.object({ opportunities: z.array(opportunitySchema) }).parse(await read(`/opportunities/search?${query}`));
      let added = 0;
      for (const opportunity of data.opportunities) {
        if (opportunity.locationId !== externalId) throw httpError(502, 'HighLevel returned data for another location');
        if (seenOpportunities.has(opportunity.id)) continue;
        seenOpportunities.add(opportunity.id); opportunities++; added++;
        const status = statuses[opportunity.status] || { count: 0, monetaryValue: 0 };
        status.count++; status.monetaryValue += opportunity.monetaryValue || 0; statuses[opportunity.status] = status;
        const pipeline = opportunity.pipelineId || 'Unspecified'; pipelineCounts[pipeline] = (pipelineCounts[pipeline] || 0) + 1;
      }
      if (data.opportunities.length < 100) break;
      if (!added || page === max) { opportunitiesComplete = false; break; }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('another location')) throw error;
    opportunitiesComplete = false; warnings.push('Opportunity analysis is partial or unavailable. Check opportunities.readonly permission and source status.');
  }
  if (!contactsComplete) warnings.push('Contact totals may be incomplete; pagination is bounded.');
  if (!opportunitiesComplete) warnings.push('Opportunity totals may be incomplete; pagination is bounded.');
  const ranked = (items: Record<string, number>) => Object.entries(items).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 50);
  return { source: 'ghl', sourceReference: `ghl:location:${externalId}`, fetchedAt: new Date().toISOString(), period,
    contacts: { count: contacts, complete: contactsComplete, cohort: 'Contacts created in the reporting period', tags: ranked(tags), sources: ranked(sources),
      customFieldSegments: Object.entries(segments).map(([id, segment]) => ({ id, name: segment.name, values: ranked(segment.counts) })) },
    opportunities: { count: opportunities, complete: opportunitiesComplete, cohort: 'Current status of opportunities created in the reporting period', statuses,
      pipelines: Object.entries(pipelineCounts).map(([id, count]) => ({ id, name: pipelines[id] || id, count })), currency: null },
    limitations: ['GHL monetary values are pipeline values, not collected revenue. Currency is not verified; do not calculate CRM ROAS.',
      'CRM cohorts and date boundaries differ from Google Ads and browser conversions. No person-level attribution join is inferred.', ...warnings] };
}
