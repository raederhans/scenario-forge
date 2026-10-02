import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRiverInternalContourOwner } from '../js/core/river_paint/internal_contour_owner.js';
import { buildPaintContourGraph } from '../js/core/renderer/paint_contour_graph.js';
import { createPaintContourMesh } from '../js/core/renderer/paint_contour_mesh.js';
import { createPaintContourRuntime } from '../js/core/renderer/paint_contour_runtime.js';
import { composeContourFeatures, contourLengths } from '../tools/river_partitions/verify_contours.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/river_paint/overlapping_seams.json', import.meta.url), 'utf8'));
const length = meshes => meshes.reduce((sum, mesh) => sum + mesh.coordinates.reduce((total, line) =>
  total + line.slice(1).reduce((value, point, index) => value + Math.hypot(point[0] - line[index][0], point[1] - line[index][1]), 0), 0), 0);
function harness(initialPack = fixture.candidate) {
  const state = { activeScenarioId: 'modern_world', sceneGeneration: 1, colorRevision: 0, topologyRevision: 0,
    landData: { features: fixture.sourceFeatures } };
  let pack = initialPack, lookups = 0;
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
    getCellFeature: id => { lookups++; return features.get(id); }, resolveCellColor: id => ({ color: colors.get(id) }) });
  return { owner, state, features, colors, install, lookups: () => lookups };
}

test('local raw-cell graphs recover the complete real seams without changing global ambiguity diagnostics', async () => {
  const before = structuredClone(fixture);
  const globalGraph = buildPaintContourGraph(composeContourFeatures(fixture.sourceFeatures, fixture.candidate));
  const globalSeams = contourLengths(globalGraph, fixture.candidate).seams;
  const h = harness(); await h.owner.ensureReady();
  for (const parent of fixture.candidate.parents) {
    const actual = length(h.owner.getParentMeshes(parent.parentId));
    assert.ok(Math.abs(actual - fixture.candidateSeams[parent.parentId]) < 1e-9, `${parent.parentId}: ${actual}`);
    if (fixture.heldParentIds.includes(parent.parentId)) assert.ok(actual > globalSeams.get(parent.parentId) + 1e-4);
  }
  const diag = h.owner.diagnostics();
  assert.equal(diag.status, 'ready'); assert.equal(diag.readyParents, 10); assert.equal(diag.builds, 10);
  assert.ok(diag.parents.every(parent => parent.invalidRings === 0 && parent.ambiguousSegments === 0));
  assert.equal(globalGraph.diagnostics.ambiguousSegments, 26);
  assert.deepEqual(fixture, before);
});

test('same colors remove local lines and recolor reuses geometry, while revision reads do not scan cells', async () => {
  const h = harness(); await h.owner.ensureReady();
  const parent = fixture.candidate.parents.find(parent => parent.parentId === 'BY_INT_GOMEL');
  const builds = h.owner.diagnostics().builds, reads = h.lookups(), revision = h.owner.getRevision();
  for (let i = 0; i < 5; i++) assert.equal(h.owner.getRevision(), revision);
  assert.equal(h.lookups(), reads);
  for (const cell of parent.cells) h.colors.set(cell.id, '#123456');
  h.state.colorRevision++; assert.equal(h.owner.notifyPaintChanged(parent.cells.map(cell => cell.id)), true);
  assert.deepEqual(h.owner.getParentMeshes(parent.parentId), []);
  h.colors.set(parent.cells[0].id, '#654321'); h.state.colorRevision++;
  h.owner.notifyPaintChanged([parent.cells[0].id]);
  assert.ok(length(h.owner.getParentMeshes(parent.parentId)) > 0);
  assert.equal(h.owner.diagnostics().builds, builds);
});

test('global eligibility filters only same-parent arcs and full refresh rechecks unchanged colors', () => {
  const features = composeContourFeatures(fixture.sourceFeatures, fixture.candidate);
  const graph = buildPaintContourGraph(features), before = structuredClone(graph.diagnostics);
  const parentByCell = new Map(fixture.candidate.parents.flatMap(parent => parent.cells.map(cell => [cell.id, parent.parentId])));
  let allowInternal = true;
  const mesh = createPaintContourMesh(graph, id => `#${(features.findIndex(feature => feature.id === id) + 1).toString(16).padStart(6, '0')}`, {
    isArcEligible: (a, b) => allowInternal || !parentByCell.has(a) || parentByCell.get(a) !== parentByCell.get(b),
  });
  const all = mesh.getActiveArcCount();
  allowInternal = false; assert.equal(mesh.refresh(), true);
  const externalCount = [...graph.offsets].slice(0, -1).filter((_, arc) => {
    const a = graph.featureIds[graph.owners[arc * 2]], b = graph.featureIds[graph.owners[arc * 2 + 1]];
    return !parentByCell.has(a) || parentByCell.get(a) !== parentByCell.get(b);
  }).length;
  assert.equal(mesh.getActiveArcCount(), externalCount); assert.ok(externalCount < all);
  assert.deepEqual(graph.diagnostics, before);
  allowInternal = true; assert.equal(mesh.refresh(), true); assert.equal(mesh.getActiveArcCount(), all);
});

test('runtime boundary revision refreshes eligibility without a geometry build', async () => {
  const cells = fixture.candidate.parents[0].cells.map(cell => ({ id: cell.id, geometry: cell.geometry }));
  const state = { activeScenarioId: 'test', colorRevision: 0 };
  let eligible = true, boundary = 0, builds = 0;
  const runtime = createPaintContourRuntime({ state, getFeatures: () => cells, getFeatureId: feature => feature.id,
    resolveColor: feature => feature.id === cells[0].id ? '#111111' : '#222222', isArcEligible: () => eligible,
    getBoundaryRevision: () => boundary, client: { dispose() {}, async build(features) { builds++; return buildPaintContourGraph(features); } } });
  await runtime.ensureReady(); assert.equal(runtime.getMeshes().length, 1);
  eligible = false; boundary++; assert.deepEqual(runtime.getMeshes(), []);
  eligible = true; boundary++; assert.equal(runtime.getMeshes().length, 1); assert.equal(builds, 1);
  runtime.dispose();
});

test('scoped refresh reevaluates eligibility only for incident arcs', () => {
  const rect = (id, x) => ({ id, geometry: { type: 'Polygon', coordinates:
    [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] } });
  const graph = buildPaintContourGraph([rect('A', 0), rect('B', 1), rect('C', 2)]);
  const checked = []; let eligible = true;
  const mesh = createPaintContourMesh(graph, id => ({ A: '#111111', B: '#222222', C: '#333333' })[id], {
    isArcEligible: (a, b) => { checked.push([a, b].sort().join(':')); return eligible; },
  });
  assert.equal(mesh.getActiveArcCount(), 2);
  checked.length = 0; eligible = false;
  assert.equal(mesh.refresh(['A']), true);
  assert.deepEqual(checked, ['A:B']); assert.equal(mesh.getActiveArcCount(), 1);
  assert.equal(mesh.refresh(), true); assert.equal(mesh.getActiveArcCount(), 0);
});

test('source replacement withdraws meshes before validation and reuses unchanged canonical geometry', async () => {
  const h = harness(); await h.owner.ensureReady();
  const builds = h.owner.diagnostics().builds;
  h.state.landData = { features: [...fixture.sourceFeatures] };
  h.owner.getRevision(); assert.equal(h.owner.diagnostics().readyParents, 0);
  await h.owner.ensureReady(); assert.equal(h.owner.diagnostics().builds, builds);
  const parent = fixture.candidate.parents[0]; h.features.delete(parent.cells[0].id);
  h.state.landData = { features: [...fixture.sourceFeatures] };
  h.owner.getRevision(); assert.equal(h.owner.diagnostics().readyParents, 0);
  assert.deepEqual(h.owner.getParentMeshes(parent.parentId), []);
  await assert.rejects(h.owner.ensureReady(), /Missing or incompatible cell/);
});

test('pack replacement retains historical parents and never publishes removed-parent meshes', async () => {
  const h = harness(); await h.owner.ensureReady();
  const removed = fixture.heldParentIds[0]; assert.ok(h.owner.getParentMeshes(removed).length);
  h.install(fixture.baseline); h.owner.getRevision();
  assert.deepEqual(h.owner.getParentMeshes(removed), []);
  await h.owner.ensureReady();
  assert.equal(h.owner.diagnostics().readyParents, fixture.baseline.parents.length);
  for (const parent of fixture.baseline.parents) assert.ok(Math.abs(length(h.owner.getParentMeshes(parent.parentId))
    - fixture.baselineSeams[parent.parentId]) < 1e-9);
  h.install({ ...fixture.baseline, parents: [] }); await h.owner.ensureReady();
  assert.deepEqual(h.owner.getParentMeshes(fixture.baseline.parents[0].parentId), []);
});

test('missing or incompatible cells clear cached lines and export propagates readiness errors', async () => {
  const h = harness(); await h.owner.ensureReady();
  const parent = fixture.candidate.parents[0], cell = parent.cells[0], feature = h.features.get(cell.id);
  h.features.delete(cell.id);
  assert.deepEqual(h.owner.getParentMeshes(parent.parentId), []);
  assert.equal(h.owner.diagnostics().status, 'error');
  await assert.rejects(h.owner.ensureReady(), /Missing or incompatible cell/);
  h.features.set(cell.id, { ...feature, geometry: structuredClone(cell.geometry) });
  assert.deepEqual(h.owner.getParentMeshes(parent.parentId), []);
  await assert.rejects(h.owner.ensureReady(), /Missing or incompatible cell/);
  h.features.set(cell.id, { ...feature, properties: { ...feature.properties, __riverParentId: 'wrong' } });
  await assert.rejects(h.owner.ensureReady(), /Missing or incompatible cell/);
});

test('explicit invalid geometry publication cannot revive a previous mesh and export rejects bad rings', async () => {
  const pack = structuredClone(fixture.baseline), h = harness(pack);
  await h.owner.ensureReady();
  const parent = pack.parents[0]; assert.ok(h.owner.getParentMeshes(parent.parentId).length);
  const geometry = parent.cells[0].geometry;
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  ring.pop(); h.state.topologyRevision++;
  h.owner.getRevision(); assert.deepEqual(h.owner.getParentMeshes(parent.parentId), []);
  await assert.rejects(h.owner.ensureReady(), /Invalid cell rings/);
  assert.equal(h.owner.diagnostics().status, 'error');
  assert.ok(h.owner.diagnostics().parents.find(entry => entry.parentId === parent.parentId).invalidRings > 0);
  h.owner.dispose(); assert.deepEqual(h.owner.getParentMeshes(parent.parentId), []);
  await assert.rejects(h.owner.ensureReady(), /disposed/);
});
