import test from "node:test";
import assert from "node:assert/strict";
import { createRegionalPresetController } from "../js/ui/sidebar/regional_preset_controller.js";

function harness({ meta } = {}) {
  const visible = ["a", "b", "c"];
  const state = {
    presetsState: { AA: [{ name: "Core", ids: ["a"], preset_kind: "releasable_core" }] },
    selectedBoundaryVariantId: "old",
  };
  const controller = createRegionalPresetController(state, {
    t: (text) => text,
    normalizeCountryCode: (code) => String(code).trim().toUpperCase(),
    getScenarioCountryMeta: () => meta,
    resolveFeatureIdsFromPresetSource: source => source?.ids || [],
    filterToVisibleFeatureIds: (ids) => {
      const requestedIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
      return {
        requestedIds, matchedIds: requestedIds.filter((id) => visible.includes(id)),
        missingIds: requestedIds.filter((id) => !visible.includes(id)),
      };
    },
  });
  const country = { code: "AA", selectedBoundaryVariantId: "old" };
  return { plan: options => controller.prepareScenarioCoreApplication(country, options) };
}

test("unknown variant does not silently select the default or stored preset", () => {
  const { plan } = harness({ meta: { boundary_variants: [{ id: "known", preset_source: { ids: ["a"] } }] } });
  for (const variantId of ["unknown", "other"]) {
    assert.equal(plan({ variantId }).reason, "missing-variant");
  }
  assert.equal(plan({ variantId: " KNOWN " }).applied, true);
});

test("preview resolves the exact boundary variant and its assignments", () => {
  const meta = { selected_boundary_variant_id: "old", boundary_variants: [{ id: "new", preset_source: { ids: ["b"] } }] };
  const { plan } = harness({ meta });
  const result = plan({ variantId: "new" });
  assert.deepEqual(result.presetRef.preset.ids, ["b"]);
  assert.deepEqual(result.assignments, { b: { ownerCode: "AA", controllerCode: "AA" } });
});
