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

test('an internal third owner blocks source intervals without shared endpoints', () => {
  const U = [10.7, 10 + 0.7 / 3], V = [11.3, 10 + 1.3 / 3];
  const graph = buildPaintContourGraph([polygon('A', [P, Q, R], [10, 14]),
    polygon('B', [R, S, P], [10, 6]), polygon('C', [U, V], [11, 14])]);
  assert.equal(graph.diagnostics.arcCount, 2);
  for (let arc = 0; arc < graph.offsets.length - 1; arc += 1) {
    assert.deepEqual([graph.featureIds[graph.owners[arc * 2]], graph.featureIds[graph.owners[arc * 2 + 1]]].sort(), ['A', 'B']);
    for (let point = graph.offsets[arc]; point < graph.offsets[arc + 1] - 1; point += 1) {
      const x0 = graph.coordinates[point * 2], x1 = graph.coordinates[point * 2 + 2];
      assert.equal(Math.min(x0, x1) < V[0] - 1e-10 && Math.max(x0, x1) > U[0] + 1e-10, false);
    }
  }
});

test('long collinear source chains stop at the comparison budget', () => {
  const count = 5000, point = t => [10 + t, 10 + t / 3];
  const left = Array.from({ length: count + 1 }, (_, i) => point(i / count));
  const right = [point(0), ...Array.from({ length: count }, (_, i) => point((i + 0.5) / count)), point(1)].reverse();
  const graph = buildPaintContourGraph([polygon('A', left, [10.4, 12]), polygon('B', right, [10.6, 8])]);
  assert.ok(graph.diagnostics.sourceLineSkippedGroups >= 1);
  assert.equal(graph.diagnostics.sourceNodedSharedSegments, 0);
  assert.ok(graph.diagnostics.sourceLineComparisons <= count * 4 + 4096);
});
