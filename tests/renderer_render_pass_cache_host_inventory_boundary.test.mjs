import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const P50_DOC_PATH = "docs/active/renderer-render-pass-cache-host-preflight-20260701.md";
const P51_DOC_PATH = "docs/active/renderer-render-pass-cache-host-owner-p51-20260702.md";
const MAP_RENDERER_PATH = "js/core/map_renderer.js";
const RENDER_PASS_CACHE_HOST_OWNER_PATH = "js/core/map_renderer/render_pass_cache_host_owner.js";
const WRONG_RENDER_PASS_CACHE_HOST_OWNER_PATH = "js/core/renderer/render_pass_cache_host_owner.js";
const PUBLIC_FACADE_PATH = "js/core/map_renderer/public.js";
const STATE_WRITE_ALLOWLIST_PATH = "tools/eslint-rules/state-writer-allowlist.json";
const RENDER_CACHE_OWNER_PATH = "js/core/renderer/render_cache_owner.js";
const RENDER_PIPELINE_PASSES_PATH = "js/core/renderer/render_pipeline_passes.js";
const RENDER_PIPELINE_CATALOG_PATH = "js/core/renderer/render_pipeline_catalog.js";
const RENDER_INVALIDATION_CATALOG_PATH = "js/core/map_renderer/render_invalidation_catalog.js";
const RENDER_TRANSFORM_REUSE_POLICY_OWNER_PATH = "js/core/renderer/render_transform_reuse_policy_owner.js";
const RENDER_REQUEST_BOUNDARY_OWNER_PATH = "js/core/map_renderer/render_request_boundary_owner.js";
const RENDER_PHASE_LIFECYCLE_OWNER_PATH = "js/core/map_renderer/render_phase_lifecycle_owner.js";
const VISIBLE_FRAME_DIAGNOSTICS_OWNER_PATH = "js/core/renderer/visible_frame_diagnostics_owner.js";
const HIT_CANVAS_SCHEDULING_OWNER_PATH = "js/core/map_renderer/hit_canvas_scheduling_owner.js";
const SCENARIO_REFRESH_RUNTIME_PATH = "js/core/map_renderer/scenario_refresh_runtime.js";
const EXACT_AFTER_SETTLE_SCHEDULER_PATH = "js/core/map_renderer/exact_after_settle_scheduler.js";
const STRATEGIC_OVERLAY_RUNTIME_OWNER_PATH = "js/core/renderer/strategic_overlay_runtime_owner.js";
const STRATEGIC_OVERLAY_RENDER_OWNER_PATH = "js/core/renderer/strategic_overlay_render_owner.js";
const RENDER_LIFECYCLE_OWNER_PATH = "js/core/renderer/renderer_render_lifecycle_owner.js";
const MAP_RENDERER_LIFECYCLE_OWNER_PATH = "js/core/map_renderer/render_lifecycle_owner.js";

const P50_DOC_HEADINGS = Object.freeze([
  "## Scope and guardrails",
  "## Current P47 renderer lifecycle baseline",
  "## renderPassToCache current entry inventory",
  "## Pass canvas sizing and context acquisition inventory",
  "## Transform and reference-transform inventory",
  "## Dirty/signature/cache-state inventory",
  "## Draw callback contract inventory",
  "## Pass timings and render transaction diagnostics inventory",
  "## Render cache owner boundary",
  "## Render pipeline catalog boundary",
  "## Exact-after-settle and deferred pass boundary",
  "## P51 allowed first move",
  "## Forbidden areas",
  "## Required validation commands",
]);

const P50_DOC_TOKENS = Object.freeze([
  "P50 is preflight only.",
  "`renderPassToCache(` remains in `map_renderer.js`.",
  "`drawCanvas()` remains in `map_renderer.js`.",
  "No render pass drawing functions move.",
  "No public facade changes.",
  "No state-write allowlist changes.",
  "`render_cache_owner.js` remains authoritative",
  "`render_pipeline_passes.js` owns idle pass preparation and calls injected `renderPassToCache`.",
  "`render_pipeline_catalog.js` owns idle pass definitions/catalog.",
  "`render_invalidation_catalog.js` owns invalidation vocabulary.",
  "`render_transform_reuse_policy_owner.js` owns transform reuse policy.",
  "P51 may add a render pass cache host adapter owner.",
  "P51 must preserve the current `drawFn(k)` callback contract.",
  "P51 must delegate existing draw callback behavior and must keep render pass drawing functions in their current modules.",
  "no additional preflight is required before a narrow P51 host adapter owner",
]);

const RENDER_PASS_TO_CACHE_TOKENS = Object.freeze([
  "let passStart = 0;",
  "const hostResult = getRenderPassCacheHostOwner().prepareRenderPassHost({",
  "drawFn,",
  "onHostReady: () => {",
  "passStart = nowMs();",
  "if (hostResult?.skipped) return;",
  "getRenderPassCommitAccountingOwner().commitRenderPass({",
  "drawResult: hostResult.drawResult,",
  "hostSummary: hostResult,",
]);

const RENDER_PASS_TO_CACHE_DELEGATED_TOKENS = Object.freeze([
  "const passCanvas = ensureRenderPassCanvas(passName);",
  "const passContext = passCanvas.getContext(\"2d\");",
  "const layout = getRenderPassLayout(passName);",
  "withRenderTarget(passContext, () => {",
  "prepareTargetContext(passContext, transform, layout)",
  "drawResult = drawFn(k);",
  "const cache = getRenderPassCacheState();",
  "recordRenderPerfMetric(\"renderPassCommitSkipped\"",
  "setPassReferenceTransform(passName, transform);",
  "const identity = getVisibleFrameIdentity(transform);",
  "cache.politicalPassSceneGeneration =",
  "cache.signatures[passName] = getRenderPassSignature(passName, transform);",
  "cache.dirty[passName] = false;",
  "cache.partialPoliticalDirtyIds.clear();",
  "schedulePoliticalPathWarmup(transform);",
  "recordPassTiming(timings, passName, passStart);",
  "getPassCounterNames(passName).forEach((counterName) => incrementPerfCounter(counterName));",
  "cache.counters.contextScenarioReuseCount = 0;",
]);

const RENDER_PASS_CACHE_HOST_OWNER_TOKENS = Object.freeze([
  "export function createRenderPassCacheHostOwner({",
  "function prepareRenderPassHost({",
  "\"ensureRenderPassCanvas\"",
  "\"prepareTargetContext\"",
  "\"withRenderTarget\"",
  "\"getRenderPassLayout\"",
  "passCanvas.getContext(\"2d\")",
  "k = runEffect(trace, \"prepareTargetContext\", passContext, transform, layout);",
  "drawResult = drawFn(k);",
  "Object.freeze([...(trace?.effectOrder || [])])",
]);

const TRANSFORM_REUSE_FORBIDDEN_TOKENS = Object.freeze([
  "document",
  "window",
  "globalThis.d3",
  "projection",
  "zoomBehavior",
  "drawCanvas",
  "renderPassToCache",
  "buildHitCanvas",
  "runtimeState",
]);

function readRepoFile(...parts) {
  const absolutePath = path.join(REPO_ROOT, ...parts);
  assert.ok(fs.existsSync(absolutePath), `Expected repository file to exist: ${parts.join("/")}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function repoFileExists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function hasMapRendererImport(source) {
  return /from\s+["'][^"']*map_renderer\.js["']/.test(source)
    || /import\s+["'][^"']*map_renderer\.js["']\s*;?/.test(source)
    || /import\s*\(\s*["'][^"']*map_renderer\.js["']\s*\)/.test(source);
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected start marker to exist: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Expected end marker to exist after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function assertIncludes(source, token, message) {
  assert.ok(source.includes(token), `${message}: missing ${JSON.stringify(token)}`);
}

function assertExcludes(source, token, message) {
  assert.equal(source.includes(token), false, `${message}: unexpected ${JSON.stringify(token)}`);
}

test("P50 preflight doc exists and locks render pass host guardrails", () => {
  const docSource = readRepoFile(...P50_DOC_PATH.split("/"));

  for (const heading of P50_DOC_HEADINGS) {
    assertIncludes(docSource, heading, "P50 doc must keep required heading");
  }
  for (const token of P50_DOC_TOKENS) {
    assertIncludes(docSource, token, "P50 doc must lock render pass cache host boundary");
  }
});

test("P51 owner doc exists and records the narrow implementation boundary", () => {
  const docSource = readRepoFile(...P51_DOC_PATH.split("/"));

  for (const token of [
    "P51 render pass cache host owner",
    "`js/core/map_renderer/render_pass_cache_host_owner.js`",
    "`renderPassToCache` remains the stable wrapper",
    "Cache commit/accounting stays in `map_renderer.js`",
  ]) {
    assertIncludes(docSource, token, "P51 doc must lock owner boundary");
  }
});

test("map_renderer keeps renderPassToCache wrapper and drawCanvas anchors", () => {
  const rendererSource = readRepoFile(...MAP_RENDERER_PATH.split("/"));
  const renderPassToCacheSource = sliceBetween(
    rendererSource,
    "function renderPassToCache(",
    "function resetCanvasContext(",
  );

  assertIncludes(rendererSource, "function renderPassToCache(", "map_renderer must keep renderPassToCache anchor");
  assertIncludes(rendererSource, "function drawCanvas()", "map_renderer must keep drawCanvas anchor");

  for (const token of RENDER_PASS_TO_CACHE_TOKENS) {
    assertIncludes(renderPassToCacheSource, token, "renderPassToCache must keep P51/P52 wrapper delegation token");
  }
  for (const token of RENDER_PASS_TO_CACHE_DELEGATED_TOKENS) {
    assertExcludes(renderPassToCacheSource, token, "renderPassToCache must delegate extracted host or commit token");
  }
});

test("P51 host owner owns only pass cache host setup", () => {
  const ownerSource = readRepoFile(...RENDER_PASS_CACHE_HOST_OWNER_PATH.split("/"));

  assert.equal(repoFileExists(RENDER_PASS_CACHE_HOST_OWNER_PATH), true, "P51 owner must exist in map_renderer namespace");
  assert.equal(repoFileExists(WRONG_RENDER_PASS_CACHE_HOST_OWNER_PATH), false, "P51 owner must not live in renderer namespace");
  for (const token of RENDER_PASS_CACHE_HOST_OWNER_TOKENS) {
    assertIncludes(ownerSource, token, "P51 owner must keep host setup token");
  }
  for (const token of [
    "setPassReferenceTransform",
    "cache.signatures",
    "cache.dirty",
    "recordPassTiming",
    "recordRenderPerfMetric",
    "schedulePoliticalPathWarmup",
    "drawCanvas",
    "buildHitCanvas",
    "hgoPreview",
    "normalizeTransformScale",
  ]) {
    assertExcludes(ownerSource, token, "P51 owner must avoid cache commit or broad lifecycle token");
  }
});

test("render cache and pipeline owners keep current narrow boundaries", () => {
  const renderCacheOwnerSource = readRepoFile(...RENDER_CACHE_OWNER_PATH.split("/"));
  const renderPipelinePassesSource = readRepoFile(...RENDER_PIPELINE_PASSES_PATH.split("/"));
  const renderPipelineCatalogSource = readRepoFile(...RENDER_PIPELINE_CATALOG_PATH.split("/"));
  const renderInvalidationCatalogSource = readRepoFile(...RENDER_INVALIDATION_CATALOG_PATH.split("/"));

  assertIncludes(renderCacheOwnerSource, "export function createRenderCacheOwner", "render cache owner must keep factory");
  assertIncludes(renderCacheOwnerSource, "function ensureRenderPassCanvas(passName)", "render cache owner must keep pass canvas owner function");
  assertIncludes(renderCacheOwnerSource, "function getRenderPassLayout(passName)", "render cache owner must keep pass layout owner function");
  assertIncludes(renderCacheOwnerSource, "setPassReferenceTransform(passName, transform)", "render cache owner must keep reference transform helper");
  assertIncludes(renderCacheOwnerSource, "setPassFullReferenceTransform(passName, transform)", "render cache owner must keep full reference transform helper");
  assertIncludes(renderCacheOwnerSource, "function clearPassFullReferenceTransforms(passNames = null)", "render cache owner must keep full transform clear helper");
  assert.equal(hasMapRendererImport(renderCacheOwnerSource), false, "render cache owner must not import map_renderer");

  assertIncludes(renderPipelinePassesSource, "export function createRenderPipelinePassesOwner", "render pipeline passes owner must keep factory");
  assertIncludes(renderPipelinePassesSource, "renderPassToCache(passName, drawFn, transform, timings);", "render pipeline passes owner must keep injected renderPassToCache call");
  assert.equal(hasMapRendererImport(renderPipelinePassesSource), false, "render pipeline passes owner must not import map_renderer");

  assertIncludes(renderPipelineCatalogSource, "export const IDLE_RENDER_PASS_DEFINITIONS", "render pipeline catalog must keep idle definitions");
  assertIncludes(renderInvalidationCatalogSource, "export const PASS_RESOURCE_MAP", "render invalidation catalog must keep pass resource map");
});

test("transform reuse policy owner avoids render pass host dependencies", () => {
  const transformReuseOwnerSource = readRepoFile(...RENDER_TRANSFORM_REUSE_POLICY_OWNER_PATH.split("/"));

  for (const token of TRANSFORM_REUSE_FORBIDDEN_TOKENS) {
    assertExcludes(transformReuseOwnerSource, token, "transform reuse policy owner must avoid render pass host token");
  }
});

test("P41 P42 P43 and P47 owners stay out of render pass host lifecycle", () => {
  for (const relativePath of [
    RENDER_REQUEST_BOUNDARY_OWNER_PATH,
    RENDER_PHASE_LIFECYCLE_OWNER_PATH,
    VISIBLE_FRAME_DIAGNOSTICS_OWNER_PATH,
    HIT_CANVAS_SCHEDULING_OWNER_PATH,
  ]) {
    const source = readRepoFile(...relativePath.split("/"));
    assertExcludes(source, "renderPassToCache", `${relativePath} must not own renderPassToCache`);
    assertExcludes(source, "drawCanvas", `${relativePath} must not own drawCanvas`);
  }
});

test("broad render lifecycle owner remains absent", () => {
  for (const relativePath of [
    RENDER_LIFECYCLE_OWNER_PATH,
    MAP_RENDERER_LIFECYCLE_OWNER_PATH,
    "js/core/renderer/render_lifecycle_owner.js",
    "js/core/renderer/render_lifecycle_helper.js",
    "js/core/renderer/render_lifecycle_controller.js",
    "js/core/map_renderer/render_lifecycle_helper.js",
    "js/core/map_renderer/render_lifecycle_controller.js",
  ]) {
    assert.equal(repoFileExists(relativePath), false, `P50 must keep broad render lifecycle owner/helper absent: ${relativePath}`);
  }
});

test("scenario exact and strategic owners stay independent of P50 host adapter", () => {
  for (const relativePath of [
    SCENARIO_REFRESH_RUNTIME_PATH,
    EXACT_AFTER_SETTLE_SCHEDULER_PATH,
    STRATEGIC_OVERLAY_RUNTIME_OWNER_PATH,
    STRATEGIC_OVERLAY_RENDER_OWNER_PATH,
  ]) {
    const source = readRepoFile(...relativePath.split("/"));
    assertExcludes(source, "render_pass_cache_host", `${relativePath} must not import a P50 render pass cache host`);
    assertExcludes(source, "renderPassCacheHost", `${relativePath} must not import a P50 render pass cache host`);
  }
});

test("public facade state-write allowlist and package script remain locked", () => {
  const publicFacadeSource = readRepoFile(...PUBLIC_FACADE_PATH.split("/"));
  const stateWriteAllowlistSource = readRepoFile(...STATE_WRITE_ALLOWLIST_PATH.split("/"));
  const packageJsonSource = readRepoFile("package.json");

  for (const token of [
    "render,",
    "setMapData,",
    "initMap,",
    "RENDER_PASS_NAMES,",
    "from \"../map_renderer.js\";",
  ]) {
    assertIncludes(publicFacadeSource, token, "public facade must keep render exports");
  }
  for (const token of [
    "render_pass_cache_host",
    "renderer_render_pass_cache_host",
    "renderPassCacheHost",
  ]) {
    assertExcludes(publicFacadeSource, token, "public facade must not expose P50 host adapter");
    assertExcludes(stateWriteAllowlistSource, token, "state-write allowlist must not include P50 host adapter");
  }
  assertIncludes(
    packageJsonSource,
    "\"test:node:renderer-render-pass-cache-host-inventory\": \"node --test tests/renderer_render_pass_cache_host_inventory_boundary.test.mjs\"",
    "package.json must expose the P50 render pass cache host inventory test",
  );
});
