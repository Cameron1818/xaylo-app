import { createHash } from 'node:crypto';

const paths: { pages: string[]; count: number; source: string; campaign?: string; converted?: boolean }[] = [
  { pages: ['/'], count: 200, source: 'organic' },
  { pages: ['/', '/services'], count: 120, source: 'organic' },
  { pages: ['/', '/pricing'], count: 105, source: 'google', campaign: 'brand-search' },
  { pages: ['/', '/services', '/pricing'], count: 65, source: 'google', campaign: 'spring' },
  { pages: ['/', '/pricing', '/book'], count: 65, source: 'google', campaign: 'spring' },
  { pages: ['/', '/pricing', '/reviews', '/pricing', '/book'], count: 35, source: 'facebook', campaign: 'retargeting' },
  { pages: ['/', '/pricing', '/book', '/thanks'], count: 15, source: 'google', campaign: 'brand-search', converted: true },
  { pages: ['/', '/services', '/pricing', '/book', '/thanks'], count: 15, source: 'email', campaign: 'welcome-series', converted: true },
  { pages: ['/', '/about'], count: 55, source: 'organic' },
  { pages: ['/blog', '/services'], count: 45, source: 'organic' },
  { pages: ['/campaign/website', '/pricing'], count: 45, source: 'facebook', campaign: 'spring' },
  { pages: ['/campaign/website', '/pricing', '/book'], count: 40, source: 'facebook', campaign: 'spring' },
  { pages: ['/', '/pricing', '/book', '/pricing'], count: 35, source: 'email', campaign: 'newsletter' },
  { pages: ['/campaign/website', '/pricing', '/book', '/thanks'], count: 10, source: 'facebook', campaign: 'retargeting', converted: true },
  // Comparison browsing, back-button exits and repeated booking hesitation.
  { pages: ['/', '/services', '/'], count: 40, source: 'organic' },
  { pages: ['/', '/services', '/pricing', '/services', '/pricing', '/book'], count: 35, source: 'google', campaign: 'spring' },
  { pages: ['/', '/pricing', '/book', '/pricing', '/book', '/pricing'], count: 30, source: 'facebook', campaign: 'retargeting' },
  { pages: ['/blog', '/services', '/blog'], count: 25, source: 'organic' },
  { pages: ['/', '/pricing', '/reviews', '/pricing', '/book', '/thanks'], count: 10, source: 'google', campaign: 'brand-search', converted: true },
  { pages: ['/', '/services', '/pricing', '/services', '/pricing', '/book', '/thanks'], count: 5, source: 'email', campaign: 'welcome-series', converted: true },
  { pages: ['/campaign/website', '/pricing', '/book', '/pricing', '/book', '/thanks'], count: 5, source: 'facebook', campaign: 'retargeting', converted: true }
];

export type PreviewEvent = {
  id: string;
  visitor_id: string;
  session_id: string;
  event_type: 'page_view' | 'conversion';
  page_url: string;
  properties: { previewSeed: string; utmSource: string; utmCampaign?: string };
  created_at: string;
};

function stableUuid(value: string) {
  const hash = createHash('sha256').update(`xaylo-preview-traffic-v1:${value}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function makePreviewTraffic(now = new Date()): PreviewEvent[] {
  const events: PreviewEvent[] = [];
  let sessionIndex = 0;
  for (const path of paths) {
    for (let occurrence = 0; occurrence < path.count; occurrence++) {
      const sessionId = stableUuid(`session:${sessionIndex}`);
      // Returning visitors keep their visitor ID but receive a new session ID.
      const visitorId = stableUuid(`visitor:${sessionIndex % 850}`);
      const minutesAgo = 60 + ((sessionIndex * 1789) % (27 * 24 * 60));
      const sessionStart = now.getTime() - minutesAgo * 60_000;
      path.pages.forEach((page, step) => {
        events.push({
          id: stableUuid(`event:${sessionIndex}:${step}`),
          visitor_id: visitorId,
          session_id: sessionId,
          event_type: path.converted && step === path.pages.length - 1 ? 'conversion' : 'page_view',
          page_url: `https://demo.xaylo.com${page}`,
          properties: {
            previewSeed: 'traffic-v1',
            utmSource: path.source,
            ...(path.campaign ? { utmCampaign: path.campaign } : {})
          },
          created_at: new Date(sessionStart + step * (2 + (sessionIndex % 4)) * 60_000).toISOString()
        });
      });
      sessionIndex++;
    }
  }
  if (sessionIndex !== 1000) throw new Error(`Expected 1,000 preview sessions, got ${sessionIndex}`);
  return events;
}
