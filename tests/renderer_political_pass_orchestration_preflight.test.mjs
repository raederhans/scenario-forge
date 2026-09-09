import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  RENDER_PASS_FAMILY_INVENTORY,
} from "../tools/renderer_pass_family_inventory.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const MAP_RENDERER_PATH = "js/core/map_renderer.js";
const PREFLIGHT_DOC_PATH = "docs/active/renderer-political-pass-preflight-p3-3a-20260714.md";
const CANONICAL_OWNER_PATH = "js/core/renderer/political_pass_orchestrator_owner.js";
const PARTIAL_OWNER_PATH = "js/core/renderer/political_partial_repaint_owner.js";
const PUBLIC_FACADE_PATH = "js/core/map_renderer/public.js";
const STATE_WRITE_ALLOWLIST_PATH = "tools/eslint-rules/state-writer-allowlist.json";

const PREFLIGHT_HEADINGS = Object.freeze([
  "## Scope and invariants",
  "## Current drawPoliticalPass orchestration",
  "## Worker identity and bitmap path",
  "## Background and missing-land path",
  "## Progressive recovery and color-edit guard",
  "## Fine loop and state-effect ownership",
  "## P3.3b canonical owner contract",
  "## Protected boundaries",
  "## Verification lanes",
  "## Stop rules",
]);

function readRepoFile(relativePath) {
  const absolutePath = path.join(REPO_ROOT, ...relativePath.split("/"));
  assert.ok(fs.existsSync(absolutePath), `Expected repository file to exist: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
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

function maskStringAndCommentContent(source) {
  let result = "";
  let mode = "code";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (mode === "line-comment") {
      if (character === "\n") {
        mode = "code";
        result += "\n";
      } else {
        result += " ";
      }
      continue;
    }
    if (mode === "block-comment") {
      if (character === "*" && nextCharacter === "/") {
        result += "  ";
        index += 1;
        mode = "code";
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (mode === "string") {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) {
        mode = "code";
        quote = "";
      }
      result += character === "\n" ? "\n" : " ";
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      result += "  ";
      index += 1;
      mode = "line-comment";
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      result += "  ";
      index += 1;
      mode = "block-comment";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      result += " ";
      mode = "string";
      quote = character;
      continue;
    }
    result += character;
  }
  return result;
}

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Expected function to exist: ${functionName}`);
  const maskedSource = maskStringAndCommentContent(source);
  const openParen = start + marker.length - 1;
  let parameterDepth = 0;
  let closeParen = -1;
  for (let index = openParen; index < source.length; index += 1) {
    if (maskedSource[index] === "(") parameterDepth += 1;
    if (maskedSource[index] === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        closeParen = index;
        break;
      }
    }
  }
  assert.notEqual(closeParen, -1, `Expected function parameters to close: ${functionName}`);
  const openBrace = source.indexOf("{", closeParen + 1);
  assert.notEqual(openBrace, -1, `Expected function body to start: ${functionName}`);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (maskedSource[index] === "{") depth += 1;
    if (maskedSource[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Expected function body to close: ${functionName}`);
}

function assertOrderedTokens(source, tokens, label) {
  let cursor = -1;
  for (const token of tokens) {
    const next = source.indexOf(token, cursor + 1);
    assert.notEqual(next, -1, `${label}: missing or out-of-order token ${JSON.stringify(token)}`);
    cursor = next;
  }
}

function isPoliticalPassOwnerCandidate(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  const stem = path.basename(normalized).replace(/\.m?js$/, "").toLowerCase();
  const compact = stem.replace(/[_-]/g, "");
  return compact.includes("political")
    && compact.includes("pass")
    && ["owner", "orchestrator", "controller", "helper", "adapter"].some((token) => compact.includes(token));
}

test("P3.3a document locks the political-pass preflight and P3.3b seam", () => {
  const docSource = readRepoFile(PREFLIGHT_DOC_PATH);
  for (const heading of PREFLIGHT_HEADINGS) {
    assert.ok(docSource.includes(heading), `preflight doc should keep heading ${heading}`);
  }
  for (const token of [
    "P3.3a is preflight only.",
    "Production runtime diff is zero.",
    "The canonical P3.3b owner path is `js/core/renderer/political_pass_orchestrator_owner.js`.",
    "`drawPoliticalPass(k)` remains in `js/core/map_renderer.js` during P3.3a.",
    "Worker identity, packet construction, bitmap commit, and accepted-result repaint remain composition-root effects.",
    "The fine feature loop remains in `map_renderer.js`.",
    "The owner receives explicit getters, helpers, resolvers, and effects; it never receives runtime state, RendererRuntimeContext, DOM, D3, canvas contexts, or an unbounded dependency bag.",
    "P3.3b atomically upgrades this preflight contract from owner-absent to one canonical owner plus one thin wrapper.",
    "`test:e2e:dev:political-progressive-recovery`",
    "`npm run perf:gate`",
    "Stop when extraction requires moving the fine feature loop, worker packet builder, partial repaint, state writes, pass order, public facade, or RendererRuntimeContext.",
  ]) {
    assert.ok(docSource.includes(token), `preflight doc should keep boundary token ${JSON.stringify(token)}`);
  }
});

test("implemented political owner keeps the frozen top-level orchestration order", () => {
  const ownerSource = readRepoFile(CANONICAL_OWNER_PATH);
  const drawSource = extractFunctionSource(ownerSource, "drawPoliticalPass");
  assertOrderedTokens(drawSource, [
    "if (isHgoRuntimePreviewReady())",
    'recordRenderPerfMetric("drawPoliticalPass", 0, {',
    "const identity = resolvePoliticalPassIdentity(k);",
    "recordPoliticalRasterWorkerSnapshot();",
    "const viewport = resolvePoliticalPassViewport(identity);",
    "if (viewport.visibleStats)",
    'recordRenderPerfMetric("politicalPassVisibleItems", 0, {',
    "if (isRenderDiagnosticsEnabled())",
    "publishPoliticalPassDiagnostics({ identity, viewport });",
    "const consumedBitmapResult = consumePoliticalRasterWorkerBitmapResult(identity.workerIdentity);",
    "drawPoliticalWorkerBitmapResult(consumedBitmapResult, identity.workerIdentity)",
    "recordPoliticalRasterWorkerSnapshot();",
    'reason: "political-raster-worker-bitmap"',
    "const backgroundStartedAt = nowMs();",
    "const backgroundSummary = drawPoliticalBackgroundFills({ identity, viewport });",
    '"drawPoliticalBackgroundFillsPass"',
    "if (!hasPoliticalLandFeatures())",
    'reason: "missing-land-data"',
    "const packetState = isPoliticalRasterWorkerBitmapEnabled()",
    "buildPoliticalRasterWorkerPacketEffect({ identity, viewport })",
    "requestPoliticalRasterWorkerPassEffect({ identity, viewport, packetState });",
    "recordPoliticalRasterWorkerSnapshot();",
    "const pendingPoliticalColorEdit = hasPendingPoliticalColorEdit();",
    "const progressiveRecoveryCoarseSkipCandidate = (",
    "const visiblePoliticalForegroundColorOverride = progressiveRecoveryCoarseSkipCandidate",
    "if (progressiveRecoveryCoarseSkipCandidate && !visiblePoliticalForegroundColorOverride)",
    'reason: "progressive-coarse-underlay"',
    "const featureMetrics = drawPoliticalFineFeatureLoop({ k, identity, viewport });",
    'recordRenderPerfMetric("drawPoliticalFeatureFillLoop"',
    'recordRenderPerfMetric("drawPoliticalFeatureStrokeLoop"',
    "clearPendingPoliticalColorEdit({",
    'reason: "fine-feature-loop"',
  ], "political owner order");
});

test("worker identity, packet, bitmap, and partial algorithms live in the partial owner with root effects", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const ownerSource = extractFunctionSource(readRepoFile(CANONICAL_OWNER_PATH), "drawPoliticalPass");
  const partialOwnerSource = readRepoFile(PARTIAL_OWNER_PATH);
  const identitySource = extractFunctionSource(partialOwnerSource, "resolvePoliticalPassIdentity");
  const viewportSource = extractFunctionSource(partialOwnerSource, "resolvePoliticalPassViewport");
  const packetSource = extractFunctionSource(partialOwnerSource, "buildPoliticalPassWorkerPacket");
  const requestSource = extractFunctionSource(partialOwnerSource, "requestPoliticalPassWorker");
  assert.match(
    viewportSource,
    /const screenRects = \[\{[\s\S]*?minX: -politicalOverscanPx,[\s\S]*?minY: -politicalOverscanPx,[\s\S]*?maxX: identity\.canvasWidth \+ politicalOverscanPx,[\s\S]*?maxY: identity\.canvasHeight \+ politicalOverscanPx,[\s\S]*?\}\];/,
  );
  assert.match(
    identitySource,
    /helper\.createPoliticalRasterWorkerIdentity\(\{[\s\S]*?sceneGeneration: sceneIdentity\.sceneGeneration,[\s\S]*?scenarioDataGeneration: sceneIdentity\.scenarioDataGeneration,[\s\S]*?selectionVersion: sceneIdentity\.selectionVersion \|\| Number\(loadState\?\.selectionVersion \|\| 0\),[\s\S]*?passSignature: helper\.getRenderPassSignature\("political", transform\),/,
  );
  assert.match(
    packetSource,
    /buildPoliticalRasterWorkerPacket\(\{[\s\S]*?visibleItems: viewport\.visibleItems,[\s\S]*?transform: identity\.transform,[\s\S]*?canvasWidth: identity\.canvasWidth,[\s\S]*?canvasHeight: identity\.canvasHeight/,
  );
  assert.match(
    requestSource,
    /effect\.requestPoliticalRasterWorkerPass\(\{[\s\S]*?identity: identity\.workerIdentity,[\s\S]*?rasterPacket: packetState\.packet,[\s\S]*?packetBuildMs: packetState\.packetBuildMs/,
  );
  assert.match(
    requestSource,
    /canvasPxWidth: packetState\.packet\?\.canvasPxWidth[\s\S]*?Math\.round\(identity\.canvasWidth \* Number\(state\.dpr \|\| 1\)\)[\s\S]*?canvasPxHeight: packetState\.packet\?\.canvasPxHeight[\s\S]*?Math\.round\(identity\.canvasHeight \* Number\(state\.dpr \|\| 1\)\)/,
  );
  assert.ok(requestSource.includes("onAcceptedBitmapResult: effect.onAcceptedBitmapResult"));
  const compositionSource = extractFunctionSource(rendererSource, "getPoliticalPartialRepaintOwner");
  assertOrderedTokens(compositionSource, [
    "onAcceptedBitmapResult: () => {",
    'invalidateRenderPasses("political", "political-raster-worker-bitmap-ready");',
    'requestRendererRender("political-raster-worker-bitmap-ready", {',
    "fallback: () => render(),",
  ], "accepted bitmap callback");
  assert.equal((ownerSource.match(/recordPoliticalRasterWorkerSnapshot\(\);/g) || []).length, 3);
  assert.match(
    ownerSource,
    /: \{ packet: null, packetBuildMs: 0, reason: "bitmap-flag-disabled" \};[\s\S]*?requestPoliticalRasterWorkerPassEffect\(/,
  );
});

test("progressive recovery keeps pending edits and visible overrides ahead of coarse skip", () => {
  const drawSource = extractFunctionSource(readRepoFile(CANONICAL_OWNER_PATH), "drawPoliticalPass");
  assert.match(
    drawSource,
    /const progressiveRecoveryCoarseSkipCandidate = \([\s\S]*?!!backgroundSummary\?\.progressive[\s\S]*?!backgroundSummary\?\.deferredFullCacheReady[\s\S]*?String\(backgroundSummary\?\.coarseUnderlay \|\| ""\) === "admin0"[\s\S]*?&& !pendingPoliticalColorEdit[\s\S]*?\);/,
  );
  assert.match(
    drawSource,
    /const visiblePoliticalForegroundColorOverride = progressiveRecoveryCoarseSkipCandidate[\s\S]*?\? hasVisiblePoliticalForegroundColorOverride\(viewport\.visibleItems\)[\s\S]*?: false;/,
  );
  const skipStart = drawSource.indexOf(
    "if (progressiveRecoveryCoarseSkipCandidate && !visiblePoliticalForegroundColorOverride)",
  );
  const fineStart = drawSource.indexOf("const featureMetrics = drawPoliticalFineFeatureLoop", skipStart);
  const skipSource = drawSource.slice(skipStart, fineStart);
  assertOrderedTokens(skipSource, [
    'recordRenderPerfMetric("drawPoliticalFeatureFillLoop", 0, {',
    'recordRenderPerfMetric("drawPoliticalFeatureStrokeLoop", 0, {',
    'politicalDataStage: "coarse"',
    'reason: "progressive-coarse-underlay"',
  ], "coarse recovery result");
});

test("partial political repaint stays upstream and partial-owner owned", () => {
  const partialSource = extractFunctionSource(readRepoFile(PARTIAL_OWNER_PATH), "tryPartialPoliticalPassRepaint");
  assertOrderedTokens(partialSource, [
    'String(cache.reasons?.political || "") !== "refresh-colors"',
    "getPoliticalPassFineBaselineMismatch(transform)",
    "collectLandSpatialItemsForProjectedRects(projectedDirtyRects, {",
    "getPoliticalPathCacheHandle(transform, { resetIfMismatch: true })",
    "drawPoliticalBackgroundFillsForEntries(redrawEntries)",
    "drawPoliticalFeature(feature, index, {",
    "cache.partialPoliticalDirtyIds.clear();",
    "clearPendingPoliticalColorEdit({",
    'paintSource: "political-partial-repaint"',
    'effect.recordRenderPerfMetric("politicalPartialRepaint", helper.nowMs() - startedAt, {',
    "return true;",
  ], "partial political repaint");
  assert.match(
    extractFunctionSource(readRepoFile(MAP_RENDERER_PATH), "tryPartialPoliticalPassRepaint"),
    /^function tryPartialPoliticalPassRepaint\(transform, nextSignature, timings\) \{\s*exactCompositeReuseOwner\?\.invalidate\(\);\s*return getPoliticalPartialRepaintOwner\(\)\.tryPartialPoliticalPassRepaint\(transform, nextSignature, timings\);\s*\}$/,
  );
});

test("fine drawing and diagnostics live in the partial owner while state writes remain root effects", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const partialOwnerSource = readRepoFile(PARTIAL_OWNER_PATH);
  const diagnosticsSource = extractFunctionSource(partialOwnerSource, "publishPoliticalPassDiagnostics");
  const recoverySource = extractFunctionSource(rendererSource, "getPoliticalRecoveryQuality");
  const fineSource = extractFunctionSource(partialOwnerSource, "drawPoliticalFineFeatureLoop");
  const ownerSource = extractFunctionSource(readRepoFile(CANONICAL_OWNER_PATH), "drawPoliticalPass");
  assert.ok(diagnosticsSource.includes("effect.commitPoliticalPassDiagnostics({"));
  const recoveryQualityWrite = [
    "runtimeState.politicalRecoveryQuality",
    " = resolved;",
  ].join("");
  assert.ok(recoverySource.includes(recoveryQualityWrite));
  assert.equal(/runtimeState\.[A-Za-z0-9_$]+\s*=(?!=)/.test(ownerSource), false);
  assertOrderedTokens(fineSource, [
    "const islandNeighbors = getDebugMode() === \"ISLANDS\" ? helper.getIslandNeighborGraph() : null;",
    "const featureMetrics = {",
    "if (Array.isArray(viewport.visibleItems))",
    "orderPoliticalShellUnderlayFirst(viewport.visibleItems).forEach",
    "const featureEntries = state.landData.features.map",
    "orderPoliticalShellUnderlayFirst(featureEntries).forEach",
    "return featureMetrics;",
  ], "fine political root loop");
  assertOrderedTokens(ownerSource, [
    "const featureMetrics = drawPoliticalFineFeatureLoop({ k, identity, viewport });",
    'recordRenderPerfMetric("drawPoliticalFeatureFillLoop"',
    'recordRenderPerfMetric("drawPoliticalFeatureStrokeLoop"',
    "clearPendingPoliticalColorEdit({",
    'paintSource: "political-pass"',
    'politicalDataStage: "fine"',
    'reason: "fine-feature-loop"',
  ], "fine political result");
  assert.equal((ownerSource.match(/return createPoliticalPassDrawResult\(/g) || []).length, 4);
  assert.equal((maskStringAndCommentContent(ownerSource).match(/^\s*return;\s*$/gm) || []).length, 1);
});

test("P3.3b installs one canonical owner and keeps protected architecture surfaces independent", () => {
  const sourceFiles = listRepoSourceFiles("js/core");
  assert.deepEqual(sourceFiles.filter(isPoliticalPassOwnerCandidate), [CANONICAL_OWNER_PATH]);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ...CANONICAL_OWNER_PATH.split("/"))), true);
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  assert.ok(rendererSource.includes(
    'import { createPoliticalPassOrchestratorOwner } from "./renderer/political_pass_orchestrator_owner.js";',
  ));
  assert.match(
    extractFunctionSource(rendererSource, "drawPoliticalPass"),
    /^function drawPoliticalPass\(k\) \{\s*return getPoliticalPassOrchestratorOwner\(\)\.drawPoliticalPass\(k\);\s*\}$/,
  );
  assert.equal(readRepoFile(PUBLIC_FACADE_PATH).includes("political_pass_orchestrator_owner"), false);
  assert.equal(readRepoFile(STATE_WRITE_ALLOWLIST_PATH).includes(CANONICAL_OWNER_PATH), false);
  for (const protectedPath of [
    "js/core/renderer/render_pipeline_catalog.js",
    "js/core/map_renderer/render_pass_catalog.js",
    "js/core/map_renderer/draw_canvas_orchestration_owner.js",
    "js/core/renderer/cached_pass_compositor_owner.js",
    "js/core/map_renderer/transformed_frame_compositor_owner.js",
    "js/core/renderer/visual_effects_pass_owner.js",
    "js/core/renderer/context_pass_orchestrator_owner.js",
  ]) {
    assert.equal(
      readRepoFile(protectedPath).includes("political_pass_orchestrator_owner"),
      false,
      `${protectedPath} should remain independent during preflight`,
    );
  }
  assert.ok(readRepoFile(MAP_RENDERER_PATH).includes("function renderPassToCache("));

  const politicalRecord = RENDER_PASS_FAMILY_INVENTORY.find((record) => record.passName === "political");
  assert.ok(politicalRecord);
  assert.equal(politicalRecord.implementationStatus, "owned-p3");
  assert.ok(politicalRecord.existingDependencyOwners.includes(CANONICAL_OWNER_PATH));
  assert.equal(politicalRecord.plannedPhase, "P3.3b");
  assert.ok(politicalRecord.existingDependencyOwners.includes(PARTIAL_OWNER_PATH));
  assert.ok(politicalRecord.browserLanes.includes("test:e2e:dev:political-progressive-recovery"));
});
