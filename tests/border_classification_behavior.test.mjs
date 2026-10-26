import test from 'node:test';
import assert from 'node:assert/strict';
import { createBorderClassification } from '../js/core/renderer/border_classification.js';
import { createBorderIdentityResolver } from '../js/core/renderer/border_identity.js';
import { getPackedLineMesh } from '../js/core/renderer/packed_line_mesh.js';

const graph = {
  featureIds: ['a', 'b', 'c', 'd', 'e', 'f'],
  owners: Uint32Array.from([0, 1, 1, 2, 0, 3, 3, 4, 4, 5, 5, 0xffffffff]),
  offsets: Uint32Array.from([0, 2, 4, 6, 8, 10, 12]),
  coordinates: Float64Array.from(Array.from({ length: 24 }, (_, index) => index)),
};
const arcs = mesh => mesh ? [...getPackedLineMesh(mesh).arcs].sort((a, b) => a - b) : [];
function snapshot(view) {
  return Object.fromEntries(Object.entries(view.getMeshes()).map(([key, value]) => [key,
    value instanceof Map ? [...value].map(([tag, mesh]) => [tag, arcs(mesh)]).sort() : value.flatMap(arcs)]));
}
function fixture(options) {
  const palette = { AAA: '#000001', BBB: '#000002' }, overrides = {};
  const owners = { a: 'AAA', b: 'BBB', c: 'BBB', d: 'AAA', e: 'AAA', f: 'AAA' };
  const parents = { a: 'x', b: '', c: '', d: 'y', e: 'y', f: 'y' };
  const provinces = { a: 'p', b: 'q', c: 'q', d: 'p', e: 'q', f: 'q' };
  const resolveIdentity = createBorderIdentityResolver({ sovereignBaseColors: palette,
    getReferenceOwner: id => owners[id], getOverrideColor: id => overrides[id] });
  const calls = [];
  const resolve = id => { calls.push(id); return { borderKey: resolveIdentity(id), parentKey: parents[id],
    provinceKey: provinces[id], color: overrides[id] || palette[owners[id]] }; };
  return { view: createBorderClassification(graph, resolve, options), resolve, calls, overrides, parents, provinces };
}

test('repainting moves the country border and exposes the acquired province boundary', () => {
  const h = fixture();
  assert.deepEqual(snapshot(h.view), { country: [0], parent: [['AAA', [2]]],
    province: [['AAA', [3]]], local: [['AAA', [4]], ['BBB', [1]]], paint: [] });
  h.overrides.b = '#000001'; h.calls.length = 0;
  assert.equal(h.view.refresh(['b']), true);
  assert.deepEqual(h.calls, ['b']);
  assert.deepEqual(snapshot(h.view), { country: [1], parent: [['AAA', [2]]],
    province: [['AAA', [0, 3]]], local: [['AAA', [4]]], paint: [] });
  assert.deepEqual(snapshot(h.view), snapshot(createBorderClassification(graph, h.resolve)));
  h.provinces.b = 'p'; h.view.refresh(['b']);
  assert.deepEqual(arcs(h.view.getMeshes().local.get('AAA')), [0, 4]);
  assert.deepEqual(snapshot(h.view), snapshot(createBorderClassification(graph, h.resolve)));
});

test('parent and province may overlap, paint overlaps internal layers, and empty keys omit countries', () => {
  const values = Object.fromEntries(graph.featureIds.map(id => [id,
    { borderKey: 'AAA', parentKey: 'x', provinceKey: 'p', color: '#000001' }]));
  values.b = { borderKey: 'AAA', parentKey: 'y', provinceKey: 'q', color: '#000002' };
  values.c.borderKey = '';
  const view = createBorderClassification(graph, id => values[id]);
  assert.deepEqual(arcs(view.getMeshes().parent.get('AAA')), [0]);
  assert.deepEqual(arcs(view.getMeshes().province.get('AAA')), [0]);
  assert.deepEqual(view.getMeshes().paint.flatMap(arcs), [0]);
  assert.deepEqual(arcs(view.getMeshes().local.get('AAA')), [2, 3, 4]);
  assert.deepEqual(view.getMeshes().country, []);
});

test('arc eligibility applies to every category and full refresh updates grouping', () => {
  const h = fixture({ isArcEligible: (a, b) => a !== 'a' && b !== 'a' });
  assert.deepEqual(snapshot(h.view), { country: [], parent: [], province: [['AAA', [3]]],
    local: [['AAA', [4]], ['BBB', [1]]], paint: [] });
  h.parents.e = 'z';
  h.view.refresh();
  assert.deepEqual(arcs(h.view.getMeshes().parent.get('AAA')), [3, 4]);
  assert.equal(h.view.getMeshes().local.has('AAA'), false);
});
