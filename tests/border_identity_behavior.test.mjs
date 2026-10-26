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

test('identity index is reused and refreshed by palette identity or revision', () => {
  let scans = 0, revision = 0;
  let colors = new Proxy({ AAA: '#000001' }, { ownKeys(target) { scans++; return Reflect.ownKeys(target); } });
  const resolve = createBorderIdentityResolver({ sovereignBaseColors: () => colors, getRevision: () => revision,
    getReferenceOwner: () => 'BBB', getOverrideColor: () => '#000001' });
  assert.equal(resolve('a'), 'AAA');
  assert.equal(resolve('b'), 'AAA');
  assert.equal(scans, 1);
  colors.AAA = '#000002'; revision++;
  assert.equal(resolve('a'), 'color:#000001');
  assert.equal(scans, 2);
  colors = { CCC: '#000001' };
  assert.equal(resolve('a'), 'CCC');
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

test('ISO aliases keep their shared color and are never border identities', () => {
  const colors = { DE: '#222222', GER: '#222222', AAA: '#222222' };
  const unique = uniquifyScenarioDefaultColors(colors, { tags: new Set(['GER', 'AAA']), preferred: ['GER'] });
  assert.equal(unique.GER, '#222222');
  assert.equal(unique.DE, '#222222');
  assert.notEqual(unique.AAA, '#222222');
  const resolve = createBorderIdentityResolver({ sovereignBaseColors: { DE: '#222222', GER: '#222222' },
    getCountryTags: () => new Set(['GER', 'POL']), getReferenceOwner: () => 'POL', getOverrideColor: () => '#222222' });
  assert.equal(resolve('x'), 'GER');
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
