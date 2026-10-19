import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { getObjectIdentityToken } from "../js/core/renderer/object_identity.js";
import { getProjectionGeometryGeneration, markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";
import { getContextCollectionRevision, getContextGeometryRevision, recordContextLayerPublication } from "../js/core/state/context_layer_revision.js";
import { getPoliticalGeometrySnapshot, registerPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";

const REPO_ROOT = process.cwd();

function readRepoFile(...relativeParts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8");
}

function createLandClipHarness() {
  const source = readRepoFile("js", "core", "map_renderer.js");
  const start = source.indexOf("function getPhysicalLandClipCacheKey(maskInfo) {");
  const end = source.indexOf("function applyPhysicalLandClipMask() {", start);
  const resetStart = source.indexOf("function resetPhysicalLandClipPathCache() {");
  const resetEnd = source.indexOf("\nfunction ", resetStart + 1);
  assert.ok(start > 0 && end > start && resetStart > 0 && resetEnd > resetStart);
  const sandbox = {};
  vm.runInNewContext(readRepoFile("vendor", "d3.v7.min.js"), sandbox);
  const d3 = sandbox.d3;
  let projection = d3.geoEqualEarth();
  const collection = { type: "FeatureCollection", features: [{ type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [
      [[1, 1], [1, 20], [20, 1], [1, 1]], [[3, 3], [5, 3], [3, 5], [3, 3]],
    ] } }] };
  const runtimeState = { contextLayerRevision: 0, landBgData: collection };
  const maskInfo = { collection, maskSource: "landBgData", maskQualityToken: "d3-valid" };
  const built = [];
  class Path2D { constructor(svg) { this.svg = svg; built.push(this); } }
  const physicalLandClipPathCache = { key: "", path: null };
  const deps = { globalThis: { d3, Path2D }, rendererSurfaceHost: { getProjection: () => projection },
    runtimeState, physicalLandClipPathCache, PATH_POINT_RADIUS: 2, getObjectIdentityToken,
    getProjectionGeometryGeneration, getContextCollectionRevision, getContextGeometryRevision, getPoliticalGeometrySnapshot };
  const api = new Function(...Object.keys(deps), `${source.slice(start, end)}\n${source.slice(resetStart, resetEnd)}
    return { getPhysicalLandClipCacheKey, getPhysicalLandClipPath, resetPhysicalLandClipPathCache };`)(...Object.values(deps));
  const key = () => api.getPhysicalLandClipCacheKey(maskInfo);
  const clip = () => api.getPhysicalLandClipPath(maskInfo, maskInfo.collection);
  return { api, key, clip, built, runtimeState, maskInfo, d3,
    get projection() { return projection; }, set projection(value) { projection = value; } };
}

test("physical clip reuses the identical SVG path across known water-only publications and camera/style changes", () => {
  const h = createLandClipHarness();
  const before = h.clip();
  assert.equal(before.cacheHit, false);
  const expected = h.d3.geoPath(h.projection).pointRadius(2)(h.maskInfo.collection);
  assert.equal(before.path.svg, expected, "keep the original rounded SVG and polygon hole semantics");
  const previousRevision = h.runtimeState.contextLayerRevision;
  h.runtimeState.contextLayerRevision++;
  const water = { features: [{}] };
  h.runtimeState.scenarioWaterRegionsData = water;
  h.runtimeState.contextLayerExternalDataByName = { lakes: water };
  recordContextLayerPublication(h.runtimeState, previousRevision, [water]);
  Object.assign(h.runtimeState, { scenarioAtlantropaData: { features: [{}] }, showScenarioAtlantropa: false,
    scenarioWaterOverlayVersionTag: "changed", scenarioContextLandMaskVersionTag: "unselected",
    detailPromotionCompleted: true, topologyRevision: 7, colorRevision: 5,
    zoomTransform: { x: 77, y: 22, k: 2.5 }, dpr: 2 });
  const next = h.clip();
  assert.equal(next.cacheHit, true);
  assert.equal(next.path, before.path);
  assert.equal(h.built.length, 1);
});

test("physical clip preserves unknown in-place geometry edits even before a subsequent known water publication", () => {
  for (const publishWater of [false, true]) {
    const h = createLandClipHarness();
    const before = h.clip();
    h.maskInfo.collection.features[0].geometry.coordinates[0][1][0] += 0.25;
    h.runtimeState.contextLayerRevision++;
    if (publishWater) {
      const previousRevision = h.runtimeState.contextLayerRevision++;
      recordContextLayerPublication(h.runtimeState, previousRevision, [{ features: [] }]);
    }
    const next = h.clip();
    assert.equal(next.cacheHit, false);
    assert.notEqual(next.path, before.path);
    assert.notEqual(next.path.svg, before.path.svg);
  }
});

test("physical clip tracks selected collection publications, replacements, feature arrays and membership count", () => {
  const changes = [
    h => { const revision = h.runtimeState.contextLayerRevision++; recordContextLayerPublication(h.runtimeState, revision, [h.maskInfo.collection]); },
    h => { h.maskInfo.collection = { ...h.maskInfo.collection }; },
    h => { h.maskInfo.collection.features = [...h.maskInfo.collection.features]; },
    h => { h.maskInfo.collection.features.push(h.maskInfo.collection.features[0]); },
    h => { h.maskInfo.maskSource = "scenarioLandMask"; },
    h => { h.maskInfo.maskQualityToken = "changed"; },
  ];
  for (const change of changes) {
    const h = createLandClipHarness(), previous = h.key();
    change(h);
    assert.notEqual(h.key(), previous);
  }
});

test("physical clip uses only the selected scenario mask version and the political fallback's geometry snapshot", () => {
  for (const [source, field, other] of [
    ["scenarioLandMask", "scenarioLandMaskVersionTag", "scenarioContextLandMaskVersionTag"],
    ["scenarioContextLandMask", "scenarioContextLandMaskVersionTag", "scenarioLandMaskVersionTag"],
  ]) {
    const h = createLandClipHarness();
    h.maskInfo.maskSource = source;
    const before = h.key();
    h.runtimeState[other] = "unrelated";
    assert.equal(h.key(), before);
    h.runtimeState[field] = "selected-mask-updated";
    assert.notEqual(h.key(), before);
  }
  for (const source of ["landData", "landDataFull"]) {
    const h = createLandClipHarness();
    h.maskInfo.maskSource = source;
    registerPoliticalGeometrySnapshot(h.maskInfo.collection, { revision: 4 });
    const before = h.key();
    registerPoliticalGeometrySnapshot(h.maskInfo.collection, { revision: 5 });
    assert.notEqual(h.key(), before);
  }
});

test("physical clip detects exact projection options, custom clipping, replacement and marked mutation", () => {
  const mutations = [
    h => h.projection.precision(h.projection.precision() + 1e-7),
    h => h.projection.translate([h.projection.translate()[0] + 1e-7, h.projection.translate()[1]]),
    h => h.projection.scale(h.projection.scale() + 1e-7),
    h => h.projection.center([1e-7, 0]), h => h.projection.rotate([1e-7, 0, 0]),
    h => h.projection.angle(1e-7), h => h.projection.reflectX(true), h => h.projection.reflectY(true),
    h => h.projection.clipAngle(179.9999999),
    h => h.projection.clipExtent([[0, 0], [700.0000001, 500]]),
    h => h.projection.preclip(stream => stream), h => h.projection.postclip(stream => stream),
    h => { h.projection = h.d3.geoEqualEarth(); }, h => markProjectionGeometryChanged(h.projection),
  ];
  for (const change of mutations) {
    const h = createLandClipHarness(), previous = h.key();
    change(h);
    assert.notEqual(h.key(), previous);
  }
  const h = createLandClipHarness();
  h.projection.clipExtent([[0, 0], [700, 500]]);
  const before = h.key();
  h.projection.clipExtent([[0, 0], [700 + 1e-7, 500]]);
  assert.notEqual(h.key(), before, "sub-rounding clip extent changes cannot collide");
});

test("physical clip key does not traverse feature arrays and explicit reset still rebuilds the original SVG path", () => {
  const h = createLandClipHarness();
  const before = h.clip();
  h.api.resetPhysicalLandClipPathCache();
  const next = h.clip();
  assert.equal(next.cacheHit, false);
  assert.notEqual(next.path, before.path);
  assert.equal(next.path.svg, before.path.svg);
  h.maskInfo.collection.features = new Proxy(h.maskInfo.collection.features, { get(target, name, receiver) {
    if (name === Symbol.iterator || /^\d+$/.test(String(name))) assert.fail("cache lookup must not scan mask features");
    return Reflect.get(target, name, receiver);
  } });
  const key = h.key();
  for (let repeat = 0; repeat < 10; repeat++) assert.equal(h.key(), key);
});

test("physical layer source contracts stay wired to the expected renderer and startup boundaries", () => {
  const signaturePolicySource = readRepoFile("js", "core", "renderer", "render_pass_signature_policy.js");
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const physicalInteractionSource = readRepoFile("js", "core", "renderer", "physical_intensity_interaction_owner.js");
  const physicalLayerOwnerSource = readRepoFile("js", "core", "renderer", "physical_layer_render_owner.js");
  const scenarioReliefOverlayOwnerSource = readRepoFile("js", "core", "renderer", "scenario_relief_overlay_render_owner.js");
  const mainSource = readRepoFile("js", "main.js");
  const startupReadyHandoffSource = readRepoFile("js", "bootstrap", "startup_ready_handoff.js");
  const startupDataPipelineSource = readRepoFile("js", "bootstrap", "startup_data_pipeline.js");
  const appearanceControllerSource = readRepoFile("js", "ui", "toolbar", "appearance_controls_controller.js");
  const physicalOwnerSource = readRepoFile("js", "ui", "toolbar", "appearance_physical_owner.js");
  const interactionFunnelSource = readRepoFile("js", "core", "interaction_funnel.js");
  const importCompletionSource = readRepoFile("js", "core", "interaction_funnel", "import_completion.js");
  const renderPipelinePassesSource = readRepoFile("js", "core", "renderer", "render_pipeline_passes.js");
  const renderPipelineCatalogSource = readRepoFile("js", "core", "renderer", "render_pipeline_catalog.js");
  const contextPassOwnerSource = readRepoFile("js", "core", "renderer", "context_pass_orchestrator_owner.js");
  const exactSchedulerSource = readRepoFile("js", "core", "map_renderer", "exact_after_settle_scheduler.js");

  const physicalBaseStart = physicalLayerOwnerSource.indexOf("function drawPhysicalBasePass");
  const physicalBaseEnd = physicalLayerOwnerSource.indexOf("function drawPhysicalAtlasLayer");
  const contextBaseStart = contextPassOwnerSource.indexOf("function drawContextBasePass");
  const contextBaseEnd = contextPassOwnerSource.indexOf("function drawContextMarkersPass");
  const physicalBaseSource =
    physicalBaseStart >= 0 && physicalBaseEnd > physicalBaseStart
      ? physicalLayerOwnerSource.slice(physicalBaseStart, physicalBaseEnd)
      : "";
  const contextBaseSource =
    contextBaseStart >= 0 && contextBaseEnd > contextBaseStart
      ? contextPassOwnerSource.slice(contextBaseStart, contextBaseEnd)
      : "";
  const contextMarkersStart = contextPassOwnerSource.indexOf("function drawContextMarkersPass");
  const contextMarkersEnd = contextPassOwnerSource.indexOf("function drawContextScenarioPass");
  const contextMarkersSource =
    contextMarkersStart >= 0 && contextMarkersEnd > contextMarkersStart
      ? contextPassOwnerSource.slice(contextMarkersStart, contextMarkersEnd)
      : "";
  const releaseDeferredContextStart = rendererSource.indexOf("function releaseDeferredContextBasePass");
  const releaseDeferredContextEnd = rendererSource.indexOf("registerRuntimeHook(runtimeState, \"releaseDeferredContextBasePassFn\"", releaseDeferredContextStart);
  const releaseDeferredContextSource =
    releaseDeferredContextStart >= 0 && releaseDeferredContextEnd > releaseDeferredContextStart
      ? rendererSource.slice(releaseDeferredContextStart, releaseDeferredContextEnd)
      : "";

  const checks = {
    hasValidBlendModes:
      /const VALID_BLEND_MODES = new Set\(\[/.test(rendererSource)
      && /"source-over"/.test(rendererSource)
      && /"multiply"/.test(rendererSource)
      && /"screen"/.test(rendererSource)
      && /"overlay"/.test(rendererSource)
      && /"soft-light"/.test(rendererSource),
    hasSafeBlendFallback:
      /return VALID_BLEND_MODES\.has\(mode\) \? mode : safeFallback;/.test(rendererSource),
    hasPhysicalBasePass:
      /passName: "physicalBase", drawKey: "drawPhysicalBasePass"/.test(renderPipelineCatalogSource)
      && /drawPhysicalBasePass,/.test(rendererSource),
    hasPhysicalLayerOwner:
      /import \{ createPhysicalLayerRenderOwner \} from "\.\/renderer\/physical_layer_render_owner\.js";/.test(rendererSource)
      && /function getPhysicalLayerRenderOwner\(\)/.test(rendererSource)
      && /export function createPhysicalLayerRenderOwner/.test(physicalLayerOwnerSource),
    hasScenarioReliefOverlayOwner:
      /import \{ createScenarioReliefOverlayRenderOwner \} from "\.\/renderer\/scenario_relief_overlay_render_owner\.js";/.test(rendererSource)
      && /function getScenarioReliefOverlayRenderOwner\(\)/.test(rendererSource)
      && /export function createScenarioReliefOverlayRenderOwner/.test(scenarioReliefOverlayOwnerSource),
    scenarioReliefDrawingMovedToOwner:
      /function drawPolygonLinePattern/.test(scenarioReliefOverlayOwnerSource)
      && /function drawScenarioReliefOverlaysLayer\(k, \{[\s\S]*?return getScenarioReliefOverlayRenderOwner\(\)\.drawScenarioReliefOverlaysLayer\(k, \{/.test(rendererSource)
      && !/function drawPolygonLinePattern/.test(rendererSource),
    scenarioReliefPassDelegatesToOwner:
      rendererSource.includes("return getScenarioReliefOverlayRenderOwner().drawScenarioReliefOverlaysPass(k)")
      && !rendererSource.includes("function renderScenarioReliefOverlaysLayerToCache")
      && rendererSource.includes("scenarioLayerCache: getRenderCacheOwner().scenarioLayerCache"),
    scenarioReliefOwnerKeepsPhaseAndCoastalAccentSkips:
      /runtimeState\.renderPhase === RENDER_PHASE_INTERACTING \|\| runtimeState\.renderPhase === RENDER_PHASE_SETTLING/.test(scenarioReliefOverlayOwnerSource)
      && /kind === "new_shoreline" \|\| kind === "lake_shoreline"[\s\S]*?isScenarioCoastalAccentEnabled\(\)/.test(scenarioReliefOverlayOwnerSource),
    hasPhysicalReliefOverlayHelper:
      /function drawPhysicalReliefOverlayLayer\(k, \{ interactive = false, clipAlreadyApplied = false,\s*fullWorld = false, atlasCollection: suppliedAtlasCollection \} = \{\}\)/.test(physicalLayerOwnerSource)
      && /return getPhysicalLayerRenderOwner\(\)\.drawPhysicalReliefOverlayLayer\(k, \{ interactive, clipAlreadyApplied \}\);/.test(rendererSource),
    hasPhysicalIntensityFieldHelper:
      rendererSource.includes("createPhysicalIntensityCompositor({")
      && physicalLayerOwnerSource.includes("paintWithPhysicalIntensity"),
    physicalBaseSignatureTracksIntensityRevision:
      /if \(passName === "physicalBase"\) \{[\s\S]*?`field:\$\{Number\(intensityFields\.channels\.physicalAtlas\?\.revision \|\| 0\)\}`/.test(signaturePolicySource),
    reliefOverlayBlendClamp:
      /function getPhysicalReliefOverlayBlendMode\(cfg, presetProfile\)/.test(rendererSource)
      && /if \(requestedMode === "overlay" \|\| requestedMode === "multiply"\) \{[\s\S]*?return "soft-light";/.test(rendererSource),
    physicalBaseKeepsPhysicalFillUnderPolitical:
      physicalBaseSource.includes("const semanticRenderedCount = drawPhysicalAtlasLayer(k, { interactive, fullWorld, atlasCollection: collection });")
      && physicalBaseSource.includes("const reliefRenderedCount = drawPhysicalReliefOverlayLayer(k, { interactive, fullWorld, atlasCollection: collection });")
      && physicalBaseSource.indexOf("drawPhysicalAtlasLayer(k, { interactive, fullWorld, atlasCollection: collection });")
        < physicalBaseSource.indexOf("drawPhysicalReliefOverlayLayer(k, { interactive, fullWorld, atlasCollection: collection });")
      && !physicalBaseSource.includes("drawPhysicalIntensityFieldLayer")
      && physicalBaseSource.includes("const renderedCount = semanticRenderedCount + reliefRenderedCount;"),
    hasPhysicalExactRefresh:
      /invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);/.test(exactSchedulerSource),
    contextBaseKeepsReliefBelowPolitical:
      !contextBaseSource.includes("drawPhysicalReliefOverlayLayer(")
      && contextBaseSource.includes("drawPhysicalContourLayer(k, { interactive });"),
    deferredContextBaseSkipsReliefOverlay:
      /if \(getDeferContextBasePass\(\) && !interactive\) \{/.test(contextBaseSource)
      && !contextBaseSource.includes("drawPhysicalReliefOverlayLayer(k, { interactive: false });"),
    contourUsesSourceOver:
      /drawPhysicalContourLayer[\s\S]*?context\.globalCompositeOperation = "source-over";/.test(physicalLayerOwnerSource),
    hasContourZoomProfiles:
      /const CONTOUR_ZOOM_STYLE_PROFILES = Object\.freeze\(\{/.test(rendererSource),
    hasAdaptiveContourColor:
      /function getAdaptiveContourStrokeColor\(feature, baseColor\)/.test(rendererSource),
    contourKeepsInverseScaleWidth:
      /function drawContourCollection[\s\S]*?const scale = Math\.max\(0\.0001, k\);[\s\S]*?context\.lineWidth = width \/ scale;/.test(physicalLayerOwnerSource),
    contourUsesAdaptiveColor:
      /drawContourCollection[\s\S]*?colorResolver = null/.test(physicalLayerOwnerSource)
      && /drawPhysicalContourLayer[\s\S]*?colorResolver: resolveContourColor/.test(physicalLayerOwnerSource),
    // Selection, cache identity and reset behavior are covered by
    // physical_contour_visible_set_owner_behavior.test.mjs.
    contourUsesStrokeBatching:
      /function drawContourCollection[\s\S]*?const strokeBatches = new Map\(\);/.test(physicalLayerOwnerSource)
      && /const batchKey = `\$\{strokeColor\}\|\$\{multiplier\.toFixed\(2\)\}`;/.test(physicalLayerOwnerSource)
      && /strokeBatches\.forEach\(\(\{ features, strokeColor, multiplier \}\) => \{[\s\S]*?context\.globalAlpha = clamp\(\(interactive \? Math\.min\(opacity, 0\.22\) : opacity\) \* multiplier, 0, 1\);[\s\S]*?features\.forEach\(\(feature\) => \{[\s\S]*?pathCanvas\(feature\);/.test(physicalLayerOwnerSource),
    physicalIntensityFieldsModulateAtlasAndContours:
      physicalLayerOwnerSource.includes('paintWithPhysicalIntensity("physicalAtlas"')
      && physicalLayerOwnerSource.includes('paintWithPhysicalIntensity("physicalContour"')
      && !physicalLayerOwnerSource.includes('getFieldFeatureMultiplier('),
    physicalIntensityToolHookRegistered:
      /registerRuntimeHook\(runtimeState, "setIntensityFieldToolFn", setIntensityFieldTool\);/.test(rendererSource),
    physicalIntensityPointCommitRebakesComposite:
      /if \(current\.subMode === "points"\) \{\s*bakeIntensityComposite\(channel\);\s*\}/.test(physicalInteractionSource)
      && /createPhysicalIntensityInteractionOwner\(\{/.test(rendererSource),
    contourFirstIdleKeepsFastPath:
      /function shouldPreferImmediateExactContextBaseRefresh\(reuseDecision = null\)/.test(rendererSource) === false
      && /const deferredReuseDecision = state\.deferExactAfterSettle \? getContextBaseReuseDecision\(\) : null;/.test(rendererSource) === false,
    contourZoomBucketRefreshesAfterQuietWindow:
      /function buildExactAfterSettleRefreshPlan[\s\S]*?const forceExactContextBaseRefresh = shouldForceExactContextBaseRefresh\(reuseDecision\);[\s\S]*?createExactAfterSettleRefreshPlan/.test(exactSchedulerSource)
      && /function applyExactAfterSettleRefreshPlan[\s\S]*?if \(plan\.forceExactContextBaseRefresh\) \{[\s\S]*?invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);/.test(exactSchedulerSource),
    exactAfterSettleKeepsPoliticalRefreshExplicit:
      /function applyExactAfterSettleRefreshPlan\(plan\) \{[\s\S]*?const exactAfterSettleDprPasses = getExactAfterSettleDprRestorePasses\(renderPassNames\);[\s\S]*?reason: "exact-after-settle-dpr-restore",[\s\S]*?targetPassesOnDprChange: exactAfterSettleDprPasses,[\s\S]*?targetPassesOnResize: exactAfterSettleDprPasses,[\s\S]*?targetPassesOnCanvasResize: exactAfterSettleDprPasses,[\s\S]*?if \(plan\.forceExactContextBaseRefresh\) \{[\s\S]*?invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);[\s\S]*?resolveExactAfterSettleTargetPasses/.test(exactSchedulerSource)
      && /function prepareExactAfterSettlePassesInSlices\(generation, plan\) \{[\s\S]*?const preparationPlan = definitions\.some\(\(\[passName\]\) => passName === "political"\)[\s\S]*?invalidateExactAfterSettlePoliticalPass\(generation, plan\)[\s\S]*?if \(runtimeState\.renderPhase !== renderPhaseIdle\)[\s\S]*?if \(!isExactAfterSettleIdentityCurrent\(getExactAfterSettleControllerState\(\)\)\)[\s\S]*?beforePrepare: canPreparePass/.test(exactSchedulerSource),
    exactAfterSettlePublishesOnlyAfterCurrentPassesComplete:
      /function completeScheduledExactAfterSettleRefreshPlan[\s\S]*?isExactAfterSettleGenerationCurrent\(generation, "applying"\)[\s\S]*?isExactAfterSettleIdentityCurrent\(controller\)[\s\S]*?completeExactAfterSettleControllerApplyState[\s\S]*?setDeferExactAfterSettleState\(runtimeState, false\);/.test(exactSchedulerSource)
      && /prepareExactRenderPassesInSlices\(\{[\s\S]*?isGenerationCurrent: \(\) => isExactAfterSettleGenerationCurrent\(generation, "applying"\),[\s\S]*?onComplete: \(\) => completeScheduledExactAfterSettleRefreshPlan\(generation, preparationPlan, passStartedAt\)/.test(exactSchedulerSource)
      && /export function prepareExactRenderPassesInSlices[\s\S]*?if \(!canPreparePass\(passName\)\) return;[\s\S]*?const preparation = prepareRenderPassAsync\(passName\);[\s\S]*?Promise.resolve\(preparation\).then[\s\S]*?if \(isGenerationCurrent\(\)\) enqueueNextPass\(index\);[\s\S]*?onPassReady\(passName, drawFn, index, passStartedAt\);/.test(renderPipelinePassesSource),
    hasMountainMultiplier:
      /if \(normalized === "mountain_high_relief"\) return 1\.18;/.test(rendererSource),
    hasMountainHillsMultiplier:
      /if \(normalized === "mountain_hills"\) return 1\.02;/.test(rendererSource),
    hasDesertMultiplier:
      /if \(normalized === "desert_bare"\) return 1\.1;/.test(rendererSource),
    hasForestMultiplier:
      /if \(normalized === "forest" \|\| normalized === "forest_temperate"\) return 0\.95;/.test(rendererSource),
    hasPlateauMultiplier:
      /if \(normalized === "upland_plateau"\) return 0\.9;/.test(rendererSource),
    hasBadlandsMultiplier:
      /if \(normalized === "badlands_canyon"\) return 0\.98;/.test(rendererSource),
    hasPlainsMultiplier:
      /if \(normalized === "plains_lowlands"\) return 0\.68;/.test(rendererSource),
    hasGrasslandMultiplier:
      /if \(normalized === "grassland_steppe"\) return 0\.8;/.test(rendererSource),
    hasTundraMultiplier:
      /if \(normalized === "tundra_ice"\) return 0\.85;/.test(rendererSource),
    physicalSetDefersContours:
      /const PHYSICAL_CONTEXT_LAYER_SET = \[\s*"physical",\s*"physical_semantics",\s*\];/.test(startupDataPipelineSource),
    hasSeparateContourWarmupSet:
      /import \{ resolveContourLodRequest \} from "\.\.\/core\/renderer\/physical_contour_lod_policy\.js";/.test(startupDataPipelineSource)
      && /if \(normalized === "physical-contours-set"\) \{[\s\S]*?return resolveContourLodRequest\(state\);/.test(startupDataPipelineSource),
    schedulesDeferredContourWarmup:
      /if \(targetRuntime\.showPhysical\) \{[\s\S]*?requestedLayerNames\.push\("physical-set"\);[\s\S]*?requestedContourLayerNames\.push\("physical-contours-set"\);/.test(startupReadyHandoffSource)
      && /postReadyScheduler\.scheduleTask\("post-ready-contour-warmup", async \(task\) => \{[\s\S]*?task\.throwIfStale\(\);[\s\S]*?await task\.yield\(\);[\s\S]*?await task\.waitFor\(ensureContextLayerDataReady\(requestedContourLayerNames, \{[\s\S]*?reason: "post-ready-contours",[\s\S]*?renderNow: false,[\s\S]*?task\.commit\(\(\) => requestMainRender\("post-ready-contours"\)\);[\s\S]*?\}, scopedTaskOptions\(\{/.test(startupReadyHandoffSource),
    // The requested layers and load options are exercised through actual toggle
    // events in appearance_physical_owner_behavior.test.mjs.
    toolbarBindsPhysicalOwner:
      /physicalOwner\.bindEvents\(\);/.test(appearanceControllerSource),
    projectImportLoadsRequestedPhysicalSet:
      /for \(const \[visible, name, layer\] of \[[\s\S]*?\[state\.showPhysical, "physical", getPhysicalContextLayerRequests\(state\.styleConfig\?\.physical\)\],[\s\S]*?\]\) if \(visible\) complete\(name, async \(\{ isCurrent: valid, signal \}\) => \{\s*const result = await callRuntimeHook\(state, "ensureContextLayerDataFn", layer, \{ reason: "project-import", renderNow: false, isCurrent: valid, signal \}\);\s*if \(valid\(\)\) validateImportedContextLayerResult\(result\);/.test(interactionFunnelSource)
      && /job = createProjectImportCompletion\(\{ required, optional, isCurrent,/.test(interactionFunnelSource)
      && /return task\.run\(\{ isCurrent: valid, signal: attempt\.signal \}\);/.test(importCompletionSource),
    contextMarkersStagedMetricsCoverTransportLines:
      /if \(getDeferContextBasePass\(\) && !interactive\) \{/.test(contextMarkersSource)
      && /collectContextMetric\([\s\S]*?"drawRoadsLayer",[\s\S]*?createDeferredMetricPayload\(snapshot\.roadFeatureCount\)/.test(contextMarkersSource)
      && /collectContextMetric\([\s\S]*?"drawRailwaysLayer",[\s\S]*?createDeferredMetricPayload\(snapshot\.railwayFeatureCount\)/.test(contextMarkersSource),
    contextBreakdownCoversTransportLines:
      /const CONTEXT_BREAKDOWN_METRIC_NAMES = new Set\(\[[\s\S]*?"drawRoadsLayer",[\s\S]*?"drawRailwaysLayer",/.test(rendererSource),
    releaseDeferredContextCancelsStagedContextWork:
      releaseDeferredContextSource.includes("cancelDeferredWork(runtimeState.stagedContextBaseHandle);")
      && releaseDeferredContextSource.includes("runtimeState.stagedContextBaseHandle = null;")
      && releaseDeferredContextSource.includes("scheduleStagedHitCanvasWarmup(nowMs(), Number(runtimeState.stagedMapDataToken || 0));"),
  };

  Object.entries(checks).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});

test("physical layer runtime assets stay publishable through registry and Pages allowlist", () => {
  const registry = JSON.parse(readRepoFile("data", "runtime_asset_registry.json"));
  const manifest = JSON.parse(readRepoFile("data", "manifest.json"));
  const dataLoaderSource = readRepoFile("js", "core", "data_loader.js");
  const pagesDistSource = readRepoFile("tools", "build_pages_dist.py");

  const expectedAssets = {
    "context_layer:physical": "data/europe_physical.geojson",
    "context_layer:physical_semantics": "data/global_physical_semantics.topo.json",
    "context_layer:physical_contours_major": "data/global_contours.major.topo.json",
    "context_layer:physical_contours_minor": "data/global_contours.minor.topo.json",
  };

  Object.entries(expectedAssets).forEach(([assetKey, assetPath]) => {
    assert.equal(registry.assets?.[assetKey]?.url, assetPath, assetKey);
    assert.equal(manifest.runtime_asset_registry?.assets?.[assetKey]?.url, assetPath, assetKey);
    assert.ok(pagesDistSource.includes(`"${assetPath.replace("data/", "")}"`), assetPath);
  });

  assert.ok(dataLoaderSource.includes('resolveDataAssetUrl("context_layer:physical")'));
  assert.ok(dataLoaderSource.includes('resolveDataAssetUrl("context_layer:physical_semantics")'));
  assert.ok(dataLoaderSource.includes('resolveDataAssetUrl("context_layer:physical_contours_major")'));
  assert.ok(dataLoaderSource.includes('resolveDataAssetUrl("context_layer:physical_contours_minor")'));
});
