import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const PAGES_ARTIFACT_ROOT_ENV = "SCENARIO_FORGE_PAGES_ARTIFACT_ROOT";
const explicitPagesArtifactRoot = String(process.env[PAGES_ARTIFACT_ROOT_ENV] || "").trim();
const PAGES_DIST_ROOT = explicitPagesArtifactRoot
  ? path.resolve(REPO_ROOT, explicitPagesArtifactRoot)
  : path.join(REPO_ROOT, "dist");
if (explicitPagesArtifactRoot) {
  const runtimeRelative = path.relative(path.join(REPO_ROOT, ".runtime"), PAGES_DIST_ROOT);
  assert.ok(runtimeRelative && !runtimeRelative.startsWith("..") && !path.isAbsolute(runtimeRelative));
}
function pagesDistPath(...segments) {
  return path.relative(REPO_ROOT, path.join(PAGES_DIST_ROOT, ...segments)).replaceAll("\\", "/");
}

const MAP_RENDERER_PATH = "js/core/map_renderer.js";
const DRAW_CANVAS_ORCHESTRATION_OWNER_PATH = "js/core/map_renderer/draw_canvas_orchestration_owner.js";
const CACHED_PASS_COMPOSITOR_OWNER_PATH = "js/core/renderer/cached_pass_compositor_owner.js";
const TRANSFORMED_FRAME_COMPOSITOR_OWNER_PATH = "js/core/map_renderer/transformed_frame_compositor_owner.js";
const DIST_MAP_RENDERER_PATH = pagesDistPath("app", "js", "core", "map_renderer.js");
const DIST_DRAW_CANVAS_ORCHESTRATION_OWNER_PATH = pagesDistPath(
  "app", "js", "core", "map_renderer", "draw_canvas_orchestration_owner.js",
);
const DIST_CACHED_PASS_COMPOSITOR_OWNER_PATH = pagesDistPath(
  "app", "js", "core", "renderer", "cached_pass_compositor_owner.js",
);
const DIST_TRANSFORMED_FRAME_COMPOSITOR_OWNER_PATH = pagesDistPath(
  "app", "js", "core", "map_renderer", "transformed_frame_compositor_owner.js",
);
const HOST_OWNER_PATH = "js/core/map_renderer/render_pass_cache_host_owner.js";
const COMMIT_OWNER_PATH = "js/core/map_renderer/render_pass_commit_accounting_owner.js";
const RENDER_REQUEST_BOUNDARY_OWNER_PATH = "js/core/map_renderer/render_request_boundary_owner.js";
const RENDER_PHASE_LIFECYCLE_OWNER_PATH = "js/core/map_renderer/render_phase_lifecycle_owner.js";
const VISIBLE_FRAME_DIAGNOSTICS_OWNER_PATH = "js/core/renderer/visible_frame_diagnostics_owner.js";
const HIT_CANVAS_SCHEDULING_OWNER_PATH = "js/core/map_renderer/hit_canvas_scheduling_owner.js";
const RENDER_PIPELINE_PASSES_PATH = "js/core/renderer/render_pipeline_passes.js";
const RENDER_PIPELINE_CATALOG_PATH = "js/core/renderer/render_pipeline_catalog.js";
const RENDER_PASS_CATALOG_PATH = "js/core/map_renderer/render_pass_catalog.js";
const EXACT_AFTER_SETTLE_SCHEDULER_PATH = "js/core/map_renderer/exact_after_settle_scheduler.js";
const SCENARIO_REFRESH_RUNTIME_PATH = "js/core/map_renderer/scenario_refresh_runtime.js";
const PUBLIC_FACADE_PATH = "js/core/map_renderer/public.js";
const STATE_WRITE_ALLOWLIST_PATH = "tools/eslint-rules/state-writer-allowlist.json";
const STRATEGIC_OVERLAY_RUNTIME_OWNER_PATH = "js/core/renderer/strategic_overlay_runtime_owner.js";
const STRATEGIC_OVERLAY_RENDER_OWNER_PATH = "js/core/renderer/strategic_overlay_render_owner.js";

function readRepoFile(relativePath) {
  const absolutePath = path.join(REPO_ROOT, ...relativePath.split("/"));
  assert.ok(fs.existsSync(absolutePath), `Expected repository file to exist: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function repoFileExists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, ...relativePath.split("/")));
}

function listRepoSourceFiles(rootRelativePath) {
  const root = path.join(REPO_ROOT, rootRelativePath);
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && /\.m?js$/.test(entry.name)) {
        results.push(path.relative(REPO_ROOT, absolutePath).replaceAll(path.sep, "/"));
      }
    }
  }
  return results.sort();
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected start marker to exist: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Expected end marker to exist after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Expected function to exist: ${functionName}`);
  const signatureEnd = source.indexOf(") {", start + marker.length);
  assert.notEqual(signatureEnd, -1, `Expected function signature to close: ${functionName}`);
  const openBrace = signatureEnd + 2;
  assert.notEqual(openBrace, -1, `Expected function body to start: ${functionName}`);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`Expected function body to close: ${functionName}`);
}

function isForbiddenDrawCanvasOrchestrationOwnerPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (!normalized.startsWith("js/core/")) {
    return false;
  }
  const baseName = path.basename(normalized);
  if (!/\.m?js$/.test(baseName)) {
    return false;
  }
  const stem = baseName.replace(/\.m?js$/, "").toLowerCase();
  const compact = stem.replace(/[_-]/g, "");
  const hasDrawCanvas = compact.includes("drawcanvas");
  const hasOrchestration = compact.includes("orchestration") || compact.includes("orchestrator");
  const hasOwnerShape = /(?:^|_)(?:owner|helper|controller|adapter)(?:_|$)/.test(stem);
  return hasDrawCanvas && hasOrchestration && hasOwnerShape;
}

function assertIncludes(source, token, message) {
  assert.ok(source.includes(token), `${message}: missing ${JSON.stringify(token)}`);
}

function assertExcludes(source, token, message) {
  assert.equal(source.includes(token), false, `${message}: unexpected ${JSON.stringify(token)}`);
}

function isForbiddenCachedPassCompositorOwnerPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (normalized === CACHED_PASS_COMPOSITOR_OWNER_PATH) return false;
  if (!normalized.startsWith("js/core/")) return false;
  const stem = path.basename(normalized).replace(/\.m?js$/, "").toLowerCase().replace(/-/g, "_");
  const compact = stem.replaceAll("_", "");
  return compact.includes("cachedpasscompositor")
    && /(?:^|_)(?:owner|helper|controller|adapter)(?:_|$)/.test(stem);
}

function isForbiddenTransformedFrameCompositorOwnerPath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (normalized === TRANSFORMED_FRAME_COMPOSITOR_OWNER_PATH) return false;
  if (!normalized.startsWith("js/core/")) return false;
  const stem = path.basename(normalized).replace(/\.m?js$/, "").toLowerCase().replace(/-/g, "_");
  const compact = stem.replaceAll("_", "");
  return compact.includes("transformedframecompositor")
    && /(?:^|_)(?:owner|helper|controller|adapter)(?:_|$)/.test(stem);
}

function normalizeLineEndings(source) {
  return source.replace(/\r\n/g, "\n");
}

test("map_renderer keeps drawCanvas entry and renderPassToCache P51/P52 wrapper", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const renderPassToCacheSource = sliceBetween(
    rendererSource,
    "function renderPassToCache(",
    "function resetCanvasContext(",
  );
  const drawCanvasSource = extractFunctionSource(rendererSource, "drawCanvas");

  assertIncludes(rendererSource, "function drawCanvas()", "map_renderer must keep drawCanvas entry");
  assertIncludes(rendererSource, "function renderPassToCache(", "map_renderer must keep renderPassToCache wrapper");
  assertIncludes(
    rendererSource,
    "import { createRenderPassCacheHostOwner } from \"./map_renderer/render_pass_cache_host_owner.js\";",
    "map_renderer must keep P51 host owner import",
  );
  assertIncludes(
    rendererSource,
    "import { createRenderPassCommitAccountingOwner } from \"./map_renderer/render_pass_commit_accounting_owner.js\";",
    "map_renderer must keep P52 commit/accounting owner import",
  );
  assertIncludes(
    rendererSource,
    "import { createDrawCanvasOrchestrationOwner } from \"./map_renderer/draw_canvas_orchestration_owner.js\";",
    "map_renderer must keep P2.1 drawCanvas orchestration owner import",
  );

  for (const token of [
    "const hostResult = getRenderPassCacheHostOwner().prepareRenderPassHost({",
    "if (hostResult?.skipped) return;",
    "getRenderPassCommitAccountingOwner().commitRenderPass({",
    "drawResult: hostResult.drawResult,",
    "hostSummary: hostResult,",
  ]) {
    assertIncludes(renderPassToCacheSource, token, "renderPassToCache must keep P51/P52 delegation token");
  }

  for (const token of [
    "getDrawCanvasOrchestrationOwner().drawCanvasFrame();",
  ]) {
    assertIncludes(drawCanvasSource, token, "drawCanvas must keep orchestration token");
  }
});

test("P2.1 drawCanvas orchestration owner owns frame branch selection", () => {
  const ownerSource = readRepoFile(DRAW_CANVAS_ORCHESTRATION_OWNER_PATH);

  for (const token of [
    "export function createDrawCanvasOrchestrationOwner({ constants = {}, getters = {}, effects = {} } = {})",
    "function drawCanvasFrame(options)",
    "const includeSummary = options?.includeSummary === true;",
    "getRenderPhase() === renderPhaseInteracting && getFirstVisibleFramePainted()",
    "const useTransformedFrame = currentPhase === renderPhaseInteracting",
    "drawTransformedFrameFromCaches",
    "drawLastGoodFrameFallback",
    "drawBaseVisibleFrameFallback",
    "resetContextBreakdownForExactFrame",
    "ensureIdleRenderPasses",
    "composeCachedPasses",
    "abortPendingExactAfterSettleRefreshAfterPaint",
    "markFirstVisibleFramePainted",
    "captureLastGoodFrame",
    "recordRenderPerfMetric",
    "finalizePendingExactAfterSettleRefreshAfterPaint",
    "incrementPerfCounter",
  ]) {
    assertIncludes(ownerSource, token, "drawCanvas owner must keep orchestration token");
  }
  for (const token of [
    "effectOrder",
    "getterOrder",
    "createTrace",
    "runtimeState",
    "globalThis",
    "document",
    "window",
  ]) {
    assertExcludes(ownerSource, token, "drawCanvas owner must keep import-free JSON-safe boundary");
  }
});

test("P2.2a cached pass compositor owns cached canvas transform math only", () => {
  const ownerSource = readRepoFile(CACHED_PASS_COMPOSITOR_OWNER_PATH);
  for (const token of [
    "export function createCachedPassCompositorOwner({ constants = {}, getters = {}, helpers = {}, effects = {} } = {})",
    "function drawTransformedPass(passName, currentTransform, referenceTransform = null)",
    "function composeRenderPassesToTarget(",
    "{ requireAllPasses = false, targetOffsetX = 0, targetOffsetY = 0 } = {},",
    "const cacheSnapshot = getRenderPassCacheSnapshot();",
    "const targetContext = getActiveTargetContext();",
    "const scaleRatio = current.k / Math.max(reference.k, 0.0001);",
    "const missingCanvasPassNames = [];",
    "const missingReferenceTransformPassNames = [];",
    "reason: \"missing-pass-canvas\"",
    "reason: \"missing-reference-transform\"",
    "Math.round((targetOffsetX - Number(layout?.offsetX || 0)) * dpr)",
    "Math.round((targetOffsetY - Number(layout?.offsetY || 0)) * dpr)",
    "recordTransformedPassDiagnostics(passName, {",
    "return Object.freeze({",
  ]) {
    assertIncludes(ownerSource, token, "cached-pass compositor must keep owner token");
  }
  for (const token of [
    "composeTransformedFrameToBuffer",
    "drawTransformedFrameFromCaches",
    "buildInteractionComposite",
    "drawInteractionComposite",
    "drawInteractionBorderSnapshot",
    "drawBordersPass",
    "drawLastGoodFrameFallback",
    "drawBaseVisibleFrameFallback",
    "renderPassToCache",
    "runtimeState",
    "globalThis",
    "document",
    "window",
    "runGetter",
    "runEffect",
    "createTrace",
  ]) {
    assertExcludes(ownerSource, token, "cached-pass compositor must avoid adjacent/global token");
  }
});

test("P2.2b transformed frame compositor owns buffered transformed-frame decisions only", () => {
  const ownerSource = readRepoFile(TRANSFORMED_FRAME_COMPOSITOR_OWNER_PATH);
  for (const token of [
    "export function createTransformedFrameCompositorOwner({",
    "function composeTransformedFrameToBuffer(",
    "function drawTransformedFrameFromCaches(",
    "setInteractionCompositeRejectedReason(compositeReuseDecision.reason || \"unknown\")",
    "setPendingExactPoliticalFastFrame(false)",
    "blitCompositeBufferToMain(bufferCanvas)",
    "return Object.freeze({",
  ]) {
    assertIncludes(ownerSource, token, "transformed-frame compositor must keep owner token");
  }
  for (const token of [
    "renderPassToCache",
    "drawLastGoodFrameFallback",
    "drawBaseVisibleFrameFallback",
    "runtimeState",
    "globalThis",
    "document",
    "window",
    "runGetter",
    "runEffect",
    "createTrace",
  ]) {
    assertExcludes(ownerSource, token, "transformed-frame compositor must avoid adjacent/global token");
  }
});

test("map_renderer keeps frame compositor composition roots and thin wrappers", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const drawWrapper = extractFunctionSource(rendererSource, "drawTransformedPass");
  const composeWrapper = extractFunctionSource(rendererSource, "composeRenderPassesToTarget");
  const bufferWrapper = extractFunctionSource(rendererSource, "composeTransformedFrameToBuffer");
  const transformedFrameWrapper = extractFunctionSource(rendererSource, "drawTransformedFrameFromCaches");
  for (const token of [
    "import { createCachedPassCompositorOwner } from \"./renderer/cached_pass_compositor_owner.js\";",
    "let cachedPassCompositorOwner = null;",
    "function getCachedPassCompositorOwner() {",
    "getActiveTargetContext: () => rendererSurfaceHost.getContext()",
    "getRenderPassCacheSnapshot: getRenderPassCacheState",
    "recordTransformedPassDiagnostics: (passName, details) => {",
  ]) {
    assertIncludes(rendererSource, token, "map_renderer must keep cached-pass composition token");
  }
  assertIncludes(drawWrapper, "return getCachedPassCompositorOwner().drawTransformedPass(", "draw wrapper must delegate");
  assertIncludes(composeWrapper, "return getCachedPassCompositorOwner().composeRenderPassesToTarget(", "compose wrapper must delegate");
  assertIncludes(composeWrapper, "options,", "compose wrapper must forward the caller-owned options object");
  assertExcludes(composeWrapper, "{ requireAllPasses }", "compose wrapper must avoid rebuilding caller options");
  const cachedOwnerGetter = extractFunctionSource(rendererSource, "getCachedPassCompositorOwner");
  assertExcludes(cachedOwnerGetter, "getPassCanvas:", "cached owner wiring must use one cache snapshot getter");
  assertExcludes(cachedOwnerGetter, "isPassDirty:", "cached owner wiring must derive diagnostics from its cache snapshot");
  for (const token of [
    "import { createTransformedFrameCompositorOwner } from \"./map_renderer/transformed_frame_compositor_owner.js\";",
    "let transformedFrameCompositorOwner = null;",
    "function getTransformedFrameCompositorOwner() {",
  ]) {
    assertIncludes(rendererSource, token, "map_renderer must keep transformed-frame composition token");
  }
  assertIncludes(
    bufferWrapper,
    "return getTransformedFrameCompositorOwner().composeTransformedFrameToBuffer(",
    "buffer wrapper must delegate",
  );
  assertIncludes(
    transformedFrameWrapper,
    "return getTransformedFrameCompositorOwner().drawTransformedFrameFromCaches(timings, options);",
    "transformed-frame wrapper must delegate",
  );
  for (const token of ["scaleRatio", "missingCanvasPassNames", "targetContext.drawImage(", "renderDiag.transformedPasses"]) {
    assertExcludes(drawWrapper, token, "draw wrapper must stay thin");
    assertExcludes(composeWrapper, token, "compose wrapper must stay thin");
  }
  for (const functionName of [
    "buildInteractionComposite",
    "drawInteractionComposite",
    "drawInteractionBorderSnapshot",
    "drawBordersPass",
    "drawLastGoodFrameFallback",
    "drawBaseVisibleFrameFallback",
    "renderPassToCache",
  ]) {
    assertIncludes(rendererSource, `function ${functionName}(`, `${functionName} must remain in map_renderer`);
  }
});

test("P51 and P52 owners remain bounded around renderPassToCache", () => {
  const hostOwnerSource = readRepoFile(HOST_OWNER_PATH);
  const commitOwnerSource = readRepoFile(COMMIT_OWNER_PATH);

  for (const token of [
    "export function createRenderPassCacheHostOwner({",
    "function prepareRenderPassHost({",
    "passCanvas.getContext(\"2d\")",
    "runEffect(trace, \"prepareTargetContext\", passContext, transform, layout);",
    "drawResult = drawFn(k);",
  ]) {
    assertIncludes(hostOwnerSource, token, "P51 host owner must keep host setup token");
  }
  for (const token of [
    "cache.signatures",
    "cache.dirty",
    "recordRenderPerfMetric",
    "recordPassTiming",
    "schedulePoliticalPathWarmup",
    "drawCanvas",
    "buildHitCanvas",
  ]) {
    assertExcludes(hostOwnerSource, token, "P51 host owner must avoid commit/drawCanvas token");
  }

  for (const token of [
    "export function createRenderPassCommitAccountingOwner({",
    "function commitRenderPass({",
    "cache.signatures[normalizedPassName] =",
    "cache.dirty[normalizedPassName] = false;",
    "runEffect(trace, \"recordPassTiming\", timings, normalizedPassName, passStart);",
    "runGetter(trace, \"getPassCounterNames\", normalizedPassName)",
    ".forEach((counterName) => runEffect(trace, \"incrementPerfCounter\", counterName));",
  ]) {
    assertIncludes(commitOwnerSource, token, "P52 commit/accounting owner must keep accounting token");
  }
  for (const token of [
    "prepareRenderPassHost",
    "passCanvas.getContext(\"2d\")",
    "prepareTargetContext",
    "withRenderTarget",
    "drawCanvas",
    "drawPoliticalPass",
    "drawContextBasePass",
    "buildHitCanvas",
    "scenario_refresh",
    "exact_after_settle",
    "strategic_overlay",
    "runtimeState",
    "document",
    "window",
  ]) {
    assertExcludes(commitOwnerSource, token, "P52 commit/accounting owner must avoid adjacent renderer token");
  }
});

test("render pipeline passes and catalogs remain authoritative for pass definitions", () => {
  const renderPipelinePassesSource = readRepoFile(RENDER_PIPELINE_PASSES_PATH);
  const renderPipelineCatalogSource = readRepoFile(RENDER_PIPELINE_CATALOG_PATH);
  const renderPassCatalogSource = readRepoFile(RENDER_PASS_CATALOG_PATH);

  for (const token of [
    "export function createRenderPipelinePassesOwner({",
    "function getIdleRenderPassDefinitions()",
    "function prepareIdleRenderPassDefinition(passName, drawFn, transform, timings, cache = getRenderPassCacheState())",
    "function ensureIdleRenderPasses(timings, passNames = null)",
    "renderPassToCache(passName, drawFn, transform, timings);",
  ]) {
    assertIncludes(renderPipelinePassesSource, token, "render_pipeline_passes must keep pass orchestration token");
  }
  for (const token of [
    "export const IDLE_RENDER_PASS_DEFINITIONS = [",
    "{ passName: \"background\", drawKey: \"drawBackgroundPass\" }",
    "{ passName: \"labels\", drawKey: \"drawLabelsPass\" }",
  ]) {
    assertIncludes(renderPipelineCatalogSource, token, "render_pipeline_catalog must keep idle pass definition");
  }
  for (const token of [
    "export const RENDER_PASS_NAMES = [",
    "export const INTERACTION_COMPOSITE_PASS_NAMES = [",
    "export const TRANSFORMED_FRAME_PASS_NAMES = [",
  ]) {
    assertIncludes(renderPassCatalogSource, token, "render_pass_catalog must keep pass group token");
  }
});

test("adjacent lifecycle diagnostic hit exact scenario and strategic owners stay separate", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const requestBoundaryOwnerSource = readRepoFile(RENDER_REQUEST_BOUNDARY_OWNER_PATH);
  const phaseLifecycleOwnerSource = readRepoFile(RENDER_PHASE_LIFECYCLE_OWNER_PATH);
  const visibleFrameDiagnosticsOwnerSource = readRepoFile(VISIBLE_FRAME_DIAGNOSTICS_OWNER_PATH);
  const hitCanvasSchedulingOwnerSource = readRepoFile(HIT_CANVAS_SCHEDULING_OWNER_PATH);
  const exactAfterSettleSchedulerSource = readRepoFile(EXACT_AFTER_SETTLE_SCHEDULER_PATH);
  const scenarioRefreshRuntimeSource = readRepoFile(SCENARIO_REFRESH_RUNTIME_PATH);
  const strategicOverlayRuntimeOwnerSource = readRepoFile(STRATEGIC_OVERLAY_RUNTIME_OWNER_PATH);
  const strategicOverlayRenderOwnerSource = readRepoFile(STRATEGIC_OVERLAY_RENDER_OWNER_PATH);

  for (const token of [
    "function markFirstVisibleFramePainted(reason = \"visible-frame\")",
    "getVisibleFrameDiagnosticsOwner().markFirstVisibleFramePainted(reason);",
    "function scheduleHitCanvasBuildIfNeeded({ reason = \"idle-render\" } = {})",
    "function drawHitCanvas()",
    "async function buildHitCanvasAfterStartup({ keepReady = false, reason = \"startup-deferred-hit-canvas\" } = {})",
    "function refreshMapDataForScenarioChunkPromotion(options = {})",
    "function refreshMapDataForScenarioApply(options = {})",
    "createStrategicOverlayRuntimeOwner({",
    "createStrategicOverlayRenderOwner({",
  ]) {
    assertIncludes(rendererSource, token, "map_renderer must keep adjacent boundary wrapper/anchor");
  }

  for (const [relativePath, source] of [
    [RENDER_REQUEST_BOUNDARY_OWNER_PATH, requestBoundaryOwnerSource],
    [RENDER_PHASE_LIFECYCLE_OWNER_PATH, phaseLifecycleOwnerSource],
    [VISIBLE_FRAME_DIAGNOSTICS_OWNER_PATH, visibleFrameDiagnosticsOwnerSource],
    [HIT_CANVAS_SCHEDULING_OWNER_PATH, hitCanvasSchedulingOwnerSource],
    [EXACT_AFTER_SETTLE_SCHEDULER_PATH, exactAfterSettleSchedulerSource],
    [SCENARIO_REFRESH_RUNTIME_PATH, scenarioRefreshRuntimeSource],
    [STRATEGIC_OVERLAY_RUNTIME_OWNER_PATH, strategicOverlayRuntimeOwnerSource],
    [STRATEGIC_OVERLAY_RENDER_OWNER_PATH, strategicOverlayRenderOwnerSource],
  ]) {
    assertExcludes(source, "function drawCanvas()", `${relativePath} must not own drawCanvas`);
    assertExcludes(source, "renderPassToCache(passName", `${relativePath} must not call renderPassToCache directly`);
  }

  for (const token of [
    "drawHitCanvas",
    "drawHitCanvasWithMetric",
    "buildHitCanvasAfterStartup",
    "getDirtyHitCanvasPointProbeHit",
  ]) {
    assertExcludes(hitCanvasSchedulingOwnerSource, token, "hit canvas scheduling owner must avoid build/probe token");
  }
  assertIncludes(exactAfterSettleSchedulerSource, "function scheduleExactAfterSettleRefresh(", "exact scheduler must keep scheduling entry");
  assertIncludes(scenarioRefreshRuntimeSource, "function refreshMapDataForScenarioChunkPromotion(", "scenario runtime must keep chunk refresh entry");
});

test("P2 owners keep public facade state allowlist topology and dist mirrors aligned", () => {
  const packageJsonSource = readRepoFile("package.json");
  const publicFacadeSource = readRepoFile(PUBLIC_FACADE_PATH);
  const stateWriteAllowlistSource = readRepoFile(STATE_WRITE_ALLOWLIST_PATH);
  const stateWriteAllowlist = JSON.parse(stateWriteAllowlistSource);
  const ownerSource = readRepoFile(DRAW_CANVAS_ORCHESTRATION_OWNER_PATH);
  const cachedPassCompositorOwnerSource = readRepoFile(CACHED_PASS_COMPOSITOR_OWNER_PATH);
  const transformedFrameCompositorOwnerSource = readRepoFile(TRANSFORMED_FRAME_COMPOSITOR_OWNER_PATH);
  const distOwnerSource = readRepoFile(DIST_DRAW_CANVAS_ORCHESTRATION_OWNER_PATH);
  const distCachedPassCompositorOwnerSource = readRepoFile(DIST_CACHED_PASS_COMPOSITOR_OWNER_PATH);
  const distTransformedFrameCompositorOwnerSource = readRepoFile(DIST_TRANSFORMED_FRAME_COMPOSITOR_OWNER_PATH);
  const distRendererSource = readRepoFile(DIST_MAP_RENDERER_PATH);

  assertIncludes(
    packageJsonSource,
    "\"test:node:renderer-draw-canvas-orchestration-inventory\": \"node --test tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs\"",
    "package.json must expose P53 inventory script",
  );
  assertIncludes(
    packageJsonSource,
    "\"test:node:draw-canvas-orchestration-owner\": \"node --test tests/draw_canvas_orchestration_owner_behavior.test.mjs\"",
    "package.json must expose P2.1 owner behavior script",
  );
  assertIncludes(
    packageJsonSource,
    "\"test:python:map-renderer-draw-canvas-orchestration-boundary\": \"npm run python -- -m unittest tests.test_map_renderer_draw_canvas_orchestration_owner_boundary_contract -q\"",
    "package.json must expose P2.1 Python boundary script",
  );
  assertIncludes(
    packageJsonSource,
    "\"test:node:cached-pass-compositor-owner\": \"node --test tests/cached_pass_compositor_owner_behavior.test.mjs\"",
    "package.json must expose P2.2a owner behavior script",
  );
  assertIncludes(
    packageJsonSource,
    "\"test:python:map-renderer-frame-compositor-boundary\": \"npm run python -- -m unittest tests.test_map_renderer_frame_compositor_owner_boundary_contract -q\"",
    "package.json must expose P2.2a Python boundary script",
  );
  assertIncludes(
    packageJsonSource,
    "\"test:node:transformed-frame-compositor-owner\": \"node --test tests/transformed_frame_compositor_owner_behavior.test.mjs\"",
    "package.json must expose P2.2b owner behavior script",
  );
  assertIncludes(
    packageJsonSource,
    "\"test:node:transformed-frame-compositor-owner-suite\": \"npm run test:node:transformed-frame-compositor-owner && npm run test:node:renderer-draw-canvas-orchestration-inventory && npm run test:python:map-renderer-frame-compositor-boundary\"",
    "package.json must expose P2.2b owner suite",
  );

  for (const token of [
    "render,",
    "setMapData,",
    "initMap,",
    "RENDER_PASS_NAMES,",
    "from \"../map_renderer.js\";",
  ]) {
    assertIncludes(publicFacadeSource, token, "public facade must keep renderer facade token");
  }
  for (const token of [
    "draw_canvas_orchestration",
    "renderer_draw_canvas_orchestration",
    "drawCanvasOrchestration",
    "renderer_render_lifecycle_owner",
    "cached_pass_compositor_owner",
    "cachedPassCompositorOwner",
    "transformed_frame_compositor_owner",
    "transformedFrameCompositorOwner",
  ]) {
    assertExcludes(publicFacadeSource, token, "public facade must not expose P53/P40 forbidden owner token");
    assertExcludes(stateWriteAllowlistSource, token, "state-write allowlist must not include P53/P40 forbidden owner token");
  }
  assert.equal(
    stateWriteAllowlist.files.includes(MAP_RENDERER_PATH),
    true,
    "state-write allowlist must retain the existing map_renderer composition-root entry",
  );
  assert.equal(
    stateWriteAllowlist.files.includes(DRAW_CANVAS_ORCHESTRATION_OWNER_PATH),
    false,
    "state-write allowlist must keep the pure drawCanvas owner out",
  );
  assert.equal(
    stateWriteAllowlist.files.includes(CACHED_PASS_COMPOSITOR_OWNER_PATH),
    false,
    "state-write allowlist must keep the pure cached-pass compositor out",
  );
  assert.equal(
    stateWriteAllowlist.files.includes(TRANSFORMED_FRAME_COMPOSITOR_OWNER_PATH),
    false,
    "state-write allowlist must keep the pure transformed-frame compositor out",
  );

  for (const relativePath of [
    "js/core/renderer/renderer_render_lifecycle_owner.js",
    "js/core/renderer/draw_canvas_orchestration_owner.js",
    "js/core/renderer/draw_canvas_orchestration_helper.js",
    "js/core/renderer/draw_canvas_orchestration_controller.js",
    "js/core/map_renderer/draw_canvas_orchestration_helper.js",
    "js/core/map_renderer/draw_canvas_orchestration_controller.js",
  ]) {
    assert.equal(repoFileExists(relativePath), false, `P53 must not add production owner/helper: ${relativePath}`);
  }
  assert.equal(repoFileExists(DRAW_CANVAS_ORCHESTRATION_OWNER_PATH), true, "P2.1 must keep canonical drawCanvas owner");
  assert.equal(repoFileExists(CACHED_PASS_COMPOSITOR_OWNER_PATH), true, "P2.2a must keep canonical cached-pass compositor");
  assert.equal(repoFileExists(TRANSFORMED_FRAME_COMPOSITOR_OWNER_PATH), true, "P2.2b must keep canonical transformed-frame compositor");
  for (const sourcePath of listRepoSourceFiles("js/core")) {
    if (sourcePath === DRAW_CANVAS_ORCHESTRATION_OWNER_PATH) continue;
    assert.equal(
      isForbiddenDrawCanvasOrchestrationOwnerPath(sourcePath),
      false,
      `P53 must not add renamed production drawCanvas orchestration owner/helper: ${sourcePath}`,
    );
    assert.equal(
      isForbiddenCachedPassCompositorOwnerPath(sourcePath),
      false,
      `P53 must not add renamed cached-pass compositor owner/helper: ${sourcePath}`,
    );
    assert.equal(
      isForbiddenTransformedFrameCompositorOwnerPath(sourcePath),
      false,
      `P53 must not add renamed transformed-frame compositor owner/helper: ${sourcePath}`,
    );
  }

  assert.equal(
    normalizeLineEndings(distOwnerSource),
    normalizeLineEndings(ownerSource),
    "dist drawCanvas owner must mirror source owner",
  );
  assertIncludes(
    distRendererSource,
    "import { createDrawCanvasOrchestrationOwner } from \"./map_renderer/draw_canvas_orchestration_owner.js\";",
    "dist map_renderer must keep P2.1 owner import",
  );
  assert.equal(
    normalizeLineEndings(distTransformedFrameCompositorOwnerSource),
    normalizeLineEndings(transformedFrameCompositorOwnerSource),
    "dist transformed-frame compositor must mirror source owner",
  );
  assertIncludes(
    distRendererSource,
    "import { createTransformedFrameCompositorOwner } from \"./map_renderer/transformed_frame_compositor_owner.js\";",
    "dist map_renderer must keep P2.2b owner import",
  );
  assert.equal(
    normalizeLineEndings(distCachedPassCompositorOwnerSource),
    normalizeLineEndings(cachedPassCompositorOwnerSource),
    "dist cached-pass compositor must mirror source owner",
  );
  assertIncludes(
    distRendererSource,
    "import { createCachedPassCompositorOwner } from \"./renderer/cached_pass_compositor_owner.js\";",
    "dist map_renderer must keep P2.2a owner import",
  );
  assertIncludes(
    extractFunctionSource(distRendererSource, "drawCanvas"),
    "getDrawCanvasOrchestrationOwner().drawCanvasFrame();",
    "dist drawCanvas must keep thin wrapper",
  );

});
