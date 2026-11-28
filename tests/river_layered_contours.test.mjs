import test from 'node:test';
import assert from 'node:assert/strict';
import { createInheritedCollinearConflictClassifier } from '../tools/river_partitions/inherited_collinear_conflicts.mjs';

const row = { identitySegment: '0,0;0,30000000', parentIds: ['A', 'B'], featureIds: ['cell-A', 'cell-B'] };
function face(id, { lo = 0, hi = 10, x = 0, opposite = false, cuts = [] } = {}) {
  return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [[
    [x, lo], [x + (opposite ? 1 : -1), lo], [x + (opposite ? 1 : -1), hi], [x, hi],
    ...[...cuts].sort((a, b) => b - a).map(y => [x, y]), [x, lo],
  ]] } };
}
function classify(baselineFeatures, candidateFeatures, target = row) {
  const input = { baselineFeatures, candidateFeatures, baseline: { parents: [] },
    candidate: { parents: [
      { parentId: 'A', cells: [{ id: 'cell-A' }] }, { parentId: 'B', cells: [{ id: 'cell-B' }] },
    ] }, identitySegments: [target.identitySegment] };
  const before = structuredClone(input);
  const result = createInheritedCollinearConflictClassifier(input)(target);
  assert.deepEqual(input, before, 'classification must not modify original composed edges');
  return result;
}
const baseline = () => [face('A'), face('B', { hi: 6 })];
const candidate = () => [face('cell-A', { cuts: [3] }), face('cell-B', { hi: 6, cuts: [3] })];

test('unequal same-side baseline edges prove a candidate subdivision with concrete original edge evidence', () => {
  const proof = classify(baseline(), candidate());
  assert.equal(proof.classification, 'inherited-collinear-conflict-subdivision');
  assert.deepEqual(proof.inheritedOwners, [{ parentId: 'A', side: 1 }, { parentId: 'B', side: 1 }]);
});

test('identity-grid shift and incomplete collinear coverage cannot inherit a conflict', () => {
  assert.equal(classify(baseline(), [face('cell-A', { x: 1e-7, cuts: [3] }), candidate()[1]]), null);
  assert.equal(classify([face('A', { lo: .0000001 }), face('B', { hi: 6 })], candidate()), null);
  const gapGeometry = { type: 'MultiPolygon', coordinates: [
    face('B', { hi: 1 }).geometry.coordinates, face('B', { lo: 2, hi: 6 }).geometry.coordinates,
  ] };
  assert.equal(classify([face('A'), { id: 'B', geometry: gapGeometry }], candidate()), null);
  assert.equal(classify(baseline(), [candidate()[0], { id: 'cell-B', geometry: gapGeometry }]), null);
  assert.equal(classify([face('A'), { id: 'B', geometry: gapGeometry }],
    [candidate()[0], { id: 'cell-B', geometry: gapGeometry }]), null, 'even a shared gap is not continuous conflict coverage');
});

test('BigInt collinearity preserves exact nonvertical lines with large identity coordinates', () => {
  const move = features => features.map(feature => ({ ...feature, geometry: { ...feature.geometry,
    coordinates: feature.geometry.coordinates.map(ring => ring.map(([x, y]) => [130 + x + y, 40 + y])) } }));
  const target = { ...row, identitySegment: '1300000000,400000000;1330000000,430000000' };
  assert.ok(classify(move(baseline()), move(candidate()), target));
  const shifted = move(candidate());
  shifted[0].geometry.coordinates[0] = shifted[0].geometry.coordinates[0].map(([x, y]) => [x + 1e-7, y]);
  assert.equal(classify(move(baseline()), shifted, target), null);
});
