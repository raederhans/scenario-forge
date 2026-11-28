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
    op: value.globalCompositeOperation, clip: value.clipped });
  Object.assign(value, {
    save: () => stack.push(Object.fromEntries(stateKeys.map(key => [key, value[key]]))),
    restore: () => Object.assign(value, stack.pop()),
    getTransform: () => ({ ...value.transform }),
    setTransform: (...args) => { value.transform = args.length === 1 ? { ...args[0] }
      : Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((key, index) => [key, args[index]])); },
    clearRect() {},
    beginPath: () => { value.currentPath = null; },
    fill: (path) => record('fill', path),
    stroke: (path) => record('stroke', path),
    clip: (path) => { value.clipped = path?.value || value.currentPath; record('clip', path); },
    drawImage: () => record('composite'),
  });
  return value;
}

function fixture({ cached = true } = {}) {
  const target = context({ width: 640, height: 480 });
  target.transform = { a: 4, b: 0, c: 0, d: 4, e: 24, f: -18 };
  const scratchCanvas = { width: 0, height: 0 };
  const scratch = context(scratchCanvas);
  scratchCanvas.getContext = () => scratch;
  let activePathContext = target;
  const path = value => {
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
  const owner = createRiverContourRenderOwner({
    getContext: () => target, getPath: () => path, getProjectionKey: () => 'projection-1',
    getOrderedEntries: () => entries,
    getParentMeshes: id => meshes.get(id) || [],
    createCanvas: () => scratchCanvas,
    createPath: () => cached ? {} : null,
  });
  const draw = () => owner.draw({ k: 2, color: '#123456', alpha: .45, width: .8,
    lineJoin: 'miter', lineCap: 'butt', miterLimit: 6 });
  return { draw, path, target, scratch, scratchCanvas, lower, cover, upper, third, entries, meshes };
}

test('border scratch masks later parents including unpartitioned and noninteractive land, then clips local seams', () => {
  const h = fixture();
  assert.equal(h.draw(), 2);
  const strokes = h.scratch.events.filter(event => event.kind === 'stroke');
  assert.deepEqual(strokes.map(event => event.path.id), ['lower-seam', 'cover', 'upper', 'upper-seam', 'third']);
  const erasures = h.scratch.events.filter(event => ['fill', 'stroke'].includes(event.kind)
    && event.op === 'destination-out');
  assert.deepEqual(erasures.map(event => event.path), [h.cover, h.cover, h.upper, h.upper, h.third, h.third]);
  const seams = strokes.filter(event => event.op === 'source-over');
  assert.deepEqual(seams.map(event => event.clip), [h.lower, h.upper]);
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
