import test from 'node:test';
import assert from 'node:assert/strict';
import { createBorderIdentityResolver } from '../js/core/renderer/border_identity.js';
import { uniquifyScenarioDefaultColors, commitScenarioActivationState,
  SCENARIO_ACTIVATION_STATE_KEYS, restoreProjectImportFields } from '../js/core/state/actions/scenario_activation_actions.js';

test('border identity uses reference ownership, matching base colors and virtual colors', () => {
  const owners = { a: 'AAA', b: 'BBB', c: 'CCC' };
  const overrides = {};
  const resolve = createBorderIdentityResolver({
    sovereignBaseColors: { BBB: '#Aa0011', AAA: '#aa0011', CCC: '#ffffff' },
    getReferenceOwner: id => owners[id], getOverrideColor: id => overrides[id],
  });
  assert.equal(resolve('b'), 'BBB');
  overrides.b = ' #FFFFFF ';
  assert.equal(resolve('b'), 'CCC');
  overrides.b = '#aa0011';
  assert.equal(resolve('b'), 'BBB');
  overrides.c = ' #AA0011 ';
  assert.equal(resolve('c'), 'AAA');
  overrides.a = ' #AABBCC ';
  assert.equal(resolve('a'), 'color:#aabbcc');
});

test('scenario defaults get deterministic nearest free colors while distinct colors stay intact', () => {
  const colors = { KOR: '#82132e', JAP: '#82132e', AAA: '#82132f', BBB: '#000000', CCC: '#000000' };
  const unique = uniquifyScenarioDefaultColors(colors);
  assert.equal(unique.JAP, '#82132e');
  assert.equal(unique.KOR, '#82132d');
  assert.equal(unique.AAA, colors.AAA);
  assert.equal(unique.BBB, colors.BBB);
  assert.equal(unique.CCC, '#000001');
  assert.equal(new Set(Object.values(unique)).size, 5);
  assert.deepEqual(uniquifyScenarioDefaultColors(Object.fromEntries(Object.entries(colors).reverse())), unique);
  assert.equal(colors.KOR, colors.JAP);
});

test('activation publishes unique defaults, while restoring saved colors preserves them', () => {
  const defaults = { JAP: '#82132e', KOR: '#82132e', POL: '#abcdef' };
  const patch = Object.fromEntries(SCENARIO_ACTIVATION_STATE_KEYS.map(key => [key, undefined]));
  Object.assign(patch, { activeScenarioId: 'test', useDefaultRuntimePoliticalTopology: false,
    sovereignBaseColors: defaults, scenarioFixedOwnerColors: defaults });
  const state = {};
  commitScenarioActivationState(state, patch);
  assert.notEqual(state.sovereignBaseColors.JAP, state.sovereignBaseColors.KOR);
  assert.deepEqual(state.scenarioFixedOwnerColors, state.sovereignBaseColors);
  assert.equal(state.sovereignBaseColors.POL, '#abcdef');
  restoreProjectImportFields(state, { sovereignBaseColors: defaults });
  assert.deepEqual(state.sovereignBaseColors, defaults);
});
