import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyContours, main } from '../tools/river_partitions/verify_contours.mjs';
import { makeFixture } from './helpers/river_paint_fixture.mjs';

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

test('union comparison catches a newly introduced neighbor pair, including zero prior length', () => {
  const input = fixture();
  input.sourceFeatures.push({ id: 'N', geometry: rectangle(5, 0, 6, 2) });
  input.candidate.support.push({ parentId: 'N', parentGeometry: rectangle(5, 0, 6, 2), geometry: rectangle(4, 0, 6, 2) });
  const report = verifyContours(input);
  assert.equal(report.passed, false);
  assert.deepEqual(report.neighborDifferences, [{ parentIds: ['N', 'Q'], beforeLengthDegrees: 0, afterLengthDegrees: 2, deltaDegrees: 2 }]);
});

test('comparison catches disappearance and partial shortening of prior adjacency', () => {
  for (const [geometry, length] of [[rectangle(2.1, 0, 4, 2), 0], [rectangle(2, 0, 4, 1), 1]]) {
    const input = fixture();
    input.candidate.parents = [input.candidate.parents[0]];
    input.candidateSeams = { P: 2 };
    input.candidate.support = [{ parentId: 'Q', parentGeometry: rectangle(2, 0, 4, 2), geometry }];
    const report = verifyContours(input);
    assert.equal(report.passed, false);
    assert.equal(report.neighborDifferences[0].deltaDegrees, length - 2);
  }
});

test('longer adjacency fails even when an old boundary has not been lost', () => {
  const input = fixture();
  input.candidate.parents[1].cells[1].geometry = rectangle(2, 1, 4, 3);
  input.candidate.parents[0].cells[1].geometry = rectangle(0, 1, 2, 3);
  assert.equal(verifyContours(input).neighborDifferences[0].deltaDegrees, 1);
});

test('missing internal seam fails with precise parent and expected/actual lengths', () => {
  const input = fixture();
  input.candidate.parents[1].cells[1].geometry = rectangle(2, 1.1, 4, 2);
  const report = verifyContours(input);
  assert.equal(report.passed, false);
  assert.deepEqual(report.candidateSeamMismatches, [{ parentId: 'Q', expectedLengthDegrees: 2, actualLengthDegrees: 0, deltaDegrees: -2 }]);
});

test('historical parent record and seam stability are explicit gates', () => {
  const input = fixture();
  input.candidate.parents[0].cells[0].id = 'river:P:changed';
  assert.deepEqual(verifyContours(input).originalParentChanges, [{ parentId: 'P', reason: 'parent record changed' }]);
  input.candidate.parents.shift(); delete input.candidateSeams.P;
  const report = verifyContours(input);
  assert.equal(report.originalParentChanges[0].reason, 'parent missing');
  assert.equal(report.originalSeamChanges[0].deltaDegrees, -2);
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

test('incomplete, duplicate, foreign and nonfinite inputs cannot pass silently', async () => {
  for (const modify of [input => delete input.candidateSeams.Q,
    input => { input.candidateSeams.Q = NaN; }, input => input.sourceFeatures.pop(),
    input => input.sourceFeatures.push(input.sourceFeatures[0]), input => input.candidate.parents.push(input.candidate.parents[0])]) {
    const input = fixture(); modify(input);
    assert.throws(() => verifyContours(input));
  }
  assert.equal(await main(['--input', 'does-not-exist.json', '--baseline', 'a', '--candidate', 'b']), 2);
  assert.equal(await main(['--typo', 'x']), 2);
});

test('CLI authenticates prepared pack bytes, writes the report and returns distinct exit codes', async () => {
  const { pack } = await makeFixture();
  const runtimeRoot = resolve('.runtime/tmp/river-contour-tests');
  mkdirSync(runtimeRoot, { recursive: true });
  const root = mkdtempSync(`${runtimeRoot}/case-`);
  const packPath = `${root}/pack.json`, inputPath = `${root}/input.json`, outputPath = `${root}/report.json`;
  const bytes = JSON.stringify(pack); writeFileSync(packPath, bytes);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const input = { schemaVersion: 1, scope: { sceneId: pack.sceneId, interactiveSourceCount: 2 },
    sourceFeatures: [pack.parents[0], pack.support[0]].map(parent => ({ id: parent.parentId, geometry: parent.parentGeometry })),
    baselineSeams: { P: 2 }, candidateSeams: { P: 2 }, digests: { baseline: digest, candidate: digest } };
  const run = () => spawnSync(process.execPath, ['tools/river_partitions/verify_contours.mjs',
    '--input', inputPath, '--baseline', packPath, '--candidate', packPath, '--output', outputPath], { encoding: 'utf8' });
  writeFileSync(inputPath, JSON.stringify(input));
  const success = run(); assert.equal(success.status, 0, success.stderr);
  assert.equal(JSON.parse(readFileSync(outputPath)).passed, true);
  input.candidateSeams.P = 3; writeFileSync(inputPath, JSON.stringify(input));
  const failure = run(); assert.equal(failure.status, 1, failure.stderr);
  assert.equal(JSON.parse(readFileSync(outputPath)).candidateSeamMismatches[0].parentId, 'P');
  writeFileSync(packPath, `${bytes}\n`);
  const changed = run(); assert.equal(changed.status, 2);
  assert.match(changed.stderr, /pack bytes changed since input preparation/);
});

test('invalid source rings name the precise offending feature', () => {
  const input = fixture();
  input.sourceFeatures.push({ id: 'bad-source', geometry: { type: 'Polygon', coordinates: [[[6, 0], [6, 1], [7, 1]]] } });
  assert.throws(() => verifyContours(input), /bad-source/);
});
