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
const OWNER_PATH = "js/core/map_renderer/render_pass_cache_host_owner.js";
const DIST_MAP_RENDERER_PATH = pagesDistPath("app/js/core/map_renderer.js");
const DIST_OWNER_PATH = pagesDistPath("app/js/core/map_renderer/render_pass_cache_host_owner.js");
const DIST_PUBLIC_FACADE_PATH = pagesDistPath("app/js/core/map_renderer/public.js");
const WRONG_OWNER_PATH = "js/core/renderer/render_pass_cache_host_owner.js";
const PUBLIC_FACADE_PATH = "js/core/map_renderer/public.js";
const STATE_WRITE_ALLOWLIST_PATH = "tools/eslint-rules/state-writer-allowlist.json";
const RENDER_CACHE_OWNER_PATH = "js/core/renderer/render_cache_owner.js";
const RENDER_PIPELINE_PASSES_PATH = "js/core/renderer/render_pipeline_passes.js";
const RENDER_PIPELINE_CATALOG_PATH = "js/core/renderer/render_pipeline_catalog.js";
const RENDER_TRANSFORM_REUSE_POLICY_OWNER_PATH = "js/core/renderer/render_transform_reuse_policy_owner.js";
const HIT_CANVAS_SCHEDULING_OWNER_PATH = "js/core/map_renderer/hit_canvas_scheduling_owner.js";
const MAP_HOVER_INTERACTION_OWNER_PATH = "js/core/map_renderer/map_hover_interaction_owner.js";
const RENDERER_TRANSACTION_RESET_OWNER_PATH = "js/core/map_renderer/renderer_transaction_reset_owner.js";

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

function hasMapRendererImport(source) {
  return /from\s+["'][^"']*map_renderer\.js["']/.test(source)
    || /import\s+["'][^"']*map_renderer\.js["']\s*;?/.test(source)
    || /import\s*\(\s*["'][^"']*map_renderer\.js["']\s*\)/.test(source);
}

test("P51 host owner exists only in map_renderer owner namespace", () => {
  assert.equal(repoFileExists(OWNER_PATH), true, "P51 owner must exist in js/core/map_renderer");
  assert.equal(repoFileExists(WRONG_OWNER_PATH), false, "P51 owner must not live under js/core/renderer");
});

test("map_renderer keeps stable wrapper and delegates commit accounting", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const renderPassToCacheSource = sliceBetween(
    rendererSource,
    "function renderPassToCache(passName, drawFn, transform, timings)",
    "function resetCanvasContext(",
  );
  const p51OwnerFactorySource = sliceBetween(
    rendererSource,
    "function getRenderPassCacheHostOwner()",
    "function getRenderPassCommitAccountingOwner()",
  );
  const createIndex = p51OwnerFactorySource.indexOf("renderPassCacheHostOwner = createRenderPassCacheHostOwner({");

  assertIncludes(rendererSource, "function drawCanvas()", "map_renderer must keep drawCanvas");
  assertIncludes(
    rendererSource,
    "import { createRenderPassCacheHostOwner } from \"./map_renderer/render_pass_cache_host_owner.js\";",
    "map_renderer must import the P51 owner from the map_renderer namespace",
  );
  assert.notEqual(createIndex, -1, "P51 owner construction must keep its existing constructor call");

  for (const token of [
    "const hostResult = getRenderPassCacheHostOwner().prepareRenderPassHost({",
    "drawFn,",
    "onHostReady: () => {",
    "passStart = nowMs();",
    "if (hostResult?.skipped) return;",
    "getRenderPassCommitAccountingOwner().commitRenderPass({",
    "drawResult: hostResult.drawResult,",
    "hostSummary: hostResult,",
  ]) {
    assertIncludes(renderPassToCacheSource, token, "renderPassToCache must keep wrapper/delegation token");
  }

  for (const token of [
    "const passCanvas = ensureRenderPassCanvas(passName);",
    "const passContext = passCanvas.getContext(\"2d\");",
    "const layout = getRenderPassLayout(passName);",
    "withRenderTarget(passContext, () => {",
    "prepareTargetContext(passContext, transform, layout)",
    "drawResult = drawFn(k);",
    "const cache = getRenderPassCacheState();",
    "recordRenderPerfMetric(\"renderPassCommitSkipped\"",
    "setPassReferenceTransform(passName, transform);",
    "cache.signatures[passName] = getRenderPassSignature(passName, transform);",
    "cache.dirty[passName] = false;",
    "recordPassTiming(timings, passName, passStart);",
    "getPassCounterNames(passName).forEach((counterName) => incrementPerfCounter(counterName));",
  ]) {
    assertExcludes(renderPassToCacheSource, token, "renderPassToCache must delegate extracted token");
  }
});

test("P51 owner contains host setup and excludes cache commit ownership", () => {
  const ownerSource = readRepoFile(OWNER_PATH);

  for (const token of [
    "export function createRenderPassCacheHostOwner({",
    "function prepareRenderPassHost({",
    "\"ensureRenderPassCanvas\"",
    "\"prepareTargetContext\"",
    "\"withRenderTarget\"",
    "\"getRenderPassLayout\"",
    "passCanvas.getContext(\"2d\")",
    "Math.max(0.0001, Number(transform?.k || 1))",
    "drawResult = drawFn(k);",
    "return Object.freeze({",
    "prepareRenderPassHost,",
  ]) {
    assertIncludes(ownerSource, token, "P51 owner must keep host setup token");
  }

  for (const token of [
    "setPassReferenceTransform",
    "setPassFullReferenceTransform",
    "clearPassFullReferenceTransforms",
    "cache.signatures",
    "cache.dirty",
    "cache.partialPoliticalDirtyIds",
    "schedulePoliticalPathWarmup",
    "recordPassTiming",
    "recordRenderPerfMetric",
    "getPassCounterNames",
    "incrementPerfCounter",
  ]) {
    assertExcludes(ownerSource, token, "P51 owner must avoid cache commit/accounting token");
  }
});

test("render pass drawing functions and pipeline injection remain in place", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const renderPipelinePassesSource = readRepoFile(RENDER_PIPELINE_PASSES_PATH);
  const renderPipelineCatalogSource = readRepoFile(RENDER_PIPELINE_CATALOG_PATH);

  for (const drawKey of [
    "drawBackgroundPass",
    "drawPhysicalBasePass",
    "drawPoliticalPass",
    "drawHgoPreviewPass",
    "drawContextBasePass",
    "drawContextScenarioPass",
    "drawEffectsPass",
    "drawLineEffectsPass",
    "drawDayNightPass",
    "drawBordersPass",
    "drawContextMarkersPass",
    "drawTextureLabelEffectsPass",
    "drawLabelsPass",
  ]) {
    assertIncludes(renderPipelineCatalogSource, `drawKey: "${drawKey}"`, "render pipeline catalog must keep draw key");
    assertIncludes(rendererSource, `function ${drawKey}`, "map_renderer must keep render pass drawing function");
  }

  assertIncludes(
    renderPipelinePassesSource,
    "renderPassToCache(passName, drawFn, transform, timings);",
    "render pipeline passes owner must keep injected renderPassToCache call",
  );
});

test("existing renderer owners stay out of the render pass cache host boundary", () => {
  const renderCacheOwnerSource = readRepoFile(RENDER_CACHE_OWNER_PATH);
  assertIncludes(renderCacheOwnerSource, "function ensureRenderPassCanvas(passName)", "render cache owner keeps canvas owner");
  assertIncludes(renderCacheOwnerSource, "function getRenderPassLayout(passName)", "render cache owner keeps layout owner");
  assert.equal(hasMapRendererImport(renderCacheOwnerSource), false, "render cache owner must not import map_renderer");

  for (const relativePath of [
    RENDER_TRANSFORM_REUSE_POLICY_OWNER_PATH,
    HIT_CANVAS_SCHEDULING_OWNER_PATH,
    MAP_HOVER_INTERACTION_OWNER_PATH,
    RENDERER_TRANSACTION_RESET_OWNER_PATH,
  ]) {
    const source = readRepoFile(relativePath);
    assertExcludes(source, "renderPassToCache", `${relativePath} must not own renderPassToCache`);
    assertExcludes(source, "drawCanvas", `${relativePath} must not own drawCanvas`);
    assertExcludes(source, "render_pass_cache_host", `${relativePath} must not import the P51 host owner`);
    assertExcludes(source, "renderPassCacheHost", `${relativePath} must not reference P51 host owner state`);
  }
});

test("broad lifecycle owners facade allowlist and dist preserve owner boundaries", () => {
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

  const publicFacadeSource = readRepoFile(PUBLIC_FACADE_PATH);
  const stateWriteAllowlistSource = readRepoFile(STATE_WRITE_ALLOWLIST_PATH);
  for (const token of [
    "render_pass_cache_host",
    "renderer_render_pass_cache_host",
    "renderPassCacheHost",
  ]) {
    assertExcludes(publicFacadeSource, token, "public facade must not expose P51 host owner");
    assertExcludes(stateWriteAllowlistSource, token, "state-write allowlist must not include P51 host owner");
  }

  // Generated dist changes during integration; verify the boundary itself,
  // independent of whether the current checkout has uncommitted output.
  for (const [mirror, source] of [
    [DIST_OWNER_PATH, OWNER_PATH],
    [DIST_PUBLIC_FACADE_PATH, PUBLIC_FACADE_PATH],
  ]) {
    assert.equal(readRepoFile(mirror).replaceAll("\r\n", "\n"), readRepoFile(source).replaceAll("\r\n", "\n"), `${mirror} must mirror its source boundary`);
  }
  assertIncludes(readRepoFile(DIST_MAP_RENDERER_PATH), "getRenderPassCacheHostOwner().prepareRenderPassHost({", "dist renderer must retain private owner delegation");
});
