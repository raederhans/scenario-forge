import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "acorn";

import {
  discoverGlobalStateImportBindings,
  validateDomainActionSourceBoundary,
  validateStateWriterPolicySchema,
  buildCanonicalStateKeyAuthorityIndex,
  validateStateWriterPolicySnapshot,
} from "../tools/state_writer_policy.mjs";
import {
  buildLegacyStateWriterSemanticAuthority,
  buildCallerToActionLedger,
  buildStateWriterBindingGrants,
  discoverStateWriterBindingsForSource,
  normalizeStateActionDelegations,
  subtractLegacyStateWriterSemanticAuthority,
} from "../tools/build_state_writer_policy.mjs";
import {
  scanStateMutations,
} from "../tools/state_writer_inventory.mjs";
import * as policyChecker from "../tools/check_state_writer_policy.mjs";
import {
  STATE_ACTION_SUCCESSOR_CARRIER_SOURCE_REFRESHES,
  findStateActionSuccessorProofContractEntry,
  isStateActionSuccessorCarrierSourceRefresh,
  validateStateActionModuleSource,
} from "../tools/state_action_delegation_contract.mjs";

function createLegacyWriter() {
  return {
    path: "js/fixture.js",
    surface: "production",
    domain: "boot",
    authority: "legacy-direct",
    migrationPhase: "P4.1",
    bindings: [{
      id: "runtime-state",
      kind: "module",
      name: "state",
      authority: "legacy-direct",
      grants: [{
        domain: "boot",
        migrationPhase: "P4.1",
        operations: ["assign"],
        keys: ["bootPhase"],
        memberships: [{
          operation: "assign",
          key: "bootPhase",
        }],
        aliasSites: [],
        dynamicSites: [],
        ambiguousSites: [],
        unsupportedSites: [],
      }],
    }],
  };
}

function createPolicy(writers, frozenAuthority, retiredAuthority) {
  return {
    schemaVersion: 1,
    baseline: {
      phase: "P4.0",
      sourceBaseSha: "1".repeat(40),
      generatedAt: "2026-07-19T00:00:00.000Z",
    },
    baselines: {
      legacySemanticAuthority: frozenAuthority,
    },
    writers,
    progress: {
      latestPhase: "P4.1",
      checkpoints: [],
      retiredLegacySemanticAuthority: retiredAuthority,
    },
  };
}

function createProgressPolicy() {
  const emptyAuthority = buildLegacyStateWriterSemanticAuthority([]);
  return {
    schemaVersion: 1,
    baseline: {
      phase: "P4.0",
      sourceBaseSha: "1".repeat(40),
      generatedAt: "2026-07-19T00:00:00.000Z",
    },
    baselines: {
      legacyDirectFiles: {
        production: 75,
        test: 43,
        total: 118,
      },
      bindingScopedMemberships: {
        production: {
          legacyCombined: 1187,
        },
      },
      bindingScopedSites: {
        dynamic: {
          production: {
            legacyCombined: 142,
          },
        },
        alias: {
          production: {
            legacyCombined: 227,
          },
        },
        ambiguous: {
          production: {
            legacyCombined: 901,
          },
        },
        unsupported: {
          production: {
            legacyCombined: 6692,
          },
        },
      },
      legacySemanticAuthority: emptyAuthority,
    },
    writers: [],
    progress: {
      latestPhase: "P4.1",
      checkpoints: [
        {
          phase: "P4.0",
          productionLegacyDirectFiles: 75,
          productionLegacyMemberships: 1187,
          productionLegacyDynamicSites: 142,
          productionLegacyAliasSites: 227,
          productionLegacyAmbiguousSites: 901,
          productionLegacyUnsupportedSites: 6692,
        },
        {
          phase: "P4.1",
          productionLegacyDirectFiles: 70,
          productionLegacyMemberships: 1100,
          productionLegacyDynamicSites: 130,
          productionLegacyAliasSites: 210,
          productionLegacyAmbiguousSites: 850,
          productionLegacyUnsupportedSites: 6500,
        },
      ],
      retiredLegacySemanticAuthority:
        subtractLegacyStateWriterSemanticAuthority(
          emptyAuthority,
          emptyAuthority,
        ),
    },
  };
}

function createCallerActionBackfillEntry({
  index,
  callerPath,
  callerBindingId,
  callerBindingIdentity,
  key,
}) {
  const actionModulePath = "js/core/state/actions/boot_actions.js";
  const actionExportName = "setBootStateFields";
  const targetArgumentIndex = 0;
  const start = 100 + index * 10;
  const end = start + 42;
  const sourceFingerprint = `${(index % 16).toString(16)}`.repeat(64);
  return {
    retiredMembershipIdentity: [
      callerPath,
      callerBindingIdentity,
      "boot",
      "P4.1",
      "assign",
      key,
    ].join("|"),
    callerPath,
    callerBindingId,
    callerBindingIdentity,
    domain: "boot",
    migrationPhase: "P4.1",
    operation: "assign",
    key,
    actionModulePath,
    actionExportName,
    targetArgumentIndex,
    actionCallEdgeIdentity: [
      callerPath,
      callerBindingIdentity,
      actionModulePath,
      actionExportName,
      targetArgumentIndex,
      start,
      end,
      index,
    ].join("|"),
    occurrenceIndex: index,
    start,
    end,
    line: 10 + index,
    column: 3,
    sourceFingerprint,
    retiredInPhase: "P4.1",
    recordedInPhase: "P4.2a",
    backfilled: true,
  };
}

function createP41ToP42aBackfillPolicies({
  ledgerEntryCount = 36,
} = {}) {
  const callerPath = "js/bootstrap/backfill_fixture.js";
  const callerBindingId =
    "function:applyBackfillFixture:0:$/property:targetState";
  const callerBindingIdentity = JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName: "applyBackfillFixture",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "$/property:targetState",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
  const memberships = Array.from({ length: 36 }, (_, index) => ({
    operation: "assign",
    key: `bootFixture${String(index).padStart(2, "0")}`,
  }));
  const previousWriter = {
    path: callerPath,
    surface: "production",
    domain: "boot",
    authority: "legacy-target",
    migrationPhase: "P4.1",
    bindings: [{
      id: callerBindingId,
      kind: "function-parameter",
      name: "targetState",
      functionName: "applyBackfillFixture",
      parameterName: "targetState",
      parameterIndex: 0,
      parameterPath: "$/property:targetState",
      authority: "legacy-target",
      grants: [{
        domain: "boot",
        migrationPhase: "P4.1",
        operations: ["assign"],
        keys: memberships.map(({ key }) => key),
        memberships,
        aliasSites: [],
        dynamicSites: [],
        ambiguousSites: [],
        unsupportedSites: [],
      }],
    }],
  };
  const actionWriter = structuredClone(previousWriter);
  actionWriter.path = "js/core/state/actions/boot_actions.js";
  actionWriter.authority = "domain-action";
  actionWriter.bindings[0].id = "function:setBootStateFields:0:$";
  actionWriter.bindings[0].functionName = "setBootStateFields";
  actionWriter.bindings[0].parameterPath = "$";
  actionWriter.bindings[0].authority = "domain-action";
  const frozenAuthority = buildLegacyStateWriterSemanticAuthority([
    previousWriter,
  ]);
  const emptyAuthority = buildLegacyStateWriterSemanticAuthority([]);
  const retiredAuthority = subtractLegacyStateWriterSemanticAuthority(
    frozenAuthority,
    emptyAuthority,
  );
  const baselineMetrics = {
    phase: "P4.0",
    productionLegacyDirectFiles: 1,
    productionLegacyMemberships: 36,
    productionLegacyDynamicSites: 0,
    productionLegacyAliasSites: 0,
    productionLegacyAmbiguousSites: 0,
    productionLegacyUnsupportedSites: 0,
  };
  const common = {
    schemaVersion: 1,
    baseline: {
      phase: "P4.0",
      sourceBaseSha: "1".repeat(40),
      generatedAt: "2026-07-19T00:00:00.000Z",
    },
    baselines: {
      legacyDirectFiles: {
        production: 1,
        test: 0,
        total: 1,
      },
      bindingScopedMemberships: {
        production: {
          legacyCombined: 36,
        },
      },
      bindingScopedSites: {
        dynamic: { production: { legacyCombined: 0 } },
        alias: { production: { legacyCombined: 0 } },
        ambiguous: { production: { legacyCombined: 0 } },
        unsupported: { production: { legacyCombined: 0 } },
      },
      legacySemanticAuthority: frozenAuthority,
    },
  };
  const previousPolicy = {
    ...structuredClone(common),
    writers: [structuredClone(actionWriter)],
    progress: {
      latestPhase: "P4.1",
      checkpoints: [baselineMetrics],
      retiredLegacySemanticAuthority:
        structuredClone(retiredAuthority),
    },
  };
  const entries = memberships
    .map(({ key }, index) =>
      createCallerActionBackfillEntry({
        index,
        callerPath,
        callerBindingId,
        callerBindingIdentity,
        key,
      })
    )
    .sort((left, right) =>
      left.retiredMembershipIdentity.localeCompare(
        right.retiredMembershipIdentity,
      )
      || left.actionCallEdgeIdentity.localeCompare(
        right.actionCallEdgeIdentity,
      )
    )
    .slice(0, ledgerEntryCount);
  const currentPolicy = {
    ...structuredClone(common),
    writers: [actionWriter],
    progress: {
      latestPhase: "P4.2a",
      checkpoints: [baselineMetrics],
      retiredLegacySemanticAuthority: retiredAuthority,
      callerToActionLedger: {
        schemaVersion: 1,
        entries,
      },
    },
  };
  return {
    previousPolicy,
    currentPolicy,
  };
}

test("production binding discovery rejects non-named access to the canonical state facade", () => {
  for (const { source, filePath } of [
    {
      source: `import * as stateModule from "./core/state.js";
       stateModule.state.bootPhase = "ready";`,
      filePath: "js/main.js",
    },
    {
      source: `const stateModule = await import("./core/state.js");
       stateModule.state.bootPhase = "ready";`,
      filePath: "js/main.js",
    },
    {
      source: `export { state as runtimeState } from "./core/state.js";`,
      filePath: "js/main.js",
    },
    {
      source: `import { state as sharedState } from "./core/state.js";
       export { sharedState as state };`,
      filePath: "js/bridge.js",
    },
    {
      source: `import { state as runtimeState } from "/js/core/state.js";
       runtimeState.bootPhase = "ready";`,
      filePath: "js/main.js",
    },
    {
      source: `import { state as runtimeState } from "https://example.test/scenario-forge/js/core/state.js";
       runtimeState.bootPhase = "ready";`,
      filePath: "js/main.js",
    },
  ]) {
    assert.throws(
      () => discoverGlobalStateImportBindings(source, { filePath }),
      (error) =>
        error?.code === "unsupported-global-state-facade-access"
        && Array.isArray(error.references)
        && error.references.length === 1,
    );
  }
});

test("domain action boundary rejects state imports routed through a local bridge", () => {
  const violations = validateDomainActionSourceBoundary(
    `import { state as runtimeState } from "../../../bridge.js";
     runtimeState.bootPhase = "ready";`,
    {
      filePath: "js/core/state/actions/boot_actions.js",
    },
  );

  assert.ok(
    violations.some(
      ({ code, importedName }) =>
        code === "domain-action-state-shaped-import"
        && importedName === "state",
    ),
    JSON.stringify(violations, null, 2),
  );
});

test("canonical state aliases cannot escape through module export surfaces", async () => {
  for (const source of [
    `import { state as s } from "./core/state.js";
     const bridge = s;
     export { bridge as state };`,
    `import { state as s } from "./core/state.js";
     export default s;`,
    `import { state as s } from "./core/state.js";
     const bridge = s;
     export default bridge;`,
    `import { state as s } from "./core/state.js";
     export function getState() { return s; }`,
  ]) {
    const bindings = await discoverStateWriterBindingsForSource(
      "js/bridge.js",
      source,
      "production",
    );
    const findings = scanStateMutations(source, {
      filePath: "js/bridge.js",
      bindings,
    });
    assert.ok(
      findings.some(
        ({ reason, unsupported }) =>
          reason === "state-alias-escape"
          && unsupported === true,
      ),
      JSON.stringify({ source, bindings, findings }, null, 2),
    );
  }
});

test("production binding discovery ignores same-named noncanonical state modules", () => {
  for (const { source, filePath } of [
    {
      source: `import { state as localState } from "./state.js";`,
      filePath: "js/feature/widget.js",
    },
    {
      source: `import { state as packageState } from "some-package/state.js";`,
      filePath: "js/main.js",
    },
    {
      source: `import { state as absoluteState } from "/vendor/state.js";`,
      filePath: "js/main.js",
    },
    {
      source: `import { state as nestedState } from "./core/state/index.js";`,
      filePath: "js/main.js",
    },
    {
      source: `import { state as contextFreeSibling } from "./state.js";`,
      filePath: "",
    },
    {
      source: `import { state as contextFreePackage } from "some-package/state.js";`,
      filePath: "",
    },
  ]) {
    assert.deepEqual(
      discoverGlobalStateImportBindings(source, { filePath }),
      [],
      `${filePath || "<context-free>"}: ${source}`,
    );
  }
});

test("production binding discovery accepts only the canonical state facade path", () => {
  assert.deepEqual(
    discoverGlobalStateImportBindings(
      `import { state as runtimeState } from "./core/state.js";`,
      { filePath: "js/main.js" },
    ),
    [{
      importSource: "./core/state.js",
      importedName: "state",
      localName: "runtimeState",
    }],
  );
  assert.deepEqual(
    discoverGlobalStateImportBindings(
      `import { state as runtimeState } from "./core/state.js";`,
    ),
    [{
      importSource: "./core/state.js",
      importedName: "state",
      localName: "runtimeState",
    }],
  );
});

test("policy snapshot rejects observed exact-site occurrences beyond the frozen grant multiplicity", () => {
  const sourceFingerprint = "a".repeat(64);
  const writer = createLegacyWriter();
  writer.bindings[0].grants[0].aliasSites = [{
    alias: "runtimeAlias",
    aliasChain: ["state", "runtimeAlias"],
    operation: "assign",
    key: "bootPhase",
    line: 2,
    column: 3,
    sourceFingerprint,
  }];
  const finding = {
    filePath: writer.path,
    bindingId: "runtime-state",
    operation: "assign",
    key: "bootPhase",
    dynamic: false,
    alias: "runtimeAlias",
    aliasChain: ["state", "runtimeAlias"],
    line: 2,
    column: 3,
    sourceFingerprint,
  };
  const result = validateStateWriterPolicySnapshot({
    policy: {
      schemaVersion: 1,
      baseline: { phase: "P4.0" },
      writers: [writer],
    },
    legacyAllowlistPaths: [writer.path],
    scans: [{
      path: writer.path,
      surface: "production",
      bindingId: "runtime-state",
      findings: [
        finding,
        {
          ...finding,
          line: 20,
          column: 5,
        },
      ],
    }],
  });

  assert.ok(
    result.violations.some(
      ({ code, siteKind }) =>
        code === "observed-site-occurrence-overflow"
        && siteKind === "alias",
    ),
    JSON.stringify(result.violations, null, 2),
  );
});

test("policy snapshot counts one physical source site once across duplicate scanner findings", () => {
  const sourceFingerprint = "b".repeat(64);
  const writer = createLegacyWriter();
  writer.bindings[0].grants[0].aliasSites = [{
    alias: "runtimeAlias",
    aliasChain: ["state", "runtimeAlias"],
    operation: "assign",
    key: "bootPhase",
    line: 2,
    column: 3,
    sourceFingerprint,
  }];
  const finding = {
    filePath: writer.path,
    bindingId: "runtime-state",
    operation: "assign",
    key: "bootPhase",
    dynamic: false,
    alias: "runtimeAlias",
    aliasChain: ["state", "runtimeAlias"],
    line: 2,
    column: 3,
    sourceFingerprint,
  };
  const result = validateStateWriterPolicySnapshot({
    policy: {
      schemaVersion: 1,
      baseline: { phase: "P4.0" },
      writers: [writer],
    },
    legacyAllowlistPaths: [writer.path],
    scans: [{
      path: writer.path,
      surface: "production",
      bindingId: "runtime-state",
      findings: [finding, { ...finding }],
    }],
  });

  assert.ok(
    !result.violations.some(
      ({ code }) => code === "observed-site-occurrence-overflow",
    ),
    JSON.stringify(result.violations, null, 2),
  );
});

test("checker transition rejects legacy retirement without a domain action replacement", () => {
  assert.equal(
    typeof policyChecker.validateStateWriterPolicyTransition,
    "function",
  );
  const previousWriters = [createLegacyWriter()];
  const frozenAuthority = buildLegacyStateWriterSemanticAuthority(
    previousWriters,
  );
  const previousPolicy = createPolicy(
    previousWriters,
    frozenAuthority,
    subtractLegacyStateWriterSemanticAuthority(
      frozenAuthority,
      frozenAuthority,
    ),
  );
  const currentPolicy = createPolicy(
    [],
    frozenAuthority,
    subtractLegacyStateWriterSemanticAuthority(
      frozenAuthority,
      buildLegacyStateWriterSemanticAuthority([]),
    ),
  );

  const violations = policyChecker.validateStateWriterPolicyTransition({
    previousPolicy,
    currentPolicy,
  });

  assert.ok(
    violations.some(
      ({ code, key }) =>
        code === "legacy-membership-retirement-replacement-missing"
        && key === "bootPhase",
    ),
    JSON.stringify(violations, null, 2),
  );
});

test("checker transition rejects reintroduced retired legacy authority", () => {
  assert.equal(
    typeof policyChecker.validateStateWriterPolicyTransition,
    "function",
  );
  const currentWriters = [createLegacyWriter()];
  const frozenAuthority = buildLegacyStateWriterSemanticAuthority(
    currentWriters,
  );
  const emptyAuthority = buildLegacyStateWriterSemanticAuthority([]);
  const previousPolicy = createPolicy(
    [],
    frozenAuthority,
    subtractLegacyStateWriterSemanticAuthority(
      frozenAuthority,
      emptyAuthority,
    ),
  );
  const currentPolicy = createPolicy(
    currentWriters,
    frozenAuthority,
    subtractLegacyStateWriterSemanticAuthority(
      frozenAuthority,
      frozenAuthority,
    ),
  );

  const violations = policyChecker.validateStateWriterPolicyTransition({
    previousPolicy,
    currentPolicy,
  });
  const codes = violations.map(({ code }) => code);

  assert.ok(codes.includes("legacy-semantic-authority-added"), codes.join(", "));
  assert.ok(codes.includes("legacy-semantic-retirement-regressed"), codes.join(", "));
});

test("checker transition freezes the P4 baseline identity and metrics", () => {
  const writers = [createLegacyWriter()];
  const frozenAuthority = buildLegacyStateWriterSemanticAuthority(writers);
  const retiredAuthority = subtractLegacyStateWriterSemanticAuthority(
    frozenAuthority,
    frozenAuthority,
  );
  const previousPolicy = createPolicy(
    writers,
    frozenAuthority,
    retiredAuthority,
  );
  const currentPolicy = structuredClone(previousPolicy);
  currentPolicy.baseline.sourceBaseSha = "2".repeat(40);
  currentPolicy.baselines.closeoutTargets = {
    productionLegacyDirectFiles: 999,
  };

  const codes = policyChecker.validateStateWriterPolicyTransition({
    previousPolicy,
    currentPolicy,
  }).map(({ code }) => code);

  assert.ok(codes.includes("policy-baseline-drift"), codes.join(", "));
  assert.ok(codes.includes("policy-baselines-drift"), codes.join(", "));
});

test("P4.0 progress checkpoint must match the frozen baseline metrics", () => {
  assert.equal(
    typeof policyChecker.validateFrozenP4ProgressCheckpoint,
    "function",
  );
  const policy = createProgressPolicy();
  policy.progress.checkpoints[0].productionLegacyDirectFiles += 10;
  policy.progress.checkpoints[0].productionLegacyMemberships += 10;

  const codes = policyChecker.validateFrozenP4ProgressCheckpoint(policy)
    .map(({ code }) => code);

  assert.ok(
    codes.includes("p4-baseline-progress-checkpoint-drift"),
    codes.join(", "),
  );
});

test("checker transition freezes every previously committed progress checkpoint", () => {
  const previousPolicy = createProgressPolicy();
  const currentPolicy = structuredClone(previousPolicy);
  currentPolicy.progress.checkpoints[0].productionLegacyDirectFiles += 10;
  currentPolicy.progress.checkpoints[0].productionLegacyMemberships += 10;

  const codes = policyChecker.validateStateWriterPolicyTransition({
    previousPolicy,
    currentPolicy,
  }).map(({ code }) => code);

  assert.ok(
    codes.includes("progress-checkpoint-history-drift"),
    codes.join(", "),
  );
  assert.ok(
    codes.includes("p4-baseline-progress-checkpoint-drift"),
    codes.join(", "),
  );
});

test("checker transition preserves caller-to-action ledger history append-only", () => {
  const backfill = createP41ToP42aBackfillPolicies();
  const previousPolicy = structuredClone(backfill.currentPolicy);
  const removed = structuredClone(previousPolicy);
  removed.progress.latestPhase = "P4.2b";
  removed.progress.callerToActionLedger.entries.pop();
  const modified = structuredClone(previousPolicy);
  modified.progress.latestPhase = "P4.2b";
  modified.progress.callerToActionLedger.entries[0].recordedInPhase = "P4.2b";

  const missingCodes = policyChecker.validateStateWriterPolicyTransition({
    previousPolicy,
    currentPolicy: removed,
  }).map(({ code }) => code);
  assert.ok(
    missingCodes.includes("caller-action-ledger-history-missing"),
    missingCodes.join(", "),
  );

  const driftCodes = policyChecker.validateStateWriterPolicyTransition({
    previousPolicy,
    currentPolicy: modified,
  }).map(({ code }) => code);
  assert.ok(
    driftCodes.includes("caller-action-ledger-history-drift"),
    driftCodes.join(", "),
  );
});

test("checker transition permits same-phase caller observation coordinate refresh", () => {
  const backfill = createP41ToP42aBackfillPolicies();
  const previousPolicy = structuredClone(backfill.currentPolicy);
  const currentPolicy = structuredClone(previousPolicy);
  Object.assign(currentPolicy.progress.callerToActionLedger.entries[0], {
    callerBindingId: "module:runtimeState:shifted",
    start: 900,
    end: 940,
    line: 90,
    column: 7,
    sourceFingerprint: "e".repeat(64),
  });

  const callerActionViolations =
    policyChecker.validateStateWriterPolicyTransition({
      previousPolicy,
      currentPolicy,
    }).filter(({ code }) => String(code).startsWith("caller-action-ledger-"));

  assert.deepEqual(callerActionViolations, []);
});

test("checker transition permits cross-phase live successor refresh and freezes retirement provenance", () => {
  const backfill = createP41ToP42aBackfillPolicies();
  const previousPolicy = structuredClone(backfill.currentPolicy);
  const previousEntry =
    previousPolicy.progress.callerToActionLedger.entries[0];
  Object.assign(previousEntry, {
    enclosingFunctionIdentity: JSON.stringify({
      kind: "function",
      ancestry: [{ name: "applyBackfillFixture", ordinal: 0 }],
    }),
    retiredEnclosingFunctionIdentity: JSON.stringify({
      kind: "function",
      ancestry: [{ name: "applyBackfillFixture", ordinal: 0 }],
    }),
    retiredMutationSiteFingerprint: "a".repeat(64),
    retiredMutationSiteCount: 1,
    proofPrecision: "exact-site",
  });
  const currentPolicy = structuredClone(previousPolicy);
  currentPolicy.progress.latestPhase = "P4.2b";
  Object.assign(
    currentPolicy.progress.callerToActionLedger.entries[0],
    {
      callerBindingId: "module:runtimeState:shifted",
      actionModulePath:
        "js/core/state/actions/scenario_chunk_runtime_actions.js",
      actionExportName: "commitScenarioChunkSelectionState",
      targetArgumentIndex: 1,
      actionCallEdgeIdentity: "f".repeat(64),
      occurrenceIndex: 3,
      start: 900,
      end: 940,
      line: 90,
      column: 7,
      sourceFingerprint: "e".repeat(64),
    },
  );

  assert.deepEqual(
    policyChecker.validateCallerToActionLedgerHistoryTransition({
      previousPolicy,
      currentPolicy,
    }),
    [],
  );

  for (const mutate of [
    (entry) => {
      entry.retiredMutationSiteFingerprint = "b".repeat(64);
    },
    (entry) => {
      entry.recordedInPhase = "P4.2b";
    },
  ]) {
    const tampered = structuredClone(currentPolicy);
    mutate(tampered.progress.callerToActionLedger.entries[0]);
    assert.ok(
      policyChecker.validateCallerToActionLedgerHistoryTransition({
        previousPolicy,
        currentPolicy: tampered,
      }).some(
        ({ code }) => code === "caller-action-ledger-history-drift",
      ),
    );
  }
});

test("checker transition permits same-phase nested function-proof coordinate refresh", () => {
  const backfill = createP41ToP42aBackfillPolicies();
  const previousPolicy = structuredClone(backfill.currentPolicy);
  previousPolicy.progress.latestPhase = "P4.2b";
  previousPolicy.progress.callerToActionLedger.schemaVersion = 2;
  const scalar =
    previousPolicy.progress.callerToActionLedger.entries[0];
  const firstFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "firstCaller", ordinal: 0 }],
  });
  const secondFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "secondCaller", ordinal: 0 }],
  });
  const proofFields = [
    "callerPath",
    "callerBindingId",
    "callerBindingIdentity",
    "actionModulePath",
    "actionExportName",
    "targetArgumentIndex",
    "actionCallEdgeIdentity",
    "occurrenceIndex",
    "start",
    "end",
    "line",
    "column",
    "sourceFingerprint",
  ];
  const firstProof = Object.fromEntries(
    proofFields.map((field) => [field, scalar[field]]),
  );
  Object.assign(firstProof, {
    enclosingFunctionIdentity: firstFunctionIdentity,
    retiredEnclosingFunctionIdentity: firstFunctionIdentity,
    retiredMutationSiteFingerprint: "a".repeat(64),
    retiredMutationSiteCount: 1,
    proofPrecision: "exact-site",
  });
  const secondProof = {
    ...structuredClone(firstProof),
    enclosingFunctionIdentity: secondFunctionIdentity,
    retiredEnclosingFunctionIdentity: secondFunctionIdentity,
    retiredMutationSiteFingerprint: "b".repeat(64),
    actionCallEdgeIdentity: "f".repeat(64),
  };
  const commonFields = [
    "retiredMembershipIdentity",
    "domain",
    "migrationPhase",
    "operation",
    "key",
  ];
  previousPolicy.progress.callerToActionLedger.entries[0] = {
    ...Object.fromEntries(
      commonFields.map((field) => [field, scalar[field]]),
    ),
    retiredCallerPath: scalar.callerPath,
    retiredCallerBindingIdentity: scalar.callerBindingIdentity,
    retiredMutationSiteFingerprint: "c".repeat(64),
    retiredMutationSiteCount: 2,
    retiredMutationFunctionCount: 2,
    proofPrecision: "exact-site-multi-function",
    functionProofs: [firstProof, secondProof],
    retiredInPhase: "P4.2b",
    recordedInPhase: "P4.2b",
    backfilled: false,
  };

  const currentPolicy = structuredClone(previousPolicy);
  Object.assign(
    currentPolicy.progress.callerToActionLedger.entries[0]
      .functionProofs[1],
    {
      callerBindingId: "module:runtimeState:shifted",
      start: 900,
      end: 940,
      line: 90,
      column: 7,
      sourceFingerprint: "e".repeat(64),
    },
  );
  assert.deepEqual(
    policyChecker.validateCallerToActionLedgerHistoryTransition({
      previousPolicy,
      currentPolicy,
    }),
    [],
  );

  const semanticDrift = structuredClone(currentPolicy);
  semanticDrift.progress.callerToActionLedger.entries[0]
    .functionProofs[1].actionExportName =
      "replaceBootMetricsState";
  assert.ok(
    policyChecker.validateCallerToActionLedgerHistoryTransition({
      previousPolicy,
      currentPolicy: semanticDrift,
    }).some(
      ({ code }) => code === "caller-action-ledger-history-drift",
    ),
  );

  const laterCoordinateDrift = structuredClone(previousPolicy);
  laterCoordinateDrift.progress.latestPhase = "P4.2c";
  laterCoordinateDrift.progress.callerToActionLedger.entries[0]
    .functionProofs[1].line += 1;
  assert.deepEqual(
    policyChecker.validateCallerToActionLedgerHistoryTransition({
      previousPolicy,
      currentPolicy: laterCoordinateDrift,
    }),
    [],
  );
});

test("checker transition freezes same-phase caller semantics and permits later live coordinates", () => {
  const backfill = createP41ToP42aBackfillPolicies();
  const previousPolicy = structuredClone(backfill.currentPolicy);
  const semanticDrift = structuredClone(previousPolicy);
  semanticDrift.progress.callerToActionLedger.entries[0].actionExportName =
    "replaceBootMetricsState";
  const laterCoordinateDrift = structuredClone(previousPolicy);
  laterCoordinateDrift.progress.latestPhase = "P4.2b";
  laterCoordinateDrift.progress.callerToActionLedger.entries[0].line += 1;

  const semanticCodes =
    policyChecker.validateStateWriterPolicyTransition({
      previousPolicy,
      currentPolicy: semanticDrift,
    }).map(({ code }) => code);
  assert.ok(
    semanticCodes.includes("caller-action-ledger-history-drift"),
    semanticCodes.join(", "),
  );
  assert.ok(
    !policyChecker.validateStateWriterPolicyTransition({
      previousPolicy,
      currentPolicy: laterCoordinateDrift,
    }).some(
      ({ code }) => code === "caller-action-ledger-history-drift",
    ),
  );
});

test("checker transition permits the complete one-time P4.1 to P4.2a ledger backfill", () => {
  const { previousPolicy, currentPolicy } =
    createP41ToP42aBackfillPolicies();
  const callerActionViolations =
    policyChecker.validateStateWriterPolicyTransition({
      previousPolicy,
      currentPolicy,
    }).filter(({ code }) => String(code).startsWith("caller-action-ledger-"));

  assert.deepEqual(callerActionViolations, []);
});

test("checker transition locks one-time caller-to-action backfill provenance", () => {
  const { previousPolicy, currentPolicy } =
    createP41ToP42aBackfillPolicies();
  const forged = structuredClone(currentPolicy);
  forged.progress.callerToActionLedger.entries[0] = {
    ...forged.progress.callerToActionLedger.entries[0],
    retiredInPhase: "P4.0",
    recordedInPhase: "P4.1",
    backfilled: false,
  };

  const violations = policyChecker.validateStateWriterPolicyTransition({
    previousPolicy,
    currentPolicy: forged,
  });

  assert.ok(
    violations.some(
      ({ code }) =>
        code === "caller-action-ledger-backfill-provenance-invalid",
    ),
    JSON.stringify(violations, null, 2),
  );
});

test("checker transition rejects a 35 of 36 P4.1 to P4.2a ledger backfill", () => {
  const { previousPolicy, currentPolicy } =
    createP41ToP42aBackfillPolicies({
      ledgerEntryCount: 35,
    });
  const violations = policyChecker.validateStateWriterPolicyTransition({
    previousPolicy,
    currentPolicy,
  });

  assert.ok(
    violations.some(
      ({ code }) => code === "caller-action-ledger-backfill-incomplete",
    ),
    JSON.stringify(violations, null, 2),
  );
});

const readRepositorySource = (modulePath) => readFileSync(
  new URL(`../${modulePath}`, import.meta.url), "utf8",
).replace(/\r\n?/g, "\n");
const readHistoricalSource = (revision, modulePath) => execFileSync(
  "git", ["show", `${revision}:${modulePath}`],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
).replace(/\r\n?/g, "\n");
let successorRefreshFixture;
function getSuccessorRefreshFixture() {
  return successorRefreshFixture ||= (async () => {
    // Pin the committed stale ledger, not whatever HEAD later becomes.
    const historical = JSON.parse(readHistoricalSource(
      "abf6a1a6670096459138fcc84cb12fa4ca485f5b",
      "tools/state_writer_policy.json",
    ));
    const entries = historical.progress.callerToActionLedger.entries.filter((entry) =>
      (entry.successorActionProofs?.length && STATE_ACTION_SUCCESSOR_CARRIER_SOURCE_REFRESHES.some((receipt) =>
        receipt.modulePath === entry.actionModulePath
        && receipt.exportName === entry.actionExportName
      )) || (entry.callerPath === "js/core/map_renderer/map_hover_interaction_owner.js"
        && entry.actionExportName === "setHoveredFeatureIdsState")
      || (entry.callerPath === "js/ui/toolbar/appearance_controls_controller.js"
        && entry.key === "showUrban")
    );
    // hoveredId shares the same stale first call as the two hover successors.
    assert.equal(entries.length, 14);
    const current = JSON.parse(readRepositorySource("tools/state_writer_policy.json"));
    const previousPolicy = {
      ...current,
      progress: {
        ...current.progress,
        retiredLegacySemanticAuthority: {
          memberships: entries.map((entry) => entry.retiredMembershipIdentity),
        },
        callerToActionLedger: { schemaVersion: 3, entries },
      },
    };
    const paths = new Set(entries.flatMap((entry) => [
      entry.callerPath, entry.actionModulePath,
      ...(entry.successorActionProofs || []).map((proof) => proof.actionModulePath),
    ]));
    const writers = structuredClone(current.writers);
    const actionDelegations = [];
    for (const modulePath of paths) {
      const source = readRepositorySource(modulePath);
      const isAction = modulePath.includes("/state/actions/");
      if (isAction) assert.deepEqual(validateStateActionModuleSource(source, { filePath: modulePath }), []);
      const discovery = await discoverStateWriterBindingsForSource(
        modulePath, source, "production", { scanAllParameters: true, includeInventories: true },
      );
      actionDelegations.push(...discovery.bindingInventories.flatMap((item) => item.actionDelegations));
      if (isAction) {
        writers.find((writer) => writer.path === modulePath).bindings = discovery.bindingInventories.map((item) => ({
          ...item.binding,
          authority: "domain-action",
          grants: buildStateWriterBindingGrants(item.findings, modulePath, buildCanonicalStateKeyAuthorityIndex(), "production"),
        }));
      }
    }
    return {
      current, previousPolicy, writers, actionDelegations,
      phase: current.progress.latestPhase,
      retiredLegacySemanticAuthority: previousPolicy.progress.retiredLegacySemanticAuthority,
    };
  })();
}

test("successor carrier refresh receipts pin actual historical and current function sources", () => {
  const fingerprint = (source, functionName) => {
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const node = ast.body.map((item) => item.declaration || item).find((item) => item.id?.name === functionName);
    assert.ok(node, functionName);
    return createHash("sha256").update(source.slice(node.start, node.end).trim()).digest("hex");
  };
  for (const receipt of STATE_ACTION_SUCCESSOR_CARRIER_SOURCE_REFRESHES) {
    assert.equal(fingerprint(readHistoricalSource(receipt.previousSourceRevision, receipt.modulePath), receipt.functionName), receipt.previousSourceFingerprint);
    const source = readRepositorySource(receipt.modulePath);
    assert.equal(fingerprint(source, receipt.functionName), receipt.sourceFingerprint);
    const changed = source.replace(`function ${receipt.functionName}(`, `function ${receipt.functionName}Unreviewed(`);
    assert.notEqual(changed, source);
    assert.ok(validateStateActionModuleSource(changed, { filePath: receipt.modulePath })
      .some(({ code }) => code === "state-action-successor-carrier-source-drift"));
  }
});

test("successor carrier refresh repairs stale proofs and their shared hover call without changing retirement history or earlier observations", async () => {
  const fixture = await getSuccessorRefreshFixture();
  const before = structuredClone(fixture.previousPolicy);
  const ledger = buildCallerToActionLedger(fixture);
  assert.deepEqual(fixture.previousPolicy, before, "the historical input is immutable");
  const candidate = { ...before, progress: { ...before.progress, callerToActionLedger: ledger } };
  assert.deepEqual(policyChecker.validateCallerToActionLedgerHistoryTransition({ previousPolicy: before, currentPolicy: candidate }), []);
  const byIdentity = new Map(ledger.entries.map((entry) => [entry.retiredMembershipIdentity, entry]));
  const fullCandidate = structuredClone(fixture.current);
  fullCandidate.progress.callerToActionLedger.entries = fullCandidate.progress.callerToActionLedger.entries.map((entry) => byIdentity.get(entry.retiredMembershipIdentity) || entry);
  assert.deepEqual(validateStateWriterPolicySchema(fullCandidate), []);
  const snapshot = validateStateWriterPolicySnapshot({ policy: candidate, actionDelegations: normalizeStateActionDelegations(fixture.actionDelegations) });
  assert.deepEqual(snapshot.violations.filter(({ code }) => code.startsWith("caller-action-ledger-")), []);
  for (const previous of before.progress.callerToActionLedger.entries) {
    const current = byIdentity.get(previous.retiredMembershipIdentity);
    for (const key of ["retiredMembershipIdentity", "retiredMutationSiteFingerprint", "retiredMutationSiteCount", "retiredInPhase", "recordedInPhase", "backfilled"]) {
      assert.deepEqual(current[key], previous[key], key);
    }
    if (previous.recordedInPhase !== fixture.phase) {
      assert.deepEqual({ ...current, successorProofContractIdentity: previous.successorProofContractIdentity }, previous);
    }
  }
  const urban = ledger.entries.find((entry) => entry.key === "showUrban");
  assert.equal(urban.proofPrecision, "explicit-cross-file");
  assert.ok(urban.enclosingFunctionIdentity.endsWith('"ordinal":6}]}'));
  assert.ok(urban.retiredEnclosingFunctionIdentity.endsWith('"ordinal":4}]}'));
});

test("successor carrier refresh rejects unknown identities, changed chains, missing grants and forged history", async () => {
  const fixture = await getSuccessorRefreshFixture();
  const ledger = buildCallerToActionLedger(fixture);
  const oldEntry = fixture.previousPolicy.progress.callerToActionLedger.entries.find((entry) => entry.key === "showCityPoints");
  const newEntry = ledger.entries.find((entry) => entry.retiredMembershipIdentity === oldEntry.retiredMembershipIdentity);
  assert.equal(isStateActionSuccessorCarrierSourceRefresh(oldEntry, newEntry), true);
  for (const mutate of [
    (entry) => { entry.successorProofContractIdentity = "f".repeat(64); },
    (entry) => { entry.successorActionProofs[0].terminalMembership = "ui|P4.4|assign|showUrban"; },
    (entry) => { entry.successorActionProofs[0].sourceFingerprint = "f".repeat(64); },
    (entry) => { entry.actionExportName = "setScenarioHoverRegionIdsState"; },
    (entry) => { entry.successorActionProofs[0] = null; },
  ]) {
    const forged = structuredClone(newEntry);
    mutate(forged);
    assert.equal(isStateActionSuccessorCarrierSourceRefresh(oldEntry, forged), false);
    const candidate = structuredClone(fixture.current);
    const index = candidate.progress.callerToActionLedger.entries.findIndex(
      (entry) => entry.retiredMembershipIdentity === forged.retiredMembershipIdentity,
    );
    candidate.progress.callerToActionLedger.entries[index] = forged;
    assert.ok(validateStateWriterPolicySchema(candidate).some(
      (error) => error.code === "caller-action-ledger-entry-invalid"
        && error.retiredMembershipIdentity === forged.retiredMembershipIdentity,
    ));
  }
  for (const mutate of [
    (entry) => { entry.successorProofContractIdentity = "f".repeat(64); },
    (entry) => { entry.successorActionProofs[0].sourceFingerprint = "f".repeat(64); },
  ]) {
    const previousPolicy = structuredClone(fixture.previousPolicy);
    mutate(previousPolicy.progress.callerToActionLedger.entries.find((entry) => entry.key === oldEntry.key));
    assert.throws(() => buildCallerToActionLedger({ ...fixture, previousPolicy }), /proof generation failed/);
  }
  const terminal = oldEntry.successorActionProofs[0];
  assert.throws(() => buildCallerToActionLedger({ ...fixture,
    actionDelegations: fixture.actionDelegations.filter((edge) => edge.sourceFingerprint !== terminal.sourceFingerprint),
  }), /proof generation failed/);
  const writers = structuredClone(fixture.writers);
  writers.find((writer) => writer.path === terminal.actionModulePath).bindings
    .find((binding) => binding.functionName === terminal.actionExportName).grants = [];
  assert.throws(() => buildCallerToActionLedger({ ...fixture, writers }), /proof generation failed/);
  for (const field of ["retiredInPhase", "recordedInPhase", "retiredMutationSiteFingerprint", "line"]) {
    const candidate = { ...fixture.previousPolicy, progress: { ...fixture.previousPolicy.progress, callerToActionLedger: structuredClone(ledger) } };
    candidate.progress.callerToActionLedger.entries.find((entry) => entry.key === oldEntry.key)[field] = "forged";
    assert.ok(policyChecker.validateCallerToActionLedgerHistoryTransition({ previousPolicy: fixture.previousPolicy, currentPolicy: candidate })
      .some(({ code }) => code === "caller-action-ledger-history-drift"), field);
  }
  const contract = findStateActionSuccessorProofContractEntry(newEntry.actionModulePath, newEntry.actionExportName, "ui|P4.4|assign|showCityPoints");
  assert.equal(newEntry.successorProofContractIdentity, contract.contractIdentity);
});

test("committed caller-to-action ledger retains valid current schema proofs", () => {
  const policy = JSON.parse(readRepositorySource("tools/state_writer_policy.json"));
  assert.deepEqual(validateStateWriterPolicySchema(policy), []);
});
