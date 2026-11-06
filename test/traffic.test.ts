import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrafficDataset, type TrafficEvent } from '../src/traffic/aggregate.js';

const at = (id: string, visitor: string, minute: number, path: string, type = 'page_view', session: string | null = 'session-a'): TrafficEvent => ({
  id, visitor_id: visitor, session_id: session, event_type: type, page_url: `https://shop.example${path}?email=hidden`,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, minute))
});

test('groups paths by session, preserves revisits, and appends one conversion goal', () => {
  const data = buildTrafficDataset([
    at('1', 'v1', 0, '/'), at('2', 'v1', 2, '/pricing'), at('3', 'v1', 3, '/'),
    at('4', 'v1', 4, '/booked', 'conversion'), at('5', 'v1', 5, '/after'),
    at('6', 'v2', 0, '/'), at('7', 'v2', 2, '/pricing')
  ]);
  assert.equal(data.paths.length, 2);
  assert.deepEqual(data.paths.find(p => p.steps.includes('xaylo:conversion'))?.steps,
    ['https://shop.example/', 'https://shop.example/pricing', 'https://shop.example/', 'https://shop.example/booked', 'xaylo:conversion']);
  assert.equal(data.pages.some(p => p.id.includes('email=')), false);
});

test('starts a new session after inactivity, including legacy events', () => {
  const data = buildTrafficDataset([at('1', 'v', 0, '/', 'page_view', null), at('2', 'v', 31, '/pricing', 'page_view', null)]);
  assert.equal(data.paths.length, 2);
  assert.equal(data.paths.reduce((total, path) => total + path.sessions, 0), 2);
});

test('empty data returns only the conversion goal', () => {
  const data = buildTrafficDataset([]);
  assert.deepEqual(data.paths, []);
  assert.equal(data.pages[0]?.id, 'xaylo:conversion');
});
