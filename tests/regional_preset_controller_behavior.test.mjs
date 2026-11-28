import test from "node:test";
import assert from "node:assert/strict";
import { createRegionalPresetController } from "../js/ui/sidebar/regional_preset_controller.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function createHarness({ scenarioMetaByCode }) {
  const runtimeState = { presetsState: { AA: [] } };
  const controller = createRegionalPresetController(runtimeState, {
    t: text => text,
    normalizeCountryCode: normalizeCode,
    getScenarioCountryMeta: code => scenarioMetaByCode[code],
    resolveFeatureIdsFromPresetSource: source => source.ids,
  });
  return { controller };
}

test("generated core references resolve selected and default boundary variants", () => {
  const selectedMeta = {
    tag: "CORE",
    release_lookup_iso2: "AA",
    selected_boundary_variant_id: "selected",
    default_boundary_variant_id: "default",
    boundary_variants: [
      { id: "default", preset_source: { ids: ["default-id"] } },
      { id: "selected", preset_source: { ids: ["selected-id"] } },
    ],
  };
  const selectedHarness = createHarness({
    scenarioMetaByCode: { CORE: selectedMeta },
  });
  const selected = selectedHarness.controller.getPrimaryReleasablePresetRef({
    code: "CORE",
    presetLookupCode: "AA",
  });

  assert.equal(selected.presetIndex, -1);
  assert.equal(selected.preset.boundary_variant_id, "selected");
  assert.deepEqual(selected.preset.ids, ["selected-id"]);

  const defaultMeta = {
    tag: "CORE",
    default_boundary_variant_id: "default",
    boundary_variants: [
      { id: "first", preset_source: { ids: ["first-id"] } },
      { id: "default", preset_source: { ids: ["default-id"] } },
    ],
  };
  const defaultHarness = createHarness({ scenarioMetaByCode: { CORE: defaultMeta } });
  const defaultRef = defaultHarness.controller.getPrimaryReleasablePresetRef({
    code: "CORE",
    presetLookupCode: "AA",
  });
  assert.equal(defaultRef.preset.boundary_variant_id, "default");
  assert.deepEqual(defaultRef.preset.ids, ["default-id"]);
});

test("generated core lookup fails closed when the chosen boundary source resolves no ids", () => {
  const { controller } = createHarness({
    scenarioMetaByCode: {
      CORE: {
        boundary_variants: [{ id: "empty", preset_source: { ids: [] } }],
      },
    },
  });

  const result = controller.getPrimaryReleasablePresetRef({
    code: "CORE",
    presetLookupCode: "AA",
  });

  assert.equal(result, null);
});
