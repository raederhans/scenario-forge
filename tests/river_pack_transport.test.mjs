import test from 'node:test';
import assert from 'node:assert/strict';
import { realWave5, realWave5TransportText } from './helpers/river_paint_fixture.mjs';
import { decodeRiverPartitionTransport } from '../js/core/river_paint/pack_transport.js';
import { verifyApprovedRiverPack } from '../js/core/river_paint/pilot_loader.js';

const realTransport = () => JSON.parse(realWave5TransportText());
const digest = `sha256:${'1'.repeat(64)}`;
function fixture() {
  const geometry = () => ({ type: 'Polygon', coordinates: [[0, 1, 2, 0]] });
  return { transportVersion: 1, kind: 'river-paint-indexed-coordinates', coordinates: [[0, 0], [0, 1], [1, 0]],
    pack: { schemaVersion: 1, kind: 'river-paint-partitions', packId: digest, sceneId: 'modern_world',
      algorithmVersion: 'river-joint-noding-v1', coordinateIdentityPrecision: 7, geometryWinding: 'd3-clockwise-exterior',
      source: {}, parents: [{ parentId: 'P', parentFingerprint: digest, parentGeometry: geometry(),
        cells: [0, 1].map(n => ({ id: `C${n}`, geometryFingerprint: digest, geometry: geometry() })) }], support: [] } };
}

test('published transport recovers the canonical authenticated pack', async () => {
  const wrapper = realTransport();
  const before = structuredClone(wrapper);
  const decoded = decodeRiverPartitionTransport(wrapper);
  assert.deepEqual(decoded, realWave5());
  assert.deepEqual(wrapper, before);
  assert.equal(JSON.stringify(await verifyApprovedRiverPack(decoded)), JSON.stringify(await verifyApprovedRiverPack(realWave5())));
});

test('area-preserving coordinate-index tampering fails canonical authentication', async () => {
  const rotated = realTransport();
  const g = rotated.pack.parents[0].cells[0].geometry;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
  ring.pop(); ring.push(ring.shift(), ring[0]);
  await assert.rejects(verifyApprovedRiverPack(decodeRiverPartitionTransport(rotated)), /integrity/);
});

test('reject out-of-range coordinate references', () => {
  for (const index of [-1, 3]) {
    const value = fixture(); value.pack.parents[0].parentGeometry.coordinates[0][0] = index;
    assert.throws(() => decodeRiverPartitionTransport(value), /coordinate index/);
  }
});
