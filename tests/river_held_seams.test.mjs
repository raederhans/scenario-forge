import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyContours, composeContourFeatures, contourLengths } from '../tools/river_partitions/verify_contours.mjs';
import { buildPaintContourGraph } from '../js/core/renderer/paint_contour_graph.js';

// Exact snapshots, not repaired polygons: the source has nearly coincident
// boundary edges with unequal segmentation. A common river intersection can
// turn previously unmatched integer-grid subsegments into a new shared edge.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/river_paint/held_seams.json', import.meta.url), 'utf8'));

test('source-line noding preserves real held adjacency before and after river cuts', () => {
  const before = structuredClone(fixture);
  const report = verifyContours(fixture);
  assert.equal(report.passed, true);
  assert.equal(report.scope.candidateParentCount - report.scope.baselineParentCount, 6);
  assert.deepEqual(report.neighborDifferences, []);
  const graph = buildPaintContourGraph(composeContourFeatures(fixture.sourceFeatures, fixture.baseline));
  const lengths = contourLengths(graph, fixture.baseline).neighbors;
  for (const row of fixture.sourceEdgeDiagnostics) {
    const key = JSON.stringify([...row.parents].sort());
    const original = fixture.expectedNeighborDifferences.find(item => JSON.stringify([...item.parentIds].sort()) === key);
    // Each source pair shares an endpoint. Its previously missed intersection
    // is exactly the shorter of the two original straight source edges.
    const overlap = Math.min(...row.sourceEdges.map(({ coordinates: [a, b] }) => Math.hypot(b[0] - a[0], b[1] - a[1])));
    assert.ok(Math.abs(lengths.get(key) - original.beforeLengthDegrees - overlap) < 1e-12, key);
  }
  for (const key of ['baselineSeamMismatches', 'candidateSeamMismatches', 'originalParentChanges',
    'originalSeamChanges', 'diagnosticRegressions', 'addedAmbiguousSegments']) {
    assert.deepEqual(report[key], [], key);
  }
  assert.deepEqual(fixture, before, 'acceptance must not mutate source or candidate coordinates');
});
