import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrafficDataset } from '../src/traffic/aggregate.js';
import { useTrafficData } from '../web/src/composables/useTrafficData.js';

test('live traffic can be rendered by the journey map model', () => {
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
  assert.ok(model.nodes.value.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.ok(model.nodes.value.every(node => node.x < model.goalPosition.value.x));
  assert.ok(model.edges.value.every(edge => !/NaN|Infinity/.test(edge.d)));
});

test('journey positions stay fixed when filtering and return routes remain drawable', () => {
  const traffic = { defaultGoal: 'goal', pages: [{ id: 'home', label: 'Home', isEntry: true }, { id: 'services', label: 'Services' }, { id: 'pricing', label: 'Pricing' }, { id: 'about', label: 'About' }, { id: 'goal', label: 'Conversion', isConversion: true }],
    paths: [{ steps: ['home', 'services', 'pricing', 'services', 'pricing', 'goal'], sessions: 20 }, { steps: ['home', 'about'], sessions: 5 }] };
  const model = useTrafficData(traffic);
  const original = new Map(model.nodes.value.map(node => [node.id, { x: node.x, y: node.y }]));
  assert.ok(model.edges.value.some(edge => edge.revisitTraversals > 0));
  assert.ok(model.roads.value.some(road => road.lanes.length === 2));
  model.journeyType.value = 'converted';
  for (const node of model.nodes.value) assert.deepEqual({ x: node.x, y: node.y }, original.get(node.id));
  assert.equal(model.totalSessions.value, 25);
  assert.equal(model.visibleSessions.value, 20);
  model.showReturnTraffic.value = false;
  assert.ok(model.edges.value.every(edge => edge.revisitTraversals === 0));
  assert.ok(model.edges.value.every(edge => !/NaN|Infinity/.test(edge.d)));
});

test('journey map handles self-loops and journeys without a conversion', () => {
  const model = useTrafficData({ defaultGoal: 'goal', pages: [{ id: 'home', label: 'Home', isEntry: true }, { id: 'about', label: 'About' }, { id: 'goal', label: 'Conversion', isConversion: true }],
    paths: [{ steps: ['home', 'home', 'about'], sessions: 3 }] });
  assert.equal(model.convertedSessions.value, 0);
  assert.ok(model.edges.value.some(edge => edge.from === edge.to));
  assert.ok(model.edges.value.every(edge => !/NaN|Infinity/.test(edge.d)));
  assert.ok(model.nodes.value.every(node => node.y > 0 && node.y < model.mapHeight.value - 45));
});
