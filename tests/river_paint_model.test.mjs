import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeFixture, rectangle, realPilot, realWave2, realWave3, realWave3Text, realWave5, realWave5TransportText, realWave6, realWave6TransportText, realWave7, realWave7TransportText, d3 } from './helpers/river_paint_fixture.mjs';
import { normalizeRiverPartitionPack, normalizeRiverPaintState, verifyRiverPartitionFingerprints,
  getRiverParentCompatibility, getRiverPartitionIndex, getEditedRiverParentIds } from '../js/core/river_paint/partition_model.js';
import { canonicalRiverGeometry, riverGeometryFingerprint } from '../js/core/river_paint/geometry_identity.js';
import { applyFeaturePaintState } from '../js/core/state/color_state.js';
import { applyRiverCellPaintState, restoreRiverPaintOverridesState, setRiverPaintState } from '../js/core/state/actions/river_paint_actions.js';
import { getMapDataBoundary } from '../js/core/map_data_boundary.js';
import { verifyApprovedRiverPack, loadRiverPaintPilot } from '../js/core/river_paint/pilot_loader.js';
import { decodeRiverPartitionTransport } from '../js/core/river_paint/pack_transport.js';
import { APPROVED_RIVER_PACKS, isRiverPaintSourceCompatible } from '../js/core/river_paint/pilot_manifest.js';

test('approved real pilot has six parents, 31 cells and 11 independently noded neighbors', async () => {
  const pack = await verifyApprovedRiverPack(realPilot());
  assert.equal(pack.parents.length, 6); assert.equal(pack.support.length, 11);
  assert.equal(pack.parents.reduce((n, p) => n + p.cells.length, 0), 31);
  assert.equal(await verifyRiverPartitionFingerprints(pack), pack);
  assert.equal(pack.parents.find(p => p.parentId === 'DEE0D').cells.length, 9);
  for (const parent of pack.parents) {
    for (const cell of parent.cells) assert.ok(d3.geoArea(cell.geometry) < 2 * Math.PI);
  }
});

test('normalization owns immutable geometry without freezing the caller input', async () => {
  const { pack } = await makeFixture(); const raw = structuredClone(pack);
  const normalized = normalizeRiverPartitionPack(raw);
  raw.parents[0].cells[0].geometry.coordinates[0][0][0] = 99;
  assert.notEqual(normalized.parents[0].cells[0].geometry.coordinates[0][0][0], 99);
  assert.equal(Object.isFrozen(normalized.parents[0].cells[0].geometry.coordinates[0]), true);
  assert.equal(normalizeRiverPartitionPack(normalized), normalized);
  assert.equal(getRiverPartitionIndex(normalized), getRiverPartitionIndex(normalized));
});

test('wave 2 authenticates 43 cells while preserving all original parent records', async () => {
  const old = await verifyApprovedRiverPack(realPilot());
  const pack = await verifyApprovedRiverPack(realWave2());
  assert.equal(pack.parents.length, 12); assert.equal(pack.support.length, 18);
  assert.equal(pack.parents.reduce((n, p) => n + p.cells.length, 0), 43);
  await verifyRiverPartitionFingerprints(pack);
  for (const parent of old.parents) assert.deepEqual(pack.parents.find(p => p.parentId === parent.parentId), parent);
  const forged = realWave2(); forged.source.riverNames = ['forged'];
  await assert.rejects(verifyApprovedRiverPack(forged), /integrity/);
  const swapped = realWave2(); swapped.packId = old.packId;
  await assert.rejects(verifyApprovedRiverPack(swapped), /integrity/);
});

test('river action owns imported paint and rejects invalid edits without writes', async () => {
  const { state, cells } = await makeFixture();
  const raw = structuredClone(state.riverPaint);
  setRiverPaintState(state, raw);
  raw.pack.parents[0].cells[0].geometry.coordinates[0][0][0] = 99;
  assert.notEqual(state.riverPaint.pack.parents[0].cells[0].geometry.coordinates[0][0][0], 99);
  const before = state.riverPaint;
  assert.throws(() => applyRiverCellPaintState(state, { toString: () => cells[0].id }, '#0000ff'), /not available/);
  assert.throws(() => applyRiverCellPaintState(state, cells[0].id, 'invalid'), /invalid edit color/);
  assert.throws(() => setRiverPaintState(state, { schemaVersion: 99 }), /unsupported/);
  assert.equal(state.riverPaint, before);
});

test('wave3 authenticates exactly the reviewed scope with all wave2 parents unchanged', async () => {
  const pack = await verifyApprovedRiverPack(realWave3());
  const selection = JSON.parse(readFileSync(new URL('../tools/river_partitions/selections/wave3-reviewed.json', import.meta.url)));
  assert.deepEqual(pack.parents.map(p => p.parentId).sort(), [...selection.parents].sort());
  assert.equal(pack.parents.length, 302); assert.equal(pack.support.length, 108);
  assert.equal(pack.parents.reduce((n, p) => n + p.cells.length, 0), 905);
  assert.equal(await verifyRiverPartitionFingerprints(pack), pack);
  for (const parent of realWave2().parents) {
    assert.deepEqual(pack.parents.find(p => p.parentId === parent.parentId), parent);
  }
  const path = d3.geoPath(d3.geoEquirectangular());
  for (const parent of pack.parents) {
    for (const cell of parent.cells) {
      const area = d3.geoArea(cell.geometry);
      assert.ok(area > 0 && area < 2 * Math.PI, cell.id);
      assert.ok(path(cell.geometry) && !/NaN|Infinity/.test(path(cell.geometry)), cell.id);
    }
  }
});

test('wave3 authentication rejects changed support, cells, provenance and unapproved identities', async () => {
  const rotate = geometry => {
    const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
    ring.pop(); const first = ring.shift(); ring.push(first, ring[0]);
    assert.notDeepEqual(first, ring[0]);
  };
  for (const mutate of [
    p => rotate(p.support[0].geometry),
    p => rotate(p.parents[0].cells[0].geometry),
    p => { p.source.riverNames = ['FORGED']; },
    p => { p.packId = realWave2().packId; },
  ]) {
    const raw = realWave3(); mutate(raw);
    // Ring rotations preserve domain and fingerprint but change authenticated bytes.
    normalizeRiverPartitionPack(raw);
    await assert.rejects(verifyApprovedRiverPack(raw), /integrity/);
  }
  const unknown = realWave3(); unknown.packId = `sha256:${'f'.repeat(64)}`;
  await assert.rejects(verifyApprovedRiverPack(unknown), /Unsupported/);
});

test('historical wave5 authenticates exact reviewed geometry with all wave3 records preserved in a smaller transport', async () => {
  const canonical = realWave5(), text = realWave5TransportText();
  const pack = await verifyApprovedRiverPack(decodeRiverPartitionTransport(JSON.parse(text)));
  assert.deepEqual(pack, normalizeRiverPartitionPack(canonical));
  assert.equal(pack.parents.length, 376); assert.equal(pack.support.length, 111);
  assert.equal(pack.parents.reduce((n, parent) => n + parent.cells.length, 0), 1164);
  const reviewed = JSON.parse(readFileSync(new URL('../tools/river_partitions/selections/wave5-reviewed.json', import.meta.url)));
  assert.deepEqual(pack.parents.map(p => p.parentId).sort(), [...reviewed.parents].sort());
  assert.ok(text.length <= 2_000_000);
  assert.ok(text.length < realWave3Text().length);
  assert.equal(await verifyRiverPartitionFingerprints(pack), pack);
  for (const previous of realWave3().parents) {
    assert.deepEqual(pack.parents.find(p => p.parentId === previous.parentId), previous);
  }
  const path = d3.geoPath(d3.geoEquirectangular());
  for (const parent of pack.parents) for (const cell of parent.cells) {
    assert.ok(d3.geoArea(cell.geometry) > 0 && d3.geoArea(cell.geometry) < 2 * Math.PI, cell.id);
    assert.ok(path(cell.geometry) && !/NaN|Infinity/.test(path(cell.geometry)), cell.id);
  }
  for (const mutate of [
    p => { p.source.baseCommit = 'different-source'; },
    p => { p.support[0].geometry.coordinates.reverse(); p.support[0].parentId += '-changed'; },
    p => { p.parents[0].cells[0].id += '-changed'; },
  ]) {
    const changed = realWave5(); mutate(changed);
    await assert.rejects(verifyApprovedRiverPack(changed));
  }
});

test('historical wave6 transport is lossless, reviewed and preserves every earlier parent record', async () => {
  const canonical = realWave6(), text = realWave6TransportText();
  const pack = await verifyApprovedRiverPack(decodeRiverPartitionTransport(JSON.parse(text)));
  assert.deepEqual(decodeRiverPartitionTransport(JSON.parse(text)), canonical);
  assert.deepEqual(pack, normalizeRiverPartitionPack(canonical));
  assert.equal(pack.parents.length, 382);
  assert.equal(pack.support.length, 106);
  assert.equal(pack.parents.reduce((n, parent) => n + parent.cells.length, 0), 1199);
  const reviewed = JSON.parse(readFileSync(new URL('../tools/river_partitions/selections/wave6-reviewed.json', import.meta.url)));
  assert.deepEqual(pack.parents.map(parent => parent.parentId).sort(), [...reviewed.parents].sort());
  assert.ok(text.length <= 2_000_000);
  assert.equal(await verifyRiverPartitionFingerprints(pack), pack);
  assert.deepEqual(pack.source, realWave5().source);
  const parents = new Map(pack.parents.map(parent => [parent.parentId, parent]));
  for (const previous of [realPilot(), realWave2(), realWave3(), realWave5()]) {
    for (const parent of previous.parents) assert.deepEqual(parents.get(parent.parentId), parent);
  }
  for (const mutate of [
    value => { value.source.baseCommit = 'different-source'; },
    value => { value.parents[0].cells[0].id += '-changed'; },
    value => { value.support[0].parentId += '-changed'; },
    value => { value.packId = realWave5().packId; },
  ]) {
    const changed = realWave6(); mutate(changed);
    await assert.rejects(verifyApprovedRiverPack(changed));
  }
});

test('default wave7 download authenticates lossless reviewed geometry and all 382 wave6 records exactly', async () => {
  const canonical = realWave7(), text = realWave7TransportText();
  const pack = await loadRiverPaintPilot({ fetchImpl: async url => {
    assert.equal(url, 'data/river_partitions/modern_world_wave7.transport.json');
    return { ok: true, text: async () => text };
  } });
  assert.deepEqual(decodeRiverPartitionTransport(JSON.parse(text)), canonical);
  assert.deepEqual(pack, normalizeRiverPartitionPack(canonical));
  assert.equal(pack.parents.length, 389); assert.equal(pack.support.length, 104);
  assert.equal(pack.parents.reduce((n, parent) => n + parent.cells.length, 0), 1276);
  const reviewed = JSON.parse(readFileSync(new URL('../tools/river_partitions/selections/wave7-reviewed.json', import.meta.url)));
  assert.deepEqual(pack.parents.map(parent => parent.parentId).sort(), [...reviewed.parents].sort());
  assert.equal(Buffer.byteLength(text.replace(/\r\n/g, '\n'), 'utf8'), 1_517_806);
  assert.ok(text.length <= 2_000_000);
  assert.equal(await verifyRiverPartitionFingerprints(pack), pack);
  assert.deepEqual(pack.source, realWave6().source);
  const parents = new Map(pack.parents.map(parent => [parent.parentId, parent]));
  for (const previous of [realPilot(), realWave2(), realWave3(), realWave5(), realWave6()]) {
    for (const parent of previous.parents) assert.deepEqual(parents.get(parent.parentId), parent);
  }
  const previousIds = new Set(realWave6().parents.map(parent => parent.parentId));
  const addedIds = pack.parents.filter(parent => !previousIds.has(parent.parentId)).map(parent => parent.parentId);
  const overlaps = JSON.parse(readFileSync(new URL('./fixtures/river_paint/overlapping_seams.json', import.meta.url)));
  assert.deepEqual(addedIds.sort(), [...overlaps.heldParentIds].sort());
  for (const mutate of [
    value => { value.source.baseCommit = 'different-source'; },
    value => { value.parents[0].cells[0].id += '-changed'; },
    value => { value.support[0].parentId += '-changed'; },
    value => { value.packId = realWave6().packId; },
  ]) {
    const changed = realWave7(); mutate(changed);
    await assert.rejects(verifyApprovedRiverPack(changed));
  }
});

test('every approved pack requires its exact scenario version and generation', () => {
  for (const approved of APPROVED_RIVER_PACKS) {
    const pack = { packId: approved.packId };
    const manifest = { version: approved.scenarioVersion, generated_at: approved.scenarioGeneratedAt };
    assert.equal(isRiverPaintSourceCompatible(pack, manifest), true);
    assert.equal(isRiverPaintSourceCompatible(pack, { ...manifest, version: manifest.version + 1 }), false);
    assert.equal(isRiverPaintSourceCompatible(pack, { ...manifest, generated_at: 'new-build' }), false);
    assert.equal(isRiverPaintSourceCompatible(pack, undefined), false);
  }
});

test('geometry identity ignores ring rotation and direction, not source changes', async () => {
  const a = rectangle(0, 0, 2, 2), b = structuredClone(a);
  b.coordinates[0].reverse();
  assert.equal(await riverGeometryFingerprint(a), await riverGeometryFingerprint(b));
  assert.equal(canonicalRiverGeometry(a), canonicalRiverGeometry(b));
  assert.notEqual(await riverGeometryFingerprint(a), await riverGeometryFingerprint(rectangle(0, 0, 2, 3)));
});

test('reject duplicate IDs, wrong winding, changed coverage and unsupported coordinates', async () => {
  const { pack } = await makeFixture();
  for (const mutate of [
    p => p.parents.push(p.parents[0]),
    p => p.parents[0].cells.push(p.parents[0].cells[0]),
    p => p.parents[0].cells[0].geometry.coordinates[0].reverse(),
    p => p.parents[0].cells[0].geometry.coordinates[0].pop(),
    p => p.parents[0].cells[0].geometry.coordinates[0][1][1] = 85,
    p => p.parents[0].cells[0].geometry = rectangle(0, 0, .5, .5),
    p => p.support.push(p.support[0]),
    p => p.parents[0].cells[0].id = '__proto__',
  ]) {
    const raw = structuredClone(pack); mutate(raw);
    assert.throws(() => normalizeRiverPartitionPack(raw));
  }
});

test('normalization cannot authenticate a forged area-preserving geometry', async () => {
  const raw = realPilot();
  raw.source.riverNames = ['FORGED'];
  await assert.rejects(verifyApprovedRiverPack(raw), /integrity/);
  const { pack } = await makeFixture();
  await assert.rejects(verifyApprovedRiverPack(pack), /Unsupported/);
});

test('approved loader uses the catalog URL and propagates abort and HTTP failure', async () => {
  const signal = new AbortController().signal;
  const historicalText = realWave3Text();
  // Windows Git checkouts can turn the builder's final LF into CRLF.
  assert.equal(historicalText.replace(/\r\n/g, '\n').length, 1_993_389);
  const text = realWave7TransportText();
  assert.equal(Buffer.byteLength(text, 'utf8'), text.length);
  assert.ok(text.length <= 2_000_000);
  const pack = await loadRiverPaintPilot({ signal, fetchImpl: async (url, options) => {
    assert.equal(url, 'data/river_partitions/modern_world_wave7.transport.json'); assert.equal(options.signal, signal);
    assert.equal(options.cache, 'no-cache');
    return { ok: true, text: async () => text };
  } });
  assert.equal(pack.parents.length, 389);
  const abort = new DOMException('Aborted', 'AbortError');
  await assert.rejects(loadRiverPaintPilot({ fetchImpl: async () => { throw abort; } }), error => error === abort);
  await assert.rejects(loadRiverPaintPilot({ fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(loadRiverPaintPilot({ fetchImpl: async () => ({ ok: true, text: async () => 'x'.repeat(2000001) }) }), /budget/);
});

test('parent color inheritance and child overrides never alter reference membership', async () => {
  const { state, cells } = await makeFixture(); const boundary = getMapDataBoundary(state);
  const referenceBefore = boundary.reference.getFeatureOrigin('P');
  assert.equal(boundary.paint.resolveRiverCellColor(cells[0].id).color, '#ff0000');
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  assert.equal(boundary.paint.resolveRiverCellColor(cells[0].id).color, '#0000ff');
  assert.equal(boundary.paint.resolveRiverCellColor(cells[1].id).color, '#ff0000');
  state.sovereignBaseColors.FR = '#00ff00';
  assert.equal(boundary.paint.resolveRiverCellColor(cells[0].id).color, '#0000ff');
  assert.equal(boundary.paint.resolveRiverCellColor(cells[1].id).color, '#00ff00');
  assert.deepEqual(boundary.reference.getFeatureOrigin('P'), referenceBefore);
  assert.deepEqual([...state.landIndex.keys()], ['P', 'N']);
});

test('same-color entire-parent fill still removes child overrides; eraser resumes inheritance', async () => {
  const { state, cells } = await makeFixture();
  applyFeaturePaintState(state, ['P'], '#ff0000');
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  assert.deepEqual(getEditedRiverParentIds(state.riverPaint), ['P']);
  applyFeaturePaintState(state, ['P'], '#ff0000');
  assert.deepEqual(state.riverPaint.overrides, {});
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  applyRiverCellPaintState(state, cells[0].id, null, { remove: true });
  assert.equal(getMapDataBoundary(state).paint.resolveRiverCellColor(cells[0].id).color, '#ff0000');
});

test('invalid batch or history patch fails before any child color mutation', async () => {
  const { state, cells } = await makeFixture();
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  const before = state.riverPaint;
  assert.throws(() => applyFeaturePaintState(state, ['P'], 'invalid'));
  assert.throws(() => restoreRiverPaintOverridesState(state, { [cells[0].id]: null, unknown: '#123456' }));
  assert.equal(state.riverPaint, before);
  assert.throws(() => normalizeRiverPaintState({ ...before, overrides: { wrong: '#123456' } }));
});

test('changed geometry and scenario baselines reject child edits', async () => {
  const { state, cells, pack } = await makeFixture();
  state.landIndex.set('P', { ...state.landIndex.get('P'), geometry: rectangle(0, 0, 4, 4) });
  assert.equal(getRiverParentCompatibility(pack, state.landIndex.get('P'), 'P').status, 'geometry-mismatch');
  assert.throws(() => applyRiverCellPaintState(state, cells[0].id, '#0000ff'), /not ready/);
  state.activeScenarioId = 'tno_1962';
  assert.throws(() => applyRiverCellPaintState(state, cells[0].id, '#0000ff'), /not available/);
  assert.deepEqual(state.riverPaint.overrides, {});
});
