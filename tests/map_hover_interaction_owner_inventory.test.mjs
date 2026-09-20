import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const OWNER_PATH = "js/core/map_renderer/map_hover_interaction_owner.js";
const MAP_RENDERER_PATH = "js/core/map_renderer.js";
const DOC_PATH = "docs/active/renderer-map-hover-interaction-owner-p48-20260701.md";
const PUBLIC_FACADE_PATH = "js/core/map_renderer/public.js";
const STATE_WRITE_ALLOWLIST_PATH = "tools/eslint-rules/state-writer-allowlist.json";
const HIT_CANVAS_OWNER_PATH = "js/core/map_renderer/hit_canvas_scheduling_owner.js";
const SCENARIO_REFRESH_RUNTIME_PATH = "js/core/map_renderer/scenario_refresh_runtime.js";
const EXACT_SCHEDULER_PATH = "js/core/map_renderer/exact_after_settle_scheduler.js";
const INTERACTION_HIT_CANDIDATES_PATH = "js/core/map_renderer/interaction_hit_candidates.js";
const EVENT_BINDING_OWNER_PATH = "js/core/renderer/map_interaction_event_binding_owner.js";
const ARCHITECTURE_CHECKER_PATH = "tools/check_architecture_boundaries.mjs";
const HOVER_OWNER_DIST_PATH = "dist/app/js/core/map_renderer/map_hover_interaction_owner.js";
const HIT_CANVAS_OWNER_DIST_PATH = "dist/app/js/core/map_renderer/hit_canvas_scheduling_owner.js";

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function repoFileExists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker ${endMarker}`);
  return source.slice(start, end);
}

function assertIncludes(source, token, message) {
  assert.ok(source.includes(token), `${message}: missing ${JSON.stringify(token)}`);
}

function assertExcludes(source, token, message) {
  assert.equal(source.includes(token), false, `${message}: unexpected ${JSON.stringify(token)}`);
}

function stateWriteToken(member, value) {
  return "runtime" + `State.${member} = ${value}`;
}

function stateWritePrefix(member) {
  return "runtime" + `State.${member} =`;
}

function gitDiffNames(paths) {
  return execFileSync("git", ["diff", "--name-only", "--", ...paths], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim().split(/\r?\n/).filter(Boolean).map((name) => name.replaceAll("\\", "/"));
}

test("P48 owner file and active doc exist", () => {
  assert.equal(repoFileExists(OWNER_PATH), true, "P48 owner must exist");
  const docSource = readRepoFile(DOC_PATH);
  for (const token of [
    "Move only the `handleMouseMove(event)` hover, tooltip, cursor, and hover-overlay orchestration",
    "Runtime writes remain in `map_renderer.js` through injected effects",
    "Existing P47 hit canvas scheduling owner",
    "click/double-click, selection/fill, brush/physical-intensity",
  ]) {
    assertIncludes(docSource, token, "P48 doc must lock the narrow owner boundary");
  }
});

test("map_renderer keeps handleMouseMove wrapper and delegates to P48 owner", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const ownerFactorySource = sliceBetween(
    rendererSource,
    "function getMapHoverInteractionOwner()",
    "function getVisibleFrameDiagnosticsOwner()",
  );
  assertIncludes(
    rendererSource,
    "import { createMapHoverInteractionOwner } from \"./map_renderer/map_hover_interaction_owner.js\";",
    "map_renderer must import P48 owner",
  );
  assertIncludes(rendererSource, "let mapHoverInteractionOwner = null;", "map_renderer must keep P48 owner singleton");
  assertIncludes(rendererSource, "function getMapHoverInteractionOwner()", "map_renderer must expose P48 owner factory");
  assertIncludes(rendererSource, "mapHoverInteractionOwner = createMapHoverInteractionOwner({", "map_renderer must build P48 owner");
  for (const token of [
    "state: runtimeState,", "surfaceHost: rendererSurfaceHost,", "nowMs,",
    "getHitFromEvent,", "getHoveredFacilityEntryFromEvent,", "isFacilityDetailsSurfaceActive,",
    "getHoveredCityTooltipEntry,", "getSelectedFacilityEntry: () => selectedFacilityEntry,",
    "getTooltipTextForFeature: getTooltipText,", "renderHoverOverlay,", "recordInteractionDurationMetric,",
  ]) {
    assertIncludes(ownerFactorySource, token, "map_renderer must keep injected P48 state/effect boundary");
  }


  const wrapperSource = sliceBetween(
    rendererSource,
    "function handleMouseMove(event) {",
    "function addRecentColor(color) {",
  );
  assertIncludes(
    wrapperSource,
    "getMapHoverInteractionOwner().scheduleMouseMove(event);",
    "handleMouseMove wrapper must delegate to P48 owner",
  );
  for (const token of [
    "queueTooltipUpdate({",
    "setMapInteractionCursor(",
    "getHitFromEvent(event,",
    stateWritePrefix("hoveredId"),
    "hoveredFacilityEntry =",
    "inspectHgoRuntimePreviewFromEvent(event",
  ]) {
    assertExcludes(wrapperSource, token, "handleMouseMove wrapper must not keep old hover body token");
  }
});

test("P48 owner declares hover dependencies and avoids forbidden migrations", () => {
  const ownerSource = readRepoFile(OWNER_PATH);
  for (const token of [
    "export function createMapHoverInteractionOwner",
    "\"getHitFromEvent\"",
    "function queueTooltipUpdate(",
    "function setMapInteractionCursor(",
    "function clearUnderlyingHoverForFacilityEntry(",
    "function handleMouseMove(event,",
    "eventType: \"hover\"",
    "\"facility-tooltip\"",
    "\"feature-tooltip\"",
    "return Object.freeze({",
  ]) {
    assertIncludes(ownerSource, token, "P48 owner must lock hover orchestration token");
  }
  for (const token of [
    "runtimeState",
    "rendererSurfaceHost",
    "from \"../map_renderer.js\"",
    "from \"./map_renderer.js\"",
    "dispatchMapClick",
    "dispatchMapDoubleClick",
    "handleClick",
    "handleDoubleClick",
    "brushSession",
    "physicalIntensity",
    "drawHitCanvas",
    "buildHitCanvasAfterStartup",
    "scheduleHitCanvasBuildIfNeeded",
    "scenarioRefreshRuntime",
    "exactAfterSettle",
    "strategicOverlayRuntime",
  ]) {
    assertExcludes(ownerSource, token, "P48 owner must avoid forbidden migration token");
  }
});

test("event binding owner still receives handleMouseMove by injection", () => {
  const eventBindingSource = readRepoFile(EVENT_BINDING_OWNER_PATH);
  assertIncludes(
    eventBindingSource,
    "interactionRect.on(\"mousemove\", requireFunction(handlers, \"handleMouseMove\"));",
    "event binding owner must keep injected mousemove handler",
  );
  assertExcludes(eventBindingSource, "map_hover_interaction_owner", "event binding owner must not import P48 owner");
  assert.deepEqual(gitDiffNames([EVENT_BINDING_OWNER_PATH]), []);
});

test("interaction hit candidates remain pure and outside hover owner", () => {
  const candidatesSource = readRepoFile(INTERACTION_HIT_CANDIDATES_PATH);
  for (const token of [
    "function collectSpatialGridCandidates",
    "function rankCandidates",
    "function findFirstContainingCandidate",
    "function toHitResult",
    "function shouldPreferWaterHit",
  ]) {
    assertIncludes(candidatesSource, token, "interaction hit candidates must keep pure export");
  }
  for (const token of [
    "runtimeState",
    "map_hover_interaction_owner",
    "createMapHoverInteractionOwner",
  ]) {
    assertExcludes(candidatesSource, token, "interaction hit candidates must avoid hover owner ownership");
  }
  assert.deepEqual(gitDiffNames([INTERACTION_HIT_CANDIDATES_PATH]), []);
});

test("public facade state-write allowlist owners scenario runtime exact scheduler and owner mirrors remain untouched", () => {
  const publicFacadeSource = readRepoFile(PUBLIC_FACADE_PATH);
  const allowlistSource = readRepoFile(STATE_WRITE_ALLOWLIST_PATH);
  const hitCanvasOwnerSource = readRepoFile(HIT_CANVAS_OWNER_PATH);
  const scenarioRuntimeSource = readRepoFile(SCENARIO_REFRESH_RUNTIME_PATH);
  const exactSchedulerSource = readRepoFile(EXACT_SCHEDULER_PATH);

  for (const token of [
    "render,",
    "setMapData,",
    "initMap,",
    "RENDER_PASS_NAMES,",
    "from \"../map_renderer.js\";",
  ]) {
    assertIncludes(publicFacadeSource, token, "public facade must keep stable export bridge");
  }
  for (const token of ["map_hover_interaction_owner", "MapHoverInteraction", "hitCanvasScheduling"]) {
    assertExcludes(publicFacadeSource, token, "public facade must stay closed to P48/P47 owners");
    assertExcludes(allowlistSource, token, "state-write allowlist must stay closed to P48/P47 owners");
  }
  assertIncludes(hitCanvasOwnerSource, "export function createHitCanvasSchedulingOwner", "P47 owner must remain present");
  assertIncludes(scenarioRuntimeSource, "scheduleHitCanvasBuildIfNeeded", "scenario runtime must keep injected scheduling");
  assertExcludes(scenarioRuntimeSource, "map_hover_interaction_owner", "scenario runtime must not import P48 owner");
  assertExcludes(exactSchedulerSource, "map_hover_interaction_owner", "exact scheduler must not import P48 owner");
  assert.deepEqual(gitDiffNames([
    PUBLIC_FACADE_PATH,
    STATE_WRITE_ALLOWLIST_PATH,
    HIT_CANVAS_OWNER_PATH,
    SCENARIO_REFRESH_RUNTIME_PATH,
    EXACT_SCHEDULER_PATH,
    HOVER_OWNER_DIST_PATH,
    HIT_CANVAS_OWNER_DIST_PATH,
  ]), []);
});

test("package and architecture checker register P48 validation gates", () => {
  const packageSource = readRepoFile("package.json");
  const checkerSource = readRepoFile(ARCHITECTURE_CHECKER_PATH);
  for (const token of [
    "\"test:node:map-hover-interaction-owner\": \"node --test tests/map_hover_interaction_owner_behavior.test.mjs\"",
    "\"test:node:map-hover-interaction-inventory\": \"node --test tests/map_hover_interaction_owner_inventory.test.mjs\"",
    "\"test:node:map-hover-interaction\": \"npm run test:node:map-hover-interaction-owner && npm run test:node:map-hover-interaction-inventory\"",
  ]) {
    assertIncludes(packageSource, token, "package.json must expose P48 scripts");
  }
  for (const token of [
    "mapHoverInteractionOwner: \"js/core/map_renderer/map_hover_interaction_owner.js\"",
    "mapHoverInteractionOwnerTest: \"tests/map_hover_interaction_owner_behavior.test.mjs\"",
    "mapHoverInteractionOwnerInventoryTest: \"tests/map_hover_interaction_owner_inventory.test.mjs\"",
    "[FILES.mapHoverInteractionOwner]: 400",
    "must expose P48 map hover interaction script",
  ]) {
    assertIncludes(checkerSource, token, "architecture checker must register P48");
  }
});
