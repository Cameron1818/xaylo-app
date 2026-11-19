import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// "Xaylo Journeys" are configured personalisation journeys; observed session paths are "routes".
test('traffic views call observed session paths routes, not journeys', async () => {
  for (const file of ['web/src/TrafficView.vue', 'web/src/components/PathList.vue', 'web/src/components/Filters.vue', 'web/src/composables/useTrafficData.js', 'web/src/composables/trafficModel.js', 'web/src/components/RouteMap.vue', 'web/src/composables/routeLayout.js', 'web/src/composables/roadLayout.js', 'web/src/components/Tooltip.vue']) {
    assert.doesNotMatch(await read(file), /journey/i, `${file} should describe traffic paths as routes`);
  }
  assert.match(await read('web/src/components/PathList.vue'), /Visitor routes/);
});
