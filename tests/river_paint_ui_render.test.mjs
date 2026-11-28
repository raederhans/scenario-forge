import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, d3 } from './helpers/river_paint_fixture.mjs';
import { createRiverPaintRenderOwner } from '../js/core/river_paint/render_owner.js';
import { applyRiverCellPaintState } from '../js/core/state/actions/river_paint_actions.js';
import { getUniqueLegendColors } from '../js/core/legend_state_normalizers.js';

function renderHarness(state) {
  const events = [];
  class Path { moveTo() {} lineTo() {} closePath() {} arc() {} }
  const context = { save() { events.push('save'); }, restore() { events.push('restore'); },
    clip(path) { events.push(['clip', path]); }, fill(path) { events.push(['fill', this.fillStyle, path]); }, stroke() {} };
  const path = d3.geoPath(d3.geoEquirectangular().scale(100)).context(context);
  const owner = createRiverPaintRenderOwner({ state, getContext: () => context, getPath: () => path,
    getProjectionKey: () => 'projection-1', createPath: () => new Path(), isEnabled: () => true });
  return { owner, context, path, events };
}

test('renderer clips to the parent, draws each bank with resolved color and restores the d3 context', async () => {
  const { state, cells } = await makeFixture(); const h = renderHarness(state);
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  assert.equal(h.owner.draw(2), 2); assert.equal(h.path.context(), h.context);
  assert.deepEqual(h.events.filter(e => e[0] === 'fill').map(e => e[1]), ['#0000ff', '#ff0000']);
  assert.equal(h.events[0], 'save'); assert.equal(h.events[1][0], 'clip'); assert.equal(h.events.at(-1), 'restore');
});

test('legend consumes actual cell colors, not a hidden parent color, and ignores foreign-scene paint', async () => {
  const { state, cells } = await makeFixture(); state.colors = { P: '#ff0000' };
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  applyRiverCellPaintState(state, cells[1].id, '#00ff00');
  assert.deepEqual(getUniqueLegendColors(state), ['#0000ff', '#00ff00']);
  state.activeScenarioId = 'other'; assert.deepEqual(getUniqueLegendColors(state), ['#ff0000']);
});
