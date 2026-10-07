import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const SET_MAP_DATA_TRANSACTION_OWNER_PATH = "js/core/map_renderer/set_map_data_transaction_owner.js";
const SET_MAP_DATA_TRANSACTION_OWNER_TEST_PATH = "tests/renderer_set_map_data_transaction_owner_behavior.test.mjs";
const RENDER_LIFECYCLE_OWNER_PATH = "js/core/renderer/renderer_render_lifecycle_owner.js";
const PREFLIGHT_DOC_PATH = "docs/active/renderer-set-map-data-transaction-preflight-20260630.md";
const RUNTIME_STATE_TOKEN = ["runtime", "State"].join("");

const SET_MAP_DATA_SIGNATURE_TOKENS = Object.freeze([
  "function setMapData({",
  "refitProjection = true",
  "resetZoom = true",
  "suppressRender = false",
  "interactionLevel = \"full\"",
  "deferInteractionInfrastructure = false",
]);

const SET_MAP_DATA_WRAPPER_TOKENS = Object.freeze([
  "return getSetMapDataTransactionOwner().runSetMapDataTransaction({",
  "refitProjection,",
  "resetZoom,",
  "suppressRender,",
  "interactionLevel,",
  "deferInteractionInfrastructure,",
]);

const SET_MAP_DATA_OWNER_ORDER_TOKENS = Object.freeze(`
runEffect("resetRendererTransactionState", {
runEffect("clearPendingPoliticalColorEdit", {
resetReason: SET_MAP_DATA_REASON
paintSource: SET_MAP_DATA_REASON
runEffect("clearRenderPassReferenceTransforms")
runEffect("clearLastGoodFrame", SET_MAP_DATA_REASON)
runEffect("invalidateInteractionComposite", SET_MAP_DATA_REASON)
runEffect("resetFirstVisibleFramePainted", SET_MAP_DATA_REASON)
runEffect("invalidateAllRenderPasses", SET_MAP_DATA_REASON)
runEffect("markAllOverlaysDirty")
runEffect("queueTooltipUpdate", { visible: false })
runEffect("rebuildPrimaryPoliticalCollections")
runEffect("recordCompositeCoverageDiagnostics", politicalCollections)
runEffect("sanitizeSetMapDataColorState")
runEffect("setCanvasSize")
runEffect("buildRuntimePoliticalMeta")
runEffect("resetSovereigntyInitialized")
runEffect("resetIslandNeighborsCache")
runEffect("clearSphericalFeatureDiagnosticsCache")
shouldDeferInteractionInfrastructure
runEffect("buildIndex")
runEffect("ensureSovereigntyState")
runEffect("setDeferHitCanvasBuild", true)
runEffect("setInteractionInfrastructureState", "deferred-startup"
runEffect("rebuildProjectedBoundsCache")
runEffect("rebuildStaticMeshes")
runEffect("invalidateBorderCache")
runEffect("updateDynamicBorderStatusUI")
runEffect("rebuildResolvedColors")
runEffect("fitProjection", { skipSpatialIndex: summary.shouldDeferInteractionInfrastructure })
runEffect("buildSpatialIndex")
runEffect("updateSpecialZonesPaths")
runEffect("renderSpecialZoneEditorOverlay")
runEffect("updateZoomTranslateExtent")
runEffect("resetZoomToFit")
runEffect("enforceZoomConstraints", { suppressRender })
runEffect("setHitCanvasDirty", true)
runEffect("beginStagedMapDataWarmup", startedAt)
runEffect("render")
runEffect("recordRenderPerfMetric", "setMapDataFirstPaint"
runEffect("recordRenderPerfMetric", "setMapData"
runEffect("setInteractionInfrastructureState", "ready"
`.trim().split("\n"));

const MAP_RENDERER_WIRING_TOKENS = Object.freeze([
  "import { createSetMapDataTransactionOwner } from \"./map_renderer/set_map_data_transaction_owner.js\";",
  "let setMapDataTransactionOwner = null;",
  "function getSetMapDataTransactionOwner()",
  "setMapDataTransactionOwner = createSetMapDataTransactionOwner({",
  "nowMs,",
  "getActiveScenarioId: () => runtimeState.activeScenarioId",
  "getLandFeatureCount: () => Array.isArray(runtimeState.landData?.features)",
  "getRenderProfile: () => runtimeState.renderProfile",
  "recordCompositeCoverageDiagnostics: ({",
  "Composite coverage",
  "Composite country coverage detail/primary",
  "sanitizeSetMapDataColorState: () => {",
  "resetSovereigntyInitialized: () => {",
  "resetIslandNeighborsCache: () => {",
  "clearSphericalFeatureDiagnosticsCache: () => {",
  "setDeferHitCanvasBuild: (deferred) => {",
  "setHitCanvasDirty: (dirty) => {",
]);

const MAP_RENDERER_STATE_WRITE_TOKEN_PARTS = Object.freeze([
  [RUNTIME_STATE_TOKEN, ".sovereignBaseColors = sanitizeCountryColorMap"],
  [RUNTIME_STATE_TOKEN, ".visualOverrides = sanitizeColorMap"],
  [RUNTIME_STATE_TOKEN, ".waterRegionOverrides = sanitizeColorMap"],
  [RUNTIME_STATE_TOKEN, ".specialRegionOverrides = {};"],
  [RUNTIME_STATE_TOKEN, ".sovereigntyInitialized = false;"],
  ["islandNeighborsCache = {"],
  ["ensureProjectedBoundsCache();"],
  ["clearSphericalFeatureDiagnosticsCacheState(runtimeState);"],
  [RUNTIME_STATE_TOKEN, ".deferHitCanvasBuild = Boolean(deferred);"],
  ["setHitCanvasDirtyState(runtimeState, dirty);"],
]);

const OWNER_FORBIDDEN_TOKEN_PARTS = Object.freeze([
  ["map_", "renderer.js"],
  ["runtime", "State"],
  ["draw", "Canvas"],
  ["renderPass", "ToCache"],
  ["build", "HitCanvas"],
  ["createScenario", "RefreshRuntime"],
  ["createExact", "AfterSettleScheduler"],
  ["createStrategicOverlay", "RuntimeOwner"],
  ["renderer_render", "_lifecycle_owner"],
]);

const P38_OUT_OF_SCOPE_ANCHORS = Object.freeze([
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
  "## Current P36 renderer lifecycle baseline",
  "## setMapData transaction overview",
  "## Pre-reset and render frame invalidation inventory",
  "## Political collection rebuild and coverage logging inventory",
  "## Color and scenario state sanitation inventory",
  "## Canvas, runtime meta, and interaction infrastructure branch",
  "## Projection, spatial index, special zone, and zoom branch",
  "## Staged warmup, render, and perf metrics branch",
  "## P38 allowed first move",
  "## P38 forbidden areas",
  "## Required validation commands",
]);

const P38_ALLOWED_DOC_TOKENS = Object.freeze([
  "Add `js/core/map_renderer/set_map_data_transaction_owner.js`.",
  "Move setMapData orchestration into owner through injected getters/effects.",
  "Keep public setMapData wrapper in `js/core/map_renderer.js` stable.",
  "Keep scenario refresh runtime separate.",
  "Keep `render()`, `drawCanvas()`, `renderPassToCache()`, hit canvas build, exact-after-settle scheduler, strategic overlay runtime out of the owner.",
  "Keep direct state writes either in map_renderer injected effects or existing state ops.",
  "Do not add a new state-write allowlist entry unless explicitly justified.",
  "Preserve `recordRenderPerfMetric` semantics and ordering.",
]);

const P38_FORBIDDEN_DOC_TOKENS = Object.freeze([
  "No `renderer_render_lifecycle_owner.js`.",
  "No drawCanvas migration.",
  "No renderPassToCache migration.",
  "No hit canvas build migration.",
  "No scenario refresh runtime migration.",
  "No exact-after-settle scheduler migration.",
  "No strategic overlay runtime migration.",
  "No public facade changes.",
  "No owner importing `js/core/map_renderer.js`.",
  "No broad state-write allowlist expansion.",
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

function assertTokensInOrder(source, tokens, message) {
  let cursor = -1;
  for (const token of tokens) {
    const next = source.indexOf(token, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ordered token ${JSON.stringify(token)}`);
    assert.ok(next > cursor, `${message}: token out of order ${JSON.stringify(token)}`);
    cursor = next;
  }
}

function getSetMapDataSource(rendererSource) {
  return sliceBetween(
    rendererSource,
    "function setMapData({",
    "function resetRendererRefreshTransactionState({",
  );
}

test("P38 requires setMapData transaction owner files and keeps render lifecycle owner absent", () => {
  assert.equal(
    repoFileExists(SET_MAP_DATA_TRANSACTION_OWNER_PATH),
    true,
    "P38 must add set_map_data_transaction_owner.js",
  );
  assert.equal(
    repoFileExists(SET_MAP_DATA_TRANSACTION_OWNER_TEST_PATH),
    true,
    "P38 must add setMapData transaction owner behavior coverage",
  );
  assert.equal(
    repoFileExists(RENDER_LIFECYCLE_OWNER_PATH),
    false,
    "P38 must keep renderer_render_lifecycle_owner.js absent",
  );
});

test("setMapData remains stable wrapper and delegates to transaction owner", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const setMapDataSource = getSetMapDataSource(rendererSource);

  for (const token of SET_MAP_DATA_SIGNATURE_TOKENS) {
    assertIncludes(setMapDataSource, token, "setMapData must keep current signature/default token");
  }
  for (const token of SET_MAP_DATA_WRAPPER_TOKENS) {
    assertIncludes(setMapDataSource, token, "setMapData wrapper must delegate normalized options");
  }

  for (const token of [
    "resetRendererTransactionState({",
    "clearPendingPoliticalColorEdit({",
    "rebuildPrimaryPoliticalCollections()",
    "recordRenderPerfMetric(\"setMapDataFirstPaint\"",
    "recordRenderPerfMetric(\"setMapData\"",
  ]) {
    assertExcludes(setMapDataSource, token, "setMapData wrapper must leave transaction work in the owner");
  }
});

test("setMapData transaction owner keeps current transaction anchors and order", () => {
  const ownerSource = readRepoFile(...SET_MAP_DATA_TRANSACTION_OWNER_PATH.split("/"));

  for (const token of SET_MAP_DATA_OWNER_ORDER_TOKENS) {
    assertIncludes(ownerSource, token, "setMapData owner must keep current transaction token");
  }
  assertTokensInOrder(
    ownerSource,
    SET_MAP_DATA_OWNER_ORDER_TOKENS,
    "setMapData must preserve high-level transaction order",
  );
  for (const tokenParts of OWNER_FORBIDDEN_TOKEN_PARTS) {
    assertExcludes(ownerSource, tokenParts.join(""), "setMapData owner must avoid out-of-bound token");
  }
});

test("map_renderer wires setMapData owner effects and keeps state writes injected", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const ownerFactorySource = sliceBetween(
    rendererSource,
    "function getSetMapDataTransactionOwner()",
    "function getStrategicOverlayHelpersOwner()",
  );

  for (const token of MAP_RENDERER_WIRING_TOKENS) {
    assertIncludes(rendererSource, token, "map_renderer must wire setMapData transaction owner");
  }
  for (const tokenParts of MAP_RENDERER_STATE_WRITE_TOKEN_PARTS) {
    assertIncludes(
      ownerFactorySource,
      tokenParts.join(""),
      "map_renderer owner wiring must keep concrete state writes injected",
    );
  }
});

test("render hit scenario exact and strategic anchors remain outside P38 first move", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const ownerSource = readRepoFile(...SET_MAP_DATA_TRANSACTION_OWNER_PATH.split("/"));

  for (const token of P38_OUT_OF_SCOPE_ANCHORS) {
    assertIncludes(rendererSource, token, "P38 must leave out-of-scope anchor in map_renderer");
    assertExcludes(ownerSource, token, "P38 owner must not absorb out-of-scope anchor");
  }
});

test("P36 startup transaction owner remains focused away from setMapData", () => {
  const ownerSource = readRepoFile("js", "core", "renderer", "renderer_startup_transaction_owner.js");

  assertIncludes(
    ownerSource,
    "function runInitMapResetTransaction({ debugMode } = {})",
    "startup owner must remain focused on initMap reset transaction",
  );
  for (const tokenParts of [
    ["set", "MapData"],
    ["draw", "Canvas"],
    ["renderPass", "ToCache"],
    ["build", "HitCanvas"],
    ["createScenario", "RefreshRuntime"],
  ]) {
    assertExcludes(ownerSource, tokenParts.join(""), "startup transaction owner must avoid setMapData scope");
  }
});

test("P34 viewport update owner reads viewport group through getter", () => {
  const ownerSource = readRepoFile("js", "core", "renderer", "renderer_viewport_update_owner.js");

  assertIncludes(ownerSource, "getters = {},", "viewport owner must preserve factory signature");
  assertIncludes(
    ownerSource,
    'const getViewportGroup = requireFunction(getters, "getViewportGroup", "getters");',
    "viewport owner must read viewport group through injected getter",
  );
  assertIncludes(ownerSource, "const viewportGroup = getViewportGroup();", "viewport owner must call viewport group getter");
  assertIncludes(ownerSource, 'viewportGroup.attr("transform"', "viewport owner must apply transform to viewport group");
  for (const tokenParts of [
    ["set", "MapData"],
    ["fit", "Projection"],
    ["exactAfter", "Settle"],
    ["runtime", "State"],
  ]) {
    assertExcludes(ownerSource, tokenParts.join(""), "viewport owner must avoid setMapData transaction scope");
  }
});

test("P32 fitProjection owner remains effects-injected and outside setMapData", () => {
  const ownerSource = readRepoFile("js", "core", "renderer", "renderer_fit_projection_owner.js");

  assertIncludes(ownerSource, "effects = {},", "fitProjection owner must keep effects injection");
  assertIncludes(
    ownerSource,
    "const resetCityAnchorCache = requireFunction(effects, \"resetCityAnchorCache\", \"effects\");",
    "fitProjection owner must keep injected effects",
  );
  for (const tokenParts of [
    ["set", "MapData"],
    ["draw", "Canvas"],
    ["renderPass", "ToCache"],
    ["build", "HitCanvas"],
    ["createScenario", "RefreshRuntime"],
    ["createExactAfter", "SettleScheduler"],
    ["createStrategicOverlay", "RuntimeOwner"],
  ]) {
    assertExcludes(ownerSource, tokenParts.join(""), "fitProjection owner must avoid setMapData transaction scope");
  }
});

test("public facade keeps stable setMapData export", () => {
  const publicFacadeSource = readRepoFile("js", "core", "map_renderer", "public.js");

  assertIncludes(publicFacadeSource, "setMapData,", "public facade must keep setMapData export");
  assertIncludes(publicFacadeSource, "from \"../map_renderer.js\";", "public facade must keep current renderer bridge");
});

test("package exposes P38 owner and inventory scripts", () => {
  const packageSource = readRepoFile("package.json");

  assertIncludes(
    packageSource,
    "\"test:node:renderer-set-map-data-transaction-owner\": \"node --test tests/renderer_set_map_data_transaction_owner_behavior.test.mjs\"",
    "package.json must expose the P38 setMapData transaction owner behavior test",
  );
  assertIncludes(
    packageSource,
    "\"test:node:renderer-set-map-data-transaction-inventory\": \"node --test tests/renderer_set_map_data_transaction_inventory_boundary.test.mjs\"",
    "package.json must keep the setMapData transaction inventory test",
  );
});

test("P37 preflight doc locks P38 allowed first move and forbidden areas", () => {
  const docSource = readRepoFile(...PREFLIGHT_DOC_PATH.split("/"));

  for (const heading of DOC_HEADINGS) {
    assertIncludes(docSource, heading, "P37 doc must keep required heading");
  }
  for (const token of P38_ALLOWED_DOC_TOKENS) {
    assertIncludes(docSource, token, "P37 doc must lock P38 allowed first move");
  }
  for (const token of P38_FORBIDDEN_DOC_TOKENS) {
    assertIncludes(docSource, token, "P37 doc must lock P38 forbidden area");
  }
});
