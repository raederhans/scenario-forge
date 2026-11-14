import test from 'node:test';
import assert from 'node:assert/strict';

import { formatScenarioStatusText } from '../js/core/scenario_manager.js';
import { formatScenarioFatalRecoveryMessage } from '../js/core/scenario_recovery.js';
import { state } from '../js/core/state.js';

test('scenario status names the active scenario in both normal and fatal status branches', () => {
  const keys = ['activeScenarioId', 'activeScenarioManifest', 'scenarioFatalRecovery'];
  const saved = Object.fromEntries(keys.map(key => [key, state[key]]));
  try {
    state.activeScenarioId = 'test';
    state.activeScenarioManifest = { display_name: 'Test' };
    state.scenarioFatalRecovery = null;
    assert.equal(formatScenarioStatusText(), 'Test');
    state.scenarioFatalRecovery = {};
    assert.equal(formatScenarioStatusText(), `Test - ${formatScenarioFatalRecoveryMessage({})}`);
    state.activeScenarioId = '';
    assert.equal(formatScenarioStatusText(), formatScenarioFatalRecoveryMessage({}));
  } finally {
    Object.assign(state, saved);
  }
});
