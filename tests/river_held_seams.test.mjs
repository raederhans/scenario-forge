import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyContours } from '../tools/river_partitions/verify_contours.mjs';

// Exact snapshots, not repaired polygons: the source has nearly coincident
// boundary edges with unequal segmentation. A common river intersection can
// turn previously unmatched integer-grid subsegments into a new shared edge.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/river_paint/held_seams.json', import.meta.url), 'utf8'));
function identityLine([a, b]) {
  const snap = p => p.map(n => Math.round(n * 1e7));
  const [x, y] = snap(a), [u, v] = snap(b);
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const divisor = gcd(Math.abs(u - x), Math.abs(v - y));
  let dx = (u - x) / divisor, dy = (v - y) / divisor;
  if (dx < 0 || (dx === 0 && dy < 0)) [dx, dy] = [-dx, -dy];
  return [dx, dy, Number(BigInt(dx) * BigInt(y) - BigInt(dy) * BigInt(x))];
}

test('real held parents fail adjacency admission despite unchanged old cells and correct internal seams', () => {
  const before = structuredClone(fixture);
  const report = verifyContours(fixture);
  assert.equal(report.passed, false);
  assert.equal(report.scope.candidateParentCount - report.scope.baselineParentCount, 5);
  assert.deepEqual(report.neighborDifferences.map(row => row.parentIds),
    fixture.expectedNeighborDifferences.map(row => row.parentIds));
  for (let i = 0; i < report.neighborDifferences.length; i++) {
    const actual = report.neighborDifferences[i], expected = fixture.expectedNeighborDifferences[i];
    for (const key of ['beforeLengthDegrees', 'afterLengthDegrees', 'deltaDegrees']) {
      assert.ok(Math.abs(actual[key] - expected[key]) < 1e-12, `${actual.parentIds}: ${key}`);
    }
  }
  for (const key of ['baselineSeamMismatches', 'candidateSeamMismatches', 'originalParentChanges',
    'originalSeamChanges', 'diagnosticRegressions', 'addedAmbiguousSegments']) {
    assert.deepEqual(report[key], [], key);
  }
  assert.deepEqual(fixture, before, 'acceptance must not mutate source or candidate coordinates');
});

test('each extra edge comes from source boundary lines that differ on the runtime identity grid', () => {
  assert.equal(fixture.sourceEdgeDiagnostics.length, 3);
  for (const row of fixture.sourceEdgeDiagnostics) {
    const [left, right] = row.sourceEdges;
    const actual = identityLine(row.coords), a = identityLine(left.coordinates), b = identityLine(right.coordinates);
    assert.deepEqual(actual, row.runtimeIdentityLine);
    assert.deepEqual(a, left.runtimeIdentityLine);
    assert.deepEqual(b, right.runtimeIdentityLine);
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(actual, a);
    assert.notDeepEqual(actual, b);
  }
});
