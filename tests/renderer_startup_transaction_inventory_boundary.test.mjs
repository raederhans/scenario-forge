import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const STARTUP_OWNER_PATH = "js/core/renderer/renderer_startup_transaction_owner.js";
const STARTUP_OWNER_TEST_PATH = "tests/renderer_startup_transaction_owner_behavior.test.mjs";
const PREFLIGHT_DOC_PATH = "docs/active/renderer-startup-transaction-preflight-20260629.md";
const RUNTIME_STATE_TOKEN = ["runtime", "State"].join("");

const OWNERIZED_INIT_MAP_TOKENS = Object.freeze([
  "ensureHybridLayers();",
  "getRendererSurfaceLifecycleOwner().ensureHitCanvasHandle();",
  "getRendererSurfaceLifecycleOwner().acquireCanvasContexts();",
  "getRendererProjectionPathOwner().initializeProjectionPaths();",
  "fitProjection({ skipSpatialIndex: shouldDeferInteractionInfrastructure });",
  "initZoom();",
  "bindEvents();",
]);

const RESET_TRANSACTION_TOKENS = Object.freeze([
  "layerResolverCache.primaryRef = null;",
  "layerResolverCache.detailRef = null;",
  "layerResolverCache.bundleMode = null;",
  "layerResolverCache.contextRevision = 0;",
  "resetPhysicalLandClipPathCache();",
  "resetExactRefreshOptimizationState();",
  `${RUNTIME_STATE_TOKEN}.topologyRevision = Number(${RUNTIME_STATE_TOKEN}.topologyRevision || 0) + 1;`,
  `${RUNTIME_STATE_TOKEN}.hitCanvasTopologyRevision = 0;`,
  "clearPendingPoliticalColorEdit({",
  "resetReason: \"init-map\",",
  "clearRenderPassReferenceTransforms();",
  "clearLastGoodFrame(\"init-map\");",
  "invalidateInteractionComposite(\"init-map\");",
  "resetFirstVisibleFramePainted(\"init-map\");",
  "renderPassCache.perfOverlayEnabled = isPerfOverlayEnabled();",
  "ensureLayerDataFromTopology();",
  "rebuildPoliticalLandCollections();",
  "applyRendererSurfaceBridgeState(runtimeState, {",
  "ensureSovereigntyState();",
  "normalizeColorStateForRender(state, {",
  `${RUNTIME_STATE_TOKEN}.debugMode = debugMode;`,
  "resetRenderDiagnostics();",
  "clearRenderPhaseTimer();",
  "getRenderPhaseLifecycleOwner().resetRenderPhaseState(\"init-map\");",
  `${RUNTIME_STATE_TOKEN}.tooltipPendingState = { visible: false };`,
  `${RUNTIME_STATE_TOKEN}.tooltipRafHandle = null;`,
  "cancelScheduledHoverOverlayRender();",
  "markAllOverlaysDirty();",
  "clearStagedMapDataTasks();",
  "cancelExactAfterSettleRefresh();",
  "cancelPendingIndexUiRefresh();",
  `${RUNTIME_STATE_TOKEN}.deferContextBasePass = false;`,
  `${RUNTIME_STATE_TOKEN}.deferHitCanvasBuild = false;`,
  `${RUNTIME_STATE_TOKEN}.deferExactAfterSettle = false;`,
  `${RUNTIME_STATE_TOKEN}.hitCanvasBuildScheduled = null;`,
  "resetProjectedBoundsCacheState();",
  "invalidateAllRenderPasses(\"init-map\");",
  "syncDayNightClockTimer();",
]);

const OWNER_EFFECT_TOKENS = Object.freeze([
  "resetLayerResolverCache",
  "resetPhysicalLandClipPathCache",
  "resetExactRefreshOptimizationState",
  "bumpTopologyRevision",
  "resetHitCanvasTopologyRevision",
  "clearPendingPoliticalColorEdit",
  "clearRenderPassReferenceTransforms",
  "clearLastGoodFrame",
  "invalidateInteractionComposite",
  "resetFirstVisibleFramePainted",
  "setRenderPassPerfOverlayEnabled",
  "ensureLayerDataFromTopology",
  "rebuildPoliticalLandCollections",
  "applyRendererSurfaceBridgeState",
  "ensureSovereigntyState",
  "normalizeColorStateForRender",
  "setDebugMode",
  "resetRenderDiagnostics",
  "clearRenderPhaseTimer",
  "resetRenderPhaseState",
  "resetTooltipState",
  "cancelScheduledHoverOverlayRender",
  "markAllOverlaysDirty",
  "clearStagedMapDataTasks",
  "cancelExactAfterSettleRefresh",
  "cancelPendingIndexUiRefresh",
  "resetDeferredRenderFlags",
  "resetProjectedBoundsCacheState",
  "invalidateAllRenderPasses",
  "syncDayNightClockTimerBridge",
]);

const LATER_STARTUP_BRANCH_TOKENS = Object.freeze([
  "rendererSurfaceHost.getMapCanvas().style.pointerEvents = \"none\";",
  "rendererSurfaceHost.getMapCanvas().style.touchAction = \"none\";",
  "buildRuntimePoliticalMeta();",
  "setCanvasSize();",
  "buildIndex();",
  "setInteractionInfrastructureState(\"deferred-startup\", {",
  "rebuildStaticMeshes();",
  "invalidateBorderCache();",
  "updateDynamicBorderStatusUI();",
  "fitProjection({ skipSpatialIndex: shouldDeferInteractionInfrastructure });",
  "initZoom();",
  "bindEvents();",
  `${RUNTIME_STATE_TOKEN}.getViewportGeoBoundsFn = getViewportGeoBounds;`,
  "setInteractionInfrastructureState(\"ready\", {",
  "render();",
]);

const RENDER_SEMANTIC_ANCHORS = Object.freeze([
  "function render()",
  "function drawCanvas()",
  "function renderPassToCache(",
  "async function buildHitCanvasAfterStartup",
  "createScenarioRefreshRuntime({",
  "createExactAfterSettleScheduler({",
  "createStrategicOverlayRuntimeOwner({",
]);

const DOC_HEADINGS = Object.freeze([
  "## Scope and guardrails",
  "## Current P34 renderer lifecycle baseline",
  "## initMap owned sequence after surface/projection setup",
  "## Cache and topology reset inventory",
  "## Render pass and visible-frame reset inventory",
  "## Runtime phase and deferred-flag reset inventory",
  "## Day-night and canvas pointer style inventory",
  "## Interaction infrastructure startup branch",
  "## P36 allowed first move",
  "## P36 forbidden areas",
  "## Required validation commands",
]);

const P36_ALLOWED_DOC_TOKENS = Object.freeze([
  "P35 is preflight only.",
  "P36 may add `js/core/renderer/renderer_startup_transaction_owner.js`.",
  "P36 may only move the `initMap` reset/startup transaction after projection/path creation through injected getters and effects.",
  "P36 must keep `initMap` as the composition root and must preserve the public wrapper in `js/core/map_renderer.js`.",
  "P36 must keep state writes as injected effects from `map_renderer.js` or existing state ops.",
  "P36 must preserve `applyRendererSurfaceBridgeState(runtimeState, { ... })` call location relative to `rebuildPoliticalLandCollections()` and `migrateLegacyColorState()`.",
]);

const P36_FORBIDDEN_DOC_TOKENS = Object.freeze([
  "render lifecycle owner",
  "`drawCanvas`",
  "`renderPassToCache`",
  "hit canvas build",
  "`setMapData` migration",
  "scenario refresh/chunk migration",
  "exact-after-settle scheduler migration",
  "strategic overlay runtime migration",
  "`initZoom` or `bindEvents` migration",
  "renderer public facade change",
  "direct `runtimeState` writes inside the new owner",
  "import of `js/core/map_renderer.js` from the new owner",
]);

function readRepoFile(...parts) {
  const absolutePath = path.join(REPO_ROOT, ...parts);
  assert.ok(fs.existsSync(absolutePath), `Expected repository file to exist: ${parts.join("/")}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function repoFileExists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function assertIncludes(source, token, message) {
  assert.ok(source.includes(token), `${message}: missing ${JSON.stringify(token)}`);
}

function assertExcludes(source, token, message) {
  assert.equal(source.includes(token), false, `${message}: unexpected ${JSON.stringify(token)}`);
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected start marker ${JSON.stringify(startMarker)}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Expected end marker ${JSON.stringify(endMarker)}`);
  return source.slice(start, end);
}

test("P36 adds a startup transaction owner and behavior test", () => {
  assert.equal(
    repoFileExists(STARTUP_OWNER_PATH),
    true,
    "P36 must add renderer_startup_transaction_owner.js",
  );
  assert.equal(
    repoFileExists(STARTUP_OWNER_TEST_PATH),
    true,
    "P36 must add startup transaction owner behavior tests",
  );
});

test("initMap delegates only reset transaction ordering after projection/path initialization", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const initMapSource = sliceBetween(
    rendererSource,
    "function initMap({",
    "function markRendererTopologyChanged(",
  );

  for (const token of OWNERIZED_INIT_MAP_TOKENS) {
    assertIncludes(initMapSource, token, "initMap must keep current ownerized startup call");
  }
  for (const token of LATER_STARTUP_BRANCH_TOKENS) {
    assertIncludes(initMapSource, token, "initMap must keep later startup branch token");
  }
  assertIncludes(
    initMapSource,
    "getRendererStartupTransactionOwner().runInitMapResetTransaction({ debugMode });",
    "initMap must delegate reset transaction through P36 owner",
  );
  for (const token of RESET_TRANSACTION_TOKENS) {
    assertExcludes(initMapSource, token, "initMap must move raw reset transaction token into P36 owner wiring");
  }

  const projectionIndex = initMapSource.indexOf("getRendererProjectionPathOwner().initializeProjectionPaths();");
  const transactionOwnerIndex = initMapSource.indexOf("getRendererStartupTransactionOwner().runInitMapResetTransaction({ debugMode });");
  const pointerStyleIndex = initMapSource.indexOf("rendererSurfaceHost.getMapCanvas().style.pointerEvents = \"none\";");

  assert.ok(projectionIndex < transactionOwnerIndex, "reset transaction owner call must follow projection/path initialization");
  assert.ok(transactionOwnerIndex < pointerStyleIndex, "reset transaction owner call must precede later startup branch");
});

test("render semantic anchors remain in map_renderer and outside P36 first move", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");

  for (const token of RENDER_SEMANTIC_ANCHORS) {
    assertIncludes(rendererSource, token, "P36 first move must leave render semantic anchor in map_renderer");
  }
});

test("viewport update owner reads viewport group through getter", () => {
  const ownerSource = readRepoFile("js", "core", "renderer", "renderer_viewport_update_owner.js");

  assertIncludes(ownerSource, "export function createRendererViewportUpdateOwner({", "viewport owner must exist");
  assertIncludes(ownerSource, "getters = {},", "viewport owner must preserve factory signature");
  assertIncludes(
    ownerSource,
    'const getViewportGroup = requireFunction(getters, "getViewportGroup", "getters");',
    "viewport owner must read viewport group through injected getter",
  );
  assertIncludes(ownerSource, "const viewportGroup = getViewportGroup();", "viewport owner must call viewport group getter");
  assertIncludes(ownerSource, 'viewportGroup.attr("transform"', "viewport owner must apply transform to viewport group");
  for (const token of ["runtimeState", "map_renderer.js", "fitProjection", "initMap", "setMapData"]) {
    assertExcludes(ownerSource, token, "viewport owner must avoid startup transaction tokens");
  }
});

test("fitProjection owner remains effects-only and outside initMap transaction ownership", () => {
  const ownerSource = readRepoFile("js", "core", "renderer", "renderer_fit_projection_owner.js");

  assertIncludes(ownerSource, "effects = {},", "fitProjection owner must preserve effects injection");
  assertIncludes(ownerSource, "const resetCityAnchorCache = requireFunction(effects, \"resetCityAnchorCache\", \"effects\");", "fitProjection owner must use injected effects");
  for (const token of [
    "function initMap(",
    "init-map",
    "topologyRevision",
    "applyRendererSurfaceBridgeState",
    "clearPendingPoliticalColorEdit",
    "resetExactRefreshOptimizationState",
    "clearLastGoodFrame",
    "invalidateAllRenderPasses",
  ]) {
    assertExcludes(ownerSource, token, "fitProjection owner must not own initMap transaction token");
  }
});

test("startup transaction owner owns ordering tokens and stays import-safe", () => {
  const ownerSource = readRepoFile("js", "core", "renderer", "renderer_startup_transaction_owner.js");

  assertIncludes(
    ownerSource,
    "export function createRendererStartupTransactionOwner({",
    "startup transaction owner must expose factory",
  );
  assertIncludes(
    ownerSource,
    "function runInitMapResetTransaction({ debugMode } = {})",
    "startup transaction owner must expose initMap reset transaction method",
  );
  for (const token of OWNER_EFFECT_TOKENS) {
    assertIncludes(ownerSource, token, "startup transaction owner must own ordered effect token");
  }
  for (const token of [
    "map_renderer.js",
    "runtimeState",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "setMapData",
    "scenario refresh",
    "scenario chunk",
    "exactAfterSettle",
    "strategicOverlayRuntime",
    "initZoom",
    "bindEvents",
  ]) {
    assertExcludes(ownerSource, token, "startup transaction owner must avoid forbidden renderer semantic token");
  }
});

test("map_renderer wires startup transaction owner effects at the composition root", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const ownerFactorySource = sliceBetween(
    rendererSource,
    "function getRendererStartupTransactionOwner()",
    "function getStrategicOverlayHelpersOwner()",
  );

  for (const token of [
    "import { createRendererStartupTransactionOwner } from \"./renderer/renderer_startup_transaction_owner.js\";",
    "let rendererStartupTransactionOwner = null;",
  ]) {
    assertIncludes(rendererSource, token, "map_renderer must wire startup transaction owner at top level");
  }

  for (const token of [
    "rendererStartupTransactionOwner = createRendererStartupTransactionOwner({",
    "resetLayerResolverCache: () => {",
    "layerResolverCache.primaryRef = null;",
    `${RUNTIME_STATE_TOKEN}.topologyRevision = Number(${RUNTIME_STATE_TOKEN}.topologyRevision || 0) + 1;`,
    `${RUNTIME_STATE_TOKEN}.hitCanvasTopologyRevision = 0;`,
    "getRenderPassCacheState().perfOverlayEnabled = enabled;",
    "applyRendererSurfaceBridgeState(runtimeState, {",
    "normalizeColorStateForRender(state, {",
    `${RUNTIME_STATE_TOKEN}.debugMode = nextDebugMode;`,
    "resetRenderPhaseState: () => getRenderPhaseLifecycleOwner().resetRenderPhaseState(\"init-map\"),",
    "resetTooltipState: () => getMapHoverInteractionOwner().resetTooltipState(),",
    `${RUNTIME_STATE_TOKEN}.deferContextBasePass = false;`,
    'registerRuntimeHook(null, "syncDayNightClockTimerFn", syncDayNightClockTimer);',
  ]) {
    assertIncludes(ownerFactorySource, token, "map_renderer must wire startup transaction owner effect");
  }
  assertIncludes(
    ownerFactorySource,
    "syncDayNightClockTimer();",
    "map_renderer effect must preserve day-night timer sync",
  );
});

test("package exposes startup transaction owner and inventory scripts", () => {
  const packageSource = readRepoFile("package.json");
  assertIncludes(
    packageSource,
    "\"test:node:renderer-startup-transaction-owner\": \"node --test tests/renderer_startup_transaction_owner_behavior.test.mjs\"",
    "package.json must expose the P36 startup transaction owner behavior test",
  );
  assertIncludes(
    packageSource,
    "\"test:node:renderer-startup-transaction-inventory\": \"node --test tests/renderer_startup_transaction_inventory_boundary.test.mjs\"",
    "package.json must expose the P35 startup transaction inventory test",
  );
});

test("P35 preflight doc locks P36 allowed and forbidden scope", () => {
  const docSource = readRepoFile(...PREFLIGHT_DOC_PATH.split("/"));

  for (const heading of DOC_HEADINGS) {
    assertIncludes(docSource, heading, "P35 doc must keep required heading");
  }
  for (const token of P36_ALLOWED_DOC_TOKENS) {
    assertIncludes(docSource, token, "P35 doc must lock P36 allowed first move");
  }
  for (const token of P36_FORBIDDEN_DOC_TOKENS) {
    assertIncludes(docSource, token, "P35 doc must lock P36 forbidden area");
  }
});
