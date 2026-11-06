import assert from 'node:assert/strict';
import test from 'node:test';
import { makePreviewTraffic } from '../src/db/preview-traffic.js';
import { buildTrafficDataset } from '../src/traffic/aggregate.js';
import { useTrafficData } from '../web/src/composables/useTrafficData.js';

test('preview traffic has 1,000 varied sessions, return visits and 60 conversions', () => {
  const events = makePreviewTraffic(new Date('2026-10-03T12:00:00.000Z'));
  const sessionIds = new Set(events.map(event => event.session_id));
  const visitorIds = new Set(events.map(event => event.visitor_id));
  assert.equal(sessionIds.size, 1000);
  assert.equal(visitorIds.size, 850);
  assert.equal(events.filter(event => event.event_type === 'conversion').length, 60);
  assert.ok(new Set(events.map(event => new URL(event.page_url).pathname)).size >= 8);
  assert.ok(new Set(events.map(event => event.properties.utmSource)).size >= 4);

  const traffic = buildTrafficDataset([...events].sort((a, b) => a.created_at.localeCompare(b.created_at)));
  assert.equal(traffic.paths.reduce((sum, path) => sum + path.sessions, 0), 1000);
  assert.equal(traffic.paths.filter(path => path.steps.includes('xaylo:conversion')).reduce((sum, path) => sum + path.sessions, 0), 60);

  const model = useTrafficData(traffic);
  assert.equal(model.topPaths.value.filter(path => path.hasLoop).reduce((sum, path) => sum + path.sessions, 0), 220);
  assert.equal(model.topPaths.value.filter(path => path.hasLoop && path.converted).reduce((sum, path) => sum + path.sessions, 0), 20);
  assert.ok(model.roads.value.filter(road => road.lanes.length === 2).length >= 5);
  const backToPricing = model.edges.value.find(edge => edge.from.endsWith('/book') && edge.to.endsWith('/pricing'));
  assert.equal(backToPricing?.weight, 70);
  assert.equal(backToPricing?.revisitTraversals, 100);
  model.showReturnTraffic.value = false;
  assert.ok(!model.edges.value.some(edge => edge.from.endsWith('/book') && edge.to.endsWith('/pricing')));
  assert.equal(model.totalSessions.value, 1000);
  model.journeyType.value = 'looping';
  assert.equal(model.visibleSessions.value, 220);
});

test('preview traffic is stable on rerun', () => {
  const first = makePreviewTraffic(new Date('2026-10-03T12:00:00.000Z'));
  const later = makePreviewTraffic(new Date('2026-10-04T12:00:00.000Z'));
  assert.deepEqual(first.map(event => event.id), later.map(event => event.id));
  assert.notEqual(first[0].created_at, later[0].created_at);
});
