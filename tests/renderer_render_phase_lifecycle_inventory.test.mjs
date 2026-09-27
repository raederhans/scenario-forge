import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_PATH = "js/core/map_renderer/render_phase_lifecycle_owner.js";
const RENDERER_PATH = "js/core/map_renderer.js";
const PUBLIC_FACADE_PATH = "js/core/map_renderer/public.js";
const PACKAGE_PATH = "package.json";
const STATE_WRITE_ALLOWLIST_PATH = "tools/eslint-rules/state-writer-allowlist.json";
const REQUEST_OWNER_PATH = "js/core/map_renderer/render_request_boundary_owner.js";
const VISIBLE_FRAME_OWNER_PATH = "js/core/renderer/visible_frame_diagnostics_owner.js";
const SCENARIO_REFRESH_RUNTIME_PATH = "js/core/map_renderer/scenario_refresh_runtime.js";
const EXACT_SCHEDULER_PATH = "js/core/map_renderer/exact_after_settle_scheduler.js";
const STRATEGIC_RUNTIME_OWNER_PATH = "js/core/renderer/strategic_overlay_runtime_owner.js";
const BROAD_LIFECYCLE_OWNER_PATH = "js/core/renderer/renderer_render_lifecycle_owner.js";
const SHARED_RENDERER_DIST_MIRROR_PATH = "dist/app/js/core/map_renderer.js";
const P43_OWNER_DIST_MIRROR_PATHS = Object.freeze([
  "dist/app/js/core/map_renderer/render_phase_lifecycle_owner.js",
]);
const PHASE_ACTION_PATH = "js/core/state/actions/renderer_phase_actions.js";
const INTERACTION_ACTION_PATH = "js/core/state/actions/renderer_interaction_actions.js";

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing end marker ${endMarker}`);
  return source.slice(start, end);
}

test("P43 render phase lifecycle owner files and package scripts are registered", () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, OWNER_PATH)), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, BROAD_LIFECYCLE_OWNER_PATH)), false);

  const packageJson = readProjectFile(PACKAGE_PATH);
  for (const token of [
    "\"test:node:renderer-render-phase-lifecycle-owner\": \"node --test tests/renderer_render_phase_lifecycle_owner_behavior.test.mjs\"",
    "\"test:node:renderer-render-phase-lifecycle-inventory\": \"node --test tests/renderer_render_phase_lifecycle_inventory.test.mjs\"",
    "\"test:node:renderer-render-phase-lifecycle\": \"npm run test:node:renderer-render-phase-lifecycle-owner && npm run test:node:renderer-render-phase-lifecycle-inventory\"",
  ]) {
    assert.equal(packageJson.includes(token), true, `${PACKAGE_PATH} must expose ${token}`);
  }
});

test("P43 owner owns render phase and timer lifecycle only", () => {
  const ownerSource = readProjectFile(OWNER_PATH);
  for (const token of [
    "export function createRenderPhaseLifecycleOwner({",
    "const REQUIRED_EFFECT_NAMES = Object.freeze([",
    "const REQUIRED_GETTER_NAMES = Object.freeze([",
    "clearRenderPhaseTimer",
    "setRenderPhase",
    "scheduleRenderPhaseIdle",
    "resetRenderPhaseState",
    "getAdaptiveSettleProfile",
    "PROMOTION_ACTIVE_STATUSES",
    "Object.freeze({",
  ]) {
    assert.equal(ownerSource.includes(token), true, `${OWNER_PATH} must own ${token}`);
  }

  for (const token of ["createTrace", "createSummary", "effectOrder", "getterOrder"]) {
    assert.equal(ownerSource.includes(token), false, `${OWNER_PATH} must not retain trace bookkeeping ${token}`);
  }

  for (const token of [
    "runtimeState",
    "map_renderer.js",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "createStrategicOverlayRuntimeOwner",
    "renderer_render_lifecycle_owner",
  ]) {
    assert.equal(ownerSource.includes(token), false, `${OWNER_PATH} must avoid ${token}`);
  }
});

test("map_renderer delegates phase lifecycle wrappers while keeping render anchors", () => {
  const rendererSource = readProjectFile(RENDERER_PATH);
  for (const token of [
    "from \"./state/actions/renderer_phase_actions.js\";",
    "from \"./state/actions/renderer_interaction_actions.js\";",
    "from \"./map_renderer/render_phase_lifecycle_owner.js\";",
    "let renderPhaseLifecycleOwner = null;",
    "function getRenderPhaseLifecycleOwner()",
    "renderPhaseLifecycleOwner = createRenderPhaseLifecycleOwner({",
    "getRenderPhase: () => runtimeState.renderPhase",
    "getRenderPhaseTimerId: () => runtimeState.renderPhaseTimerId",
    "hasPendingDayNightRefresh: () => Boolean(runtimeState.pendingDayNightRefresh)",
    "shouldStartExactAfterSettleFastPath",
    "clearTimeout: (timerId) => globalThis.clearTimeout(timerId)",
    "setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs)",
    "setRenderPhaseTimerId: (timerId) => {",
    "setRenderPhaseTimerIdState(runtimeState, timerId);",
    "setRenderPhaseValue: (phase) => {",
    "setRenderPhaseValueState(runtimeState, phase);",
    "setPhaseEnteredAt: (enteredAtMs) => {",
    "setPhaseEnteredAtState(runtimeState, enteredAtMs);",
    "setIsInteracting: (isInteracting) => {",
    "setRendererIsInteractingState(runtimeState, isInteracting);",
    "cancelPoliticalPathWarmup",
    "setHoverOverlayDirty: (dirty) => {",
    "setPendingDayNightRefresh: (pending) => {",
    "setPendingDayNightRefreshState(runtimeState, pending);",
    "invalidateRenderPasses",
    "updateDprStage",
    "setCanvasSize",
    "setAdaptiveSettleProfile: (settleProfile) => {",
    "setAdaptiveSettleProfileState(runtimeState, settleProfile);",
    "scheduleScenarioChunkRefresh: (options) => (",
    "setDeferExactAfterSettle: (deferred) => {",
    "render,",
    "scheduleExactAfterSettleRefresh",
    "resetRenderPhaseState: () => getRenderPhaseLifecycleOwner().resetRenderPhaseState(\"init-map\")",
    "getRenderPhaseLifecycleOwner().clearRenderPhaseTimer();",
    "getRenderPhaseLifecycleOwner().setRenderPhase(phase);",
    "getRenderPhaseLifecycleOwner().scheduleRenderPhaseIdle();",
  ]) {
    assert.equal(rendererSource.includes(token), true, `${RENDERER_PATH} must keep ${token}`);
  }

  for (const key of [
    "renderPhaseTimerId",
    "renderPhase",
    "phaseEnteredAt",
    "isInteracting",
    "pendingDayNightRefresh",
    "adaptiveSettleProfile",
    "dprStage",
    "dprLastStageSwitchAt",
    "zoomGestureStartTransform",
    "zoomGestureScaleDelta",
    "pendingZoomTransform",
    "zoomRenderScheduled",
    "zoomGestureEndedAt",
    "activeInteractionRecoveryTaskKey",
    "activeInteractionRecoveryTaskStartedAt",
  ]) {
    assert.equal(
      new RegExp(`\\bruntimeState\\.${key}\\s*=(?!=)`).test(rendererSource),
      false,
      `${RENDERER_PATH} must delegate direct write for ${key}`,
    );
  }

  for (const actionPath of [PHASE_ACTION_PATH, INTERACTION_ACTION_PATH]) {
    const actionSource = readProjectFile(actionPath);
    const actionImports = [...actionSource.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
      .map((match) => match[1]).sort();
    assert.deepEqual(actionImports, actionPath === INTERACTION_ACTION_PATH ? [
      "./appearance_selection_actions.js",
      "./scenario_presentation_actions.js",
    ] : [], `${actionPath} may only delegate to its explicit sibling actions`);
    for (const forbidden of ["runtimeState", "document", "window", "globalThis", "Date.now"]) {
      assert.equal(actionSource.includes(forbidden), false, `${actionPath} must avoid ${forbidden}`);
    }
  }

  for (const token of [
    "function render()",
    "function drawCanvas()",
    "function renderPassToCache(",
    "async function buildHitCanvasAfterStartup",
    "createScenarioRefreshRuntime({",
    "createExactAfterSettleScheduler({",
    "createStrategicOverlayRuntimeOwner({",
  ]) {
    assert.equal(rendererSource.includes(token), true, `${RENDERER_PATH} must keep render anchor ${token}`);
  }

  const clearTimerSource = sliceBetween(rendererSource, "function clearRenderPhaseTimer()", "function clamp01");
  const setPhaseSource = sliceBetween(rendererSource, "function setRenderPhase(phase)", "function isInteractionRecoveryBlocked");
  const scheduleIdleSource = sliceBetween(rendererSource, "function scheduleRenderPhaseIdle()", "function flushPendingScenarioChunkRefreshAfterExact");
  const directStateToken = (tail) => ["runtime", `State${tail}`].join("");
  for (const [label, source, forbiddenTokens] of [
    ["clearRenderPhaseTimer", clearTimerSource, ["globalThis.clearTimeout", directStateToken(".renderPhaseTimerId = null")]],
    ["setRenderPhase", setPhaseSource, [
      directStateToken(".renderPhase = phase"),
      directStateToken(".phaseEnteredAt = nowMs()"),
      directStateToken(".isInteracting = phase === RENDER_PHASE_INTERACTING"),
      "cancelPoliticalPathWarmup(`phase-${phase}`)",
      directStateToken(".pendingDayNightRefresh = false"),
    ]],
    ["scheduleRenderPhaseIdle", scheduleIdleSource, [
      directStateToken(".adaptiveSettleProfile = settleProfile"),
      "globalThis.setTimeout",
      directStateToken(".deferExactAfterSettle = true"),
      "scheduleExactAfterSettleRefresh(settleProfile)",
    ]],
  ]) {
    for (const token of forbiddenTokens) {
      assert.equal(source.includes(token), false, `${label} wrapper must delegate old inline token ${token}`);
    }
  }
});

test("P41 and P42 owners remain narrow after P43", () => {
  const requestOwnerSource = readProjectFile(REQUEST_OWNER_PATH);
  const visibleFrameOwnerSource = readProjectFile(VISIBLE_FRAME_OWNER_PATH);

  for (const token of [
    "requestRendererRenderBoundary",
    "requestInteractionRenderBoundary",
    "flushInteractionRenderBoundary",
  ]) {
    assert.equal(requestOwnerSource.includes(token), true, `${REQUEST_OWNER_PATH} must keep ${token}`);
  }
  for (const token of [
    "setRenderPhase",
    "scheduleRenderPhaseIdle",
    "resetRenderPhaseState",
    "render_phase_lifecycle_owner",
  ]) {
    assert.equal(requestOwnerSource.includes(token), false, `${REQUEST_OWNER_PATH} must stay request-only at ${token}`);
  }

  for (const token of [
    "recordVisibleFrameTransaction",
    "recordFirstVisibleFrameBlocked",
    "markFirstVisibleFramePainted",
    "resetFirstVisibleFramePainted",
  ]) {
    assert.equal(visibleFrameOwnerSource.includes(token), true, `${VISIBLE_FRAME_OWNER_PATH} must keep ${token}`);
  }
  for (const token of [
    "setRenderPhase",
    "scheduleRenderPhaseIdle",
    "resetRenderPhaseState",
    "render_phase_lifecycle_owner",
  ]) {
    assert.equal(visibleFrameOwnerSource.includes(token), false, `${VISIBLE_FRAME_OWNER_PATH} must stay diagnostics-only at ${token}`);
  }
});

test("scenario exact strategic public facade and state-write boundaries stay unchanged", () => {
  const publicFacadeSource = readProjectFile(PUBLIC_FACADE_PATH);
  const stateWriteAllowlist = readProjectFile(STATE_WRITE_ALLOWLIST_PATH);

  for (const [relativePath, source] of [
    [SCENARIO_REFRESH_RUNTIME_PATH, readProjectFile(SCENARIO_REFRESH_RUNTIME_PATH)],
    [EXACT_SCHEDULER_PATH, readProjectFile(EXACT_SCHEDULER_PATH)],
    [STRATEGIC_RUNTIME_OWNER_PATH, readProjectFile(STRATEGIC_RUNTIME_OWNER_PATH)],
  ]) {
    assert.equal(source.includes("render_phase_lifecycle_owner"), false, `${relativePath} must not import P43 owner`);
  }

  for (const token of [
    "render,",
    "setMapData,",
    "initMap,",
    "RENDER_PASS_NAMES,",
    "from \"../map_renderer.js\";",
  ]) {
    assert.equal(publicFacadeSource.includes(token), true, `${PUBLIC_FACADE_PATH} must remain stable at ${token}`);
  }
  assert.equal(publicFacadeSource.includes("render_phase_lifecycle_owner"), false, `${PUBLIC_FACADE_PATH} must not expose P43 owner`);
  assert.equal(
    stateWriteAllowlist.includes("render_phase_lifecycle_owner"),
    false,
    `${STATE_WRITE_ALLOWLIST_PATH} must not add P43 owner state writes`,
  );
});

test("P43 leaves dist app mirror untouched", () => {
  assert.equal(P43_OWNER_DIST_MIRROR_PATHS.includes(SHARED_RENDERER_DIST_MIRROR_PATH), false);
  assert.equal(runGit(["status", "--porcelain", "--", ...P43_OWNER_DIST_MIRROR_PATHS]), "");
  assert.equal(runGit(["diff", "--name-only", "HEAD", "--", ...P43_OWNER_DIST_MIRROR_PATHS]), "");
});
