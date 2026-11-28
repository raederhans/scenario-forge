import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaintContourGraph } from '../js/core/renderer/paint_contour_graph.js';

const polygon = (id, points, corner) => ({ id, geometry: { type: 'Polygon', coordinates: [[...points, corner, points[0]]] } });
const P = [10, 10], R = [12, 10 + 2 / 3], Q = [11, 10 + 1 / 3], S = [10.5, 10 + 1 / 6];

test('a shared identity endpoint cannot bridge divergent source lines or a positive along-line gap', () => {
  const normalGap = [polygon('A', [[0, 0], [1, 0], [1, 1]], [0, 1]),
    polygon('B', [[1 + 2e-8, 0], [2, 0], [2, 1.001]], [1 + 2.2e-7, 1.001])];
  const alongGap = [polygon('A', [[0, 0], [1, 0]], [1, 1]),
    polygon('B', [[1, 1 + 2e-8], [2, 1 + 2e-8]], [1, 2])];
  for (const features of [normalGap, alongGap]) {
    const original = structuredClone(features);
    assert.equal(buildPaintContourGraph(features).diagnostics.arcCount, 0);
    assert.deepEqual(features, original);
  }
});

test('source fallback retains ambiguous owners and occupied exact intervals', () => {
  const features = [polygon('A', [P, R], [11, 13]), polygon('B', [P, R], [11.5, 14]),
    polygon('C', [P, Q, R], [10, 14]), polygon('D', [R, S, P], [10, 6])];
  const ambiguous = buildPaintContourGraph(features);
  assert.equal(ambiguous.diagnostics.ambiguousSegments, 1);
  assert.equal(ambiguous.diagnostics.arcCount, 0);
  assert.equal(ambiguous.diagnostics.sourceNodedSharedSegments, 0);
  features[1] = polygon('B', [R, P], [11, 7]);
  const occupied = buildPaintContourGraph(features);
  assert.equal(occupied.diagnostics.arcCount, 1);
  assert.equal(occupied.diagnostics.sourceNodedSharedSegments, 0);
  assert.deepEqual(Array.from(occupied.owners, index => occupied.featureIds[index]).sort(), ['A', 'B']);
});
