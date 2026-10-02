import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realPilot, realWave2, realWave3 } from './helpers/river_paint_fixture.mjs';
import { decodeRiverPartitionTransport } from '../js/core/river_paint/pack_transport.js';
import { loadRiverPaintPilot, verifyApprovedRiverPack } from '../js/core/river_paint/pilot_loader.js';
import { normalizeRiverPaintState } from '../js/core/river_paint/partition_model.js';

// Exercise the actual standalone Python encoder, not a second JS encoder that
// could share the decoder's mistake. No generated pack fixture is checked in.
const encoded = spawnSync(process.execPath, ['tools/run_python.mjs', '-B', '-c',
  'import json; from pathlib import Path; from tools.river_partitions.compact_transport import encode_transport; '
  + 'print(json.dumps(encode_transport(json.loads(Path("data/river_partitions/modern_world_wave3.json").read_text(encoding="utf-8"))), separators=(",",":"), ensure_ascii=False))'],
{ cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', maxBuffer: 8_000_000 });
assert.equal(encoded.status, 0, encoded.stderr);
const transportText = encoded.stdout.replace(/\r\n/g, '\n');
const realTransport = () => JSON.parse(transportText);
const digest = `sha256:${'1'.repeat(64)}`;
function fixture() {
  const geometry = () => ({ type: 'Polygon', coordinates: [[0, 1, 2, 0]] });
  return { transportVersion: 1, kind: 'river-paint-indexed-coordinates', coordinates: [[0, 0], [0, 1], [1, 0]],
    pack: { schemaVersion: 1, kind: 'river-paint-partitions', packId: digest, sceneId: 'modern_world',
      algorithmVersion: 'river-joint-noding-v1', coordinateIdentityPrecision: 7, geometryWinding: 'd3-clockwise-exterior',
      source: {}, parents: [{ parentId: 'P', parentFingerprint: digest, parentGeometry: geometry(),
        cells: [0, 1].map(n => ({ id: `C${n}`, geometryFingerprint: digest, geometry: geometry() })) }], support: [] } };
}

test('Python transport recovers every actual wave3 number and canonical authenticated byte', async () => {
  const wrapper = realTransport();
  const before = structuredClone(wrapper);
  const decoded = decodeRiverPartitionTransport(wrapper);
  assert.deepEqual(decoded, realWave3());
  assert.deepEqual(wrapper, before);
  assert.equal(JSON.stringify(await verifyApprovedRiverPack(decoded)), JSON.stringify(await verifyApprovedRiverPack(realWave3())));
  assert.equal(wrapper.coordinates.length, 18993);
  assert.equal(Buffer.byteLength(transportText, 'utf8'), 1193430);
  assert.ok(Buffer.byteLength(transportText, 'utf8') < 1_993_389 * 0.61);
  // Decoding owns point arrays rather than sharing table rows with each other.
  decoded.parents[0].parentGeometry.coordinates[0][0][0] = 179;
  assert.deepEqual(wrapper, before);
});

test('loader decodes downloads before authentication, while saved packs keep the old contract', async () => {
  const pack = await loadRiverPaintPilot({ fetchImpl: async () => ({ ok: true, text: async () => transportText }) });
  assert.deepEqual(pack, await verifyApprovedRiverPack(realWave3()));
  assert.equal(pack.schemaVersion, 1);
  assert.equal(Object.hasOwn(pack, 'transportVersion'), false);
  const save = JSON.parse(JSON.stringify(normalizeRiverPaintState({ schemaVersion: 1, pack, overrides: {} })));
  assert.deepEqual(await verifyApprovedRiverPack(save.pack), pack);
  await assert.rejects(verifyApprovedRiverPack(realTransport()), /unsupported pack contract/);
  assert.throws(() => normalizeRiverPaintState({ schemaVersion: 1, pack: realTransport() }), /unsupported pack contract/);
  for (const canonical of [realPilot(), realWave2(), realWave3()]) {
    assert.equal(decodeRiverPartitionTransport(canonical), canonical);
    await verifyApprovedRiverPack(canonical);
  }
});

test('compact provenance and area-preserving coordinate-index tampering still fail canonical authentication', async () => {
  const provenance = realTransport(); provenance.pack.source.riverNames = ['forged'];
  await assert.rejects(verifyApprovedRiverPack(decodeRiverPartitionTransport(provenance)), /integrity/);
  const rotated = realTransport();
  const g = rotated.pack.parents[0].cells[0].geometry;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
  ring.pop(); ring.push(ring.shift(), ring[0]);
  await assert.rejects(verifyApprovedRiverPack(decodeRiverPartitionTransport(rotated)), /integrity/);
});

test('reject malformed references, nonfinite points, unknown contracts and hostile records', () => {
  for (const index of [-1, 3, 0.5, '0', null, Number.MAX_SAFE_INTEGER, Infinity]) {
    const value = fixture(); value.pack.parents[0].parentGeometry.coordinates[0][0] = index;
    assert.throws(() => decodeRiverPartitionTransport(value), /coordinate index/);
  }
  for (const point of [[NaN, 0], [0, Infinity], [181, 0], [0, 81], [0], [0, 0, 0], ['0', 0]]) {
    const value = fixture(); value.coordinates[0] = point;
    assert.throws(() => decodeRiverPartitionTransport(value));
  }
  for (const mutate of [
    v => { v.transportVersion = 2; }, v => { v.kind = 'future'; },
    v => { v.pack.algorithmVersion = 'future'; }, v => { delete v.pack.parents; },
    v => { v.pack.parents[0].parentGeometry.type = 'LineString'; },
    v => { v.pack.parents[0].parentGeometry.coordinates = []; },
    v => { v.pack.parents[0].parentGeometry.coordinates = [[0, 0, 0]]; },
    v => { v.pack.parents[0].cells = []; },
    v => { Object.defineProperty(v.pack.source, '__proto__', { value: {}, enumerable: true }); },
    v => { v.pack.source.constructor = {}; },
    v => { Object.setPrototypeOf(v.pack.parents[0], { parentId: 'inherited' }); },
    v => { Object.defineProperty(v.pack, 'sceneId', { get() { throw new Error('getter executed'); } }); },
    v => { Object.defineProperty(v, 'kind', { get() { throw new Error('getter executed'); } }); },
    v => { Object.setPrototypeOf(v.coordinates[0], null); },
    v => { Object.defineProperty(v.coordinates, '0', { get() { throw new Error('getter executed'); } }); },
    v => { v.pack.parents[0].parentGeometry.coordinates[0].map = () => { throw new Error('map executed'); }; },
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => decodeRiverPartitionTransport(value), error => error instanceof TypeError && /transport/.test(error.message));
  }
  const sparse = fixture(); delete sparse.coordinates[0];
  assert.throws(() => decodeRiverPartitionTransport(sparse), /array/);
});

test('exact numeric coordinates include signed zero and tiny binary64 values', () => {
  const value = fixture(); value.coordinates = [[-0, 0], [Number.MIN_VALUE, 1], [1, -0]];
  const ring = decodeRiverPartitionTransport(value).parents[0].parentGeometry.coordinates[0];
  assert.ok(Object.is(ring[0][0], -0)); assert.equal(ring[1][0], Number.MIN_VALUE);
  assert.ok(Object.is(ring[2][1], -0));
  assert.notEqual(ring[0], ring[3]);
});

test('coordinate-table and expanded-reference ceilings are checked before expansion', () => {
  const value = fixture();
  value.coordinates = Array.from({ length: 250000 }, () => [0, 0]);
  value.pack.parents[0].parentGeometry.coordinates[0] = Array(249992).fill(0);
  assert.equal(decodeRiverPartitionTransport(value).parents[0].parentGeometry.coordinates[0].length, 249992);
  value.pack.parents[0].parentGeometry.coordinates[0].push(0);
  assert.throws(() => decodeRiverPartitionTransport(value), /count/);
  value.coordinates.push([0, 0]);
  assert.throws(() => decodeRiverPartitionTransport(value), /coordinate table count/);
  // A three-point table cannot amplify a short download past the same ceiling.
  const amplified = fixture(); amplified.pack.parents[0].parentGeometry.coordinates[0] = Array(249993).fill(0);
  const originalMap = Array.prototype.map;
  let expansionCalls = 0;
  try {
    Array.prototype.map = function (...args) { expansionCalls += 1; return originalMap.apply(this, args); };
    assert.throws(() => decodeRiverPartitionTransport(amplified), /count/);
  } finally { Array.prototype.map = originalMap; }
  assert.equal(expansionCalls, 0, 'oversize transport must fail before any decoded geometry array is mapped');
});

test('parent, support and total/per-parent cell bounds remain unchanged', () => {
  const value = fixture(); const parent = value.pack.parents[0];
  value.pack.parents = Array.from({ length: 512 }, () => structuredClone(parent));
  assert.equal(decodeRiverPartitionTransport(value).parents.length, 512);
  value.pack.parents.push(parent);
  assert.throws(() => decodeRiverPartitionTransport(value), /parent count/);
  const cellValue = fixture();
  cellValue.pack.parents = Array.from({ length: 64 }, () => ({ ...structuredClone(parent),
    cells: Array.from({ length: 128 }, () => structuredClone(parent.cells[0])) }));
  assert.equal(decodeRiverPartitionTransport(cellValue).parents.reduce((n, p) => n + p.cells.length, 0), 8192);
  cellValue.pack.parents.push(structuredClone(parent));
  assert.throws(() => decodeRiverPartitionTransport(cellValue), /cell budget/);
  const perParent = fixture(); perParent.pack.parents[0].cells = Array(129).fill(parent.cells[0]);
  assert.throws(() => decodeRiverPartitionTransport(perParent), /cell count/);
  const supportValue = fixture();
  supportValue.pack.support = Array.from({ length: 2048 }, () => ({ parentId: 'S', parentFingerprint: digest,
    geometryFingerprint: digest, parentGeometry: structuredClone(parent.parentGeometry), geometry: structuredClone(parent.parentGeometry) }));
  assert.equal(decodeRiverPartitionTransport(supportValue).support.length, 2048);
  supportValue.pack.support.push(supportValue.pack.support[0]);
  assert.throws(() => decodeRiverPartitionTransport(supportValue), /support count/);
});
