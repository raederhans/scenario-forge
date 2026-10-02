import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeFixture, d3, realPilot, realWave2, captureCells, feature } from './helpers/river_paint_fixture.mjs';
import { createRiverCellPicker } from '../js/ui/river_cell_picker.js';
import { createRiverPaintEditorOwner } from '../js/core/river_paint/editor_owner.js';
import { normalizeRiverPaintState } from '../js/core/river_paint/partition_model.js';
import { createRiverPaintControls } from '../js/ui/river_paint_controls.js';
import { createRiverPaintRenderOwner } from '../js/core/river_paint/render_owner.js';
import { applyRiverCellPaintState } from '../js/core/state/actions/river_paint_actions.js';
import { getUniqueLegendColors } from '../js/core/legend_state_normalizers.js';
import { getRiverPaintLocations, filterRiverPaintLocations, RIVER_PAINT_RIVERS } from '../js/ui/river_paint_locations.js';
import { RIVER_PAINT_LOCATION_ROWS } from '../js/ui/river_paint_location_data.js';

function buttonFixture() {
  const attrs = {}, listeners = {}, classes = new Set();
  return { attrs, listeners, disabled: false, textContent: '', title: '',
    classList: { toggle(key, on) { if (on) classes.add(key); else classes.delete(key); } },
    setAttribute(key, value) { attrs[key] = value; },
    addEventListener(key, fn) { listeners[key] = fn; }, removeEventListener(key) { delete listeners[key]; } };
}

function pickerNodes() {
  const element = () => ({ ...buttonFixture(), value: '', children: [], dataset: {},
    ownerDocument: { createElement: () => element(), createElementNS: () => element() },
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); },
  });
  return Object.fromEntries(['panel', 'select', 'preview', 'applyButton', 'title', 'closeButton', 'caption'].map(key => [key, element()]));
}

const readSelection = name => JSON.parse(readFileSync(new URL(`../tools/river_partitions/selections/${name}.json`, import.meta.url)));
const reviewedIds = () => readSelection('wave3-reviewed').parents;
function navigationNodes() {
  const elements = pickerNodes();
  return { button: buttonFixture(), navigationPanel: elements.panel, searchInput: elements.title,
    riverSelect: elements.select, locationSelect: elements.preview, resultsNode: elements.caption, locationButton: elements.closeButton };
}
const options = select => select.children.filter(option => option.value).map(option => option.value);
function navigationHarness(pack = realWave2(), extra = {}) {
  const nodes = navigationNodes(), visits = [], labels = [], notices = [];
  const state = { activeScenarioId: 'modern_world', currentLanguage: 'en', startupReadonly: false,
    riverPaint: { editMode: true, overrides: { saved: '#abcdef' } } };
  let livePack = pack, pending = false, loads = 0;
  const runtime = { diagnostics: () => ({ active: !!livePack, pending }), getActivePack: () => livePack,
    cancel() {}, setMode(value) { state.riverPaint.editMode = value; },
    async enable() { loads++; state.riverPaint.editMode = true; return { ready: true, geometryChanged: false }; } };
  const controls = createRiverPaintControls({ state, ...nodes, runtime,
    focusParent: id => { visits.push(id); return true; },
    onLocation: (id, value) => { labels.push(value); }, announce: notice => notices.push(notice), ...extra });
  return { state, nodes, visits, labels, notices, controls, runtime,
    replacePack(value) { livePack = value; }, setPending(value) { pending = value; }, loads: () => loads };
}

test('location metadata covers exactly the 302 reviewed parents and independently checked river associations', () => {
  const ids = reviewedIds();
  assert.equal(RIVER_PAINT_LOCATION_ROWS.length, 302);
  assert.deepEqual(RIVER_PAINT_LOCATION_ROWS.map(row => row[0]).sort(), [...ids].sort());
  const locations = getRiverPaintLocations({ parents: ids.map(parentId => ({ parentId })) });
  assert.equal(locations.length, 302);
  assert.equal(new Set(locations.map(location => location.id)).size, 302);
  const associations = new Map();
  const add = (id, river) => {
    if (!associations.has(id)) associations.set(id, new Set());
    associations.get(id).add(river);
  };
  for (const river of readSelection('europe').rivers) {
    for (const parent of river.selectedParents) add(parent.parentId, river.river);
    for (const id of river.existingApprovedParentIds) add(id, river.river);
  }
  for (const reach of readSelection('china').reaches) {
    for (const id of [...reach.admitParentIds, ...reach.retainedParentIds]) {
      add(id, reach.id.startsWith('yangtze-') ? 'Yangtze' : 'Huang');
    }
  }
  for (const record of readSelection('eastern-europe').records) {
    if (['offline_candidate', 'existing_approved'].includes(record.status)) add(record.parentId, record.river);
  }
  const source = JSON.parse(readFileSync(new URL('../data/scenarios/modern_world/runtime_topology.topo.json', import.meta.url)));
  const properties = new Map(source.objects.political.geometries.map(g => [g.properties.id, g.properties]));
  for (const location of locations) {
    assert.deepEqual([...location.rivers].sort(), [...associations.get(location.id)].sort(), location.id);
    assert.equal(location.country, properties.get(location.id).cntr_code);
    assert.ok(location.name && location.zh);
  }
  for (const id of ['CN_CITY_17275852B68283317499250', 'CN_CITY_17275852B83584927302596',
    'CN_CITY_17275852B50201707862643', 'CN_CITY_17275852B70463469741157', 'NL226']) {
    assert.ok(!locations.some(location => location.id === id));
  }
  assert.equal(new Set(locations.flatMap(location => location.rivers)).size, 10);
  const rhine = filterRiverPaintLocations(locations, { river: 'Rhine' });
  assert.equal(rhine.length, 9); assert.deepEqual([...new Set(rhine.map(location => location.country))].sort(), ['CH', 'DE']);
  assert.equal(filterRiverPaintLocations(locations, { query: '黄河' }).length, 103);
  assert.equal(filterRiverPaintLocations(locations, { query: 'Yellow River' }).length, 103);
  assert.equal(locations.find(location => location.id === 'FR_ARR_10002').zh, 'Nogent-sur-Seine', 'unverified translation falls back to the source name');
});

test('default 12 parents support name/ID search, empty results, cross-river filters and multilingual labels', () => {
  const h = navigationHarness(), { searchInput, riverSelect, locationSelect, resultsNode } = h.nodes;
  assert.equal(options(locationSelect).length, 12);
  assert.equal(options(riverSelect).length, 6);
  const query = value => { searchInput.value = value; searchInput.listeners.input(); };
  query('pArIs'); assert.deepEqual(options(locationSelect), ['FR_ARR_75001']);
  query('fr_arr_76003'); assert.deepEqual(options(locationSelect), ['FR_ARR_76003']);
  query('不存在'); assert.deepEqual(options(locationSelect), []);
  assert.equal(locationSelect.disabled, true); assert.match(resultsNode.textContent, /No matching/);
  query('巴黎'); assert.deepEqual(options(locationSelect), ['FR_ARR_75001']);
  riverSelect.value = 'Elbe'; riverSelect.listeners.change(); assert.deepEqual(options(locationSelect), []);
  query(''); assert.deepEqual(options(locationSelect), ['DEE06', 'DEE0D']);
  riverSelect.value = 'Oder'; riverSelect.listeners.change();
  assert.deepEqual(options(locationSelect), ['PL_POW_0264', 'PL_POW_1661']);
  query('wroclaw'); assert.deepEqual(options(locationSelect), ['PL_POW_0264'], 'accent-insensitive matching');
  h.state.currentLanguage = 'zh'; h.controls.sync();
  assert.equal(searchInput.value, 'wroclaw'); assert.equal(riverSelect.value, 'Oder');
  assert.equal(riverSelect.children.find(option => option.value === 'Oder').textContent, '奥德河');
  assert.equal(locationSelect.children[1].textContent, '弗罗茨瓦夫 · 奥德河 · PL');
  assert.equal(searchInput.attrs['aria-label'], '搜索地点名称或 ID');
  assert.match(resultsNode.textContent, /1 \/ 12/);
  locationSelect.value = 'PL_POW_0264'; locationSelect.listeners.change();
  assert.equal(h.nodes.locationButton.disabled, false);
  locationSelect.value = ''; locationSelect.listeners.change();
  assert.equal(h.nodes.locationButton.disabled, true);
  assert.deepEqual(h.state.riverPaint.overrides, { saved: '#abcdef' });
  h.controls.dispose();
  assert.deepEqual(searchInput.listeners, {}); assert.deepEqual(riverSelect.listeners, {});
});

test('every injected reviewed parent can be found, repeatedly located and opened in the tiny-cell picker', async () => {
  const { pack: sample, cells } = await makeFixture();
  // Full 302-parent navigation fixture, with synthetic cell geometries. Production
  // 905-cell geometry/click/contour acceptance belongs to the integration E2E lane.
  const pack = { parents: reviewedIds().map(parentId => ({ parentId,
    parentGeometry: sample.parents[0].parentGeometry,
    cells: cells.map((cell, index) => ({ ...cell, id: `fixture:${parentId}:${index}`,
      geometry: index ? { type: 'Polygon', coordinates: [[[0, 0], [0, 0.000001], [0.000001, 0.000001], [0.000001, 0], [0, 0]]] } : cell.geometry })) })) };
  const h = navigationHarness(pack), nodes = pickerNodes(), painted = [];
  const picker = createRiverCellPicker({ state: h.state, ...nodes, d3, runtime: h.runtime,
    applyCell: (id, cellId) => { painted.push([id, cellId]); return true; } });
  h.state.currentTool = 'fill'; h.state.interactionGranularity = 'subdivision';
  h.controls.dispose();
  const controls = createRiverPaintControls({ state: h.state, ...h.nodes, runtime: h.runtime,
    focusParent: id => { h.visits.push(id); return true; }, onLocation: picker.open, onSync: picker.sync });
  assert.equal(options(h.nodes.locationSelect).length, 302);
  assert.deepEqual(options(h.nodes.riverSelect).sort(), Object.keys(RIVER_PAINT_RIVERS).sort());
  for (const parent of pack.parents) {
    h.nodes.searchInput.value = parent.parentId; h.nodes.searchInput.listeners.input();
    assert.deepEqual(options(h.nodes.locationSelect), [parent.parentId]);
    for (let repeat = 0; repeat < 2; repeat++) {
      if (!repeat) { h.nodes.locationSelect.value = parent.parentId; h.nodes.locationSelect.listeners.change(); }
      else { assert.equal(h.nodes.locationButton.disabled, false); h.nodes.locationButton.listeners.click(); }
      assert.equal(h.nodes.locationSelect.value, parent.parentId);
      assert.equal(nodes.panel.hidden, false); assert.equal(nodes.select.children.length, 2);
    }
    nodes.select.value = parent.cells[1].id; nodes.select.listeners.change();
    assert.ok(nodes.preview.children[1].children[0].attrs.d.length > 0);
    assert.doesNotMatch(nodes.preview.children[1].children[0].attrs.d, /NaN|Infinity/);
    nodes.applyButton.listeners.click();
    assert.deepEqual(painted.at(-1), [parent.parentId, parent.cells[1].id]);
  }
  assert.equal(h.visits.length, 604); assert.equal(painted.length, 302);
  controls.dispose(); picker.dispose();
});

test('save/pack replacement, tool toggles and scene/readonly/loading changes clear stale navigation and picker options', async () => {
  const h = navigationHarness({ parents: reviewedIds().map(parentId => ({ parentId })) });
  const { searchInput, riverSelect, locationSelect, navigationPanel } = h.nodes;
  const nodes = pickerNodes();
  const picker = createRiverCellPicker({ state: h.state, ...nodes, runtime: h.runtime, applyCell() {} });
  h.controls.dispose();
  const controls = createRiverPaintControls({ state: h.state, ...h.nodes, runtime: h.runtime,
    focusParent: id => { h.visits.push(id); return true; }, onLocation: picker.open, onSync: picker.sync });
  searchInput.value = 'Danube'; searchInput.listeners.input();
  riverSelect.value = 'Danube'; riverSelect.listeners.change();
  const staleId = options(locationSelect)[0];
  // A project can change between the DOM event and its next UI refresh.
  h.replacePack(realWave2()); locationSelect.value = staleId; locationSelect.listeners.change();
  assert.equal(h.visits.length, 0); assert.equal(searchInput.value, ''); assert.equal(riverSelect.value, '');
  assert.equal(options(locationSelect).length, 12); assert.ok(!options(riverSelect).includes('Danube'));
  h.replacePack(realPilot()); controls.sync();
  assert.equal(options(locationSelect).length, 6);
  searchInput.value = 'Luzhou'; searchInput.listeners.input(); assert.equal(options(locationSelect).length, 0);
  searchInput.value = ''; searchInput.listeners.input();
  locationSelect.value = options(locationSelect)[0]; locationSelect.listeners.change();
  assert.equal(nodes.panel.hidden, false);
  h.state.currentLanguage = 'zh'; controls.sync(); assert.match(nodes.select.attrs['aria-label'], /选择/);
  h.replacePack(realWave2()); controls.sync();
  assert.equal(nodes.panel.hidden, true); assert.equal(nodes.select.children.length, 0); assert.equal(nodes.applyButton.disabled, true);
  const paint = { ...h.state.riverPaint.overrides };
  await controls.toggle(); assert.equal(navigationPanel.hidden, true); assert.equal(locationSelect.children.length, 1);
  await controls.toggle(); assert.equal(options(locationSelect).length, 12); assert.deepEqual(h.state.riverPaint.overrides, paint);
  for (const change of [() => { h.setPending(true); }, () => { h.state.startupReadonly = true; },
    () => { h.state.activeScenarioId = 'tno_1962'; }]) {
    change(); controls.sync(); assert.equal(navigationPanel.hidden, true); assert.equal(locationSelect.disabled, true);
    assert.equal(locationSelect.children.length, 1); assert.equal(options(riverSelect).length, 0);
    h.setPending(false); h.state.startupReadonly = false; h.state.activeScenarioId = 'modern_world'; controls.sync();
    assert.equal(options(locationSelect).length, 12);
  }
  controls.dispose(); picker.dispose();
});

test('unknown parents in self-contained packs remain reachable by ID without invented river labels', () => {
  const h = navigationHarness({ parents: [{ parentId: 'custom-parent' }] });
  assert.deepEqual(options(h.nodes.locationSelect), ['custom-parent']);
  assert.equal(h.nodes.locationSelect.children[1].textContent, 'custom-parent');
  assert.deepEqual(options(h.nodes.riverSelect), []);
  h.nodes.locationSelect.value = 'custom-parent'; h.nodes.locationSelect.listeners.change();
  assert.deepEqual(h.visits, ['custom-parent']); h.controls.dispose();
});

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
  const pack = { parents };
  const runtime = { diagnostics: () => ({ active: true, pending }),
    getActivePack: () => pack, cancel() {} };
  const visits = []; let edits = 0;
  const controls = createRiverPaintControls({ state, button, locationSelect, runtime,
    focusParent: id => { visits.push(id); return true; }, markDirty: () => edits++ });
  assert.equal(locationSelect.hidden, true);
  state.riverPaint.editMode = true; controls.sync();
  assert.equal(locationSelect.hidden, false);
  assert.deepEqual(locationSelect.options.map(option => option.value), ['', 'FR_ARR_75001', 'DEE0D']);
  for (let i = 0; i < 2; i++) {
    locationSelect.value = 'FR_ARR_75001'; locationSelect.listeners.change();
    assert.equal(locationSelect.value, 'FR_ARR_75001');
  }
  assert.deepEqual(visits, ['FR_ARR_75001', 'FR_ARR_75001']);
  assert.equal(edits, 0);
  state.currentLanguage = 'zh'; controls.sync();
  assert.equal(locationSelect.attrs['aria-label'], '定位沿河地点');
  assert.equal(locationSelect.options[1].textContent, '巴黎 · 塞纳河 · FR');
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
