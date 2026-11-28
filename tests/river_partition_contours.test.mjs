import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyContours } from '../tools/river_partitions/verify_contours.mjs';

const rectangle = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates:
  [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] });
const parent = (id, x0, y0, x1, y1) => ({ parentId: id, parentGeometry: rectangle(x0, y0, x1, y1),
  cells: [rectangle(x0, y0, x1, (y0 + y1) / 2), rectangle(x0, (y0 + y1) / 2, x1, y1)]
    .map((geometry, i) => ({ id: `river:${id}:${i}`, geometry })) });
function fixture() {
  const p = parent('P', 0, 0, 2, 2);
  const q = parent('Q', 2, 0, 4, 2);
  const baseline = { parents: [p], support: [] }, candidate = { parents: [structuredClone(p), q], support: [] };
  return { sourceFeatures: [p, q].map(p => ({ type: 'Feature', id: p.parentId, geometry: p.parentGeometry })),
    baseline, candidate, baselineSeams: { P: 2 }, candidateSeams: { P: 2, Q: 2 } };
}

test('complete composition collapses child owners and preserves existing neighbor lengths', () => {
  const report = verifyContours(fixture());
  assert.equal(report.passed, true);
  assert.equal(report.scope.comparedNeighborPairs, 1);
  assert.equal(report.scope.beforeComposedCount, 3);
  assert.equal(report.scope.afterComposedCount, 4);
});

test('missing internal seam fails with precise parent and expected/actual lengths', () => {
  const input = fixture();
  input.candidate.parents[1].cells[1].geometry = rectangle(2, 1.1, 4, 2);
  const report = verifyContours(input);
  assert.equal(report.passed, false);
  assert.deepEqual(report.candidateSeamMismatches, [{ parentId: 'Q', expectedLengthDegrees: 2, actualLengthDegrees: 0, deltaDegrees: -2 }]);
});

test('existing ambiguity is compared to baseline; a new ambiguity fails', () => {
  const input = fixture();
  input.sourceFeatures.push({ id: 'overlap', geometry: rectangle(10, 0, 11, 1) }, { id: 'overlap2', geometry: rectangle(10, 0, 11, 1) });
  const unchanged = verifyContours(input);
  assert.equal(unchanged.passed, true);
  assert.equal(unchanged.beforeDiagnostics.ambiguousSegments, 4);
  input.candidate.support = [{ parentId: 'overlap', parentGeometry: rectangle(10, 0, 11, 1), geometry: rectangle(2, 0, 4, 1) }];
  // Move both overlapping sources to a new shared-boundary region.
  input.candidate.support.push({ parentId: 'overlap2', parentGeometry: rectangle(10, 0, 11, 1), geometry: rectangle(2, 0, 4, 1) });
  const report = verifyContours(input);
  assert.equal(report.passed, false);
  assert.equal(report.beforeDiagnostics.ambiguousSegments, report.afterDiagnostics.ambiguousSegments);
  assert.ok(report.addedAmbiguousSegments.length > 0, 'unchanged total cannot hide a newly located conflict');
  assert.ok(report.addedAmbiguousSegments.some(row => row.parentIds.includes('Q')));
});
