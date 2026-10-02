import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTopVisibleRiverCandidate } from '../js/core/river_paint/visibility.js';
import { rectangle, d3, feature } from './helpers/river_paint_fixture.mjs';

const candidate = (id, geometry, rank, interactive = true) => ({ item: {
  id, feature: { ...feature(id, geometry), properties: { id, interactive } }, rank,
}, distanceProj: 0 });
const options = { getDrawRank: entry => entry.rank, geoContains: d3.geoContains };

test('visible parent uses stable draw rank before interaction eligibility and bbox size', () => {
  const low = candidate('small-editable', rectangle(1, 1, 2, 2), 0);
  const cover = candidate('large-support', rectangle(0, 0, 3, 3), 1, false);
  const candidates = [cover, low];
  const before = structuredClone(candidates);
  const result = resolveTopVisibleRiverCandidate(candidates, [1.5, 1.5], options);
  assert.equal(result.item.id, 'large-support');
  assert.equal(result.item.feature.properties.interactive, false);
  assert.deepEqual(candidates, before);
});

test('a covering polygon hole reveals lower land and source order remains authoritative', () => {
  const lower = candidate('lower', rectangle(0, 0, 4, 4), 0);
  const holed = rectangle(0, 0, 4, 4);
  holed.coordinates.push([...rectangle(1, 1, 2, 2).coordinates[0]].reverse());
  const top = candidate('top', holed, 1);
  assert.equal(resolveTopVisibleRiverCandidate([lower, top], [1.5, 1.5], options).item.id, 'lower');
  assert.equal(resolveTopVisibleRiverCandidate([top, lower], [3, 3], options).item.id, 'top');
  assert.equal(resolveTopVisibleRiverCandidate([top, lower], [8, 8], options), null);
});
