import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { createScenarioRefreshRuntime } from "../js/core/map_renderer/scenario_refresh_runtime.js";
import { captureScenarioRefreshState, resolveScenarioRefreshScope, isScenarioRefreshSceneCurrent } from "../js/core/map_renderer/scenario_refresh_scope.js";
const topology = () => ({ objects: { political: { geometries: [] } } });
function fixture() {
  const state = { activeScenarioId: "tno", sceneGeneration: 1, currentScenarioApplyRequestId: 1,
    firstVisibleFramePainted: true, landIndex: new Map(), landDataFull: { features: [] },
    topologyBundleMode: "composite", topologyPrimary: topology(), topologyDetail: topology(),
    scenarioRuntimeTopologyData: topology(), runtimePoliticalTopology: topology(), colorRevision: 1,
    width: 800, height: 600, topologyRevision: 3 };
  const calls = [], metrics = [];
  const effectNames = ["resetRendererTransactionState", "rebuildPrimaryPoliticalDerivedState", "clearLastGoodFrame", "invalidateInteractionComposite",
    "resetFirstVisibleFramePainted", "invalidateRenderPasses", "clearRenderPassReferenceTransforms", "markAllOverlaysDirty", "rebuildStaticMeshes",
    "invalidateBorderCache", "updateDynamicBorderStatusUI", "updateSpecialZonesPaths", "renderSpecialZoneEditorOverlay", "updateZoomTranslateExtent",
    "resetScenarioWaterCacheAdaptiveState", "scheduleSecondarySpatialIndexBuild", "render", "requestScopedRender", "rebuildAuxiliaryRegionIndexes",
    "queueIndexUiRefresh", "markRendererTopologyChanged", "recordScopedTopologyChange", "clearDeferredInternalBorderMeshCaches", "scheduleDeferredHeavyBorderMeshes", "syncScenarioSecondaryRegionIndexes"];
  const deps = Object.fromEntries(effectNames.map((name) => [name, (...args) => { calls.push([name, ...args]); if (name === "rebuildPrimaryPoliticalDerivedState") return { incremental: !!args[0].incremental, changedFeatureCount: 1 }; }]));
  deps.getEffectiveAtlantropaFeatures = () => ({ water: [] });
  deps.ensureLayerDataFromTopology = () => calls.push(["ensureLayerDataFromTopology"]);
  deps.getSpatialIndexRuntimeOwner = () => ({ resetSecondarySpatialIndexState() {}, buildSecondarySpatialIndexes() {} });
  deps.getProjectionIdentity = () => state.projectionKey || 1;
  deps.recordRenderPerfMetric = (...args) => metrics.push(args);
  deps.nowMs = () => 0;
  const runtime = createScenarioRefreshRuntime({ runtimeState: state, ...deps });
  return { state, calls, metrics, deps, runtime,
    capture: () => runtime.captureRefreshState(),
    names: () => calls.map(([name]) => name),
    scoped: (previous) => runtime.refreshMapDataForScenarioApply({ refreshKind: "deferred-detail", previousRefreshState: previous, suppressRender: true }) };
}
test("default detail arrival under unchanged scenario authority avoids primary and water rebuilds", () => {
  const f = fixture(), previous = f.capture(); f.state.topologyDetail = topology();
  const result = f.scoped(previous);
  assert.equal(result.mode, "background");
  for (const name of ["rebuildPrimaryPoliticalDerivedState", "resetRendererTransactionState", "resetFirstVisibleFramePainted", "resetScenarioWaterCacheAdaptiveState", "syncScenarioSecondaryRegionIndexes"])
    assert.ok(!f.names().includes(name), name);
  assert.ok(f.names().includes("rebuildStaticMeshes"));
  assert.ok(!result.targetPasses.includes("political"));
  assert.equal(f.state.firstVisibleFramePainted, true);
});
test("changed political payload uses validated incremental path without resetting first frame", () => {
  const f = fixture(), previous = f.capture(); f.state.scenarioPoliticalChunkData = { features: [] };
  const result = f.scoped(previous);
  assert.equal(result.mode, "geometry"); assert.equal(result.incremental, true);
  assert.equal(f.calls.find(([name]) => name === "rebuildPrimaryPoliticalDerivedState")[1].incremental, true);
  assert.ok(f.names().includes("markRendererTopologyChanged"));
  assert.ok(!f.names().includes("resetRendererTransactionState"));
  assert.ok(!f.names().includes("resetScenarioWaterCacheAdaptiveState"));
});
test("pure style revision invalidates style-dependent passes, not indices or borders", () => {
  const f = fixture(), previous = f.capture(); f.state.colorRevision++;
  const result = f.scoped(previous);
  assert.equal(result.mode, "style"); assert.ok(result.targetPasses.includes("political"));
  assert.ok(!f.names().includes("rebuildPrimaryPoliticalDerivedState"));
  assert.ok(!f.names().includes("invalidateBorderCache"));
});
test("actual water replacement rebuilds secondary authority while preserving primary", () => {
  const f = fixture(), previous = f.capture(); f.state.scenarioWaterRegionsData = { features: [] };
  const result = f.scoped(previous);
  assert.equal(result.waterChanged, true);
  assert.deepEqual(f.calls.find(([name]) => name === "syncScenarioSecondaryRegionIndexes")[1].changedLayerKeys, ["water"]);
  assert.ok(f.names().includes("resetScenarioWaterCacheAdaptiveState"));
  assert.ok(!f.names().includes("rebuildPrimaryPoliticalDerivedState"));
});
test("unchanged deferred detail is a no-op, not a renamed full refresh", () => {
  const f = fixture(); const result = f.scoped(f.capture());
  assert.equal(result.mode, "none"); assert.deepEqual(f.names(), ["ensureLayerDataFromTopology"]);
});
test("scene, apply request, projection, viewport and startup changes retain full fallback", () => {
  for (const change of [f => { f.state.activeScenarioId = "hoi4"; }, f => { f.state.sceneGeneration++; },
    f => { f.state.currentScenarioApplyRequestId++; }, f => { f.state.projectionKey = 2; },
    f => { f.state.width++; }, f => { f.state.firstVisibleFramePainted = false; }]) {
    const f = fixture(), previous = f.capture(); change(f); const result = f.scoped(previous);
    assert.equal(result.mode, "full"); assert.ok(f.names().includes("resetRendererTransactionState"));
    assert.ok(f.names().includes("rebuildPrimaryPoliticalDerivedState")); assert.ok(f.names().includes("resetScenarioWaterCacheAdaptiveState"));
  }
});
test("ordinary scenario apply always retains full semantics; unknown intent fails explicitly", () => {
  const f = fixture(); assert.equal(f.runtime.refreshMapDataForScenarioApply({ suppressRender: true }).mode, "full");
  assert.throws(() => f.runtime.refreshMapDataForScenarioApply({ refreshKind: "guess" }), /Unsupported/);
});
test("no scenario authority and topology mode transitions cannot be misclassified as background only", () => {
  const f = fixture(); f.state.scenarioRuntimeTopologyData = null; f.state.runtimePoliticalTopology = null;
  const old = f.capture(); f.state.topologyDetail = topology();
  assert.equal(resolveScenarioRefreshScope(old, f.capture()).mode, "geometry");
  f.state.topologyBundleMode = "primary"; const before = f.capture(); f.state.topologyBundleMode = "composite";
  assert.equal(resolveScenarioRefreshScope(before, f.capture()).mode, "geometry");
});
test("ownership, shell and metadata revisions retain geometry/semantic refresh", () => {
  for (const key of ["sovereigntyRevision", "scenarioShellOverlayRevision", "runtimePoliticalMetaSeed", "mapSemanticMode"]) {
    const f = fixture(), previous = f.capture(); f.state[key] = "changed";
    assert.equal(f.scoped(previous).mode, "geometry");
  }
});

function bootstrapFixture() {
  const f = fixture(); f.state.topologyDetail = null; f.state.detailDeferred = true;
  let resolveLoad;
  const load = new Promise(resolve => { resolveLoad = resolve; });
  const calls = [], queued = [];
  const scope = { console: { warn() {}, info() {} }, isScenarioRefreshSceneCurrent,
    captureScenarioRefreshState: () => captureScenarioRefreshState(f.state, 1),
    refreshMapDataForScenarioApply: (options) => { calls.push(["refresh", options]); return { mode: "background" }; },
    setMapData: () => calls.push(["setMapData"]), loadDeferredDetailBundle: () => load,
    refreshScenarioShellOverlays: () => calls.push(["shell"]), refreshScenarioDataHealth() {},
    setDefaultRuntimePoliticalTopologyState() {}, patchScenarioChunkLoadState() {},
    getDeferredPromotionDelay: () => 10, setTimeout: fn => { queued.push(fn); return 1; },
  };
  let source = fs.readFileSync(new URL("../js/bootstrap/deferred_detail_promotion.js", import.meta.url), "utf8");
  source = source.replace(/^import[\s\S]*?from\s+"[^"]+";\r?\n/gm, "").replace(/export function /g, "function ");
  scope.buildInteractionInfrastructureAfterStartupDefault = () => {};
  vm.createContext(scope); vm.runInContext(source, scope);
  const owner = scope.createDeferredDetailPromotionOwner({ runtimeState: f.state, helpers: {
    schedulePostReadyPoliticalReconcile: () => calls.push(["reconcile"]), canRunPostReadyIdleWork: () => true,
  } });
  return { ...f, owner, calls, queued, resolveLoad };
}
test("real deferred bootstrap passes pre-change snapshot, skips shell and political reconcile for background arrival", async () => {
  const f = bootstrapFixture();
  const request = f.owner.ensureDetailTopologyReady({ suppressRender: true });
  f.resolveLoad({ topologyDetail: topology(), runtimePoliticalTopology: topology(), topologyBundleMode: "composite" });
  assert.equal(await request, true);
  assert.equal(f.calls.filter(([name]) => name === "refresh").length, 1);
  assert.equal(f.calls[0][1].refreshKind, "deferred-detail");
  assert.equal(f.calls[0][1].previousRefreshState.context[1], null);
  assert.ok(!f.calls.some(([name]) => name === "shell" || name === "reconcile"));
});
test("outgoing scene async detail completion cannot mutate incoming topology or refresh it", async () => {
  const f = bootstrapFixture(); const request = f.owner.ensureDetailTopologyReady({ suppressRender: true });
  f.state.activeScenarioId = "hoi4"; const previousRuntime = f.state.runtimePoliticalTopology;
  f.resolveLoad({ topologyDetail: topology(), runtimePoliticalTopology: topology() });
  assert.equal(await request, false);
  assert.equal(f.state.topologyDetail, null); assert.equal(f.state.runtimePoliticalTopology, previousRuntime);
  assert.equal(f.calls.length, 0); assert.equal(f.state.detailPromotionInFlight, false);
});
