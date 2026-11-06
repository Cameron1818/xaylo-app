(() => {
  const script = document.currentScript;
  if (!script?.dataset.siteKey || window.Xaylo) return;
  const base = new URL(script.src).origin;
  const prefix = `xaylo:${script.dataset.siteKey}:`;
  const memory = new Map();
  const DAY = 86400000;
  const storage = name => { try { return window[name]; } catch { return null; } };
  const local = storage('localStorage');
  const tab = storage('sessionStorage');
  const get = (store, key) => { if (memory.has(key)) return memory.get(key); try { return JSON.parse(store?.getItem(prefix + key) || 'null'); } catch { return null; } };
  const put = (store, key, value) => { memory.set(key, value); try { store?.setItem(prefix + key, JSON.stringify(value)); } catch {} };
  const oldVisitor = get(local, 'visitor');
  const visitorId = oldVisitor?.id && oldVisitor.expires > Date.now() ? oldVisitor.id : crypto.randomUUID();
  put(local, 'visitor', { id: visitorId, expires: Date.now() + 90 * DAY });
  const cleanUrl = value => { try { const url = new URL(value); return `${url.origin}${url.pathname}`.slice(0, 1000); } catch { return ''; } };
  const fields = { utmSource: 'utm_source', utmMedium: 'utm_medium', utmCampaign: 'utm_campaign', utmTerm: 'utm_term', utmContent: 'utm_content', campaignId: 'xaylo_campaign_id', gclid: 'gclid', gbraid: 'gbraid', wbraid: 'wbraid' };
  let lastPage = '';
  function context() {
    const now = Date.now();
    const params = new URLSearchParams(location.search);
    let session = get(tab, 'session');
    if (!session?.id || now - session.last >= 30 * 60 * 1000) session = { id: crypto.randomUUID(), landingPage: cleanUrl(location.href) };
    session.last = now;
    let attribution = get(local, 'attribution');
    if (!attribution || attribution.expires <= now) attribution = {};
    const touch = Object.fromEntries(Object.entries(fields).map(([key, param]) => [key, (params.get(param) || '').slice(0, 200)]));
    if (!/^\d*$/.test(touch.campaignId)) touch.campaignId = '';
    const referrer = cleanUrl(document.referrer);
    let external = false;
    try { external = Boolean(referrer && new URL(referrer).origin !== location.origin); } catch {}
    const tagged = Object.values(touch).some(Boolean);
    if (!tagged && external) { touch.utmSource = new URL(referrer).hostname; touch.utmMedium = 'referral'; }
    if ((touch.gclid || touch.gbraid || touch.wbraid) && !touch.utmSource) touch.utmSource = 'google';
    if ((touch.gclid || touch.gbraid || touch.wbraid) && !touch.utmMedium) touch.utmMedium = 'cpc';
    const acquisition = { ...touch, landingPage: cleanUrl(location.href), referrer, capturedAt: new Date(now).toISOString() };
    if (!attribution.firstTouch) attribution.firstTouch = acquisition;
    // A document referrer stays constant on SPA navigation; only apply it on entry.
    if ((tagged && location.href !== lastPage) || (external && !lastPage)) attribution.lastNonDirect = acquisition;
    if (!session.acquisition) session.acquisition = (tagged || external) ? acquisition : { ...acquisition, utmSource: 'direct', utmMedium: 'none' };
    attribution.expires = attribution.expires || now + 90 * DAY;
    put(local, 'attribution', attribution);
    put(tab, 'session', session);
    return { session, attribution, effective: attribution.lastNonDirect || session.acquisition };
  }
  function apply(content) {
    if (!content) return;
    for (const [selector, value] of [['[data-xaylo-headline]', content.headline], ['[data-xaylo-description]', content.description], ['[data-xaylo-cta]', content.ctaText]]) {
      if (value) document.querySelectorAll(selector).forEach(node => { node.textContent = value; });
    }
    if (content.ctaUrl) document.querySelectorAll('[data-xaylo-cta-link]').forEach(node => { if (node instanceof HTMLAnchorElement) node.href = content.ctaUrl; });
  }
  let conversionInFlight;
  async function send(eventType) {
    const requestedPage = location.href;
    const { session, attribution, effective } = context();
    if (eventType === 'conversion' && session.converted) return null;
    if (eventType === 'page_view') lastPage = location.href;
    try {
      const response = await fetch(`${base}/collect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({
        siteKey: script.dataset.siteKey, contactToken: script.dataset.contactToken || '', visitorId, sessionId: session.id, eventType,
        pageUrl: cleanUrl(location.href), referrer: effective.referrer || '', ...Object.fromEntries(Object.keys(fields).map(key => [key, effective[key] || ''])),
        attribution: { firstTouch: attribution.firstTouch, sessionAcquisition: session.acquisition, lastNonDirect: attribution.lastNonDirect }
      }) });
      if (!response.ok) return null;
      const result = await response.json();
      if (eventType === 'conversion') { session.converted = true; put(tab, 'session', session); }
      window.dispatchEvent(new CustomEvent('xaylo:tracking-status', { detail: { eventType, tagSync: result.tagSync || 'not_requested' } }));
      if (eventType === 'page_view' && location.href !== requestedPage) return null;
      if (eventType === 'page_view') apply(result.journey?.content);
      window.dispatchEvent(new CustomEvent('xaylo:journey', { detail: result.journey }));
      return result.journey;
    } catch { return null; }
  }
  window.Xaylo = {
    conversion: () => conversionInFlight || (conversionInFlight = send('conversion').finally(() => { conversionInFlight = undefined; })),
    setContactToken: value => { script.dataset.contactToken = value; }, refresh: () => send('page_view')
  };
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) { const result = original.apply(this, args); if (location.href !== lastPage) void send('page_view'); return result; };
  }
  window.addEventListener('popstate', () => { if (location.href !== lastPage) void send('page_view'); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void send('page_view'); }, { once: true });
  else void send('page_view');
})();
