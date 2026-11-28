import assert from "node:assert/strict";
import test from "node:test";
import { createThematicWgiOwner } from "../js/ui/toolbar/thematic_wgi_owner.js";
import { normalizeThematicWgiStyle } from "../js/core/thematic/thematic_wgi_view_model.js";
import { THEMATIC_INDICATORS } from "../js/core/thematic/thematic_indicator_catalog.js";

const MODERN_INDICATORS = THEMATIC_INDICATORS.filter((metric) => metric.family !== "scenario");
const METRIC_IDS = MODERN_INDICATORS.map((metric) => metric.id);

function createHarness(selection) {
  const dirty = [];
  const select = { replaceChildren() {}, addEventListener() {} };
  const state = {
    activeScenarioId: "modern_world",
    styleConfig: { thematic: selection },
  };
  const owner = createThematicWgiOwner({
    runtimeState: state,
    documentRef: {
      getElementById: (id) => id === "thematicWgiMetric" ? select : null,
      createElement: () => ({}),
    },
    markDirty: (reason) => dirty.push(reason),
    ensureData: async () => {},
  });
  return { state, owner, dirty, select };
}

test("supported saved metrics restore without dirtying or rewriting the selection", () => {
  for (const metricId of METRIC_IDS) {
    const selection = normalizeThematicWgiStyle({ enabled: true, metricId });
    const h = createHarness(selection);
    h.owner.render();
    assert.strictEqual(h.state.styleConfig.thematic, selection);
    assert.equal(h.select.value, metricId);
    assert.deepEqual(h.dirty, []);
  }
});

test("unknown saved metric remains unchanged on restore", () => {
  const selection = normalizeThematicWgiStyle({ enabled: true, metricId: "future-metric", dataVersion: "future-version" });
  const h = createHarness(selection);
  h.owner.render();
  assert.strictEqual(h.state.styleConfig.thematic, selection);
  assert.equal(h.select.value, "future-metric");
});
