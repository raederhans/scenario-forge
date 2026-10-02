import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiverContourRenderOwner } from '../js/core/river_paint/contour_render_owner.js';

const parent = (id, properties = {}) => ({ type: 'Feature', id, properties,
  geometry: { type: 'Polygon', coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[2, 2], [2, 4], [4, 4], [4, 2], [2, 2]],
  ] } });
const mesh = (id) => ({ id, type: 'MultiLineString', coordinates: [[[1, 1], [9, 9]]] });
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const stateKeys = ['globalAlpha', 'globalCompositeOperation', 'lineWidth', 'lineJoin',
  'lineCap', 'miterLimit', 'strokeStyle', 'fillStyle', 'transform', 'clipped'];

function context(canvas) {
  const stack = [], events = [];
  const value = { canvas, events, globalAlpha: .3, globalCompositeOperation: 'multiply',
    lineWidth: 7, lineJoin: 'bevel', lineCap: 'square', miterLimit: 9,
    strokeStyle: '#aabbcc', fillStyle: '#ddeeff', transform: { ...identity },
    clipped: null, currentPath: 'original-target-path' };
  const record = (kind, path) => events.push({ kind, path: path?.value || path || value.currentPath,
    alpha: value.globalAlpha, op: value.globalCompositeOperation, width: value.lineWidth,
    join: value.lineJoin, cap: value.lineCap, miterLimit: value.miterLimit, color: value.strokeStyle,
    clip: value.clipped, transform: { ...value.transform } });
  Object.assign(value, {
    save: () => stack.push(Object.fromEntries(stateKeys.map(key => [key, value[key]]))),
    restore: () => Object.assign(value, stack.pop()),
    getTransform: () => ({ ...value.transform }),
    setTransform: (...args) => { value.transform = args.length === 1 ? { ...args[0] }
      : Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((key, index) => [key, args[index]])); },
    clearRect: (...args) => { record('clear'); events.at(-1).rect = args; },
    beginPath: () => { value.currentPath = null; },
    fill: (path) => record('fill', path),
    stroke: (path) => record('stroke', path),
    clip: (path) => { value.clipped = path?.value || value.currentPath; record('clip', path); },
    drawImage: (source, x, y) => { record('composite'); Object.assign(events.at(-1), { source, x, y }); },
  });
  return value;
}

function fixture({ cached = true } = {}) {
  const target = context({ width: 640, height: 480 });
  target.transform = { a: 4, b: 0, c: 0, d: 4, e: 24, f: -18 };
  const scratchCanvas = { width: 0, height: 0 };
  const scratch = context(scratchCanvas);
  scratchCanvas.getContext = () => scratch;
  let activePathContext = target, key = 'projection-1', allocations = 0;
  const streamed = [];
  const path = value => {
    streamed.push(value);
    if (activePathContext === scratch) scratch.currentPath = value;
    else activePathContext.value = value;
  };
  path.context = (...args) => {
    if (!args.length) return activePathContext;
    activePathContext = args[0]; return path;
  };
  const lower = parent('lower'), upper = parent('upper');
  const cover = parent('cover', { interactive: false }), third = parent('third');
  const lowerMesh = mesh('lower-seam'), upperMesh = mesh('upper-seam');
  const entries = [parent('before'), lower, cover, upper, third].map(feature => ({ id: feature.id, feature }));
  const meshes = new Map([['lower', [lowerMesh]], ['upper', [upperMesh]]]);
  const requested = [];
  const owner = createRiverContourRenderOwner({
    getContext: () => target, getPath: () => path, getProjectionKey: () => key,
    getOrderedEntries: () => entries,
    getParentMeshes: id => { requested.push(id); return meshes.get(id) || []; },
    createCanvas: () => { allocations++; return scratchCanvas; },
    createPath: () => cached ? {} : null,
  });
  const draw = () => owner.draw({ k: 2, color: '#123456', alpha: .45, width: .8,
    lineJoin: 'miter', lineCap: 'butt', miterLimit: 6 });
  return { owner, draw, path, target, scratch, scratchCanvas, lower, cover, upper, third,
    lowerMesh, upperMesh, entries, meshes, streamed, requested,
    allocations: () => allocations, setKey: value => { key = value; } };
}

test('border scratch masks later parents including unpartitioned and noninteractive land, then clips local seams', () => {
  const h = fixture();
  const originalTarget = Object.fromEntries(stateKeys.map(key => [key, h.target[key]]));
  assert.equal(h.draw(), 2);
  assert.deepEqual(h.requested, ['before', 'lower', 'cover', 'upper', 'third']);
  const strokes = h.scratch.events.filter(event => event.kind === 'stroke');
  assert.deepEqual(strokes.map(event => event.path.id), ['lower-seam', 'cover', 'upper', 'upper-seam', 'third']);
  const erasures = h.scratch.events.filter(event => ['fill', 'stroke'].includes(event.kind)
    && event.op === 'destination-out');
  assert.deepEqual(erasures.map(event => event.path), [h.cover, h.cover, h.upper, h.upper, h.third, h.third]);
  for (const event of erasures) {
    assert.equal(event.alpha, 1);
    assert.equal(event.width, .75 / 2);
    assert.equal(event.join, 'round'); assert.equal(event.cap, 'round');
    assert.equal(event.path.geometry.coordinates.length, 2, 'original polygon holes remain intact');
  }
  const seams = strokes.filter(event => event.op === 'source-over');
  assert.deepEqual(seams.map(event => event.clip), [h.lower, h.upper]);
  for (const event of seams) {
    assert.equal(event.alpha, .45); assert.equal(event.width, .8);
    assert.equal(event.color, '#123456'); assert.equal(event.join, 'miter'); assert.equal(event.cap, 'butt');
    assert.equal(event.miterLimit, 6);
    assert.deepEqual(event.transform, originalTarget.transform);
  }
  assert.deepEqual(h.target.events.map(event => event.kind), ['composite'], 'only final composite touches the border target');
  assert.equal(h.target.events[0].alpha, 1); assert.equal(h.target.events[0].op, 'source-over');
  assert.deepEqual(h.target.events[0].transform, identity);
  assert.equal(h.target.currentPath, 'original-target-path');
  assert.deepEqual(Object.fromEntries(stateKeys.map(key => [key, h.target[key]])), originalTarget);
  assert.equal(h.path.context(), h.target);
  assert.equal(h.owner.diagnostics().maskedParents, 3);
});

test('scratch follows target pixel size and matrix, reuses allocation and projection paths, and resizes for export', () => {
  const h = fixture();
  h.draw();
  const builds = h.owner.diagnostics().builds;
  assert.equal(h.owner.diagnostics().scratchBytes, 640 * 480 * 4);
  h.target.transform = { a: 6, b: 0, c: 0, d: 6, e: 100, f: 200 };
  h.draw();
  assert.equal(h.allocations(), 1);
  assert.equal(h.owner.diagnostics().builds, builds, 'camera/DPR changes keep projection paths');
  assert.deepEqual(h.scratch.events.filter(event => event.path === h.lowerMesh).at(-1).transform, h.target.transform);
  h.target.canvas.width = 1280; h.target.canvas.height = 960;
  h.draw();
  assert.equal(h.allocations(), 1);
  assert.equal(h.owner.diagnostics().scratchBytes, 1280 * 960 * 4);
  assert.deepEqual(h.scratch.events.filter(event => event.kind === 'clear').at(-1).rect, [0, 0, 1280, 960]);
  h.setKey('projection-2');
  h.draw();
  assert.equal(h.owner.diagnostics().builds, builds * 2);
  h.lower.geometry = { ...h.lower.geometry };
  h.draw();
  assert.equal(h.owner.diagnostics().builds, builds * 2 + 1);
});

test('native Canvas path fallback restores the geoPath context and follows the same parent masking', () => {
  const h = fixture({ cached: false });
  assert.equal(h.draw(), 2);
  assert.equal(h.owner.diagnostics().builds, 0);
  assert.equal(h.path.context(), h.target);
  assert.deepEqual(h.scratch.events.filter(event => event.kind === 'clip').map(event => event.path), [h.lower, h.upper]);
  assert.deepEqual(h.scratch.events.filter(event => event.kind === 'fill').map(event => event.path), [h.cover, h.upper, h.third]);
  assert.deepEqual(h.target.events.map(event => event.kind), ['composite']);
});

test('no active lines skip allocation and target mutation; disabling releases retained scratch', () => {
  const h = fixture();
  const initial = [...h.meshes];
  h.meshes.clear();
  assert.equal(h.draw(), 0); assert.equal(h.allocations(), 0);
  assert.equal(h.target.events.length, 0);
  h.meshes.set('lower', [{ type: 'MultiLineString', coordinates: [] }]);
  assert.equal(h.draw(), 0); assert.equal(h.allocations(), 0);
  initial.forEach(([id, meshes]) => h.meshes.set(id, meshes));
  h.draw(); h.meshes.clear(); h.target.events.length = 0;
  assert.equal(h.draw(), 0);
  assert.equal(h.owner.diagnostics().scratchBytes, 0);
  assert.equal(h.target.events.length, 0);
});

test('geometry streaming failure restores geoPath and scratch state without composing partial seams', () => {
  for (const cached of [true, false]) {
    const h = fixture({ cached });
    const before = Object.fromEntries(stateKeys.map(key => [key, h.scratch[key]]));
    const brokenPath = Object.assign(() => { throw Error('projection failed'); }, { context: h.path.context });
    const owner = createRiverContourRenderOwner({ getContext: () => h.target,
      getPath: () => brokenPath, getProjectionKey: () => 'a', getOrderedEntries: () => h.entries,
      getParentMeshes: id => h.meshes.get(id) || [], createCanvas: () => h.scratchCanvas,
      createPath: () => cached ? {} : null });
    assert.throws(() => owner.draw({ k: 1 }), /projection failed/);
    assert.equal(h.path.context(), h.target);
    assert.deepEqual(Object.fromEntries(stateKeys.map(key => [key, h.scratch[key]])), before);
    assert.equal(h.target.events.length, 0);
  }
});
