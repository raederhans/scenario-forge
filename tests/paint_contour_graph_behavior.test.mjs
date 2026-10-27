import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildPaintContourGraph, createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { createPaintContourMesh } from '../js/core/renderer/paint_contour_mesh.js';

// Exercise the two internal numerical primitives without widening the public API.
let scalarInternals;
function readScalarInternals() {
  return scalarInternals ||= readFile(new URL('../js/core/renderer/paint_contour_graph.js', import.meta.url), 'utf8')
    .then(source => import(`data:text/javascript;base64,${Buffer.from(`${source.replace('./paint_contour_water_mask.js', new URL('../js/core/renderer/paint_contour_water_mask.js', import.meta.url).href)}\nexport { createCompactEdges, sourceEdgeQuery, sourceCollinear };`).toString('base64')}`));
}

function legacySourceEdgeQuery(edges, occupied) {
  const ordered = [...edges.values(), ...occupied.filter(edge => !edge.key)]
    .filter(edge => Math.abs(edge.b[0] - edge.a[0]) <= 180 * 1e7);
  const ordinal = new Map(ordered.map((edge, index) => [edge, index]));
  ordered.sort((a, b) => a.a[0] - b.a[0] || ordinal.get(a) - ordinal.get(b));
  let size = 1; while (size < ordered.length) size *= 2;
  const maxima = new Float64Array(size * 2).fill(-Infinity);
  ordered.forEach((edge, index) => { maxima[size + index] = edge.b[0]; });
  for (let index = size - 1; index > 0; index -= 1) maxima[index] = Math.max(maxima[index * 2], maxima[index * 2 + 1]);
  return (x0, y0, x1, y1) => {
    const result = [];
    function visit(node, lo, hi) {
      if (lo >= ordered.length || ordered[lo].a[0] > x1 || maxima[node] < x0) return;
      if (hi - lo === 1) {
        const edge = ordered[lo];
        if (Math.min(edge.a[1], edge.b[1]) <= y1 && Math.max(edge.a[1], edge.b[1]) >= y0) result.push(edge);
        return;
      }
      const mid = (lo + hi) >>> 1;
      visit(node * 2, lo, mid); visit(node * 2 + 1, mid, hi);
    }
    visit(1, 0, size);
    return result;
  };
}

const polygon = (id, rings) => ({ id, geometry: { type: 'Polygon', coordinates: rings } });
const rect = (id, x0, y0, x1, y1) => polygon(id, [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]);
function segments(graph) {
  const result = [];
  for (let i=0; i<graph.offsets.length-1; i++) {
    const pair = [graph.featureIds[graph.owners[i*2]],graph.featureIds[graph.owners[i*2+1]]].sort().join(':');
    for (let j=graph.offsets[i]; j<graph.offsets[i+1]-1; j++) {
      const ends = [[graph.coordinates[j*2],graph.coordinates[j*2+1]],[graph.coordinates[j*2+2],graph.coordinates[j*2+3]]];
      result.push(`${pair}|${ends.map(JSON.stringify).sort().join('|')}`);
    }
  }
  return result.sort();
}

test('only shared boundaries between unequal persistent colors are active', () => {
  const graph=buildPaintContourGraph([rect('A',0,0,1,1),rect('B',1,0,2,1),rect('C',8,8,9,9)]);
  assert.equal(graph.diagnostics.arcCount,1);
  const colors={A:'#ff0000',B:'#FF0000',C:'#00ff00'};
  const view=createPaintContourMesh(graph,id=>colors[id]);
  assert.equal(view.getActiveArcCount(),0);
  colors.B='#000000'; assert.equal(view.refresh(['B']),true);
  assert.deepEqual(view.getMesh().coordinates,[[[1,0],[1,1]]]);
  const before=view.getMesh(); colors.B='#000001';
  assert.equal(view.refresh(['B']),false); assert.equal(view.getMesh(),before);
  colors.A='#000001'; view.refresh(['A']); assert.equal(view.getActiveArcCount(),0);
  colors.A='#ff0000'; view.refresh(['A']); assert.equal(view.getActiveArcCount(),1);
});

test('political separation keeps only unequal-color arcs between features with the same known owner', () => {
  const graph = buildPaintContourGraph([rect('A',0,0,1,1),rect('B',1,0,2,1)]);
  const colors = { A:'#111111', B:'#111111' };
  const owners = { A:'RED', B:'BLUE' };
  let separated = false;
  const view = createPaintContourMesh(graph, id => colors[id], {
    resolveBoundaryKey: id => owners[id],
    separatePoliticalBorders: () => separated,
  });
  assert.equal(view.getActiveArcCount(), 0);
  colors.B = '#222222';
  assert.equal(view.refresh(['B']), true);
  assert.equal(view.getActiveArcCount(), 1);
  separated = true; assert.equal(view.refresh(), true);
  assert.equal(view.getActiveArcCount(), 0);
  owners.B = 'RED'; assert.equal(view.refresh(['B']), true);
  assert.equal(view.getActiveArcCount(), 1);
  colors.B = colors.A;
  assert.equal(view.refresh(['B']), true);
  assert.equal(view.getActiveArcCount(), 0);
  owners.B = 'BLUE';
  assert.equal(view.refresh(['B']), false);
  assert.equal(view.getActiveArcCount(), 0);
  colors.B = '#222222';
  assert.equal(view.refresh(['B']), false);
  assert.equal(view.getActiveArcCount(), 0);
  owners.B = '';
  assert.equal(view.refresh(['B']), false);
  assert.equal(view.getActiveArcCount(), 0);
  separated = false; view.refresh();
  assert.equal(view.getActiveArcCount(), 1);
  colors.B = colors.A;
  view.refresh(['B']);
  assert.equal(view.getActiveArcCount(), 0);
});

test('cross-source arcs with unequal collinear segmentation are noded once', () => {
  const a=rect('A',0,0,1,2);
  const b=polygon('B',[[[1,0],[2,0],[2,2],[1,2],[1,1],[1,0]]]);
  const builder=createPaintContourGraphBuilder();
  builder.patch([a]); builder.patch([b]);
  const graph=builder.finish();
  assert.equal(graph.diagnostics.nodedSharedSegments,2);
  assert.equal(graph.diagnostics.arcCount,1);
  assert.deepEqual(segments(graph),['A:B|[1,0]|[1,1]','A:B|[1,1]|[1,2]']);
});

test('points merely near another edge are never snapped together beyond declared precision', () => {
  const graph=buildPaintContourGraph([rect('A',0,0,1,1),rect('B',1.00001,0,2,1)]);
  assert.equal(graph.diagnostics.arcCount,0);
});

test('floating coordinate representations join but original coordinates are retained', () => {
  const a=rect('A',0,0,1+1e-10,1),b=rect('B',1,0,2,1);
  const before=JSON.stringify([a,b]); const graph=buildPaintContourGraph([a,b]);
  assert.equal(graph.diagnostics.arcCount,1);
  assert.equal(graph.coordinates[0],1+1e-10);
  assert.equal(JSON.stringify([a,b]),before);
});

test('holes and enclaves match regardless of polygon ring winding', () => {
  const outer=rect('A',0,0,3,3); const hole=rect('B',1,1,2,2);
  outer.geometry.coordinates.push([...hole.geometry.coordinates[0]].reverse());
  const graph=buildPaintContourGraph([outer,hole]);
  assert.equal(graph.diagnostics.arcCount,1); assert.equal(graph.diagnostics.exactSharedSegments,4);
  outer.geometry.coordinates.forEach(ring=>ring.reverse()); hole.geometry.coordinates[0].reverse();
  assert.deepEqual(segments(buildPaintContourGraph([outer,hole])),segments(graph));
});

test('date-line aliases produce one shared arc without drawing a world-spanning chord', () => {
  const graph=buildPaintContourGraph([rect('west',179,0,180,1),rect('east',-180,0,-179,1)]);
  assert.equal(graph.diagnostics.arcCount,1);
  assert.equal(Math.abs(graph.coordinates[0]),180);
  assert.equal(graph.coordinates[0],graph.coordinates[2]);
});

test('touching corners and repeated overlapping polygons do not invent interior borders', () => {
  assert.equal(buildPaintContourGraph([rect('A',0,0,1,1),rect('B',1,1,2,2)]).diagnostics.arcCount,0);
  const graph=buildPaintContourGraph([rect('A',0,0,1,1),rect('B',0,0,1,1)]);
  assert.equal(graph.diagnostics.arcCount,0); assert.equal(graph.diagnostics.ambiguousSegments,4);
});

test('supplementary MultiPolygon island geometry contributes its shared border', () => {
  const island={id:'island',geometry:{type:'MultiPolygon',coordinates:[rect('',8,0,9,1).geometry.coordinates,rect('',20,0,21,1).geometry.coordinates]}};
  const graph=buildPaintContourGraph([rect('main',0,0,1,1),rect('neighbor',9,0,10,1),island]);
  assert.equal(graph.diagnostics.featureCount,3);
  assert.deepEqual(segments(graph),['island:neighbor|[9,0]|[9,1]']);
});

test('patch replacement/removal equals rebuilding the current composed source', () => {
  const a=rect('A',0,0,1,1),b=rect('B',1,0,2,1),c=rect('C',2,0,3,1);
  const builder=createPaintContourGraphBuilder(); builder.patch([a,b,c]);
  const replacement=rect('B',1,0,2,2);
  builder.patch([replacement],['C']);
  assert.deepEqual(segments(builder.finish()),segments(buildPaintContourGraph([a,replacement])));
  builder.patch([],['B']); assert.equal(builder.finish().diagnostics.arcCount,0);
  builder.patch([b,c]); assert.deepEqual(segments(builder.finish()),segments(buildPaintContourGraph([a,b,c])));
});

test('open rings are diagnosed and follow the actual d3 streamed fill surface', () => {
  const broken=polygon('bad',[[[0,0],[1,0],[1,1],[0,1]]]);
  const graph=buildPaintContourGraph([broken,rect('A',1,0,2,1)]);
  assert.equal(graph.diagnostics.invalidRings,1);assert.equal(graph.diagnostics.arcCount,1);
  assert.deepEqual(segments(graph), ['A:bad|[1,0]|[1,1]']);
});

test('palette or undo refresh changes only the active set, never the packed graph', () => {
  const graph=buildPaintContourGraph([rect('A',0,0,1,1),rect('B',1,0,2,1),rect('C',2,0,3,1)]);
  const bytes=Buffer.from(graph.coordinates.buffer).toString('hex');
  const colors={A:'#010101',B:'#020202',C:'#030303'};
  const view=createPaintContourMesh(graph,id=>colors[id]);assert.equal(view.getActiveArcCount(),2);
  colors.B=colors.A; view.refresh();assert.equal(view.getActiveArcCount(),1);
  colors.B='#020202';view.refresh(['B']);assert.equal(view.getActiveArcCount(),2);
  assert.equal(Buffer.from(graph.coordinates.buffer).toString('hex'),bytes);
});

test('declared coarse quantization repairs coarse/fine seams without merging fine/fine gaps', () => {
  const coarse = {...rect('A',0,0,1,1), coordinatePrecision:4};
  const fine = rect('B',1.00002,0.00002,2,1.00002);
  const g=buildPaintContourGraph([coarse,fine]);
  assert.equal(g.diagnostics.quantizedSharedSegments,1);
  assert.deepEqual(segments(g), ['A:B|[1,0]|[1,1]']);
  assert.equal(buildPaintContourGraph([rect('A',0,0,1,1),fine]).diagnostics.arcCount,0);
  assert.equal(buildPaintContourGraph([coarse,rect('B',1.00006,0,2,1)]).diagnostics.arcCount,0);
  assert.equal(buildPaintContourGraph([coarse, fine, {...fine,id:'C'}]).diagnostics.arcCount,0);
});

test('mixed LOD partial intervals node once and replacing coarse precision removes the join', () => {
  const a={...rect('A',0,0,1,2),coordinatePrecision:4};
  const b=polygon('B',[[[1.00002,0],[2,0],[2,2],[1.00002,2],[1.00002,1],[1.00002,0]]]);
  const builder=createPaintContourGraphBuilder();builder.patch([a,b]);
  assert.equal(builder.finish().diagnostics.quantizedSharedSegments,2);
  builder.patch([{...a,coordinatePrecision:7}]);assert.equal(builder.finish().diagnostics.arcCount,0);
});

test('partially exact seams retain the unmatched interval for coarse/fine reconciliation', () => {
  const a={...rect('A',0,0,1,2),coordinatePrecision:4};
  const b=polygon('B',[[[1,0],[2,0],[2,2],[1.00002,2],[1.00002,1],[1,1],[1,0]]]);
  const g=buildPaintContourGraph([a,b]);
  assert.equal(g.diagnostics.nodedSharedSegments,1);
  assert.equal(g.diagnostics.quantizedSharedSegments,1);
  assert.deepEqual(segments(g),['A:B|[1,0]|[1,1]','A:B|[1,1]|[1,2]']);
});

function compactFixture() {
  const features = [];
  for (let row = 0; row < 12; row++) for (let column = 0; column < 16; column++) {
    const x = -160 + column, y = -70 + row, ring = [], drift = column % 3 === 0 ? 1e-10 : 0;
    for (let step = 0; step < 8; step++) ring.push([x + step / 8 + drift, y]);
    for (let step = 0; step < 8; step++) ring.push([x + 1 + drift, y + step / 8]);
    for (let step = 0; step < 8; step++) ring.push([x + 1 - step / 8 + drift, y + 1]);
    for (let step = 0; step < 8; step++) ring.push([x + drift, y + 1 - step / 8]);
    ring.push(ring[0]); if ((row + column) % 2) ring.reverse();
    features.push({ ...polygon(`r${row}c${column}`, [ring]), coordinatePrecision: column % 3 ? 7 : 4 });
  }
  return features;
}

function graphBytes(graph) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([graph.featureIds, Object.fromEntries(Object.entries(graph.diagnostics).filter(([key]) => !key.startsWith('nearSeam')))]));
  for (const value of [graph.coordinates, graph.offsets, graph.owners]) hash.update(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  return hash.digest('hex');
}

test('signed world strips with split boundaries retain exact packed graph bytes', () => {
  const split = (id, x0, x1) => polygon(id, [[[x0, -1], [x1, -1], [x1, 1], [x0, 1], [x0, 0], [x0, -1]]]);
  const features = [rect('W-A', -4, -1, -3, 1), split('W-B', -3, -2),
    rect('E-A', 3, -1, 4, 1), split('E-B', 4, 5)].map(feature => ({ ...feature, coordinatePrecision: 7 }));
  const graph = buildPaintContourGraph(features);
  assert.deepEqual(graph.featureIds, ['W-A', 'W-B', 'E-A', 'E-B']);
  assert.deepEqual(segments(graph), [
    'E-A:E-B|[4,-1]|[4,0]', 'E-A:E-B|[4,0]|[4,1]',
    'W-A:W-B|[-3,-1]|[-3,0]', 'W-A:W-B|[-3,0]|[-3,1]',
  ]);
  assert.equal(graphBytes(graph), '510b387ec1fbe974376381dcf056c429a05966d080c5d0724f7671d03fe33173');
});

test('compact edge indexing preserves legacy packed bytes through rehash, patches, ambiguity and restore', () => {
  const features = compactFixture(), before = JSON.stringify(features), builder = createPaintContourGraphBuilder();
  builder.patch(features);
  const hashes = [graphBytes(builder.finish())];
  builder.patch([{ ...features[17], id: 'overlap-a' }, { ...features[17], id: 'overlap-b' }]);
  assert.ok(builder.getStorageStats().overflowEdges > 0, 'three-way owners use the exceptional overflow path');
  hashes.push(graphBytes(builder.finish()));
  builder.patch([rect(features[0].id, -160, -70, -159, -68)], ['overlap-a', 'overlap-b', features[16].id]);
  hashes.push(graphBytes(builder.finish()));
  builder.patch([features[0], features[16]]);
  hashes.push(graphBytes(builder.finish()));
  // Frozen against the previous object/Map implementation, including feature
  // IDs, diagnostics, exact Float64 coordinates, chain order and owner order.
  assert.deepEqual(hashes, [
    '449a25c14fb14c54122662cb29e34f4c861a98e4540002cc486eacade45f0325',
    'f9b875485572987f89beceaba1699c233747b0653f917b3a6dfcd86318f0cfce',
    'd1dab1d16163bb2ed491782525bacaed746b98e754074153504719de89bcc3f8',
    'a3dc34332dc4cb416c4dda093ee57b3135016e6accc50cf004f6afe00c631157',
  ]);
  assert.equal(JSON.stringify(features), before);
  assert.equal(builder.getStorageStats().overflowEdges, 0);
});

test('large regular grid matches an independent adjacency oracle with compact persistent storage', () => {
  const width = 80, height = 40, features = [], expected = [];
  const add = (left, right, ends) => expected.push(`${[left,right].sort().join(':')}|${ends.map(JSON.stringify).sort().join('|')}`);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const id = `${x}:${y}`, feature = rect(id, x - 100, y - 50, x - 99, y - 49);
    if ((x + y) % 2) feature.geometry.coordinates[0].reverse();
    features.push(feature);
    if (x + 1 < width) add(id, `${x+1}:${y}`, [[x-99,y-50],[x-99,y-49]]);
    if (y + 1 < height) add(id, `${x}:${y+1}`, [[x-100,y-49],[x-99,y-49]]);
  }
  const builder = createPaintContourGraphBuilder(); builder.patch(features);
  assert.deepEqual(segments(builder.finish()), expected.sort());
  const storage = builder.getStorageStats();
  assert.equal(storage.segmentCount, width * (height + 1) + height * (width + 1));
  assert.equal(storage.featureEdgeIndexBytes, features.length * 4 * Uint32Array.BYTES_PER_ELEMENT);
  assert.ok(storage.compactEdgeBytes <= (storage.segmentCount + 4096) * 96);
  assert.equal(storage.overflowEdges, 0);
});

test('deletion tombstones and slot reuse remain bounded across repeated full replacements', () => {
  const builder = createPaintContourGraphBuilder();
  const original = Array.from({ length: 1500 }, (_, index) => rect(String(index), -150 + index % 60 * 2,
    -60 + Math.floor(index / 60) * 2, -149 + index % 60 * 2, -59 + Math.floor(index / 60) * 2));
  builder.patch(original);
  const initial = builder.getStorageStats();
  for (let generation = 0; generation < 12; generation++) {
    const shifted = original.map(feature => ({ ...feature, geometry: { type: 'Polygon',
      coordinates: feature.geometry.coordinates.map(ring => ring.map(([x,y]) => [x + generation / 100, y])) } }));
    builder.patch([], original.map(feature => feature.id));
    builder.patch(shifted);
    const storage = builder.getStorageStats();
    assert.equal(storage.segmentCount, initial.segmentCount);
    assert.equal(storage.edgeCapacity, initial.edgeCapacity);
    assert.equal(storage.featureEdgeIndexBytes, initial.featureEdgeIndexBytes);
    assert.ok(storage.compactEdgeBytes <= initial.compactEdgeBytes * 2);
  }
  assert.equal(builder.finish().diagnostics.arcCount, 0);
  builder.patch(original); assert.equal(builder.finish().diagnostics.arcCount, 0);
});

test('scalar interval queries retain mixed compact/split edge order and inclusive boundaries', async () => {
  const { createCompactEdges, sourceEdgeQuery } = await readScalarInternals();
  const store = createCompactEdges();
  const add = (a, b) => store.getOrAdd(a, b, a, b);
  add([10, 0], [30, 4]); add([10, 2], [20, 6]); add([-5, -4], [0, 0]);
  add([-1800000000, 0], [1800000000, 0]); // Excluded world-spanning chord.
  store.beginRead();
  const originals = [...store.values()];
  const split = { a: [10, -2], b: [25, 2], start: [1, -0.2], end: [2.5, 0.2] };
  const excluded = { ...split, key: 99 };
  const query = sourceEdgeQuery(store, [split, excluded]);
  // Equal lower x values keep original insertion order before the split edge.
  assert.deepEqual(query(10, -2, 10, 2), [originals[0], originals[1], split]);
  assert.deepEqual(query(0, 0, 0, 0), [originals[2]]);
  assert.deepEqual(query(30, 4, 30, 4), [originals[0]]);
  assert.deepEqual(query(31, -90, 40, 90), []);
  store.endRead();
});

test('signed-Int32 radix interval queries preserve duplicate-x0 ordinal order and inclusive bounds', async () => {
  const { sourceEdgeQuery } = await readScalarInternals();
  const edge = (id, x0, y0, x1, y1) => ({ id, a: [x0, y0], b: [x1, y1] });
  const int32Min = -0x80000000, int32Max = 0x7fffffff;
  const source = [
    edge('tie-upper-first', -1e9, 5, -1e9 + 30, 10),
    edge('signed-max', int32Max - 5, -2, int32Max, 2),
    edge('signed-min', int32Min, -2, int32Min + 5, 2),
    edge('tie-lower-second', -1e9, -5, -1e9 + 10, 0),
    edge('long-cross-buckets', -1700000000, -10, 100, 10),
    edge('zero-degenerate', 0, 0, 0, 0),
  ];
  const occupied = [edge('occupied-tie', -1e9, -1, -1e9 + 20, 1), { ...edge('excluded-keyed', 0, -1, 0, 1), key: 7 }];
  const store = { values: () => source };
  const expected = legacySourceEdgeQuery(store, occupied), actual = sourceEdgeQuery(store, occupied);
  const ranges = [
    [int32Min, -2, int32Min + 5, 2], [-1e9, -10, -1e9 + 30, 10],
    [0, -10, 100, 10], [int32Max - 5, -2, int32Max, 2],
    [int32Min, -10, int32Max, 10], [int32Min - 1, -10, int32Max + 1, 10],
    [0, 0, 0, 0],
  ];
  for (const range of ranges) {
    assert.deepEqual(actual(...range).map(value => value.id), expected(...range).map(value => value.id), `query ${range.join(',')}`);
  }
  const tied = actual(-1e9, -10, -1e9 + 30, 10).map(value => value.id);
  assert.ok(tied.indexOf('tie-upper-first') < tied.indexOf('tie-lower-second'));
  assert.ok(tied.indexOf('tie-lower-second') < tied.indexOf('occupied-tie'));
  assert.deepEqual(sourceEdgeQuery({ values: () => [] }, [])(0, 0, 0, 0), []);
});

test('source query keeps legacy fallback for non-Int32 starts, ends and fractional coordinates', async () => {
  const { sourceEdgeQuery } = await readScalarInternals();
  const edge = (id, x0, y0, x1, y1) => ({ id, a: [x0, y0], b: [x1, y1] });
  const source = [
    edge('positive-overflow-start', 2147483648, 0, 2147483649, 1),
    edge('negative-overflow-start', -2147483649, 0, -2147483648, 1),
    edge('overflow-end-only', 2000000000, -2, 2147483648, 2),
    edge('fractional-start', 0.5, -1, 1.5, 1),
    edge('in-range', -10, -1, -5, 1),
  ];
  const occupied = [edge('occupied-overflow', 2147483648, -1, 2147483650, 1)];
  const store = { values: () => source };
  const expected = legacySourceEdgeQuery(store, occupied), actual = sourceEdgeQuery(store, occupied);
  for (const range of [[-3e9, -2, 3e9, 2], [-2147483649, 0, -2147483648, 1],
    [2000000000, -2, 2147483648, 2], [0.5, -1, 1.5, 1]]) {
    assert.deepEqual(actual(...range).map(value => value.id), expected(...range).map(value => value.id), `query ${range.join(',')}`);
  }
});

test('scalar source collinearity preserves the original floating error operation order', async () => {
  const { createCompactEdges, sourceCollinear } = await readScalarInternals();
  const error = value => Math.max(Number.MIN_VALUE, Math.abs(value) * Number.EPSILON);
  // Frozen pre-scalar formula: an oracle for the numerical acceptance boundary.
  function original(edge, point) {
    const [a, b] = [edge.start, edge.end];
    const difference = (x, y) => [x - y, error(x) + error(y) + error(x - y)];
    const [dx, dxError] = difference(b[0], a[0]), [dy, dyError] = difference(b[1], a[1]);
    const [px, pxError] = difference(point[0], a[0]), [py, pyError] = difference(point[1], a[1]);
    const left = dx * py, right = dy * px, determinant = left - right;
    const bound = Math.abs(dx) * pyError + Math.abs(py) * dxError + dxError * pyError
      + Math.abs(dy) * pxError + Math.abs(px) * dyError + dyError * pxError
      + error(left) + error(right) + error(determinant);
    return Number.isFinite(bound) && Math.abs(determinant) <= bound;
  }
  let accepted = 0, rejected = 0;
  for (const [start, end] of [[[0, 0], [1, 1]], [[179, 89], [179.1, 89.1]],
    [[-1e-20, -1e-20], [1e-20, 1e-20]], [[-0, 0], [0, 1]]]) {
    const ordinary = { start, end }, store = createCompactEdges();
    store.getOrAdd([0, 0], [1, 1], start, end);
    const compact = [...store.values()][0];
    for (const step of [0, 0.25, 0.5, 1]) for (const drift of [0, Number.MIN_VALUE, Number.EPSILON, 1e-12]) {
      const point = [start[0] + (end[0] - start[0]) * step, start[1] + (end[1] - start[1]) * step + drift];
      const expected = original(ordinary, point), other = { start: point, end: point };
      expected ? accepted++ : rejected++;
      for (const edge of [ordinary, compact]) for (const second of [false, true]) {
        assert.equal(sourceCollinear(edge, other, second), expected);
      }
    }
  }
  assert.ok(accepted > 0 && rejected > 0);
});


test('coast chains contain uncovered unpaired edges for either ring winding', async () => {
  const { packContourWaterMask } = await import('../js/core/renderer/paint_contour_water_mask.js');
  const { createPackedLineMesh } = await import('../js/core/renderer/packed_line_mesh.js');
  const square = (id, x) => ({ id, geometry: { type: 'Polygon', coordinates: [
    [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]],
  ] } });
  const a = square('A', 0), b = square('B', 1);
  const segments = graph => createPackedLineMesh(graph.coast).coordinates.flatMap(line =>
    line.slice(1).map((p, i) => [line[i], p]));
  for (const reverse of [false, true]) {
    if (reverse) a.geometry.coordinates[0].reverse();
    const waterMask = packContourWaterMask({ land: a.geometry });
    const graph = buildPaintContourGraph([a], { waterMask });
    assert.equal(segments(graph).length, 4);
    assert.deepEqual(new Set(segments(graph).flat().map(p => p.join(','))), new Set(['0,0', '1,0', '1,1', '0,1']));
  }
  const graph = buildPaintContourGraph([a, b], { waterMask: packContourWaterMask({ land: [a.geometry, b.geometry] }) });
  assert.equal(segments(graph).length, 6);
  assert.ok(segments(graph).every(([p, q]) => !(p[0] === 1 && q[0] === 1)));
  const surrounding = { type: 'Polygon', coordinates: [[[-2,-2],[4,-2],[4,4],[-2,4],[-2,-2]]] };
  assert.equal(segments(buildPaintContourGraph([a], { waterMask: packContourWaterMask({ land: surrounding }) })).length, 4, 'base land beyond political edges must not suppress coast');
  const enclosing = { id: 'enclosing', geometry: surrounding };
  const enclosed = segments(buildPaintContourGraph([a, enclosing], { waterMask: packContourWaterMask({ land: surrounding }) }));
  assert.equal(enclosed.length, 4, 'only the enclosing political polygon contributes coast');
  assert.ok(enclosed.flat().every(([x, y]) => x === -2 || x === 4 || y === -2 || y === 4));
  assert.equal(buildPaintContourGraph([a]).coast, null);
  const overlapping = square('B', 0.97);
  const water = packContourWaterMask({ water: surrounding });
  const near = segments(buildPaintContourGraph([a, overlapping], { waterMask: water, nearSeamTolerance: 0.05 }));
  assert.ok(near.every(([p, q]) => !(p[0] === q[0] && (p[0] === 1 || p[0] === 0.97))), 'both consumed sides are excluded');
});
