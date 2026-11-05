import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { packContourWaterMask } from '../js/core/renderer/paint_contour_water_mask.js';

const rect = (id, x0, y0, x1, y1) => ({ id, geometry: { type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
const mask = water => packContourWaterMask({ water: rect('water', ...water).geometry });
const masks = [mask([100, 50, 110, 60]), mask([3.99, -1, 4.03, 12]), null];
const options = waterMask => ({ nearSeamTolerance: 0.05, waterMask });

function segments(graph, coast = false) {
  const packed = coast ? graph.coast : graph;
  if (!packed) return null;
  const result = [];
  for (let arc = 0; arc < packed.offsets.length - 1; arc++) {
    const pair = coast ? '' : [graph.featureIds[packed.owners[arc * 2]], graph.featureIds[packed.owners[arc * 2 + 1]]].sort().join(':');
    for (let p = packed.offsets[arc]; p < packed.offsets[arc + 1] - 1; p++) {
      const ends = [[packed.coordinates[p * 2], packed.coordinates[p * 2 + 1]],
        [packed.coordinates[p * 2 + 2], packed.coordinates[p * 2 + 3]]];
      result.push(`${pair}|${ends.map(JSON.stringify).sort().join('|')}`);
    }
  }
  return result.sort();
}

function equivalent(actual, expected, message) {
  for (const coast of [false, true]) {
    const a = segments(actual, coast), b = segments(expected, coast), label = `${message}: ${coast ? 'coast' : 'shared'}`;
    if (!a || !b) { assert.equal(a, b, label); continue; }
    assert.equal(a.length, b.length, `${label}: count`);
    for (let i = 0; i < a.length; i++) assert.equal(a[i], b[i], `${label}: segment ${i}`);
  }
}

function grid(width, height, divisions = 1) {
  const features = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const feature = rect(`g${x}:${y}`, x + (x % 4 === 0 ? 0.02 : 0), y, x + 1, y + 1);
    const ring = feature.geometry.coordinates[0], divided = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < divisions; j++) {
      divided.push(ring[i].map((value, axis) => value + (ring[i + 1][axis] - value) * j / divisions));
    }
    divided.push(divided[0]); feature.geometry.coordinates[0] = divided;
    features.push(feature);
  }
  return features;
}

function fixture() {
  const holed = rect('holed', 20, 0, 24, 4);
  holed.geometry.coordinates.push(rect('hole', 21, 1, 22, 2).geometry.coordinates[0]);
  return [...grid(12, 8), holed, rect('enclave', 21, 1, 22, 2),
    { id: 'islands', geometry: { type: 'MultiPolygon', coordinates: [
      rect('', 26, 0, 27, 1).geometry.coordinates, rect('', 30, 0, 31, 1).geometry.coordinates] } },
    rect('island-neighbor', 27.02, 0, 28, 1), rect('west', 179, 10, 180, 11),
    rect('east', -180, 10, -179, 11), rect('crossing', 179, 14, -179, 15)];
}

test('seeded patches and water changes remain equivalent to full builds', () => {
  let seed = 0x17a59c3;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const initial = fixture(), current = new Map(initial.map(feature => [feature.id, feature]));
  const history = [...current.keys()];
  let waterMask = masks[0], previous;
  const builder = createPaintContourGraphBuilder(options(waterMask));
  builder.patch(initial);
  for (let step = 0; step < 49; step++) {
    const dirty = new Set();
    let waterChanged = false, empty = false;
    const patch = (features = [], removed = []) => {
      for (const id of removed) { if (history.includes(id)) dirty.add(id); current.delete(id); }
      for (const feature of features) {
        dirty.add(feature.id);
        if (!history.includes(feature.id)) history.push(feature.id);
        current.set(feature.id, feature);
      }
      builder.patch(features, removed);
    };
    const changeWater = () => {
      waterMask = masks[Math.floor(step / 8) % masks.length];
      builder.setWaterMask(waterMask); waterChanged = true;
    };
    if (step) {
      const x = random(12), y = random(8), id = `g${x}:${y}`;
      switch (step % 8) {
        case 0: patch(); empty = true; break;
        case 1: patch([rect(id, x + 0.035, y, x + 1, y + 1)]); break;
        case 2: patch([], [id, 'islands', 'west']); break;
        case 3: patch([initial.find(f => f.id === 'islands'), rect('west', 179, 10, 180, 11),
          rect(`new${step}`, random(10) + 0.4, random(7) + 0.3, 13, 9)]); break;
        case 4: changeWater(); break;
        case 5: patch([rect(id, 35 + random(3), 5, 40, 7)]); break;
        case 6: patch([...current.values()].slice(0, 25)); break;
        case 7: patch([rect('holed', 19.5, 0, 24, 4)]); changeWater(); break;
      }
    }
    const actual = builder.finish();
    const expectedBuilder = createPaintContourGraphBuilder(options(waterMask));
    expectedBuilder.patch(history.filter(id => current.has(id)).map(id => current.get(id)));
    equivalent(actual, expectedBuilder.finish(), `step ${step}`);
    const incremental = step > 0 && (dirty.size === 0 || !waterChanged && dirty.size <= current.size * 0.2);
    assert.equal(actual.diagnostics.incremental, incremental, `step ${step}: path`);
    assert.equal(actual.diagnostics.incrementalFeatureCount, incremental ? dirty.size : 0);
    assert.deepEqual(actual.featureIds, history);
    if (empty) equivalent(actual, previous, `step ${step}: empty patch`);
    previous = actual;
  }
});

test('water-only finishes preserve geometry through repeated masks after local patches', () => {
  const features = fixture(), builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch(features); const initial = builder.finish();
  features[4] = rect(features[4].id, 4.04, 0, 5, 1);
  builder.patch([features[4]]); builder.finish();
  for (const waterMask of [masks[1], null, masks[0], masks[1], masks[0]]) {
    builder.setWaterMask(waterMask);
    const actual = builder.finish(), full = createPaintContourGraphBuilder(options(waterMask));
    full.patch(features);
    equivalent(actual, full.finish(), 'repeated water mask');
    assert.equal(actual.diagnostics.incremental, true);
  }
  const full = createPaintContourGraphBuilder(options(masks[0]));
  full.patch(fixture()); equivalent(initial, full.finish(), 'previous output remains immutable');
});

test('local patches retain third-owner blockers, mixed precision and distant collinear cuts', () => {
  const triangle = (id, points, corner) => ({ id, geometry: { type: 'Polygon', coordinates: [[...points, corner, points[0]]] } });
  const p = [10, 10], q = [11, 10 + 1 / 3], r = [12, 10 + 2 / 3], s = [10.5, 10 + 1 / 6];
  const initial = [...grid(10, 5), triangle('a', [p, q, r], [10, 14]), triangle('b', [r, s, p], [10, 6]),
    triangle('blocker', [[10.7, 10 + 0.7 / 3], [11.3, 10 + 1.3 / 3]], [11, 14]),
    { ...rect('coarse', 30, 0, 31, 2), coordinatePrecision: 4 }, rect('fine', 31.00002, 0, 32, 1),
    rect('near', 31.025, 1, 32, 2), rect('overlap-a', 35, 5, 40, 7), rect('overlap-b', 36, 5, 40, 7)];
  const current = new Map(initial.map(feature => [feature.id, feature])), history = [...current.keys()];
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch(initial); builder.finish();
  for (const [features, removed] of [
    [[], ['blocker']], [[initial.find(f => f.id === 'blocker')], []],
    [[rect('coarse', 30, 0, 31, 2)], []], [[initial.find(f => f.id === 'coarse')], []],
    [[rect('g0:4', 0.02, 4, 1, 5.5)], []], [[], ['overlap-b']],
  ]) {
    for (const id of removed) current.delete(id);
    for (const feature of features) current.set(feature.id, feature);
    builder.patch(features, removed);
    const actual = builder.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
    full.patch(history.filter(id => current.has(id)).map(id => current.get(id)));
    equivalent(actual, full.finish(), `patch ${features[0]?.id || removed[0]}`);
    assert.equal(actual.diagnostics.incremental, true);
  }
});

test('twenty percent is inclusive and dirty IDs count once across multiple patches', () => {
  const features = grid(5, 2), builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch(features); assert.equal(builder.finish().diagnostics.incremental, false);
  builder.patch(features.slice(0, 2)); builder.patch(features.slice(0, 2));
  const local = builder.finish();
  assert.equal(local.diagnostics.incremental, true);
  assert.equal(local.diagnostics.incrementalFeatureCount, 2);
  builder.patch(features.slice(0, 3)); assert.equal(builder.finish().diagnostics.incremental, false);
});

test('changing a distant coarse feature invalidates quantized fine coast intervals', () => {
  const coarse = { ...rect('coarse', 10, -1, 11, 0), coordinatePrecision: 4 };
  const fine = [rect('a', 0, 0.00001, 2, 1), rect('b', 1, 0.00002, 3, 1),
    ...Array.from({ length: 12 }, (_, i) => rect(`f${i}`, 20 + i, 20, 21 + i, 21))];
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch([...fine, coarse]); builder.finish();
  for (const next of [null, coarse, { ...coarse, coordinatePrecision: 7 }]) {
    builder.patch(next ? [next] : [], next ? [] : ['coarse']);
    const actual = builder.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
    full.patch(next ? [...fine, next] : fine);
    equivalent(actual, full.finish(), 'global quantization dependency');
    assert.equal(actual.diagnostics.incremental, true);
  }
});

test('batch coarse-to-fine replacements below twenty percent stay incremental', () => {
  const features = grid(20, 10, 2);
  for (const feature of features.slice(0, 18)) feature.coordinatePrecision = 4;
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch(features); builder.finish();
  for (let run = 0; run < 3; run++) {
    for (let i = 0; i < 18; i++) features[i] = {
      ...rect(features[i].id, i + (i % 4 === 0 ? 0.02002 : 0), 0, i + 1, 1),
      coordinatePrecision: run === 1 ? 4 : 7,
    };
    builder.patch(features.slice(0, 18));
    const actual = builder.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
    full.patch(features);
    equivalent(actual, full.finish(), `batch precision replacement ${run}`);
    assert.equal(actual.diagnostics.incremental, true);
    assert.equal(actual.diagnostics.incrementalFeatureCount, 18);
  }
});

test('quantized dependencies follow distant fine edits and coarse activation', () => {
  const coarse = { ...rect('coarse', 10, -1, 11, 0), coordinatePrecision: 4 };
  const features = [rect('a', 0, 0.00001, 2, 1), rect('b', 1, 0.00002, 3, 1), coarse,
    ...grid(10, 5).map((feature, i) => rect(feature.id, 20 + i * 0.137, 20.071, 20.099 + i * 0.137, 20.173))];
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch(features); builder.finish();
  for (const [index, next] of [[0, rect('a', 0.2, 0.00001, 2.2, 1)], [2, { ...coarse, coordinatePrecision: 7 }],
    [2, coarse], [1, rect('b', 0.5, 0.00003, 2.5, 1)]]) {
    features[index] = next; builder.patch([next]);
    const actual = builder.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
    full.patch(features); equivalent(actual, full.finish(), 'distant quantized dependency update');
    assert.equal(actual.diagnostics.incremental, true);
  }
});

test('seeded mixed-precision patches preserve cached source geometry', () => {
  const features = fixture(), builder = createPaintContourGraphBuilder(options(masks[0]));
  let seed = 0x31774d;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  builder.patch(features); builder.finish();
  for (let step = 0; step < 40; step++) {
    const changed = [];
    for (let j = 0; j < 7; j++) {
      const index = random(96), x = index % 12, y = Math.floor(index / 12);
      features[index] = { ...rect(features[index].id, x + (x % 4 === 0 ? 0.02002 : 0), y,
        x + 1, y + 1 + (step % 3 === 0 ? 0.00002 : 0)), coordinatePrecision: step % 2 ? 4 : 7 };
      changed.push(features[index]);
    }
    builder.patch(changed);
    const actual = builder.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
    full.patch(features); equivalent(actual, full.finish(), `mixed precision step ${step}`);
    assert.equal(actual.diagnostics.incremental, true);
  }
});

test('source replacement with altitude retains two-dimensional edge coordinates', () => {
  const a = rect('a', 0, 0, 1 + 2e-8, 1), b = rect('b', 1, 0, 2, 1);
  for (const feature of [a, b]) for (const point of feature.geometry.coordinates[0]) point.push(123);
  const filler = Array.from({ length: 12 }, (_, i) => rect(`f${i}`, 20 + i, 20, 21 + i, 21));
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch([a, b, ...filler]); builder.finish();
  builder.patch([], ['a']);
  const actual = builder.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
  full.patch([b, ...filler]);
  equivalent(actual, full.finish(), 'altitude source removal');
  assert.equal(actual.diagnostics.incremental, true);
});

test('empty finishes repack cached chains after previous output buffers are transferred', () => {
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch(fixture()); const first = builder.finish();
  const expected = structuredClone(first);
  structuredClone(first, { transfer: [first.coordinates.buffer, first.offsets.buffer, first.owners.buffer,
    first.coast.coordinates.buffer, first.coast.offsets.buffer, first.coast.arcs.buffer] });
  for (let i = 0; i < 3; i++) {
    const actual = builder.finish();
    equivalent(actual, expected, 'empty finish after transfer');
    assert.equal(actual.diagnostics.incremental, true);
    assert.equal(actual.diagnostics.incrementalSubsetFeatureCount, 0);
    assert.equal(actual.diagnostics.incrementalSubsetEdgeCount, 0);
  }
});

test('distant polygon components do not expand a local patch to the entire grid', () => {
  const features = grid(40, 20, 2);
  features.push({ id: 'wide', geometry: { type: 'MultiPolygon', coordinates: [
    rect('', -2, -2, -1, -1).geometry.coordinates, rect('', 41, 21, 42, 22).geometry.coordinates] } });
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch(features); builder.finish();
  features[0] = rect(features[0].id, 0.03, 0, 1, 1);
  builder.patch([features[0]]);
  const actual = builder.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
  full.patch(features); equivalent(actual, full.finish(), 'distant components');
  assert.ok(actual.diagnostics.incrementalSubsetFeatureCount < features.length / 2);
  assert.ok(actual.diagnostics.incrementalSubsetEdgeCount < actual.diagnostics.segmentCount / 2);
  builder.setWaterMask(masks[1]); full.setWaterMask(masks[1]);
  equivalent(builder.finish(), full.finish(), 'water change after narrow neighborhood');
});

test('removing enclosing land rechecks coasts inside its former filled area', () => {
  const features = grid(10, 5), enclosing = rect('enclosing', -1, -1, 11, 6);
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch([...features, enclosing]); builder.finish();
  builder.patch([], ['enclosing']);
  const actual = builder.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
  full.patch(features); equivalent(actual, full.finish(), 'enclosing polygon removal');
  assert.equal(actual.diagnostics.incremental, true);
});

test('80 by 40 grid measures incremental and water-only finish costs', t => {
  const features = grid(80, 40, 8), samples = { full: [], incremental: [], water: [] };
  const time = (name, action) => {
    const start = performance.now(), result = action();
    samples[name].push(performance.now() - start); return result;
  };
  for (let run = 0; run < 4; run++) {
    const builder = createPaintContourGraphBuilder(options(masks[0]));
    builder.patch(features); builder.finish();
    const changed = features.slice(0, 32).map((feature, i) => rect(feature.id, i + 0.03, 0, i + 1, 1));
    builder.patch(changed);
    const local = time('incremental', () => builder.finish());
    const full = createPaintContourGraphBuilder(options(masks[0]));
    full.patch([...changed, ...features.slice(32)]);
    equivalent(local, time('full', () => full.finish()), 'benchmark patch');
    const waterMask = mask([90, 50, 100, 60]);
    builder.setWaterMask(waterMask);
    const water = time('water', () => builder.finish());
    equivalent(water, local, 'benchmark water mask outside grid');
    assert.equal(local.diagnostics.incremental, true);
    assert.equal(water.diagnostics.incremental, true);
  }
  const median = values => values.slice(1).sort((a, b) => a - b)[1];
  const full = median(samples.full), incremental = median(samples.incremental), water = median(samples.water);
  t.diagnostic(`3200 features, 1% patch: full=${full.toFixed(2)}ms incremental=${incremental.toFixed(2)}ms (${(100 * incremental / full).toFixed(1)}%); water=${water.toFixed(2)}ms (${(100 * water / full).toFixed(1)}%)`);
});

test('9600 feature grid reports 60 and 600 feature neighborhoods', t => {
  const features = grid(120, 80, 32);
  features.push({ id: 'wide-islands', geometry: { type: 'MultiPolygon', coordinates: [
    rect('', -2, -2, -1, -1).geometry.coordinates, rect('', 121, 81, 122, 82).geometry.coordinates] } });
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  let start = performance.now(); builder.patch(features);
  t.diagnostic(`initial patch ${(performance.now() - start).toFixed(2)}ms`);
  start = performance.now(); builder.finish();
  t.diagnostic(`initial finish ${(performance.now() - start).toFixed(2)}ms`);
  for (const count of [60, 600]) {
    const changed = features.slice(0, count).map((feature, index) => rect(feature.id,
      index % 120 + 0.03, Math.floor(index / 120), index % 120 + 1, Math.floor(index / 120) + 1));
    builder.patch(changed);
    start = performance.now(); const graph = builder.finish(), elapsed = performance.now() - start;
    const d = graph.diagnostics;
    t.diagnostic(`patch ${count}: finish=${elapsed.toFixed(2)}ms subset=${d.incrementalSubsetFeatureCount} features/${d.incrementalSubsetEdgeCount} edges neighbors=${d.incrementalNeighborMs.toFixed(2)}ms coastPack=${d.incrementalCoastPackMs.toFixed(2)}ms`);
    assert.equal(d.incremental, true);
  }
});

test('9600 feature grid measures 859 coarse-to-fine replacements', t => {
  const features = grid(120, 80, 32);
  const coarse = features.slice(0, 859).map(feature => ({ ...feature, coordinatePrecision: 4,
    geometry: { type: 'Polygon', coordinates: feature.geometry.coordinates.map(ring => ring.map(point =>
      point.map(value => Math.round(value * 1e4) / 1e4))) } }));
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch([...coarse, ...features.slice(859)]); builder.finish();
  builder.patch(features.slice(0, 859));
  const start = performance.now(), graph = builder.finish(), elapsed = performance.now() - start;
  const d = graph.diagnostics;
  t.diagnostic(`859 coarse-to-fine: finish=${elapsed.toFixed(2)}ms subset=${d.incrementalSubsetFeatureCount} features/${d.incrementalSubsetEdgeCount} edges neighbors=${d.incrementalNeighborMs.toFixed(2)}ms coastPack=${d.incrementalCoastPackMs.toFixed(2)}ms`);
  assert.equal(d.incremental, true);
  assert.equal(d.incrementalFeatureCount, 859);
});

test('sub-1e-7 source differences at one vertex do not depend on edge insertion order', () => {
  const polygon = (id, ring) => ({ id, geometry: { type: 'Polygon', coordinates: [ring] } });
  // Both sides of y=0 snap the vertex near x=1 to one identity, from two Float64 inputs.
  const above = polygon('above', [[0, 0], [1, 0], [2, 0], [2, 1], [0, 1], [0, 0]]);
  const below = polygon('below', [[0, 0], [0, -1], [2, -1], [2, 0], [1.000000003, 0], [0.5, 0], [0, 0]]);
  const fillers = Array.from({ length: 12 }, (_, i) => rect(`f${i}`, 20 + i, 20, 21 + i, 21));
  const builder = createPaintContourGraphBuilder(options(masks[0]));
  builder.patch([above, below, ...fillers]); builder.finish();
  for (const changed of [[above], [below], [above]]) {
    builder.patch(changed);
    const actual = builder.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
    full.patch([above, below, ...fillers]);
    equivalent(actual, full.finish(), `re-added ${changed[0].id}`);
    assert.equal(actual.diagnostics.incremental, true);
  }
});

test('a coarse feature elsewhere leaves unrelated fine coasts at their exact source coordinates', () => {
  // Edges that straddle zero are where a + (b - a) differs from b in Float64.
  const triangle = (y) => ({ id: 't', geometry: { type: 'Polygon', coordinates: [[[-0.1, -0.3], [0.3, -0.1], [0.2, y], [-0.1, -0.3]]] } });
  const coarse = { ...rect('coarse', 10, -1, 11, 0), coordinatePrecision: 4 };
  const fillers = Array.from({ length: 12 }, (_, i) => rect(`f${i}`, 20 + i, 20, 21 + i, 21));
  const alone = createPaintContourGraphBuilder(options(masks[0]));
  alone.patch([triangle(0.3), ...fillers]);
  const withCoarse = createPaintContourGraphBuilder(options(masks[0]));
  withCoarse.patch([coarse, triangle(0.3), ...fillers]);
  const points = graph => new Set(segments(graph, true).flatMap(segment => segment.split('|').slice(1)));
  const exact = points(alone.finish()), mixed = points(withCoarse.finish());
  for (const point of ['[0.2,0.3]', '[0.3,-0.1]']) {
    assert.ok(exact.has(point) && mixed.has(point), `exact source vertex ${point}`);
  }
  withCoarse.patch([triangle(0.31)]);
  const actual = withCoarse.finish(), full = createPaintContourGraphBuilder(options(masks[0]));
  full.patch([coarse, triangle(0.31), ...fillers]);
  equivalent(actual, full.finish(), 'local fine patch beside a distant coarse feature');
  assert.equal(actual.diagnostics.incremental, true);
});
