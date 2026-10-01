import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, d3, realPilot, realWave2, captureCells, feature } from './helpers/river_paint_fixture.mjs';
import { createRiverCellPicker } from '../js/ui/river_cell_picker.js';
import { createRiverPaintEditorOwner } from '../js/core/river_paint/editor_owner.js';
import { normalizeRiverPaintState } from '../js/core/river_paint/partition_model.js';
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

function pickerNodes() {
  const element = () => ({ ...buttonFixture(), value: '', children: [],
    ownerDocument: { createElement: () => element(), createElementNS: () => element() },
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); },
  });
  return Object.fromEntries(['panel', 'select', 'preview', 'applyButton', 'title', 'closeButton', 'caption'].map(key => [key, element()]));
}

for (const [count, readPack] of [[31, realPilot], [43, realWave2]])
test(`all ${count} real cells are selectable, previewed and painted independently through the editor owner`, async () => {
  const { state } = await makeFixture();
  state.riverPaint = normalizeRiverPaintState({ schemaVersion: 1, pack: readPack(), editMode: true });
  const pack = state.riverPaint.pack;
  state.scenarioBaselineHash = pack.source.baselineHash;
  state.activeScenarioManifest = { version: 2, generated_at: '2026-09-27T13:55:57.885587+00:00' };
  state.landData = { type: 'FeatureCollection', features: pack.parents.map(p => feature(p.parentId, p.parentGeometry)) };
  state.landIndex = new Map(state.landData.features.map(f => [f.id, f]));
  const entries = [];
  const editor = createRiverPaintEditorOwner({ state, captureHistoryState: captureCells(state),
    commitHistoryEntry: entry => entries.push(entry), refreshParents() {}, markDirty() {}, addRecentColor() {}, selectColor() {} });
  const nodes = pickerNodes();
  const picker = createRiverCellPicker({ state, ...nodes, d3,
    applyCell: (id, riverCellId) => editor.handleClick({ id, riverCellId, riverPackId: pack.packId }) });
  for (const parent of pack.parents) {
    picker.open(parent.parentId);
    assert.equal(nodes.panel.hidden, false);
    assert.equal(nodes.select.children.length, parent.cells.length);
    for (const cell of parent.cells) {
      const before = { ...state.riverPaint.overrides };
      nodes.select.value = cell.id; nodes.select.listeners.change();
      assert.deepEqual(state.riverPaint.overrides, before, 'selection is read-only');
      assert.equal(nodes.preview.children.length, 2);
      const detailPath = nodes.preview.children[1].children[0].attrs.d;
      assert.ok(detailPath.length > 0 && !/NaN|Infinity/.test(detailPath), 'tiny geometry has a finite magnified preview');
      nodes.applyButton.listeners.click();
      assert.deepEqual(state.riverPaint.overrides, { ...before, [cell.id]: '#0000ff' });
      assert.deepEqual(Object.keys(entries.at(-1).before.riverPaintOverrides), [cell.id]);
    }
  }
  assert.equal(entries.length, count);
  state.currentTool = 'eraser'; nodes.applyButton.listeners.click();
  assert.equal(Object.keys(state.riverPaint.overrides).length, count - 1);
  state.riverPaint.editMode = false; picker.sync();
  assert.equal(nodes.panel.hidden, true); nodes.applyButton.listeners.click();
  assert.equal(entries.length, count + 1);
  picker.dispose();
});

test('cell picker rejects stale packs, readonly startup, country fill and unsupported tools', async () => {
  const { state, pack } = await makeFixture(); const nodes = pickerNodes();
  let livePack = pack, applied = 0;
  const picker = createRiverCellPicker({ state, ...nodes, d3,
    runtime: { getActivePack: () => livePack }, applyCell: () => { applied++; return true; } });
  picker.open('P'); state.interactionGranularity = 'country'; nodes.applyButton.listeners.click();
  state.interactionGranularity = 'subdivision'; state.currentTool = 'brush'; nodes.applyButton.listeners.click();
  state.currentTool = 'fill'; state.startupReadonly = true; nodes.applyButton.listeners.click();
  assert.equal(applied, 0); assert.equal(nodes.panel.hidden, true);
  state.startupReadonly = false; picker.open('P'); livePack = { ...pack };
  nodes.applyButton.listeners.click(); assert.equal(applied, 0); assert.equal(nodes.panel.hidden, true);
  picker.open('P'); nodes.closeButton.listeners.click(); assert.equal(nodes.panel.hidden, true);
  picker.dispose(); assert.deepEqual(nodes.select.listeners, {});
});

test('pilot navigation follows loaded parents, recentres repeatedly and never edits paint', () => {
  const state = { activeScenarioId: 'modern_world', riverPaint: { editMode: false }, currentLanguage: 'en' };
  const button = buttonFixture();
  const locationSelect = { ...buttonFixture(), dataset: {}, value: '',
    ownerDocument: { createElement: () => ({}) },
    replaceChildren(...children) { this.options = children; },
  };
  let pending = false;
  const parents = [{ parentId: 'FR_ARR_75001' }, { parentId: 'DEE0D' }];
  const runtime = { diagnostics: () => ({ active: true, pending }),
    getActivePack: () => ({ parents }), cancel() {} };
  const visits = []; let edits = 0;
  const controls = createRiverPaintControls({ state, button, locationSelect, runtime,
    focusParent: id => { visits.push(id); return true; }, markDirty: () => edits++ });
  assert.equal(locationSelect.hidden, true);
  state.riverPaint.editMode = true; controls.sync();
  assert.equal(locationSelect.hidden, false);
  assert.deepEqual(locationSelect.options.map(option => option.value), ['', 'FR_ARR_75001', 'DEE0D']);
  for (let i = 0; i < 2; i++) {
    locationSelect.value = 'FR_ARR_75001'; locationSelect.listeners.change();
    assert.equal(locationSelect.value, '');
  }
  assert.deepEqual(visits, ['FR_ARR_75001', 'FR_ARR_75001']);
  assert.equal(edits, 0);
  state.currentLanguage = 'zh'; controls.sync();
  assert.equal(locationSelect.attrs['aria-label'], '定位沿河试点');
  assert.equal(locationSelect.options[1].textContent, '巴黎 · 塞纳河');
  pending = true; controls.sync(); assert.equal(locationSelect.disabled, true);
  pending = false; state.startupReadonly = true; controls.sync(); assert.equal(locationSelect.hidden, true);
  state.startupReadonly = false; state.activeScenarioId = 'tno_1962'; controls.sync();
  assert.equal(locationSelect.hidden, true);
  controls.dispose(); assert.deepEqual(locationSelect.listeners, {});
});

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
