import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { parse } from "acorn";
import { discoverStateWriterBindingsForSource, inspectStateCapabilityRetirementEvidence, buildCallerToActionLedger, buildStateWriterBindingGrants } from "../tools/build_state_writer_policy.mjs";
import { STATE_TARGET_PURE_READER_CONTRACT, STATE_TARGET_EFFECTFUL_DELEGATOR_CONTRACT, STATE_CAPABILITY_RETIREMENT_CONTRACT, inspectStateTargetPureReaderFunctionSource } from "../tools/state_action_delegation_contract.mjs";
import { validateStateWriterPolicySchema, buildCanonicalStateKeyAuthorityIndex } from "../tools/state_writer_policy.mjs";
import * as contracts from "../tools/state_action_delegation_contract.mjs";
import * as borrowed from "../tools/state_borrowed_effect_contract.mjs";

const entry = STATE_TARGET_PURE_READER_CONTRACT.find(item => item.functionName === "createPoliticalFeaturePolicy");
const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const source = read(entry.modulePath);
const inspect = (value, contract = entry, readSource = read) => inspectStateTargetPureReaderFunctionSource(value, contract, { readSource });
function refreshed(value) {
  const node = parse(value, { ecmaVersion: "latest", sourceType: "module" }).body.find(item => item.declaration?.id?.name === entry.functionName).declaration;
  return { ...entry, sourceFingerprint: createHash("sha256").update(value.slice(node.start, node.end)).digest("hex") };
}

test("all registered target reader and effectful delegator modules retain their complete current proofs", async t => {
  const failures = [];
  for (const contract of STATE_TARGET_PURE_READER_CONTRACT) {
    try {
      const violations = inspectStateTargetPureReaderFunctionSource(read(contract.modulePath), contract).violations;
      if (violations.length) failures.push({ stage: "reader-source", modulePath: contract.modulePath, functionName: contract.functionName, violations });
    } catch (error) { failures.push({ stage: "reader-source", modulePath: contract.modulePath, error: error.message }); }
  }
  for (const contract of STATE_TARGET_EFFECTFUL_DELEGATOR_CONTRACT) {
    const actual = createHash("sha256").update(read(contract.modulePath)).digest("hex");
    if (actual !== contract.sourceFingerprint) failures.push({ stage: "effectful-source", modulePath: contract.modulePath, expected: contract.sourceFingerprint, actual });
  }
  const modules = [...new Set([...STATE_TARGET_PURE_READER_CONTRACT, ...STATE_TARGET_EFFECTFUL_DELEGATOR_CONTRACT].map(contract => contract.modulePath))];
  assert.ok(!modules.includes("js/core/map_renderer.js"), "registered target checks must stay bounded to their modules");
  for (const modulePath of modules) {
    try {
      await discoverStateWriterBindingsForSource(modulePath, read(modulePath), "production", { scanAllParameters: true, includeInventories: true });
    } catch (error) { failures.push({ stage: "module-discovery", modulePath, error: error.message, violations: error.violations }); }
  }
  t.diagnostic(`Checked ${STATE_TARGET_PURE_READER_CONTRACT.length} reader entries in ${new Set(STATE_TARGET_PURE_READER_CONTRACT.map(item => item.modulePath)).size} modules, ${STATE_TARGET_EFFECTFUL_DELEGATOR_CONTRACT.length} effectful entries, ${modules.length} unique module discoveries.`);
  assert.deepEqual(failures, []);
});

test("all capability retirements prove historical authority and reject restored source", t => {
  const entries = STATE_CAPABILITY_RETIREMENT_CONTRACT;
  const historicalCache = new Map();
  const historical = (revision, path) => {
    const key = `${revision}:${path}`;
    if (!historicalCache.has(key)) historicalCache.set(key, execFileSync("git", ["show", key], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
    return historicalCache.get(key);
  };
  const previousPolicy = JSON.parse(historical(entries[0].previousSourceRevision, "tools/state_writer_policy.json"));
  assert.deepEqual(inspectStateCapabilityRetirementEvidence({ previousPolicy, readHistoricalSource: historical }), []);
  const failures = [];
  for (const receipt of entries) {
    let restoredSource = historical(receipt.previousSourceRevision, receipt.modulePath);
    // Historical-stale receipts can deliberately pin identical old/current code:
    // there was no live writer to restore. Inject that claimed write instead.
    if (createHash("sha256").update(restoredSource.replace(/\r\n?/g, "\n")).digest("hex") === receipt.currentSourceFingerprint) {
      restoredSource += `\nruntimeState[${JSON.stringify(receipt.key)}] = null;\n`;
    }
    const violations = inspectStateCapabilityRetirementEvidence({
      previousPolicy, contractEntries: [receipt], readHistoricalSource: historical,
      readCurrentSource: path => path === receipt.modulePath ? restoredSource : read(path),
    });
    if (!violations.some(item => item.reason === "current-source-drift" && item.identity === receipt.retiredMembershipIdentity)) failures.push(receipt.retiredMembershipIdentity);
  }
  assert.deepEqual(failures, []);
  t.diagnostic(`Verified all ${entries.length} retirement receipts and ${entries.length} restored-source or injected-write rejections; historical pins and read permissions are unchanged.`);
});

test("all remaining declared source-proof families pass without repository mutation discovery", t => {
  const failures = [], counts = {};
  const check = (family, entries, inspect) => {
    counts[family] = entries.length;
    for (const receipt of entries) {
      try {
        const result = inspect(receipt);
        const violations = Array.isArray(result) ? result : result.violations;
        if (violations.length) failures.push({ family, modulePath: receipt.modulePath || receipt.factoryModulePath, violations });
      } catch (error) { failures.push({ family, modulePath: receipt.modulePath || receipt.factoryModulePath, error: error.message }); }
    }
  };
  check("normalizers", contracts.STATE_IMPORTED_PURE_NORMALIZER_CONTRACT, e => contracts.inspectStateImportedPureNormalizerSource(read(e.modulePath), e));
  check("projections", contracts.STATE_IMPORTED_BORROWED_PROJECTION_CONTRACT, e => contracts.inspectStateImportedBorrowedProjectionSource(read(e.modulePath), e));
  check("captures", contracts.STATE_DETACHED_CAPTURE_CONTRACT, e => contracts.inspectStateDetachedCaptureSource(read(e.modulePath), e));
  check("owners", contracts.STATE_MUTATION_DELEGATING_OWNER_CONTRACT, entry => contracts.inspectStateMutationDelegatingOwnerSources({ entry, compositionSource: read(entry.compositionModulePath), factorySource: read(entry.factoryModulePath) }));
  check("borrowedEffects", borrowed.STATE_BORROWED_EFFECT_CONTRACT, e => borrowed.inspectStateBorrowedEffectSource(read(e.modulePath), e));
  check("borrowedCallbacks", borrowed.STATE_BORROWED_CALLBACK_INJECTION_CONTRACT, e => borrowed.inspectStateBorrowedCallbackInjectionSources(e));
  check("borrowedRuntime", borrowed.STATE_BORROWED_RUNTIME_CONTRACT, e => borrowed.inspectStateBorrowedRuntimeSources(e));
  check("borrowedOwners", borrowed.STATE_BORROWED_OWNER_EFFECT_CONTRACT, e => borrowed.inspectStateBorrowedOwnerEffectSources(e));
  check("borrowedOperations", borrowed.STATE_BORROWED_SCOPED_OPERATION_CONTRACT, e => borrowed.inspectStateBorrowedScopedOperationSources(e));
  check("actionModules", [...new Set(contracts.STATE_ACTION_DELEGATION_CONTRACT.map(e => e.modulePath))].map(modulePath => ({ modulePath })), e => contracts.validateStateActionModuleSource(read(e.modulePath), { filePath: e.modulePath }));
  check("importedActionCalls", Object.values(contracts.STATE_ACTION_IMPORTED_CALL_RECEIPTS), e => contracts.inspectStateActionImportedCallReceipt(e));
  check("crossFileContract", [{}], () => contracts.validateStateActionCrossFileMigrationContract());
  check("successorContract", [{}], () => contracts.validateStateActionSuccessorProofContract());
  check("replacementContract", [{}], () => contracts.validateStateActionLegacyMembershipReplacementContract());
  t.diagnostic(JSON.stringify(counts));
  assert.deepEqual(failures, []);
});

test("political private draw cache passes exact proof and isolated writer discovery", async () => {
  assert.deepEqual(inspect(source).violations, []);
  assert.deepEqual(inspect(source.replaceAll("\n", "\r\n")).violations, []);
  await assert.doesNotReject(discoverStateWriterBindingsForSource(entry.modulePath, source, "production", { scanAllParameters: true, includeInventories: true }));
});

test("private-cache receipt rejects input writes and publication even with refreshed caller hashes", () => {
  const variants = [
    source.replace("const features = runtimeState.landData?.features;", "runtimeState.landData = {}; const features = runtimeState.landData?.features;"),
    source.replace("const id = String(getFeatureId(feature)", "feature.properties.bad = true; const id = String(getFeatureId(feature)"),
    source.replace("const underlay = [];", "const underlay = runtimeState.landData.features;"),
    source.replace("return stableDrawOrderCache;\n  }", "globalThis.cacheLeak = stableDrawOrderCache; return stableDrawOrderCache;\n  }"),
    source.replace("const byFeature = new WeakMap();", "const byFeature = runtimeState.byFeature;"),
  ];
  for (const changed of variants) {
    assert.notEqual(changed, source);
    const result = inspect(changed, refreshed(changed));
    assert.ok(result.violations.some(item => item.code === "state-target-private-cache-proof-drift"));
    assert.ok(!result.violations.some(item => item.code === "state-target-pure-reader-source-drift"));
  }
});

test("private-cache receipt binds actual injected feature reader and transitive source", () => {
  for (const [modulePath, marker, replacement] of [
    ["js/core/map_renderer.js", "return getSharedFeatureId(feature) || null;", "feature.bad = true; return getSharedFeatureId(feature) || null;"],
    ["js/core/map_renderer.js", "function composePoliticalFeaturePolicy() {", "function composePoliticalFeaturePolicy() { getFeatureId = feature => { feature.bad = true; };"],
    ["js/core/feature_identity.js", 'import "./feature_identity_shared.js";', 'import "./unreviewed_identity.js";'],
    ["js/core/feature_identity_shared.js", "function getFeatureId(", "function unreviewedGetFeatureId("],
  ]) {
    assert.ok(read(modulePath).includes(marker), modulePath);
    const result = inspect(source, entry, file => file === modulePath ? read(file).replace(marker, replacement) : read(file));
    assert.ok(result.violations.some(item => item.code === "state-target-private-cache-proof-drift"), modulePath);
  }
});

test("HGO module deletion has exactly four historical receipts and rejects restored source or missing ledger proof", () => {
  const modulePath = "js/core/hgo_runtime_preview.js";
  const contracts = STATE_CAPABILITY_RETIREMENT_CONTRACT.filter(item => item.modulePath === modulePath);
  assert.equal(contracts.length, 4);
  const revision = "a91cb74e170ecd1e4f441420f16bffcb9a931fd9";
  const historical = path => execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const previous = JSON.parse(historical("tools/state_writer_policy.json"));
  const memberships = previous.baselines.legacySemanticAuthority.memberships.filter(item => item.startsWith(`${modulePath}|`));
  assert.deepEqual(contracts.map(item => item.retiredMembershipIdentity).sort(), memberships.sort());
  for (const contract of contracts) {
    assert.equal(contract.previousSourceRevision, revision);
    assert.equal(contract.currentSourceFingerprint, "");
    assert.equal(contract.retiredMutationSiteCount, 1);
    assert.equal(contract.domain, "renderer");
    assert.equal(contract.migrationPhase, "P4.3");
  }
  assert.deepEqual(inspectStateCapabilityRetirementEvidence({ previousPolicy: previous, contractEntries: contracts }).filter(item => item.identity?.startsWith(`${modulePath}|`)), []);
  const restored = inspectStateCapabilityRetirementEvidence({
    previousPolicy: previous, contractEntries: contracts,
    readCurrentSource: path => path === modulePath ? historical(modulePath) : read(path),
  });
  assert.equal(restored.filter(item => item.reason === "current-source-drift" && item.identity?.startsWith(`${modulePath}|`)).length, 4);
  const isolated = { ...previous, progress: { ...previous.progress, retiredLegacySemanticAuthority: { memberships: [] }, callerToActionLedger: { schemaVersion: 3, entries: [] } } };
  const ledger = buildCallerToActionLedger({ phase: "P4.4", previousPolicy: isolated, writers: [], retiredLegacySemanticAuthority: { memberships }, actionDelegations: [] });
  assert.equal(ledger.entries.length, 4);
  for (const proof of ledger.entries) {
    assert.equal(proof.proofPrecision, "explicit-capability-retirement");
    assert.equal(proof.actionModulePath, undefined);
    assert.equal(proof.successorActionProofs, undefined);
  }
  const candidate = { ...isolated, progress: { ...isolated.progress, retiredLegacySemanticAuthority: { memberships }, callerToActionLedger: ledger } };
  const ledgerErrors = value => validateStateWriterPolicySchema(value).filter(item => item.code.startsWith("caller-action-ledger"));
  assert.deepEqual(ledgerErrors(candidate), []);
  for (let index = 0; index < 4; index++) {
    const missing = structuredClone(candidate);
    missing.progress.callerToActionLedger.entries.splice(index, 1);
    assert.ok(ledgerErrors(missing).length > 0, `missing retirement receipt ${index}`);
  }
});


test("urban visibility migration follows the actual surviving callback and rejects a wrong edge", async () => {
  const path = "js/ui/toolbar/appearance_controls_controller.js";
  const contract = contracts.STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT.find(e => e.retiredCallerPath === path && e.key === "showUrban");
  const previous = JSON.parse(read("tools/state_writer_policy.json"));
  const isolated = { ...previous, progress: { ...previous.progress, retiredLegacySemanticAuthority: { memberships: previous.progress.retiredLegacySemanticAuthority.memberships.filter(i => i.startsWith(path + "|") && i.endsWith("|showUrban")) }, callerToActionLedger: { schemaVersion: 3, entries: previous.progress.callerToActionLedger.entries.filter(e => e.callerPath === path && e.key === "showUrban") } } };
  const discovery = await discoverStateWriterBindingsForSource(path, read(path), "production", { scanAllParameters: true, includeInventories: true });
  const edges = discovery.bindingInventories.flatMap(i => i.actionDelegations);
  for (const actionPath of ["js/core/state/actions/appearance_visibility_actions.js", "js/core/state/actions/ui_visibility_actions.js"]) {
    const found = await discoverStateWriterBindingsForSource(actionPath, read(actionPath), "production", { scanAllParameters: true, includeInventories: true });
    edges.push(...found.bindingInventories.flatMap(i => i.actionDelegations));
    const writer = previous.writers.find(w => w.path === actionPath);
    writer.bindings = found.bindingInventories.map(i => ({ ...i.binding, authority: "domain-action", grants: buildStateWriterBindingGrants(i.findings, actionPath, buildCanonicalStateKeyAuthorityIndex(), "production") }));
  }
  const membership = [path, contract.retiredCallerBindingIdentity, contract.domain, contract.migrationPhase, contract.operation, contract.key].join("|");
  const args = { phase: "P4.4", previousPolicy: isolated, writers: previous.writers, retiredLegacySemanticAuthority: { memberships: [membership] }, actionDelegations: edges };
  let result;
  try { result = buildCallerToActionLedger(args); } catch (error) { assert.fail(JSON.stringify(error.violations)); }
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].key, "showUrban");
  const wrongEdges = edges.map(e => e.sourceFingerprint === contract.replacementActionSourceFingerprint ? { ...e, enclosingFunctionIdentity: e.enclosingFunctionIdentity.replace('"ordinal":6', '"ordinal":5') } : e);
  assert.throws(() => buildCallerToActionLedger({ ...args, actionDelegations: wrongEdges }), /proof generation failed/);
});
