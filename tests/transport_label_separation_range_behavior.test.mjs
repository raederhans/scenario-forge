import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTransportWorkbenchDisplayConfigs } from "../js/core/state_defaults.js";
import { resolveTransportWorkbenchLabelSeparation } from "../js/ui/transport_workbench/transport_workbench_density_helpers.js";

const CASES = [
  [0.1, 0.7],
  [1.25, 1.25],
  [9, 1.8],
];

test("persisted and preview label spacing clamp to the same range", () => {
  for (const [input, expected] of CASES) {
    const normalized = normalizeTransportWorkbenchDisplayConfigs({
      airport: { labels: { separationStrength: input } },
    });
    assert.equal(normalized.airport.labels.separationStrength, expected);
    assert.equal(resolveTransportWorkbenchLabelSeparation({ labelSeparation: input }), expected);
  }
});
