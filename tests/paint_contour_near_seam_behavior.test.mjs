import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaintContourGraph as buildGraph } from '../js/core/renderer/paint_contour_graph.js';
import { packContourWaterMask, createContourWaterQuery } from '../js/core/renderer/paint_contour_water_mask.js';
import { createBorderClassification } from '../js/core/renderer/border_classification.js';

// Scenario runtime enables near seams at 0.05°; the builder default stays exact.
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
test('offset seam covers the entire reference axis once and reclassifies after ownership edits', () => {
  const graph = buildPaintContourGraph([rect('A',0,0,1,2), rect('B',1.0255,0,2,2)], { waterMask: land });
  coverage(graph, 'A:B', 0, 2);
  const owners = { A: 'RED', B: 'BLUE' };
  const view = createBorderClassification(graph, id => ({ borderKey: owners[id] }));
  assert.equal(view.getMeshes().country.length, 1);
  owners.B = 'RED'; view.refresh(['B']);
  assert.equal(view.getMeshes().country.length, 0);
  assert.equal(view.getMeshes().local.size, 1);
});
test('overlapping faces are accepted even with a water-only midpoint mask', () => {
  const water = packContourWaterMask({ water: rect('water', -10,-10,10,10) });
  coverage(buildPaintContourGraph([rect('A',0,0,1,2),rect('B',0.97,0,2,2)], { waterMask: water }), 'A:B', 0, 2);
});
test('unequal splitting density and long segments retain full coverage', () => {
  const b = rect('B',1.03,0,2,8);
  b.geometry.coordinates[0].splice(4, 0, ...Array.from({ length: 79 }, (_, i) => [1.03, 7.9-i/10]));
  coverage(buildPaintContourGraph([rect('A',0,0,1,8),b], { waterMask: land }), 'A:B', 0, 8);
});
test('three-country junction splits pairs without a gap or duplicate output', () => {
  const graph = buildPaintContourGraph([rect('A',0,0,1,2),rect('B',1.02,0,2,1),rect('C',1.02,1,2,2)], { waterMask: land });
  coverage(graph, 'A:B', 0, 1); coverage(graph, 'A:C', 1, 2); coverage(graph, 'B:C', 1.02, 2, 0);
});
test('a feature never pairs its own nearby polygon components', () => {
  const a = rect('A',0,0,1,1), b = rect('B',1.02,0,2,1);
  const graph = buildPaintContourGraph([{ id: 'A', geometry: { type: 'MultiPolygon', coordinates: [a.geometry.coordinates,b.geometry.coordinates] } }], { waterMask: land });
  assert.equal(graph.owners.length, 0);
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
test('missing masks allow only overlaps or distances at most 0.01 degrees', () => {
  const a = rect('A',0,0,1,2);
  const close = buildPaintContourGraph([a,rect('B',1.009,0,2,2)]);
  coverage(close, 'A:B', 0, 2); assert.equal(close.diagnostics.nearSeamMaskMissing, true);
  assert.equal(buildPaintContourGraph([a,rect('B',1.011,0,2,2)]).owners.length, 0);
  coverage(buildPaintContourGraph([a,rect('B',0.97,0,2,2)]), 'A:B', 0, 2);
});
test('configured tolerance and disabling near seams are observed', () => {
  const features = [rect('A',0,0,1,2),rect('B',1.03,0,2,2)];
  assert.equal(buildPaintContourGraph(features, { waterMask: land, nearSeamTolerance: 0.02 }).owners.length, 0);
  assert.equal(buildPaintContourGraph(features, { waterMask: land, nearSeamTolerance: 0 }).owners.length, 0);
  coverage(buildPaintContourGraph([rect('A',0,0,1,2),rect('B',1.05,0,2,2)], { waterMask: land }), 'A:B', 0, 2);
  coverage(buildPaintContourGraph([rect('A',0,0,1,2),rect('B',1.01,0,2,2)]), 'A:B', 0, 2);
});
test('a partially quantized join preserves the rest of a long edge for near pairing', () => {
  const a={...rect('A',0,0,1,2),coordinatePrecision:4};
  const graph=buildPaintContourGraph([a,rect('B',1.00002,0,2,1),rect('C',1.025,1,2,2)],{waterMask:land});
  coverage(graph,'A:B',0,1);coverage(graph,'A:C',1,2);
});
test('the distance threshold cuts a sloping seam without losing its final valid sample interval', () => {
  const b=rect('B',1.04,0,2,2);b.geometry.coordinates[0][3][0]=1.06;
  const graph=buildPaintContourGraph([rect('A',0,0,1,2),b],{waterMask:land});
  coverage(graph,'A:B',0,(.05*Math.sqrt(1+.01**2)-.04)/.01);
});
test('near seam joins an existing exact shared arc at its endpoint', () => {
  const b = rect('B',1,0,2,2);
  b.geometry.coordinates[0] = [[1,0],[2,0],[2,2],[1.025,2],[1,1],[1,0]];
  const graph = buildPaintContourGraph([rect('A',0,0,1,2),b], { waterMask: land });
  coverage(graph, 'A:B', 0, 2);
  assert.equal(graph.diagnostics.arcCount, 1);
});
test('water exclusions and visible added land are combined without mutating source coordinates', () => {
  const source = rect('land',0,0,1,1), before = JSON.stringify(source);
  const query = createContourWaterQuery(packContourWaterMask({ land: source,
    addedLand: rect('added',1,0,2,1), water: rect('lake',1.4,0.4,1.6,0.6) }));
  assert.equal(query(1.2,0.5), true); assert.equal(query(1.5,0.5), false); assert.equal(query(3,0.5), false);
  assert.equal(JSON.stringify(source), before);
});
