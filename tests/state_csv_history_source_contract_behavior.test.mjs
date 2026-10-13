import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "acorn";
import { CSV_HISTORY_SOURCE_PATH as MODULE_PATH, inspectStateCsvHistorySourceRefresh,
  inspectStateCsvHistorySourceRefreshEvidence } from "../tools/state_csv_history_source_contract.mjs";
import { STATE_CAPABILITY_RETIREMENT_CONTRACT, matchesStateCapabilityRetirementSource } from "../tools/state_action_delegation_contract.mjs";
import { inspectStateCapabilityRetirementEvidence } from "../tools/build_state_writer_policy.mjs";

const REVISION = "52427d3a2b5e786f30ffcfb3491b6733be339f79";
const ANCHOR = "895bb71dade9a1c3ec6d8827255da654e71fa76722bdbba3c34be01ec32891d2";
const normalize = source => source.replace(/\r\n?/g, "\n");
const read = path => normalize(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const hash = source => createHash("sha256").update(source).digest("hex");
const historicalCache = new Map();
const historical = (revision, path) => {
  const key = `${revision}:${path}`;
  if (!historicalCache.has(key)) historicalCache.set(key,
    normalize(execFileSync("git", ["show", key], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })));
  return historicalCache.get(key);
};
const source = read(MODULE_PATH), previous = historical(REVISION, MODULE_PATH);
const options = { modulePath: MODULE_PATH, sourceFingerprint: ANCHOR, source,
  readCurrentSource: read, readHistoricalSource: historical };
const inspect = patch => inspectStateCsvHistorySourceRefresh({ ...options, ...patch });
const receipt = inspectStateCsvHistorySourceRefreshEvidence(options).receipt;
const contracts = STATE_CAPABILITY_RETIREMENT_CONTRACT.filter(entry => entry.modulePath === MODULE_PATH);
const previousPolicy = () => JSON.parse(historical(contracts[0].previousSourceRevision, "tools/state_writer_policy.json"));
const validate = patch => inspectStateCapabilityRetirementEvidence({ previousPolicy: previousPolicy(),
  contractEntries: contracts, readCurrentSource: read, readHistoricalSource: historical, ...patch });
const replace = (text, before, after) => {
  assert.ok(text.includes(before), `fixture anchor exists: ${before}`);
  return text.replace(before, after);
};
function effectNodes(text) {
  const nodes = [];
  const visit = node => {
    if (!node || typeof node !== "object" || !node.type) return;
    if (["AssignmentExpression", "UpdateExpression", "CallExpression", "NewExpression"].includes(node.type)
      || node.type === "UnaryExpression" && node.operator === "delete") nodes.push(node);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child?.type) visit(child);
    }
  };
  visit(parse(text, { ecmaVersion: "latest", sourceType: "module" }));
  return nodes;
}

test("CSV history source refresh reconstructs nine exact transforms and all 181 original effect sites", () => {
  const result = inspectStateCsvHistorySourceRefreshEvidence(options);
  assert.equal(result.matched, true);
  assert.deepEqual(result.violations, []);
  assert.equal(inspect(), true);
  assert.equal(receipt.previousSourceRevision, REVISION);
  assert.equal(receipt.previousSourceFingerprint, ANCHOR);
  assert.equal(receipt.sourceFingerprint, hash(source));
  assert.equal(receipt.hookIntermediateFingerprint, hash(historical("311e5dfe8f335ec11817aabd7e2fda4f49c1ba52", MODULE_PATH)));
  assert.deepEqual(receipt.transforms.map(entry => entry.name), ["hook-import", "csv-imports", "capture-parameters", "capture-color-keys",
    "capture-csv-fields", "restore-csv-fields", "csv-scope-guard", "undo-scope-check", "redo-scope-check"]);
  assert.deepEqual(receipt.preservedSiteCounts, { CallExpression: 144, NewExpression: 3, AssignmentExpression: 33, UnaryExpression: 1 });
  const oldNodes = effectNodes(previous), currentNodes = effectNodes(source);
  assert.equal(receipt.preservedHistoricalSiteCount, 181);
  assert.equal(receipt.preservedSites.length, oldNodes.length);
  const previousKeys = new Set(), currentKeys = new Set();
  for (const site of receipt.preservedSites) {
    const old = oldNodes.find(node => node.start === site.previous.start && node.end === site.previous.end && node.type === site.nodeType);
    const current = currentNodes.find(node => node.start === site.current.start && node.end === site.current.end && node.type === site.nodeType);
    assert.ok(old && current);
    assert.equal(previous.slice(old.start, old.end), source.slice(current.start, current.end));
    assert.equal(site.sourceFingerprint, hash(previous.slice(old.start, old.end)));
    assert.ok(site.lexicalAncestry.length > 0);
    previousKeys.add(`${old.start}:${old.end}`);
    currentKeys.add(`${current.start}:${current.end}`);
  }
  assert.equal(previousKeys.size, 181);
  assert.equal(currentKeys.size, 181);
  assert.equal(receipt.grantsWriterAuthority, false);
  assert.equal(receipt.grantsDiagnosticCredit, false);
  assert.equal(receipt.refreshesRetirementIdentity, false);
  assert.throws(() => { receipt.preservedSites[0].lexicalAncestry.push("forged"); }, TypeError);
  assert.throws(() => { receipt.transforms[0].afterFingerprint = "forged"; }, TypeError);
});

test("CSV history source refresh accepts line-ending normalization and defers only unknown identity pairs", () => {
  assert.equal(inspect({ source: source.replaceAll("\n", "\r\n"),
    readHistoricalSource: (revision, path) => historical(revision, path).replaceAll("\n", "\r\n"),
    readCurrentSource: path => read(path).replaceAll("\n", "\r\n") }), true);
  const forbidden = () => { throw Error("unknown pairs must not load source"); };
  for (const patch of [{ modulePath: "js/core/unrelated.js" }, { sourceFingerprint: hash(source) }, { sourceFingerprint: "unregistered" }]) {
    assert.equal(inspect({ ...patch, readCurrentSource: forbidden, readHistoricalSource: forbidden }), null);
  }
  assert.equal(inspect({ source: null }), false);
  assert.equal(inspect({ readCurrentSource: forbidden }), false);
  assert.equal(inspect({ readHistoricalSource: forbidden }), false);
  assert.equal(inspect({ source: previous }), false);
  assert.equal(inspect({ source: historical("311e5dfe8f335ec11817aabd7e2fda4f49c1ba52", MODULE_PATH) }), false);
});

const sourceDrifts = {
  "restored retired assign": ["function clearHistory() {", "function clearHistory() { runtimeState.sovereigntyByFeatureId = {};"],
  "restored retired delete": ["function clearHistory() {", 'function clearHistory() { delete runtimeState.featureOverrides["restored"];'],
  "new helper writer": ["function uniqueKeys(values) {", "function uniqueKeys(values) { runtimeState.width = 7;"],
  "callback writer": ["const matches = layers.filter(layer => layer?.id === id);", "const matches = layers.filter(layer => { layer.name = 'changed'; return layer?.id === id; });"],
  "historical writer removed": ["  runtimeState.historyPast = [];", "  // historical reset removed"],
  "historical writer duplicated": ["  runtimeState.historyPast = [];", "  runtimeState.historyPast = []; runtimeState.historyPast = [];"],
  "historical call removed": ['  callRuntimeHook(state, "updateHistoryUIFn");', "  // historical hook removed"],
  "old call retargeted": ['  callRuntimeHook(state, "updateHistoryUIFn");', '  callRuntimeHook(state, "unreviewedHook");'],
  "helper ancestry renamed": ["function clearHistory() {", "function clearHistoryRenamed() {"],
  "hook provider reverted": ['from "./state/runtime_hooks.js"', 'from "./state/index.js"'],
  "action provider replaced": ['from "./state/actions/legend_actions.js"', 'from "./unreviewed_legend.js"'],
  "action import aliased": ['import { restoreLegendLabelSnapshotState }', 'import { restoreLegendLabelSnapshotState as otherRestore }'],
  "restore action replaced": ["restoreLegendLabelSnapshotState(runtimeState, snapshot.legendLabels, snapshot.legendLabelKeysPresent)", "unreviewedRestore(runtimeState, snapshot.legendLabels)"],
  "mutable presence publication": ["JSON.stringify(legendKeys.filter(key => Object.hasOwn(runtimeState.legendLabels || {}, key)))", "legendKeys.filter(key => Object.hasOwn(runtimeState.legendLabels || {}, key))"],
  "mutable zone publication": ["JSON.stringify(Object.fromEntries(selected))", "Object.fromEntries(selected)"],
  "scenario scope removed": ["&& scenarioId === runtimeState.activeScenarioId", "&& true"],
  "redo scope removed": ["&& isLegendCsvHistoryScopeCurrent(runtimeState.historyFuture.at(-1))", "&& true"],
  "new external effect": ['    markDirty("legend-history");', '    markDirty("legend-history"); publish(runtimeState);'],
};
for (const [name, [before, after]] of Object.entries(sourceDrifts)) {
  test(`CSV history source refresh refuses ${name}`, () => {
    const changed = replace(source, before, after);
    assert.equal(inspect({ source: changed }), false);
    assert.equal(inspect({ source: changed, readCurrentSource: path => path === MODULE_PATH ? changed : read(path) }), false);
    assert.equal(inspectStateCsvHistorySourceRefreshEvidence({ ...options, source: changed }).receipt, null);
  });
}

test("CSV history source refresh rejects drift or missing text in every action and provider dependency", () => {
  assert.equal(Object.keys(receipt.providerFingerprints).length, 12);
  for (const path of Object.keys(receipt.providerFingerprints)) {
    for (const value of [null, `${read(path)}\n// provider drift`]) {
      const result = inspectStateCsvHistorySourceRefreshEvidence({ ...options, readCurrentSource: requested => requested === path ? value : read(requested) });
      assert.equal(result.matched, false, path);
      assert.equal(result.receipt, null);
    }
  }
  for (const historicalValue of [source, `${previous}\n// changed historical anchor`, previous.replace("runtimeState.historyPast = [];", "runtimeState.historyPast = {};"), null]) {
    assert.equal(inspect({ readHistoricalSource: () => historicalValue }), false);
  }
});

test("CSV history bridge does not refresh frozen retirement identities, source anchors or mutation counts", () => {
  assert.equal(contracts.length, 7);
  assert.ok(contracts.every(entry => entry.currentSourceFingerprint === ANCHOR));
  // Read the actual frozen contract data, not the old policy's incomplete
  // retirement ledger. No historical module code is evaluated or imported.
  const ast = parse(historical(REVISION, "tools/state_action_delegation_contract.mjs"), { ecmaVersion: "latest", sourceType: "module" });
  const declarations = new Map(ast.body.flatMap(node => (node.declaration || node).declarations || []).map(node => [node.id.name, node.init]));
  const valueOf = node => {
    if (node.type === "Literal") return node.value;
    if (node.type === "ArrayExpression") return node.elements.map(valueOf);
    if (node.type === "ObjectExpression") return Object.fromEntries(node.properties.map(property => [property.key.name || property.key.value, valueOf(property.value)]));
    if (node.type === "Identifier" && declarations.has(node.name)) return valueOf(declarations.get(node.name));
    if (node.type === "CallExpression" && node.arguments.length === 1 && node.callee.type === "MemberExpression" && !node.callee.computed) {
      if (node.callee.object.name === "Object" && node.callee.property.name === "freeze") return valueOf(node.arguments[0]);
      if (node.callee.object.name === "JSON" && node.callee.property.name === "stringify") return JSON.stringify(valueOf(node.arguments[0]));
    }
    throw Error(`unexpected historical data expression: ${node.type}`);
  };
  const sourceProofs = valueOf(declarations.get("STATE_CAPABILITY_RETIREMENT_SOURCE_PROOFS"));
  const originalModule = valueOf(declarations.get("retiredCapabilityModules")).find(entry => entry.modulePath === MODULE_PATH);
  const originalEntries = originalModule.memberships.map(([domain, migrationPhase, operation, key, retiredMutationSiteCount, retiredMutationSiteFingerprint]) => ({
    modulePath: MODULE_PATH, bindingIdentity: originalModule.bindingIdentity, domain, migrationPhase, operation, key,
    retiredMutationSiteCount, retiredMutationSiteFingerprint,
    previousSourceRevision: valueOf(declarations.get("RETIRED_DEV_WORKSPACE_SOURCE_REVISION")),
    previousSourceFingerprint: originalModule.previousSourceFingerprint,
    currentSourceFingerprint: originalModule.currentSourceFingerprint,
  })).map(entry => ({ ...entry,
    retiredMembershipIdentity: [MODULE_PATH, entry.bindingIdentity, entry.domain, entry.migrationPhase, entry.operation, entry.key].join("|"),
    contractIdentity: hash(JSON.stringify({ ...entry, sourceProofs })),
  })).concat(valueOf(declarations.get("additionalRetiredAuthorityEntries")).filter(entry => entry.modulePath === MODULE_PATH)
    .map(entry => ({ ...entry, contractIdentity: hash(JSON.stringify({ ...entry, sourceProofs })) })));
  assert.equal(originalEntries.length, 7);
  assert.deepEqual(contracts, originalEntries);
});

test("CSV history refresh integrates with the real scoped retirement validator without granting authority", () => {
  assert.equal(matchesStateCapabilityRetirementSource(options), true);
  assert.deepEqual(validate(), []);
  const withoutHistory = previousPolicy();
  withoutHistory.writers = withoutHistory.writers.filter(writer => writer.path !== MODULE_PATH);
  if (withoutHistory.progress?.callerToActionLedger?.entries) withoutHistory.progress.callerToActionLedger.entries =
    withoutHistory.progress.callerToActionLedger.entries.filter(entry => !entry.retiredMembershipIdentity?.startsWith(`${MODULE_PATH}|`));
  assert.ok(validate({ previousPolicy: withoutHistory }).some(item => item.reason === "historical-membership-drift"));
  const countChanged = { ...contracts[0], retiredMutationSiteCount: contracts[0].retiredMutationSiteCount + 1 };
  assert.ok(validate({ contractEntries: [countChanged] }).some(item => item.reason === "historical-membership-drift"));
  const entry = contracts[0];
  assert.ok(validate({ contractEntries: [entry], currentWriters: [{ path: MODULE_PATH, bindings: [{ grants: [{ domain: entry.domain,
    migrationPhase: entry.migrationPhase, memberships: [{ operation: entry.operation, key: entry.key }] }] }] }] })
    .some(item => item.reason === "current-membership-still-present" && item.identity === entry.retiredMembershipIdentity));
});

test("CSV history scoped retirement validation rejects restoration of every retired membership", () => {
  for (const entry of contracts) {
    const statement = entry.operation === "delete" ? `delete runtimeState.${entry.key}.restored;` : `runtimeState.${entry.key} = {};`;
    const changed = `${source}\n${statement}\n`;
    assert.equal(inspect({ source: changed }), false);
    assert.ok(validate({ contractEntries: [entry], readCurrentSource: path => path === MODULE_PATH ? changed : read(path) })
      .some(item => item.reason === "current-source-drift" && item.identity === entry.retiredMembershipIdentity));
  }
});
