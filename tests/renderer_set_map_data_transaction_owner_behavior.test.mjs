import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createSetMapDataTransactionOwner } from "../js/core/map_renderer/set_map_data_transaction_owner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const EFFECT_NAMES = Object.freeze([
  "resetRendererTransactionState",
  "clearPendingPoliticalColorEdit",
  "clearRenderPassReferenceTransforms",
  "clearLastGoodFrame",
  "invalidateInteractionComposite",
  "resetFirstVisibleFramePainted",
  "invalidateAllRenderPasses",
  "markAllOverlaysDirty",
  "queueTooltipUpdate",
  "rebuildPrimaryPoliticalCollections",
  "recordCompositeCoverageDiagnostics",
  "sanitizeSetMapDataColorState",
  "setCanvasSize",
  "buildRuntimePoliticalMeta",
  "resetSovereigntyInitialized",
  "resetIslandNeighborsCache",
  "clearSphericalFeatureDiagnosticsCache",
  "buildIndex",
  "ensureSovereigntyState",
  "setDeferHitCanvasBuild",
  "setInteractionInfrastructureState",
  "rebuildProjectedBoundsCache",
  "rebuildStaticMeshes",
  "invalidateBorderCache",
  "updateDynamicBorderStatusUI",
  "rebuildResolvedColors",
  "fitProjection",
  "buildSpatialIndex",
  "updateSpecialZonesPaths",
  "renderSpecialZoneEditorOverlay",
  "updateZoomTranslateExtent",
  "resetZoomToFit",
  "enforceZoomConstraints",
  "setHitCanvasDirty",
  "beginStagedMapDataWarmup",
  "render",
  "recordRenderPerfMetric",
]);

const GETTER_NAMES = Object.freeze([
  "nowMs",
  "getActiveScenarioId",
  "getLandFeatureCount",
  "getRenderProfile",
]);

const PRE_INFRASTRUCTURE_EFFECTS = Object.freeze([
  "resetRendererTransactionState",
  "clearPendingPoliticalColorEdit",
  "clearRenderPassReferenceTransforms",
  "clearLastGoodFrame",
  "invalidateInteractionComposite",
  "resetFirstVisibleFramePainted",
  "invalidateAllRenderPasses",
  "markAllOverlaysDirty",
  "queueTooltipUpdate",
  "rebuildPrimaryPoliticalCollections",
  "recordCompositeCoverageDiagnostics",
  "sanitizeSetMapDataColorState",
  "setCanvasSize",
  "buildRuntimePoliticalMeta",
  "resetSovereigntyInitialized",
  "resetIslandNeighborsCache",
  "clearSphericalFeatureDiagnosticsCache",
]);

const DEFAULT_EFFECT_ORDER = Object.freeze([
  ...PRE_INFRASTRUCTURE_EFFECTS,
  "buildIndex",
  "ensureSovereigntyState",
  "rebuildStaticMeshes",
  "invalidateBorderCache",
  "updateDynamicBorderStatusUI",
  "rebuildResolvedColors",
  "fitProjection",
  "resetZoomToFit",
  "enforceZoomConstraints",
  "beginStagedMapDataWarmup",
  "render",
  "recordRenderPerfMetric",
  "recordRenderPerfMetric",
  "setInteractionInfrastructureState",
]);

function readRepoFile(...parts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...parts), "utf8");
}

function assertExcludes(source, token, message) {
  assert.equal(source.includes(token), false, `${message}: unexpected ${JSON.stringify(token)}`);
}

function createHarness({
  collections = {
    fullCollection: { features: [{ id: "a" }] },
    interactiveCollection: { features: [{ id: "a" }] },
  },
  staged = true,
  timeValues = [100, 116, 140],
  activeScenarioId = "scenario-alpha",
  landFeatureCount = 7,
  renderProfile = "auto",
} = {}) {
  const calls = [];
  const effects = {};
  for (const name of EFFECT_NAMES) {
    effects[name] = (...args) => {
      calls.push({ name, args });
      if (name === "rebuildPrimaryPoliticalCollections") {
        return collections;
      }
      if (name === "beginStagedMapDataWarmup") {
        return staged;
      }
      return undefined;
    };
  }
  const times = [...timeValues];
  const getters = {
    nowMs: () => times.shift() ?? timeValues.at(-1) ?? 0,
    getActiveScenarioId: () => activeScenarioId,
    getLandFeatureCount: () => landFeatureCount,
    getRenderProfile: () => renderProfile,
  };
  const owner = createSetMapDataTransactionOwner({ getters, effects });
  return {
    calls,
    effects,
    getters,
    owner,
    names: () => calls.map((call) => call.name),
    callsByName: (name) => calls.filter((call) => call.name === name),
  };
}

test("default transaction runs exact effects and payloads", () => {
  const harness = createHarness();

  const summary = harness.owner.runSetMapDataTransaction();

  assert.deepEqual(harness.names(), [...DEFAULT_EFFECT_ORDER]);
  assert.deepEqual(summary.effects, [...DEFAULT_EFFECT_ORDER]);
  assert.equal(summary.reason, "set-map-data");
  assert.deepEqual(summary.options, {
    refitProjection: true,
    resetZoom: true,
    suppressRender: false,
    interactionLevel: "full",
    deferInteractionInfrastructure: false,
  });
  assert.equal(summary.shouldDeferInteractionInfrastructure, false);
  assert.equal(summary.staged, true);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.options), true);
  assert.equal(Object.isFrozen(summary.effects), true);

  assert.deepEqual(harness.calls[0].args, [{
    cancelHoverOverlayRender: true,
    cancelSecondarySpatialBuild: true,
  }]);
  assert.deepEqual(harness.callsByName("clearPendingPoliticalColorEdit")[0].args, [{
    force: true,
    resetReason: "set-map-data",
    paintSource: "set-map-data",
  }]);
  assert.deepEqual(harness.callsByName("clearLastGoodFrame")[0].args, ["set-map-data"]);
  assert.deepEqual(harness.callsByName("invalidateInteractionComposite")[0].args, ["set-map-data"]);
  assert.deepEqual(harness.callsByName("resetFirstVisibleFramePainted")[0].args, ["set-map-data"]);
  assert.deepEqual(harness.callsByName("invalidateAllRenderPasses")[0].args, ["set-map-data"]);
  assert.deepEqual(harness.callsByName("queueTooltipUpdate")[0].args, [{ visible: false }]);
  assert.deepEqual(harness.callsByName("recordCompositeCoverageDiagnostics")[0].args, [{
    fullCollection: { features: [{ id: "a" }] },
    interactiveCollection: { features: [{ id: "a" }] },
  }]);
  assert.deepEqual(harness.callsByName("fitProjection")[0].args, [{ skipSpatialIndex: false }]);
  assert.deepEqual(harness.callsByName("beginStagedMapDataWarmup")[0].args, [100]);

  const metricCalls = harness.callsByName("recordRenderPerfMetric");
  assert.deepEqual(metricCalls[0].args, ["setMapDataFirstPaint", 16, {
    staged: true,
    activeScenarioId: "scenario-alpha",
  }]);
  assert.deepEqual(metricCalls[1].args, ["setMapData", 40, {
    refitProjection: true,
    resetZoom: true,
    suppressRender: false,
    landCount: 7,
    renderProfile: "auto",
    staged: true,
  }]);
  assert.deepEqual(harness.calls.at(-1).args, ["ready", {
    ready: true,
    inFlight: false,
  }]);
});

test("refitProjection=false rebuilds projected bounds and spatial infrastructure without fitProjection", () => {
  const harness = createHarness();

  const summary = harness.owner.runSetMapDataTransaction({ refitProjection: false });

  assert.deepEqual(harness.names(), [
    ...PRE_INFRASTRUCTURE_EFFECTS,
    "buildIndex",
    "ensureSovereigntyState",
    "rebuildProjectedBoundsCache",
    "rebuildStaticMeshes",
    "invalidateBorderCache",
    "updateDynamicBorderStatusUI",
    "rebuildResolvedColors",
    "buildSpatialIndex",
    "updateSpecialZonesPaths",
    "renderSpecialZoneEditorOverlay",
    "updateZoomTranslateExtent",
    "resetZoomToFit",
    "enforceZoomConstraints",
    "beginStagedMapDataWarmup",
    "render",
    "recordRenderPerfMetric",
    "recordRenderPerfMetric",
    "setInteractionInfrastructureState",
  ]);
  assert.equal(summary.options.refitProjection, false);
  assert.equal(harness.callsByName("fitProjection").length, 0);
});

test("resetZoom=false marks hit canvas dirty and preserves render path", () => {
  const harness = createHarness();

  const summary = harness.owner.runSetMapDataTransaction({ resetZoom: false });

  assert.equal(summary.options.resetZoom, false);
  assert.equal(harness.callsByName("resetZoomToFit").length, 0);
  assert.equal(harness.callsByName("enforceZoomConstraints").length, 0);
  assert.deepEqual(harness.callsByName("setHitCanvasDirty")[0].args, [true]);
  assert.ok(harness.names().includes("render"));
});

test("suppressRender=true skips staged warmup render and first paint metric", () => {
  const harness = createHarness({ timeValues: [100, 118] });

  const summary = harness.owner.runSetMapDataTransaction({ suppressRender: true });

  assert.equal(summary.options.suppressRender, true);
  assert.equal(summary.staged, false);
  assert.equal(harness.callsByName("beginStagedMapDataWarmup").length, 0);
  assert.equal(harness.callsByName("render").length, 0);
  assert.deepEqual(harness.callsByName("recordRenderPerfMetric"), [{
    name: "recordRenderPerfMetric",
    args: ["setMapData", 18, {
      refitProjection: true,
      resetZoom: true,
      suppressRender: true,
      landCount: 7,
      renderProfile: "auto",
      staged: false,
    }],
  }]);
});

test("readonly startup and explicit defer use deferred interaction infrastructure", () => {
  for (const options of [
    { interactionLevel: "readonly-startup" },
    { deferInteractionInfrastructure: true },
  ]) {
    const harness = createHarness();

    const summary = harness.owner.runSetMapDataTransaction(options);

    assert.equal(summary.shouldDeferInteractionInfrastructure, true);
    assert.equal(harness.callsByName("buildIndex").length, 0);
    assert.equal(harness.callsByName("ensureSovereigntyState").length, 0);
    assert.deepEqual(harness.callsByName("setDeferHitCanvasBuild")[0].args, [true]);
    assert.deepEqual(harness.callsByName("setInteractionInfrastructureState")[0].args, [
      "deferred-startup",
      { ready: false, inFlight: false },
    ]);
    assert.deepEqual(harness.callsByName("fitProjection")[0].args, [{ skipSpatialIndex: true }]);
    assert.equal(
      harness.callsByName("setInteractionInfrastructureState")
        .some((call) => call.args[0] === "ready"),
      false,
    );
  }
});

test("owner fails fast when required effects or getters are missing", () => {
  for (const missingName of EFFECT_NAMES) {
    const { effects, getters } = createHarness();
    delete effects[missingName];

    assert.throws(
      () => createSetMapDataTransactionOwner({ effects, getters }),
      new RegExp(`setMapData transaction owner requires effects\\.${missingName}`),
    );
  }

  for (const missingName of GETTER_NAMES) {
    const { effects, getters } = createHarness();
    delete getters[missingName];

    assert.throws(
      () => createSetMapDataTransactionOwner({ effects, getters }),
      new RegExp(`setMapData transaction owner requires getters\\.${missingName}`),
    );
  }
});

test("owner source stays inside the setMapData transaction boundary", () => {
  const ownerSource = readRepoFile("js", "core", "map_renderer", "set_map_data_transaction_owner.js");

  for (const tokenParts of [
    ["map_", "renderer.js"],
    ["runtime", "State"],
    ["draw", "Canvas"],
    ["renderPass", "ToCache"],
    ["build", "HitCanvas"],
    ["createScenario", "RefreshRuntime"],
    ["createExact", "AfterSettleScheduler"],
    ["createStrategicOverlay", "RuntimeOwner"],
    ["renderer_render", "_lifecycle_owner"],
    ["public", " facade"],
  ]) {
    assertExcludes(
      ownerSource,
      tokenParts.join(""),
      "setMapData transaction owner must avoid forbidden boundary token",
    );
  }
});
