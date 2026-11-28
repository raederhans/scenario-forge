import test from 'node:test';
import assert from 'node:assert/strict';
import { separatesPoliticalBorders } from '../js/core/renderer/political_border_policy.js';

test('scenario paint separates political borders while blank drawing stays merged', () => {
  const state = { activeScenarioId: 'tno' };
  assert.equal(separatesPoliticalBorders(state), true);
  assert.equal(separatesPoliticalBorders({ ...state, mapSemanticMode: 'blank' }), false);
});
