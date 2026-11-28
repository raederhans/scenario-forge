import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRiverInternalContourOwner } from '../js/core/river_paint/internal_contour_owner.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/river_paint/overlapping_seams.json', import.meta.url), 'utf8'));
const length = meshes => meshes.reduce((sum, mesh) => sum + mesh.coordinates.reduce((total, line) =>
  total + line.slice(1).reduce((value, point, index) => value + Math.hypot(point[0] - line[index][0], point[1] - line[index][1]), 0), 0), 0);
function harness(initialPack = fixture.candidate) {
  const state = { activeScenarioId: 'modern_world', sceneGeneration: 1, colorRevision: 0, topologyRevision: 0,
    landData: { features: fixture.sourceFeatures } };
  let pack = initialPack;
  const features = new Map(), colors = new Map();
  function install(next) {
    pack = next; features.clear(); colors.clear();
    let index = 0;
    for (const parent of pack.parents) for (const cell of parent.cells) {
      features.set(cell.id, { id: cell.id, properties: { id: cell.id, __riverParentId: parent.parentId }, geometry: cell.geometry });
      colors.set(cell.id, `#${(++index).toString(16).padStart(6, '0')}`);
    }
  }
  install(pack);
  const owner = createRiverInternalContourOwner({ state, getActivePack: () => pack,
    getCellFeature: id => features.get(id), resolveCellColor: id => ({ color: colors.get(id) }) });
  return { owner, state, colors, install };
}

test('local raw-cell graphs recover the complete real seams', async () => {
  const h = harness(); await h.owner.ensureReady();
  for (const parent of fixture.candidate.parents) {
    const actual = length(h.owner.getParentMeshes(parent.parentId));
    assert.ok(Math.abs(actual - fixture.candidateSeams[parent.parentId]) < 1e-9, `${parent.parentId}: ${actual}`);
  }
});

test('same colors remove local lines', async () => {
  const h = harness(); await h.owner.ensureReady();
  const parent = fixture.candidate.parents.find(parent => parent.parentId === 'BY_INT_GOMEL');
  for (const cell of parent.cells) h.colors.set(cell.id, '#123456');
  h.state.colorRevision++; assert.equal(h.owner.notifyPaintChanged(parent.cells.map(cell => cell.id)), true);
  assert.deepEqual(h.owner.getParentMeshes(parent.parentId), []);
});

test('pack replacement withdraws removed-parent meshes', async () => {
  const h = harness(); await h.owner.ensureReady();
  const removed = fixture.heldParentIds[0]; assert.ok(h.owner.getParentMeshes(removed).length);
  h.install(fixture.baseline); h.owner.getRevision();
  assert.deepEqual(h.owner.getParentMeshes(removed), []);
  await h.owner.ensureReady();
});
