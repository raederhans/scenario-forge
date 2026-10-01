import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { normalizeRiverPartitionPack, normalizeRiverPaintState } from '../../js/core/river_paint/partition_model.js';
import { riverGeometryFingerprint } from '../../js/core/river_paint/geometry_identity.js';
export const d3 = createRequire(import.meta.url)('../../vendor/d3.v7.min.js');
export const rectangle = (x0, y0, x1, y1) => ({ type: 'Polygon',
  coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] });
export const feature = (id, geometry) => ({ type: 'Feature', id,
  properties: { id, cntr_code: 'FR', name: id }, geometry });
export const realPilot = () => JSON.parse(readFileSync(new URL('../../data/river_partitions/modern_world_pilot.json', import.meta.url)));
export const realWave2 = () => JSON.parse(readFileSync(new URL('../../data/river_partitions/modern_world_wave2.json', import.meta.url)));
export async function makeFixture({ installed = true, baseline = 'fixture-baseline' } = {}) {
  const parent = rectangle(0, 0, 2, 2), neighbor = rectangle(2, 0, 3, 2);
  const neighborNoded = { type: 'Polygon', coordinates: [[[2, 0], [2, 1], [2, 2], [3, 2], [3, 0], [2, 0]]] };
  const cells = [];
  for (const geometry of [rectangle(0, 0, 2, 1), rectangle(0, 1, 2, 2)]) {
    const geometryFingerprint = await riverGeometryFingerprint(geometry);
    cells.push({ id: `river:P:${geometryFingerprint.slice(7, 23)}`, geometry, geometryFingerprint });
  }
  const pack = normalizeRiverPartitionPack({ schemaVersion: 1, kind: 'river-paint-partitions',
    packId: `sha256:${'1'.repeat(64)}`, sceneId: 'modern_world', algorithmVersion: 'river-joint-noding-v1',
    coordinateIdentityPrecision: 7, geometryWinding: 'd3-clockwise-exterior',
    source: { baselineHash: baseline },
    parents: [{ parentId: 'P', parentGeometry: parent, parentFingerprint: await riverGeometryFingerprint(parent), cells }],
    support: [{ parentId: 'N', parentGeometry: neighbor, parentFingerprint: await riverGeometryFingerprint(neighbor),
      geometry: neighborNoded, geometryFingerprint: await riverGeometryFingerprint(neighborNoded) }],
  });
  const features = [feature('P', parent), feature('N', neighborNoded)];
  const state = { activeScenarioId: 'modern_world', scenarioBaselineHash: baseline, sceneGeneration: 1,
    riverPaint: normalizeRiverPaintState(installed ? { schemaVersion: 1, pack, editMode: true, overrides: {} } : null),
    landData: { type: 'FeatureCollection', features }, landIndex: new Map(features.map(f => [f.id, f])),
    sovereignBaseColors: { FR: '#ff0000' }, visualOverrides: {}, currentTool: 'fill',
    interactionGranularity: 'subdivision', selectedColor: '#0000ff', mapSemanticMode: 'political',
    colorRevision: 0, currentLanguage: 'en' };
  return { state, pack, cells: pack.parents[0].cells, parent: features[0], neighbor: features[1],
    hit: { id: 'P', targetType: 'land', feature: features[0] } };
}
export const captureCells = state => ({ riverCellIds = [] } = {}) => ({ riverPaintOverrides:
  Object.fromEntries(riverCellIds.map(id => [id, state.riverPaint.overrides[id] ?? null])) });
