import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { packContourWaterMask } from '../js/core/renderer/paint_contour_water_mask.js';

const rect = (id, x0, y0, x1, y1) => ({ id, geometry: { type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
const options = { nearSeamTolerance: 0.05, waterMask: packContourWaterMask({ water: rect('water', 100, 50, 110, 60).geometry }) };

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

function grid(width, height) {
  const features = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const feature = rect(`g${x}:${y}`, x + (x % 4 === 0 ? 0.02 : 0), y, x + 1, y + 1);
    features.push(feature);
  }
  return features;
}

test('adding a parcel matches the full build', () => {
  const initial = grid(4, 3);
  const builder = createPaintContourGraphBuilder(options);
  builder.patch(initial);
  builder.finish();
  const added = rect('new', 4, 0, 5, 1);
  builder.patch([added]);
  const actual = builder.finish();
  const expectedBuilder = createPaintContourGraphBuilder(options);
  expectedBuilder.patch([...initial, added]);
  equivalent(actual, expectedBuilder.finish(), 'added feature');
});

test('removing enclosing land rechecks coasts inside its former filled area', () => {
  const features = grid(10, 5), enclosing = rect('enclosing', -1, -1, 11, 6);
  const builder = createPaintContourGraphBuilder(options);
  builder.patch([...features, enclosing]); builder.finish();
  builder.patch([], ['enclosing']);
  const actual = builder.finish(), full = createPaintContourGraphBuilder(options);
  full.patch(features); equivalent(actual, full.finish(), 'enclosing polygon removal');
});

test('mixed-precision patches along sloped source lines stay equivalent to full builds', () => {
  // Alternating triangles on both sides of sloped lines form source-collinear
  // groups; some are coarse, so quantized lines also widen the local finish.
  let seed = 1;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const round = value => Math.round(value * 1e4) / 1e4;
  const fillers = Array.from({ length: 60 }, (_, i) => rect(`f${i}`, 50 + i, 50, 50.5 + i, 50.5));
  for (let trial = 0; trial < 6; trial++) {
    const slope = 1 / (2 + random(5)), count = 4 + random(10);
    const point = k => [k * 0.1, 10 + k * 0.1 * slope];
    const make = (i, coarse) => {
      const k = Math.floor(i / 2), ring = [point(k), [k * 0.1 + 0.05, 10 + (i % 2 ? 1.5 : -1.5)], point(k + 1 + random(2))];
      return { id: `t${i}`, coordinatePrecision: coarse ? 4 : 7,
        geometry: { type: 'Polygon', coordinates: [[...(coarse ? ring.map(p => p.map(round)) : ring), coarse ? ring[0].map(round) : ring[0]]] } };
    };
    const features = Array.from({ length: count * 2 }, (_, i) => make(i, random(3) === 0));
    const builder = createPaintContourGraphBuilder({ nearSeamTolerance: 0 });
    builder.patch([...features, ...fillers]); builder.finish();
    for (let step = 0; step < 4; step++) {
      const k = random(features.length); features[k] = make(k, random(2) === 0);
      builder.patch([features[k]]);
      const actual = builder.finish(), full = createPaintContourGraphBuilder({ nearSeamTolerance: 0 });
      full.patch([...features, ...fillers]);
      equivalent(actual, full.finish(), `trial ${trial} step ${step}`);
    }
  }
});
