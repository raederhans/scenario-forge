import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaintContourGraph as buildGraph } from '../js/core/renderer/paint_contour_graph.js';
import { packContourWaterMask } from '../js/core/renderer/paint_contour_water_mask.js';

const buildPaintContourGraph = (features, options = {}) => buildGraph(features, { nearSeamTolerance: 0.05, ...options });
const rect = (id, x0, y0, x1, y1) => ({ id, type: 'Feature', geometry: { type: 'Polygon',
  coordinates: [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]] } });
const land = packContourWaterMask({ land: rect('land', -10, -10, 10, 10) });
function intervals(graph, pair, axis = 1) {
  const result = [];
  for (let arc = 0; arc < graph.owners.length / 2; arc++) {
    const ids = [graph.featureIds[graph.owners[arc * 2]], graph.featureIds[graph.owners[arc * 2 + 1]]].sort().join(':');
    if (ids !== pair) continue;
    for (let p = graph.offsets[arc]; p < graph.offsets[arc + 1] - 1; p++) {
      const a = graph.coordinates[p * 2 + axis], b = graph.coordinates[p * 2 + 2 + axis];
      result.push([Math.min(a, b), Math.max(a, b)]);
    }
  }
  return result.sort((a, b) => a[0] - b[0]);
}
function coverage(graph, pair, start, end, axis = 1) {
  const spans = intervals(graph, pair, axis);
  let cursor = start, covered = 0, maxGap = 0, sum = 0;
  for (const [a, b] of spans) {
    maxGap = Math.max(maxGap, a - cursor);
    covered += Math.max(0, b - Math.max(a, cursor)); sum += b - a;
    cursor = Math.max(cursor, b);
  }
  maxGap = Math.max(maxGap, end - cursor);
  assert.ok(Math.abs(covered - (end - start)) < 1e-7, `covered ${covered}, expected ${end-start}`);
  assert.ok(maxGap < 1e-7, `gap ${maxGap}`);
  assert.ok(Math.abs(sum - covered) < 1e-7, `duplicate length ${sum-covered}`);
}
test('offset seam covers the entire reference axis once', () => {
  const graph = buildPaintContourGraph([rect('A',0,0,1,2), rect('B',1.0255,0,2,2)], { waterMask: land });
  coverage(graph, 'A:B', 0, 2);
});
test('straits and lake holes reject candidates, including distances below the no-mask threshold', () => {
  const a = rect('A',0,0,1,2), b = rect('B',1.005,0,2,2);
  const mask = packContourWaterMask({ land: [a,b] });
  const graph = buildPaintContourGraph([a,b], { waterMask: mask });
  assert.equal(graph.owners.length, 0); assert.ok(graph.diagnostics.nearSeamRejectedWater > 0);
  const holed = rect('land',-2,-2,3,3);
  holed.geometry.coordinates.push(rect('hole',0.99,-0.1,1.02,2.1).geometry.coordinates[0]);
  assert.equal(buildPaintContourGraph([a,b], { waterMask: packContourWaterMask({ land: holed }) }).owners.length, 0);
});
test('edges outside the configured tolerance remain separate', () => {
  const features = [rect('A',0,0,1,2),rect('B',1.03,0,2,2)];
  assert.equal(buildPaintContourGraph(features, { waterMask: land, nearSeamTolerance: 0.02 }).owners.length, 0);
});
