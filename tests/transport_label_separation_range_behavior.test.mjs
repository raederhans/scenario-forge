import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTransportWorkbenchDisplayConfigs } from "../js/core/state_defaults.js";
import { normalizeTransportWorkbenchDensityConfig } from "../js/ui/toolbar/transport_workbench_config_owner.js";
import { resolveTransportWorkbenchLabelSeparation } from "../js/ui/transport_workbench_density_helpers.js";

// State, the workbench config owner and the preview all clamp label separation
// to the same 0.7–1.8 range; a value saved by one layer must survive the others.
const CASES = [
  [0.1, 0.7],
  [1.25, 1.25],
  [9, 1.8],
];

test("persisted display configs clamp label separation to 0.7–1.8 with default 1", () => {
  const defaults = normalizeTransportWorkbenchDisplayConfigs({});
  const familyIds = Object.keys(defaults);
  assert.ok(familyIds.length > 0);
  for (const familyId of familyIds) {
    assert.equal(defaults[familyId].labels.separationStrength, 1, familyId);
    for (const [input, expected] of CASES) {
      const normalized = normalizeTransportWorkbenchDisplayConfigs({
        [familyId]: { labels: { separationStrength: input } },
      });
      assert.equal(normalized[familyId].labels.separationStrength, expected, `${familyId} ${input}`);
    }
  }
});

test("workbench density config clamps label separation to 0.7–1.8 and falls back to 1", () => {
  assert.equal(normalizeTransportWorkbenchDensityConfig({}, {}).labelSeparation, 1);
  for (const [input, expected] of CASES) {
    assert.equal(normalizeTransportWorkbenchDensityConfig({ labelSeparation: input }, {}).labelSeparation, expected);
  }
});

test("preview label placement clamps label separation to 0.7–1.8 and falls back to 1", () => {
  assert.equal(resolveTransportWorkbenchLabelSeparation({}), 1);
  assert.equal(resolveTransportWorkbenchLabelSeparation(null), 1);
  for (const [input, expected] of CASES) {
    assert.equal(resolveTransportWorkbenchLabelSeparation({ labelSeparation: input }), expected);
  }
});
