import { z } from 'zod';

export const daysSchema = z.coerce.number().int().refine(value => [7, 30, 90].includes(value), 'Choose 7, 30 or 90 days').default(30);
export const reportInput = z.object({ days: daysSchema, customerId: z.string().regex(/^\d{10}$/).optional() }).strict();
export function reportPeriod(days: number, now = new Date()) {
  return { days, start: new Date(now.getTime() - days * 86400000).toISOString(), end: now.toISOString(), timeZone: 'UTC' };
}
export type Period = ReturnType<typeof reportPeriod>;
export function adsDates(period: Period, timeZone: string) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(period.end));
  const end = new Date(`${date}T12:00:00Z`);
  return { start: new Date(end.getTime() - (period.days - 1) * 86400000).toISOString().slice(0, 10), end: date, timeZone, includesPartialToday: true };
}
export function ratio(numerator: number, denominator: number) { return denominator > 0 ? numerator / denominator : null; }
