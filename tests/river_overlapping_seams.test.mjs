import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyContours } from '../tools/river_partitions/verify_contours.mjs';
import { verifyRiverPartitionFingerprints } from '../js/core/river_paint/partition_model.js';

// Complete source rings and generated cells from the real held overlap cases.
// An internal seam with another administrative owner must remain inadmissible;
// restoring its missing length would hide the existing multi-owner conflict.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/river_paint/overlapping_seams.json', import.meta.url), 'utf8'));
const heldParentIds = [
  'BY_INT_GOMEL', 'BY_INT_MOGILEV', 'RU_CITY_VOLGOGRAD',
  'RU_RAY_50074027B24471111608761', 'RU_RAY_50074027B51726500082089',
  'RU_RAY_50074027B61241799946425', 'UA_RAY_74538382B4751802602524',
];

test('held overlap snapshots preserve source geometry, fingerprints and all old records', async () => {
  assert.deepEqual(fixture.heldParentIds, heldParentIds);
  const source = new Map(fixture.sourceFeatures.map(feature => [feature.id, feature.geometry]));
  assert.equal(source.size, 11);
  for (const pack of [fixture.baseline, fixture.candidate]) {
    await verifyRiverPartitionFingerprints(pack);
    for (const entry of [...pack.parents, ...pack.support]) {
      assert.deepEqual(entry.parentGeometry, source.get(entry.parentId), entry.parentId);
    }
  }
  const candidate = new Map(fixture.candidate.parents.map(parent => [parent.parentId, parent]));
  for (const parent of fixture.baseline.parents) {
    assert.deepEqual(candidate.get(parent.parentId), parent, `old record changed: ${parent.parentId}`);
  }
  assert.deepEqual(fixture.candidate.parents.filter(parent =>
    !fixture.baseline.parents.some(old => old.parentId === parent.parentId))
    .map(parent => parent.parentId).sort(), heldParentIds);
});

test('seven held internal overlaps remain rejected with exact seam loss and new ambiguity oracles', () => {
  const before = structuredClone(fixture);
  const report = verifyContours(fixture);
  assert.equal(report.passed, false);
  assert.equal(report.scope.candidateParentCount - report.scope.baselineParentCount, 7);
  assert.deepEqual(report.neighborDifferences, [], 'external held boundary cases are outside this fixture');
  assert.deepEqual(report.baselineSeamMismatches, []);
  assert.deepEqual(report.originalParentChanges, []);
  assert.deepEqual(report.candidateSeamMismatches, fixture.expectedCandidateSeamMismatches);
  assert.deepEqual(report.originalSeamChanges, fixture.expectedOriginalSeamChanges);
  assert.deepEqual(report.addedAmbiguousSegments, fixture.expectedAddedAmbiguousSegments);
  assert.deepEqual(report.diagnosticRegressions, fixture.expectedDiagnosticRegressions);
  assert.equal(report.candidateSeamMismatches.length, 9);
  assert.equal(report.originalSeamChanges.length, 2);
  assert.equal(report.addedAmbiguousSegments.length, 22);
  assert.deepEqual(report.candidateSeamMismatches.filter(row => heldParentIds.includes(row.parentId))
    .map(row => row.parentId).sort(), heldParentIds);
  assert.ok(report.candidateSeamMismatches.every(row => row.deltaDegrees < 0));
  assert.ok(report.originalSeamChanges.every(row => row.deltaDegrees < 0));
  assert.deepEqual(fixture, before, 'acceptance must not mutate any source or candidate coordinate');
});
