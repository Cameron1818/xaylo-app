import { z } from 'zod';

const optionalMatch = z.string().trim().max(200).optional().default('');
export const journeyInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  status: z.enum(['draft', 'published']).default('draft'),
  priority: z.number().int().min(-1000).max(1000).default(0),
  rules: z.object({
    utmSource: optionalMatch,
    utmCampaign: optionalMatch,
    utmMedium: optionalMatch,
    utmTerm: optionalMatch,
    utmContent: optionalMatch,
    pathContains: optionalMatch,
    referrerContains: optionalMatch,
    requiredTag: optionalMatch
  }),
  content: z.object({
    headline: z.string().max(240),
    description: z.string().max(1000),
    ctaText: z.string().max(100),
    ctaUrl: z.string().url().max(1000).or(z.literal('')),
    agentContext: z.string().max(1000).default(''),
    emailAngle: z.string().max(1000).default('')
  }),
  addTags: z.array(z.string().trim().min(1).max(100)).max(20).default([])
});
export type JourneyInput = z.infer<typeof journeyInput>;
export type Journey = JourneyInput & { id: string; locationId: string };
export type TrackingContext = { utmSource?: string; utmCampaign?: string; utmMedium?: string; utmTerm?: string; utmContent?: string; path?: string; referrer?: string; tags?: string[] };

export function matchesJourney(rules: JourneyInput['rules'], context: TrackingContext) {
  const equal = (wanted: string, actual?: string) => !wanted || wanted.toLowerCase() === (actual ?? '').toLowerCase();
  const contains = (wanted: string, actual?: string) => !wanted || (actual ?? '').toLowerCase().includes(wanted.toLowerCase());
  return equal(rules.utmSource, context.utmSource)
    && equal(rules.utmCampaign, context.utmCampaign)
    && equal(rules.utmMedium, context.utmMedium)
    && equal(rules.utmTerm, context.utmTerm)
    && equal(rules.utmContent, context.utmContent)
    && contains(rules.pathContains, context.path)
    && contains(rules.referrerContains, context.referrer)
    && (!rules.requiredTag || (context.tags ?? []).some(tag => tag.toLowerCase() === rules.requiredTag.toLowerCase()));
}

export function selectJourney(journeys: Journey[], context: TrackingContext) {
  return journeys.filter(journey => journey.status === 'published' && matchesJourney(journey.rules, context))
    .sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug))[0] ?? null;
}
