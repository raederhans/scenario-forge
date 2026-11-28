import { createDefaultRiverPaintState } from "../js/core/river_paint/partition_model.js";
import assert from "node:assert/strict";
import test from "node:test";
import { SCENARIO_ACTIVATION_STATE_KEYS as ACTIVATION_KEYS } from "../js/core/state/actions/scenario_activation_actions.js";
import { SCENARIO_PRESENTATION_STATE_KEYS as PRESENTATION_KEYS } from "../js/core/state/actions/scenario_presentation_actions.js";

function createAuthorityPatch(keys) {
  return Object.fromEntries(
    keys.map((key) => [key, key === "riverPaint" ? createDefaultRiverPaintState() : { version: `after:${key}` }]),
  );
}

test("scenario activation commits staged fields without touching unrelated or presentation state", async () => {
  const { commitScenarioActivationState } = await import("../js/core/state/actions/scenario_activation_actions.js");
  const intensityFields = { channels: { physicalAtlas: { enabled: true } } };
  const target = { intensityFields, activeSovereignCode: "GER" };
  const patch = {
    ...createAuthorityPatch(ACTIVATION_KEYS),
    useDefaultRuntimePoliticalTopology: false,
    activeScenarioId: "tno_1962",
    scenarioBorderMode: "scenario_owner_only",
    scenarioRuntimeTopologyVersionTag: "runtime-v1",
    scenarioReliefOverlayRevision: 4,
    scenarioDistrictGroupByFeatureId: new Map([["A", "group-a"]]),
    scenarioGeneratedColorTags: ["FRA"],
  };

  commitScenarioActivationState(target, patch);
  assert.deepEqual(target.activeScenarioId, patch.activeScenarioId);
  assert.equal(target.intensityFields, intensityFields);
  assert.equal(target.activeSovereignCode, "GER");
});

test("incomplete scenario activation patches fail before writing any staged field", async () => {
  const { commitScenarioActivationState } = await import("../js/core/state/actions/scenario_activation_actions.js");
  const missingKey = "activeScenarioId";
  const target = Object.freeze({ activeScenarioId: "before" });
  const patch = { ...createAuthorityPatch(ACTIVATION_KEYS), useDefaultRuntimePoliticalTopology: false };
  delete patch[missingKey];
  assert.throws(() => commitScenarioActivationState(target, patch), {
    message: `[scenario_activation_actions] commitScenarioActivationState missing required key: ${missingKey}`,
  });
});

test("scenario transaction presentation restore preserves unrelated nested state", async () => {
  const {
    restoreScenarioTransactionPresentationBeforeAuditState,
    restoreScenarioTransactionPresentationState,
  } = await import("../js/core/state/actions/scenario_presentation_actions.js");

  const values = createAuthorityPatch(PRESENTATION_KEYS);
  values.ui = {
    politicalEditingExpanded: true,
    scenarioVisualAdjustmentsOpen: false,
  };
  values.styleConfig = {
    ocean: { fill: "#123456" },
  };
  const target = {
    ui: {
      preservedUiField: "keep",
      politicalEditingExpanded: false,
      scenarioVisualAdjustmentsOpen: true,
    },
    styleConfig: {
      preservedStyleField: "keep",
      ocean: { fill: "#000000" },
    },
  };
  const originalUi = target.ui;
  const originalStyleConfig = target.styleConfig;

  restoreScenarioTransactionPresentationBeforeAuditState(target, {
    values,
    presentKeys: PRESENTATION_KEYS,
  });
  restoreScenarioTransactionPresentationState(target, {
    values,
    presentKeys: PRESENTATION_KEYS,
  });

  assert.equal(target.ui, originalUi);
  assert.equal(target.ui.preservedUiField, "keep");
  assert.equal(target.ui.politicalEditingExpanded, true);
  assert.equal(target.ui.scenarioVisualAdjustmentsOpen, false);
  assert.equal(target.styleConfig, originalStyleConfig);
  assert.equal(target.styleConfig.preservedStyleField, "keep");
  assert.equal(target.styleConfig.ocean, values.styleConfig.ocean);
  assert.equal(
    target.scenarioGeoLocalePatchData,
    values.scenarioGeoLocalePatchData,
  );
  assert.equal(
    target.scenarioCityOverridesData,
    values.scenarioCityOverridesData,
  );
  assert.equal(target.cityLayerRevision, values.cityLayerRevision);
  assert.equal(Object.hasOwn(target, "scenarioAuditUi"), false);
});
