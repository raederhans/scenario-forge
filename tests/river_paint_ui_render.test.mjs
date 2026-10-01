import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, d3 } from './helpers/river_paint_fixture.mjs';
import { createRiverPaintControls } from '../js/ui/river_paint_controls.js';
import { createRiverPaintRenderOwner } from '../js/core/river_paint/render_owner.js';
import { applyRiverCellPaintState } from '../js/core/state/actions/river_paint_actions.js';
import { getUniqueLegendColors } from '../js/core/legend_state_normalizers.js';

function buttonFixture() {
  const attrs = {}, listeners = {}, classes = new Set();
  return { attrs, listeners, disabled: false, textContent: '', title: '',
    classList: { toggle(key, on) { if (on) classes.add(key); else classes.delete(key); } },
    setAttribute(key, value) { attrs[key] = value; },
    addEventListener(key, fn) { listeners[key] = fn; }, removeEventListener(key) { delete listeners[key]; } };
}

test('control is unavailable outside pilot scene and while startup is readonly', async () => {
  const { state } = await makeFixture(); const button = buttonFixture();
  const controls = createRiverPaintControls({ state, button, rebuildGeometry() {} });
  assert.equal(button.disabled, false);
  state.activeScenarioId = 'tno_1962'; controls.sync(); assert.equal(button.disabled, true);
  state.activeScenarioId = 'modern_world'; state.startupReadonly = true; controls.sync(); assert.equal(button.disabled, true);
  controls.dispose(); assert.deepEqual(button.listeners, {});
});

test('control loads once, rebuilds once, preserves bank paint when turned off and on', async () => {
  const { state, pack, cells } = await makeFixture({ installed: false }); const button = buttonFixture();
  let loads = 0, builds = 0, renders = 0;
  const controls = createRiverPaintControls({ state, button, loadPack: async () => { loads++; return pack; },
    rebuildGeometry() { builds++; }, render() { renders++; } });
  await controls.toggle(); assert.equal(loads, 1); assert.equal(builds, 1); assert.equal(button.attrs['aria-pressed'], 'true');
  applyRiverCellPaintState(state, cells[0].id, '#0000ff'); await controls.toggle();
  assert.equal(button.attrs['aria-pressed'], 'false'); assert.equal(state.riverPaint.overrides[cells[0].id], '#0000ff');
  await controls.toggle(); assert.equal(loads, 1); assert.equal(builds, 1); assert.equal(renders, 3);
});

test('control cancellation prevents late geometry application and handles retryable failures', async () => {
  const { state, pack } = await makeFixture({ installed: false }); const button = buttonFixture();
  let release, builds = 0; const notices = [];
  const controls = createRiverPaintControls({ state, button,
    loadPack: () => new Promise(resolve => { release = resolve; }), rebuildGeometry() { builds++; }, announce: m => notices.push(m) });
  const pending = controls.toggle(); await Promise.resolve(); assert.equal(button.attrs['aria-busy'], 'true');
  await controls.toggle(); release(pack); await pending;
  assert.equal(state.riverPaint.pack, null); assert.equal(builds, 0); assert.equal(notices.length, 0);
  controls.dispose();
  const errorControls = createRiverPaintControls({ state, button, loadPack: async () => { throw new Error('fixture failure'); }, rebuildGeometry() {}, announce: m => notices.push(m) });
  await errorControls.toggle(); assert.equal(notices.length, 1); assert.match(button.title, /fixture failure/);
  errorControls.dispose();
});

function renderHarness(state) {
  const events = []; let key = 'projection-1', enabled = true;
  class Path { moveTo() {} lineTo() {} closePath() {} arc() {} }
  const context = { save() { events.push('save'); }, restore() { events.push('restore'); },
    clip(path) { events.push(['clip', path]); }, fill(path) { events.push(['fill', this.fillStyle, path]); }, stroke() {} };
  const path = d3.geoPath(d3.geoEquirectangular().scale(100)).context(context);
  const owner = createRiverPaintRenderOwner({ state, getContext: () => context, getPath: () => path,
    getProjectionKey: () => key, createPath: () => new Path(), isEnabled: () => enabled });
  return { owner, context, path, events, project: () => { key += 'x'; }, disable: () => { enabled = false; } };
}

test('renderer clips to the parent, draws each bank with resolved color and restores the d3 context', async () => {
  const { state, cells } = await makeFixture(); const h = renderHarness(state);
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  assert.equal(h.owner.draw(2), 2); assert.equal(h.path.context(), h.context);
  assert.deepEqual(h.events.filter(e => e[0] === 'fill').map(e => e[1]), ['#0000ff', '#ff0000']);
  assert.equal(h.events[0], 'save'); assert.equal(h.events[1][0], 'clip'); assert.equal(h.events.at(-1), 'restore');
});

test('same projection and color-only edits reuse paths; reprojection refreshes them', async () => {
  const { state, cells } = await makeFixture(); const h = renderHarness(state);
  h.owner.draw(); assert.equal(h.owner.diagnostics().builds, 3);
  for (let i = 0; i < 25; i++) { applyRiverCellPaintState(state, cells[0].id, i % 2 ? '#0000ff' : '#ff0000'); h.owner.draw(); }
  assert.equal(h.owner.diagnostics().builds, 3);
  h.project(); h.owner.draw(); assert.equal(h.owner.diagnostics().builds, 6);
  assert.equal(h.owner.draw(1, 'N'), 0); h.disable(); assert.equal(h.owner.draw(), 0);
});

test('legend consumes actual cell colors, not a hidden parent color, and ignores foreign-scene paint', async () => {
  const { state, cells } = await makeFixture(); state.colors = { P: '#ff0000' };
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  applyRiverCellPaintState(state, cells[1].id, '#00ff00');
  assert.deepEqual(getUniqueLegendColors(state), ['#0000ff', '#00ff00']);
  state.activeScenarioId = 'other'; assert.deepEqual(getUniqueLegendColors(state), ['#ff0000']);
});
