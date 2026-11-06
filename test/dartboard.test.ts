import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrafficDataset } from '../src/traffic/aggregate.js';
import { useTrafficData } from '../web/src/composables/useTrafficData.js';

test('live traffic can be rendered by the adapted dartboard model', () => {
  const traffic = buildTrafficDataset([
    { id: 'a', visitor_id: 'v1', session_id: 's1', event_type: 'page_view', page_url: 'https://site.example/', created_at: new Date('2026-10-03T10:00:00Z') },
    { id: 'b', visitor_id: 'v1', session_id: 's1', event_type: 'page_view', page_url: 'https://site.example/pricing', created_at: new Date('2026-10-03T10:01:00Z') },
    { id: 'c', visitor_id: 'v1', session_id: 's1', event_type: 'conversion', page_url: 'https://site.example/thanks', created_at: new Date('2026-10-03T10:02:00Z') }
  ]);
  const model = useTrafficData(traffic);
  assert.equal(model.totalSessions.value, 1);
  assert.equal(model.convertedSessions.value, 1);
  assert.equal(model.topPaths.value.length, 1);
  assert.ok(model.nodes.value.length > 0);
  assert.ok(model.roads.value.length > 0);
});
