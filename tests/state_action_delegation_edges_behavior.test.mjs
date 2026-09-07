import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { parse } from "acorn";

import {
  STATE_ACTION_DELEGATION_CONTRACT,
  STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT,
  STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT,
  STATE_DETACHED_CAPTURE_CONTRACT,
  STATE_MUTATION_DELEGATING_OWNER_CONTRACT,
  STATE_IMPORTED_PURE_NORMALIZER_CONTRACT,
  STATE_TARGET_PURE_READER_CONTRACT,
  STATE_IMPORTED_BORROWED_PROJECTION_CONTRACT,
  inspectStateImportedBorrowedProjectionSource,
  inspectStateImportedPureNormalizerSource,
  inspectStateDetachedCaptureSource,
  inspectStateMutationDelegatingOwnerSources,
  inspectStateTargetPureReaderFunctionSource,
  validateStateActionModuleSource,
  validateStateActionModulePhaseAdmissions,
  validateStateActionDelegationContract,
  validateStateImportedPureNormalizerContract,
  validateStateDetachedCaptureContract,
  validateStateMutationDelegatingOwnerContract,
  validateStateTargetPureReaderContract,
} from "../tools/state_action_delegation_contract.mjs";
import {
  applyStateWriterBindingFindingContracts,
  discoverStateWriterBindingsForSource,
  normalizeStateActionDelegations,
  scanStateWriterBindingInventoriesBatch,
  validateStateActionNonTargetParameterMutations,
} from "../tools/build_state_writer_policy.mjs";
import {
  scanStateMutationInventory,
  scanStateMutations,
} from "../tools/state_writer_inventory.mjs";

function fingerprintDirectExportedFunction(source, exportName) {
  const normalizedSource = String(source || "").replaceAll("\r\n", "\n");
  const ast = parse(normalizedSource, {
    ecmaVersion: "latest",
    locations: true,
    sourceType: "module",
  });
  const statement = ast.body.find((candidate) => (
    candidate.type === "ExportNamedDeclaration"
    && candidate.declaration?.type === "FunctionDeclaration"
    && candidate.declaration.id?.name === exportName
  ));
  assert.ok(statement, exportName);
  return createHash("sha256")
    .update(normalizedSource.slice(
      statement.declaration.start,
      statement.declaration.end,
    ).trim())
    .digest("hex");
}

test("source-bound detached captures return fresh values and fail closed on alias escape", () => {
  assert.deepEqual(validateStateDetachedCaptureContract(), []);
  assert.deepEqual(
    STATE_DETACHED_CAPTURE_CONTRACT.map(({ modulePath, exportName, targetArgumentIndex }) => ({
      modulePath,
      exportName,
      targetArgumentIndex,
    })),
    [
      ["captureRenderPerfMetricsState", "js/core/state/actions/renderer_diagnostics_actions.js"],
      ["captureRenderPerfContextBreakdownState", "js/core/state/actions/renderer_diagnostics_actions.js"],
      ["captureRenderPerfMetricEntryState", "js/core/state/actions/renderer_diagnostics_actions.js"],
      ["captureProjectedBoundsDiagnosticsState", "js/core/state/actions/renderer_diagnostics_actions.js"],
      ["captureRenderSnapshotState", "js/core/state/actions/renderer_diagnostics_actions.js"],
      ["captureExactAfterSettleControllerState", "js/core/state/actions/renderer_exact_refresh_actions.js"],
      ["serializeSpecialZoneLayersState", "js/core/special_zone_layers.js"],
      ["captureScenarioLayerSaveRequestState", "js/core/special_zone_layers.js"],
    ].map(([exportName, modulePath]) => ({ modulePath, exportName, targetArgumentIndex: 0 })),
  );

  for (const entry of STATE_DETACHED_CAPTURE_CONTRACT) {
    const source = fs.readFileSync(entry.modulePath, "utf8");
    assert.deepEqual(
      inspectStateDetachedCaptureSource(source, entry).violations,
      [],
      entry.exportName,
    );
  }

  const specialZoneEntry = STATE_DETACHED_CAPTURE_CONTRACT.find(
    ({ exportName }) => exportName === "serializeSpecialZoneLayersState",
  );
  const specialZoneSource = fs.readFileSync(specialZoneEntry.modulePath, "utf8");
  assert.ok(inspectStateDetachedCaptureSource(
    specialZoneSource.replace(
      "const normalized = normalizeSpecialZoneLayersState(rawState, options);",
      "const normalized = rawState;",
    ),
    specialZoneEntry,
  ).violations.some(({ code }) => code === "state-detached-capture-source-drift"));
  assert.ok(inspectStateDetachedCaptureSource(
    specialZoneSource.replace(
      "function normalizeSpecialZoneLayersState(rawState, options = {}) {",
      "function normalizeSpecialZoneLayersState(rawState, options = {}) { void options;",
    ),
    specialZoneEntry,
  ).violations.some(({ code }) => code === "state-detached-capture-clone-helper-source-drift"));
  const specialZoneCaller = `
    import { state as runtimeState } from "../core/state.js";
    import { serializeSpecialZoneLayersState } from "../core/special_zone_layers.js";
    const snapshot = serializeSpecialZoneLayersState(runtimeState.specialZoneLayers);
    consumeSnapshot(snapshot);
  `;
  assert.deepEqual(scan(specialZoneCaller).findings, []);
  assert.ok(scan(specialZoneCaller.replace(
    "runtimeState.specialZoneLayers",
    "runtimeState.unregisteredLayers",
  )).findings.some(({ reason }) => reason === "state-alias-escape"));

  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    'import { captureRenderPerfMetricsState as capture } from "../core/state/actions/renderer_diagnostics_actions.js";',
    "const snapshot = capture(runtimeState);",
    "globalThis.snapshot = snapshot;",
    "",
  ].join("\n");
  assert.deepEqual(scan(source).findings, []);
  assert.deepEqual(scan(source).actionDelegations, []);

  const unknownSource = source.replace(
    "captureRenderPerfMetricsState as capture",
    "captureUnknownState as capture",
  );
  assert.ok(scan(unknownSource).findings.some(({ reason }) => (
    reason === "state-alias-escape"
  )));

  const entry = STATE_DETACHED_CAPTURE_CONTRACT.find(({ exportName }) => (
    exportName === "captureRenderPerfMetricsState"
  ));
  const registeredSource = fs.readFileSync(entry.modulePath, "utf8");
  const escapedSource = registeredSource.replace(
    "return cloneDiagnosticValue(metrics);",
    "return metrics;",
  );
  const escapedEntry = {
    ...entry,
    sourceFingerprint: createHash("sha256")
      .update(escapedSource.match(/export function captureRenderPerfMetricsState[\s\S]*?\n}/)[0])
      .digest("hex"),
  };
  assert.ok(inspectStateDetachedCaptureSource(escapedSource, escapedEntry)
    .violations.some(({ code }) => code === "state-detached-capture-alias-escape"));

  const helperEscapeSource = registeredSource.replace(
    "return cloneDiagnosticValue(metrics);",
    "return leakDiagnosticValue(metrics);",
  ).replace(
    "function cloneDiagnosticValue(value, seen = new WeakMap()) {",
    "function leakDiagnosticValue(value) { return value; }\n\nfunction cloneDiagnosticValue(value, seen = new WeakMap()) {",
  );
  const helperEntry = {
    ...entry,
    sourceFingerprint: createHash("sha256")
      .update(helperEscapeSource.match(/export function captureRenderPerfMetricsState[\s\S]*?\n}/)[0])
      .digest("hex"),
  };
  assert.ok(inspectStateDetachedCaptureSource(helperEscapeSource, helperEntry)
    .violations.some(({ code }) => code === "state-detached-capture-alias-escape"));
  assert.ok(inspectStateDetachedCaptureSource(`${registeredSource}\n// drift`, entry)
    .violations.every(({ code }) => code !== "state-detached-capture-source-drift"));
  assert.ok(inspectStateDetachedCaptureSource(
    registeredSource.replace("return cloneDiagnosticValue(metrics);", "return cloneDiagnosticValue(metrics, new WeakMap());"),
    entry,
  ).violations.some(({ code }) => code === "state-detached-capture-source-drift"));

  const runtimeStateDetachedCaptureLeak = [
    "runtimeState",
    ".detachedCaptureLeak = metrics;",
  ].join("");
  assert.equal(
    runtimeStateDetachedCaptureLeak,
    "runtimeState" + ".detachedCaptureLeak = metrics;",
  );
  const semanticBypasses = [
    "globalThis.detachedCaptureLeak = metrics;",
    runtimeStateDetachedCaptureLeak,
    "consumeUnknownCapture(metrics);",
    "const captureAlias = metrics; captureAlias.entries.set('leak', {});",
    "globalThis.readDetachedCapture = () => metrics;",
    "routeDetachedCaptureLeak(metrics);",
  ];
  for (const injectedStatement of semanticBypasses) {
    let bypassSource = registeredSource.replace(
      "return cloneDiagnosticValue(metrics);",
      `${injectedStatement}\n  return cloneDiagnosticValue(metrics);`,
    );
    assert.ok(
      bypassSource.includes(injectedStatement),
      `fixture source contains the exact semantic bypass: ${injectedStatement}`,
    );
    if (injectedStatement.startsWith("routeDetachedCaptureLeak")) {
      bypassSource = bypassSource.replace(
        "function cloneDiagnosticValue(value, seen = new WeakMap()) {",
        [
          "function routeDetachedCaptureLeak(value) {",
          "  globalThis.detachedCaptureLeak = value;",
          "}",
          "",
          "function cloneDiagnosticValue(value, seen = new WeakMap()) {",
        ].join("\n"),
      );
    }
    const refreshedEntry = {
      ...entry,
      sourceFingerprint: fingerprintDirectExportedFunction(
        bypassSource,
        entry.exportName,
      ),
    };
    const inspection = inspectStateDetachedCaptureSource(
      bypassSource,
      refreshedEntry,
    );
    assert.equal(
      inspection.violations.some(
        ({ code }) => code === "state-detached-capture-source-drift",
      ),
      false,
      injectedStatement,
    );
    assert.ok(
      inspection.violations.some(
        ({ code }) => code === "state-detached-capture-alias-escape",
      ),
      injectedStatement,
    );
  }
});

test("registered owner proofs match current composition and factory sources", () => {
  for (const entry of STATE_MUTATION_DELEGATING_OWNER_CONTRACT) {
    assert.deepEqual(inspectStateMutationDelegatingOwnerSources({
      compositionSource: fs.readFileSync(entry.compositionModulePath, "utf8"),
      factorySource: fs.readFileSync(entry.factoryModulePath, "utf8"),
      entry,
    }).violations, [], entry.compositionExportName);
  }
});

test("selection owner proof rejects borrowed getter and facade drift", () => {
  const entry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ compositionExportName }) => compositionExportName === "getSelectionOverlayOwner",
  );
  const compositionSource = fs.readFileSync(entry.compositionModulePath, "utf8");
  const factorySource = fs.readFileSync(entry.factoryModulePath, "utf8");
  for (const [sourceKey, source, before, after, code] of [
    ["compositionSource", compositionSource, "getLandIndex: () => runtimeState.landIndex",
      "getLandIndex: () => runtimeState.landIndex.clear()", "state-mutation-owner-composition-source-drift"],
    ["factorySource", factorySource, "return Object.freeze({",
      "getLandIndex().clear(); return Object.freeze({", "state-mutation-owner-factory-source-drift"],
    ["factorySource", factorySource, "return Object.freeze({",
      "return Object.freeze({ leak: getLandIndex,", "state-mutation-owner-factory-source-drift"],
  ]) {
    assert.ok(source.includes(before), before);
    const result = inspectStateMutationDelegatingOwnerSources({
      compositionSource, factorySource, entry, [sourceKey]: source.replace(before, after),
    });
    assert.ok(result.violations.some((violation) => violation.code === code), after);
  }
});

test("source-bound render perf owner proves factory composition and registered action effects", () => {
  assert.deepEqual(validateStateMutationDelegatingOwnerContract(), []);
  const entry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ compositionExportName }) => compositionExportName === "getRenderPerfMetricsRuntimeOwner",
  );
  assert.deepEqual(entry.methods, [
    "recordRenderPerfMetric",
    "beginContextMetricSession",
    "collectContextMetric",
    "endContextMetricSession",
    "resetContextBreakdownForExactFrame",
  ]);
  assert.deepEqual(entry.actionExports, [
    "commitRenderPerfMetricState",
    "ensureRenderPerfMetricsState",
    "setRenderPerfContextBreakdownState",
  ]);
  const compositionSource = fs.readFileSync(entry.compositionModulePath, "utf8");
  const factorySource = fs.readFileSync(entry.factoryModulePath, "utf8");
  assert.deepEqual(inspectStateMutationDelegatingOwnerSources({
    compositionSource,
    factorySource,
    entry,
  }).violations, []);

  const binding = {
    id: "module:runtimeState",
    kind: "module",
    name: "runtimeState",
    importSource: "./state.js",
    importedName: "state",
  };
  const ownerSlice = compositionSource.match(
    /function getRenderPerfMetricsRuntimeOwner\(\)[\s\S]*?function resetContextBreakdownForExactFrame\(\) \{[^\n]+\}/,
  )[0];
  const scannerFixture = [
    'import { state as runtimeState } from "./state.js";',
    'import { createRenderPerfMetricsRuntimeOwner } from "./renderer/render_perf_metrics_runtime_owner.js";',
    'import { captureRenderPerfContextBreakdownState, commitRenderPerfMetricState, ensureRenderPerfMetricsState, setRenderPerfContextBreakdownState } from "./state/actions/renderer_diagnostics_actions.js";',
    "const CONTEXT_BREAKDOWN_METRIC_NAMES = new Set();",
    "let renderPerfMetricsRuntimeOwner = null;",
    "function mirrorRenderPerfMetricSnapshot() {}",
    ownerSlice,
    "",
  ].join("\n");
  const inventory = scanStateMutationInventory(scannerFixture, {
    filePath: entry.compositionModulePath,
    bindings: [binding],
  });
  const retiredFingerprints = new Set([
    "c3d6a456", "59ffd434", "6394c5b6", "d256fc01", "7e4b9540", "51a3c50e",
  ]);
  assert.deepEqual(inventory.findings.filter(({ sourceFingerprint = "" }) => (
    retiredFingerprints.has(sourceFingerprint.slice(0, 8))
  )), []);
  const ownerFalsePositiveIdentities = new Set([
    '{"kind":"function","ancestry":[{"name":"getRenderPerfMetricsRuntimeOwner","ordinal":0}]}',
    ...entry.methods.map((name) => (
      `{"kind":"function","ancestry":[{"name":"${name}","ordinal":0}]}`
    )),
  ]);
  assert.deepEqual(inventory.findings.filter(({ enclosingFunctionIdentity }) => (
    ownerFalsePositiveIdentities.has(enclosingFunctionIdentity)
  )), []);
  const unknownOwnerInventory = scanStateMutationInventory(
    scannerFixture.replace(
      "createRenderPerfMetricsRuntimeOwner } from",
      "createUnknownRuntimeOwner as createRenderPerfMetricsRuntimeOwner } from",
    ),
    { filePath: entry.compositionModulePath, bindings: [binding] },
  );
  assert.ok(unknownOwnerInventory.findings.length > 0);

  const driftedComposition = compositionSource.replace(
    "mirrorRenderPerfMetrics: mirrorRenderPerfMetricSnapshot,",
    "mirrorRenderPerfMetrics: unknownMirror,",
  );
  assert.ok(inspectStateMutationDelegatingOwnerSources({
    compositionSource: driftedComposition,
    factorySource,
    entry,
  }).violations.some(({ code }) => code === "state-mutation-owner-composition-source-drift"));

  const mutatedFactory = factorySource.replace(
    "function recordRenderPerfMetric(name, durationMs, details = {}) {",
    "function recordRenderPerfMetric(name, durationMs, details = {}) {\n    getters.getRenderPerfMetrics().leak = details;",
  );
  assert.ok(inspectStateMutationDelegatingOwnerSources({
    compositionSource,
    factorySource: mutatedFactory,
    entry,
  }).violations.some(({ code }) => (
    code === "state-mutation-owner-factory-source-drift"
    || code === "state-mutation-owner-direct-mutation"
  )));

  for (const injectedStatement of [
    "const metricsAlias = getters.getRenderPerfMetrics(); metricsAlias.leak = details;",
    "Object.assign(getters.getRenderPerfMetrics(), { leak: details });",
  ]) {
    const bypassFactory = factorySource.replace(
      "function recordRenderPerfMetric(name, durationMs, details = {}) {",
      `function recordRenderPerfMetric(name, durationMs, details = {}) {\n    ${injectedStatement}`,
    );
    const refreshedEntry = {
      ...entry,
      factorySourceFingerprint: fingerprintDirectExportedFunction(
        bypassFactory,
        entry.factoryExportName,
      ),
    };
    const inspection = inspectStateMutationDelegatingOwnerSources({
      compositionSource,
      factorySource: bypassFactory,
      entry: refreshedEntry,
    });
    assert.equal(
      inspection.violations.some(
        ({ code }) => code === "state-mutation-owner-factory-source-drift",
      ),
      false,
      injectedStatement,
    );
    assert.ok(
      inspection.violations.some(
        ({ code }) => code === "state-mutation-owner-direct-mutation",
      ),
      injectedStatement,
    );
  }
});

test("source-bound visual effects owner proves exact facade methods without state action edges", () => {
  const entry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ factoryExportName }) => factoryExportName === "createVisualEffectsPassOwner",
  );
  assert.ok(entry);
  assert.deepEqual(entry.actionExports, []);
  assert.deepEqual(entry.methods, [
    "drawEffectsPass",
    "drawLineEffectsPass",
    "drawTextureLabelEffectsPass",
    "drawDayNightPass",
    "invalidateTextureRasterCaches",
  ]);
  assert.deepEqual(inspectStateMutationDelegatingOwnerSources({
    compositionSource: fs.readFileSync(entry.compositionModulePath, "utf8"),
    factorySource: fs.readFileSync(entry.factoryModulePath, "utf8"),
    entry,
  }).violations, []);
  for (const invalidEntry of [
    { ...entry, actionModulePath: "js/core/state/actions/renderer_phase_actions.js" },
    {
      ...entry,
      actionModulePathsByExport: {
        ghostAction: "js/core/state/actions/renderer_phase_actions.js",
      },
    },
  ]) {
    assert.deepEqual(
      validateStateMutationDelegatingOwnerContract([invalidEntry]),
      [{ code: "state-mutation-owner-entry-shape-invalid", index: 0 }],
    );
  }
});

test("source-bound political background owner proves exact facade methods without state action edges", () => {
  const entry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ factoryExportName }) => factoryExportName === "createPoliticalBackgroundRenderOwner",
  );
  assert.ok(entry);
  assert.deepEqual(entry.actionExports, []);
  assert.deepEqual(entry.methods, [
    "cancelScenarioPoliticalBackgroundDeferredFullCache",
    "drawBackgroundPass",
    "drawPoliticalBackgroundFills",
    "drawPoliticalBackgroundFillsForEntries",
  ]);
  assert.deepEqual(inspectStateMutationDelegatingOwnerSources({
    compositionSource: fs.readFileSync(entry.compositionModulePath, "utf8"),
    factorySource: fs.readFileSync(entry.factoryModulePath, "utf8"),
    entry,
  }).violations, []);
});

test("source-bound political partial owner proves exact facade methods without state action edges", () => {
  const entry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ factoryExportName }) => factoryExportName === "createPoliticalPartialRepaintOwner",
  );
  assert.ok(entry);
  assert.deepEqual(entry.actionExports, []);
  assert.deepEqual(entry.methods, [
    "buildPoliticalRasterWorkerPacket",
    "drawPoliticalFeature",
    "drawPoliticalFineFeatureLoop",
    "drawPoliticalWorkerBitmapResult",
    "publishPoliticalPassDiagnostics",
    "recordPoliticalRasterWorkerSnapshot",
    "requestPoliticalPassWorker",
    "resolvePoliticalPassIdentity",
    "resolvePoliticalPassViewport",
    "tryPartialPoliticalPassRepaint",
  ]);
  const compositionSource = fs.readFileSync(entry.compositionModulePath, "utf8");
  const factorySource = fs.readFileSync(entry.factoryModulePath, "utf8");
  assert.deepEqual(inspectStateMutationDelegatingOwnerSources({
    compositionSource,
    factorySource,
    entry,
  }).violations, []);
  assert.ok(inspectStateMutationDelegatingOwnerSources({
    compositionSource,
    factorySource,
    entry: { ...entry, methods: [...entry.methods, "unregisteredPoliticalPartialFacade"] },
  }).violations.length > 0);
});

test("spherical diagnostics cache exposes immutable or detached entry reads and rejects raw Map access", () => {
  const modulePath = "js/core/state/actions/renderer_cache_actions.js";
  const source = fs.readFileSync(modulePath, "utf8");
  assert.deepEqual(
    validateStateActionModuleSource(source, { filePath: modulePath }),
    [],
  );

  const writerExports = STATE_ACTION_DELEGATION_CONTRACT
    .filter((entry) => entry.modulePath === modulePath)
    .map((entry) => entry.exportName)
    .sort();
  assert.ok(writerExports.includes("clearSphericalFeatureDiagnosticsCacheState"));
  assert.ok(writerExports.includes("setSphericalFeatureDiagnosticsCacheEntryState"));
  assert.equal(writerExports.includes("setSphericalFeatureDiagnosticsCacheState"), false);

  const rawAccessorSource = `${source}\nexport function getSphericalFeatureDiagnosticsCacheState(target) {\n  return target.sphericalFeatureDiagnosticsById;\n}\n`;
  assert.ok(validateStateActionModuleSource(
    rawAccessorSource,
    { filePath: modulePath },
  ).some(({ code }) => code === "state-action-direct-export-unregistered"));

  const rawAccessorCaller = [
    'import { state as runtimeState } from "../core/state.js";',
    'import { getSphericalFeatureDiagnosticsCacheState } from "../core/state/actions/renderer_cache_actions.js";',
    "const cache = getSphericalFeatureDiagnosticsCacheState(runtimeState);",
    "cache.set('leak', {});",
    "",
  ].join("\n");
  assert.ok(scan(rawAccessorCaller).findings.some(({ reason }) => (
    reason === "state-alias-escape"
  )));
});

const FILE_PATH = "js/bootstrap/state_action_edge_fixture.js";
const MODULE_BINDING = Object.freeze({
  id: "module:runtimeState",
  kind: "module",
  name: "runtimeState",
  importSource: "../core/state.js",
  importedName: "state",
});

function scan(source) {
  return scanStateMutationInventory(source, {
    filePath: FILE_PATH,
    bindings: [MODULE_BINDING],
  });
}

test("P4.2b optional and city action exports have one canonical owner", () => {
  const expectedOwners = new Map([
    ["applyScenarioChunkOptionalLayerState", "js/core/state/actions/scenario_activation_actions.js"],
    ["restoreScenarioChunkPromotionState", "js/core/state/actions/scenario_activation_actions.js"],
    ["applyScenarioChunkCityExternalEffectState", "js/core/state/actions/scenario_presentation_actions.js"],
    ["finalizeScenarioChunkCityExternalEffectState", "js/core/state/actions/scenario_presentation_actions.js"],
  ]);
  for (const [exportName, modulePath] of expectedOwners) {
    const entries = STATE_ACTION_DELEGATION_CONTRACT.filter(
      (entry) => entry.exportName === exportName,
    );
    assert.equal(entries.length, 1, `${exportName} must have one registered owner`);
    assert.equal(entries[0].modulePath, modulePath);
    assert.equal(entries[0].introducedInPhase, "P4.2b");
  }
  assert.deepEqual(
    STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT.filter(
      ({ retiredMembership }) =>
        retiredMembership === "scenario|P4.2|assign|*",
    ).map(({ modulePath, exportName }) => ({ modulePath, exportName })),
    [
      {
        modulePath: "js/core/state/actions/scenario_activation_actions.js",
        exportName: "applyScenarioChunkOptionalLayerState",
      },
      {
        modulePath: "js/core/state/actions/scenario_activation_actions.js",
        exportName: "restoreScenarioChunkPromotionState",
      },
    ],
  );
  assert.deepEqual(
    validateStateActionModulePhaseAdmissions({
      modulePaths: ["js/core/state/actions/scenario_activation_actions.js"],
      phase: "P4.3",
    }),
    [],
  );
  assert.ok(validateStateActionModulePhaseAdmissions({
    modulePaths: ["js/core/state/actions/scenario_activation_actions.js"],
    phase: "P4.2b",
  }).some(({ code }) => code === "state-action-module-phase-not-admitted"));
});

test("P4.4 action modules admit every direct export only at the P4.4 boundary", async () => {
  const modulePaths = [
    "js/core/state/actions/appearance_actions.js",
    "js/core/state/actions/appearance_preset_actions.js",
    "js/core/state/actions/appearance_reference_actions.js",
    "js/core/state/actions/appearance_selection_actions.js",
    "js/core/state/actions/appearance_visibility_actions.js",
    "js/core/state/actions/export_workbench_actions.js",
    "js/core/state/actions/intensity_field_actions.js",
    "js/core/state/actions/special_zone_actions.js",
    "js/core/state/actions/strategic_overlay_actions.js",
    "js/core/state/actions/transport_actions.js",
    "js/core/state/actions/ui_chrome_actions.js",
    "js/core/state/actions/ui_dirty_actions.js",
    "js/core/state/actions/ui_visibility_actions.js",
  ];
  for (const modulePath of modulePaths) {
    const source = fs.readFileSync(modulePath, "utf8");
    assert.deepEqual(
      validateStateActionModuleSource(source, {
        filePath: modulePath,
      }),
      [],
      modulePath,
    );
    assert.deepEqual(
      await validateStateActionNonTargetParameterMutations(modulePath, source),
      [],
      modulePath,
    );
  }

  assert.deepEqual(
    validateStateActionModulePhaseAdmissions({ modulePaths, phase: "P4.4" }),
    [],
  );
  assert.equal(
    validateStateActionModulePhaseAdmissions({ modulePaths, phase: "P4.3" })
      .filter(({ code }) => code === "state-action-module-phase-not-admitted")
      .length,
    modulePaths.length,
  );
});

test("P4.2c scenario health actions have canonical owners and cross-file retirement proofs", () => {
  const expectedOwners = new Map([
    ["setScenarioHydrationHealthGateState", "js/core/state/actions/scenario_health_actions.js"],
    ["restoreScenarioHydrationHealthGateState", "js/core/state/actions/scenario_health_actions.js"],
    ["setScenarioDataHealthState", "js/core/state/actions/scenario_health_actions.js"],
    ["restoreScenarioDataHealthState", "js/core/state/actions/scenario_health_actions.js"],
    ["setActiveScenarioPerformanceHintsState", "js/core/state/actions/scenario_presentation_actions.js"],
  ]);
  for (const [exportName, modulePath] of expectedOwners) {
    const entries = STATE_ACTION_DELEGATION_CONTRACT.filter(
      (entry) => entry.exportName === exportName,
    );
    assert.equal(entries.length, 1, `${exportName} must have one registered owner`);
    assert.equal(entries[0].modulePath, modulePath);
    assert.equal(entries[0].introducedInPhase, "P4.2c");
  }

  const healthRetirementProofs = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT
    .filter(({ key }) => [
      "scenarioDataHealth",
      "scenarioHydrationHealthGate",
    ].includes(key));
  assert.deepEqual(
    healthRetirementProofs.map(({ key, actionExportName }) => ({
      key,
      actionExportName,
    })),
    [
      {
        key: "scenarioDataHealth",
        actionExportName: "setScenarioDataHealthState",
      },
      {
        key: "scenarioHydrationHealthGate",
        actionExportName: "setScenarioHydrationHealthGateState",
      },
    ],
  );
});

test("P4.2c scenario health cross-file proofs match one live caller edge", async () => {
  const healthRetirementProofs = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT
    .filter(({ key }) => [
      "scenarioDataHealth",
      "scenarioHydrationHealthGate",
    ].includes(key));

  for (const proof of healthRetirementProofs) {
    const source = fs.readFileSync(proof.replacementCallerPath, "utf8");
    const inventory = await discoverStateWriterBindingsForSource(
      proof.replacementCallerPath,
      source,
      "production",
      { scanAllParameters: true, includeInventories: true },
    );
    const edges = normalizeStateActionDelegations(
      inventory.bindingInventories.flatMap(
        ({ actionDelegations = [] }) => actionDelegations,
      ),
    );
    const matches = edges.filter((edge) => (
      edge.callerPath === proof.replacementCallerPath
      && edge.callerBindingIdentity
        === proof.replacementCallerBindingIdentity
      && edge.enclosingFunctionIdentity
        === proof.replacementEnclosingFunctionIdentity
      && edge.actionModulePath === proof.actionModulePath
      && edge.actionExportName === proof.actionExportName
      && edge.targetArgumentIndex === proof.targetArgumentIndex
      && edge.sourceFingerprint
        === proof.replacementActionSourceFingerprint
    ));
    assert.equal(matches.length, 1, `${proof.key} must have one exact live replacement edge`);
  }
});

test("P4.3 renderer cross-boundary proofs lock retired evidence and exact replacement calls", async () => {
  const rendererProofs =
    STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT
      .filter(({ domain, migrationPhase }) =>
        domain === "renderer"
        && migrationPhase === "P4.3"
      );
  assert.deepEqual(
    rendererProofs.map((proof) => [
      proof.retiredCallerPath,
      proof.key,
      proof.actionExportName,
      proof.retiredMutationSites.length,
    ]),
    [
      ["js/core/map_renderer.js", "cachedDetailAdmBorders", "replaceCachedDetailAdmBordersState", 5],
      ["js/core/map_renderer.js", "deferExactAfterSettle", "setDeferExactAfterSettleState", 3],
      ["js/core/map_renderer.js", "dprLastStageSwitchAt", "commitRendererDprStageState", 1],
      ["js/core/map_renderer.js", "dprStage", "commitRendererDprStageState", 1],
      ["js/core/map_renderer.js", "firstVisibleFramePainted", "setFirstVisibleFramePaintedState", 1],
      ["js/core/map_renderer.js", "lastMouseMoveTime", "setLastMouseMoveTimeState", 1],
      ["js/core/map_renderer.js", "pendingDayNightRefresh", "setPendingDayNightRefreshState", 2],
      ["js/core/map_renderer.js", "pendingExactPoliticalFastFrame", "setPendingExactPoliticalFastFrameState", 2],
      ["js/core/map_renderer.js", "projectedBoundsById", "commitProjectedBoundsCacheState", 1],
      ["js/core/map_renderer.js", "projectedBoundsDiagnostics", "setProjectedBoundsDiagnosticsState", 2],
      ["js/core/map_renderer.js", "renderPerfMetrics", "ensureRenderPerfMetricsState", 1],
      ["js/core/map_renderer.js", "renderPerfMetricSequence", "commitRenderPerfMetricState", 1],
      ["js/core/map_renderer.js", "cachedDetailAdmBorders", "replaceCachedDetailAdmBordersState", 1],
      ["js/core/renderer/border_draw_owner.js", "cachedDetailAdmBorders", "replaceCachedDetailAdmBordersState", 1],
      ["js/core/state/renderer_runtime_state.js", "exactAfterSettleController", "ensureExactAfterSettleControllerState", 2],
      ["js/core/state/renderer_runtime_state.js", "renderPassCache", "commitRenderPassCacheState", 49],
      ["js/core/state/renderer_runtime_state.js", "sphericalFeatureDiagnosticsById", "commitProjectedBoundsCacheState", 1],
      ["js/core/state/renderer_runtime_state.js", "exactAfterSettleController", "resetExactAfterSettleControllerState", 2],
    ],
  );

  const retiredRelayTargets = {
    dprLastStageSwitchAt: "pixel_ratio_policy",
    dprStage: "pixel_ratio_policy",
    firstVisibleFramePainted: "visible_frame_diagnostics_owner",
    projectedBoundsDiagnostics: "projected_bounds_diagnostics_owner",
  };
  for (const [key, owner] of Object.entries(retiredRelayTargets)) {
    const proof = rendererProofs.find((entry) => entry.key === key);
    assert.equal(proof.replacementCallerPath, `js/core/renderer/${owner}.js`);
  }
  const runtimeStateProofs = rendererProofs.filter(
    ({ replacementCallerPath }) =>
      replacementCallerPath
        === "js/core/state/renderer_runtime_state.js"
        || ["pixel_ratio_policy", "projected_bounds_diagnostics_owner", "visible_frame_diagnostics_owner"]
          .some((name) => replacementCallerPath === `js/core/renderer/${name}.js`),
  );
  const replacementInventories = [];
  for (const callerPath of new Set(runtimeStateProofs.map((proof) => proof.replacementCallerPath))) {
    const inventory = await discoverStateWriterBindingsForSource(
      callerPath,
      fs.readFileSync(callerPath, "utf8"),
      "production",
      { scanAllParameters: true, includeInventories: true },
    );
    replacementInventories.push(...inventory.bindingInventories);
  }
  const runtimeStateEdges = normalizeStateActionDelegations(
    replacementInventories.flatMap(
      ({ actionDelegations = [] }) => actionDelegations,
    ),
  );
  for (const proof of runtimeStateProofs) {
    const matches = runtimeStateEdges.filter((edge) => (
      edge.callerPath === proof.replacementCallerPath
      && edge.callerBindingIdentity
        === proof.replacementCallerBindingIdentity
      && edge.enclosingFunctionIdentity
        === proof.replacementEnclosingFunctionIdentity
      && edge.actionModulePath === proof.actionModulePath
      && edge.actionExportName === proof.actionExportName
      && edge.targetArgumentIndex === proof.targetArgumentIndex
      && edge.sourceFingerprint
        === proof.replacementActionSourceFingerprint
    ));
    assert.equal(
      matches.length,
      1,
      `${proof.key} must have one exact live renderer-state replacement edge`,
    );
  }

  const mapRendererSource = fs.readFileSync(
    "js/core/map_renderer.js",
    "utf8",
  );
  for (const [actionCall, actionExportName] of [
    [
      "ensureRenderPerfMetricsState(runtimeState)",
      "ensureRenderPerfMetricsState",
    ],
    [
      "commitRenderPerfMetricState(runtimeState, payload)",
      "commitRenderPerfMetricState",
    ],
  ]) {
    const proof = rendererProofs.find(
      (entry) => entry.actionExportName === actionExportName,
    );
    assert.equal(
      mapRendererSource.split(actionCall).length - 1,
      1,
      `${actionExportName} must have one exact call source`,
    );
    assert.equal(
      createHash("sha256").update(actionCall).digest("hex"),
      proof.replacementActionSourceFingerprint,
    );
  }
});

test("Day/Night actions have one registry owner and one live canonical handoff", () => {
  const entries = STATE_ACTION_DELEGATION_CONTRACT.filter(
    ({ exportName }) => exportName === "setDayNightStyleConfigState",
  );
  assert.deepEqual(entries.map(({ modulePath, targetArgumentIndex, introducedInPhase }) => ({
    modulePath,
    targetArgumentIndex,
    introducedInPhase,
  })), [{
    modulePath: "js/core/state/actions/scenario_presentation_actions.js",
    targetArgumentIndex: 0,
    introducedInPhase: "P4.3",
  }]);

  const proof = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT.find(
    ({ key }) => key === "pendingDayNightRefresh",
  );
  assert.ok(proof);
  assert.equal(proof.replacementCallerPath, "js/core/map_renderer.js");
  const source = fs.readFileSync(proof.replacementCallerPath, "utf8");
  const actionCall = "setPendingDayNightRefreshState(runtimeState, nextPending)";
  assert.equal(source.split(actionCall).length - 1, 1);
  assert.equal(
    createHash("sha256").update(actionCall).digest("hex"),
    proof.replacementActionSourceFingerprint,
  );

  const ownerProof = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ factoryExportName }) => factoryExportName === "createDayNightRuntimeOwner",
  );
  assert.ok(ownerProof);
  assert.deepEqual(inspectStateMutationDelegatingOwnerSources({
    compositionSource: fs.readFileSync(ownerProof.compositionModulePath, "utf8"),
    factorySource: fs.readFileSync(ownerProof.factoryModulePath, "utf8"),
    entry: ownerProof,
  }).violations, []);

  const ownerSlice = source.match(
    /function getDayNightRuntimeOwner\(\) \{[\s\S]*?\n\}/,
  )[0];
  const scannerFixture = [
    'import { state as runtimeState } from "./state.js";',
    'import { createDayNightRuntimeOwner } from "./renderer/day_night_runtime_owner.js";',
    'import { setPendingDayNightRefreshState } from "./state/actions/renderer_phase_actions.js";',
    'import { setDayNightStyleConfigState } from "./state/actions/scenario_presentation_actions.js";',
    "let dayNightRuntimeOwner = null;",
    ownerSlice,
    "export function buildRenderPassSignature() { return getDayNightRuntimeOwner().buildDayNightPassSignature(\"transform\", 0, 0); }",
    "export function getDayNightStyleConfig() { return getDayNightRuntimeOwner().getDayNightStyleConfig(); }",
    "export function syncDayNightClockTimer() { return getDayNightRuntimeOwner().syncDayNightClockTimer(); }",
    "",
  ].join("\n");
  const inventory = scanStateMutationInventory(scannerFixture, {
    filePath: ownerProof.compositionModulePath,
    bindings: [{
      id: "module:runtimeState",
      kind: "module",
      name: "runtimeState",
      importSource: "./state.js",
      importedName: "state",
    }],
  });
  assert.deepEqual(inventory.findings, []);
  const rawInventory = scanStateMutationInventory(scannerFixture, {
    filePath: ownerProof.compositionModulePath,
    bindings: [{
      id: "module:runtimeState",
      kind: "module",
      name: "runtimeState",
      importSource: "./state.js",
      importedName: "state",
    }],
    recognizeCurrentContracts: false,
  });
  assert.ok(rawInventory.findings.some(({ reason, evidenceKind, key }) => (
    reason === "state-alias-escape"
    && evidenceKind === "return-value"
    && key === "styleConfig"
  )), JSON.stringify(rawInventory.findings));
  assert.deepEqual(
    inventory.actionDelegations.map(({ actionExportName }) => actionExportName).sort(),
    ["setDayNightStyleConfigState", "setPendingDayNightRefreshState"],
  );
  const unregisteredMethodInventory = scanStateMutationInventory(
    `${scannerFixture}\ngetDayNightRuntimeOwner().unregisteredMethod();\n`,
    {
      filePath: ownerProof.compositionModulePath,
      bindings: [{
        id: "module:runtimeState",
        kind: "module",
        name: "runtimeState",
        importSource: "./state.js",
        importedName: "state",
      }],
      recognizeCurrentContracts: false,
    },
  );
  assert.ok(unregisteredMethodInventory.findings.length > 0);
  const unknownOwnerInventory = scanStateMutationInventory(
    scannerFixture.replace(
      "createDayNightRuntimeOwner } from",
      "createUnknownRuntimeOwner as createDayNightRuntimeOwner } from",
    ),
    {
      filePath: ownerProof.compositionModulePath,
      bindings: [{
        id: "module:runtimeState",
        kind: "module",
        name: "runtimeState",
        importSource: "./state.js",
        importedName: "state",
      }],
      recognizeCurrentContracts: false,
    },
  );
  assert.ok(unknownOwnerInventory.findings.length > 0);
});

test("scenario style defaults use one P4.3 action handoff without legacy alias authority", async () => {
  const entries = STATE_ACTION_DELEGATION_CONTRACT.filter(
    ({ exportName }) => exportName === "mergeScenarioStyleDefaultsState",
  );
  assert.deepEqual(entries.map(({ modulePath, targetArgumentIndex, introducedInPhase }) => ({
    modulePath,
    targetArgumentIndex,
    introducedInPhase,
  })), [{
    modulePath: "js/core/state/actions/scenario_presentation_actions.js",
    targetArgumentIndex: 0,
    introducedInPhase: "P4.3",
  }]);

  const relativePath = "js/core/scenario/presentation_ocean_fill_restore.js";
  const source = fs.readFileSync(relativePath, "utf8");
  const actionCall = "mergeScenarioStyleDefaultsState(state, projectedOverride)";
  assert.equal(source.split(actionCall).length - 1, 1);
  const { bindingInventories } = await discoverStateWriterBindingsForSource(
    relativePath,
    source,
    "production",
    {
      scanAllParameters: true,
      includeInventories: true,
    },
  );
  const actionDelegations = bindingInventories.flatMap(
    ({ actionDelegations: delegations }) => delegations,
  );
  assert.deepEqual(
    actionDelegations
      .filter(({ actionExportName }) => (
        actionExportName === "mergeScenarioStyleDefaultsState"
      ))
      .map(({ actionExportName }) => actionExportName),
    ["mergeScenarioStyleDefaultsState"],
  );
  const findings = bindingInventories.flatMap(({ findings: values }) => values);
  assert.equal(findings.some(({ sourceFingerprint }) => (
    sourceFingerprint
      === "b87e63dd78b611d49e68df89e99c837dbaa3915ab6e5bf28b983fc15f53b9e22"
    || sourceFingerprint
      === "cc52c4a40d11016bfc97a3f61ed1e34e48aa964578291cdb48d280138cd835de0"
  )), false);
});

test("source-bound owner method destructuring preserves rejection of unknown fields and source drift", () => {
  const entry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ compositionExportName }) => compositionExportName === "composeCityLabelTextModel",
  );
  const source = fs.readFileSync(entry.compositionModulePath, "utf8").replaceAll("\r\n", "\n");
  const node = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .find((statement) => statement.id?.name === entry.compositionExportName);
  const composition = source.slice(node.start, node.end);
  const inspect = (declaration, ownerSource = composition) => scanStateMutationInventory([
    'import { state as runtimeState } from "./state.js";',
    'import { createCityLabelTextModel } from "./renderer/city_label_text_model.js";',
    ownerSource,
    'export function run() { consume(label); runtimeState.dpr = 2; }',
    declaration,
  ].join("\n"), {
    filePath: entry.compositionModulePath,
    bindings: [{ ...MODULE_BINDING, importSource: "./state.js" }],
    derivedAliasTaintMode: "strict",
  }).findings;
  const safe = 'const { getCityDisplayLabel: label } = composeCityLabelTextModel();';
  const findings = inspect(safe);
  assert.equal(findings.some(({ reason }) => reason === "state-alias-escape"), false);
  assert.ok(findings.some(({ operation, key }) => operation === "assign" && key === "dpr"));
  for (const declaration of [
    'const { unknown: label } = composeCityLabelTextModel();',
    'const { ...label } = composeCityLabelTextModel();',
    'let { getCityDisplayLabel: label } = composeCityLabelTextModel();',
  ]) {
    assert.ok(inspect(declaration).some(({ reason }) => reason === "state-alias-escape"));
  }
  assert.ok(inspect(safe, composition.replace("return owner;", "return runtimeState;")).some(
    ({ reason }) => reason === "state-alias-escape",
  ));
});

test("source-bound local session callbacks do not taint detached sessions but reject changed composition", () => {
  const entry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ compositionExportName }) => compositionExportName === "composeBrushInteractionSessionOwner",
  );
  const source = fs.readFileSync(entry.compositionModulePath, "utf8").replaceAll("\r\n", "\n");
  const node = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .find((statement) => statement.id?.name === entry.compositionExportName);
  const composition = source.slice(node.start, node.end);
  const inspect = (ownerSource) => scanStateMutationInventory([
    'import { state as runtimeState } from "./state.js";',
    'import { createBrushInteractionSessionOwner } from "./renderer/brush_interaction_session_owner.js";',
    'let brushSession = null;',
    ownerSource,
    'const { flushBrushSession } = composeBrushInteractionSessionOwner();',
    'export function run() { brushSession.changed = true; }',
  ].join("\n"), {
    filePath: entry.compositionModulePath,
    bindings: [{ ...MODULE_BINDING, importSource: "./state.js" }],
    derivedAliasTaintMode: "strict",
  }).findings;
  assert.deepEqual(inspect(composition), []);
  assert.ok(inspect(composition.replace("brushSession = session;", "brushSession = runtimeState;")).length > 0);
});

test("source-bound chunk composition accepts an immutable root union and rejects source drift", () => {
  const entry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ compositionExportName }) => compositionExportName === "composeScenarioChunkPayloadLoader",
  );
  const source = fs.readFileSync(entry.compositionModulePath, "utf8").replaceAll("\r\n", "\n");
  const node = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .find((statement) => statement.id?.name === entry.compositionExportName);
  const composition = source.slice(node.start, node.end);
  const inspect = (ownerSource) => scanStateMutationInventory([
    'import { state } from "../state.js";',
    'import { createScenarioChunkPayloadLoader } from "./chunk_payload_loader.js";',
    ownerSource,
    'export function read(other) {',
    '  const runtimeState = other || state;',
    '  const { loadScenarioChunkPayload } = composeScenarioChunkPayloadLoader(runtimeState, normalize, getId, loadFile);',
    '  return loadScenarioChunkPayload;',
    '}',
  ].join("\n"), {
    filePath: entry.compositionModulePath,
    bindings: [{ id: "module:state", kind: "module", name: "state", importSource: "../state.js", importedName: "state" }],
    derivedAliasTaintMode: "strict",
  }).findings;
  assert.deepEqual(inspect(composition), []);
  assert.ok(inspect(composition.replace("return owner;", "return runtimeState;")).length > 0);
});

test("borrowed chunk reader proofs cover transitive local helper source", async () => {
  const modulePath = "js/core/scenario/chunk_layer_payloads.js";
  const source = fs.readFileSync(modulePath, "utf8").replaceAll("\r\n", "\n");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  for (const name of ["getScenarioChunkIdsByLayer", "getScenarioChunkPayloadEntriesForLayer"]) {
    const helper = ast.body.find((node) => node.id?.name === name);
    const mutated = source.slice(0, helper.body.start + 1)
      + "\n  chunkState.loadedChunkIds.push(0);"
      + source.slice(helper.body.start + 1);
    await assert.rejects(discoverStateWriterBindingsForSource(modulePath, mutated, "production", {
      scanAllParameters: true,
    }), (error) => error.violations?.some(({ code }) => (
      code === "state-target-pure-reader-dependency-source-drift"
    )));
  }
  for (const entry of STATE_TARGET_PURE_READER_CONTRACT.filter((entry) => entry.modulePath === modulePath)) {
    assert.deepEqual(inspectStateTargetPureReaderFunctionSource(source, entry).violations, []);
    assert.ok(inspectStateTargetPureReaderFunctionSource(source, {
      ...entry, localFunctionFingerprints: {},
    }).violations.some(({ code }) => code === "state-target-pure-reader-dependency-source-drift"));
  }
});

test("source-bound owner proof prepares once and applies independently per binding", () => {
  const ownerProof = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ factoryExportName }) => factoryExportName === "createDayNightRuntimeOwner",
  );
  assert.ok(ownerProof);
  const source = fs.readFileSync(ownerProof.compositionModulePath, "utf8");
  const ownerSlice = source.match(
    /function getDayNightRuntimeOwner\(\) \{[\s\S]*?\n\}/,
  )[0];
  const scannerFixture = [
    'import { state as runtimeState } from "./state.js";',
    'import { state as otherState } from "./other_state.js";',
    'import { createDayNightRuntimeOwner } from "./renderer/day_night_runtime_owner.js";',
    'import { setPendingDayNightRefreshState } from "./state/actions/renderer_phase_actions.js";',
    'import { setDayNightStyleConfigState } from "./state/actions/scenario_presentation_actions.js";',
    "let dayNightRuntimeOwner = null;",
    ownerSlice,
    "export function buildRenderPassSignature() { return getDayNightRuntimeOwner().buildDayNightPassSignature(\"transform\", 0, 0); }",
    "",
  ].join("\n");
  const runtimeBinding = {
    id: "module:runtimeState",
    kind: "module",
    name: "runtimeState",
    importSource: "./state.js",
    importedName: "state",
  };
  const otherBinding = {
    id: "module:otherState",
    kind: "module",
    name: "otherState",
    importSource: "./other_state.js",
    importedName: "state",
  };
  const instrumentationCounts = { apply: 0, prepare: 0 };
  const forward = scanStateMutationInventory(scannerFixture, {
    filePath: ownerProof.compositionModulePath,
    bindings: [runtimeBinding, otherBinding],
    analysisInstrumentation: {
      onPrepareSourceBoundMutationDelegatingOwnerProof() {
        instrumentationCounts.prepare += 1;
      },
      onApplySourceBoundMutationDelegatingOwnerProof() {
        instrumentationCounts.apply += 1;
      },
    },
  });
  const reverse = scanStateMutationInventory(scannerFixture, {
    filePath: ownerProof.compositionModulePath,
    bindings: [otherBinding, runtimeBinding],
  });
  assert.deepEqual(instrumentationCounts, { apply: 2, prepare: 1 });
  assert.deepEqual(reverse, forward);
  assert.deepEqual(
    forward.actionDelegations.map(({ bindingId, actionExportName }) => ({
      bindingId,
      actionExportName,
    })),
    [
      "setDayNightStyleConfigState",
      "setPendingDayNightRefreshState",
    ].map((actionExportName) => ({
      bindingId: runtimeBinding.id,
      actionExportName,
    })),
  );

  const raw = scanStateMutationInventory(scannerFixture, {
    filePath: ownerProof.compositionModulePath,
    bindings: [runtimeBinding, otherBinding],
    recognizeCurrentContracts: false,
  });
  assert.deepEqual(raw.actionDelegations, []);
  assert.ok(raw.findings.some(({ reason, evidenceKind, key }) => (
    reason === "state-alias-escape"
    && evidenceKind === "return-value"
    && key === "styleConfig"
  )), JSON.stringify(raw.findings));

  const virtual = scanStateMutationInventory(
    scannerFixture.replace(
      'import { state as runtimeState } from "./state.js";\n',
      "",
    ),
    {
      filePath: ownerProof.compositionModulePath,
      bindings: [runtimeBinding],
    },
  );
  assert.deepEqual(
    virtual.actionDelegations.map(({ actionExportName }) => actionExportName),
    ["setDayNightStyleConfigState", "setPendingDayNightRefreshState"],
  );

  const fingerprintDrift = scanStateMutationInventory(
    scannerFixture.replace(
      "function getDayNightRuntimeOwner() {",
      "function getDayNightRuntimeOwner() {\n  // adjacent drift",
    ),
    {
      filePath: ownerProof.compositionModulePath,
      bindings: [runtimeBinding],
    },
  );
  assert.ok(fingerprintDrift.findings.length > 0);

  const facadeDrift = scanStateMutationInventory(
    scannerFixture.replace(
      ".buildDayNightPassSignature(\"transform\", 0, 0)",
      ".unregisteredMethod(\"transform\", 0, 0)",
    ),
    {
      filePath: ownerProof.compositionModulePath,
      bindings: [runtimeBinding],
    },
  );
  assert.ok(facadeDrift.findings.length > 0);

  const duplicatedFactorySource = scannerFixture.replace(
    "return dayNightRuntimeOwner;",
    "createDayNightRuntimeOwner({}); return dayNightRuntimeOwner;",
  );
  let factoryDriftPreparedCandidateCount = -1;
  scanStateMutationInventory(duplicatedFactorySource, {
    filePath: ownerProof.compositionModulePath,
    bindings: [runtimeBinding],
    analysisInstrumentation: {
      onCompleteSourceBoundMutationDelegatingOwnerProofPreparation({
        candidateCount,
      }) {
        factoryDriftPreparedCandidateCount = candidateCount;
      },
    },
  });
  assert.equal(factoryDriftPreparedCandidateCount, 0);
});

test("startup ready handoff has one source-bound hydration action effect", async () => {
  const ownerProof = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ factoryExportName }) => factoryExportName === "createStartupReadyHandoffOwner",
  );
  assert.ok(ownerProof);
  assert.equal(ownerProof.compositionModulePath, "js/main.js");
  assert.equal(ownerProof.compositionExportName, "getStartupReadyHandoffOwner");
  assert.equal(ownerProof.ownerBindingName, "startupReadyHandoffOwner");
  assert.deepEqual(ownerProof.actionExports, ["setUiHydrationState"]);
  assert.ok(ownerProof.methods.includes("observePostReadyUiBootstrap"));
  assert.ok(ownerProof.methods.includes("scheduleReadyPostBootWork"));

  const compositionSource = fs.readFileSync(ownerProof.compositionModulePath, "utf8");
  const factorySource = fs.readFileSync(ownerProof.factoryModulePath, "utf8");
  assert.deepEqual(inspectStateMutationDelegatingOwnerSources({
    compositionSource,
    factorySource,
    entry: ownerProof,
  }).violations, []);

  const discovery = await discoverStateWriterBindingsForSource(
    ownerProof.compositionModulePath,
    compositionSource,
    "production",
    { scanAllParameters: true, includeInventories: true },
  );
  const moduleInventory = discovery.bindingInventories.find(({ binding }) => (
    binding.kind === "module" && binding.name === "runtimeState"
  ));
  assert.ok(moduleInventory);
  assert.deepEqual(
    moduleInventory.actionDelegations
      .filter(({ actionExportName }) => actionExportName === "setUiHydrationState")
      .map(({ actionExportName }) => actionExportName),
    ["setUiHydrationState"],
  );
  const retiredProgressionFingerprints = new Set([
    "26a46030",
    "b48eb2fe",
    "b8749af3",
    "c1aef68e",
    "cb9a4c29",
    "cd1615e5",
    "ffe6e265",
  ]);
  assert.deepEqual(
    moduleInventory.findings.filter(({ sourceFingerprint }) => (
      [...retiredProgressionFingerprints].some((prefix) => (
        sourceFingerprint.startsWith(prefix)
      ))
    )),
    [],
  );
});

test("click selection actions have one registry owner and one source-bound transaction handoff", () => {
  const expectedActions = [
    "clearClickHoveredIdState",
    "clearClickScenarioHoverIdsState",
    "removeClickCountryColorsState",
    "removeClickWaterRegionOverrideState",
    "setClickActiveSovereignCodeState",
    "setClickCountryColorsState",
    "setClickHoverOverlayDirtyState",
    "setClickSelectedColorState",
    "setClickSelectedSpecialRegionIdState",
    "setClickSelectedWaterRegionIdState",
  ];
  const moduleByAction = new Map([
    ["clearClickScenarioHoverIdsState", "js/core/state/actions/scenario_presentation_actions.js"],
    ["removeClickCountryColorsState", "js/core/state/actions/scenario_activation_actions.js"],
    ["setClickActiveSovereignCodeState", "js/core/state/actions/scenario_presentation_actions.js"],
    ["setClickCountryColorsState", "js/core/state/actions/scenario_activation_actions.js"],
    ["setClickSelectedSpecialRegionIdState", "js/core/state/actions/scenario_presentation_actions.js"],
    ["setClickSelectedWaterRegionIdState", "js/core/state/actions/scenario_presentation_actions.js"],
  ]);
  for (const exportName of expectedActions) {
    const entries = STATE_ACTION_DELEGATION_CONTRACT.filter((entry) => entry.exportName === exportName);
    assert.deepEqual(entries.map(({ modulePath, introducedInPhase }) => ({ modulePath, introducedInPhase })), [{
      modulePath: moduleByAction.get(exportName) || "js/core/state/actions/renderer_interaction_actions.js",
      introducedInPhase: "P4.3",
    }]);
  }

  const ownerProof = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
    ({ factoryExportName }) => factoryExportName === "createClickSelectionTransactionOwner",
  );
  assert.ok(ownerProof);
  assert.deepEqual(ownerProof.methods, ["handleClick"]);
  assert.deepEqual([...ownerProof.actionExports].sort(), expectedActions.sort());
  assert.deepEqual(inspectStateMutationDelegatingOwnerSources({
    compositionSource: fs.readFileSync(ownerProof.compositionModulePath, "utf8"),
    factorySource: fs.readFileSync(ownerProof.factoryModulePath, "utf8"),
    entry: ownerProof,
  }).violations, []);

  const rendererSource = fs.readFileSync("js/core/map_renderer.js", "utf8");
  for (const [key, actionExportName, actionCall, retiredCount] of [
    ["activeSovereignCode", "setClickActiveSovereignCodeState", "setClickActiveSovereignCodeState(runtimeState, ownerCode)", 1],
    ["selectedColor", "setClickSelectedColorState", "setClickSelectedColorState(runtimeState, color)", 4],
  ]) {
    const proof = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT.find((entry) => (
      entry.retiredCallerPath === "js/core/map_renderer.js"
      && entry.key === key
      && entry.actionExportName === actionExportName
    ));
    assert.ok(proof, key);
    assert.equal(proof.retiredMutationSites.length, retiredCount);
    assert.equal(rendererSource.split(actionCall).length - 1, 1);
    assert.equal(
      createHash("sha256").update(actionCall).digest("hex"),
      proof.replacementActionSourceFingerprint,
    );
  }

  const rendererAst = parse(rendererSource.replaceAll("\r\n", "\n"), {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const compositionNode = rendererAst.body.find((statement) => (
    statement.type === "FunctionDeclaration"
    && statement.id?.name === ownerProof.compositionExportName
  ));
  assert.ok(compositionNode);
  const compositionSource = rendererSource.replaceAll("\r\n", "\n")
    .slice(compositionNode.start, compositionNode.end);
  const scannerFixture = [
    'import { state as runtimeState } from "./state.js";',
    'import { createClickSelectionTransactionOwner } from "./map_renderer/click_selection_transaction_owner.js";',
    ...[
      "js/core/state/actions/renderer_interaction_actions.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
    ].map((modulePath) => {
      const exports = ownerProof.actionExports.filter(
        (exportName) => (moduleByAction.get(exportName)
          || "js/core/state/actions/renderer_interaction_actions.js") === modulePath,
      );
      return `import { ${exports.join(", ")} } from "./${modulePath.slice("js/core/".length)}";`;
    }),
    "let clickSelectionTransactionOwner = null;",
    compositionSource,
    "export function dispatchClick(event) { return getClickSelectionTransactionOwner().handleClick(event); }",
    "",
  ].join("\n");
  const binding = {
    id: "module:runtimeState",
    kind: "module",
    name: "runtimeState",
    importSource: "./state.js",
    importedName: "state",
  };
  const inventory = scanStateMutationInventory(scannerFixture, {
    filePath: ownerProof.compositionModulePath,
    bindings: [binding],
  });
  assert.deepEqual(inventory.findings, []);
  assert.deepEqual(
    inventory.actionDelegations.map(({ actionExportName }) => actionExportName).sort(),
    [...ownerProof.actionExports].sort(),
  );

  const unregisteredMethodInventory = scanStateMutationInventory(
    scannerFixture.replace(".handleClick(event)", ".unregisteredMethod(event)"),
    { filePath: ownerProof.compositionModulePath, bindings: [binding] },
  );
  assert.deepEqual(unregisteredMethodInventory.actionDelegations, []);
  assert.ok(unregisteredMethodInventory.findings.some(({ reason }) => (
    reason === "unsupported-call-mutation"
  )), JSON.stringify(unregisteredMethodInventory.findings));
});

test("compatibility API returns findings plus canonical named action delegation edges", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  setBootStateFields as commitBootFields,",
    '} from "../core/state/actions/boot_actions.js";',
    "",
    "export function applyBootFields(target = runtimeState) {",
    '  commitBootFields(target, { bootPhase: "ready" });',
    "}",
    "",
  ].join("\n");

  const inventory = scan(source);
  assert.ok(Array.isArray(inventory.findings));
  assert.deepEqual(inventory.findings, []);
  assert.equal(inventory.actionDelegations.length, 1);

  const [edge] = inventory.actionDelegations;
  const expectedStart = source.indexOf("commitBootFields(target");
  assert.deepEqual(
    {
      filePath: edge.filePath,
      bindingId: edge.bindingId,
      bindingKind: edge.bindingKind,
      root: edge.root,
      functionName: edge.functionName,
      parameterName: edge.parameterName,
      parameterIndex: edge.parameterIndex,
      parameterPath: edge.parameterPath,
      importSource: edge.importSource,
      importedName: edge.importedName,
      aliasSources: edge.aliasSources,
      aliasOperators: edge.aliasOperators,
      locator: edge.locator,
      actionModulePath: edge.actionModulePath,
      actionExportName: edge.actionExportName,
      targetArgumentIndex: edge.targetArgumentIndex,
      start: edge.start,
      end: edge.end,
      line: edge.line,
      column: edge.column,
    },
    {
      filePath: FILE_PATH,
      bindingId: "module:runtimeState",
      bindingKind: "module",
      root: "runtimeState",
      functionName: "",
      parameterName: "runtimeState",
      parameterIndex: null,
      parameterPath: "",
      importSource: "../core/state.js",
      importedName: "state",
      aliasSources: [],
      aliasOperators: [],
      locator: null,
      actionModulePath: "js/core/state/actions/boot_actions.js",
      actionExportName: "setBootStateFields",
      targetArgumentIndex: 0,
      start: expectedStart,
      end: expectedStart
        + 'commitBootFields(target, { bootPhase: "ready" })'.length,
      line: 7,
      column: 3,
    },
  );
  assert.match(edge.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.match(
    edge.enclosingFunctionIdentity,
    /"name":"applyBootFields"/,
  );
  assert.ok(Array.isArray(scanStateMutations(source, {
    filePath: FILE_PATH,
    bindings: [MODULE_BINDING],
  })));
});

test("registered action payloads can project state while nested unknown calls remain diagnosed", () => {
  const directProjection = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  setBootStateFields as commitBootFields,",
    '} from "../core/state/actions/boot_actions.js";',
    "commitBootFields(runtimeState, {",
    "  bootPhase: runtimeState.bootPhase,",
    "  startupBootCacheState: {",
    "    phase: runtimeState.bootPhase,",
    "  },",
    "});",
    "",
  ].join("\n");
  const directInventory = scan(directProjection);
  assert.equal(directInventory.actionDelegations.length, 1);
  assert.deepEqual(directInventory.findings, []);

  const nestedUnknownCall = directProjection.replace(
    "bootPhase: runtimeState.bootPhase,",
    "bootPhase: consumeUnknown(runtimeState.bootPhase),",
  );
  const nestedInventory = scan(nestedUnknownCall);
  assert.equal(nestedInventory.actionDelegations.length, 1);
  assert.deepEqual(
    nestedInventory.findings.map(({ reason, evidenceKind, key }) => ({
      reason,
      evidenceKind,
      key,
    })),
    [{
      reason: "state-alias-escape",
      evidenceKind: "unknown-call-argument",
      key: "bootPhase",
    }],
  );
});

test("registered action payload containers accept concrete non-root projections", () => {
  const imports = [
    'import { state as runtimeState } from "../core/state.js";',
    'import { setBootStateFields as commitBootFields } from "../core/state/actions/boot_actions.js";',
    'const dynamicKey = "bootPhase";',
  ];
  const scanPayload = (payload) => scan([
    ...imports,
    `commitBootFields(runtimeState, ${payload});`,
    "",
  ].join("\n"));

  const safeArrayInventory = scanPayload("[runtimeState.bootPhase]");
  assert.equal(safeArrayInventory.actionDelegations.length, 1);
  assert.deepEqual(safeArrayInventory.findings, []);

  for (const payload of [
    "{ ...runtimeState.startup }",
    "{ nested: { ...runtimeState.startup } }",
    "{ metric: runtimeState.bootMetrics[dynamicKey] }",
    "{ nested: { ...runtimeState.bootMetrics[dynamicKey] } }",
    "{ promotion: runtimeState.runtimeChunkLoadState.pendingPromotion || null }",
    "{ count: Math.max(0, Number(runtimeState.retryCount) || 0) }",
  ]) {
    const inventory = scanPayload(payload);
    assert.equal(inventory.actionDelegations.length, 1, payload);
    assert.deepEqual(inventory.findings, [], payload);
  }
});

test("registered action payload containers reject root, dynamic, and computed state aliases", () => {
  const imports = [
    'import { state as runtimeState } from "../core/state.js";',
    'import { setBootStateFields as commitBootFields } from "../core/state/actions/boot_actions.js";',
    'const dynamicKey = "bootPhase";',
  ];
  const scanPayload = (payload) => scan([
    ...imports,
    `commitBootFields(runtimeState, ${payload});`,
    "",
  ].join("\n"));

  for (const payload of [
    "{ nested: runtimeState }",
    "[runtimeState]",
    "{ ...runtimeState }",
    "{ nested: { ...runtimeState } }",
    "{ ...(runtimeState || {}) }",
    "{ [runtimeState.bootPhase]: 1 }",
    "{ nested: runtimeState[dynamicKey] }",
    '{ nested: runtimeState[dynamicKey] + "suffix" }',
    "{ nested: (runtimeState[dynamicKey], 1) }",
  ]) {
    const inventory = scanPayload(payload);
    assert.equal(inventory.actionDelegations.length, 1, payload);
    assert.deepEqual(
      inventory.findings.map(({ reason, evidenceKind, key }) => ({
        reason,
        evidenceKind,
        key,
      })),
      [{
        reason: "state-alias-escape",
        evidenceKind: "unknown-call-argument",
        key: "*",
      }],
      payload,
    );
  }
});

test("registered action payload Reflect.get accepts static projections and rejects dynamic root access", () => {
  const imports = [
    'import { state as runtimeState } from "../core/state.js";',
    'import { setBootStateFields as commitBootFields } from "../core/state/actions/boot_actions.js";',
    'const dynamicKey = "bootPhase";',
  ];
  const scanPayload = (payload) => scan([
    ...imports,
    `commitBootFields(runtimeState, ${payload});`,
    "",
  ].join("\n"));

  for (const payload of [
    '{ phase: Reflect.get(runtimeState, "bootPhase") }',
    '{ promotion: Reflect.get(runtimeState.runtimeChunkLoadState, "pendingPromotion") }',
  ]) {
    const inventory = scanPayload(payload);
    assert.equal(inventory.actionDelegations.length, 1, payload);
    assert.equal(inventory.findings.length, 0, payload);
  }

  for (const payload of [
    "{ phase: Reflect.get(runtimeState, dynamicKey) }",
    "{ promotion: Reflect.get(runtimeState.runtimeChunkLoadState, dynamicKey) }",
    "{ root: Reflect.get(runtimeState) }",
  ]) {
    const inventory = scanPayload(payload);
    assert.equal(inventory.actionDelegations.length, 1, payload);
    assert.equal(inventory.findings.length, 1, payload);
    assert.deepEqual(
      inventory.findings.map(({ reason, evidenceKind, key }) => ({
        reason,
        evidenceKind,
        key,
      })),
      [{
        reason: "state-alias-escape",
        evidenceKind: "unknown-call-argument",
        key: "*",
      }],
      payload,
    );
  }
});

test("registered action payload spreads reject immutable aliases that can be the state root", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    'import { setBootStateFields as commitBootFields } from "../core/state/actions/boot_actions.js";',
    "export function applyBootFields(explicitRuntimeState = null) {",
    "  const target = explicitRuntimeState || runtimeState;",
    "  commitBootFields(target, { ...target });",
    "}",
    "",
  ].join("\n");

  const inventory = scan(source);
  assert.equal(inventory.actionDelegations.length, 1);
  assert.deepEqual(
    inventory.findings.map(({ reason, evidenceKind, key }) => ({
      reason,
      evidenceKind,
      key,
    })),
    [{
      reason: "state-alias-escape",
      evidenceKind: "unknown-call-argument",
      key: "*",
    }],
  );
});

test("registered actions accept immutable unions whose tracked branch is the state root", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    'import { setBootStateFields as commitBootFields } from "../core/state/actions/boot_actions.js";',
    "export function applyBootFields(explicitRuntimeState = null) {",
    "  const target = explicitRuntimeState || runtimeState;",
    '  commitBootFields(target, { bootPhase: "ready" });',
    "}",
    "",
  ].join("\n");

  const inventory = scan(source);
  assert.deepEqual(inventory.findings, []);
  assert.equal(inventory.actionDelegations.length, 1);
  assert.equal(
    inventory.actionDelegations[0].actionExportName,
    "setBootStateFields",
  );
});

test("registered actions accept only declared static non-root read-only arguments", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  replaceScenarioChunkPendingPromotionIdentityState,",
    '} from "../core/state/actions/scenario_chunk_runtime_actions.js";',
    "replaceScenarioChunkPendingPromotionIdentityState(",
    "  runtimeState,",
    "  runtimeState.runtimeChunkLoadState.pendingPromotion,",
    "  { scenarioApplyRequestId: 7 },",
    ");",
    "",
  ].join("\n");

  const inventory = scan(source);
  assert.equal(inventory.actionDelegations.length, 1);
  assert.deepEqual(inventory.findings, []);

  const rootInventory = scan(source.replace(
    "runtimeState.runtimeChunkLoadState.pendingPromotion,",
    "runtimeState,",
  ));
  assert.equal(rootInventory.actionDelegations.length, 1);
  assert.deepEqual(
    rootInventory.findings.map(({ reason, evidenceKind, key }) => ({
      reason,
      evidenceKind,
      key,
    })),
    [{
      reason: "state-alias-escape",
      evidenceKind: "unknown-call-argument",
      key: "*",
    }],
  );

  const unionSource = source
    .replace(
      "replaceScenarioChunkPendingPromotionIdentityState(\n  runtimeState,",
      [
        "export function replacePendingIdentity(explicitRuntimeState = null) {",
        "  const target = explicitRuntimeState || runtimeState;",
        "  replaceScenarioChunkPendingPromotionIdentityState(\n  target,",
      ].join("\n"),
    )
    .replace(
      "runtimeState.runtimeChunkLoadState.pendingPromotion,",
      "target.runtimeChunkLoadState.pendingPromotion,",
    )
    .replace("\n);\n", "\n  );\n}\n");
  const unionInventory = scan(unionSource);
  assert.equal(unionInventory.actionDelegations.length, 1);
  assert.deepEqual(unionInventory.findings, []);

  const dynamicSource = source.replace(
    "runtimeState.runtimeChunkLoadState.pendingPromotion,",
    [
      "runtimeState.runtimeChunkLoadState[dynamicKey],",
      ");",
      "replaceScenarioChunkPendingPromotionIdentityState(",
      "  runtimeState,",
      "  runtimeState.runtimeChunkLoadState.pendingPromotion[dynamicKey],",
    ].join("\n"),
  ).replace(
    'import { state as runtimeState } from "../core/state.js";',
    [
      'import { state as runtimeState } from "../core/state.js";',
      'const dynamicKey = "pendingPromotion";',
    ].join("\n"),
  );
  const dynamicInventory = scan(dynamicSource);
  assert.equal(dynamicInventory.actionDelegations.length, 2);
  assert.equal(dynamicInventory.findings.length, 2);
  assert.deepEqual(
    dynamicInventory.findings.map(({ reason, evidenceKind, key }) => ({
      reason,
      evidenceKind,
      key,
    })),
    Array.from({ length: 2 }, () => ({
      reason: "state-alias-escape",
      evidenceKind: "unknown-call-argument",
      key: "runtimeChunkLoadState",
    })),
  );
});

test("canonical actions accept only declared exact parameter identity transfers", async () => {
  const declaredTransfers = new Map([
    ["setAppearanceStyleConfigState", [1]],
    ["setAppearanceStyleGroupState", [2]],
    ["setAppearanceParentBorderEnabledMapState", [1]],
    ["setSelectedColorState", [1]],
    ["setAppearanceVisibilitySnapshotState", [2]],
    ["commitSpecialZoneLayersState", [1]],
    ["setUiChromeState", [1]],
    ["commitUiVisibilityState", [1]],
  ]);
  for (const [exportName, expectedIndexes] of declaredTransfers) {
    const entries = STATE_ACTION_DELEGATION_CONTRACT.filter(
      (entry) => entry.exportName === exportName,
    );
    assert.equal(entries.length, 1, exportName);
    assert.deepEqual(
      entries[0].referenceIdentityArgumentIndexes,
      expectedIndexes,
      exportName,
    );
  }
  assert.deepEqual(validateStateActionDelegationContract(), []);
  const selectedColorEntry = STATE_ACTION_DELEGATION_CONTRACT.find(
    ({ exportName }) => exportName === "setSelectedColorState",
  );
  assert.ok(validateStateActionDelegationContract([{
    ...selectedColorEntry,
    referenceIdentityArgumentIndexes: [0],
  }]).some(({ code }) => (
    code === "state-action-contract-reference-identity-argument-index-invalid"
  )));

  const callerPath = "js/core/state/actions/renderer_interaction_actions.js";
  const source = [
    'import { setSelectedColorState as commitColor } from "./appearance_selection_actions.js";',
    "export function setClickSelectedColorState(target, color) {",
    "  commitColor(target, color);",
    "}",
    "",
  ].join("\n");
  assert.deepEqual(
    await validateStateActionNonTargetParameterMutations(callerPath, source),
    [],
  );
  assert.deepEqual(
    await validateStateActionNonTargetParameterMutations(
      callerPath,
      source.replace("commitColor(target, color)", "commitColor(target, color.value)"),
    ),
    [],
  );
  assert.deepEqual(
    await validateStateActionNonTargetParameterMutations(
      callerPath,
      source.replace("commitColor(target, color)", "commitColor(target, alias)")
        .replace(
          "export function setClickSelectedColorState(target, color) {",
          "export function setClickSelectedColorState(target, color) {\n  const alias = color;",
        ),
    ),
    [],
  );

  for (const rejectedSource of [
    source.replace("commitColor(target, color)", "commitColor(color, target)"),
    source.replace("commitColor(target, color)", "commitColor(target, color[dynamicKey])")
      .replace(
        "export function setClickSelectedColorState(target, color) {",
        'const dynamicKey = "value";\nexport function setClickSelectedColorState(target, color) {',
      ),
    source.replace("commitColor(target, color)", "commitColor(target, { color })"),
    source.replace(
      'import { setSelectedColorState as commitColor } from "./appearance_selection_actions.js";',
      'import { unregisteredSelectedColorState as commitColor } from "./appearance_selection_actions.js";',
    ),
    source.replace("commitColor(target, color)", "commitColor[color](target, color)"),
  ]) {
    const violations = await validateStateActionNonTargetParameterMutations(
      callerPath,
      rejectedSource,
    );
    assert.ok(
      violations.some(({ reason }) => reason === "state-alias-escape"),
      rejectedSource,
    );
  }
});

test("declared identity argument also accepts static payload projections without transferring the container", async () => {
  const callerPath = "js/core/state/actions/appearance_visibility_actions.js";
  const source = [
    'import { commitUiVisibilityState } from "./ui_visibility_actions.js";',
    "export function patchAppearanceVisibilityState(target, patch) {",
    "  commitUiVisibilityState(target, {",
    "    showWaterRegions: patch.showWaterRegions,",
    "    nested: { metric: patch.strategicChoroplethMetric },",
    "  });",
    "}",
    "",
  ].join("\n");
  assert.deepEqual(
    await validateStateActionNonTargetParameterMutations(callerPath, source),
    [],
  );

  const rootInContainer = source.replace(
    "showWaterRegions: patch.showWaterRegions,",
    "showWaterRegions: patch,",
  );
  assert.ok(
    (await validateStateActionNonTargetParameterMutations(
      callerPath,
      rootInContainer,
    )).some(({ reason }) => reason === "state-alias-escape"),
  );
});

test("action edges carry stable enclosing function identities that distinguish sibling callers", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  setBootStateFields as commitBootFields,",
    '} from "../core/state/actions/boot_actions.js";',
    "",
    "export function firstCaller() {",
    "  commitBootFields(runtimeState, { bootPhase: 'first' });",
    "}",
    "",
    "export function secondCaller() {",
    "  commitBootFields(runtimeState, { bootPhase: 'second' });",
    "}",
    "",
  ].join("\n");

  const edges = scan(source).actionDelegations;
  assert.equal(edges.length, 2);
  assert.notEqual(
    edges[0].enclosingFunctionIdentity,
    edges[1].enclosingFunctionIdentity,
  );
  assert.match(edges[0].enclosingFunctionIdentity, /"name":"firstCaller"/);
  assert.match(edges[1].enclosingFunctionIdentity, /"name":"secondCaller"/);
});

test("uncalled local helpers and statically false branches provide no action proof", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  setBootStateFields as commitBootFields,",
    '} from "../core/state/actions/boot_actions.js";',
    "",
    "function unusedHelper() {",
    "  commitBootFields(runtimeState, { bootPhase: 'unused' });",
    "}",
    "",
    "const unusedArrow = () => {",
    "  commitBootFields(runtimeState, { bootPhase: 'unused-arrow' });",
    "};",
    "",
    "export function reachableCaller() {",
    "  if (false) {",
    "    commitBootFields(runtimeState, { bootPhase: 'unreachable' });",
    "  }",
    "  commitBootFields(runtimeState, { bootPhase: 'reachable' });",
    "}",
    "",
  ].join("\n");

  const edges = scan(source).actionDelegations;
  assert.equal(edges.length, 1);
  assert.equal(edges[0].line, 18);
  assert.match(
    edges[0].enclosingFunctionIdentity,
    /"name":"reachableCaller"/,
  );
});

test("methods returned by an exported factory reach their immutable local action helpers", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  setBootStateFields as commitBootFields,",
    '} from "../core/state/actions/boot_actions.js";',
    "",
    "export function createBootPipeline() {",
    "  function commitBoot() {",
    "    commitBootFields(runtimeState, { bootPhase: 'ready' });",
    "  }",
    "  function applyBoot() {",
    "    commitBoot();",
    "  }",
    "  function unusedSibling() {",
    "    commitBootFields(runtimeState, { bootPhase: 'unused' });",
    "  }",
    "  return { applyBoot };",
    "}",
    "",
  ].join("\n");

  const edges = scan(source).actionDelegations;
  assert.equal(edges.length, 1);
  assert.equal(edges[0].line, 8);
  assert.match(
    edges[0].enclosingFunctionIdentity,
    /"name":"commitBoot"/,
  );
});

test("canonical read-only action calls consume the state root without mutation authority", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  captureScenarioReadinessState,",
    '} from "../core/state/actions/scenario_readiness_actions.js";',
    "",
    "export function capture() {",
    "  return captureScenarioReadinessState(runtimeState);",
    "}",
    "",
  ].join("\n");

  const inventory = scan(source);
  assert.deepEqual(inventory.findings, []);
  assert.deepEqual(inventory.actionDelegations, []);
});

test("rollback supplemental capture is a registered read-only state action export", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  captureScenarioTransactionRollbackSupplementalState,",
    '} from "../core/state/actions/scenario_transaction_rollback_actions.js";',
    "",
    "export function capture() {",
    "  return captureScenarioTransactionRollbackSupplementalState(",
    "    runtimeState,",
    "    { cloneValue, readHookSource },",
    "  );",
    "}",
    "",
  ].join("\n");

  const inventory = scan(source);
  assert.deepEqual(inventory.findings, []);
  assert.deepEqual(inventory.actionDelegations, []);
});

test("a read-only-only action module remains valid only through its explicit export catalog", () => {
  const modulePath = "js/core/state/actions/scenario_transaction_rollback_actions.js";
  const source = fs.readFileSync(modulePath, "utf8");

  assert.deepEqual(
    validateStateActionModuleSource(source, { filePath: modulePath }),
    [],
  );
  assert.ok(
    validateStateActionModuleSource(
      `${source}\nexport function unregisteredRollbackReader() { return null; }\n`,
      { filePath: modulePath },
    ).some(({ code }) => code === "state-action-direct-export-unregistered"),
  );
});

test("scenario chunk continuation capture is a registered read-only state action export", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  captureScenarioChunkLoadStateContinuation,",
    '} from "../core/state/actions/scenario_chunk_runtime_actions.js";',
    "",
    "export function capture() {",
    "  return captureScenarioChunkLoadStateContinuation(runtimeState);",
    "}",
    "",
  ].join("\n");

  const inventory = scan(source);
  assert.deepEqual(inventory.findings, []);
  assert.deepEqual(inventory.actionDelegations, []);
});

test("optional, local, reassigned, and wrong-target calls produce no action edge", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  setBootStateFields as commitBootFields,",
    '} from "../core/state/actions/boot_actions.js";',
    "",
    "commitBootFields?.(runtimeState, {});",
    "commitBootFields(runtimeState.bootMetrics, {});",
    "commitBootFields = consumeState;",
    "commitBootFields(runtimeState, {});",
    "{",
    "  const commitBootFields = consumeState;",
    "  commitBootFields(runtimeState, {});",
    "}",
    "",
  ].join("\n");

  assert.deepEqual(scan(source).actionDelegations, []);
});

test("inserted lines preserve semantic binding fields and source fingerprint", () => {
  const body = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  setBootStateFields as commitBootFields,",
    '} from "../core/state/actions/boot_actions.js";',
    "commitBootFields(runtimeState, {});",
    "",
  ].join("\n");
  const original = scan(body).actionDelegations[0];
  const shifted = scan(`// inserted one\n// inserted two\n${body}`)
    .actionDelegations[0];

  const stableFields = [
    "filePath",
    "bindingId",
    "bindingKind",
    "root",
    "functionName",
    "parameterName",
    "parameterIndex",
    "parameterPath",
    "importSource",
    "importedName",
    "actionModulePath",
    "actionExportName",
    "targetArgumentIndex",
    "sourceFingerprint",
  ];
  assert.deepEqual(
    Object.fromEntries(stableFields.map((field) => [field, original[field]])),
    Object.fromEntries(stableFields.map((field) => [field, shifted[field]])),
  );
  assert.equal(shifted.line, original.line + 2);
  assert.ok(shifted.start > original.start);
});

test("repeated control-flow visits dedupe one call per binding and retain distinct sites", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  setBootStateFields as commitBootFields,",
    '} from "../core/state/actions/boot_actions.js";',
    "for (let index = 0; index < 2; index += 1) {",
    "  commitBootFields(runtimeState, {});",
    "}",
    "commitBootFields(runtimeState, {});",
    "commitBootFields(runtimeState, {});",
    "",
  ].join("\n");

  const edges = scan(source).actionDelegations;
  assert.equal(edges.length, 3);
  assert.deepEqual(
    edges.map(({ line }) => line),
    [6, 8, 9],
  );
  assert.ok(
    edges.every((edge, index) =>
      index === 0 || edges[index - 1].start < edge.start
    ),
  );
});

test("defaulted full-root target is accepted while a defaulted child target is rejected", () => {
  const source = [
    'import { state as runtimeState } from "../core/state.js";',
    "import {",
    "  setBootStateFields as commitBootFields,",
    '} from "../core/state/actions/boot_actions.js";',
    "export function commit(",
    "  target = runtimeState,",
    "  childTarget = runtimeState.bootMetrics,",
    ") {",
    "  commitBootFields(target, {});",
    "  commitBootFields(childTarget, {});",
    "}",
    "",
  ].join("\n");

  const edges = scan(source).actionDelegations;
  assert.equal(edges.length, 1);
  assert.equal(edges[0].line, 9);
  assert.equal(edges[0].actionExportName, "setBootStateFields");
});

test("render pass signature reader accepts reviewed joins and rejects state writes or mutating replacements", async () => {
  const modulePath = "js/core/renderer/render_pass_signature_policy.js";
  const source = fs.readFileSync(modulePath, "utf8");
  assert.deepEqual(await discoverStateWriterBindingsForSource(modulePath, source, "production", { scanAllParameters: true }), []);
  for (const changed of [
    source.replace('const transformSignature =', 'runtimeState.colorRevision = 99;\n    const transformSignature ='),
    source.replace('].join("::")', '].push("mutation")'),
  ]) {
    assert.notEqual(changed, source);
    await assert.rejects(
      discoverStateWriterBindingsForSource(modulePath, changed, "production", { scanAllParameters: true }),
      (error) => error?.code === "state-target-pure-reader-contract-violation",
    );
  }
});

test("registered pure-reader target stays out of writer policy and fails closed on drift", async () => {
  const modulePath = "js/core/scenario_manager.js";
  const source = fs.readFileSync(modulePath, "utf8");
  const contractEntry = STATE_TARGET_PURE_READER_CONTRACT.find(
    (entry) =>
      entry.modulePath === modulePath
      && entry.functionName === "prepareScenarioDetailTopologyState",
  );

  assert.ok(contractEntry);
  assert.deepEqual(validateStateTargetPureReaderContract(), []);
  assert.equal(
    contractEntry.acceptedEscapes.some(({ key }) => key === "*"),
    false,
  );
  assert.equal(
    contractEntry.conservativeFindings.reduce(
      (total, { count }) => total + count,
      0,
    ),
    22,
  );
  assert.ok(
    contractEntry.conservativeFindings.every(
      ({
        enclosingFunctionIdentity,
        reason,
        operation,
        key,
        sourceFingerprint,
        count,
      }) =>
        enclosingFunctionIdentity
        && reason === "state-alias-escape"
        && operation === "unsupported"
        && key
        && /^[a-f0-9]{64}$/.test(sourceFingerprint)
        && Number.isInteger(count)
        && count > 0,
    ),
  );

  const discovery = await discoverStateWriterBindingsForSource(
    modulePath,
    source,
    "production",
    {
      scanAllParameters: true,
      includeInventories: true,
    },
  );
  const bindings = discovery.bindings;
  assert.equal(
    bindings.some(
      (binding) =>
        binding.functionName === contractEntry.functionName
        && binding.parameterIndex === contractEntry.targetParameterIndex
        && binding.parameterPath === contractEntry.targetParameterPath,
    ),
    false,
  );
  const conservativeFindingIdentities = new Set(
    contractEntry.conservativeFindings.map((finding) =>
      [
        finding.enclosingFunctionIdentity,
        finding.reason,
        finding.operation,
        finding.key,
        finding.sourceFingerprint,
      ].join("|")
    ),
  );
  const moduleInventory = discovery.bindingInventories.find(
    ({ binding }) =>
      binding.kind === "module"
      && binding.name === "runtimeState",
  );
  assert.ok(moduleInventory);
  const [rawModuleInventory] =
    scanStateWriterBindingInventoriesBatch(
      source,
      modulePath,
      [moduleInventory.binding],
    );
  assert.deepEqual(
    applyStateWriterBindingFindingContracts({
      relativePath: modulePath,
      binding: moduleInventory.binding,
      findings: rawModuleInventory.findings,
    }),
    moduleInventory.findings,
  );
  assert.equal(
    moduleInventory.findings.some((finding) =>
      conservativeFindingIdentities.has(
        [
          finding.enclosingFunctionIdentity,
          finding.reason,
          finding.operation,
          finding.key,
          finding.sourceFingerprint,
        ].join("|"),
      )
    ),
    false,
  );

  const mutatedSource = source.replace(
    "  const currentPatch = () => ({",
    [
      "  targetState.detailDeferred = false;",
      "  const currentPatch = () => ({",
    ].join("\n"),
  );
  await assert.rejects(
    () =>
      discoverStateWriterBindingsForSource(
        modulePath,
        mutatedSource,
        "production",
        { scanAllParameters: true },
      ),
    (error) =>
      error?.code === "state-target-pure-reader-contract-violation"
      && error.violations.some(
        (violation) =>
          violation.code === "state-target-pure-reader-mutation",
      ),
  );

  const escapedSource = source.replace(
    "  const hasDetailNow = hasUsableTopology(targetState.topologyDetail);",
    [
      "  consumeUnknownStateTarget(targetState.topologyDetail);",
      "  const hasDetailNow = hasUsableTopology(targetState.topologyDetail);",
    ].join("\n"),
  );
  await assert.rejects(
    () =>
      discoverStateWriterBindingsForSource(
        modulePath,
        escapedSource,
        "production",
        { scanAllParameters: true },
      ),
    (error) =>
      error?.code === "state-target-pure-reader-contract-violation"
      && error.violations.some(
        (violation) =>
          violation.code
          === "state-target-pure-reader-conservative-finding-unregistered",
      ),
  );
});

test("source-bound pure imported normalizer accepts only its registered static state path", () => {
  const normalizerPath =
    "js/core/renderer/render_pass_cache_state_normalizer.js";
  const registeredSource = [
    `import { normalizeRenderPassCacheState as normalizeCache } from "../renderer/render_pass_cache_state_normalizer.js";`,
    "export function ensureCache(target) {",
    "  return normalizeCache(target.renderPassCache, {});",
    "}",
    "",
  ].join("\n");
  const binding = {
    id: "function:ensureCache:target",
    kind: "function-parameter",
    functionName: "ensureCache",
    parameterName: "target",
    parameterIndex: 0,
    parameterPath: "$",
  };
  const findingsFor = (source) => scanStateMutationInventory(source, {
    filePath: "js/core/state/normalizer_scanner_fixture.js",
    bindings: [binding],
  }).findings;

  assert.deepEqual(findingsFor(registeredSource), []);
  for (const source of [
    registeredSource.replace(
      "normalizeRenderPassCacheState as normalizeCache",
      "normalizeRenderPassCacheStateSibling as normalizeCache",
    ),
    registeredSource.replace(
      "../renderer/render_pass_cache_state_normalizer.js",
      "../renderer/other_normalizer.js",
    ),
    registeredSource.replace(
      "target.renderPassCache",
      "target.renderPassCacheSibling",
    ),
  ]) {
    assert.ok(findingsFor(source).some((finding) => (
      finding.reason === "state-alias-escape"
      && finding.key.startsWith("renderPassCache")
    )));
  }

  const [entry] = STATE_IMPORTED_PURE_NORMALIZER_CONTRACT;
  assert.deepEqual(validateStateImportedPureNormalizerContract(), []);
  assert.deepEqual(entry, {
    modulePath: normalizerPath,
    exportName: "normalizeRenderPassCacheState",
    targetArgumentIndex: 0,
    targetArgumentStaticPath: "renderPassCache",
    sourceFingerprint:
      "03f4cad1217469c4a5d980ebb0e54793f2bd0f86fa4e557f0b68f11d8af9d70c",
  });

  const normalizerSource = fs.readFileSync(normalizerPath, "utf8");
  assert.deepEqual(
    inspectStateImportedPureNormalizerSource(normalizerSource, entry)
      .violations,
    [],
  );
  const runtimeStateSource = fs.readFileSync(
    "js/core/state/renderer_runtime_state.js",
    "utf8",
  );
  assert.deepEqual(
    scanStateMutationInventory(runtimeStateSource, {
      filePath: "js/core/state/renderer_runtime_state.js",
      bindings: [{
        id: "function:ensureRenderPassCacheState:target",
        kind: "function-parameter",
        functionName: "ensureRenderPassCacheState",
        parameterName: "target",
        parameterIndex: 0,
        parameterPath: "$",
      }],
    }).findings,
    [],
  );
  assert.ok(
    inspectStateImportedPureNormalizerSource(
      `import "./side_effect.js";\n${normalizerSource}`,
      entry,
    ).violations.some(({ code }) =>
      code
      === "state-imported-pure-normalizer-import-free-proof-failed"
    ),
  );
  const helperMutationSource = normalizerSource
    .replace(
      "function isObjectHolder(value) {",
      [
        "function mutateCurrentCache(value) {",
        "  const derivedAlias = value;",
        "  derivedAlias.dirty = {};",
        "}",
        "",
        "function routeCurrentCache(value) {",
        "  mutateCurrentCache(value);",
        "}",
        "",
        "function isObjectHolder(value) {",
      ].join("\n"),
    )
    .replace(
      "  if (!isObjectHolder(defaults)) {",
      "  routeCurrentCache(currentCache);\n  if (!isObjectHolder(defaults)) {",
    );
  const helperMutationEntry = {
    ...entry,
    sourceFingerprint: createHash("sha256")
      .update(helperMutationSource.replaceAll("\r\n", "\n"))
      .digest("hex"),
  };
  const helperMutationInspection =
    inspectStateImportedPureNormalizerSource(
      helperMutationSource,
      helperMutationEntry,
    );
  assert.equal(
    helperMutationInspection.violations.some(
      ({ code }) => code === "state-imported-pure-normalizer-source-drift",
    ),
    false,
  );
  assert.ok(helperMutationInspection.violations.some(({ code }) =>
    code
    === "state-imported-pure-normalizer-target-mutation-proof-failed"
  ));

  const shadowedIntrinsicSource = normalizerSource.replace(
    "  return Object.hasOwn(value, fieldName);",
    [
      "  const Object = {",
      "    hasOwn(target) { target.dirty = {}; return true; },",
      "  };",
      "  return Object.hasOwn(value, fieldName);",
    ].join("\n"),
  );
  const shadowedIntrinsicEntry = {
    ...entry,
    sourceFingerprint: createHash("sha256")
      .update(shadowedIntrinsicSource.replaceAll("\r\n", "\n"))
      .digest("hex"),
  };
  const shadowedIntrinsicInspection =
    inspectStateImportedPureNormalizerSource(
      shadowedIntrinsicSource,
      shadowedIntrinsicEntry,
    );
  assert.equal(
    shadowedIntrinsicInspection.violations.some(
      ({ code }) => code === "state-imported-pure-normalizer-source-drift",
    ),
    false,
  );
  assert.ok(shadowedIntrinsicInspection.violations.some(({ code }) =>
    code
    === "state-imported-pure-normalizer-target-mutation-proof-failed"
  ));

  const mutatedIntrinsicFixtures = [
    "Object.hasOwn = (target) => { target.dirty = {}; return true; };",
    "globalThis.Object.hasOwn = (target) => { target.dirty = {}; return true; };",
    "Object.defineProperty(Object, \"hasOwn\", { value: (target) => { target.dirty = {}; return true; } });",
    "Reflect.set(Object, \"hasOwn\", (target) => { target.dirty = {}; return true; });",
  ];
  for (const intrinsicMutation of mutatedIntrinsicFixtures) {
    const mutatedIntrinsicSource = normalizerSource.replace(
      "  return Object.hasOwn(value, fieldName);",
      `${intrinsicMutation}\n  return Object.hasOwn(value, fieldName);`,
    );
    const mutatedIntrinsicEntry = {
      ...entry,
      sourceFingerprint: createHash("sha256")
        .update(mutatedIntrinsicSource.replaceAll("\r\n", "\n"))
        .digest("hex"),
    };
    const mutatedIntrinsicInspection =
      inspectStateImportedPureNormalizerSource(
        mutatedIntrinsicSource,
        mutatedIntrinsicEntry,
      );
    assert.equal(
      mutatedIntrinsicInspection.violations.some(
        ({ code }) => code === "state-imported-pure-normalizer-source-drift",
      ),
      false,
    );
    assert.ok(mutatedIntrinsicInspection.violations.some(({ code }) =>
      code
      === "state-imported-pure-normalizer-target-mutation-proof-failed"
    ));
  }

  const semanticBypasses = [
    "globalThis.normalizerLeak = currentCache;",
    "normalizerLeakHolder.cache = currentCache;",
    "consumeUnknownNormalizerTarget(currentCache);",
    "const cacheAlias = currentCache; cacheAlias.entries.set('leak', {});",
    "globalThis.readNormalizerTarget = () => currentCache;",
    "routeNormalizerLeak(currentCache);",
  ];
  for (const injectedStatement of semanticBypasses) {
    let bypassSource = normalizerSource.replace(
      "  if (!isObjectHolder(defaults)) {",
      `  ${injectedStatement}\n  if (!isObjectHolder(defaults)) {`,
    );
    if (injectedStatement.startsWith("routeNormalizerLeak")) {
      bypassSource = bypassSource.replace(
        "function isObjectHolder(value) {",
        [
          "function routeNormalizerLeak(value) {",
          "  globalThis.normalizerLeak = value;",
          "}",
          "",
          "function isObjectHolder(value) {",
        ].join("\n"),
      );
    }
    const refreshedEntry = {
      ...entry,
      sourceFingerprint: createHash("sha256")
        .update(bypassSource.replaceAll("\r\n", "\n"))
        .digest("hex"),
    };
    const inspection = inspectStateImportedPureNormalizerSource(
      bypassSource,
      refreshedEntry,
    );
    assert.equal(
      inspection.violations.some(
        ({ code }) => code === "state-imported-pure-normalizer-source-drift",
      ),
      false,
      injectedStatement,
    );
    assert.ok(
      inspection.violations.some(
        ({ code }) => (
          code === "state-imported-pure-normalizer-target-mutation-proof-failed"
        )),
      injectedStatement,
    );
  }
});

test("rollback snapshot composition has no state-alias escape from returned capture containers", async () => {
  const modulePath = "js/core/scenario_rollback.js";
  const source = fs.readFileSync(modulePath, "utf8");
  const discovery = await discoverStateWriterBindingsForSource(
    modulePath,
    source,
    "production",
    {
      scanAllParameters: true,
      includeInventories: true,
    },
  );
  const moduleInventory = discovery.bindingInventories.find(
    ({ binding }) =>
      binding.kind === "module"
      && binding.name === "runtimeState",
  );
  assert.ok(moduleInventory);
  assert.deepEqual(
    moduleInventory.findings.filter(
      (finding) =>
        finding.enclosingFunctionIdentity
          === '{"kind":"function","ancestry":[{"name":"captureScenarioApplyRollbackSnapshot","ordinal":0}]}'
        && finding.reason === "state-alias-escape",
    ),
    [],
  );
});

test("renderer policy readers bind exact source and reject injected state writes", async () => {
  for (const module of ["bathymetry_style_policy", "parent_border_grouping_policy", "visible_frame_identity_policy", "fill_target_policy"]) {
    const modulePath = `js/core/renderer/${module}.js`;
    const source = fs.readFileSync(modulePath, "utf8");
    assert.deepEqual(await discoverStateWriterBindingsForSource(modulePath, source, "production", { scanAllParameters: true }), []);
    const mutated = source.replace("}) {", "}) {\n  runtimeState.sceneGeneration = 0;");
    assert.notEqual(mutated, source);
    await assert.rejects(() => discoverStateWriterBindingsForSource(modulePath, mutated, "production", { scanAllParameters: true }),
      (error) => error?.code === "state-target-pure-reader-contract-violation");
  }
});

test("pure-reader contracts reject wildcard accepted escapes", () => {
  const [entry] = STATE_TARGET_PURE_READER_CONTRACT;
  const forged = [{
    ...entry,
    acceptedEscapes: [{
      reason: "state-alias-escape",
      key: "*",
      sourceFingerprint: "a".repeat(64),
      count: 1,
    }],
  }];

  assert.ok(
    validateStateTargetPureReaderContract(forged).some(
      ({ code }) =>
        code === "state-target-pure-reader-escape-wildcard-forbidden",
    ),
  );
});


test("country query model preserves reviewed borrows and rejects new mutation or escape", async () => {
  const modulePath = "js/ui/sidebar/country_inspector_model.js";
  const source = fs.readFileSync(modulePath, "utf8");
  const discovery = await discoverStateWriterBindingsForSource(modulePath, source, "production", { scanAllParameters: true });
  assert.equal(discovery.some(({ functionName }) => functionName === "createCountryInspectorModel"), false);
  const hiddenExport = source.replace("export function createCountryInspectorModel", "function createCountryInspectorModel");
  await assert.rejects(() => discoverStateWriterBindingsForSource(modulePath, hiddenExport, "production", { scanAllParameters: true }),
    (error) => error?.violations?.some(({ code }) => code === "state-target-pure-reader-direct-export-required"));
  for (const statement of ["entry.tag = 'changed';", "consumeUnknownMetadata(entry);"]) {
    const mutated = source.replace("    return entry;", statement + "\n    return entry;");
    assert.notEqual(mutated, source);
    await assert.rejects(() => discoverStateWriterBindingsForSource(modulePath, mutated, "production", { scanAllParameters: true }),
      (error) => error?.code === "state-target-pure-reader-contract-violation");
  }
});

test("borrowed projection source proof rejects source drift and new input writes", () => {
  const entry = STATE_IMPORTED_BORROWED_PROJECTION_CONTRACT[0];
  const source = fs.readFileSync(entry.modulePath, "utf8").replaceAll("\r\n", "\n");
  assert.deepEqual(inspectStateImportedBorrowedProjectionSource(source, entry).violations, []);
  const mutated = source.replace("  const normalized = normalizeSpecialZoneLayersState(layerState);",
    "  layerState.layers = [];\n  const normalized = normalizeSpecialZoneLayersState(layerState);");
  assert.notEqual(mutated, source);
  assert.ok(inspectStateImportedBorrowedProjectionSource(mutated, entry).violations.some(({ code }) => code.endsWith("source-drift")));
  const refreshed = { ...entry, sourceFingerprint: createHash("sha256").update(mutated).digest("hex") };
  assert.ok(inspectStateImportedBorrowedProjectionSource(mutated, refreshed).violations.some(({ code }) => code.endsWith("input-hazard")));
});
test("reviewed read sites reject mutators and mutating callbacks even with a fresh source identity", () => {
  const inspect = (expression) => {
    const source = "export function read(target) { return " + expression + "; }";
    return inspectStateTargetPureReaderFunctionSource(source, {
      modulePath: "js/core/renderer/read_model.js",
      functionName: "read",
      targetParameterName: "target",
      targetParameterIndex: 0,
      targetParameterPath: "$",
      importedArgumentCount: 1,
      sourceFingerprint: fingerprintDirectExportedFunction(source, "read"),
      reviewedReadSiteFingerprints: [createHash("sha256").update(expression).digest("hex")],
      conservativeFindings: [],
      acceptedEscapes: [],
    }).violations;
  };
  assert.deepEqual(inspect('target.landIndex.get("id")'), []);
  assert.deepEqual(inspect("target.items.map((item) => ({ value: item.value }))"), []);
  assert.ok(inspect('target.landIndex.set("id", {})').some(v => v.code === "state-target-pure-reader-read-method-invalid"));
  for (const expression of [
    "target.items.forEach((item) => { item.value = 2; })",
    "target.items.forEach((item) => { const alias = item; alias.value++; })",
    "target.items.map((item) => mutateUnknown(item))",
    "target.items.forEach((item, index, items) => { items.push(item); })",
  ]) {
    assert.ok(inspect(expression).some(v => v.code === "state-target-pure-reader-read-callback-mutation"), expression);
  }
});
