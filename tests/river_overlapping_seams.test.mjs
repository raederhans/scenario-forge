import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyContours } from '../tools/river_partitions/verify_contours.mjs';

// Complete source rings and generated cells from the real held overlap cases.
// An internal seam with another administrative owner must remain inadmissible;
// restoring its missing length would hide the existing multi-owner conflict.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/river_paint/overlapping_seams.json', import.meta.url), 'utf8'));
const heldParentIds = [
  'BY_INT_GOMEL', 'BY_INT_MOGILEV', 'RU_CITY_VOLGOGRAD',
  'RU_RAY_50074027B24471111608761', 'RU_RAY_50074027B51726500082089',
  'RU_RAY_50074027B61241799946425', 'UA_RAY_74538382B4751802602524',
];

test('seven held internal overlaps remain rejected with exact seam loss and new ambiguity oracles', () => {
  const report = verifyContours(fixture);
  assert.equal(report.passed, false);

  assert.deepEqual(report.candidateSeamMismatches.filter(row => heldParentIds.includes(row.parentId))
    .map(row => row.parentId).sort(), heldParentIds);
  assert.ok(report.candidateSeamMismatches.every(row => row.deltaDegrees < 0));
  assert.ok(report.originalSeamChanges.every(row => row.deltaDegrees < 0));
});
