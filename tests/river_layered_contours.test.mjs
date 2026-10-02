import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyContours } from '../tools/river_partitions/verify_contours.mjs';
import { verifyLayeredContours } from '../tools/river_partitions/verify_layered_contours.mjs';
import { createInheritedCollinearConflictClassifier } from '../tools/river_partitions/inherited_collinear_conflicts.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/river_paint/overlapping_seams.json', import.meta.url), 'utf8'));
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
  assert.deepEqual(proof.baselineEdges.map(edge => [edge.featureId, edge.identitySegment]),
    [['A', '0,0;0,100000000'], ['B', '0,0;0,60000000']]);
  assert.ok(proof.baselineEdges.every(edge => edge.sourceStart[1] > edge.sourceEnd[1] && edge.side === 1));
  assert.equal(proof.coverageIntervals.length, 1);
  assert.equal(proof.coverageIntervals[0].identitySegment, row.identitySegment);
});

test('all original baseline and candidate endpoints split proof into continuous equal-owner subintervals', () => {
  const proof = classify([face('A', { cuts: [1, 2] }), face('B', { hi: 6, cuts: [1.5] })],
    [face('cell-A', { cuts: [1, 2, 3] }), face('cell-B', { hi: 6, cuts: [2.5, 3] })]);
  assert.ok(proof);
  assert.deepEqual(proof.coverageIntervals.map(interval => interval.identitySegment), [
    '0,0;0,10000000', '0,10000000;0,15000000', '0,15000000;0,20000000',
    '0,20000000;0,25000000', '0,25000000;0,30000000',
  ]);
  assert.ok(proof.coverageIntervals.every(interval =>
    JSON.stringify(interval.baselineOwners) === JSON.stringify(proof.inheritedOwners)
    && JSON.stringify(interval.candidateOwners) === JSON.stringify(proof.inheritedOwners)));
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

test('opposite-side neighbors or any side change cannot be classified as inherited same-side conflict', () => {
  assert.equal(classify(baseline(), [candidate()[0], face('cell-B', { opposite: true, hi: 6, cuts: [3] })]), null);
  assert.equal(classify([face('A'), face('B', { opposite: true, hi: 6 })],
    [candidate()[0], face('cell-B', { opposite: true, hi: 6, cuts: [3] })]), null);
});

test('all collinear owners are inspected, including extra owners on a strict interior interval', () => {
  assert.equal(classify(baseline(), [...candidate(), face('third', { lo: 1, hi: 2 })]), null);
  assert.equal(classify([...baseline(), face('third', { lo: 1, hi: 2 })], candidate()), null);
  assert.equal(classify([...baseline(), face('third', { lo: 1, hi: 2 })],
    [...candidate(), face('third', { lo: 1, hi: 2 })]), null, 'row owner inventory must include every original covering owner');
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

test('real overlap fixture attributes all 22 additions while retaining the identical failing legacy report', () => {
  const before = structuredClone(fixture);
  const legacy = verifyContours(fixture);
  const report = verifyLayeredContours(fixture);
  assert.equal(report.geometryPassed, true);
  assert.equal(report.visibilityVerified, false);
  assert.deepEqual(report.unattributedAmbiguities, []);
  assert.equal(report.ambiguityAttributions.length, 22);
  assert.equal(report.ambiguityAttributions.filter(entry => entry.classification === 'parent-local-internal-seam').length, 21);
  const inherited = report.ambiguityAttributions.filter(entry => entry.classification === 'inherited-collinear-conflict-subdivision');
  assert.equal(inherited.length, 1);
  assert.equal(inherited[0].identitySegment, '445558456,487127207;445558456,487143960');
  assert.deepEqual(inherited[0].inheritedOwners, [
    { parentId: 'RU_RAY_50074027B61241799946425', side: 1 },
    { parentId: 'RU_RAY_50074027B68742604318629', side: 1 },
  ]);
  assert.deepEqual(inherited[0].baselineEdges.map(edge => [edge.parentId, edge.identitySegment, edge.side]), [
    ['RU_RAY_50074027B61241799946425', '445558456,487127207;445558456,487439658', 1],
    ['RU_RAY_50074027B68742604318629', '445558456,487127207;445558456,487231357', 1],
  ]);
  assert.deepEqual(report.legacyGlobalReport, legacy);
  assert.equal(legacy.passed, false);
  assert.equal(legacy.candidateSeamMismatches.length, 9);
  assert.equal(legacy.originalSeamChanges.length, 2);
  assert.equal(legacy.addedAmbiguousSegments.length, 22);
  assert.deepEqual(legacy.addedAmbiguousSegments, fixture.expectedAddedAmbiguousSegments);
  assert.deepEqual(fixture, before);
});

test('missing, NaN and infinite expected seams reject before a layered geometry verdict', () => {
  for (const label of ['baseline', 'candidate']) {
    for (const value of [undefined, NaN, Infinity]) {
      const input = structuredClone(fixture);
      const parentId = input[label].parents[0].parentId;
      if (value === undefined) delete input[`${label}Seams`][parentId];
      else input[`${label}Seams`][parentId] = value;
      assert.throws(() => verifyLayeredContours(input), new RegExp(`${label}: invalid/missing seam expectation`));
    }
  }
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(repoRoot, 'tools/river_partitions/verify_layered_contours.mjs');
function cliFixture({ mutateCandidate = () => {}, mutateInput = () => {}, changedBytes = false } = {}) {
  const runtimeDir = join(repoRoot, '.runtime/rv7-layered');
  mkdirSync(runtimeDir, { recursive: true });
  const directory = mkdtempSync(join(runtimeDir, 'cli-'));
  const baselinePath = join(directory, 'baseline.json'), candidatePath = join(directory, 'candidate.json');
  const inputPath = join(directory, 'prepared.json'), outputPath = join(directory, 'report.json');
  const candidate = structuredClone(fixture.candidate);
  mutateCandidate(candidate);
  const baselineBytes = JSON.stringify(fixture.baseline), candidateBytes = JSON.stringify(candidate);
  const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const input = { schemaVersion: 1, scope: fixture.scope, sourceFeatures: fixture.sourceFeatures,
    baselineSeams: fixture.baselineSeams, candidateSeams: fixture.candidateSeams,
    digests: { baseline: digest(baselineBytes), candidate: digest(candidateBytes) } };
  mutateInput(input);
  writeFileSync(baselinePath, baselineBytes);
  writeFileSync(candidatePath, candidateBytes + (changedBytes ? '\n' : ''));
  writeFileSync(inputPath, JSON.stringify(input));
  const args = ['--input', inputPath, '--baseline', baselinePath, '--candidate', candidatePath];
  const run = (extra = ['--output', outputPath]) => spawnSync(process.execPath, [cliPath, ...args, ...extra],
    { cwd: repoRoot, encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
  return { run, outputPath, baselinePath };
}

test('layered CLI publishes reproducible runtime report and exits on geometry while declaring visibility unverified', () => {
  const h = cliFixture();
  const result = h.run();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.geometryPassed, true);
  assert.equal(report.visibilityVerified, false);
  assert.equal(report.legacyGlobalReport.passed, false);
  assert.deepEqual(JSON.parse(readFileSync(h.outputPath, 'utf8')), report);
  const failed = cliFixture({ mutateInput: input => { input.candidateSeams.AT130 += 1; } });
  const rejection = failed.run();
  assert.equal(rejection.status, 1, rejection.stderr);
  assert.equal(JSON.parse(rejection.stdout).geometryPassed, false);
});

test('layered CLI rejects changed prepared pack bytes and invalid fingerprints even with a matching new byte digest', () => {
  const changed = cliFixture({ changedBytes: true });
  const stale = changed.run();
  assert.equal(stale.status, 2);
  assert.match(stale.stderr, /candidate: pack bytes changed since input preparation/);
  assert.equal(existsSync(changed.outputPath), false);
  const forged = cliFixture({ mutateCandidate: candidate => {
    candidate.parents[0].cells[0].geometryFingerprint = `sha256:${'0'.repeat(64)}`;
    candidate.parents[0].cells[0].id = `river:${candidate.parents[0].parentId}:${'0'.repeat(16)}`;
  } });
  const invalid = forged.run();
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /cell fingerprint mismatch/);
  assert.equal(existsSync(forged.outputPath), false);
});

test('layered CLI rejects prepared scope mismatches and refuses to overwrite an input file', () => {
  const h = cliFixture({ mutateInput: input => { input.scope = { ...input.scope, interactiveSourceCount: 0 }; } });
  const invalid = h.run();
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Invalid prepared source scope/);
  assert.equal(existsSync(h.outputPath), false);
  const protectedInput = cliFixture();
  const before = readFileSync(protectedInput.baselinePath, 'utf8');
  const overwrite = protectedInput.run(['--output', protectedInput.baselinePath]);
  assert.equal(overwrite.status, 2);
  assert.match(overwrite.stderr, /Report must not overwrite input/);
  assert.equal(readFileSync(protectedInput.baselinePath, 'utf8'), before);
});
