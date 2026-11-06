import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const code = await readFile(new URL('../src/public/tracker.js', import.meta.url), 'utf8');
const store = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
function browser(url: string, local = store(), tab = store(), blocked = false, referrer = '') {
  const requests: any[] = [], listeners = new Map<string, () => void>();
  const location = new URL(url);
  const window: any = { dispatchEvent() {}, addEventListener(name: string, callback: () => void) { listeners.set(name, callback); } };
  Object.defineProperty(window, 'localStorage', { get() { if (blocked) throw Error('Blocked'); return local; } });
  Object.defineProperty(window, 'sessionStorage', { get() { if (blocked) throw Error('Blocked'); return tab; } });
  const document = { currentScript: { src: 'https://xaylo.example/assets/tracker.js', dataset: { siteKey: 'site-a' } }, readyState: 'complete', referrer, querySelectorAll: () => [] };
  const history = { pushState(_a: unknown, _b: unknown, value: string) { location.href = new URL(value, location).href; }, replaceState(_a: unknown, _b: unknown, value: string) { location.href = new URL(value, location).href; } };
  runInNewContext(code, { window, document, history, location, URL, URLSearchParams, Map, crypto: { randomUUID }, HTMLAnchorElement: class {}, CustomEvent: class {},
    fetch: async (_url: string, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return { ok: true, json: async () => ({ journey: null }) }; } });
  return { requests, window, history, location, listeners };
}
test('UTMs and click identifiers survive document navigation and conversions deduplicate', async () => {
  const local = store(), tab = store();
  const first = browser('https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_term=journey&utm_content=video&gclid=click&xaylo_campaign_id=123', local, tab);
  assert.equal(first.requests[0].utmMedium, 'cpc'); assert.equal(first.requests[0].campaignId, '123');
  const next = browser('https://example.com/pricing?email=private', local, tab, false, 'https://example.com/');
  assert.equal(next.requests[0].utmCampaign, 'spring'); assert.equal(next.requests[0].utmTerm, 'journey');
  assert.equal(next.requests[0].gclid, 'click'); assert.equal(next.requests[0].sessionId, first.requests[0].sessionId);
  assert.equal(next.requests[0].attribution.firstTouch.landingPage, 'https://example.com/');
  assert.equal(next.requests[0].pageUrl, 'https://example.com/pricing');
  await Promise.all([next.window.Xaylo.conversion(), next.window.Xaylo.conversion()]); await next.window.Xaylo.conversion();
  assert.equal(next.requests.filter(row => row.eventType === 'conversion').length, 1);
});
test('SPA navigation reads new campaign values without overwriting first touch', () => {
  const page = browser('https://example.com/?utm_source=google&utm_campaign=first');
  page.history.pushState(null, '', '/offer?utm_source=email&utm_campaign=second');
  page.history.pushState(null, '', '/thanks');
  assert.equal(page.requests.length, 3); assert.equal(page.requests[2].utmCampaign, 'second');
  assert.equal(page.requests[2].attribution.firstTouch.utmCampaign, 'first');
});
test('blocked storage still keeps a consistent visitor and session in memory', async () => {
  const page = browser('https://example.com/?utm_source=google&utm_campaign=spring', undefined, undefined, true);
  page.history.pushState(null, '', '/offer'); await page.window.Xaylo.conversion();
  assert.equal(new Set(page.requests.map(row => row.visitorId)).size, 1); assert.equal(new Set(page.requests.map(row => row.sessionId)).size, 1);
  assert.equal(page.requests[2].utmCampaign, 'spring');
});
