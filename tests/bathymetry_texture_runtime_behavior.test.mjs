import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createBathymetryTextureRuntime } from '../js/core/renderer/bathymetry_texture_runtime.js';
import { createRendererAssetUrlPolicyOwner } from '../js/core/renderer/asset_url_policy.js';

const vendor = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../vendor/d3.v7.min.js', import.meta.url), 'utf8'), vendor);
const manifest = { overview: { url: 'overview' }, encoding: { max_depth_m: 11000 },
  tiles: { present: ['8_4', '9_4'], url_template: 'tiles/{col}_{row}' } };
const overlayManifest = (url) => ({ overlay: { url: `${url}.png` }, bounds: [-20, -10, 20, 10] });
const bitmap = (url) => ({ url, width: 2, height: 2, closes: 0, close() { this.closes++; } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides = {}) {
  const requests = [], changes = [], renders = [], draws = [], images = [];
  let generation = 1, time = 0, renderers = 0, disposals = 0;
  const projection = vendor.d3.geoEqualEarth().scale(100).translate([1, 1]);
  const context = { canvas: { width: 2, height: 2 },
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, globalAlpha: 1,
    getTransform() { return this.transform; },
    save() { draws.push(['save']); this.saved = [this.transform, this.globalAlpha]; },
    setTransform(...args) { draws.push(['transform', ...args]); this.transform = args; },
    drawImage(...args) { draws.push(['image', this.globalAlpha, ...args]); },
    restore() { draws.push(['restore']); [this.transform, this.globalAlpha] = this.saved; },
  };
  const canvas = {};
  const options = { oceanStyle: { experimentalAdvancedStyles: true, preset: 'bathymetry_soft',
    opacity: .6, scale: 1, contourStrength: .3 }, baseRgb: { r: 100, g: 150, b: 200 } };
  const runtime = createBathymetryTextureRuntime({
    globalManifestUrl: 'global',
    fetchJson: async url => { requests.push(url); return url === 'global' ? manifest : overlayManifest(url); },
    loadImageBitmap: async url => { requests.push(url); const image = bitmap(url); images.push(image); return image; },
    createCanvas: () => canvas,
    getProjection: () => projection, getProjectionGeneration: () => generation,
    now: () => time, onAssetsChanged: reason => changes.push(reason),
    createRenderer: ({ createCanvas }) => {
      renderers++;
      return { prewarm() {}, render: args => {
        renders.push(args);
        return { canvas: createCanvas(), backend: 'cpu', coveredBounds: [-20, -10, 20, 10], missingTileKeys: [] };
      }, dispose: () => { disposals++; } };
    }, ...overrides,
  });
  return { runtime, context, options, requests, changes, renders, draws, images, projection,
    draw: () => runtime.draw(context, options),
    generation: () => { generation++; }, advance: delta => { time += delta; },
    renderers: () => renderers, disposals: () => disposals };
}

test('runtime loads lazily, draws only when ready, and preserves caller transform and alpha', async () => {
  const pending = deferred();
  const h = harness({ fetchJson: () => pending.promise });
  assert.equal(h.runtime.getState().status, 'off');
  assert.deepEqual(h.requests, []);
  assert.equal(h.draw().status, 'loading');
  assert.equal(h.draw().status, 'loading');
  assert.deepEqual(h.draws, []);
  pending.resolve(manifest);
  await h.runtime.ensure();
  assert.deepEqual(h.requests, ['overview']);
  const result = h.draw();
  assert.equal(result.status, 'ready');
  assert.equal(result.activeBathymetrySource, 'global');
  assert.equal(result.backend, 'cpu');
  assert.equal(result.detail, false);
  assert.deepEqual(h.draws.map(call => call[0]), ['save', 'transform', 'image', 'restore']);
  assert.deepEqual(h.draws[1], ['transform', 1, 0, 0, 1, 0, 0]);
  assert.equal(h.draws[2][1], .6);
  assert.equal(h.context.globalAlpha, 1);
  h.options.oceanStyle.opacity = 2;
  h.draw();
  assert.equal(h.draws.at(-2)[1], 1);
  assert.equal(h.renderers(), 1);
  h.runtime.dispose();
  assert.equal(h.images[0].closes, 1);
  assert.equal(h.disposals(), 1);
});

test('runtime prewarms during loading and polls once until GPU readiness requests one repaint', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const loading = deferred();
  let prewarms = 0, checks = 0, ready = false;
  const h = harness({ fetchJson: () => loading.promise, createRenderer: () => ({
    prewarm() { prewarms++; },
    isReady() { checks++; return ready; },
    render: () => ({ canvas: ready ? {} : null, backend: ready ? 'webgl2' : 'pending',
      coveredBounds: null, missingTileKeys: [] }),
    dispose() {},
  }) });
  t.after(() => h.runtime.dispose());
  const ensured = h.runtime.ensure();
  assert.equal(prewarms, 1);
  assert.equal(h.runtime.getState().status, 'loading');
  loading.resolve(manifest);
  await ensured;
  h.changes.length = 0;
  for (let i = 0; i < 3; i++) {
    const state = h.draw();
    assert.equal(state.status, 'ready');
    assert.equal(state.backend, 'pending');
  }
  assert.equal(prewarms, 1);
  assert.deepEqual(h.draws, []);
  t.mock.timers.tick(50);
  assert.equal(checks, 1);
  assert.deepEqual(h.changes, []);
  ready = true;
  t.mock.timers.tick(50);
  assert.equal(checks, 2);
  assert.deepEqual(h.changes, ['bathymetry-gpu-ready']);
  assert.equal(h.draw().backend, 'webgl2');
  assert.equal(h.draws.filter(call => call[0] === 'image').length, 1);
  t.mock.timers.tick(500);
  assert.equal(checks, 2);
  assert.deepEqual(h.changes, ['bathymetry-gpu-ready']);
});

test('disposing runtime cancels the pending GPU readiness check', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let checks = 0;
  const h = harness({ createRenderer: () => ({
    prewarm() {},
    isReady() { checks++; return true; },
    render: () => ({ canvas: null, backend: 'pending', coveredBounds: null, missingTileKeys: [] }),
    dispose() {},
  }) });
  await h.runtime.ensure();
  h.changes.length = 0;
  h.draw();
  h.runtime.dispose();
  t.mock.timers.tick(500);
  assert.equal(checks, 0);
  assert.deepEqual(h.changes, []);
});

test('inactive styles never load and unsupported projections never draw', async () => {
  const h = harness();
  for (const style of [
    { experimentalAdvancedStyles: false }, { preset: 'flat' }, { opacity: 0 },
  ]) {
    assert.equal(h.runtime.draw(h.context, { ...h.options,
      oceanStyle: { ...h.options.oceanStyle, ...style } }).status, 'off');
  }
  assert.deepEqual(h.requests, []);
  h.projection.rotate([0, 20, 0]);
  assert.equal(h.draw().status, 'unsupported-projection');
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.draws, []);
  h.projection.rotate([0, 0, 0]);
  h.generation();
  assert.equal(h.draw().status, 'loading');
  await h.runtime.ensure();
  assert.equal(h.draw().status, 'ready');
  h.runtime.dispose();
});

test('projection parameters and ramps are cached by geometry generation and style inputs', async () => {
  const h = harness();
  await h.runtime.ensure();
  h.draw(); h.draw();
  assert.equal(h.renders[0].projectionParams, h.renders[1].projectionParams);
  assert.equal(h.renders[0].ramp, h.renders[1].ramp);
  h.context.transform.a = 12;
  assert.equal(h.draw().detail, true);
  h.generation(); h.projection.translate([3, 4]); h.draw();
  assert.notEqual(h.renders.at(-1).projectionParams, h.renders[0].projectionParams);
  for (const change of [() => { h.options.baseRgb.r++; },
    () => { h.options.oceanStyle.preset = 'bathymetry_contours'; },
    () => { h.options.oceanStyle.scale = 2; }]) {
    const previous = h.renders.at(-1).ramp;
    change(); h.draw();
    assert.notEqual(h.renders.at(-1).ramp, previous);
  }
  h.runtime.dispose();
});

test('missing tiles load once and the whole batch notifies a single repaint', async () => {
  const h = harness({ createRenderer: () => ({ prewarm() {}, render: ({ source }) => ({ canvas: {}, backend: 'webgl2',
    coveredBounds: [-20, -10, 20, 10],
    missingTileKeys: manifest.tiles.present.filter(key => !source.getLoadedTiles().has(key)),
  }), dispose() {} }) });
  await h.runtime.ensure();
  h.changes.length = 0;
  h.context.transform.a = 12;
  assert.equal(h.draw().missingTileCount, 2);
  assert.equal(h.runtime.hasPendingDetail(), true);
  h.draw();
  await settle();
  assert.deepEqual(h.requests, ['global', 'overview', 'tiles/8_4', 'tiles/9_4']);
  assert.deepEqual(h.changes, ['bathymetry-tile']);
  const result = h.draw();
  assert.equal(result.missingTileCount, 0);
  assert.equal(result.loadedTileCount, 2);
  assert.equal(h.runtime.hasPendingDetail(), false);
  h.runtime.dispose();
  assert.ok(h.images.every(image => image.closes === 1));
});

test('scenario overlay switches lazily and closes replaced, stale and disposed bitmaps', async () => {
  const old = deferred();
  const h = harness({ loadImageBitmap: async url => url === 'old.png' ? old.promise : bitmap(url) });
  h.runtime.setScenarioOverlayUrl('old');
  assert.deepEqual(h.requests, []);
  const first = h.runtime.ensure();
  await settle();
  h.runtime.setScenarioOverlayUrl('new');
  await h.runtime.ensure();
  assert.equal(h.draw().activeBathymetrySource, 'merged');
  const overlay = h.renders.at(-1).overlay;
  assert.equal(overlay.bitmap.url, 'new.png');
  assert.deepEqual(overlay.bounds, [-20, -10, 20, 10]);
  const stale = bitmap('old.png'); old.resolve(stale); await first;
  assert.equal(stale.closes, 1);
  h.runtime.setScenarioOverlayUrl('new');
  assert.equal(overlay.bitmap.closes, 0);
  h.runtime.setScenarioOverlayUrl(null);
  assert.equal(overlay.bitmap.closes, 1);
  assert.equal(h.draw().activeBathymetrySource, 'global');
  assert.equal(h.renders.at(-1).overlay, null);
  h.runtime.setScenarioOverlayUrl('last');
  await h.runtime.ensure(); h.draw();
  const last = h.renders.at(-1).overlay.bitmap;
  h.runtime.dispose();
  assert.equal(last.closes, 1);
  assert.equal(h.draw().status, 'off');
});

test('failed loads wait ten seconds before another ensure can retry', async () => {
  let attempts = 0;
  const h = harness({ fetchJson: async () => {
    if (++attempts === 1) throw new Error('manifest failed');
    return manifest;
  } });
  await h.runtime.ensure();
  assert.equal(h.draw().status, 'error');
  assert.equal(h.runtime.getState().error, 'manifest failed');
  h.advance(9999); await h.runtime.ensure();
  assert.equal(attempts, 1);
  assert.deepEqual(h.draws, []);
  h.advance(1); await h.runtime.ensure();
  assert.equal(attempts, 2);
  assert.equal(h.draw().status, 'ready');
  h.runtime.dispose();
});

test('overlay bitmap failure reports its source and switching overlays clears its cooldown', async () => {
  const h = harness({ loadImageBitmap: async url => {
    if (url === 'bad.png') throw new Error('overlay failed');
    return bitmap(url);
  } });
  h.runtime.setScenarioOverlayUrl('bad');
  await h.runtime.ensure();
  const failed = h.draw();
  assert.equal(failed.status, 'ready');
  assert.equal(failed.load.status, 'partial');
  assert.deepEqual(failed.load.failedSources, ['scenario']);
  // Global depth still paints when only the scenario overlay is unavailable.
  assert.deepEqual(h.draws.map(call => call[0]), ['save', 'transform', 'image', 'restore']);
  assert.equal(h.renders.at(-1).overlay, null);
  h.runtime.setScenarioOverlayUrl('good');
  await h.runtime.ensure();
  assert.equal(h.draw().status, 'ready');
  h.runtime.dispose();
});

test('disposing pending loads closes their eventual images without publishing changes', async () => {
  const pending = deferred();
  const h = harness({ loadImageBitmap: () => pending.promise });
  const loading = h.runtime.ensure();
  await settle(); h.runtime.dispose();
  const image = bitmap('late'); pending.resolve(image); await loading;
  assert.equal(image.closes, 1);
  assert.deepEqual(h.changes, []);
});

test('asset URL policy reads the texture manifest independently from the legacy topology URL', () => {
  const state = { activeScenarioManifest: {
    bathymetry_texture_url: 'data/scenarios/tno_1962/bathymetry_texture/manifest.json',
    bathymetry_topology_url: 'data/scenarios/tno_1962/bathymetry.topo.json',
  } };
  const owner = createRendererAssetUrlPolicyOwner({ state });
  assert.equal(owner.getScenarioBathymetryTextureUrl(), state.activeScenarioManifest.bathymetry_texture_url);
  state.activeScenarioManifest = null;
  assert.equal(owner.getScenarioBathymetryTextureUrl(), '');
});

const missingTileRenderer = () => ({ prewarm() {}, render: ({ source, detail }) => ({ canvas: {}, backend: 'webgl2',
  coveredBounds: [-20, -10, 20, 10],
  missingTileKeys: detail ? manifest.tiles.present.filter(key => !source.getLoadedTiles().has(key)) : [],
}), dispose() {} });

test('tiles in failure cooldown do not trigger repaints that request them again', async () => {
  const h = harness({ createRenderer: missingTileRenderer, loadImageBitmap: async url => {
    if (url.startsWith('tiles/')) throw new Error('tile failed');
    return bitmap(url);
  } });
  await h.runtime.ensure();
  h.changes.length = 0;
  h.context.transform.a = 12;
  h.draw();
  await settle(); await settle();
  assert.deepEqual(h.changes, []);
  h.draw(); h.draw();
  await settle(); await settle();
  assert.deepEqual(h.changes, []);
  assert.equal(h.runtime.hasPendingDetail(), true);
  h.runtime.dispose();
});

test('views needing more tiles than the cache holds stay on the overview', async () => {
  const h = harness({ createRenderer: missingTileRenderer, maxCachedTiles: 1 });
  await h.runtime.ensure();
  // Centre the 2x2 view on the prime meridian so it straddles tiles 8_4 and 9_4.
  Object.assign(h.context.transform, { a: 12, d: 12, e: -11, f: -11 });
  const result = h.draw();
  assert.equal(result.detail, false);
  assert.equal(result.missingTileCount, 0);
  await settle();
  assert.equal(h.requests.filter(url => url.startsWith('tiles/')).length, 0);
  assert.equal(h.runtime.hasPendingDetail(), false);
  h.runtime.dispose();
});

test('export preparation loads the detail tiles a target surface needs and repaints once', async () => {
  const h = harness();
  const surface = { width: 2, height: 2, transform: { a: 12, b: 0, c: 0, d: 12, e: -11, f: -11 },
    oceanStyle: h.options.oceanStyle };
  await h.runtime.prepareForSurface(surface);
  assert.deepEqual(h.requests.filter(url => url.startsWith('tiles/')).sort(), ['tiles/8_4', 'tiles/9_4']);
  assert.equal(h.changes.filter(reason => reason === 'bathymetry-tile').length, 1);
  await h.runtime.prepareForSurface(surface);
  assert.equal(h.requests.filter(url => url.startsWith('tiles/')).length, 2);
  h.runtime.dispose();
});

test('export preparation requests nothing while bathymetry is inactive', async () => {
  const h = harness();
  for (const oceanStyle of [{ ...h.options.oceanStyle, preset: 'flat' },
    { ...h.options.oceanStyle, opacity: 0 }, { ...h.options.oceanStyle, experimentalAdvancedStyles: false }]) {
    await h.runtime.prepareForSurface({ width: 2, height: 2,
      transform: { a: 12, b: 0, c: 0, d: 12, e: -11, f: -11 }, oceanStyle });
  }
  assert.deepEqual(h.requests, []);
  h.runtime.dispose();
});
