import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { includesExactLfFragment } from "../tools/check_architecture_boundaries.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const DOC_PATH = "docs/active/renderer-click-selection-transaction-preflight-20260702.md";
const P1_7_DOC_PATH = "docs/active/renderer-click-selection-transaction-preflight-p1-7-20260709.md";
const P1_8_DOC_PATH = "docs/active/renderer-click-selection-pure-decision-owner-p1-8-20260709.md";
const MAP_RENDERER_PATH = "js/core/map_renderer.js";
const CLICK_SELECTION_TRANSACTION_OWNER_PATH = "js/core/map_renderer/click_selection_transaction_owner.js";
const CLICK_SELECTION_TRANSACTION_OWNER_TEST_PATH = "tests/click_selection_transaction_owner_behavior.test.mjs";
const MAP_HOVER_INTERACTION_OWNER_PATH = "js/core/map_renderer/map_hover_interaction_owner.js";
const MAP_INTERACTION_EVENT_BINDING_OWNER_PATH = "js/core/renderer/map_interaction_event_binding_owner.js";
const INTERACTION_HIT_CANDIDATES_PATH = "js/core/map_renderer/interaction_hit_candidates.js";
const INTERACTION_FUNNEL_PATH = "js/core/interaction_funnel.js";
const HISTORY_MANAGER_PATH = "js/core/history_manager.js";
const DIRTY_STATE_PATH = "js/core/dirty_state.js";
const PUBLIC_FACADE_PATH = "js/core/map_renderer/public.js";
const STATE_WRITE_ALLOWLIST_PATH = "tools/eslint-rules/state-writer-allowlist.json";

const P54_DOC_HEADINGS = Object.freeze([
  "## Scope and guardrails",
  "## Current P48 hover interaction baseline",
  "## Click entry and event binding inventory",
  "## Land click transaction inventory",
  "## Water click transaction inventory",
  "## Special region click transaction inventory",
  "## Dev selection and fill inventory",
  "## History/dirty/render refresh inventory",
  "## Scenario detail readiness boundary",
  "## P55/P56 allowed first move",
  "## Forbidden areas",
  "## Required validation commands",
]);

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

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Expected function to exist: ${functionName}`);
  const signatureEnd = source.indexOf(") {", start + marker.length);
  const openBrace = signatureEnd >= 0
    ? signatureEnd + 2
    : source.indexOf("{", start + marker.length);
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

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected start marker to exist: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Expected end marker to exist after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function sliceFrom(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected start marker to exist: ${startMarker}`);
  return source.slice(start);
}

function isClickSelectionTransactionOwnerPath(sourcePath) {
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
  const hasClick = compact.includes("click") || compact.includes("mapclick");
  const hasSelection = compact.includes("selection") || compact.includes("select");
  const hasTransaction = compact.includes("transaction");
  const hasOwnerShape = /(?:^|_)(?:owner|helper|controller|adapter)(?:_|$)/.test(stem);
  return hasOwnerShape && hasClick && (hasSelection || hasTransaction);
}

function assertIncludes(source, token, message) {
  assert.ok(source.includes(token), `${message}: missing ${JSON.stringify(token)}`);
}

function stateWriteToken(rootName, keyName, suffix) {
  return `${rootName}.${keyName}${suffix}`;
}

const ORDERED_STEP_CATEGORIES = new Set([
  "sync-read-only",
  "sync-effectful",
  "async-read-only",
  "async-effectful",
]);
const step = Object.freeze({
  syncReadOnly: (reason, token) => ({ category: "sync-read-only", reason, token }),
  syncEffectful: (reason, token) => ({ category: "sync-effectful", reason, token }),
  asyncReadOnly: (reason, token) => ({ category: "async-read-only", reason, token }),
  asyncEffectful: (reason, token) => ({ category: "async-effectful", reason, token }),
});

function assertOrderedSteps(source, steps, message) {
  let cursor = -1;
  const reasons = new Set();
  const tokens = new Set();
  const classifications = new Set();
  for (const orderedStep of steps) {
    assert.deepEqual(
      Object.keys(orderedStep).sort(),
      ["category", "reason", "token"],
      `${message}: ordered step must use the exact category/reason/token schema`,
    );
    const { category, reason, token } = orderedStep;
    assert.equal(ORDERED_STEP_CATEGORIES.has(category), true, `${message}: invalid category ${JSON.stringify(category)}`);
    assert.equal(typeof reason === "string" && reason.length > 0, true, `${message}: reason must be nonempty`);
    assert.equal(typeof token === "string" && token.length > 0, true, `${message}: token must be nonempty`);
    assert.equal(reasons.has(reason), false, `${message}: duplicate reason ${JSON.stringify(reason)}`);
    assert.equal(tokens.has(token), false, `${message}: duplicate token ${JSON.stringify(token)}`);
    const classification = `${category}\u0000${reason}\u0000${token}`;
    assert.equal(
      classifications.has(classification),
      false,
      `${message}: duplicate classification ${JSON.stringify(classification)}`,
    );
    reasons.add(reason);
    tokens.add(token);
    classifications.add(classification);
    const next = source.indexOf(token, cursor + 1);
    assert.notEqual(
      next,
      -1,
      `${message} (${reason}): missing or out-of-order token ${JSON.stringify(token)}`,
    );
    cursor = next;
  }
}

const RETURN_STATEMENT_LINE_PATTERN = /^(?:if\s*\(.+\)\s*)?return(?:\s+[^;\r\n]+)?;\s*$/;

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
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
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

function assertReturnStatementCount(source, expectedCount, message) {
  const returnStatementLines = maskStringAndCommentContent(source)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => RETURN_STATEMENT_LINE_PATTERN.test(line));
  assert.equal(
    returnStatementLines.length,
    expectedCount,
    `${message}: expected ${expectedCount} line-scoped return statements, found ${returnStatementLines.length}: ${JSON.stringify(returnStatementLines)}`,
  );
}

test("return counter recognizes single-line expressions and masks strings and comments", () => {
  const fixtureSource = [
    "return;",
    "return false;",
    "return resolvedValue;",
    "if (ready) return resolveValue();",
    'return "value;with-semicolon"; // trailing comment',
    "// return ignoredLineComment;",
    "/*",
    "return ignoredBlockComment;",
    "*/",
    "const ignoredTemplate = `",
    "return ignoredTemplateContent;",
    "`;",
  ].join("\n");

  assertReturnStatementCount(fixtureSource, 5, "return counter fixture");
});

function assertExcludes(source, token, message) {
  assert.equal(source.includes(token), false, `${message}: unexpected ${JSON.stringify(token)}`);
}

test("P54 doc exists and locks required click selection transaction headings", () => {
  const docSource = readRepoFile(DOC_PATH);
  const p1_7DocSource = readRepoFile(P1_7_DOC_PATH);
  const p1_8DocSource = readRepoFile(P1_8_DOC_PATH);

  for (const heading of P54_DOC_HEADINGS) {
    assertIncludes(docSource, heading, "P54 doc must keep required heading");
  }
  for (const token of [
    "P54 is preflight only.",
    "No production runtime changes.",
    "The click handler function remains in `js/core/map_renderer.js` as `async function handleClick(event, _interactionContext = null)`.",
    "`js/core/renderer/map_interaction_event_binding_owner.js` remains a binding owner only.",
    "`js/core/interaction_funnel.js` keeps the dispatch bridge.",
    "Land click transaction logic remains in `map_renderer.js`.",
    "Water click transaction logic remains in `map_renderer.js`.",
    "Special region click transaction logic remains in `map_renderer.js`.",
    "Dev selection and fill remain in `map_renderer.js` and existing UI owners.",
    "Click and fill transactions currently call the existing history, dirty-state, and render refresh paths:",
    "Detailed land interaction readiness remains inside `map_renderer.js`:",
    "The first implementation should probably extract water/special selection clearing or the dev-selection click transaction only.",
    "Do not combine land fill, sovereignty, water fill, special region, and dev selection in one owner.",
    "Adding click-selection transaction owner/helper/controller/adapter files under `js/core/**`.",
  ]) {
    assertIncludes(docSource, token, "P54 doc must lock boundary token");
  }
  for (const token of [
    "`resolvedHit` has exactly four own keys: `targetType`, `id`, `countryCode`, and `runtimeCountryCode`.",
    "Every `resolvedHit` value is a scalar string or `null`; `targetType` accepts exactly `\"land\"`, `\"water\"`, `\"special\"`, or `null`.",
    "The current empty-hit contract is `targetType: null`, `id: null`, `countryCode: null`, and `runtimeCountryCode: null`.",
    "Missing or blank `id`, `countryCode`, and `runtimeCountryCode` inputs normalize to `null`.",
    "`readonlyModifiers` has exactly four own keys: `ctrlKey`, `metaKey`, `shiftKey`, and `altKey`, and every value is a boolean.",
    "Root creates `readonlyModifiers` with exactly those four boolean own keys and freezes it with `Object.freeze` before calling the pure seam.",
    "Extra own keys, object values, functions, DOM/Event values, and nested values are rejected.",
    "The output has exactly two own keys: `{ decision, target }`.",
    "`decision` is exactly `{ devSelectionRequested: boolean }`.",
    "An empty target is exactly `{ kind: \"empty\" }`.",
    "A nonempty target is exactly `{ kind, id, countryCode, runtimeCountryCode }`.",
    "`target.kind` accepts exactly `\"empty\"`, `\"land\"`, `\"water\"`, or `\"special\"`.",
    "Nonempty `id`, `countryCode`, and `runtimeCountryCode` values are scalar strings or `null`; missing or blank identity values normalize to `null`.",
    "`devSelectionRequested = target.kind === \"land\" && (readonlyModifiers.ctrlKey || readonlyModifiers.metaKey)`.",
    "Root consumes only returned `target.kind` and `target.id` for admission, and only returned `decision.devSelectionRequested` for the dev-selection branch.",
    "Raw hit data becomes available only after returned-target admission for root-owned lookup, hydration, refreshed-hit resolution, and effects.",
  ]) {
    assertIncludes(p1_7DocSource, token, "P1.7 doc must lock the future click-selection seam");
  }
  for (const token of [
    "`resolveClickSelectionDecision(resolvedHit, readonlyModifiers) -> { decision, target }`",
    "The owner receives the exact four-key scalar `resolvedHit` projection, never the raw hit object.",
    "Water ctrl/meta toggle remains a root-owned selection behavior and reads the frozen modifier snapshot independently.",
    "Only the land dev-selection branch consumes `decision.devSelectionRequested`.",
    "History, dirty state, runtime selection writes, hydration, refreshed-hit resolution, sidebar refresh, rendering, DOM/UI work, and metrics remain root-owned.",
    "Canonical empty admission is explicit: `if (target.kind === \"empty\" || !id) {`; typed land/water/special targets with blank or null ids retain their typed kind and enter the same clear branch.",
    "Pre-edit selector: 19 files, 186 commands, 6 main-thread commands, with only this new phase record unmatched.",
  ]) {
    assertIncludes(p1_8DocSource, token, "P1.8 doc must lock the pure click-selection decision owner boundary");
  }
});

test("click entry remains in map_renderer and event binding keeps injected dispatch", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const clickSelectionOwnerSource = readRepoFile(CLICK_SELECTION_TRANSACTION_OWNER_PATH);
  const eventBindingOwnerSource = readRepoFile(MAP_INTERACTION_EVENT_BINDING_OWNER_PATH);
  const interactionFunnelSource = readRepoFile(INTERACTION_FUNNEL_PATH);
  const handleClickSource = extractFunctionSource(clickSelectionOwnerSource, "handleClick");

  assertIncludes(rendererSource, "async function handleClick(event, interactionContext = null)", "map_renderer must keep click facade entry");
  assertIncludes(rendererSource, "return getClickSelectionTransactionOwner().handleClick(event, interactionContext);", "map_renderer must delegate the click transaction once");
  assertIncludes(rendererSource, "mapClick: handleClick", "map_renderer must inject click handler");
  assertIncludes(rendererSource, "dispatchMapClick", "map_renderer must keep click dispatcher wiring");
  assertIncludes(
    rendererSource,
    "createClickSelectionTransactionOwner,",
    "map_renderer must import the click transaction owner factory",
  );
  assert.equal(
    clickSelectionOwnerSource.split("resolveClickSelectionDecision(").length - 1,
    2,
    "click owner must declare and invoke the resolver once",
  );
  assertIncludes(
    clickSelectionOwnerSource,
    "export function resolveClickSelectionDecision(resolvedHit, readonlyModifiers)",
    "P1.8 owner must expose one pure resolver",
  );

  for (const token of [
    "requireFunction(helpers, \"bindInteractionFunnel\")({",
    "mapClick: requireFunction(handlers, \"mapClick\")",
    "mapDoubleClick: requireFunction(handlers, \"mapDoubleClick\")",
    "interactionRect.on(\"click\", requireFunction(handlers, \"dispatchMapClick\"));",
    "interactionRect.on(\"dblclick\", requireFunction(handlers, \"dispatchMapDoubleClick\"));",
  ]) {
    assertIncludes(eventBindingOwnerSource, token, "event binding owner must keep injected click binding token");
  }
  for (const token of [
    "let mapClickImpl = null;",
    "export function bindInteractionFunnel({",
    "mapClickImpl = typeof mapClick === \"function\" ? mapClick : null;",
    "export function dispatchMapClick(event)",
    "debugState.lastClickContext = buildMapInteractionContext(\"click\", event);",
    "return mapClickImpl(event, debugState.lastClickContext);",
  ]) {
    assertIncludes(interactionFunnelSource, token, "interaction funnel must keep click dispatch token");
  }
  assertIncludes(handleClickSource, "getHitFromEvent(event, {", "handleClick must keep hit resolution");
  assertIncludes(handleClickSource, "eventType: \"click\"", "handleClick must resolve click hit type");
  assertIncludes(
    handleClickSource,
    "resolveClickSelectionDecision(resolvedHit, readonlyModifiers)",
    "handleClick must delegate the scalar click decision once",
  );
});

test("transaction owner keeps the global branch spine and branch-local order", () => {
  const ownerSource = readRepoFile(CLICK_SELECTION_TRANSACTION_OWNER_PATH);
  const handleClickSource = sliceBetween(
    ownerSource,
    "async function handleClick(event, _interactionContext = null)",
    "return Object.freeze({ handleClick });",
  );

  assertOrderedSteps(handleClickSource, [
    step.syncReadOnly("state snapshot", "let state = getClickState();"),
    step.syncReadOnly("readonly admission", "if (state.startupReadonly) {"),
    step.syncReadOnly("action timing starts", "const actionStart = nowMs();"),
    step.syncReadOnly("data availability guard", "if (!state.landData && !state.waterRegionsData && !state.scenarioSpecialRegionsData) return;"),
    step.syncEffectful("brush click suppression", "if (consumeSuppressedBrushClick()) return;"),
    step.syncEffectful("onboarding hint dismissal", "dismissOnboardingHint();"),
    step.syncReadOnly("HGO click admission", "const hgoRuntimeClick = inspectHgoRuntimePreviewFromEvent(event, { eventType: \"click\" });"),
    step.syncReadOnly("facility admission", "const clickedFacilityEntry = getHoveredFacilityEntryFromEvent(event);"),
    step.syncReadOnly("root hit resolution", "const hit = getHitFromEvent(event, {"),
    step.syncReadOnly("scalar hit projection", "const resolvedHit = {"),
    step.syncReadOnly("frozen modifier projection", "const readonlyModifiers = Object.freeze({"),
    step.syncReadOnly("decision delegation", "const { decision, target } = resolveClickSelectionDecision(resolvedHit, readonlyModifiers);"),
    step.syncReadOnly("empty branch", "if (target.kind === \"empty\" || !id) {"),
    step.syncEffectful("dev hit update", "updateDevSelectedHit(hit);"),
    step.syncEffectful("special-zone membership", "if (handleSpecialZoneMembershipClick(hit, event)) return;"),
    step.syncReadOnly("special branch", "if (target.kind === \"special\") {"),
    step.syncReadOnly("water branch", "if (target.kind === \"water\") {"),
    step.syncReadOnly("land admission", "if (target.kind !== \"land\") return;"),
    step.syncReadOnly("dev selection branch", "if (decision.devSelectionRequested) {"),
    step.asyncEffectful("detail hydration", "if (!(await ensureLeafDetailReady(countryCode, { announce: true }))) {"),
    step.syncReadOnly("post-hydration state refresh", "state = getClickState();"),
    step.syncReadOnly("target expansion", "const targetIds = resolveInteractionTargetIds(feature, landId);"),
    step.syncReadOnly("preset admission", "if (state.isEditingPreset) {"),
    step.syncReadOnly("eyedropper branch", "if (state.currentTool === \"eyedropper\") {"),
    step.syncReadOnly("complete target admission", "if (!targetIds.length) {"),
    step.syncReadOnly("eraser branch", "if (state.currentTool === \"eraser\") {"),
    step.syncReadOnly("fill color", "const selectedColor = getSafeCanvasColor(state.selectedColor, landFillColor);"),
    step.syncEffectful("visual fill transaction", "applyVisualSubdivisionFill(targetIds, selectedColor, {"),
  ], "owner handleClick must keep the global branch spine");

  const emptyBranch = sliceBetween(
    handleClickSource,
    "if (target.kind === \"empty\" || !id) {",
    "updateDevSelectedHit(hit);",
  );
  assertOrderedSteps(emptyBranch, [
    step.syncEffectful("clear water action", "setClickSelectedWaterRegionId(\"\");"),
    step.syncEffectful("water sidebar refresh", "refreshWaterRegionSidebarRowsNow([previousWaterRegionId]);"),
    step.syncEffectful("water invalidation", "requestInteractionRender(\"clear-water-selection-empty-click\");"),
    step.syncEffectful("clear special action", "setClickSelectedSpecialRegionId(\"\");"),
    step.syncEffectful("special sidebar refresh", "refreshSpecialRegionSidebarRowsNow([previousSpecialRegionId]);"),
    step.syncEffectful("special invalidation", "requestInteractionRender(\"clear-special-selection-empty-click\");"),
  ], "empty click must preserve action, sidebar, and invalidation order");
});

test("click facade architecture matcher accepts LF and CRLF while token drift fails closed", () => {
  const facade = [
    "async function handleClick(event, interactionContext = null) {",
    "  return getClickSelectionTransactionOwner().handleClick(event, interactionContext);",
    "}",
  ].join("\n");
  assert.equal(includesExactLfFragment(facade, facade), true);
  assert.equal(includesExactLfFragment(facade.replaceAll("\n", "\r\n"), facade), true);
  assert.equal(
    includesExactLfFragment(
      facade.replace("getClickSelectionTransactionOwner", "getDriftedClickSelectionOwner"),
      facade,
    ),
    false,
  );
});

test("land water special and empty click branches remain in the transaction owner", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const ownerSource = readRepoFile(CLICK_SELECTION_TRANSACTION_OWNER_PATH);
  const handleClickSource = extractFunctionSource(ownerSource, "handleClick");
  const applyWaterRegionFillSource = extractFunctionSource(rendererSource, "applyWaterRegionFill");
  const applyVisualSubdivisionFillSource = extractFunctionSource(rendererSource, "applyVisualSubdivisionFill");

  for (const token of [
    "const resolvedHit = {",
    "targetType: hit.targetType ?? null,",
    "id: hit.id ?? null,",
    "countryCode: hit.countryCode ?? null,",
    "runtimeCountryCode: hit.runtimeCountryCode ?? null,",
    "const readonlyModifiers = Object.freeze({",
    "ctrlKey: !!event?.ctrlKey,",
    "metaKey: !!event?.metaKey,",
    "shiftKey: !!event?.shiftKey,",
    "altKey: !!event?.altKey,",
    "const { decision, target } = resolveClickSelectionDecision(resolvedHit, readonlyModifiers);",
    "if (target.kind === \"empty\" || !id) {",
    'setClickSelectedWaterRegionId("")',
    "requestInteractionRender(\"clear-water-selection-empty-click\")",
    'setClickSelectedSpecialRegionId("")',
    "requestInteractionRender(\"clear-special-selection-empty-click\")",
    "if (target.kind === \"special\") {",
    'setClickSelectedWaterRegionId("")',
    "setClickSelectedSpecialRegionId(id)",
    "requestInteractionRender(\"select-special-region\")",
    "if (target.kind === \"water\") {",
    "const isSelectionToggle = readonlyModifiers.ctrlKey || readonlyModifiers.metaKey;",
    "requestInteractionRender(\"water-selection-toggle-off\")",
    "requestInteractionRender(\"water-selection-toggle-on\")",
    "requestInteractionRender(\"click-select-open-ocean\")",
    "markDirty(\"erase-water-region-color\")",
    "commitHistoryEntry({",
    "requestInteractionRender(\"click-erase-water\")",
    "applyWaterRegionFill(id, state.selectedColor, {",
    "requestInteractionRender(\"clear-water-selection-land-click\")",
    "requestInteractionRender(\"clear-special-selection-land-click\")",
    "if (target.kind !== \"land\") return;",
    "if (decision.devSelectionRequested) {",
    "const changedSelection = toggleFeatureInDevSelection(landId);",
    "await ensureLeafDetailReady(countryCode, { announce: true })",
    "const kind = countryScope ? \"erase-country-color\" : \"erase-feature-color\";",
    "applyFeatureVisualOverrideTransaction(targetIds, null, {",
    "markDirty(kind);",
    "requestInteractionRender(\"click-erase\")",
    "const kind = countryScope ? \"fill-country-color\" : \"fill-feature-color\";",
    "applyVisualSubdivisionFill(targetIds, selectedColor, {",
  ]) {
    assertIncludes(handleClickSource, token, "handleClick must keep current click branch token");
  }
  assert.equal(handleClickSource.includes("fill-sovereignty"), false);
  assert.equal(handleClickSource.includes("erase-sovereignty"), false);

  for (const token of [
    stateWriteToken("runtimeState", "selectedWaterRegionId", " = resolvedId;"),
    "runtimeState.waterRegionOverrides[resolvedId] = color;",
    "markDirty(dirtyReason);",
    "commitHistoryEntry({",
    "requestInteractionRender(kind);",
    "refreshSidebarAfterPaint({ waterRegionIds: [resolvedId] });",
  ]) {
    assertIncludes(applyWaterRegionFillSource, token, "water fill helper must keep transaction token");
  }

  for (const token of [
    "const historyBefore = captureHistoryState({",
    "applyFeatureVisualOverrideTransaction(resolvedIds, color, {",
    "markDirty(dirtyReason);",
    "commitHistoryEntry({",
    "addRecentColor(color);",
    "requestInteractionRender(kind);",
    "refreshSidebarAfterPaint({ featureIds: resolvedIds });",
  ]) {
    assertIncludes(applyVisualSubdivisionFillSource, token, "land visual fill helper must keep transaction token");
  }
});

test("transaction behavior coverage executes the canonical owner factory", () => {
  const ownerBehaviorSource = readRepoFile(CLICK_SELECTION_TRANSACTION_OWNER_TEST_PATH);
  for (const token of [
    "empty hit clears water then special and invalidates each selection exactly once",
    "special water and land candidates retain their distinct transaction priority",
    "missing candidate fails closed before selection actions and invalidation",
    "action failure propagates and stops later sidebar and render work",
  ]) {
    assertIncludes(ownerBehaviorSource, token, "owner behavior suite must keep hostile transaction coverage");
  }
});

test("dev selection and fill remain in map_renderer and public facade stays stable", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const publicFacadeSource = readRepoFile(PUBLIC_FACADE_PATH);

  for (const token of [
    "function updateDevSelectedHit(hit = null)",
    "function addFeatureToDevSelection(featureId)",
    "function toggleFeatureInDevSelection(featureId)",
    "function removeLastDevSelection()",
    "function clearDevSelection()",
    "function applyDevMacroFillCurrentCountry()",
    "function applyDevMacroFillCurrentParentGroup()",
    "function applyDevMacroFillCurrentOwnerScope()",
    "function applyDevSelectionFill()",
    "requestInteractionRender(\"dev-selection-add\")",
    "requestInteractionRender(\"dev-selection-toggle\")",
    "requestInteractionRender(\"dev-selection-clear\")",
    "applyDevLandBatchAction(ids, {",
  ]) {
    assertIncludes(rendererSource, token, "map_renderer must keep dev selection/fill token");
  }

  for (const token of [
    "addFeatureToDevSelection,",
    "applyDevMacroFillCurrentCountry,",
    "applyDevMacroFillCurrentOwnerScope,",
    "applyDevMacroFillCurrentParentGroup,",
    "applyDevSelectionFill,",
    "clearDevSelection,",
    "removeLastDevSelection,",
    "toggleFeatureInDevSelection,",
    "from \"../map_renderer.js\";",
  ]) {
    assertIncludes(publicFacadeSource, token, "public facade must keep current dev selection/fill export");
  }
});

test("hit candidates stay pure and hover owner does not own click selection", () => {
  const hitCandidatesSource = readRepoFile(INTERACTION_HIT_CANDIDATES_PATH);
  const hoverOwnerSource = readRepoFile(MAP_HOVER_INTERACTION_OWNER_PATH);

  for (const token of [
    "runtimeState",
    "state.",
    "document",
    "window",
    "map_renderer.js",
    "markDirty",
    "captureHistoryState",
    "pushHistoryEntry",
    "commitHistoryEntry",
    "requestInteractionRender",
    "selectedWaterRegionId",
    "selectedSpecialRegionId",
  ]) {
    assertExcludes(hitCandidatesSource, token, "interaction_hit_candidates must remain pure");
  }
  for (const token of [
    "function handleMouseMove(event, { frameCoalesced = false } = {})",
    "\"getHitFromEvent\"",
    "\"updateDevHoverHit\"",
    "function queueTooltipUpdate(nextState = null)",
  ]) {
    assertIncludes(hoverOwnerSource, token, "hover owner must keep hover-only token");
  }
  for (const token of [
    "handleClick",
    "dispatchMapClick",
    "selectedWaterRegionId",
    "selectedSpecialRegionId",
    "toggleFeatureInDevSelection",
    "applyWaterRegionFill",
    "applyVisualSubdivisionFill",
    "markDirty",
    "commitHistoryEntry",
    "pushHistoryEntry",
  ]) {
    assertExcludes(hoverOwnerSource, token, "hover owner must not own click/selection token");
  }
});

test("history dirty and render refresh calls remain in current paths", () => {
  const rendererSource = readRepoFile(MAP_RENDERER_PATH);
  const ownerSource = readRepoFile(CLICK_SELECTION_TRANSACTION_OWNER_PATH);
  const historyManagerSource = readRepoFile(HISTORY_MANAGER_PATH);
  const dirtyStateSource = readRepoFile(DIRTY_STATE_PATH);
  const handleClickSource = extractFunctionSource(ownerSource, "handleClick");

  for (const token of [
    "import { captureHistoryState, pushHistoryEntry } from \"./history_manager.js\";",
    "import { markDirty } from \"./dirty_state.js\";",
    "function commitHistoryEntry({ kind, before, after, affectsSovereignty = false, gesture = null } = {})",
    "pushHistoryEntry({",
    "function requestInteractionRender(reason = \"interaction\")",
    "getRenderRequestBoundaryOwner().requestInteractionRenderBoundary(reason).completed;",
  ]) {
    assertIncludes(rendererSource, token, "map_renderer must keep history/dirty/render wrapper token");
  }
  for (const token of [
    "captureHistoryState({",
    "markDirty(",
    "commitHistoryEntry({",
    "requestInteractionRender(",
    "refreshSidebarAfterPaint(",
  ]) {
    assertIncludes(handleClickSource, token, "handleClick must keep transaction side-effect token");
  }
  for (const token of [
    "function captureHistoryState({",
    "function pushHistoryEntry(entry)",
    "function hasHistoryDelta(before, after)",
    "function applyHistorySnapshot(snapshot, direction, entry)",
  ]) {
    assertIncludes(historyManagerSource, token, "history manager must keep current ownership token");
  }
  for (const token of [
    "function markDirty(reason = \"\")",
    "markDirtyState(runtimeState, reason);",
    "updateDirtyIndicator();",
  ]) {
    assertIncludes(dirtyStateSource, token, "dirty state must keep current ownership token");
  }
});

test("P1.8 keeps one pure click decision owner and preserves forbidden boundaries", () => {
  const packageJsonSource = readRepoFile("package.json");
  const ownerSource = readRepoFile(CLICK_SELECTION_TRANSACTION_OWNER_PATH);
  const publicFacadeSource = readRepoFile(PUBLIC_FACADE_PATH);
  const stateWriteAllowlistSource = readRepoFile(STATE_WRITE_ALLOWLIST_PATH);

  assertIncludes(
    packageJsonSource,
    "\"test:node:renderer-click-selection-transaction-inventory\": \"node --test tests/renderer_click_selection_transaction_inventory_boundary.test.mjs\"",
    "package.json must expose P54 inventory script",
  );
  assertIncludes(
    packageJsonSource,
    "\"test:node:click-selection-transaction-owner\": \"node --test tests/click_selection_transaction_owner_behavior.test.mjs\"",
    "package.json must expose the P1.8 owner behavior script",
  );
  assert.equal(repoFileExists(CLICK_SELECTION_TRANSACTION_OWNER_TEST_PATH), true, "P1.8 owner behavior test must exist");
  for (const token of [
    "click_selection_transaction",
    "renderer_click_selection_transaction",
    "clickSelectionTransaction",
    "mapClickSelection",
  ]) {
    assertExcludes(publicFacadeSource, token, "public facade must remain outside P1.8 owner exposure");
    assertExcludes(stateWriteAllowlistSource, token, "state-write allowlist must remain outside P1.8 pure owner");
  }

  assert.equal(repoFileExists(CLICK_SELECTION_TRANSACTION_OWNER_PATH), true, "P1.8 pure decision owner must exist");
  for (const relativePath of [
    "js/core/map_renderer/click_selection_transaction_helper.js",
    "js/core/map_renderer/click_selection_transaction_controller.js",
    "js/core/map_renderer/click_selection_transaction_adapter.js",
    "js/core/renderer/click_selection_transaction_owner.js",
    "js/core/renderer/click_selection_transaction_helper.js",
    "js/core/renderer/click_selection_transaction_controller.js",
    "js/core/renderer/click_selection_transaction_adapter.js",
  ]) {
    assert.equal(repoFileExists(relativePath), false, `P1.8 must keep extra click selection owner/helper absent: ${relativePath}`);
  }
  const clickSelectionOwnerPaths = listRepoSourceFiles("js/core")
    .filter((sourcePath) => isClickSelectionTransactionOwnerPath(sourcePath));
  assert.deepEqual(
    clickSelectionOwnerPaths,
    [CLICK_SELECTION_TRANSACTION_OWNER_PATH],
    "P1.8 must keep exactly one production click selection owner/helper path",
  );

  for (const token of [
    "import ",
    "globalThis",
    "runtimeState",
    "map_renderer.js",
    "document",
    "window",
    "addEventListener",
    "pushHistoryEntry",
  ]) {
    assertExcludes(ownerSource, token, "click transaction owner must depend on injected ports");
  }
  for (const token of [
    "export function createClickSelectionTransactionOwner(",
    "export function resolveClickSelectionDecision(resolvedHit, readonlyModifiers)",
    "let state = getClickState();",
    "state = getClickState();",
    "return Object.freeze({ handleClick });",
    "devSelectionRequested: target.kind === \"land\" && (readonlyModifiers.ctrlKey || readonlyModifiers.metaKey)",
    "return { decision, target };",
  ]) {
    assertIncludes(ownerSource, token, "P1.8 owner must keep its exact pure decision contract");
  }

  const forbiddenDiff = execFileSync(
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      PUBLIC_FACADE_PATH,
      STATE_WRITE_ALLOWLIST_PATH,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.deepEqual(
    forbiddenDiff,
    [],
    "P1.8 must keep public facade and state allowlist unchanged",
  );
});
