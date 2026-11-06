import assert from 'node:assert/strict';
import test from 'node:test';
import { selectJourney, type Journey } from '../src/journeys/model.js';

function journey(slug: string, priority: number, rules: Journey['rules'], status: Journey['status'] = 'published'): Journey {
  return { id: slug, locationId: 'loc', name: slug, slug, priority, status, rules,
    content: { headline: '', description: '', ctaText: '', ctaUrl: '', agentContext: '', emailAngle: '' }, addTags: [] };
}
const emptyRules = { utmSource: '', utmCampaign: '', pathContains: '', referrerContains: '', requiredTag: '' };

test('published high-priority campaign journey wins over generic and draft journeys', () => {
  const journeys = [journey('generic', 0, emptyRules), journey('campaign', 10, { ...emptyRules, utmCampaign: 'Spring' }), journey('draft', 100, emptyRules, 'draft')];
  assert.equal(selectJourney(journeys, { utmCampaign: 'spring' })?.slug, 'campaign');
  assert.equal(selectJourney(journeys, { utmCampaign: 'other' })?.slug, 'generic');
});

test('required tag and path must both match', () => {
  const journeys = [journey('tagged', 1, { ...emptyRules, requiredTag: 'xaylo:buyer', pathContains: '/pricing' })];
  assert.equal(selectJourney(journeys, { tags: ['xaylo:buyer'], path: '/pricing/team' })?.slug, 'tagged');
  assert.equal(selectJourney(journeys, { tags: [], path: '/pricing/team' }), null);
});
