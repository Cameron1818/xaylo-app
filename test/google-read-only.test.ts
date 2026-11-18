import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';

// The MVP performs Google Ads read operations only; Xaylo enforces this because the OAuth scope allows writes.
test('Google Ads code calls only read endpoints', async () => {
  const directory = new URL('../src/google/', import.meta.url);
  const source = (await Promise.all((await readdir(directory)).map(file => readFile(new URL(file, directory), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /:mutate|mutateOperations|\/operations|:upload|:apply/i);
  const endpoints = [...source.matchAll(/googleads\.googleapis\.com\/[^`'"]*/g)].map(match => match[0]);
  assert.ok(endpoints.length > 0);
  for (const endpoint of endpoints) assert.match(endpoint, /(googleAds:search|customers:listAccessibleCustomers)$/, endpoint);
});
