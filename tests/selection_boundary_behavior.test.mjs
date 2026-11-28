import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaintContourGraph } from '../js/core/renderer/paint_contour_graph.js';
import { createSelectionBoundaryIndex } from '../js/core/renderer/selection_boundary.js';

const ring = (x, y, size = 1) => [[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const polygon = (id, ...coordinates) => ({ id, geometry: { type: 'Polygon', coordinates } });
function segments(geometry) {
  return new Set((geometry?.coordinates || []).flatMap(line => line.slice(1).map((point, i) =>
    [JSON.stringify(line[i]), JSON.stringify(point)].sort().join('|'))));
}
const edge = (a, b) => [JSON.stringify(a), JSON.stringify(b)].sort().join('|');
const features = [polygon('a', ring(0,0)), polygon('b', ring(1,0)), polygon('island', ring(5,0))];

test('overlapping unselected parcels do not remove the selected parcel perimeter', () => {
  const a = polygon('a', ring(0, 0, 2));
  const b = polygon('b', [[1,-1],[3,-1],[3,3],[1,3],[1,-1]]);
  const index = createSelectionBoundaryIndex(buildPaintContourGraph([a, b]));
  for (const feature of [a, b]) {
    assert.deepEqual(segments(index.getBoundaryLines(new Set([feature.id]))),
      segments({ coordinates: feature.geometry.coordinates }));
  }
  const both = segments(index.getBoundaryLines(new Set(['a', 'b'])));
  assert.equal(both.has(edge([2,0], [2,2])), false);
  assert.equal(both.has(edge([1,-1], [1,3])), false);
  assert.equal(both.has(edge([0,0], [0,2])), true);
  assert.equal(both.has(edge([3,-1], [3,3])), true);
});

test('selection retains outer and island coasts and removes shared interior arcs', () => {
  const graph = buildPaintContourGraph(features);
  const index = createSelectionBoundaryIndex(graph);
  const both = index.getBoundaryLines(new Set(['a', 'b', 'island']));
  const lines = segments(both);
  assert.equal(both.type, 'MultiLineString');
  assert.equal(lines.size, 10);
  assert.equal(lines.has(edge([1,0],[1,1])), false);
  assert.equal(lines.has(edge([0,0],[1,0])), true);
  assert.equal(lines.has(edge([5,0],[6,0])), true);
  assert.equal(segments(index.getBoundaryLines(new Set(['a']))).has(edge([1,0],[1,1])), true);
  assert.equal(index.getBoundaryLines(new Set()), null);
});
