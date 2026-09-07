import assert from "node:assert/strict";
import test from "node:test";

const READINESS_KEYS = Object.freeze([
  "topologyDetail",
  "topologyBundleMode",
  "detailDeferred",
  "detailPromotionCompleted",
  "detailPromotionInFlight",
  "detailSourceRequested",
]);

const ACTIVATION_KEYS = Object.freeze([
  "activeScenarioId",
  "scenarioBorderMode",
  "activeScenarioManifest",
  "mapSemanticMode",
  "scenarioCountriesByTag",
  "activeScenarioMeshPack",
  "scenarioRuntimeTopologyData",
  "runtimePoliticalTopology",
  "runtimePoliticalMetaSeed",
  "runtimePoliticalFeatureCollectionSeed",
  "scenarioLandMaskData",
  "scenarioContextLandMaskData",
  "scenarioWaterRegionsData",
  "scenarioAtlantropaData",
  "scenarioRuntimeTopologyVersionTag",
  "scenarioLandMaskVersionTag",
  "scenarioContextLandMaskVersionTag",
  "scenarioWaterOverlayVersionTag",
  "scenarioSpecialRegionsData",
  "scenarioReliefOverlaysData",
  "scenarioReliefOverlayRevision",
  "scenarioStrategicValuesData",
  "scenarioStrategicValuesRevision",
  "scenarioDistrictGroupsData",
  "scenarioDistrictGroupByFeatureId",
  "releasableCatalog",
  "scenarioReleasableIndex",
  "scenarioAudit",
  "scenarioImportAudit",
  "scenarioBaselineHash",
  "scenarioBaselineOwnersByFeatureId",
  "scenarioAutoShellOwnerByFeatureId",
  "scenarioBaselineCoresByFeatureId",
  "scenarioShellOverlayRevision",
  "countryNames",
  "sovereigntyByFeatureId",
  "sovereigntyInitialized",
  "visualOverrides",
  "featureOverrides",
  "scenarioGeneratedColorTags",
  "scenarioFixedOwnerColors",
  "sovereignBaseColors",
  "countryBaseColors",
]);

const PRESENTATION_KEYS = Object.freeze([
  "scenarioParentBorderEnabledBeforeActivate",
  "scenarioDisplaySettingsBeforeActivate",
  "scenarioOceanFillBeforeActivate",
  "scenarioOceanStyleBeforeActivate",
  "scenarioPresentationStyleBeforeActivate",
  "activeSovereignCode",
  "selectedWaterRegionId",
  "selectedSpecialRegionId",
  "hoveredWaterRegionId",
  "hoveredSpecialRegionId",
  "selectedInspectorCountryCode",
  "inspectorHighlightCountryCode",
  "inspectorExpansionInitialized",
  "expandedInspectorContinents",
  "expandedInspectorReleaseParents",
  "parentBordersVisible",
  "parentBorderEnabledByCountry",
  "scenarioPaintModeBeforeActivate",
  "paintMode",
  "interactionGranularity",
  "batchFillScope",
  "ui",
  "styleConfig",
  "locales",
  "geoAliasToStableKey",
  "scenarioGeoLocalePatchData",
  "scenarioCityOverridesData",
  "cityLayerRevision",
  "scenarioAuditUi",
  "renderProfile",
  "dynamicBordersEnabled",
  "showCityPoints",
  "showWaterRegions",
  "showScenarioSpecialRegions",
  "showScenarioAtlantropa",
  "showScenarioReliefOverlays",
  "showStrategicResourceMarkers",
  "strategicChoroplethMetric",
]);

const PALETTE_KEYS = Object.freeze([
  "activePaletteId",
  "activePaletteMeta",
  "activePalettePack",
  "activePaletteMap",
  "currentPaletteTheme",
  "activePaletteOceanMeta",
  "fixedPaletteColorsByIso2",
  "resolvedDefaultCountryPalette",
  "paletteLibraryEntries",
  "paletteQuickSwatches",
  "paletteLoadErrorById",
  "legendLabels",
  "legendConfig",
]);

function createAuthorityTarget(keys, absentKey) {
  return Object.fromEntries(
    keys
      .filter((key) => key !== absentKey)
      .map((key) => [key, { version: `before:${key}` }]),
  );
}

function createAuthorityPatch(keys) {
  return Object.fromEntries(
    keys.map((key) => [key, { version: `after:${key}` }]),
  );
}

for (const [kind, title, keys] of [
  ["readiness", "Readiness", READINESS_KEYS],
  ["activation", "Activation", ACTIVATION_KEYS],
  ["presentation", "Presentation", PRESENTATION_KEYS],
  ["palette", "Palette", PALETTE_KEYS],
]) {
  test(`${kind} rejects malformed patches and snapshots before any write`, async () => {
    const actions = await import(`../js/core/state/actions/scenario_${kind}_actions.js`);
    const commit = actions[`commitScenario${title}State`];
    const restore = actions[`restoreScenario${title}State`];
    const prefix = `[scenario_${kind}_actions]`;
    const target = Object.freeze(createAuthorityTarget(keys));
    const before = { ...target };
    const complete = createAuthorityPatch(keys);
    const missing = keys.at(-1);
    const inherited = Object.assign(Object.create({ [missing]: complete[missing] }), complete);
    delete inherited[missing];
    for (const patch of [null, [], 42]) {
      assert.throws(() => commit(target, patch), {
        name: "TypeError", message: `${prefix} patch must be an object`,
      });
    }
    assert.throws(() => commit(target, inherited), {
      message: `${prefix} commitScenario${title}State missing required key: ${missing}`,
    });
    const cases = [
      [null, "TypeError", "snapshot must be an object"],
      [[], "TypeError", "snapshot must be an object"],
      [{ values: [] }, "TypeError", "snapshot.values must be an object"],
      [{ values: null }, "TypeError", "snapshot.values must be an object"],
      // Missing own keys must take precedence over an invalid presentKeys shape.
      [{ values: inherited }, "Error", `restoreScenario${title}State missing snapshot key: ${missing}`],
      [{ values: complete, presentKeys: {} }, "TypeError", "snapshot.presentKeys must be an array or Set"],
      ...[[], new Set()].map((collection) => [
        { values: complete, presentKeys: collection instanceof Set
          ? new Set([...keys, "unknownKey"]) : [...keys, "unknownKey"] },
        "Error", `restoreScenario${title}State contains unknown present key: unknownKey`,
      ]),
    ];
    for (const [snapshot, name, detail] of cases) {
      assert.throws(() => restore(target, snapshot), { name, message: `${prefix} ${detail}` });
      assert.deepEqual(target, before);
    }
  });

  test(`${kind} restores Set presence and own undefined without changing inherited fields`, async () => {
    const actions = await import(`../js/core/state/actions/scenario_${kind}_actions.js`);
    const capture = actions[`captureScenario${title}State`];
    const restore = actions[`restoreScenario${title}State`];
    const [inheritedKey, undefinedKey] = keys;
    const inheritedValue = { inherited: true };
    const prototype = { [inheritedKey]: inheritedValue };
    const source = Object.assign(Object.create(prototype), createAuthorityTarget(keys, inheritedKey));
    source[undefinedKey] = undefined;
    const snapshot = capture(source);
    assert.equal(Object.hasOwn(snapshot.values, inheritedKey), true);
    assert.equal(snapshot.presentKeys.includes(inheritedKey), false);
    const presentKeys = new Set(snapshot.presentKeys);
    const target = Object.assign(Object.create(prototype), createAuthorityPatch(keys));
    restore(target, { values: snapshot.values, presentKeys });
    assert.equal(Object.hasOwn(target, inheritedKey), false);
    assert.equal(target[inheritedKey], inheritedValue);
    assert.equal(Object.hasOwn(target, undefinedKey), true);
    assert.equal(target[undefinedKey], undefined);
    assert.deepEqual([...presentKeys], snapshot.presentKeys);
  });
}

function assertCompleteAtomicAuthority({
  keys,
  exportedKeys,
  capture,
  commit,
  restore,
  absentKey,
}) {
  assert.equal(Object.isFrozen(exportedKeys), true);
  assert.deepEqual(exportedKeys, keys);

  const target = createAuthorityTarget(keys, absentKey);
  const snapshot = capture(target);
  assert.deepEqual(Object.keys(snapshot.values), keys);
  assert.deepEqual(
    [...snapshot.presentKeys].sort(),
    keys.filter((key) => key !== absentKey).sort(),
  );

  const patch = createAuthorityPatch(keys);
  commit(target, patch);
  for (const key of keys) {
    assert.equal(Object.prototype.hasOwnProperty.call(target, key), true);
  }

  restore(target, snapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(target, absentKey), false);
  for (const key of keys.filter((key) => key !== absentKey)) {
    assert.deepEqual(target[key], { version: `before:${key}` });
  }

  const incompletePatch = createAuthorityPatch(keys);
  delete incompletePatch[keys[0]];
  assert.throws(
    () => commit(target, incompletePatch),
    new RegExp(`missing required key: ${keys[0]}`),
  );
}

test("scenario readiness authority uses one complete catalog for capture, commit, and restore", async () => {
  const {
    SCENARIO_READINESS_STATE_KEYS,
    captureScenarioReadinessState,
    commitScenarioReadinessState,
    restoreScenarioReadinessState,
  } = await import("../js/core/state/actions/scenario_readiness_actions.js");

  assertCompleteAtomicAuthority({
    keys: READINESS_KEYS,
    exportedKeys: SCENARIO_READINESS_STATE_KEYS,
    capture: captureScenarioReadinessState,
    commit: commitScenarioReadinessState,
    restore: restoreScenarioReadinessState,
    absentKey: "topologyDetail",
  });
});

test("scenario activation authority uses one complete catalog for capture, commit, and restore", async () => {
  const {
    SCENARIO_ACTIVATION_STATE_KEYS,
    captureScenarioActivationState,
    commitScenarioActivationState,
    restoreScenarioActivationState,
  } = await import("../js/core/state/actions/scenario_activation_actions.js");

  assertCompleteAtomicAuthority({
    keys: ACTIVATION_KEYS,
    exportedKeys: SCENARIO_ACTIVATION_STATE_KEYS,
    capture: captureScenarioActivationState,
    commit: (target, patch) => commitScenarioActivationState(target, {
      ...patch,
      useDefaultRuntimePoliticalTopology: false,
    }),
    restore: restoreScenarioActivationState,
    absentKey: "runtimePoliticalMetaSeed",
  });
});

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

  for (const key of ACTIVATION_KEYS) assert.deepEqual(target[key], patch[key], key);
  assert.equal(target.intensityFields, intensityFields);
  assert.equal(target.activeSovereignCode, "GER");
});

test("incomplete scenario activation patches fail before writing any staged field", async () => {
  const { commitScenarioActivationState } = await import("../js/core/state/actions/scenario_activation_actions.js");
  for (const missingKey of [...ACTIVATION_KEYS, "useDefaultRuntimePoliticalTopology"]) {
    const target = Object.freeze(createAuthorityTarget(ACTIVATION_KEYS));
    const patch = { ...createAuthorityPatch(ACTIVATION_KEYS), useDefaultRuntimePoliticalTopology: false };
    delete patch[missingKey];
    assert.throws(() => commitScenarioActivationState(target, patch), {
      message: `[scenario_activation_actions] commitScenarioActivationState missing required key: ${missingKey}`,
    });
  }
});

test("scenario activation commit preserves legacy shallow-copy isolation for mutable collections", async () => {
  const {
    commitScenarioActivationState,
  } = await import("../js/core/state/actions/scenario_activation_actions.js");

  const sharedOwnerMap = { A: "FRA" };
  const sharedColorMap = { FRA: "#0055aa" };
  const generatedColorTags = ["FRA"];
  const baselineCores = { A: ["FRA"] };
  const patch = {
    ...createAuthorityPatch(ACTIVATION_KEYS),
    useDefaultRuntimePoliticalTopology: false,
    scenarioBaselineOwnersByFeatureId: sharedOwnerMap,
    scenarioAutoShellOwnerByFeatureId: { A: "FRA" },
    scenarioBaselineCoresByFeatureId: baselineCores,
    countryNames: { FRA: "France" },
    sovereigntyByFeatureId: sharedOwnerMap,
    visualOverrides: { A: { fill: "#0055aa" } },
    featureOverrides: { A: { owner: "FRA" } },
    scenarioGeneratedColorTags: generatedColorTags,
    scenarioFixedOwnerColors: sharedColorMap,
    sovereignBaseColors: sharedColorMap,
    countryBaseColors: sharedColorMap,
  };
  const target = {};

  commitScenarioActivationState(target, patch);

  for (const key of [
    "scenarioBaselineOwnersByFeatureId",
    "scenarioAutoShellOwnerByFeatureId",
    "scenarioBaselineCoresByFeatureId",
    "countryNames",
    "sovereigntyByFeatureId",
    "visualOverrides",
    "featureOverrides",
    "scenarioFixedOwnerColors",
    "sovereignBaseColors",
    "countryBaseColors",
  ]) {
    assert.notEqual(target[key], patch[key], `${key} must be shallow-copied`);
    assert.deepEqual(target[key], patch[key]);
  }
  assert.notEqual(target.scenarioGeneratedColorTags, generatedColorTags);
  assert.deepEqual(target.scenarioGeneratedColorTags, ["FRA"]);

  assert.notEqual(
    target.scenarioBaselineOwnersByFeatureId,
    target.sovereigntyByFeatureId,
  );
  assert.notEqual(
    target.scenarioFixedOwnerColors,
    target.sovereignBaseColors,
  );
  assert.notEqual(
    target.scenarioFixedOwnerColors,
    target.countryBaseColors,
  );
  assert.notEqual(
    target.sovereignBaseColors,
    target.countryBaseColors,
  );

  sharedOwnerMap.A = "GER";
  sharedColorMap.FRA = "#ffffff";
  generatedColorTags.push("GER");
  assert.equal(target.scenarioBaselineOwnersByFeatureId.A, "FRA");
  assert.equal(target.sovereigntyByFeatureId.A, "FRA");
  assert.equal(target.scenarioFixedOwnerColors.FRA, "#0055aa");
  assert.equal(target.sovereignBaseColors.FRA, "#0055aa");
  assert.equal(target.countryBaseColors.FRA, "#0055aa");
  assert.deepEqual(target.scenarioGeneratedColorTags, ["FRA"]);

  assert.equal(
    target.scenarioBaselineCoresByFeatureId.A,
    baselineCores.A,
    "legacy clone remains shallow",
  );
});

test("scenario activation commit resolves the current default political topology at the action boundary", async () => {
  const {
    commitScenarioActivationState,
  } = await import("../js/core/state/actions/scenario_activation_actions.js");
  const currentDefaultTopology = { objects: { political: { current: true } } };
  const staleFallbackTopology = { objects: { political: { stale: true } } };
  const target = {
    defaultRuntimePoliticalTopology: currentDefaultTopology,
    runtimePoliticalTopology: { objects: { political: { previous: true } } },
  };
  const patch = {
    ...createAuthorityPatch(ACTIVATION_KEYS),
    runtimePoliticalTopology: staleFallbackTopology,
    useDefaultRuntimePoliticalTopology: true,
  };

  commitScenarioActivationState(target, patch);

  assert.equal(target.runtimePoliticalTopology, currentDefaultTopology);
});

test("scenario activation commit keeps staged political topology ahead of the default", async () => {
  const {
    commitScenarioActivationState,
  } = await import("../js/core/state/actions/scenario_activation_actions.js");
  const stagedTopology = { objects: { political: { staged: true } } };
  const target = {
    defaultRuntimePoliticalTopology: { objects: { political: { default: true } } },
  };
  const patch = {
    ...createAuthorityPatch(ACTIVATION_KEYS),
    runtimePoliticalTopology: stagedTopology,
    useDefaultRuntimePoliticalTopology: false,
  };

  commitScenarioActivationState(target, patch);

  assert.equal(target.runtimePoliticalTopology, stagedTopology);
});

test("scenario activation rollback phases preserve the audit and color-dirty boundaries", async () => {
  const {
    captureScenarioActivationState,
    restoreScenarioActivationAfterColorDirtyState,
    restoreScenarioActivationBeforeAuditState,
    restoreScenarioActivationBeforeColorDirtyState,
  } = await import("../js/core/state/actions/scenario_activation_actions.js");

  const source = createAuthorityTarget(ACTIVATION_KEYS);
  const snapshot = captureScenarioActivationState(source);
  const target = {};

  restoreScenarioActivationBeforeAuditState(target, snapshot);
  assert.equal(target.scenarioAudit, source.scenarioAudit);
  assert.equal(Object.hasOwn(target, "scenarioImportAudit"), false);

  restoreScenarioActivationBeforeColorDirtyState(target, snapshot);
  assert.equal(target.scenarioImportAudit, source.scenarioImportAudit);
  assert.equal(target.countryBaseColors, source.countryBaseColors);

  const restoredKeysBeforeCompatibilityPhase = Object.keys(target).sort();
  restoreScenarioActivationAfterColorDirtyState(target, snapshot);
  assert.deepEqual(Object.keys(target).sort(), restoredKeysBeforeCompatibilityPhase);
});

test("scenario presentation authority uses one complete catalog for capture, commit, and restore", async () => {
  const {
    SCENARIO_PRESENTATION_STATE_KEYS,
    captureScenarioPresentationState,
    commitScenarioPresentationState,
    restoreScenarioPresentationState,
  } = await import("../js/core/state/actions/scenario_presentation_actions.js");

  assertCompleteAtomicAuthority({
    keys: PRESENTATION_KEYS,
    exportedKeys: SCENARIO_PRESENTATION_STATE_KEYS,
    capture: captureScenarioPresentationState,
    commit: commitScenarioPresentationState,
    restore: restoreScenarioPresentationState,
    absentKey: "scenarioPresentationStyleBeforeActivate",
  });
});

test("scenario presentation commit and full restore preserve exact container identities", async () => {
  const {
    captureScenarioPresentationState,
    commitScenarioPresentationState,
    restoreScenarioPresentationState,
  } = await import("../js/core/state/actions/scenario_presentation_actions.js");
  const target = createAuthorityTarget(PRESENTATION_KEYS);
  const snapshot = captureScenarioPresentationState(target);
  const patch = createAuthorityPatch(PRESENTATION_KEYS);
  const identityKeys = [
    "parentBordersVisible",
    "parentBorderEnabledByCountry",
    "ui",
    "styleConfig",
    "showCityPoints",
    "showWaterRegions",
    "showScenarioSpecialRegions",
    "showScenarioAtlantropa",
    "showScenarioReliefOverlays",
    "showStrategicResourceMarkers",
    "strategicChoroplethMetric",
  ];

  commitScenarioPresentationState(target, patch);
  for (const key of identityKeys) {
    assert.equal(target[key], patch[key], `commit identity drifted for ${key}`);
  }

  restoreScenarioPresentationState(target, snapshot);
  for (const key of identityKeys) {
    assert.equal(
      target[key],
      snapshot.values[key],
      `restore identity drifted for ${key}`,
    );
  }
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

test("scenario palette authority owns complete atomic writes and clones mutable load errors", async () => {
  const {
    SCENARIO_PALETTE_STATE_KEYS,
    captureScenarioPaletteState,
    commitScenarioPaletteState,
    restoreScenarioPaletteState,
  } = await import("../js/core/state/actions/scenario_palette_actions.js");

  const absentKey = "activePaletteOceanMeta";
  const target = createAuthorityTarget(PALETTE_KEYS, absentKey);
  target.paletteLoadErrorById = {
    tno: { message: "before" },
  };
  const snapshot = captureScenarioPaletteState(target, {
    clonePaletteLoadErrorById: (value) => structuredClone(value),
  });

  assert.equal(Object.isFrozen(SCENARIO_PALETTE_STATE_KEYS), true);
  assert.deepEqual(SCENARIO_PALETTE_STATE_KEYS, PALETTE_KEYS);
  assert.deepEqual(Object.keys(snapshot.values), PALETTE_KEYS);
  assert.notEqual(
    snapshot.values.paletteLoadErrorById,
    target.paletteLoadErrorById,
  );
  assert.deepEqual(snapshot.values.paletteLoadErrorById, {
    tno: { message: "before" },
  });

  target.paletteLoadErrorById.tno.message = "mutated";
  const patch = createAuthorityPatch(PALETTE_KEYS);
  commitScenarioPaletteState(target, patch);
  restoreScenarioPaletteState(target, snapshot);

  assert.equal(Object.prototype.hasOwnProperty.call(target, absentKey), false);
  assert.deepEqual(target.paletteLoadErrorById, {
    tno: { message: "before" },
  });

  const incompletePatch = createAuthorityPatch(PALETTE_KEYS);
  delete incompletePatch.activePaletteId;
  assert.throws(
    () => commitScenarioPaletteState(target, incompletePatch),
    /missing required key: activePaletteId/,
  );

  assert.throws(
    () => restoreScenarioPaletteState(target, {
      values: snapshot.values,
      presentKeys: [...snapshot.presentKeys, "unknownPaletteKey"],
    }),
    /contains unknown present key: unknownPaletteKey/,
  );
});

test("scenario apply request actions write only their exact request-identity fields", async () => {
  const {
    setLatestScenarioApplyRequestState,
    beginScenarioApplyRequestState,
    clearActiveScenarioApplyRequestState,
  } = await import("../js/core/state/actions/scenario_apply_request_actions.js");

  const target = {
    sentinel: "preserved",
    currentScenarioApplyRequestId: 1,
    currentScenarioApplyTargetId: "before",
  };

  assert.equal(
    setLatestScenarioApplyRequestState(target, {
      requestId: 7,
      targetId: " tno_1962 ",
    }),
    7,
  );
  assert.deepEqual(target, {
    sentinel: "preserved",
    currentScenarioApplyRequestId: 1,
    currentScenarioApplyTargetId: "before",
    latestScenarioApplyRequestId: 7,
    latestScenarioApplyTargetId: "tno_1962",
  });

  assert.equal(
    beginScenarioApplyRequestState(target, {
      requestId: 8,
      targetId: "hoi4_1939",
    }),
    8,
  );
  assert.deepEqual(target, {
    sentinel: "preserved",
    currentScenarioApplyRequestId: 8,
    currentScenarioApplyTargetId: "hoi4_1939",
    latestScenarioApplyRequestId: 7,
    latestScenarioApplyTargetId: "tno_1962",
    scenarioApplyInFlight: true,
    scenarioApplyActiveRequestId: 8,
    scenarioApplyActiveTargetId: "hoi4_1939",
  });

  assert.equal(clearActiveScenarioApplyRequestState(target), false);
  assert.deepEqual(target, {
    sentinel: "preserved",
    currentScenarioApplyRequestId: 8,
    currentScenarioApplyTargetId: "hoi4_1939",
    latestScenarioApplyRequestId: 7,
    latestScenarioApplyTargetId: "tno_1962",
    scenarioApplyInFlight: false,
    scenarioApplyActiveRequestId: 0,
    scenarioApplyActiveTargetId: "",
  });
});
