import { z } from 'zod';

const value = z.string().max(200).optional();
export const attributionFields = {
  utmSource: value, utmMedium: value, utmCampaign: value, utmTerm: value, utmContent: value,
  campaignId: z.string().regex(/^\d*$/).max(30).optional(), gclid: value, gbraid: value, wbraid: value
};
const touch = z.object({ ...attributionFields, landingPage: z.string().max(1000).optional(), referrer: z.string().max(1000).optional(), capturedAt: z.string().datetime().optional() });
export const attributionSchema = z.object({ firstTouch: touch.optional(), sessionAcquisition: touch.optional(), lastNonDirect: touch.optional() });
export function safeUrl(value?: string) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? `${url.origin}${url.pathname}`.slice(0, 1000) : ''; }
  catch { return ''; }
}
export function eventProperties(input: Record<string, unknown>) {
  const values = z.object(attributionFields).parse(input);
  const attribution = attributionSchema.parse(input.attribution ?? {});
  for (const item of Object.values(attribution)) {
    if (item) { item.landingPage = safeUrl(item.landingPage); item.referrer = safeUrl(item.referrer); }
  }
  return { ...values, attribution, referrer: safeUrl(input.referrer as string), deduplicate: true };
}
