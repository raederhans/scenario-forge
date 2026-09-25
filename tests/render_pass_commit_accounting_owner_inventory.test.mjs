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


const DOC_PATH = "docs/active/renderer-render-pass-commit-accounting-owner-p52-20260702.md";
const MAP_RENDERER_PATH = "js/core/map_renderer.js";
const HOST_OWNER_PATH = "js/core/map_renderer/render_pass_cache_host_owner.js";
const COMMIT_OWNER_PATH = "js/core/map_renderer/render_pass_commit_accounting_owner.js";
const DIST_MAP_RENDERER_PATH = pagesDistPath("app/js/core/map_renderer.js");
const DIST_HOST_OWNER_PATH = pagesDistPath("app/js/core/map_renderer/render_pass_cache_host_owner.js");
const DIST_COMMIT_OWNER_PATH = pagesDistPath("app/js/core/map_renderer/render_pass_commit_accounting_owner.js");
const DIST_PUBLIC_FACADE_PATH = pagesDistPath("app/js/core/map_renderer/public.js");
const WRONG_COMMIT_OWNER_PATH = "js/core/renderer/render_pass_commit_accounting_owner.js";
const RENDER_PIPELINE_PASSES_PATH = "js/core/renderer/render_pipeline_passes.js";
const RENDER_PIPELINE_CATALOG_PATH = "js/core/renderer/render_pipeline_catalog.js";
const RENDER_PASS_CATALOG_PATH = "js/core/map_renderer/render_pass_catalog.js";
const PUBLIC_FACADE_PATH = "js/core/map_renderer/public.js";
const STATE_WRITE_ALLOWLIST_PATH = "tools/eslint-rules/state-writer-allowlist.json";
const HIT_CANVAS_SCHEDULING_OWNER_PATH = "js/core/map_renderer/hit_canvas_scheduling_owner.js";
const SCENARIO_REFRESH_RUNTIME_PATH = "js/core/map_renderer/scenario_refresh_runtime.js";
const EXACT_AFTER_SETTLE_SCHEDULER_PATH = "js/core/map_renderer/exact_after_settle_scheduler.js";
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

test("P52 doc scripts and owner files exist", () => {
  const docSource = readRepoFile(DOC_PATH);
  const packageJsonSource = readRepoFile("package.json");

  for (const token of [
    "## Scope",
    "## Current P51 baseline",
    "## Commit/accounting owner boundary",
    "## Validation",
    "P52 render pass commit/accounting owner",
    "`js/core/map_renderer/render_pass_commit_accounting_owner.js`",
  ]) {
    assertIncludes(docSource, token, "P52 doc must lock implementation boundary");
  }
  for (const token of [
    "\"test:node:render-pass-commit-accounting-owner\": \"node --test tests/render_pass_commit_accounting_owner_behavior.test.mjs\"",
    "\"test:node:render-pass-commit-accounting-inventory\": \"node --test tests/render_pass_commit_accounting_owner_inventory.test.mjs\"",
  ]) {
    assertIncludes(packageJsonSource, token, "package.json must expose P52 named scripts");
  }
  assert.equal(repoFileExists(COMMIT_OWNER_PATH), true, "P52 owner must exist in js/core/map_renderer");
  assert.equal(repoFileExists(WRONG_COMMIT_OWNER_PATH), false, "P52 owner must not live under js/core/renderer");
});

test("map_renderer keeps drawCanvas and renderPassToCache wrapper while delegating commit accounting", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const renderPassToCacheSource = sliceBetween(
    rendererSource,
    "function renderPassToCache(",
    "function resetCanvasContext(",
  );
  const p52OwnerFactorySource = sliceBetween(
    rendererSource,
    "function getRenderPassCommitAccountingOwner()",
    "function getRenderPipelinePassesOwner()",
  );
  const createIndex = p52OwnerFactorySource.indexOf(
    "renderPassCommitAccountingOwner = createRenderPassCommitAccountingOwner({",
  );

  assertIncludes(rendererSource, "function drawCanvas()", "map_renderer must keep drawCanvas");
  assertIncludes(rendererSource, "function renderPassToCache(", "map_renderer must keep renderPassToCache wrapper");
  assertIncludes(
    rendererSource,
    "import { createRenderPassCacheHostOwner } from \"./map_renderer/render_pass_cache_host_owner.js\";",
    "map_renderer must keep P51 owner import",
  );
  assertIncludes(
    rendererSource,
    "import { createRenderPassCommitAccountingOwner } from \"./map_renderer/render_pass_commit_accounting_owner.js\";",
    "map_renderer must import P52 owner from map_renderer namespace",
  );
  assert.notEqual(createIndex, -1, "P52 owner construction must keep its existing constructor call");

  for (const token of [
    "let passStart = 0;",
    "const hostResult = getRenderPassCacheHostOwner().prepareRenderPassHost({",
    "drawFn,",
    "passStart = nowMs();",
    "if (hostResult?.skipped) return;",
    "getRenderPassCommitAccountingOwner().commitRenderPass({",
    "drawResult: hostResult.drawResult,",
    "hostSummary: hostResult,",
  ]) {
    assertIncludes(renderPassToCacheSource, token, "renderPassToCache must keep wrapper/delegation token");
  }

  for (const token of [
    "const cache = getRenderPassCacheState();",
    "const drawResult = hostResult.drawResult;",
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
  ]) {
    assertExcludes(renderPassToCacheSource, token, "renderPassToCache must delegate P52 commit/accounting token");
  }
});

test("P52 owner owns commit accounting and excludes host setup and draw orchestration", () => {
  const ownerSource = readRepoFile(COMMIT_OWNER_PATH);

  for (const token of [
    "export function createRenderPassCommitAccountingOwner({",
    "function commitRenderPass({",
    "\"getRenderPassCacheState\"",
    "\"getVisibleFrameIdentity\"",
    "\"getRenderPassSignature\"",
    "\"getPassCounterNames\"",
    "\"nowMs\"",
    "\"recordRenderPerfMetric\"",
    "\"setPassReferenceTransform\"",
    "\"setPassFullReferenceTransform\"",
    "\"clearPassFullReferenceTransforms\"",
    "cache.politicalPassSceneGeneration =",
    "cache.signatures[normalizedPassName] =",
    "cache.dirty[normalizedPassName] = false;",
    "cache.partialPoliticalDirtyIds.clear();",
    "cache.counters.contextScenarioReuseCount = 0;",
    "renderPassCommitSkipped",
    "return Object.freeze({",
  ]) {
    assertIncludes(ownerSource, token, "P52 owner must keep commit/accounting token");
  }

  for (const token of [
    "prepareRenderPassHost",
    "ensureRenderPassCanvas",
    "passCanvas.getContext(\"2d\")",
    "getRenderPassLayout",
    "prepareTargetContext",
    "withRenderTarget",
    "drawCanvas",
    "drawPoliticalPass",
    "drawContextBasePass",
    "drawContextScenarioPass",
    "buildHitCanvas",
    "scenario_refresh",
    "exact_after_settle",
    "strategic_overlay",
    "runtimeState",
    "document",
    "window",
    "globalThis.d3",
  ]) {
    assertExcludes(ownerSource, token, "P52 owner must avoid host setup or adjacent renderer token");
  }
});

test("P51 host owner remains bounded and pipeline catalogs remain authoritative", () => {
  const hostOwnerSource = readRepoFile(HOST_OWNER_PATH);
  const renderPipelinePassesSource = readRepoFile(RENDER_PIPELINE_PASSES_PATH);
  const renderPipelineCatalogSource = readRepoFile(RENDER_PIPELINE_CATALOG_PATH);
  const renderPassCatalogSource = readRepoFile(RENDER_PASS_CATALOG_PATH);

  for (const token of [
    "export function createRenderPassCacheHostOwner({",
    "function prepareRenderPassHost({",
    "passCanvas.getContext(\"2d\")",
    "drawResult = drawFn(k);",
  ]) {
    assertIncludes(hostOwnerSource, token, "P51 host owner must keep host token");
  }
  for (const token of [
    "createRenderPassCommitAccountingOwner",
    "commitRenderPass",
    "cache.signatures",
    "cache.dirty",
    "recordRenderPerfMetric",
    "recordPassTiming",
    "schedulePoliticalPathWarmup",
  ]) {
    assertExcludes(hostOwnerSource, token, "P51 host owner must not own P52 commit/accounting token");
  }

  assertIncludes(
    renderPipelinePassesSource,
    "renderPassToCache(passName, drawFn, transform, timings);",
    "render pipeline passes owner must keep injected renderPassToCache call",
  );
  assertIncludes(renderPipelineCatalogSource, "export const IDLE_RENDER_PASS_DEFINITIONS = [", "render pipeline catalog must own idle pass definitions");
  assertIncludes(renderPassCatalogSource, "export const RENDER_PASS_NAMES = [", "render pass catalog must own pass names");
});

test("adjacent boundaries facade allowlist and dist preserve owner boundaries", () => {
  const publicFacadeSource = readRepoFile(PUBLIC_FACADE_PATH);
  const stateWriteAllowlistSource = readRepoFile(STATE_WRITE_ALLOWLIST_PATH);

  for (const relativePath of [
    HIT_CANVAS_SCHEDULING_OWNER_PATH,
    SCENARIO_REFRESH_RUNTIME_PATH,
    EXACT_AFTER_SETTLE_SCHEDULER_PATH,
    STRATEGIC_OVERLAY_RUNTIME_OWNER_PATH,
    STRATEGIC_OVERLAY_RENDER_OWNER_PATH,
  ]) {
    const source = readRepoFile(relativePath);
    assertExcludes(source, "render_pass_commit_accounting", `${relativePath} must not import P52 owner`);
    assertExcludes(source, "renderPassCommitAccounting", `${relativePath} must not reference P52 owner`);
  }

  for (const relativePath of [
    "js/core/renderer/renderer_render_lifecycle_owner.js",
    "js/core/map_renderer/render_lifecycle_owner.js",
    "js/core/renderer/render_lifecycle_owner.js",
    "js/core/renderer/render_lifecycle_helper.js",
    "js/core/renderer/render_lifecycle_controller.js",
    "js/core/map_renderer/render_lifecycle_helper.js",
    "js/core/map_renderer/render_lifecycle_controller.js",
  ]) {
    assert.equal(repoFileExists(relativePath), false, `broad render lifecycle file must remain absent: ${relativePath}`);
  }

  for (const token of [
    "render_pass_commit_accounting",
    "renderer_render_pass_commit_accounting",
    "renderPassCommitAccounting",
  ]) {
    assertExcludes(publicFacadeSource, token, "public facade must not expose P52 owner");
    assertExcludes(stateWriteAllowlistSource, token, "state-write allowlist must not include P52 owner");
  }

  // Generated dist changes during integration; verify the boundary itself,
  // independent of whether the current checkout has uncommitted output.
  for (const [mirror, source] of [
    [DIST_HOST_OWNER_PATH, HOST_OWNER_PATH],
    [DIST_COMMIT_OWNER_PATH, COMMIT_OWNER_PATH],
    [DIST_PUBLIC_FACADE_PATH, PUBLIC_FACADE_PATH],
  ]) {
    assert.equal(readRepoFile(mirror).replaceAll("\r\n", "\n"), readRepoFile(source).replaceAll("\r\n", "\n"), `${mirror} must mirror its source boundary`);
  }
  assertIncludes(readRepoFile(DIST_MAP_RENDERER_PATH), "getRenderPassCommitAccountingOwner().commitRenderPass({", "dist renderer must retain private owner delegation");
});
