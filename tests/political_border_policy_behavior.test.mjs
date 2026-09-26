import test from 'node:test';
import assert from 'node:assert/strict';
import { isPoliticalBorderEnabled, separatesPoliticalBorders } from '../js/core/renderer/political_border_policy.js';

test('auto enables political borders for real scenarios and keeps blank drawing merged', () => {
  assert.equal(isPoliticalBorderEnabled({activeScenarioId:'tno',mapSemanticMode:'political'}), true);
  assert.equal(isPoliticalBorderEnabled({activeScenarioId:'',mapSemanticMode:'political'}), false);
  assert.equal(isPoliticalBorderEnabled({activeScenarioId:'blank_base',mapSemanticMode:'political'}), false);
  assert.equal(isPoliticalBorderEnabled({activeScenarioId:'tno',mapSemanticMode:'blank'}), false);
});

test('political visibility never changes the scene paint separation', () => {
  for (const political of ['auto','on','off']) {
    const state = {activeScenarioId:'tno',styleConfig:{empireBorders:{political}}};
    assert.equal(separatesPoliticalBorders(state), true);
    assert.equal(separatesPoliticalBorders({...state,mapSemanticMode:'blank'}), false);
    assert.equal(separatesPoliticalBorders({...state,activeScenarioId:'blank_base'}), false);
  }
  assert.equal(separatesPoliticalBorders({}), false);
  assert.equal(separatesPoliticalBorders({styleConfig:{empireBorders:{political:'off'}}}), true);
});

test('explicit on and off override auto only outside blank drawing', () => {
  const styleConfig = political => ({empireBorders:{political}});
  assert.equal(isPoliticalBorderEnabled({activeScenarioId:'tno',styleConfig:styleConfig('off')}), false);
  assert.equal(isPoliticalBorderEnabled({activeScenarioId:'',styleConfig:styleConfig('on')}), true);
  assert.equal(isPoliticalBorderEnabled({activeScenarioId:'blank_base',styleConfig:styleConfig('on')}), false);
});
