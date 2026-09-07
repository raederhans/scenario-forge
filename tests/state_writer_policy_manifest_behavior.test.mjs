import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerStateActionSourceBoundaryContracts } from "./contracts/state_action_source_boundary_contracts.mjs";

import {
  buildStateActionLegacyMembershipReplacementContractIdentity,
  buildStateActionCrossFileMigrationContractIdentity,
  expandStateActionMembershipsWithLegacyReplacements,
  findStateActionReadOnlyContractEntry,
  findStateActionSuccessorProofContractEntry,
  getStateActionDelegationContractEntriesForModule,
  STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT,
  STATE_ACTION_DELEGATION_CONTRACT,
  STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT,
  STATE_ACTION_SUCCESSOR_PROOF_CONTRACT,
  validateStateActionCrossFileMigrationContract,
  validateStateActionDelegationContract,
  validateStateActionLegacyMembershipReplacementContract,
  validateStateActionModulePhaseAdmissions,
  validateStateActionModuleSource,
  validateStateActionPolicyBindings,
  validateStateActionSuccessorProofContract,
} from "../tools/state_action_delegation_contract.mjs";
import {
  scanStateMutations,
} from "../tools/state_writer_inventory.mjs";
import {
  buildCanonicalStateKeyAuthorityIndex,
  buildCanonicalStateKeyAuthorityCatalog,
  buildDefaultStateOwnershipReport,
  discoverGlobalStateImportBindings,
  getLegacyDirectAllowlistProjection,
  validateTestDiagnosticBudget,
  validateStateWriterPolicySchema,
  validateStateWriterPolicySnapshot,
} from "../tools/state_writer_policy.mjs";
import {
  buildStateWriterDerivedAliasTaintModeManifest,
  buildP4CloseoutTargets,
  buildCallerToActionLedger,
  buildDerivedAliasTaintDiagnosticDelta,
  buildFrozenDerivedAliasTaintBaseline,
  buildHistoricalDerivedAliasProofCheckpoint,
  buildHistoricalDerivedAliasProofIdentity,
  buildIncrementalDerivedAliasTaintBaseline,
  buildUnbaselinedLegacyDiagnosticCounts,
  buildLegacyStateWriterSemanticAuthority,
  buildStateWriterBindingGrants,
  buildStateWriterPolicySnapshot,
  buildProgressState,
  buildStableStateBindingIdentity,
  discoverCandidatePaths,
  discoverStateWriterBindingsForSource,
  extractP42aCallerToActionBootstrapSeed,
  hasCanonicalStateMutationFinding,
  normalizeStateActionDelegations,
  readStateWriterPolicy,
  readStateWriterPolicyAtRevision,
  resolveCachedHistoricalDerivedAliasProof,
  resolveCachedStateWriterRepositoryScan,
  resolveAcceptedStateWriterPolicyCheckpoint,
  resolveGitCommitSha,
  shouldRetainScannedWriterCandidate,
  composeLegacySemanticBaseline,
  validateStateWriterDerivedAliasTaintModeManifest,
  scanStateWriterPolicySnapshot,
  subtractLegacyStateWriterSemanticAuthority,
  validateLegacyStateWriterSemanticAuthority,
  validateLegacyStateWriterSemanticLedger,
  validateLegacyMembershipRetirementReplacements,
  validateStateWriterPolicyProgression,
  writeStateWriterPolicyAtomically,
} from "../tools/build_state_writer_policy.mjs";
import {
  DERIVED_ALIAS_TAINT_MODES,
} from "../tools/state_writer_inventory.mjs";
import {
  buildStateWriterVerificationIdentity,
  buildStateWriterCloseoutTargetViolations,
  buildStateWriterPolicyReport,
  recomputeDerivedAliasTaintBaseline,
  validateDerivedAliasTaintTransitionCheckpointProof,
  validateDerivedAliasTaintBaselineTransition,
  validateFrozenCloseoutTargets,
  validateCallerToActionLedgerHistoryTransition,
} from "../tools/check_state_writer_policy.mjs";
import {
  assertP4StateWriterPolicyManifestRunMode,
} from "../tools/run_p4_state_writer_policy_tests.mjs";
import {
  hashP4StateWriterHistoricalProofJson,
  startP4StateWriterHistoricalProofWorker,
} from "../tools/verification/p4_state_writer_historical_proof_worker.mjs";

assertP4StateWriterPolicyManifestRunMode();

const SHARED_REPOSITORY_SCAN_CACHE = new Map();

class ExactHistoricalProofSeedCache extends Map {
  #expectedKey = null;

  seal(expectedKey) {
    if (this.size !== 1 || !this.has(expectedKey)) {
      throw new Error("Historical proof cache must contain its exact seeded identity before sealing.");
    }
    this.#expectedKey = expectedKey;
  }

  has(key) {
    if (this.#expectedKey !== null && key !== this.#expectedKey) {
      const error = new Error("Canonical policy builder requested an unseeded historical proof identity.");
      error.code = "p4-state-writer-historical-proof-cache-identity-mismatch";
      error.expected = this.#expectedKey;
      error.actual = key;
      throw error;
    }
    return super.has(key);
  }

  set(key, value) {
    if (this.#expectedKey !== null && key !== this.#expectedKey) {
      const error = new Error("Canonical policy builder requested an unseeded historical proof identity.");
      error.code = "p4-state-writer-historical-proof-cache-identity-mismatch";
      error.expected = this.#expectedKey;
      error.actual = key;
      throw error;
    }
    return super.set(key, value);
  }
}

const SHARED_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE =
  new ExactHistoricalProofSeedCache();
const SHARED_CHECKER_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE =
  new Map();

function createHistoricalProofWorkerEnvelopeFixture() {
  const fixture = createHistoricalDerivedAliasProofCacheFixture();
  const identity = buildHistoricalDerivedAliasProofIdentity(fixture);
  return {
    kind: "p4-state-writer-historical-proof",
    schemaVersion: 1,
    status: "passed",
    identity,
    identitySha256: hashP4StateWriterHistoricalProofJson(identity),
    policySha256: identity.policySha256,
    proofSha256: hashP4StateWriterHistoricalProofJson({ proof: "fixture" }),
    sourceSha: identity.sourceSha,
    phase: identity.phase,
    candidatePaths: [...identity.candidatePaths],
    matches: true,
  };
}

function createHistoricalProofWorkerCtor(run) {
  return class FakeHistoricalProofWorker extends EventEmitter {
    constructor(workerUrl, options) {
      super();
      this.workerUrl = workerUrl;
      this.options = options;
      this.terminateCalls = 0;
      queueMicrotask(() => run(this));
    }

    terminate() {
      this.terminateCalls += 1;
      queueMicrotask(() => this.emit("exit", 1));
      return Promise.resolve(1);
    }
  };
}

function deepFreezeSharedJson(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreezeSharedJson(value[key], seen);
  }
  return Object.freeze(value);
}

function createReadOnlySingleFlight(load) {
  let pending = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve()
        .then(load)
        .then((value) => deepFreezeSharedJson(value));
    }
    return pending;
  };
}

const readSharedRepositoryPolicy = createReadOnlySingleFlight(
  () => readStateWriterPolicy(),
);

function buildCurrentHistoricalProofInputs(checkedIn) {
  const phase = checkedIn.progress.latestPhase;
  const candidatePaths = [
    ...(checkedIn.baselines.derivedAliasTaint?.paths || []),
  ].sort((left, right) => left.localeCompare(right));
  const identityInputs = {
    sourceSha: checkedIn.baseline.sourceBaseSha,
    candidatePaths,
    phase,
    taintMode: DERIVED_ALIAS_TAINT_MODES.STRICT,
    checkpoint: buildHistoricalDerivedAliasProofCheckpoint({
      phase,
      policy: checkedIn,
    }),
    previousPolicy: checkedIn,
    policy: checkedIn,
  };
  return {
    candidatePaths,
    identityInputs,
    identity: buildHistoricalDerivedAliasProofIdentity(identityInputs),
  };
}

function readCheckerPreviousPolicy() {
  const status = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.equal(
    status.status,
    0,
    String(status.stderr || "Unable to inspect the policy worktree."),
  );
  return readStateWriterPolicyAtRevision(
    String(status.stdout || "").trim() === "" ? "HEAD^1" : "HEAD",
  );
}

function reuseHistoricalProofSeedForExactIdentity({
  sourceCache,
  targetCache,
  sourceIdentity,
  targetIdentity,
}) {
  const sourceKey = JSON.stringify(sourceIdentity);
  const targetKey = JSON.stringify(targetIdentity);
  if (sourceKey !== targetKey) return false;
  assert.equal(sourceCache.has(sourceKey), true);
  targetCache.set(targetKey, sourceCache.get(sourceKey));
  return true;
}

const prepareSharedCurrentPhasePolicyInputs = createReadOnlySingleFlight(
  async () => {
    const checkedIn = await readSharedRepositoryPolicy();
    const {
      candidatePaths: strictProductionPaths,
      identityInputs,
      identity,
    } = buildCurrentHistoricalProofInputs(checkedIn);
    const workerSession = startP4StateWriterHistoricalProofWorker();
    const inventoryPromise = scanStateWriterPolicySnapshot(checkedIn, {
      repositoryScanCache: SHARED_REPOSITORY_SCAN_CACHE,
    });
    const guardedInventoryPromise = inventoryPromise.catch(async (error) => {
      await workerSession.terminate();
      throw error;
    });
    const [inventoryResult, workerResult] = await Promise.allSettled([
      guardedInventoryPromise,
      workerSession.result,
    ]);
    if (inventoryResult.status === "rejected") {
      throw inventoryResult.reason;
    }
    if (workerResult.status === "rejected") {
      throw workerResult.reason;
    }
    const inventory = inventoryResult.value;
    const workerSummary = workerResult.value;
    const scannedStrictProductionPaths = Object.entries(
      inventory.derivedAliasTaintModeManifest.modeByPath,
    )
      .filter(([, mode]) => mode === DERIVED_ALIAS_TAINT_MODES.STRICT)
      .map(([relativePath]) => relativePath)
      .sort((left, right) => left.localeCompare(right));

    assert.deepEqual(scannedStrictProductionPaths, strictProductionPaths);
    assert.equal(workerSummary.status, "passed");
    assert.deepEqual(workerSummary.identity, identity);
    assert.equal(
      workerSummary.identitySha256,
      hashP4StateWriterHistoricalProofJson(identity),
    );
    assert.equal(workerSummary.policySha256, identity.policySha256);
    assert.equal(
      workerSummary.proofSha256,
      hashP4StateWriterHistoricalProofJson(
        checkedIn.baselines.derivedAliasTaint,
      ),
    );
    assert.equal(workerSummary.matches, true);

    const historicalProof = await resolveCachedHistoricalDerivedAliasProof({
      historicalDerivedAliasProofCache:
        SHARED_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE,
      ...identityInputs,
      prove: async () => checkedIn.baselines.derivedAliasTaint,
    });
    assert.deepEqual(historicalProof, checkedIn.baselines.derivedAliasTaint);
    const expectedCacheKey = JSON.stringify(identity);
    SHARED_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE.seal(expectedCacheKey);

    const checkerIdentity = buildHistoricalDerivedAliasProofIdentity({
      ...identityInputs,
      previousPolicy: readCheckerPreviousPolicy(),
    });
    reuseHistoricalProofSeedForExactIdentity({
      sourceCache: SHARED_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE,
      targetCache: SHARED_CHECKER_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE,
      sourceIdentity: identity,
      targetIdentity: checkerIdentity,
    });
    return { inventory, historicalProof };
  },
);

const buildSharedCurrentPhasePolicy = createReadOnlySingleFlight(
  async () => {
    const checkedIn = await readSharedRepositoryPolicy();
    await prepareSharedCurrentPhasePolicyInputs();
    const rebuilt = await buildStateWriterPolicySnapshot({
      phase: checkedIn.progress.latestPhase,
      baseSha: checkedIn.baseline.sourceBaseSha,
      generatedAt: checkedIn.baseline.generatedAt,
      previousPolicy: checkedIn,
      repositoryScanCache: SHARED_REPOSITORY_SCAN_CACHE,
      historicalDerivedAliasProofCache:
        SHARED_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE,
    });
    assert.equal(SHARED_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE.size, 1);
    return rebuilt;
  },
);

test("read-only single-flight fixtures start once and freeze shared results", async () => {
  let calls = 0;
  const load = createReadOnlySingleFlight(async () => {
    calls += 1;
    return { nested: { values: [1, 2, 3] } };
  });

  const first = load();
  assert.equal(load(), first);
  const value = await first;

  assert.equal(calls, 1);
  assert.equal(load(), first);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.nested));
  assert.ok(Object.isFrozen(value.nested.values));
  assert.throws(() => value.nested.values.push(4), TypeError);
});

test("read-only single-flight fixtures preserve one rejected attempt", async () => {
  const failure = new Error("fixture failed");
  let calls = 0;
  const load = createReadOnlySingleFlight(async () => {
    calls += 1;
    throw failure;
  });

  const first = load();
  assert.equal(load(), first);
  await assert.rejects(first, (error) => error === failure);
  await assert.rejects(load(), (error) => error === failure);
  assert.equal(calls, 1);
});

test("historical proof worker session requires one passed message followed by exit zero", async () => {
  const expected = createHistoricalProofWorkerEnvelopeFixture();
  let fakeWorker = null;
  const WorkerCtor = createHistoricalProofWorkerCtor((worker) => {
    fakeWorker = worker;
    worker.emit("message", expected);
    worker.emit("exit", 0);
  });
  const session = startP4StateWriterHistoricalProofWorker(
    {},
    { WorkerCtor, workerUrl: new URL("file:///fixture-worker.mjs") },
  );

  assert.deepEqual(await session.result, expected);
  assert.equal(fakeWorker.listenerCount("message"), 0);
  assert.equal(fakeWorker.listenerCount("messageerror"), 0);
  assert.equal(fakeWorker.listenerCount("error"), 0);
  assert.equal(fakeWorker.listenerCount("exit"), 0);
});

test("historical proof worker session propagates one valid failed terminal envelope", async () => {
  const passed = createHistoricalProofWorkerEnvelopeFixture();
  const WorkerCtor = createHistoricalProofWorkerCtor((worker) => {
    worker.emit("message", {
      kind: passed.kind,
      schemaVersion: passed.schemaVersion,
      status: "failed",
      error: {
        code: "historical-proof-baseline-mismatch",
        message: "frozen derived alias proof differs from the baseline",
      },
    });
    worker.emit("exit", 0);
  });
  const session = startP4StateWriterHistoricalProofWorker(
    {},
    { WorkerCtor, workerUrl: new URL("file:///fixture-worker.mjs") },
  );

  await assert.rejects(
    session.result,
    (error) => error?.code === "historical-proof-baseline-mismatch"
      && error?.message === "frozen derived alias proof differs from the baseline",
  );
});

test("historical proof worker session fails closed for invalid terminal sequences", async (t) => {
  const passed = createHistoricalProofWorkerEnvelopeFixture();
  const cases = [
    {
      name: "missing message",
      code: "p4-historical-proof-worker-message-missing",
      run: (worker) => worker.emit("exit", 0),
    },
    {
      name: "duplicate message",
      code: "p4-historical-proof-worker-message-duplicate",
      run: (worker) => {
        worker.emit("message", passed);
        worker.emit("message", passed);
        worker.emit("exit", 0);
      },
    },
    {
      name: "malformed failed envelope",
      code: "p4-historical-proof-worker-envelope-invalid",
      run: (worker) => {
        worker.emit("message", {
          kind: passed.kind,
          schemaVersion: passed.schemaVersion,
          status: "failed",
          error: { code: "fixture" },
        });
        worker.emit("exit", 0);
      },
    },
    {
      name: "unverified proof match",
      code: "p4-historical-proof-worker-envelope-invalid",
      run: (worker) => {
        worker.emit("message", { ...passed, matches: false });
        worker.emit("exit", 0);
      },
    },
    {
      name: "nonzero exit after passed message",
      code: "p4-historical-proof-worker-exit-nonzero",
      run: (worker) => {
        worker.emit("message", passed);
        worker.emit("exit", 2);
      },
    },
    {
      name: "worker error",
      code: "p4-historical-proof-worker-error",
      run: (worker) => worker.emit("error", new Error("fixture error")),
    },
    {
      name: "message error",
      code: "p4-historical-proof-worker-message-error",
      run: (worker) => worker.emit("messageerror", new Error("fixture decode")),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const WorkerCtor = createHistoricalProofWorkerCtor(fixture.run);
      const session = startP4StateWriterHistoricalProofWorker(
        {},
        { WorkerCtor, workerUrl: new URL("file:///fixture-worker.mjs") },
      );
      await assert.rejects(
        session.result,
        (error) => error?.code === fixture.code,
      );
    });
  }
});

test("historical proof worker termination and exact seed cache are bounded", async () => {
  let fakeWorker = null;
  const WorkerCtor = createHistoricalProofWorkerCtor((worker) => {
    fakeWorker = worker;
  });
  const session = startP4StateWriterHistoricalProofWorker(
    {},
    { WorkerCtor, workerUrl: new URL("file:///fixture-worker.mjs") },
  );

  assert.equal(await session.terminate(), 1);
  assert.equal(await session.terminate(), 1);
  await assert.rejects(
    session.result,
    (error) => error?.code === "p4-historical-proof-worker-exit-nonzero",
  );
  assert.equal(fakeWorker.terminateCalls, 1);

  const cache = new ExactHistoricalProofSeedCache();
  cache.set("expected", Promise.resolve({ proof: "fixture" }));
  cache.seal("expected");
  assert.throws(
    () => cache.set("drifted", Promise.resolve({ proof: "drifted" })),
    (error) => (
      error?.code === "p4-state-writer-historical-proof-cache-identity-mismatch"
    ),
  );
  assert.equal(cache.size, 1);
});

test("sealed historical proof cache rejects identity drift before scheduling proof work", async () => {
  const fixture = createHistoricalDerivedAliasProofCacheFixture();
  const identity = buildHistoricalDerivedAliasProofIdentity(fixture);
  const cache = new ExactHistoricalProofSeedCache();
  cache.set(
    JSON.stringify(identity),
    Promise.resolve({ proof: "seeded" }),
  );
  cache.seal(JSON.stringify(identity));
  let proofCalls = 0;

  await assert.rejects(
    resolveCachedHistoricalDerivedAliasProof({
      historicalDerivedAliasProofCache: cache,
      ...fixture,
      phase: "P4.2c",
      prove: async () => {
        proofCalls += 1;
        return { proof: "drifted" };
      },
    }),
    (error) => (
      error?.code === "p4-state-writer-historical-proof-cache-identity-mismatch"
    ),
  );
  await Promise.resolve();
  assert.equal(proofCalls, 0);
  assert.equal(cache.size, 1);
});

test("checker proof cache reuses only an exact builder proof identity", async () => {
  const fixture = createHistoricalDerivedAliasProofCacheFixture();
  const builderIdentity = buildHistoricalDerivedAliasProofIdentity(fixture);
  const builderCache = new ExactHistoricalProofSeedCache();
  const seeded = Promise.resolve({ proof: "seeded" });
  builderCache.set(JSON.stringify(builderIdentity), seeded);
  builderCache.seal(JSON.stringify(builderIdentity));

  const exactCheckerCache = new Map();
  assert.equal(
    reuseHistoricalProofSeedForExactIdentity({
      sourceCache: builderCache,
      targetCache: exactCheckerCache,
      sourceIdentity: builderIdentity,
      targetIdentity: buildHistoricalDerivedAliasProofIdentity(fixture),
    }),
    true,
  );
  assert.equal(exactCheckerCache.get(JSON.stringify(builderIdentity)), seeded);

  const checkerFixture = {
    ...fixture,
    previousPolicy: {
      ...fixture.previousPolicy,
      fixtureRevision: "previous",
    },
  };
  const checkerIdentity = buildHistoricalDerivedAliasProofIdentity(
    checkerFixture,
  );
  assert.notEqual(
    checkerIdentity.previousPolicySha256,
    builderIdentity.previousPolicySha256,
  );
  const independentCheckerCache = new Map();
  assert.equal(
    reuseHistoricalProofSeedForExactIdentity({
      sourceCache: builderCache,
      targetCache: independentCheckerCache,
      sourceIdentity: builderIdentity,
      targetIdentity: checkerIdentity,
    }),
    false,
  );

  let proofCalls = 0;
  const prove = async () => ({ proof: `checker-${++proofCalls}` });
  const first = await resolveCachedHistoricalDerivedAliasProof({
    historicalDerivedAliasProofCache: independentCheckerCache,
    ...checkerFixture,
    prove,
  });
  const second = await resolveCachedHistoricalDerivedAliasProof({
    historicalDerivedAliasProofCache: independentCheckerCache,
    ...checkerFixture,
    prove,
  });
  assert.deepEqual(first, { proof: "checker-1" });
  assert.deepEqual(second, first);
  assert.equal(proofCalls, 1);
  assert.equal(independentCheckerCache.size, 1);
});

test("explicit repository scan cache deduplicates work and returns isolated values", async () => {
  const cache = new Map();
  const previousPolicy = { progress: { latestPhase: "fixture" } };
  let scans = 0;
  const scan = async () => {
    scans += 1;
    return { candidates: [{ path: "js/fixture.js" }] };
  };
  const first = await resolveCachedStateWriterRepositoryScan({
    repositoryScanCache: cache,
    previousPolicy,
    scanIdentity: "fixture-scan",
    scan,
  });
  first.candidates[0].path = "mutated-by-consumer.js";
  const second = await resolveCachedStateWriterRepositoryScan({
    repositoryScanCache: cache,
    previousPolicy,
    scanIdentity: "fixture-scan",
    scan,
  });

  assert.equal(scans, 1);
  assert.equal(second.candidates[0].path, "js/fixture.js");
  await assert.rejects(
    resolveCachedStateWriterRepositoryScan({
      repositoryScanCache: new Map(),
      previousPolicy,
      scanIdentity: "failed-scan",
      scan: async () => {
        throw new Error("fixture failure");
      },
    }),
    /fixture failure/,
  );
});

function createHistoricalDerivedAliasProofCacheFixture(overrides = {}) {
  const previousPolicy = {
    schemaVersion: 2,
    baseline: { sourceBaseSha: "1".repeat(40) },
    baselines: {
      derivedAliasTaint: {
        transitionCheckpoints: [],
      },
    },
    progress: {
      latestPhase: "P4.3",
      checkpoints: [{ phase: "P4.3" }],
    },
  };
  return {
    sourceSha: previousPolicy.baseline.sourceBaseSha,
    candidatePaths: ["js/b.js", "js/a.js", "js/a.js"],
    phase: "P4.3",
    taintMode: DERIVED_ALIAS_TAINT_MODES.STRICT,
    checkpoint: {
      acceptedPolicyCheckpoint: null,
      progressCheckpoint: previousPolicy.progress.checkpoints[0],
      transitionCheckpoints: [],
    },
    previousPolicy,
    policy: previousPolicy,
    ...overrides,
  };
}

test("historical derived-alias proof reuse is caller-owned and isolated by default", async () => {
  let proofs = 0;
  const prove = async () => ({ proof: ++proofs });
  const fixture = createHistoricalDerivedAliasProofCacheFixture();

  await resolveCachedHistoricalDerivedAliasProof({ ...fixture, prove });
  await resolveCachedHistoricalDerivedAliasProof({ ...fixture, prove });

  assert.equal(proofs, 2);
});

test("historical derived-alias proof reuse binds every proof identity input", async () => {
  const cache = new Map();
  let proofs = 0;
  const prove = async () => ({
    diagnosticDelta: { unsupportedSites: [`proof-${++proofs}`] },
  });
  const fixture = createHistoricalDerivedAliasProofCacheFixture();
  const first = await resolveCachedHistoricalDerivedAliasProof({
    historicalDerivedAliasProofCache: cache,
    ...fixture,
    prove,
  });
  first.diagnosticDelta.unsupportedSites[0] = "consumer-mutation";
  const second = await resolveCachedHistoricalDerivedAliasProof({
    historicalDerivedAliasProofCache: cache,
    ...fixture,
    prove,
  });

  assert.equal(proofs, 1);
  assert.deepEqual(second, {
    diagnosticDelta: { unsupportedSites: ["proof-1"] },
  });
  const [serializedIdentity] = cache.keys();
  const identity = JSON.parse(serializedIdentity);
  assert.deepEqual(identity.candidatePaths, ["js/a.js", "js/b.js"]);
  assert.equal(identity.sourceSha, "1".repeat(40));
  assert.equal(identity.phase, "P4.3");
  assert.equal(identity.taintMode, DERIVED_ALIAS_TAINT_MODES.STRICT);
  assert.match(identity.previousPolicySha256, /^[0-9a-f]{64}$/);
  assert.match(identity.policySha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(identity.checkpoint, fixture.checkpoint);

  const variants = [
    { sourceSha: "2".repeat(40) },
    { candidatePaths: ["js/a.js", "js/c.js"] },
    { phase: "P4.2c" },
    { taintMode: DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE },
    {
      checkpoint: {
        ...fixture.checkpoint,
        acceptedPolicyCheckpoint: { sourceSha: "3".repeat(40) },
      },
    },
    {
      previousPolicy: {
        ...fixture.previousPolicy,
        schemaVersion: 3,
      },
    },
    {
      policy: {
        ...fixture.policy,
        schemaVersion: 3,
      },
    },
  ];
  for (const overrides of variants) {
    await resolveCachedHistoricalDerivedAliasProof({
      historicalDerivedAliasProofCache: cache,
      ...fixture,
      ...overrides,
      prove,
    });
  }
  assert.equal(proofs, 1 + variants.length);
  await assert.rejects(
    resolveCachedHistoricalDerivedAliasProof({
      historicalDerivedAliasProofCache: cache,
      ...fixture,
      sourceSha: "unresolved-revision",
      prove,
    }),
    (error) =>
      error?.code === "historical-derived-alias-proof-source-invalid",
  );
  await assert.rejects(
    resolveCachedHistoricalDerivedAliasProof({
      historicalDerivedAliasProofCache: cache,
      ...fixture,
      previousPolicy: {
        ...fixture.previousPolicy,
        unresolvedIdentity: undefined,
      },
      prove,
    }),
    (error) =>
      error?.code === "historical-derived-alias-proof-identity-invalid",
  );
  assert.equal(proofs, 1 + variants.length);
});

test("historical derived-alias proof reuse evicts rejected work", async () => {
  const cache = new Map();
  const fixture = createHistoricalDerivedAliasProofCacheFixture();
  let proofs = 0;
  const prove = async () => {
    proofs += 1;
    if (proofs === 1) throw new Error("fixture proof failed");
    return { proof: "complete" };
  };

  await assert.rejects(
    resolveCachedHistoricalDerivedAliasProof({
      historicalDerivedAliasProofCache: cache,
      ...fixture,
      prove,
    }),
    /fixture proof failed/,
  );
  assert.equal(cache.size, 0);
  assert.deepEqual(
    await resolveCachedHistoricalDerivedAliasProof({
      historicalDerivedAliasProofCache: cache,
      ...fixture,
      prove,
    }),
    { proof: "complete" },
  );
  assert.equal(proofs, 2);
});

function createPolicyFixture() {
  return {
    schemaVersion: 1,
    baseline: {
      baseSha: "fixture",
      phase: "P4.0",
    },
    writers: [
      {
        path: "js/fixture.js",
        surface: "production",
        domain: "boot",
        authority: "legacy-direct",
        migrationPhase: "P4.1",
        bindings: [
          {
            id: "runtime-state",
            kind: "module",
            name: "state",
            authority: "legacy-direct",
            grants: [
              {
                domain: "boot",
                migrationPhase: "P4.1",
                operations: ["assign"],
                keys: ["bootPhase"],
                memberships: [
                  {
                    operation: "assign",
                    key: "bootPhase",
                  },
                ],
                aliasSites: [],
                dynamicSites: [],
                ambiguousSites: [],
                unsupportedSites: [],
              },
            ],
          },
        ],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        domain: "test-fixture",
        authority: "legacy-direct",
        migrationPhase: "closeout",
        bindings: [
          {
            id: "test-state",
            kind: "module",
            name: "state",
            authority: "test-fixture",
            grants: [
              {
                domain: "test-fixture",
                migrationPhase: "closeout",
                operations: ["assign"],
                keys: ["bootPhase"],
                memberships: [
                  {
                    operation: "assign",
                    key: "bootPhase",
                  },
                ],
                aliasSites: [],
                dynamicSites: [],
                ambiguousSites: [],
                unsupportedSites: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

function createDelegationOnlyPolicyFixture() {
  const policy = createPolicyFixture();
  const writer = policy.writers[0];
  writer.path = "js/core/state/actions/fixture_actions.js";
  writer.authority = "domain-action";
  const binding = writer.bindings[0];
  binding.id = "parameter:delegateFixtureState:0:fixture:1:1";
  binding.kind = "function-parameter";
  binding.name = "target";
  binding.functionName = "delegateFixtureState";
  binding.parameterName = "target";
  binding.parameterIndex = 0;
  binding.parameterPath = "$";
  binding.authority = "domain-action";
  binding.delegationOnly = true;
  binding.grants = [];
  return policy;
}

test("state writer policy replacement fsyncs a validated sibling before rename", async (t) => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "state-writer-policy-"));
  t.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));
  const targetPath = path.join(tempDirectory, "state_writer_policy.json");
  const original = '{"schemaVersion":1}\n';
  const replacement = '{"schemaVersion":2,"progress":{"latestPhase":"P4.3"}}\n';
  fs.writeFileSync(targetPath, original, "utf8");

  const writeEvents = [];
  const orderedFs = Object.assign({}, fsPromises, {
    open: async (...args) => {
      writeEvents.push("open-temp-exclusive");
      const handle = await fsPromises.open(...args);
      return {
        writeFile: async (...writeArgs) => {
          writeEvents.push("write-temp");
          return handle.writeFile(...writeArgs);
        },
        sync: async () => {
          writeEvents.push("sync-temp");
          return handle.sync();
        },
        close: async () => {
          writeEvents.push("close-temp");
          return handle.close();
        },
      };
    },
    readFile: async (...args) => {
      writeEvents.push("readback-temp");
      return fsPromises.readFile(...args);
    },
    rename: async (...args) => {
      writeEvents.push("rename-over-target");
      return fsPromises.rename(...args);
    },
  });
  await writeStateWriterPolicyAtomically(targetPath, replacement, {
    fsImpl: orderedFs,
    tempSuffix: "success",
  });
  assert.deepEqual(writeEvents, [
    "open-temp-exclusive",
    "write-temp",
    "sync-temp",
    "close-temp",
    "readback-temp",
    "rename-over-target",
  ]);
  assert.equal(fs.readFileSync(targetPath, "utf8"), replacement);
  assert.deepEqual(fs.readdirSync(tempDirectory), ["state_writer_policy.json"]);

  const renameFailure = Object.assign({}, fsPromises, {
    rename: async () => {
      const error = new Error("fixture rename failure");
      error.code = "EACCES";
      throw error;
    },
  });
  await assert.rejects(
    writeStateWriterPolicyAtomically(targetPath, original, {
      fsImpl: renameFailure,
      tempSuffix: "rename-failure",
    }),
    /fixture rename failure/,
  );
  assert.equal(fs.readFileSync(targetPath, "utf8"), replacement);
  assert.deepEqual(fs.readdirSync(tempDirectory), ["state_writer_policy.json"]);

  await assert.rejects(
    writeStateWriterPolicyAtomically(targetPath, "{", {
      tempSuffix: "invalid-json",
    }),
    SyntaxError,
  );
  assert.equal(fs.readFileSync(targetPath, "utf8"), replacement);
  assert.deepEqual(fs.readdirSync(tempDirectory), ["state_writer_policy.json"]);
});

function createFinding(overrides = {}) {
  return {
    filePath: "js/fixture.js",
    bindingId: "runtime-state",
    operation: "assign",
    key: "bootPhase",
    dynamic: false,
    alias: "",
    aliasChain: [],
    line: 1,
    column: 1,
    ...overrides,
  };
}

function createEmptyLegacySemanticAuthority() {
  return {
    bindings: [],
    memberships: [],
    aliasSites: [],
    dynamicSites: [],
    ambiguousSites: [],
    unsupportedSites: [],
    collisions: [],
  };
}

async function buildFixtureLegacyWritersForSource(
  source,
  derivedAliasTaintMode,
  relativePath = "js/fixture.js",
) {
  const { bindingInventories } =
    await discoverStateWriterBindingsForSource(
      relativePath,
      source,
      "production",
      {
        scanAllParameters: true,
        derivedAliasTaintMode,
        includeInventories: true,
      },
    );
  const bindings = bindingInventories
    .filter(({ findings }) => findings.length)
    .map(({ binding, findings }) => ({
      ...binding,
      authority: "legacy-target",
      grants: buildStateWriterBindingGrants(
        findings,
        relativePath,
        buildCanonicalStateKeyAuthorityIndex(),
        "production",
      ),
    }));
  return [{
    path: relativePath,
    surface: "production",
    domain: "boot",
    authority: "legacy-target",
    migrationPhase: "P4.1",
    bindings,
  }];
}

function createCallerActionLedgerEntry(index = 0, overrides = {}) {
  const callerPath = `js/bootstrap/fixture_${String(index).padStart(2, "0")}.js`;
  const callerBindingIdentity = JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName: `applyFixture${String(index).padStart(2, "0")}`,
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "$/property:targetState",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
  const callerBindingId = `function:applyFixture${String(index).padStart(2, "0")}:0:$/property:targetState`;
  const domain = "boot";
  const migrationPhase = "P4.1";
  const operation = "assign";
  const key = `bootFixture${String(index).padStart(2, "0")}`;
  const actionModulePath = "js/core/state/actions/boot_actions.js";
  const actionExportName = "setBootStateFields";
  const targetArgumentIndex = 0;
  const start = 100 + index * 10;
  const end = start + 42;
  const sourceFingerprint = `${(index % 16).toString(16)}`.repeat(64);
  const retiredMembershipIdentity = [
    callerPath,
    callerBindingIdentity,
    domain,
    migrationPhase,
    operation,
    key,
  ].join("|");
  const actionCallEdgeIdentity =
    ((index + 1) % 16).toString(16).repeat(64);
  return {
    retiredMembershipIdentity,
    callerPath,
    callerBindingId,
    callerBindingIdentity,
    domain,
    migrationPhase,
    operation,
    key,
    actionModulePath,
    actionExportName,
    targetArgumentIndex,
    actionCallEdgeIdentity,
    occurrenceIndex: 0,
    start,
    end,
    line: 10 + index,
    column: 3,
    sourceFingerprint,
    retiredInPhase: "P4.1",
    recordedInPhase: "P4.2a",
    backfilled: true,
    ...overrides,
  };
}

function createActionDelegationObservation(entry, overrides = {}) {
  return {
    callerPath: entry.callerPath,
    callerBindingId: entry.callerBindingId,
    callerBindingIdentity: entry.callerBindingIdentity,
    actionModulePath: entry.actionModulePath,
    actionExportName: entry.actionExportName,
    targetArgumentIndex: entry.targetArgumentIndex,
    actionCallEdgeIdentity: entry.actionCallEdgeIdentity,
    occurrenceIndex: entry.occurrenceIndex,
    start: entry.start,
    end: entry.end,
    line: entry.line,
    column: entry.column,
    sourceFingerprint: entry.sourceFingerprint,
    ...overrides,
  };
}

function createCallerActionLedgerPolicy(entries = []) {
  const policy = createPolicyFixture();
  const actionWriter = policy.writers[0];
  actionWriter.path = "js/core/state/actions/boot_actions.js";
  actionWriter.authority = "domain-action";
  actionWriter.bindings[0] = {
    ...actionWriter.bindings[0],
    id: "function:setBootStateFields:0:$",
    kind: "function-parameter",
    name: "targetState",
    functionName: "setBootStateFields",
    parameterName: "targetState",
    parameterIndex: 0,
    parameterPath: "$",
    authority: "domain-action",
    grants: [{
      domain: "boot",
      migrationPhase: "P4.1",
      operations: ["assign"],
      keys: entries.map(({ key }) => key),
      memberships: entries.map(({ operation, key }) => ({
        operation,
        key,
      })),
      aliasSites: [],
      dynamicSites: [],
      ambiguousSites: [],
      unsupportedSites: [],
    }],
  };
  policy.writers = [actionWriter];
  const emptySemanticAuthority = createEmptyLegacySemanticAuthority();
  policy.baselines = {
    legacySemanticAuthority: emptySemanticAuthority,
  };
  policy.progress = {
    latestPhase: "P4.2a",
    checkpoints: [],
    retiredLegacySemanticAuthority: {
      ...emptySemanticAuthority,
      memberships: entries
        .map(({ retiredMembershipIdentity }) => retiredMembershipIdentity)
        .sort(),
    },
    callerToActionLedger: {
      schemaVersion: 1,
      entries,
    },
  };
  return policy;
}

function createCrossFileMigrationFixture() {
  const retiredCallerPath =
    "js/core/legacy_cross_file_fixture.js";
  const retiredBinding = {
    id: "module:runtimeState",
    kind: "module",
    name: "runtimeState",
    functionName: "",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "",
    importSource: "./state.js",
    importedName: "state",
    aliasSources: [],
    aliasOperators: [],
    authority: "legacy-direct",
    grants: [{
      domain: "boot",
      migrationPhase: "P4.1",
      operations: ["assign"],
      keys: ["bootPhase"],
      memberships: [{
        operation: "assign",
        key: "bootPhase",
        mutationSites: [{
          enclosingFunctionIdentity: JSON.stringify({
            kind: "function",
            ancestry: [{
              name: "applyLegacyBoot",
              ordinal: 0,
            }],
          }),
          sourceFingerprint: "a".repeat(64),
          occurrenceIndex: 0,
        }],
      }],
      aliasSites: [],
      dynamicSites: [],
      ambiguousSites: [],
      unsupportedSites: [],
    }],
  };
  const retiredCallerBindingIdentity =
    buildStableStateBindingIdentity(retiredBinding);
  const retiredMembershipIdentity = [
    retiredCallerPath,
    retiredCallerBindingIdentity,
    "boot",
    "P4.1",
    "assign",
    "bootPhase",
  ].join("|");
  const replacementCallerPath =
    "js/core/replacement_cross_file_fixture.js";
  const replacementCallerBindingIdentity = JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName: "createReplacementFixture",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "$/property:runtimeState",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
  const replacementEnclosingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{
      name: "createReplacementFixture",
      ordinal: 0,
    }, {
      name: "commitBoot",
      ordinal: 0,
    }],
  });
  const rawContract = {
    retiredCallerPath,
    retiredCallerBindingIdentity,
    retiredMembershipIdentity,
    domain: "boot",
    migrationPhase: "P4.1",
    operation: "assign",
    key: "bootPhase",
    retiredMutationSites:
      retiredBinding.grants[0].memberships[0].mutationSites,
    replacementCallerPath,
    replacementCallerBindingIdentity,
    replacementEnclosingFunctionIdentity,
    actionModulePath:
      "js/core/state/actions/boot_actions.js",
    actionExportName: "setBootStateFields",
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint: "b".repeat(64),
  };
  const contract = {
    ...rawContract,
    contractIdentity:
      buildStateActionCrossFileMigrationContractIdentity(
        rawContract,
      ),
  };
  const previousWriter = {
    path: retiredCallerPath,
    surface: "production",
    domain: "boot",
    authority: "legacy-direct",
    migrationPhase: "P4.1",
    bindings: [retiredBinding],
  };
  const actionWriter = {
    path: contract.actionModulePath,
    surface: "production",
    domain: "boot",
    authority: "domain-action",
    migrationPhase: "P4.1",
    bindings: [{
      ...structuredClone(retiredBinding),
      id: "function:setBootStateFields:0:$",
      kind: "function-parameter",
      name: "targetState",
      functionName: "setBootStateFields",
      parameterName: "targetState",
      parameterIndex: 0,
      parameterPath: "$",
      importSource: "",
      importedName: "",
      authority: "domain-action",
    }],
  };
  const retiredLegacySemanticAuthority =
    subtractLegacyStateWriterSemanticAuthority(
      buildLegacyStateWriterSemanticAuthority([previousWriter]),
      buildLegacyStateWriterSemanticAuthority([]),
    );
  const previousPolicy = {
    writers: [previousWriter],
    progress: {
      latestPhase: "P4.2a",
      retiredLegacySemanticAuthority:
        createEmptyLegacySemanticAuthority(),
      callerToActionLedger: {
        schemaVersion: 1,
        entries: [],
      },
    },
  };
  const actionDelegation = {
    callerPath: replacementCallerPath,
    callerBindingId:
      "parameter:createReplacementFixture:0:fixture",
    callerBindingIdentity:
      replacementCallerBindingIdentity,
    enclosingFunctionIdentity:
      replacementEnclosingFunctionIdentity,
    actionModulePath: contract.actionModulePath,
    actionExportName: contract.actionExportName,
    targetArgumentIndex: 0,
    start: 50,
    end: 80,
    line: 5,
    column: 3,
    sourceFingerprint:
      contract.replacementActionSourceFingerprint,
  };
  return {
    actionDelegation,
    actionWriter,
    contract,
    previousPolicy,
    previousWriter,
    retiredLegacySemanticAuthority,
  };
}

const EXPECTED_LAZY_STATE_KEYS_BY_AUTHORITY = Object.freeze({
  "boot|P4.1": Object.freeze([
    "activePostReadyTaskKey",
    "activePostReadyTaskStartedAt",
    "longAnimationFrameObserver",
    "postReadyTaskDiagnostics",
    "startupInitialScenarioChunkVisualPromotion",
    "uiHydrationError",
    "uiHydrationStatus",
    "uiHydrationUpdatedAt",
    "uiShellDebug",
    "uiShellDebugTerritorySeeded",
  ]),
  "scenario|P4.2": Object.freeze([
    "currentScenarioApplyRequestId",
    "currentScenarioApplyTargetId",
    "latestScenarioApplyRequestId",
    "latestScenarioApplyTargetId",
    "runtimePoliticalFeatureCollectionSeed",
    "scenarioApplyActiveRequestId",
    "scenarioApplyActiveTargetId",
    "scenarioAtlantropaRevision",
    "scenarioChunkPromotionRenderLocked",
    "scenarioFatalRecovery",
    "scenarioPerfMetrics",
    "scenarioPresentationStyleBeforeActivate",
    "scenarioRuntimeShellVersion",
    "selectionVersion",
  ]),
  "renderer|P4.3": Object.freeze([
    "canvasLayers",
    "colorCanvas",
    "colorCtx",
    "debugMode",
    "hgoRuntimePreview",
    "interactionOverlayCanvas",
    "interactionOverlayCtx",
    "lineCanvas",
    "lineCtx",
    "mediterraneanAtlantropaBoundsCache",
    "politicalPatchCanvas",
    "politicalPatchCtx",
    "projectedBoundsDiagnostics",
    "renderPerfMetrics",
    "renderPerfMetricSequence",
    "scenarioWaterCacheCoverageAlgo",
    "scenarioWaterCacheMode",
    "waterCacheCoverageAlgo",
    "waterCacheMode",
  ]),
  "color|P4.4": Object.freeze([
    "inspectorHighlightFeatureIds",
    "inspectorHighlightGroupMode",
    "inspectorHighlightLabel",
    "legendColorOrder",
  ]),
  "ui|P4.4": Object.freeze([
    "countryInspectorShowDetails",
    "lastDirtyReason",
    "legendControl",
    "specialZoneMembershipTool",
    "specialZonePresetCategory",
    "specialZonePresetOpenCategories",
    "specialZonePreviousTool",
  ]),
  "dev|P4.4": Object.freeze([
    "devWorkspaceTagPopoverDismissHandler",
  ]),
  "runtime-hooks|P4.5": Object.freeze([
    "resolveSpecialZoneParentGroupTargetIdsFn",
    "syncDayNightClockTimerFn",
    "updateSpecialZonesWorkbenchCurrentTargetUIFn",
    "updateSpecialZonesWorkbenchUIFn",
  ]),
});

test("legacy-direct projection remains an exact sorted file allowlist", () => {
  const policy = createPolicyFixture();

  assert.deepEqual(
    getLegacyDirectAllowlistProjection(policy),
    ["js/fixture.js", "tests/fixture.test.mjs"],
  );
});

test("policy snapshot keeps production and test denominators separate", () => {
  const policy = createPolicyFixture();
  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [
      "js/fixture.js",
      "tests/fixture.test.mjs",
    ],
    scans: [
      {
        path: "js/fixture.js",
        surface: "production",
        bindingId: "runtime-state",
        findings: [createFinding()],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        bindingId: "test-state",
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
          }),
        ],
      },
    ],
  });

  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.metrics.legacyDirectFiles, {
    production: 1,
    test: 1,
    total: 2,
  });
  assert.equal(result.metrics.legacyMemberships.production, 1);
  assert.equal(result.metrics.legacyMemberships.test, 0);
  assert.deepEqual(result.metrics.allMemberships, {
    production: 1,
    test: 1,
    total: 2,
  });
  assert.equal(
    result.metrics.bindingScoped.memberships.test.testFixture,
    1,
  );
});

test("policy snapshot rejects new keys, operations, aliases, and dynamic sites", () => {
  const cases = [
    {
      name: "key",
      finding: createFinding({ key: "unexpectedKey" }),
      expectedCode: "unknown-key",
    },
    {
      name: "operation",
      finding: createFinding({ operation: "delete" }),
      expectedCode: "unknown-operation",
    },
    {
      name: "alias",
      finding: createFinding({
        alias: "runtimeAlias",
        aliasChain: ["runtimeAlias"],
      }),
      expectedCode: "unknown-alias-site",
    },
    {
      name: "dynamic",
      finding: createFinding({
        key: "*",
        dynamic: true,
        line: 7,
        column: 3,
      }),
      expectedCode: "unknown-dynamic-site",
    },
  ];

  for (const fixture of cases) {
    const result = validateStateWriterPolicySnapshot({
      policy: createPolicyFixture(),
      legacyAllowlistPaths: [
        "js/fixture.js",
        "tests/fixture.test.mjs",
      ],
      scans: [
        {
          path: "js/fixture.js",
          surface: "production",
          bindingId: "runtime-state",
          findings: [fixture.finding],
        },
      ],
    });

    assert.equal(result.verdict, "fail", fixture.name);
    assert.ok(
      result.violations.some(({ code }) => code === fixture.expectedCode),
      fixture.name,
    );
  }
});

test("dynamic nested paths satisfy their exact top-level key grant", () => {
  const policy = createPolicyFixture();
  policy.writers[0].bindings[0].grants[0].dynamicSites = [
    {
      line: 7,
      column: 3,
      operation: "assign",
      key: "bootPhase",
      pathPattern: "bootPhase.*",
    },
  ];
  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [
      "js/fixture.js",
      "tests/fixture.test.mjs",
    ],
    scans: [
      {
        path: "js/fixture.js",
        surface: "production",
        bindingId: "runtime-state",
        findings: [
          createFinding({
            key: "bootPhase",
            dynamic: true,
            pathSegments: ["bootPhase", "*"],
            line: 7,
            column: 3,
          }),
        ],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        bindingId: "test-state",
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
          }),
        ],
      },
    ],
  });

  assert.equal(result.verdict, "pass", JSON.stringify(result.violations, null, 2));
});

test("policy snapshot consumes identical semantic sites as a multiset", () => {
  const policy = createPolicyFixture();
  const grant = policy.writers[0].bindings[0].grants[0];
  const sourceFingerprint = "a".repeat(64);
  grant.aliasSites = [
    {
      alias: "bootAlias",
      aliasChain: ["bootAlias"],
      operation: "assign",
      key: "bootPhase",
      line: 2,
      column: 3,
      sourceFingerprint,
    },
    {
      alias: "bootAlias",
      aliasChain: ["bootAlias"],
      operation: "assign",
      key: "bootPhase",
      line: 4,
      column: 5,
      sourceFingerprint,
    },
  ];
  const validateCount = (count) =>
    validateStateWriterPolicySnapshot({
      policy,
      legacyAllowlistPaths: [
        "js/fixture.js",
        "tests/fixture.test.mjs",
      ],
      scans: [
        {
          path: "js/fixture.js",
          surface: "production",
          bindingId: "runtime-state",
          findings: Array.from({ length: count }, (_, index) =>
            createFinding({
              alias: "bootAlias",
              aliasChain: ["bootAlias"],
              line: 2 + index * 2,
              column: 3 + index * 2,
              sourceFingerprint,
            })),
        },
        {
          path: "tests/fixture.test.mjs",
          surface: "test",
          bindingId: "test-state",
          findings: [
            createFinding({
              filePath: "tests/fixture.test.mjs",
              bindingId: "test-state",
            }),
          ],
        },
      ],
    });

  const oneObserved = validateCount(1);
  assert.equal(
    oneObserved.violations.filter(
      ({ code }) => code === "stale-alias-site",
    ).length,
    1,
  );
  assert.equal(
    validateCount(2).verdict,
    "pass",
  );
});

test("policy snapshot authorizes exact operation and key memberships", () => {
  const policy = createPolicyFixture();
  const grant = policy.writers[0].bindings[0].grants[0];
  grant.operations = ["assign", "delete"];
  grant.keys = ["bootPhase", "pendingWork"];
  grant.memberships = [
    { operation: "assign", key: "bootPhase" },
    { operation: "delete", key: "pendingWork" },
  ];

  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans: [
      {
        path: "js/fixture.js",
        surface: "production",
        bindingId: "runtime-state",
        findings: [
          createFinding({ operation: "delete", key: "bootPhase" }),
          createFinding({ operation: "assign", key: "pendingWork" }),
        ],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        bindingId: "test-state",
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
          }),
        ],
      },
    ],
  });

  assert.equal(result.verdict, "fail");
  assert.equal(
    result.violations.filter(({ code }) => code === "unknown-membership").length,
    2,
  );
});

test("domain actions reject module imports of the global state facade", () => {
  const policy = createPolicyFixture();
  const writer = policy.writers[0];
  writer.path = "js/core/state/actions/boot_actions.js";
  writer.authority = "domain-action";
  writer.bindings[0].authority = "domain-action";

  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["tests/fixture.test.mjs"],
    scans: [
      {
        path: writer.path,
        surface: "production",
        bindingId: "runtime-state",
        findings: [createFinding({ filePath: writer.path })],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        bindingId: "test-state",
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
          }),
        ],
      },
    ],
  });

  assert.ok(
    result.violations.some(
      ({ code }) => code === "domain-action-global-state-import",
    ),
  );
});

registerStateActionSourceBoundaryContracts();

test("policy snapshot rejects wrong state-key domain and migration phase grants", () => {
  for (const fixture of [
    {
      name: "wrong domain",
      mutate(grant) {
        grant.domain = "ui";
      },
    },
    {
      name: "wrong migration phase",
      mutate(grant) {
        grant.migrationPhase = "P9";
      },
    },
  ]) {
    const policy = createPolicyFixture();
    fixture.mutate(policy.writers[0].bindings[0].grants[0]);
    const result = validateStateWriterPolicySnapshot({
      policy,
      legacyAllowlistPaths: [
        "js/fixture.js",
        "tests/fixture.test.mjs",
      ],
      scans: [
        {
          path: "js/fixture.js",
          surface: "production",
          bindingId: "runtime-state",
          findings: [createFinding()],
        },
        {
          path: "tests/fixture.test.mjs",
          surface: "test",
          bindingId: "test-state",
          findings: [
            createFinding({
              filePath: "tests/fixture.test.mjs",
              bindingId: "test-state",
            }),
          ],
        },
      ],
    });

    assert.ok(
      result.violations.some(
        ({ code }) => code === "grant-authority-mismatch",
      ),
      fixture.name,
    );
  }
});

test("canonical authority index locks the complete lazy-key catalog by domain and phase", () => {
  const authorityIndex = buildCanonicalStateKeyAuthorityIndex();
  const actualKeysByAuthority = {};

  for (const [authority, expectedKeys] of Object.entries(
    EXPECTED_LAZY_STATE_KEYS_BY_AUTHORITY,
  )) {
    const [domain, migrationPhase] = authority.split("|");
    actualKeysByAuthority[authority] = [];
    for (const key of expectedKeys) {
      assert.deepEqual(
        authorityIndex.get(key),
        {
          domain,
          migrationPhase,
          owner: `lazy:${key}`,
        },
        key,
      );
      actualKeysByAuthority[authority].push(key);
    }
  }

  const expectedLazyKeys = Object.values(
    EXPECTED_LAZY_STATE_KEYS_BY_AUTHORITY,
  ).flat().sort();
  const actualLazyKeys = [...authorityIndex.entries()]
    .filter(([, authority]) =>
      String(authority?.owner || "").startsWith("lazy:")
    )
    .map(([key]) => key)
    .sort();

  assert.equal(expectedLazyKeys.length, 59);
  assert.deepEqual(actualLazyKeys, expectedLazyKeys);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(actualKeysByAuthority).map(([authority, keys]) => [
        authority,
        keys.sort(),
      ]),
    ),
    Object.fromEntries(
      Object.entries(EXPECTED_LAZY_STATE_KEYS_BY_AUTHORITY).map(
        ([authority, keys]) => [authority, [...keys].sort()],
      ),
    ),
  );
});

test("production concrete keys without canonical authority fail closed", () => {
  const policy = createPolicyFixture();
  const writer = policy.writers[0];
  writer.path = "js/bootstrap/fixture.js";
  const grant = writer.bindings[0].grants[0];
  grant.keys = ["lazyRuntimeMetric"];
  grant.memberships = [
    {
      operation: "assign",
      key: "lazyRuntimeMetric",
    },
  ];

  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [
      writer.path,
      "tests/fixture.test.mjs",
    ],
    scans: [
      {
        path: writer.path,
        surface: "production",
        bindingId: "runtime-state",
        findings: [
          createFinding({
            filePath: writer.path,
            key: "lazyRuntimeMetric",
          }),
        ],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        bindingId: "test-state",
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
          }),
        ],
      },
    ],
  });

  assert.ok(
    result.violations.some(
      ({ code, key }) =>
        code === "unknown-state-key-authority"
        && key === "lazyRuntimeMetric",
    ),
  );
  assert.deepEqual(result.metrics.unregisteredConcreteKeyAuthorities, [
    {
      key: "lazyRuntimeMetric",
      authorities: [
        {
          domain: "boot",
          migrationPhase: "P4.1",
          paths: ["js/bootstrap/fixture.js"],
        },
      ],
    },
  ]);
});

test("same unregistered key cannot inherit conflicting path fallback authorities", () => {
  const policy = createPolicyFixture();
  const bootWriter = policy.writers[0];
  bootWriter.path = "js/bootstrap/fixture.js";
  const bootGrant = bootWriter.bindings[0].grants[0];
  bootGrant.keys = ["sharedLazyMetric"];
  bootGrant.memberships = [
    {
      operation: "assign",
      key: "sharedLazyMetric",
    },
  ];
  const scenarioWriter = structuredClone(bootWriter);
  scenarioWriter.path = "js/core/scenario/fixture.js";
  scenarioWriter.domain = "scenario";
  scenarioWriter.migrationPhase = "P4.2";
  scenarioWriter.bindings[0].id = "scenario-state";
  scenarioWriter.bindings[0].grants[0].domain = "scenario";
  scenarioWriter.bindings[0].grants[0].migrationPhase = "P4.2";
  policy.writers.splice(1, 0, scenarioWriter);

  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [
      bootWriter.path,
      scenarioWriter.path,
      "tests/fixture.test.mjs",
    ],
    scans: [
      {
        path: bootWriter.path,
        surface: "production",
        bindingId: "runtime-state",
        findings: [
          createFinding({
            filePath: bootWriter.path,
            key: "sharedLazyMetric",
          }),
        ],
      },
      {
        path: scenarioWriter.path,
        surface: "production",
        bindingId: "scenario-state",
        findings: [
          createFinding({
            filePath: scenarioWriter.path,
            bindingId: "scenario-state",
            key: "sharedLazyMetric",
          }),
        ],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        bindingId: "test-state",
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
          }),
        ],
      },
    ],
  });

  assert.ok(
    result.violations.some(
      ({ code, key }) =>
        code === "unregistered-key-authority-conflict"
        && key === "sharedLazyMetric",
    ),
  );
});

test("policy builder preflight reports every production unknown concrete key", async () => {
  const builderModule = await import("../tools/build_state_writer_policy.mjs");
  assert.equal(
    typeof builderModule.collectUnknownStateKeyAuthorityViolations,
    "function",
  );
  const violations =
    builderModule.collectUnknownStateKeyAuthorityViolations([
      {
        path: "js/bootstrap/fixture.js",
        surface: "production",
        binding: { id: "boot-state" },
        findings: [
          createFinding({
            bindingId: "boot-state",
            key: "firstUnknownKey",
          }),
          createFinding({
            bindingId: "boot-state",
            key: "secondUnknownKey",
          }),
          createFinding({
            bindingId: "boot-state",
            key: "*",
            unsupported: true,
          }),
        ],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        binding: { id: "test-state" },
        findings: [
          createFinding({
            bindingId: "test-state",
            key: "testOnlyUnknownKey",
          }),
        ],
      },
    ]);

  assert.deepEqual(
    violations.map(({ key }) => key),
    ["firstUnknownKey", "secondUnknownKey"],
  );
});

test("policy schema rejects duplicate operation and key memberships across grants", () => {
  const policy = createPolicyFixture();
  const binding = policy.writers[0].bindings[0];
  binding.grants.push({
    domain: "ui",
    migrationPhase: "P4.4",
    operations: ["assign"],
    keys: ["bootPhase"],
    memberships: [
      {
        operation: "assign",
        key: "bootPhase",
      },
    ],
    aliasSites: [],
    dynamicSites: [],
    ambiguousSites: [],
    unsupportedSites: [],
  });

  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [
      "js/fixture.js",
      "tests/fixture.test.mjs",
    ],
    scans: [
      {
        path: "js/fixture.js",
        surface: "production",
        bindingId: "runtime-state",
        findings: [createFinding()],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        bindingId: "test-state",
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
          }),
        ],
      },
    ],
  });

  assert.ok(
    result.violations.some(
      ({ code }) => code === "duplicate-binding-membership",
    ),
  );
});

test("state action delegation contract validates registered module exports and target signatures", () => {
  const contractViolations =
    validateStateActionDelegationContract();
  assert.deepEqual(contractViolations, []);

  const sourceViolations = validateStateActionModuleSource(
    `
      export function setBootStateFields(target, patch = {}) {
        target.bootPhase = patch.phase;
      }
    `,
    {
      filePath: "js/core/state/actions/boot_actions.js",
      contractEntries: [{
        modulePath: "js/core/state/actions/boot_actions.js",
        exportName: "setBootStateFields",
        targetArgumentIndex: 0,
        introducedInPhase: "P4.1",
      }],
    },
  );
  assert.deepEqual(sourceViolations, []);
});

test("P4.2b chunk action modules register every writable and read-only export", () => {
  const modules = [
    {
      modulePath:
        "js/core/state/actions/scenario_chunk_runtime_actions.js",
      writableExportNames: [
        "ensureScenarioChunkRuntimeState",
        "resetScenarioChunkRuntimeState",
        "replaceScenarioChunkRuntimeState",
        "patchScenarioChunkLoadState",
        "commitScenarioChunkSelectionState",
        "beginScenarioChunkLoadState",
        "completeScenarioChunkLoadState",
        "failScenarioChunkLoadState",
        "finishScenarioChunkLoadState",
        "commitScenarioChunkPayloadEntriesState",
        "evictScenarioChunkPayloadsState",
        "setScenarioChunkMergedLayerPayloadsState",
        "replaceScenarioChunkPendingPromotionIdentityState",
        "queueScenarioChunkPromotionState",
        "setScenarioChunkPromotionStatusState",
        "clearScenarioChunkPromotionState",
        "setScenarioChunkRuntimeHooksState",
      ],
      readOnlyExportNames: [
        "SCENARIO_CHUNK_LOAD_STATE_PATCH_KEYS",
        "captureScenarioChunkLoadStateContinuation",
      ],
    },
    {
      modulePath:
        "js/core/state/actions/scenario_activation_actions.js",
      writableExportNames: [
        "applyScenarioChunkOptionalLayerState",
        "restoreScenarioChunkPromotionState",
      ],
      readOnlyExportNames: [
        "SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS",
        "getScenarioChunkOptionalLayerState",
        "captureScenarioChunkPromotionState",
      ],
    },
    {
      modulePath:
        "js/core/state/actions/scenario_presentation_actions.js",
      writableExportNames: [
        "applyScenarioChunkCityExternalEffectState",
        "finalizeScenarioChunkCityExternalEffectState",
      ],
      readOnlyExportNames: [],
    },
    {
      modulePath:
        "js/core/state/actions/scenario_chunk_promotion_actions.js",
      writableExportNames: [
        "setScenarioPoliticalChunkPayloadState",
        "bumpScenarioChunkDataGenerationState",
        "commitScenarioPoliticalChunkPayloadState",
        "setScenarioChunkPromotionRenderLockState",
        "setDefaultRuntimePoliticalTopologyState",
        "restoreScenarioChunkPromotionRootState",
      ],
      readOnlyExportNames: [
        "captureScenarioChunkPromotionRootState",
      ],
    },
  ];

  for (
    const {
      modulePath,
      writableExportNames,
      readOnlyExportNames,
    } of modules
  ) {
    const entries = getStateActionDelegationContractEntriesForModule(
      modulePath,
    ).filter(({ introducedInPhase }) => introducedInPhase === "P4.2b");
    assert.deepEqual(
      entries.map(({ exportName }) => exportName),
      writableExportNames,
    );
    assert.ok(entries.every(
      ({ introducedInPhase, targetArgumentIndex }) =>
        introducedInPhase === "P4.2b" && targetArgumentIndex === 0,
    ));
    assert.deepEqual(
      readOnlyExportNames.map((exportName) =>
        findStateActionReadOnlyContractEntry(modulePath, exportName)
      ),
      readOnlyExportNames.map((exportName) => ({
        modulePath,
        exportName,
        targetArgumentIndex: 0,
      })),
    );
    assert.deepEqual(
      validateStateActionModuleSource(
        fs.readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
        { filePath: modulePath },
      ),
      [],
    );
  }
});

test("P4.2b optional-layer actions explicitly replace the retired wildcard membership", () => {
  const modulePath =
    "js/core/state/actions/scenario_activation_actions.js";
  const retiredMembership = "scenario|P4.2|assign|*";
  const requiredConcreteMemberships = [
    "scenario|P4.2|assign|scenarioAtlantropaData",
    "scenario|P4.2|assign|scenarioAtlantropaRevision",
    "scenario|P4.2|assign|scenarioReliefOverlayRevision",
    "scenario|P4.2|assign|scenarioReliefOverlaysData",
    "scenario|P4.2|assign|scenarioSpecialRegionsData",
    "scenario|P4.2|assign|scenarioStrategicValuesData",
    "scenario|P4.2|assign|scenarioStrategicValuesRevision",
    "scenario|P4.2|assign|scenarioWaterRegionsData",
    "ui|P4.4|assign|specialZoneLayers",
  ];
  assert.deepEqual(
    validateStateActionLegacyMembershipReplacementContract(),
    [],
  );
  assert.deepEqual(
    STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT.filter(
      (entry) =>
        entry.modulePath === modulePath
        && entry.retiredMembership === retiredMembership,
    ).map(({
      contractIdentity: _contractIdentity,
      ...entry
    }) => entry),
    [
      {
        modulePath,
        exportName: "applyScenarioChunkOptionalLayerState",
        retiredMembership,
        requiredConcreteMemberships,
      },
      {
        modulePath,
        exportName: "restoreScenarioChunkPromotionState",
        retiredMembership,
        requiredConcreteMemberships,
      },
    ],
  );
  assert.ok(STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT.every(
    (entry) =>
      /^[a-f0-9]{64}$/.test(entry.contractIdentity)
      && entry.contractIdentity
        === buildStateActionLegacyMembershipReplacementContractIdentity(entry),
  ));
  for (const exportName of [
    "applyScenarioChunkOptionalLayerState",
    "restoreScenarioChunkPromotionState",
  ]) {
    assert.deepEqual(
      [...expandStateActionMembershipsWithLegacyReplacements({
        modulePath,
        exportName,
        memberships: requiredConcreteMemberships,
      })].sort(),
      [...requiredConcreteMemberships, retiredMembership].sort(),
    );
    assert.equal(
      expandStateActionMembershipsWithLegacyReplacements({
        modulePath,
        exportName,
        memberships: requiredConcreteMemberships.slice(1),
      }).has(retiredMembership),
      false,
    );
    assert.equal(
      expandStateActionMembershipsWithLegacyReplacements({
        modulePath,
        exportName,
        memberships: [
          ...requiredConcreteMemberships,
          "scenario|P4.2|assign|unexpectedFutureKey",
        ],
      }).has(retiredMembership),
      false,
    );
  }
  assert.equal(
    expandStateActionMembershipsWithLegacyReplacements({
      modulePath,
      exportName: "setScenarioChunkPromotionRenderLockState",
      memberships: requiredConcreteMemberships,
    }).has(retiredMembership),
    false,
  );
});

test("legacy membership replacement contract rejects malformed coverage", () => {
  const valid = structuredClone(
    STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT[0],
  );
  const refreshIdentity = (entry) => ({
    ...entry,
    contractIdentity:
      buildStateActionLegacyMembershipReplacementContractIdentity(entry),
  });
  const malformed = [
    refreshIdentity({
      ...valid,
      requiredConcreteMemberships: [
        ...valid.requiredConcreteMemberships,
        valid.requiredConcreteMemberships[0],
      ],
    }),
    refreshIdentity({
      ...valid,
      requiredConcreteMemberships:
        [...valid.requiredConcreteMemberships].reverse(),
    }),
    refreshIdentity({
      ...valid,
      retiredMembership: "scenario|P4.2|unsupported|*",
    }),
    refreshIdentity({
      ...valid,
      exportName: "unregisteredReplacement",
    }),
    {
      ...valid,
      contractIdentity: "f".repeat(64),
    },
  ];
  assert.ok(malformed.every((entry) =>
    validateStateActionLegacyMembershipReplacementContract([entry])
      .length > 0
  ));
});

test("P4.4 operation replacements require exact action memberships", async () => {
  const entries =
    STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT.filter(
      ({ modulePath }) =>
        modulePath !==
          "js/core/state/actions/scenario_activation_actions.js",
    );
  assert.equal(entries.length, 18);
  assert.deepEqual(
    entries.map(({
      modulePath,
      exportName,
      retiredMembership,
      requiredConcreteMemberships,
    }) => ({
      modulePath,
      exportName,
      retiredMembership,
      requiredConcreteMemberships,
    })),
    [
      {
        modulePath: "js/core/state/actions/strategic_overlay_actions.js",
        exportName: "commitStrategicOverlayCollectionsState",
        retiredMembership:
          "ui|P4.4|collection-mutate|operationalLines",
        requiredConcreteMemberships: [
          "ui|P4.4|assign|operationalLines",
        ],
      },
      {
        modulePath: "js/core/state/actions/strategic_overlay_actions.js",
        exportName: "commitStrategicOverlayCollectionsState",
        retiredMembership:
          "ui|P4.4|collection-mutate|operationGraphics",
        requiredConcreteMemberships: [
          "ui|P4.4|assign|operationGraphics",
        ],
      },
      {
        modulePath: "js/core/state/actions/strategic_overlay_actions.js",
        exportName: "commitStrategicOverlayCollectionsState",
        retiredMembership: "ui|P4.4|collection-mutate|unitCounters",
        requiredConcreteMemberships: [
          "ui|P4.4|assign|unitCounters",
        ],
      },
      {
        modulePath: "js/core/state/actions/strategic_overlay_actions.js",
        exportName: "patchStrategicOverlayEditorState",
        retiredMembership:
          "strategic-overlay|P4.4|collection-mutate|operationalLineEditor",
        requiredConcreteMemberships: [
          "strategic-overlay|P4.4|assign|operationalLineEditor",
        ],
      },
      {
        modulePath: "js/core/state/actions/strategic_overlay_actions.js",
        exportName: "patchStrategicOverlayEditorState",
        retiredMembership:
          "strategic-overlay|P4.4|collection-mutate|operationGraphicsEditor",
        requiredConcreteMemberships: [
          "strategic-overlay|P4.4|assign|operationGraphicsEditor",
        ],
      },
      {
        modulePath: "js/core/state/actions/strategic_overlay_actions.js",
        exportName: "patchStrategicOverlayEditorState",
        retiredMembership:
          "strategic-overlay|P4.4|compound-assign|operationalLineEditor",
        requiredConcreteMemberships: [
          "strategic-overlay|P4.4|assign|operationalLineEditor",
        ],
      },
      {
        modulePath: "js/core/state/actions/strategic_overlay_actions.js",
        exportName: "patchStrategicOverlayEditorState",
        retiredMembership:
          "strategic-overlay|P4.4|compound-assign|operationGraphicsEditor",
        requiredConcreteMemberships: [
          "strategic-overlay|P4.4|assign|operationGraphicsEditor",
        ],
      },
      {
        modulePath: "js/core/state/actions/strategic_overlay_actions.js",
        exportName: "patchStrategicOverlayEditorState",
        retiredMembership:
          "strategic-overlay|P4.4|compound-assign|unitCounterEditor",
        requiredConcreteMemberships: [
          "strategic-overlay|P4.4|assign|unitCounterEditor",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "applyTransportWorkbenchOverviewState",
        retiredMembership: "cross-domain|multi-phase|assign|*",
        requiredConcreteMemberships: [
          "ui|P4.4|define-property|showAirports",
          "ui|P4.4|define-property|showPorts",
          "ui|P4.4|define-property|showRail",
          "ui|P4.4|define-property|showRoad",
          "ui|P4.4|define-property|showTransport",
          "ui|P4.4|define-property|transportWorkbenchPointDeltas",
          "ui|P4.4|define-property|transportWorkbenchUi",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "applyTransportWorkbenchOverviewState",
        retiredMembership: "ui|P4.4|assign|showTransport",
        requiredConcreteMemberships: [
          "ui|P4.4|define-property|showTransport",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "commitTransportWorkbenchPointDeltasState",
        retiredMembership:
          "ui|P4.4|assign|transportWorkbenchPointDeltas",
        requiredConcreteMemberships: [
          "ui|P4.4|define-property|transportWorkbenchPointDeltas",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "commitTransportWorkbenchUiState",
        retiredMembership:
          "ui|P4.4|object-assign|transportWorkbenchUi",
        requiredConcreteMemberships: [
          "ui|P4.4|assign|transportWorkbenchUi",
          "ui|P4.4|define-property|transportWorkbenchUi",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "setTransportFamilyVisibilityState",
        retiredMembership: "ui|P4.4|assign|showAirports",
        requiredConcreteMemberships: [
          "ui|P4.4|define-property|showAirports",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "setTransportFamilyVisibilityState",
        retiredMembership: "ui|P4.4|assign|showPorts",
        requiredConcreteMemberships: [
          "ui|P4.4|define-property|showPorts",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "setTransportFamilyVisibilityState",
        retiredMembership: "ui|P4.4|assign|showRail",
        requiredConcreteMemberships: [
          "ui|P4.4|define-property|showRail",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "setTransportFamilyVisibilityState",
        retiredMembership: "ui|P4.4|assign|showRoad",
        requiredConcreteMemberships: [
          "ui|P4.4|define-property|showRoad",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "setTransportFamilyVisibilityState",
        retiredMembership: "ui|P4.4|assign|showTransport",
        requiredConcreteMemberships: [
          "ui|P4.4|define-property|showTransport",
        ],
      },
      {
        modulePath: "js/core/state/actions/transport_actions.js",
        exportName: "setTransportMasterVisibilityState",
        retiredMembership: "ui|P4.4|assign|showTransport",
        requiredConcreteMemberships: [
          "ui|P4.4|define-property|showTransport",
        ],
      },
    ],
  );
  assert.deepEqual(
    validateStateActionLegacyMembershipReplacementContract(entries),
    [],
  );
  const membershipsByAction = new Map();
  const canonicalAuthorityIndex =
    buildCanonicalStateKeyAuthorityIndex();
  for (const modulePath of new Set(
    entries.map(({ modulePath }) => modulePath),
  )) {
    const source = fs.readFileSync(modulePath, "utf8");
    const { bindingInventories } =
      await discoverStateWriterBindingsForSource(
        modulePath,
        source,
        "production",
        {
          scanAllParameters: true,
          includeInventories: true,
        },
      );
    for (const { binding, findings } of bindingInventories) {
      if (!entries.some(
        (entry) => entry.exportName === binding.functionName,
      )) {
        continue;
      }
      const memberships = buildStateWriterBindingGrants(
        findings,
        modulePath,
        canonicalAuthorityIndex,
        "production",
      ).flatMap((grant) =>
        grant.memberships.map((membership) =>
          [
            grant.domain,
            grant.migrationPhase,
            membership.operation,
            membership.key,
          ].join("|")
        )
      );
      membershipsByAction.set(
        `${modulePath}#${binding.functionName}`,
        [...new Set(memberships)].sort(),
      );
    }
  }
  for (const entry of entries) {
    const actualMemberships = membershipsByAction.get(
      `${entry.modulePath}#${entry.exportName}`,
    );
    assert.ok(actualMemberships, entry.exportName);
    assert.equal(
      expandStateActionMembershipsWithLegacyReplacements({
        modulePath: entry.modulePath,
        exportName: entry.exportName,
        memberships: actualMemberships,
        contractEntries: [entry],
      }).has(entry.retiredMembership),
      true,
      `${entry.exportName} ${entry.retiredMembership}`,
    );
    const expanded = expandStateActionMembershipsWithLegacyReplacements({
      modulePath: entry.modulePath,
      exportName: entry.exportName,
      memberships: entry.requiredConcreteMemberships,
      contractEntries: [entry],
    });
    assert.equal(expanded.has(entry.retiredMembership), true);
    assert.equal(
      expandStateActionMembershipsWithLegacyReplacements({
        modulePath: entry.modulePath,
        exportName: entry.exportName,
        memberships: entry.requiredConcreteMemberships.slice(1),
        contractEntries: [entry],
      }).has(entry.retiredMembership),
      false,
    );
    const [, , , retiredKey] =
      entry.retiredMembership.split("|");
    const extraMembership = retiredKey === "*"
      ? "ui|P4.4|assign|unexpectedFutureKey"
      : "";
    if (extraMembership) {
      assert.equal(
        expandStateActionMembershipsWithLegacyReplacements({
          modulePath: entry.modulePath,
          exportName: entry.exportName,
          memberships: [
            ...entry.requiredConcreteMemberships,
            extraMembership,
          ],
          contractEntries: [entry],
        }).has(entry.retiredMembership),
        false,
      );
    }
  }

  const [collectionReplacement] = entries.filter(
    ({ retiredMembership }) =>
      retiredMembership.includes("|collection-mutate|"),
  );
  const wrongOperation = structuredClone(collectionReplacement);
  wrongOperation.requiredConcreteMemberships =
    wrongOperation.requiredConcreteMemberships.map((membership) =>
      membership.replace("|assign|", "|define-property|")
    );
  wrongOperation.contractIdentity =
    buildStateActionLegacyMembershipReplacementContractIdentity(
      wrongOperation,
    );
  assert.ok(
    validateStateActionLegacyMembershipReplacementContract([
      wrongOperation,
    ]).length > 0,
  );
});

test("state action delegation contract rejects invalid and duplicate entries", () => {
  const modulePath = "js/core/state/actions/boot_actions.js";
  const violations = validateStateActionDelegationContract([
    {
      modulePath,
      exportName: "setBootStateFields",
      targetArgumentIndex: 0,
      introducedInPhase: "P4.1",
    },
    {
      modulePath,
      exportName: "setBootStateFields",
      targetArgumentIndex: 0,
      introducedInPhase: "P4.1",
    },
    {
      modulePath: "./js/core/state/actions/escape.js",
      exportName: "default",
      targetArgumentIndex: 1,
      introducedInPhase: "P4.1",
    },
    null,
  ]);

  assert.deepEqual(
    violations.map(({ code }) => code),
    [
      "state-action-contract-entry-duplicate",
      "state-action-contract-module-path-invalid",
      "state-action-contract-export-name-invalid",
      "state-action-contract-target-index-invalid",
      "state-action-contract-entry-invalid",
    ],
  );
});

test("state action module admission rejects future-phase authority", () => {
  const contractEntries = [{
    modulePath: "js/core/state/actions/ui_chrome_actions.js",
    exportName: "replaceExportWorkbenchUiState",
    targetArgumentIndex: 0,
    introducedInPhase: "P4.4",
  }];

  assert.deepEqual(
    validateStateActionModulePhaseAdmissions({
      modulePaths: [
        "js/core/state/actions/ui_chrome_actions.js",
      ],
      phase: "P4.2a",
      contractEntries,
    }),
    [{
      code: "state-action-module-phase-not-admitted",
      modulePath: "js/core/state/actions/ui_chrome_actions.js",
      introducedInPhase: "P4.4",
      currentPhase: "P4.2a",
    }],
  );
  assert.deepEqual(
    validateStateActionModulePhaseAdmissions({
      modulePaths: [
        "js/core/state/actions/ui_chrome_actions.js",
      ],
      phase: "P4.4",
      contractEntries,
    }),
    [],
  );
});

test("state action module source requires one direct named export with target at argument zero", () => {
  const modulePath = "js/core/state/actions/boot_actions.js";
  const contractEntries = [{
    modulePath,
    exportName: "setBootStateFields",
    targetArgumentIndex: 0,
    introducedInPhase: "P4.1",
  }];
  const scan = (source) =>
    validateStateActionModuleSource(source, {
      filePath: modulePath,
      contractEntries,
    }).map(({ code }) => code);

  const invalidSources = [
    {
      source: "export function other(target) { target.bootPhase = 'ready'; }",
      expected: [
        "state-action-direct-export-unregistered",
        "state-action-direct-export-missing",
      ],
    },
    {
      source:
        "export const setBootStateFields = (target) => { target.bootPhase = 'ready'; };",
      expected: [
        "state-action-direct-export-missing",
        "state-action-export-not-direct-function",
      ],
    },
    {
      source:
        "function setBootStateFields(target) {} export { setBootStateFields };",
      expected: [
        "state-action-direct-export-missing",
        "state-action-export-not-direct-function",
      ],
    },
    {
      source:
        "export { setBootStateFields } from './bridge.js';",
      expected: [
        "state-action-direct-export-missing",
        "state-action-export-not-direct-function",
      ],
    },
    {
      source: "export default function(target) {}",
      expected: [
        "state-action-export-unregistered",
        "state-action-direct-export-missing",
      ],
    },
    {
      source: "export * from './bridge.js';",
      expected: [
        "state-action-export-unregistered",
        "state-action-direct-export-missing",
      ],
    },
    {
      source:
        "export function setBootStateFields(options, target) { target.bootPhase = options.phase; }",
      expected: ["state-action-target-parameter-name-invalid"],
    },
    {
      source:
        "export function setBootStateFields(target = {}) { target.bootPhase = 'ready'; }",
      expected: ["state-action-target-parameter-shape-invalid"],
    },
    {
      source:
        "export function setBootStateFields(...target) { target.bootPhase = 'ready'; }",
      expected: ["state-action-target-parameter-shape-invalid"],
    },
    {
      source:
        "export function setBootStateFields({ target }) { target.bootPhase = 'ready'; }",
      expected: ["state-action-target-parameter-shape-invalid"],
    },
    {
      source: "export function setBootStateFields(",
      expected: ["state-action-source-parse-failed"],
    },
  ];

  for (const { source, expected } of invalidSources) {
    assert.deepEqual(scan(source), expected, source);
  }
});

test("state action module source rejects unregistered target-first exports and unregistered modules", () => {
  const modulePath = "js/core/state/actions/boot_actions.js";
  const contractEntries = [{
    modulePath,
    exportName: "setBootStateFields",
    targetArgumentIndex: 0,
    introducedInPhase: "P4.1",
  }];
  const violations = validateStateActionModuleSource(
    `
      export function setBootStateFields(target) {
        target.bootPhase = "ready";
      }
      export function stealState(target) {
        target.bootMessage = "escaped";
      }
      export function stealRuntimeState(state) {
        state.bootError = "escaped";
      }
      const bridge = () => {};
      export { bridge };
    `,
    { filePath: modulePath, contractEntries },
  );
  assert.deepEqual(
    violations.map(({ code, exportName }) => ({ code, exportName })),
    [
      {
        code: "state-action-direct-export-unregistered",
        exportName: "stealState",
      },
      {
        code: "state-action-direct-export-unregistered",
        exportName: "stealRuntimeState",
      },
      {
        code: "state-action-export-unregistered",
        exportName: "bridge",
      },
    ],
  );

  assert.deepEqual(
    validateStateActionModuleSource(
      "export function stealState(target) {}",
      {
        filePath: "js/core/state/actions/unregistered_actions.js",
        contractEntries,
      },
    ).map(({ code }) => code),
    [
      "state-action-module-contract-missing",
      "state-action-direct-export-unregistered",
    ],
  );
});

test("state action policy bindings require exact domain-action target authority with zero diagnostics", () => {
  const modulePath = "js/core/state/actions/boot_actions.js";
  const contractEntries = [{
    modulePath,
    exportName: "setBootStateFields",
    targetArgumentIndex: 0,
    introducedInPhase: "P4.1",
  }];
  const createBinding = (overrides = {}) => ({
    id: "parameter:setBootStateFields:0:fixture",
    kind: "function-parameter",
    functionName: "setBootStateFields",
    parameterName: "target",
    parameterIndex: 0,
    parameterPath: "$",
    authority: "domain-action",
    grants: [{
      aliasSites: [],
      dynamicSites: [],
      ambiguousSites: [],
      unsupportedSites: [],
    }],
    ...overrides,
  });
  const createWriter = (bindings, overrides = {}) => ({
    path: modulePath,
    authority: "domain-action",
    bindings,
    ...overrides,
  });
  const validate = (writers) =>
    validateStateActionPolicyBindings(writers, {
      contractEntries,
      modulePaths: [modulePath],
    }).map(({ code }) => code);

  assert.deepEqual(validate([createWriter([createBinding()])]), []);
  assert.deepEqual(validate([]), ["state-action-policy-writer-missing"]);
  assert.deepEqual(
    validate([
      createWriter(
        [createBinding()],
        { authority: "legacy-target" },
      ),
    ]),
    ["state-action-policy-writer-authority-invalid"],
  );
  assert.deepEqual(
    validate([createWriter([])]),
    ["state-action-policy-binding-missing"],
  );
  assert.deepEqual(
    validate([
      createWriter([
        createBinding({
          parameterIndex: 1,
          parameterPath: "$/property:target",
        }),
      ]),
    ]),
    ["state-action-policy-binding-shape-invalid"],
  );
  assert.deepEqual(
    validate([
      createWriter([
        createBinding({
          grants: [{
            aliasSites: [{}],
            dynamicSites: [{}],
            ambiguousSites: [{}],
            unsupportedSites: [{}],
          }],
        }),
      ]),
    ]),
    ["state-action-policy-binding-diagnostics-invalid"],
  );
  assert.deepEqual(
    validate([
      createWriter([
        createBinding({
          grants: [{
            aliasSites: [{
              alias: "target",
              aliasChain: ["target"],
              operation: "assign",
              key: "bootPhase",
              line: 9,
              column: 3,
              sourceFingerprint: "a".repeat(64),
            }, {
              alias: "target",
              aliasChain: ["target", "target"],
              operation: "delete",
              key: "startupReadonlyReason",
              line: 19,
              column: 3,
              sourceFingerprint: "b".repeat(64),
            }],
            dynamicSites: [],
            ambiguousSites: [],
            unsupportedSites: [],
          }],
        }),
      ]),
    ]),
    [],
  );
  assert.deepEqual(
    validate([
      createWriter([
        createBinding({
          grants: [{
            aliasSites: [{
              alias: "targetAlias",
              aliasChain: ["targetAlias"],
              operation: "assign",
              key: "bootPhase",
              line: 9,
              column: 3,
              sourceFingerprint: "a".repeat(64),
            }],
            dynamicSites: [],
            ambiguousSites: [],
            unsupportedSites: [],
          }],
        }),
      ]),
    ]),
    ["state-action-policy-binding-diagnostics-invalid"],
  );
  assert.deepEqual(
    validate([
      createWriter([
        createBinding(),
        createBinding({
          id: "parameter:stealState:0:fixture",
          functionName: "stealState",
        }),
      ]),
    ]),
    ["state-action-policy-binding-unregistered"],
  );
  assert.deepEqual(
    validate([
      createWriter([
        createBinding(),
        createBinding({
          id: "parameter:stealState:0:fixture",
          functionName: "stealState",
          authority: "legacy-target",
        }),
      ]),
    ]),
    ["state-action-policy-binding-unregistered"],
  );
});

test("policy generation validates registered action source shape and generated action bindings", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../tools/build_state_writer_policy.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /validateStateActionModuleSource\(\s*source,\s*\{\s*filePath:\s*relativePath/s,
  );
  assert.match(
    source,
    /validateStateActionPolicyBindings\(\s*writers,\s*\{/s,
  );
  assert.match(
    source,
    /state-action-delegation-source-invalid/,
  );
  assert.match(
    source,
    /state-action-delegation-policy-invalid/,
  );
  assert.equal(
    source.match(/allowUnknownUnsupportedAuthority:\s*true/g)?.length || 0,
    1,
  );
  assert.match(
    source,
    /function isTransitionSemanticBinding[\s\S]*STATE_WRITER_PARAMETER_NAME_SET\.has[\s\S]*export async function buildFrozenDerivedAliasTaintBaseline/,
  );
  assert.match(
    source,
    /export async function buildFrozenDerivedAliasTaintBaseline[\s\S]*const diagnosticFindings = findings\.filter[\s\S]*isTransitionSemanticBinding\(binding, previousWriter\)[\s\S]*allowUnknownUnsupportedAuthority:\s*\n\s*ALLOW_UNKNOWN_UNSUPPORTED_AUTHORITY[\s\S]*export function subtractLegacyStateWriterSemanticAuthority/,
  );
});

test("policy verification identity includes the state action delegation contract", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../tools/check_state_writer_policy.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const POLICY_CONFIG_PATHS = Object\.freeze\(\[[\s\S]*"tools\/state_action_delegation_contract\.mjs"/,
  );
});

test("boot actions satisfy the delegation source and binding contracts as scanned", async () => {
  const { readFile } = await import("node:fs/promises");
  const modulePath = "js/core/state/actions/boot_actions.js";
  const source = await readFile(
    new URL("../js/core/state/actions/boot_actions.js", import.meta.url),
    "utf8",
  );
  const bootContractEntries = STATE_ACTION_DELEGATION_CONTRACT.filter(
    (entry) => entry.modulePath === modulePath,
  );
  assert.deepEqual(
    validateStateActionModuleSource(source, {
      filePath: modulePath,
      contractEntries: bootContractEntries,
    }),
    [],
  );

  const discoveredBindings = await discoverStateWriterBindingsForSource(
    modulePath,
    source,
    "production",
    { scanAllParameters: true },
  );
  assert.deepEqual(
    discoveredBindings.map(
      ({ functionName, parameterIndex, parameterPath }) => ({
        functionName,
        parameterIndex,
        parameterPath,
      }),
    ),
    bootContractEntries.map(
      ({ exportName, targetArgumentIndex }) => ({
        functionName: exportName,
        parameterIndex: targetArgumentIndex,
        parameterPath: "$",
      }),
    ).sort((left, right) =>
      left.functionName.localeCompare(right.functionName)
    ),
  );
  const authorityIndex = buildCanonicalStateKeyAuthorityIndex();
  const policyBindings = bootContractEntries.map((entry) => {
    const binding = discoveredBindings.find(
      (candidate) =>
        candidate.functionName === entry.exportName
        && candidate.parameterIndex === entry.targetArgumentIndex
        && candidate.parameterPath === "$",
    );
    assert.ok(binding, `missing scanned binding for ${entry.exportName}`);
    const findings = scanStateMutations(source, {
      filePath: modulePath,
      bindings: [binding],
    });
    return {
      ...binding,
      authority: "domain-action",
      grants: buildStateWriterBindingGrants(
        findings,
        modulePath,
        authorityIndex,
        "production",
      ),
    };
  });
  assert.deepEqual(
    validateStateActionPolicyBindings(
      [{
        path: modulePath,
        authority: "domain-action",
        bindings: policyBindings,
      }],
      { modulePaths: [modulePath] },
    ),
    [],
  );
});

test("policy schema locks canonical binding authority and direct-module projection", () => {
  const fixture = createPolicyFixture();
  fixture.writers[0].bindings[0].authority = "compat-facade";
  assert.ok(
    validateStateWriterPolicySchema(fixture).some(
      ({ code }) => code === "binding-authority-classification-drift",
    ),
  );

  const outsideAllowlist = createPolicyFixture();
  outsideAllowlist.writers[0].authority = "legacy-target";
  assert.ok(
    validateStateWriterPolicySchema(outsideAllowlist).some(
      ({ code }) =>
        code === "module-direct-membership-outside-allowlist",
    ),
  );
});

test("policy schema v2 requires a frozen derived alias diagnostic baseline", () => {
  const policy = createPolicyFixture();
  const sourceBaseSha = "1".repeat(40);
  policy.schemaVersion = 2;
  policy.baseline.sourceBaseSha = sourceBaseSha;
  policy.baselines = {
    legacySemanticAuthority:
      buildLegacyStateWriterSemanticAuthority(policy.writers),
    derivedAliasTaint: {
      algorithmVersion: 1,
      sourceBaseSha,
      paths: ["js/fixture.js"],
      diagnosticDelta: {
        ambiguousSites: [],
        unsupportedSites: [],
      },
    },
  };
  assert.deepEqual(
    validateStateWriterPolicySchema(policy).filter(
      ({ code }) => code.startsWith("derived-alias-taint-"),
    ),
    [],
  );

  const tampered = structuredClone(policy);
  tampered.baselines.derivedAliasTaint = {
    ...tampered.baselines.derivedAliasTaint,
    sourceBaseSha: "2".repeat(40),
    paths: ["tests/fixture.js", "js/fixture.js"],
    diagnosticDelta: {
      ambiguousSites: [],
      unsupportedSites: [],
      memberships: [],
    },
  };
  assert.deepEqual(
    validateStateWriterPolicySchema(tampered)
      .filter(({ code }) => code.startsWith("derived-alias-taint-"))
      .map(({ code }) => code),
    [
      "derived-alias-taint-baseline-source-invalid",
      "derived-alias-taint-baseline-paths-invalid",
      "derived-alias-taint-baseline-delta-shape-invalid",
    ],
  );
});

test("derived alias diagnostic baseline transition follows exact source proof", () => {
  const sourceBaseSha = "1".repeat(40);
  const previousBaseline = {
    algorithmVersion: 1,
    sourceBaseSha,
    paths: ["js/first.js"],
    diagnosticDelta: {
      ambiguousSites: ["a"],
      unsupportedSites: ["u", "u"],
    },
  };
  const currentBaseline = {
    algorithmVersion: 1,
    sourceBaseSha,
    paths: ["js/first.js", "js/second.js"],
    diagnosticDelta: {
      ambiguousSites: ["b"],
      unsupportedSites: ["v"],
    },
  };
  assert.deepEqual(
    validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: 1,
      currentSchemaVersion: 2,
      previousPhase: "P4.1",
      currentPhase: "P4.2a",
      currentBaseline,
      expectedBaseline: currentBaseline,
    }),
    [],
  );
  assert.deepEqual(
    validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: 2,
      currentSchemaVersion: 2,
      previousBaseline,
      currentBaseline,
      expectedBaseline: currentBaseline,
    }),
    [],
  );
  assert.deepEqual(
    validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: 2,
      currentSchemaVersion: 2,
      previousPhase: "P4.2c",
      currentPhase: "P4.3",
      previousBaseline,
      currentBaseline,
      expectedBaseline: currentBaseline,
    }).map(({ code }) => code),
    ["derived-alias-taint-transition-path-proof-missing"],
  );

  const regressed = structuredClone(currentBaseline);
  regressed.paths = ["js/second.js"];
  regressed.diagnosticDelta.ambiguousSites = [];
  regressed.diagnosticDelta.unsupportedSites = ["u"];
  assert.deepEqual(
    validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: 2,
      currentSchemaVersion: 2,
      previousBaseline,
      currentBaseline: regressed,
      expectedBaseline: regressed,
    }).map(({ code }) => code),
    ["derived-alias-taint-baseline-path-regressed"],
  );

  const forged = structuredClone(currentBaseline);
  forged.diagnosticDelta.unsupportedSites.push(
    "FORGED-CURRENT-ONLY",
  );
  forged.diagnosticDelta.unsupportedSites.sort();
  assert.deepEqual(
    validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: 1,
      currentSchemaVersion: 2,
      previousPhase: "P4.1",
      currentPhase: "P4.2a",
      currentBaseline: forged,
      expectedBaseline: currentBaseline,
    }).map(({ code }) => code),
    ["derived-alias-taint-baseline-source-proof-mismatch"],
  );

  const previousWithTransition = {
    ...previousBaseline,
    transitionCheckpoints: [{
      sourceSha: "2".repeat(40),
      policyBlobSha256: "3".repeat(64),
      paths: ["js/first.js"],
    }],
  };
  const driftedTransition = {
    ...currentBaseline,
    transitionCheckpoints: [{
      ...previousWithTransition.transitionCheckpoints[0],
      policyBlobSha256: "4".repeat(64),
    }],
  };
  assert.ok(
    validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: 2,
      currentSchemaVersion: 2,
      previousBaseline: previousWithTransition,
      currentBaseline: driftedTransition,
      expectedBaseline: driftedTransition,
    }).some(
      ({ code }) =>
        code
        === "derived-alias-taint-transition-checkpoint-history-drift",
    ),
  );
});

test("policy schema validates ambiguous sites as exact positive source locations", () => {
  const invalidSites = [
    null,
    {
      line: 0,
      column: 0,
      reason: "ambiguous-alias-flow",
    },
    {
      line: 1.5,
      column: 0,
      reason: "ambiguous-alias-flow",
    },
    {
      line: 1,
      column: -1,
      reason: "ambiguous-alias-flow",
    },
    {
      line: 1,
      column: 0.5,
      reason: "ambiguous-alias-flow",
    },
    {
      line: 1,
      column: 0,
      reason: "state-alias-escape",
    },
  ];

  for (const [index, invalidSite] of invalidSites.entries()) {
    const policy = createPolicyFixture();
    policy.writers[0].bindings[0].grants[0].ambiguousSites = [invalidSite];
    assert.ok(
      validateStateWriterPolicySchema(policy).some(
        ({ code }) => code === "grant-ambiguous-site-invalid",
      ),
      `invalid ambiguous site fixture ${index}`,
    );
  }
});

test("policy schema rejects duplicate ambiguous sites within and across binding grants", () => {
  const site = {
    line: 7,
    column: 5,
    reason: "ambiguous-alias-flow",
  };
  const withinGrant = createPolicyFixture();
  withinGrant.writers[0].bindings[0].grants[0].ambiguousSites = [
    site,
    { ...site },
  ];
  assert.ok(
    validateStateWriterPolicySchema(withinGrant).some(
      ({ code }) => code === "duplicate-grant-ambiguous-site",
    ),
  );

  const acrossGrants = createPolicyFixture();
  acrossGrants.writers[0].bindings[0].grants[0].ambiguousSites = [site];
  acrossGrants.writers[0].bindings[0].grants.push({
    domain: "renderer",
    migrationPhase: "P4.3",
    operations: [],
    keys: [],
    memberships: [],
    aliasSites: [],
    dynamicSites: [],
    ambiguousSites: [{ ...site }],
    unsupportedSites: [],
  });
  assert.ok(
    validateStateWriterPolicySchema(acrossGrants).some(
      ({ code }) => code === "duplicate-binding-ambiguous-site",
    ),
  );
});

test("policy schema rejects duplicate unsupported sites within and across binding grants", () => {
  const site = {
    line: 9,
    column: 3,
    reason: "state-alias-escape",
    operation: "unsupported",
    key: "*",
  };
  const withinGrant = createPolicyFixture();
  withinGrant.writers[0].bindings[0].grants[0].unsupportedSites = [
    site,
    { ...site },
  ];
  assert.ok(
    validateStateWriterPolicySchema(withinGrant).some(
      ({ code }) => code === "duplicate-grant-unsupported-site",
    ),
  );

  const acrossGrants = createPolicyFixture();
  acrossGrants.writers[0].bindings[0].grants[0].unsupportedSites = [site];
  acrossGrants.writers[0].bindings[0].grants.push({
    domain: "renderer",
    migrationPhase: "P4.3",
    operations: [],
    keys: [],
    memberships: [],
    aliasSites: [],
    dynamicSites: [],
    ambiguousSites: [],
    unsupportedSites: [{ ...site }],
  });
  assert.ok(
    validateStateWriterPolicySchema(acrossGrants).some(
      ({ code }) => code === "duplicate-binding-unsupported-site",
    ),
  );
});

test("policy snapshot rejects stale allowlist projection and unregistered bindings", () => {
  const staleProjection = validateStateWriterPolicySnapshot({
    policy: createPolicyFixture(),
    legacyAllowlistPaths: ["js/fixture.js"],
    scans: [],
  });
  const unknownBinding = validateStateWriterPolicySnapshot({
    policy: createPolicyFixture(),
    legacyAllowlistPaths: [
      "js/fixture.js",
      "tests/fixture.test.mjs",
    ],
    scans: [
      {
        path: "js/fixture.js",
        surface: "production",
        bindingId: "unregistered-target",
        findings: [createFinding({ bindingId: "unregistered-target" })],
      },
    ],
  });

  assert.ok(
    staleProjection.violations.some(
      ({ code }) => code === "legacy-allowlist-projection-mismatch",
    ),
  );
  assert.ok(
    unknownBinding.violations.some(
      ({ code }) => code === "unknown-binding",
    ),
  );
});

test("policy snapshot admits only exact registered ambiguous alias sites", () => {
  const policy = createPolicyFixture();
  policy.writers[0].bindings[0].grants[0].ambiguousSites.push({
    line: 7,
    column: 5,
    reason: "ambiguous-alias-flow",
  });
  const registered = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans: [
      {
        path: "js/fixture.js",
        surface: "production",
        bindingId: "runtime-state",
        findings: [
          createFinding(),
          createFinding({
            operation: "unsupported",
            key: "*",
            dynamic: true,
            unsupported: true,
            reason: "ambiguous-alias-flow",
            line: 7,
            column: 5,
          }),
        ],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        bindingId: "test-state",
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
          }),
        ],
      },
    ],
  });
  const unregistered = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans: [
      {
        path: "js/fixture.js",
        surface: "production",
        bindingId: "runtime-state",
        findings: [
          createFinding(),
          createFinding({
            operation: "unsupported",
            key: "*",
            dynamic: true,
            unsupported: true,
            reason: "ambiguous-alias-flow",
            line: 8,
            column: 5,
          }),
        ],
      },
      {
        path: "tests/fixture.test.mjs",
        surface: "test",
        bindingId: "test-state",
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
          }),
        ],
      },
    ],
  });

  assert.equal(registered.verdict, "pass");
  assert.ok(
    unregistered.violations.some(
      ({ code }) => code === "unknown-ambiguous-site",
    ),
  );
});

test("default state ownership locks the 16 plus 9 and 402 plus 488 baselines", async () => {
  const report = await buildDefaultStateOwnershipReport();

  assert.equal(report.factoryGroups.length, 16);
  assert.equal(report.explicitKeys.length, 9);
  assert.equal(report.preCompatKeyCount, 402);
  assert.equal(report.compatibilityHookCount, 86);
  assert.equal(report.compatibilityHooks.includes("clearExportBakeCacheFn"), false);
  assert.equal(report.postCompatKeyCount, 488);
  assert.ok(report.authorityOnlyLazyKeys.includes("scenarioAtlantropaRevision"));
  assert.deepEqual(
    report.authorityOnlyLazyKeys.filter((key) => key.startsWith("uiHydration")),
    ["uiHydrationError", "uiHydrationStatus", "uiHydrationUpdatedAt"],
  );
  assert.deepEqual(report.collisions, []);
  assert.equal(report.actualFacadeKeyCount, 488);
  assert.deepEqual(report.unownedActualFacadeKeys, []);
  assert.deepEqual(report.registeredKeysMissingFromFacade, []);
});

test("default state ownership reports injected root-key collisions", async () => {
  const baseline = await buildDefaultStateOwnershipReport();
  const collidingKey = baseline.factoryGroups[0].keys[0];
  const report = await buildDefaultStateOwnershipReport({
    additionalFactoryGroups: [
      {
        id: "fixture-collision",
        source: "tests/fixture",
        value: {
          [collidingKey]: true,
        },
      },
    ],
  });

  assert.ok(
    report.collisions.some(({ key }) => key === collidingKey),
  );
});

test("global state import discovery resolves exact local aliases only", () => {
  const source = `
    import {
      normalizeMapSemanticMode,
      state as runtimeState,
    } from "./core/state.js";
    import { state as localFixture } from "./fixture_state.js";
    import { callRuntimeHook } from "./core/state/index.js";
  `;

  assert.deepEqual(
    discoverGlobalStateImportBindings(source),
    [
      {
        importSource: "./core/state.js",
        importedName: "state",
        localName: "runtimeState",
      },
    ],
  );
});

test("checked-in repository policy is a closed binding-scoped snapshot", async () => {
  const policy = await readSharedRepositoryPolicy();
  const { inventory } = await prepareSharedCurrentPhasePolicyInputs();
  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: inventory.legacyAllowlistPaths,
    scans: inventory.scans,
    actionDelegations: inventory.actionDelegations,
  });

  assert.equal(result.verdict, "pass", JSON.stringify(result.violations, null, 2));
  assert.deepEqual(result.metrics.legacyDirectFiles, {
    production: 75,
    test: 43,
    total: 118,
  });
  assert.equal(inventory.unknownCandidateBindings.length, 0);
});

test("repository policy builder is deterministic and never auto-grants during verification", async () => {
  const rebuildPromise = buildSharedCurrentPhasePolicy();
  const [policy, rebuilt] = await Promise.all([
    readSharedRepositoryPolicy(),
    rebuildPromise,
  ]);

  assert.deepEqual(rebuilt, policy);
  assert.equal(policy.baselines.defaultState.factoryGroups, 16);
  assert.equal(policy.baselines.defaultState.explicitKeys, 9);
  assert.equal(policy.baselines.defaultState.preCompatKeys, 402);
  assert.equal(policy.baselines.defaultState.postCompatKeys, 488);
  assert.equal(policy.baselines.defaultState.collisions, 0);
  assert.deepEqual(policy.baselines.bindingScopedMemberships.production, {
    legacyDirect: 475,
    legacyTarget: 712,
    domainAction: 0,
    compatFacade: 1,
    compatibilityOnly: 0,
    testFixture: 0,
    legacyCombined: 1187,
    all: 1188,
  });
  assert.equal(
    policy.baselines.bindingScopedSites.dynamic.production.legacyCombined,
    142,
  );
  assert.equal(
    policy.baselines.bindingScopedSites.dynamic.production.compatFacade,
    2,
  );
  assert.equal(
    policy.baselines.bindingScopedSites.dynamic.test.testFixture,
    20,
  );
  assert.equal(
    policy.baselines.bindingScopedSites.alias.production.legacyCombined,
    227,
  );
  assert.equal(
    policy.baselines.bindingScopedSites.alias.test.testFixture,
    1,
  );
  assert.equal(
    policy.baselines.bindingScopedSites.ambiguous.production.legacyCombined,
    901,
  );
  assert.equal(
    policy.baselines.bindingScopedSites.ambiguous.test.testFixture,
    17,
  );
});

test("candidate discovery covers every production JavaScript module", async () => {
  const candidates = await discoverCandidatePaths([]);

  assert.ok(candidates.includes("js/core/palette_manager.js"));
  assert.ok(
    candidates.includes(
      "js/ui/dev_workspace/dev_workspace_shell_builder.js",
    ),
  );
});

test("canonical mutation discovery remains effective after arbitrary parameter renaming", () => {
  assert.equal(
    hasCanonicalStateMutationFinding(
      [
        createFinding({
          root: "model",
          key: "bootPhase",
          pathSegments: ["bootPhase"],
        }),
      ],
      "js/fixture.js",
    ),
    true,
  );
  assert.equal(
    hasCanonicalStateMutationFinding(
      [
        createFinding({
          root: "model",
          key: "ordinaryPayloadField",
          pathSegments: ["ordinaryPayloadField"],
        }),
      ],
      "js/fixture.js",
    ),
    false,
  );
});

test("changed-source binding discovery tracks canonical writes through arbitrary parameter names", async () => {
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function updateBoot(model, ordinaryPayload) {
        model.bootPhase = "ready";
        ordinaryPayload.ordinaryPayloadField = true;
      }
    `,
    "production",
    { scanAllParameters: true },
  );

  assert.deepEqual(
    bindings.map(
      ({
        functionName,
        parameterName,
        parameterIndex,
      }) => ({
        functionName,
        parameterName,
        parameterIndex,
      }),
    ),
    [{
      functionName: "updateBoot",
      parameterName: "model",
      parameterIndex: 0,
    }],
  );
});

test("previous binding ordinals survive state-target parameter renaming", async () => {
  const previousWriter = {
    bindings: [{
      kind: "function-parameter",
      functionName: "updateBoot",
      parameterName: "runtimeState",
      parameterIndex: 0,
    }],
  };
  const bindings = await discoverStateWriterBindingsForSource(
    "js/fixture.js",
    `
      export function updateBoot(model) {
        model.bootPhase = "ready";
      }
    `,
    "production",
    { previousWriter },
  );

  assert.deepEqual(
    bindings.map(
      ({ functionName, parameterName, parameterIndex }) => ({
        functionName,
        parameterName,
        parameterIndex,
      }),
    ),
    [{
      functionName: "updateBoot",
      parameterName: "model",
      parameterIndex: 0,
    }],
  );
});

test("current policy build preserves the frozen P4.0 denominator", async () => {
  const checkedIn = await readSharedRepositoryPolicy();
  const currentPhase = checkedIn.progress.latestPhase;
  const rebuilt = await buildSharedCurrentPhasePolicy();

  assert.deepEqual(rebuilt.baseline, checkedIn.baseline);
  assert.deepEqual(rebuilt.baselines, checkedIn.baselines);
  assert.equal(rebuilt.progress.latestPhase, currentPhase);
  assert.deepEqual(
    rebuilt.progress.checkpoints.find(({ phase }) => phase === "P4.0"),
    checkedIn.progress.checkpoints.find(({ phase }) => phase === "P4.0"),
  );
});

test("policy progression rejects authority increases and phase regressions", () => {
  const previousPolicy = {
    baseline: { phase: "P4.0" },
    progress: {
      latestPhase: "P4.1",
      checkpoints: [
        {
          phase: "P4.1",
          productionLegacyDirectFiles: 70,
          productionLegacyMemberships: 700,
          productionLegacyDynamicSites: 50,
          productionLegacyAliasSites: 80,
          productionLegacyAmbiguousSites: 60,
          productionLegacyUnsupportedSites: 40,
        },
      ],
    },
  };
  const increased = validateStateWriterPolicyProgression({
    previousPolicy,
    phase: "P4.2a",
    currentMetrics: {
      productionLegacyDirectFiles: 71,
      productionLegacyMemberships: 701,
      productionLegacyDynamicSites: 51,
      productionLegacyAliasSites: 81,
      productionLegacyAmbiguousSites: 61,
      productionLegacyUnsupportedSites: 41,
    },
  });
  const regressedPhase = validateStateWriterPolicyProgression({
    previousPolicy,
    phase: "P4.0",
    currentMetrics: previousPolicy.progress.checkpoints[0],
  });

  assert.deepEqual(
    increased.violations.map(({ code }) => code),
    [
      "legacy-direct-files-increased",
      "legacy-memberships-increased",
      "legacy-dynamic-sites-increased",
      "legacy-alias-sites-increased",
      "legacy-ambiguous-sites-increased",
      "legacy-unsupported-sites-increased",
    ],
  );
  assert.deepEqual(
    regressedPhase.violations.map(({ code }) => code),
    ["phase-regression"],
  );
});

test("legacy semantic authority permits removals and rejects grant replacement", () => {
  const fixture = createPolicyFixture();
  const baseline = buildLegacyStateWriterSemanticAuthority(fixture.writers);
  assert.equal(baseline.collisions.length, 0);
  assert.deepEqual(
    validateLegacyStateWriterSemanticAuthority({
      baseline,
      writers: fixture.writers,
    }).violations,
    [],
  );
  assert.deepEqual(
    validateLegacyStateWriterSemanticAuthority({
      baseline,
      writers: [],
    }).violations,
    [],
  );

  const replaced = structuredClone(fixture.writers);
  const grant = replaced[0].bindings[0].grants[0];
  grant.operations = ["update"];
  grant.keys = ["bootMessage"];
  grant.memberships = [{
    operation: "update",
    key: "bootMessage",
  }];
  assert.deepEqual(
    validateLegacyStateWriterSemanticAuthority({
      baseline,
      writers: replaced,
    }).violations.map(({ code, section }) => [code, section]),
    [
      ["legacy-semantic-authority-added", "memberships"],
    ],
  );
});

test("legacy semantic authority freezes alias dynamic and diagnostic source sites", () => {
  const fixture = createPolicyFixture();
  const grant = fixture.writers[0].bindings[0].grants[0];
  grant.aliasSites = [{
    alias: "bootAlias",
    operation: "assign",
    key: "bootPhase",
    line: 2,
    column: 3,
    sourceFingerprint: "a".repeat(64),
  }];
  grant.dynamicSites = [{
    operation: "assign",
    key: "bootPhase",
    pathPattern: "bootPhase.*",
    line: 4,
    column: 5,
    sourceFingerprint: "b".repeat(64),
  }];
  grant.ambiguousSites = [{
    reason: "ambiguous-alias-flow",
    line: 6,
    column: 7,
    sourceFingerprint: "c".repeat(64),
  }];
  grant.unsupportedSites = [{
    reason: "unsupported-call-mutation",
    operation: "unsupported",
    key: "bootPhase",
    line: 8,
    column: 9,
    sourceFingerprint: "d".repeat(64),
  }];
  const baseline = buildLegacyStateWriterSemanticAuthority(fixture.writers);
  const replaced = structuredClone(fixture.writers);
  const replacedGrant = replaced[0].bindings[0].grants[0];
  for (const section of [
    "aliasSites",
    "dynamicSites",
    "ambiguousSites",
    "unsupportedSites",
  ]) {
    replacedGrant[section][0].sourceFingerprint = "e".repeat(64);
  }
  assert.deepEqual(
    validateLegacyStateWriterSemanticAuthority({
      baseline,
      writers: replaced,
    }).violations.map(({ section }) => section),
    [
      "aliasSites",
      "dynamicSites",
      "ambiguousSites",
      "unsupportedSites",
    ],
  );
});

test("derived alias diagnostic baseline admits frozen strict diagnostics only", async () => {
  const frozenSource = `
    export function update(model) {
      model.bootPhase = "ready";
      const box = { value: model };
      consumeUnknown(box);
    }
  `;
  const currentSource = `
    export function update(model) {
      model.bootPhase = "ready";
      const box = { value: model };
      consumeUnknown(box);
      const secondBox = { value: model };
      consumeUnknown(secondBox);
    }
  `;
  const frozenSha = "1".repeat(40);
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    frozenSource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  const legacyBaseline =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);
  const reads = [];
  const derivedAliasTaint =
    await buildFrozenDerivedAliasTaintBaseline({
      sourceBaseSha: frozenSha,
      relativePaths: ["js/fixture.js"],
      legacySemanticBaseline: legacyBaseline,
      readSourceAtRevision: async (sourceBaseSha, relativePath) => {
        reads.push([sourceBaseSha, relativePath]);
        return frozenSource;
      },
    });
  const effectiveBaseline = composeLegacySemanticBaseline({
    legacyBaseline,
    derivedAliasTaint,
  });
  const strictFrozenWriters =
    await buildFixtureLegacyWritersForSource(
      frozenSource,
      DERIVED_ALIAS_TAINT_MODES.STRICT,
    );
  const strictCurrentWriters =
    await buildFixtureLegacyWritersForSource(
      currentSource,
      DERIVED_ALIAS_TAINT_MODES.STRICT,
    );

  assert.deepEqual(reads, [[frozenSha, "js/fixture.js"]]);
  assert.equal(derivedAliasTaint.algorithmVersion, 1);
  assert.equal(derivedAliasTaint.sourceBaseSha, frozenSha);
  assert.deepEqual(derivedAliasTaint.paths, ["js/fixture.js"]);
  assert.equal(
    derivedAliasTaint.diagnosticDelta.ambiguousSites.length,
    0,
  );
  assert.equal(
    derivedAliasTaint.diagnosticDelta.unsupportedSites.length,
    1,
  );
  assert.deepEqual(
    validateLegacyStateWriterSemanticAuthority({
      baseline: effectiveBaseline,
      writers: strictFrozenWriters,
    }).violations,
    [],
  );
  assert.deepEqual(
    validateLegacyStateWriterSemanticAuthority({
      baseline: effectiveBaseline,
      writers: strictCurrentWriters,
    }).violations.map(({ code, section }) => [code, section]),
    [
      ["legacy-semantic-authority-added", "unsupportedSites"],
      ["legacy-semantic-authority-added", "unsupportedSites"],
    ],
  );
});

test("policy schema validates exact derived transition provenance", () => {
  const policy = createPolicyFixture();
  const sourceBaseSha = "1".repeat(40);
  policy.schemaVersion = 2;
  policy.baseline.sourceBaseSha = sourceBaseSha;
  policy.baselines = {
    legacySemanticAuthority:
      buildLegacyStateWriterSemanticAuthority(policy.writers),
    derivedAliasTaint: {
      algorithmVersion: 1,
      sourceBaseSha,
      paths: ["js/fixture.js"],
      diagnosticDelta: {
        ambiguousSites: [],
        unsupportedSites: [],
      },
      transitionCheckpoints: [{
        sourceSha: "2".repeat(40),
        policyBlobSha256: "3".repeat(64),
        paths: ["js/fixture.js"],
      }],
    },
  };

  assert.deepEqual(
    validateStateWriterPolicySchema(policy).filter(
      ({ code }) => code.startsWith("derived-alias-taint-transition-"),
    ),
    [],
  );

  const tampered = structuredClone(policy);
  tampered.baselines.derivedAliasTaint.transitionCheckpoints = [{
    sourceSha: "invalid",
    policyBlobSha256: "invalid",
    paths: ["js/missing.js", "js/missing.js"],
  }];
  assert.deepEqual(
    validateStateWriterPolicySchema(tampered)
      .filter(
        ({ code }) => code.startsWith("derived-alias-taint-transition-"),
      )
      .map(({ code }) => code),
    [
      "derived-alias-taint-transition-checkpoint-invalid",
      "derived-alias-taint-transition-path-invalid",
    ],
  );
});

test("new strict paths freeze at the previous accepted policy checkpoint", async () => {
  const frozenSource = `
    export function update(target, key, enabled, fallback) {
      target.bootPhase = "ready";
    }
  `;
  const acceptedSource = `
    export function update(target, key, enabled, fallback) {
      target.bootPhase = "ready";
      consumeUnknown(target.renderPerfMetrics);
      let alias = target;
      alias.bootPhase = "accepted";
      target.bootPhase[key] = true;
      alias = enabled ? fallback : target;
      alias.bootPhase = "maybe";
      consumeUnknown(target.postReadyTaskDiagnostics);
    }
  `;
  const currentSource = `
    export function update(target, key, enabled, fallback) {
      target.bootPhase = "ready";
      consumeUnknown(target.renderPerfMetrics);
      consumeUnknown(target.postReadyTaskDiagnostics);
      consumeUnknown(target.canvasLayers);
    }
  `;
  const frozenSha = "1".repeat(40);
  const acceptedSourceSha = "2".repeat(40);
  const policyBlobSha256 = "3".repeat(64);
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    frozenSource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  const legacyBaseline =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);
  const reads = [];

  await assert.rejects(
    buildFrozenDerivedAliasTaintBaseline({
      sourceBaseSha: frozenSha,
      relativePaths: ["js/fixture.js"],
      legacySemanticBaseline: legacyBaseline,
      existingBaseline: {
        algorithmVersion: 1,
        sourceBaseSha: frozenSha,
        paths: [],
        diagnosticDelta: {
          ambiguousSites: [],
          unsupportedSites: [],
        },
      },
      readSourceAtRevision: async () => frozenSource,
    }),
    ({ code }) =>
      code === "derived-alias-taint-transition-checkpoint-required",
  );

  const derivedAliasTaint = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha: frozenSha,
    relativePaths: ["js/fixture.js"],
    legacySemanticBaseline: legacyBaseline,
    acceptedPolicyCheckpoint: {
      sourceSha: acceptedSourceSha,
      policyBlobSha256,
    },
    readSourceAtRevision: async (revision, relativePath) => {
      reads.push([revision, relativePath]);
      return revision === acceptedSourceSha ? acceptedSource : frozenSource;
    },
  });
  const effectiveBaseline = composeLegacySemanticBaseline({
    legacyBaseline,
    derivedAliasTaint,
  });
  const acceptedWriters = await buildFixtureLegacyWritersForSource(
    acceptedSource,
    DERIVED_ALIAS_TAINT_MODES.STRICT,
  );
  const currentWriters = await buildFixtureLegacyWritersForSource(
    currentSource,
    DERIVED_ALIAS_TAINT_MODES.STRICT,
  );

  assert.deepEqual(reads, [[acceptedSourceSha, "js/fixture.js"]]);
  assert.deepEqual(derivedAliasTaint.transitionCheckpoints, [{
    sourceSha: acceptedSourceSha,
    policyBlobSha256,
    paths: ["js/fixture.js"],
  }]);
  assert.deepEqual(
    Object.keys(derivedAliasTaint.transitionSemanticDelta),
    [
      "bindings",
      "memberships",
      "aliasSites",
      "dynamicSites",
      "ambiguousSites",
      "unsupportedSites",
    ],
  );
  assert.deepEqual(
    derivedAliasTaint.transitionSemanticDelta.bindings,
    [],
  );
  assert.deepEqual(
    derivedAliasTaint.transitionSemanticDelta.memberships,
    [],
  );
  assert.ok([
    "aliasSites",
    "dynamicSites",
    "ambiguousSites",
    "unsupportedSites",
  ].every(
    (section) =>
      derivedAliasTaint.transitionSemanticDelta[section].length > 0,
  ));
  assert.deepEqual(
    validateLegacyStateWriterSemanticAuthority({
      baseline: effectiveBaseline,
      writers: acceptedWriters,
    }).violations,
    [],
  );
  assert.deepEqual(
    validateLegacyStateWriterSemanticAuthority({
      baseline: effectiveBaseline,
      writers: currentWriters,
    }).violations.map(({ code, section }) => [code, section]),
    [["legacy-semantic-authority-added", "unsupportedSites"]],
  );

  const replayReads = [];
  const replayed = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha: frozenSha,
    relativePaths: ["js/fixture.js"],
    legacySemanticBaseline: legacyBaseline,
    transitionCheckpoints: derivedAliasTaint.transitionCheckpoints,
    readSourceAtRevision: async (revision, relativePath) => {
      replayReads.push([revision, relativePath]);
      return revision === acceptedSourceSha ? acceptedSource : frozenSource;
    },
  });
  assert.deepEqual(replayReads, [[acceptedSourceSha, "js/fixture.js"]]);
  assert.deepEqual(replayed, derivedAliasTaint);
});

test("frozen paths replay from their exact recorded provenance", async () => {
  const sourceBaseSha = "1".repeat(40);
  const earlierSourceSha = "2".repeat(40);
  const acceptedSourceSha = "3".repeat(40);
  const earlierPolicyBlobSha256 = "4".repeat(64);
  const acceptedPolicyBlobSha256 = "5".repeat(64);
  const transitionSemanticDelta = Object.fromEntries(
    [
      "bindings",
      "memberships",
      "aliasSites",
      "dynamicSites",
      "ambiguousSites",
      "unsupportedSites",
    ].map((section) => [section, []]),
  );
  const existingBaseline = {
    algorithmVersion: 1,
    sourceBaseSha,
    paths: ["js/base-only.js", "js/earlier.js"],
    diagnosticDelta: {
      ambiguousSites: [],
      unsupportedSites: [],
    },
    transitionSemanticDelta,
    transitionCheckpoints: [{
      sourceSha: earlierSourceSha,
      policyBlobSha256: earlierPolicyBlobSha256,
      paths: ["js/earlier.js"],
    }],
  };
  const reads = [];

  const refreshed = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha,
    relativePaths: [
      "js/base-only.js",
      "js/earlier.js",
      "js/pending.js",
    ],
    legacySemanticBaseline: createEmptyLegacySemanticAuthority(),
    existingBaseline,
    acceptedPolicyCheckpoint: {
      sourceSha: acceptedSourceSha,
      policyBlobSha256: acceptedPolicyBlobSha256,
    },
    readSourceAtRevision: async (revision, relativePath) => {
      reads.push([revision, relativePath]);
      return "export function read(value) { return value; }";
    },
  });

  assert.deepEqual(reads, [
    [sourceBaseSha, "js/base-only.js"],
    [earlierSourceSha, "js/earlier.js"],
    [acceptedSourceSha, "js/pending.js"],
  ]);
  assert.deepEqual(refreshed.transitionCheckpoints, [
    existingBaseline.transitionCheckpoints[0],
    {
      sourceSha: acceptedSourceSha,
      policyBlobSha256: acceptedPolicyBlobSha256,
      paths: ["js/pending.js"],
    },
  ]);
});

test("accepted checkpoint transition semantics are append-only multisets", () => {
  const sourceBaseSha = "1".repeat(40);
  const semanticSections = [
    "bindings",
    "memberships",
    "aliasSites",
    "dynamicSites",
    "ambiguousSites",
    "unsupportedSites",
  ];
  const previousBaseline = {
    algorithmVersion: 1,
    sourceBaseSha,
    paths: ["js/first.js"],
    diagnosticDelta: {
      ambiguousSites: [],
      unsupportedSites: [],
    },
    transitionSemanticDelta: Object.fromEntries(
      semanticSections.map((section) => [
        section,
        [`accepted-${section}`],
      ]),
    ),
  };
  const currentBaseline = structuredClone(previousBaseline);
  currentBaseline.paths.push("js/second.js");
  for (const section of semanticSections) {
    currentBaseline.transitionSemanticDelta[section].push(
      `accepted-${section}-2`,
    );
  }
  currentBaseline.transitionCheckpoints = [{
    sourceSha: "2".repeat(40),
    policyBlobSha256: "3".repeat(64),
    paths: ["js/second.js"],
  }];

  assert.deepEqual(validateDerivedAliasTaintBaselineTransition({
    previousSchemaVersion: 2,
    currentSchemaVersion: 2,
    previousPhase: "P4.2c",
    currentPhase: "P4.3",
    previousBaseline,
    currentBaseline,
    expectedBaseline: currentBaseline,
  }), []);

  for (const section of semanticSections) {
    const regressed = structuredClone(currentBaseline);
    regressed.transitionSemanticDelta[section] = [];
    assert.deepEqual(
      validateDerivedAliasTaintBaselineTransition({
        previousSchemaVersion: 2,
        currentSchemaVersion: 2,
        previousPhase: "P4.2c",
        currentPhase: "P4.3",
        previousBaseline,
        currentBaseline: regressed,
        expectedBaseline: regressed,
      }).map(({
        code,
        section: violationSection,
        signature,
        previousCount,
        currentCount,
      }) => ({
        code,
        section: violationSection,
        signature,
        previousCount,
        currentCount,
      })),
      [{
        code: "derived-alias-taint-transition-semantic-regressed",
        section,
        signature: `accepted-${section}`,
        previousCount: 1,
        currentCount: 0,
      }],
      section,
    );
  }

  const duplicatePreviousBaseline = structuredClone(previousBaseline);
  duplicatePreviousBaseline.transitionSemanticDelta.memberships = [
    "duplicate-membership",
    "duplicate-membership",
  ];
  const duplicateCurrentBaseline = structuredClone(currentBaseline);
  duplicateCurrentBaseline.transitionSemanticDelta.memberships = [
    "duplicate-membership",
  ];
  assert.deepEqual(
    validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: 2,
      currentSchemaVersion: 2,
      previousPhase: "P4.2c",
      currentPhase: "P4.3",
      previousBaseline: duplicatePreviousBaseline,
      currentBaseline: duplicateCurrentBaseline,
      expectedBaseline: duplicateCurrentBaseline,
    }).map(({
      code,
      section,
      signature,
      previousCount,
      currentCount,
    }) => ({
      code,
      section,
      signature,
      previousCount,
      currentCount,
    })),
    [{
      code: "derived-alias-taint-transition-semantic-regressed",
      section: "memberships",
      signature: "duplicate-membership",
      previousCount: 2,
      currentCount: 1,
    }],
  );
});

test("derived alias diagnostic baseline classifies unknown historical plan fields with path fallback authority", async () => {
  const legacySource = `
    export function inspectPlan(plan) {
      plan.bootPhase = "ready";
    }
  `;
  const frozenSource = `
    export function inspectPlan(plan) {
      plan.bootPhase = "ready";
      plan.deferredExactTargetPasses = [];
      consumeUnknown(plan.forceExactContextBaseRefresh);
    }
  `;
  const frozenSha = "1".repeat(40);
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    legacySource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  const legacyBaseline =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);

  const derivedAliasTaint = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha: frozenSha,
    relativePaths: ["js/fixture.js"],
    legacySemanticBaseline: legacyBaseline,
    readSourceAtRevision: async () => frozenSource,
  });

  assert.equal(
    derivedAliasTaint.diagnosticDelta.unsupportedSites.length,
    1,
  );
  assert.match(
    derivedAliasTaint.diagnosticDelta.unsupportedSites[0],
    /forceExactContextBaseRefresh/,
  );
});

test("accepted transition semantics exclude non-state plan parameters", async () => {
  const frozenSha = "1".repeat(40);
  const acceptedSourceSha = "2".repeat(40);
  const policyBlobSha256 = "3".repeat(64);
  const legacySource = `
    export function createScheduler({ runtimeState }) {
      runtimeState.bootPhase = "ready";
    }
  `;
  const acceptedSource = `
    export function createScheduler({ runtimeState }) {
      runtimeState.bootPhase = "ready";
    }
    export function inspectPlan(plan) {
      plan.deferredExactTargetPasses = [];
    }
  `;
  const relativePath =
    "js/core/map_renderer/exact_after_settle_scheduler.js";
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    legacySource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
    relativePath,
  );
  const legacyBaseline =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);

  const derivedAliasTaint = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha: frozenSha,
    relativePaths: [relativePath],
    legacySemanticBaseline: legacyBaseline,
    existingBaseline: {
      algorithmVersion: 1,
      sourceBaseSha: frozenSha,
      paths: [],
      diagnosticDelta: {
        ambiguousSites: [],
        unsupportedSites: [],
      },
    },
    acceptedPolicyCheckpoint: {
      sourceSha: acceptedSourceSha,
      policyBlobSha256,
    },
    readSourceAtRevision: async () => acceptedSource,
  });

  assert.deepEqual(
    derivedAliasTaint.transitionSemanticDelta.memberships,
    [],
  );
});

test("checker recomputes derived alias diagnostics from frozen source", async () => {
  const sourceBaseSha = "1".repeat(40);
  const frozenSource = `
    export function update(model) {
      model.bootPhase = "ready";
      const box = { value: model };
      consumeUnknown(box);
    }
  `;
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    frozenSource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  const legacySemanticAuthority =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);
  const previousPolicy = {
    schemaVersion: 1,
    baseline: { sourceBaseSha },
    baselines: { legacySemanticAuthority },
    progress: { latestPhase: "P4.1" },
    writers: legacyWriters,
  };
  const currentPolicy = {
    schemaVersion: 2,
    baseline: { sourceBaseSha },
    baselines: { legacySemanticAuthority },
    progress: { latestPhase: "P4.2a" },
  };
  const runGit = (args) => {
    const joined = args.join(" ");
    if (
      joined
      === `rev-parse --verify ${sourceBaseSha}^{commit}`
    ) {
      return `${sourceBaseSha}\n`;
    }
    if (
      joined
      === `merge-base --is-ancestor ${sourceBaseSha} HEAD`
    ) {
      return "";
    }
    if (
      joined === `diff --name-only ${sourceBaseSha} -- js`
    ) {
      return "js/fixture.js\n";
    }
    if (
      joined === "ls-files --others --exclude-standard -- js"
    ) {
      return "";
    }
    throw new Error(`unexpected git call: ${joined}`);
  };
  const historicalDerivedAliasProofCache = new Map();
  let sourceReads = 0;
  const recompute = () => recomputeDerivedAliasTaintBaseline({
    previousPolicy,
    currentPolicy,
    candidatePaths: ["js/fixture.js"],
    runGit,
    historicalDerivedAliasProofCache,
    readSourceAtRevision: async (revision, relativePath) => {
      sourceReads += 1;
      assert.equal(revision, sourceBaseSha);
      assert.equal(relativePath, "js/fixture.js");
      return frozenSource;
    },
  });
  const expected = await recompute();
  const reused = await recompute();

  assert.equal(sourceReads, 1);
  assert.deepEqual(reused, expected);
  assert.equal(expected.diagnosticDelta.ambiguousSites.length, 0);
  assert.equal(expected.diagnosticDelta.unsupportedSites.length, 1);
  assert.deepEqual(
    validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: 1,
      currentSchemaVersion: 2,
      previousPhase: "P4.1",
      currentPhase: "P4.2a",
      currentBaseline: expected,
      expectedBaseline: expected,
    }),
    [],
  );
});

test("derived alias diagnostic baseline never admits newly visible memberships", async () => {
  const frozenSource = `
    function identity(value) {
      return value;
    }
    export function update(model) {
      model.bootPhase = "ready";
      const alias = identity(model);
      alias.bootBlocking = false;
    }
  `;
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    frozenSource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  const strictWriters = await buildFixtureLegacyWritersForSource(
    frozenSource,
    DERIVED_ALIAS_TAINT_MODES.STRICT,
  );
  const legacyBaseline =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);
  const strictAuthority =
    buildLegacyStateWriterSemanticAuthority(strictWriters);
  const derivedAliasTaint = {
    algorithmVersion: 1,
    sourceBaseSha: "1".repeat(40),
    paths: ["js/fixture.js"],
    diagnosticDelta: buildDerivedAliasTaintDiagnosticDelta({
      legacySemanticBaseline: legacyBaseline,
      strictSemanticAuthority: strictAuthority,
    }),
  };
  const effectiveBaseline = composeLegacySemanticBaseline({
    legacyBaseline,
    derivedAliasTaint,
  });

  assert.deepEqual(
    validateLegacyStateWriterSemanticAuthority({
      baseline: effectiveBaseline,
      writers: strictWriters,
    }).violations.map(({ section }) => section),
    ["memberships", "aliasSites"],
  );
});

test("derived alias diagnostic baseline composes additive diagnostic multiplicity", () => {
  const legacyBaseline = createEmptyLegacySemanticAuthority();
  legacyBaseline.ambiguousSites = ["a", "a"];
  legacyBaseline.unsupportedSites = ["u"];
  legacyBaseline.bindings = ["legacy-binding"];
  legacyBaseline.memberships = ["legacy-membership"];
  legacyBaseline.aliasSites = ["legacy-alias"];
  legacyBaseline.dynamicSites = ["legacy-dynamic"];
  const effectiveBaseline = composeLegacySemanticBaseline({
    legacyBaseline,
    derivedAliasTaint: {
      diagnosticDelta: {
        ambiguousSites: ["a", "a", "a", "b"],
        unsupportedSites: ["u"],
        bindings: ["diagnostic-binding"],
        memberships: ["diagnostic-membership"],
        aliasSites: ["diagnostic-alias"],
        dynamicSites: ["diagnostic-dynamic"],
      },
    },
  });

  assert.deepEqual(
    effectiveBaseline.ambiguousSites,
    ["a", "a", "a", "a", "a", "b"],
  );
  assert.deepEqual(effectiveBaseline.unsupportedSites, ["u", "u"]);
  assert.deepEqual(effectiveBaseline.bindings, ["legacy-binding"]);
  assert.deepEqual(effectiveBaseline.memberships, ["legacy-membership"]);
  assert.deepEqual(effectiveBaseline.aliasSites, ["legacy-alias"]);
  assert.deepEqual(effectiveBaseline.dynamicSites, ["legacy-dynamic"]);
});

test("previous-active authority receives only the incremental derived baseline", () => {
  const previousBaseline = {
    algorithmVersion: 1,
    sourceBaseSha: "1".repeat(40),
    paths: ["js/first.js"],
    diagnosticDelta: {
      ambiguousSites: ["a"],
      unsupportedSites: ["u", "u"],
    },
  };
  const currentBaseline = {
    algorithmVersion: 1,
    sourceBaseSha: "1".repeat(40),
    paths: ["js/first.js", "js/second.js"],
    diagnosticDelta: {
      ambiguousSites: ["a", "b"],
      unsupportedSites: ["u", "u", "v"],
    },
  };

  assert.deepEqual(
    buildIncrementalDerivedAliasTaintBaseline({
      currentBaseline,
      previousBaseline,
    }),
    {
      algorithmVersion: 1,
      sourceBaseSha: "1".repeat(40),
      paths: ["js/second.js"],
      diagnosticDelta: {
        ambiguousSites: ["b"],
        unsupportedSites: ["v"],
      },
    },
  );
});

test("derived alias diagnostic baseline removes only admitted progress counts", () => {
  assert.deepEqual(
    buildUnbaselinedLegacyDiagnosticCounts({
      legacySemanticAuthority: {
        ambiguousSites: ["a", "a", "b"],
        unsupportedSites: ["u", "u"],
      },
      derivedAliasTaint: {
        diagnosticDelta: {
          ambiguousSites: ["a", "a", "a"],
          unsupportedSites: ["u"],
        },
      },
    }),
    {
      ambiguousSites: 1,
      unsupportedSites: 1,
    },
  );
});

test("legacy semantic authority preserves duplicate site multiplicity", () => {
  const fixture = createPolicyFixture();
  const grant = fixture.writers[0].bindings[0].grants[0];
  const site = {
    alias: "bootAlias",
    operation: "assign",
    key: "bootPhase",
    line: 2,
    column: 3,
    sourceFingerprint: "a".repeat(64),
  };
  grant.aliasSites = [site];
  const baseline = buildLegacyStateWriterSemanticAuthority(fixture.writers);
  grant.aliasSites = [site, { ...site, line: 9, column: 10 }];
  const validation = validateLegacyStateWriterSemanticAuthority({
    baseline,
    writers: fixture.writers,
  });
  assert.deepEqual(
    validation.violations.map(
      ({ code, section, allowedCount, actualCount }) => ({
        code,
        section,
        allowedCount,
        actualCount,
      }),
    ),
    [{
      code: "legacy-semantic-authority-added",
      section: "aliasSites",
      allowedCount: 1,
      actualCount: 2,
    }],
  );
});

test("legacy semantic retirement accepts exact diagnostic proof replacement", () => {
  const baseline = createEmptyLegacySemanticAuthority();
  baseline.ambiguousSites = ["current-ambiguous-proof"];
  baseline.unsupportedSites = ["current-unsupported-proof"];
  const retired = subtractLegacyStateWriterSemanticAuthority(
    baseline,
    buildLegacyStateWriterSemanticAuthority([]),
  );
  const previousRetired = createEmptyLegacySemanticAuthority();
  previousRetired.ambiguousSites = ["previous-ambiguous-proof"];
  previousRetired.unsupportedSites = ["previous-unsupported-proof"];

  assert.deepEqual(
    validateLegacyStateWriterSemanticLedger({
      baseline,
      writers: [],
      retired,
      previousRetired,
    }).violations,
    [],
  );
});

test("legacy semantic retirement blocks cumulative authority reintroduction", () => {
  const fixture = createPolicyFixture();
  fixture.writers[0].bindings[0].grants[0].aliasSites = [{
    alias: "bootAlias",
    aliasChain: ["state", "bootAlias"],
    operation: "assign",
    key: "bootPhase",
    line: 2,
    column: 3,
    sourceFingerprint: "a".repeat(64),
  }];
  const baseline = buildLegacyStateWriterSemanticAuthority(fixture.writers);
  const emptyCurrent = buildLegacyStateWriterSemanticAuthority([]);
  const retired = subtractLegacyStateWriterSemanticAuthority(
    baseline,
    emptyCurrent,
  );
  assert.deepEqual(
    validateLegacyStateWriterSemanticLedger({
      baseline,
      writers: [],
      retired,
    }).violations,
    [],
  );
  assert.deepEqual(
    validateLegacyStateWriterSemanticLedger({
      baseline,
      writers: fixture.writers,
      retired: subtractLegacyStateWriterSemanticAuthority(
        baseline,
        buildLegacyStateWriterSemanticAuthority(fixture.writers),
      ),
      previousWriters: [],
      previousRetired: retired,
    }).violations
      .filter(({ code }) =>
        code === "legacy-semantic-retirement-regressed"
      )
      .map(({ section }) => section),
    [
      "bindings",
      "memberships",
      "aliasSites",
    ],
  );
});

test("legacy semantic retirement ledger rejects exact baseline drift", () => {
  const baseline = createEmptyLegacySemanticAuthority();
  baseline.memberships = ["retired-membership"];
  baseline.ambiguousSites = ["current-ambiguous-proof"];
  const retired = subtractLegacyStateWriterSemanticAuthority(
    baseline,
    buildLegacyStateWriterSemanticAuthority([]),
  );

  assert.deepEqual(
    validateLegacyStateWriterSemanticLedger({
      baseline,
      writers: [],
      retired: {
        ...retired,
        memberships: [],
        ambiguousSites: ["stale-ambiguous-proof"],
      },
    }).violations.map(({ code, section }) => [code, section]),
    [
      ["legacy-semantic-retired-ledger-drift", "memberships"],
      ["legacy-semantic-retired-ledger-drift", "ambiguousSites"],
    ],
  );
});

test("legacy semantic retirement allows current authority within the frozen baseline", () => {
  const fixture = createPolicyFixture();
  const baseline = buildLegacyStateWriterSemanticAuthority(fixture.writers);
  assert.deepEqual(
    validateLegacyStateWriterSemanticLedger({
      baseline,
      writers: fixture.writers,
      retired: subtractLegacyStateWriterSemanticAuthority(
        baseline,
        buildLegacyStateWriterSemanticAuthority(fixture.writers),
      ),
      previousWriters: [],
      previousAuthorityBaseline: baseline,
    }).violations,
    [],
  );
});

test("legacy membership retirement requires a matching domain action replacement", () => {
  const fixture = createPolicyFixture();
  const previousWriters = [fixture.writers[0]];
  assert.deepEqual(
    validateLegacyMembershipRetirementReplacements({
      previousWriters,
      writers: [],
    }).map(({ code, key }) => [code, key]),
    [
      ["legacy-membership-retirement-replacement-missing", "bootPhase"],
    ],
  );

  const actionWriter = structuredClone(fixture.writers[0]);
  actionWriter.path = "js/core/state/actions/boot_actions.js";
  actionWriter.authority = "domain-action";
  actionWriter.bindings[0] = {
    ...actionWriter.bindings[0],
    kind: "function-parameter",
    functionName: "setBootStateFields",
    parameterIndex: 0,
    parameterPath: "$",
    authority: "domain-action",
  };
  assert.deepEqual(
    validateLegacyMembershipRetirementReplacements({
      previousWriters,
      writers: [actionWriter],
    }).map(({ code, key }) => [code, key]),
    [
      ["legacy-membership-retirement-replacement-missing", "bootPhase"],
    ],
  );
  const callerBindingIdentity =
    buildStableStateBindingIdentity(
      previousWriters[0].bindings[0],
    );
  assert.deepEqual(
    validateLegacyMembershipRetirementReplacements({
      previousWriters,
      writers: [actionWriter],
      callerToActionLedger: {
        schemaVersion: 1,
        entries: [{
          retiredMembershipIdentity: [
            "js/fixture.js",
            callerBindingIdentity,
            "boot",
            "P4.1",
            "assign",
            "bootPhase",
          ].join("|"),
          callerPath: "js/fixture.js",
          callerBindingIdentity,
          domain: "boot",
          migrationPhase: "P4.1",
          operation: "assign",
          key: "bootPhase",
          actionModulePath:
            "js/core/state/actions/boot_actions.js",
          actionExportName: "setBootStateFields",
        }],
      },
    }),
    [],
  );
});

test("caller-to-action ledger schema rejects malformed duplicate and unsorted entries", () => {
  const first = createCallerActionLedgerEntry(0);
  const second = createCallerActionLedgerEntry(1);
  const cases = [
    {
      name: "schema version",
      mutate(policy) {
        policy.progress.callerToActionLedger.schemaVersion = 2;
      },
      expectedCode: "caller-action-ledger-schema-version-invalid",
    },
    {
      name: "malformed entry",
      mutate(policy) {
        policy.progress.callerToActionLedger.entries[0].callerPath = "";
      },
      expectedCode: "caller-action-ledger-entry-invalid",
    },
    {
      name: "forged backfill provenance",
      mutate(policy) {
        const entry =
          policy.progress.callerToActionLedger.entries[0];
        entry.retiredInPhase = "P4.0";
        entry.recordedInPhase = "P4.1";
        entry.backfilled = false;
      },
      expectedCode: "caller-action-ledger-entry-invalid",
    },
    {
      name: "duplicate entry",
      entries: [first, structuredClone(first)],
      expectedCode: "caller-action-ledger-entry-duplicate",
    },
    {
      name: "unsorted entries",
      entries: [second, first],
      expectedCode: "caller-action-ledger-order-invalid",
    },
  ];

  for (const fixture of cases) {
    const policy = createCallerActionLedgerPolicy(
      structuredClone(fixture.entries || [first]),
    );
    fixture.mutate?.(policy);
    const violations = validateStateWriterPolicySchema(policy);
    assert.ok(
      violations.some(({ code }) => code === fixture.expectedCode),
      `${fixture.name}: ${JSON.stringify(violations, null, 2)}`,
    );
  }
});

test("P4.2a bootstrap extracts exact P4.1 backfill coverage from an intermediate ledger", () => {
  const first = createCallerActionLedgerEntry(0);
  const second = createCallerActionLedgerEntry(1);
  const later = {
    ...createCallerActionLedgerEntry(2),
    retiredInPhase: "P4.2a",
    recordedInPhase: "P4.2a",
    backfilled: false,
  };
  const previousPolicy = {
    progress: {
      latestPhase: "P4.1",
      retiredLegacySemanticAuthority: {
        ...createEmptyLegacySemanticAuthority(),
        memberships: [
          first.retiredMembershipIdentity,
          second.retiredMembershipIdentity,
        ].sort(),
      },
    },
  };
  const transitionPolicy = {
    schemaVersion: 1,
    progress: {
      latestPhase: "P4.2a",
      callerToActionLedger: {
        schemaVersion: 1,
        entries: [later, second, first],
      },
    },
  };

  assert.deepEqual(
    extractP42aCallerToActionBootstrapSeed({
      previousPolicy,
      transitionPolicy,
    }).map(({ retiredMembershipIdentity }) =>
      retiredMembershipIdentity
    ),
    [
      first.retiredMembershipIdentity,
      second.retiredMembershipIdentity,
    ].sort(),
  );

  transitionPolicy.progress.callerToActionLedger.entries = [
    first,
    structuredClone(first),
    later,
  ];
  assert.throws(
    () =>
      extractP42aCallerToActionBootstrapSeed({
        previousPolicy,
        transitionPolicy,
      }),
    (error) =>
      error?.code
      === "caller-action-ledger-transition-coverage-invalid",
  );
});

test("P4.2a bootstrap seed selects and regenerates the current action edge", () => {
  const previousWriter = createPolicyFixture().writers[0];
  const previousBinding = previousWriter.bindings[0];
  const callerBindingIdentity =
    buildStableStateBindingIdentity(previousBinding);
  const retiredLegacySemanticAuthority =
    subtractLegacyStateWriterSemanticAuthority(
      buildLegacyStateWriterSemanticAuthority([previousWriter]),
      buildLegacyStateWriterSemanticAuthority([]),
    );
  const [retiredMembershipIdentity] =
    retiredLegacySemanticAuthority.memberships;
  const previousPolicy = {
    writers: [previousWriter],
    progress: {
      latestPhase: "P4.1",
      retiredLegacySemanticAuthority,
    },
  };
  const actionWriter = structuredClone(previousWriter);
  actionWriter.path = "js/core/state/actions/boot_actions.js";
  actionWriter.authority = "domain-action";
  actionWriter.bindings[0] = {
    ...actionWriter.bindings[0],
    id: "function:setBootStateFields:0:$",
    kind: "function-parameter",
    functionName: "setBootStateFields",
    parameterIndex: 0,
    parameterPath: "$",
    authority: "domain-action",
  };
  const enclosingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "replacementCaller", ordinal: 0 }],
  });
  const currentEdge = {
    callerPath: previousWriter.path,
    callerBindingId: previousBinding.id,
    callerBindingIdentity,
    enclosingFunctionIdentity,
    actionModulePath: actionWriter.path,
    actionExportName: "setBootStateFields",
    targetArgumentIndex: 0,
    start: 240,
    end: 280,
    line: 24,
    column: 3,
    sourceFingerprint: "b".repeat(64),
  };
  const seed = {
    retiredMembershipIdentity,
    callerPath: previousWriter.path,
    callerBindingIdentity,
    actionModulePath: actionWriter.path,
    actionExportName: "setBootStateFields",
    targetArgumentIndex: 0,
    actionCallEdgeIdentity: "f".repeat(64),
    occurrenceIndex: 0,
    sourceFingerprint: currentEdge.sourceFingerprint,
    retiredInPhase: "P4.1",
    recordedInPhase: "P4.2a",
    backfilled: true,
  };
  const [normalizedCurrentEdge] =
    normalizeStateActionDelegations([currentEdge]);
  const ledger = buildCallerToActionLedger({
    phase: "P4.2a",
    previousPolicy,
    bootstrapSeedEntries: [seed],
    writers: [actionWriter],
    retiredLegacySemanticAuthority,
    actionDelegations: [currentEdge],
  });

  assert.equal(ledger.entries.length, 1);
  assert.equal(
    ledger.entries[0].actionCallEdgeIdentity,
    normalizedCurrentEdge.actionCallEdgeIdentity,
  );
  assert.equal(ledger.entries[0].start, currentEdge.start);
  assert.equal(
    ledger.entries[0].proofPrecision,
    "historical-backfill",
  );
  assert.throws(
    () =>
      buildCallerToActionLedger({
        phase: "P4.2a",
        previousPolicy,
        bootstrapSeedEntries: [seed, structuredClone(seed)],
        writers: [actionWriter],
        retiredLegacySemanticAuthority,
        actionDelegations: [currentEdge],
      }),
    (error) =>
      error?.code
      === "caller-action-ledger-bootstrap-seed-invalid",
  );
});

test("same-phase policy rebuild refreshes live caller evidence", () => {
  const entry = createCallerActionLedgerEntry(0);
  const initialEdge = createActionDelegationObservation(entry);
  const [normalizedInitialEdge] =
    normalizeStateActionDelegations([initialEdge]);
  Object.assign(entry, {
    actionCallEdgeIdentity:
      normalizedInitialEdge.actionCallEdgeIdentity,
    occurrenceIndex: normalizedInitialEdge.occurrenceIndex,
  });
  const previousPolicy =
    createCallerActionLedgerPolicy([entry]);
  const movedEdge = {
    ...initialEdge,
    callerBindingId: "module:runtimeState:shifted",
    start: initialEdge.start + 500,
    end: initialEdge.end + 500,
    line: initialEdge.line + 17,
    column: initialEdge.column + 2,
    sourceFingerprint: "e".repeat(64),
  };

  const ledger = buildCallerToActionLedger({
    phase: "P4.2a",
    previousPolicy,
    writers: previousPolicy.writers,
    retiredLegacySemanticAuthority:
      previousPolicy.progress.retiredLegacySemanticAuthority,
    actionDelegations: [movedEdge],
  });

  assert.deepEqual(
    {
      callerBindingId: ledger.entries[0].callerBindingId,
      start: ledger.entries[0].start,
      end: ledger.entries[0].end,
      line: ledger.entries[0].line,
      column: ledger.entries[0].column,
      sourceFingerprint: ledger.entries[0].sourceFingerprint,
    },
    {
      callerBindingId: movedEdge.callerBindingId,
      start: movedEdge.start,
      end: movedEdge.end,
      line: movedEdge.line,
      column: movedEdge.column,
      sourceFingerprint: movedEdge.sourceFingerprint,
    },
  );
  assert.equal(
    ledger.entries[0].retiredMembershipIdentity,
    entry.retiredMembershipIdentity,
  );
  assert.equal(
    ledger.entries[0].recordedInPhase,
    entry.recordedInPhase,
  );
});

test("later same-phase policy rebuild freezes earlier-phase caller evidence", () => {
  const entry = createCallerActionLedgerEntry(0);
  const initialEdge = createActionDelegationObservation(entry);
  const [normalizedInitialEdge] =
    normalizeStateActionDelegations([initialEdge]);
  Object.assign(entry, {
    actionCallEdgeIdentity:
      normalizedInitialEdge.actionCallEdgeIdentity,
    occurrenceIndex: normalizedInitialEdge.occurrenceIndex,
  });
  const previousPolicy = createCallerActionLedgerPolicy([entry]);
  previousPolicy.progress.latestPhase = "P4.3";
  const movedEdge = {
    ...initialEdge,
    callerBindingId: "module:runtimeState:shifted",
    start: initialEdge.start + 500,
    end: initialEdge.end + 500,
    line: initialEdge.line + 17,
    column: initialEdge.column + 2,
    sourceFingerprint: "e".repeat(64),
  };

  const ledger = buildCallerToActionLedger({
    phase: "P4.3",
    previousPolicy,
    writers: previousPolicy.writers,
    retiredLegacySemanticAuthority:
      previousPolicy.progress.retiredLegacySemanticAuthority,
    actionDelegations: [movedEdge],
  });

  assert.deepEqual(
    {
      callerBindingId: ledger.entries[0].callerBindingId,
      start: ledger.entries[0].start,
      end: ledger.entries[0].end,
      line: ledger.entries[0].line,
      column: ledger.entries[0].column,
      sourceFingerprint: ledger.entries[0].sourceFingerprint,
    },
    {
      callerBindingId: entry.callerBindingId,
      start: entry.start,
      end: entry.end,
      line: entry.line,
      column: entry.column,
      sourceFingerprint: entry.sourceFingerprint,
    },
  );
  assert.throws(
    () => buildCallerToActionLedger({
      phase: "P4.3",
      previousPolicy,
      writers: previousPolicy.writers,
      retiredLegacySemanticAuthority:
        previousPolicy.progress.retiredLegacySemanticAuthority,
      actionDelegations: [],
    }),
    (error) => error?.code === "caller-action-ledger-proof-missing",
  );
});

test("state action policy bindings admit only explicitly registered dynamic state paths", () => {
  const modulePath = "js/core/state/actions/renderer_diagnostics_actions.js";
  const dynamicSite = {
    line: 35,
    column: 3,
    operation: "assign",
    key: "renderPerfMetrics",
    pathPattern: "renderPerfMetrics.*",
    sourceFingerprint: "a".repeat(64),
  };
  const createEntry = (allowedDynamicSites = []) => ({
    modulePath,
    exportName: "setRenderPerfMetricEntryState",
    targetArgumentIndex: 0,
    introducedInPhase: "P4.3",
    allowedDynamicSites,
  });
  const createWriter = (site = dynamicSite) => ({
    path: modulePath,
    authority: "domain-action",
    bindings: [{
      id: "parameter:setRenderPerfMetricEntryState:0:fixture",
      kind: "function-parameter",
      functionName: "setRenderPerfMetricEntryState",
      parameterName: "target",
      parameterIndex: 0,
      parameterPath: "$",
      authority: "domain-action",
      grants: [{
        aliasSites: [],
        dynamicSites: [site],
        ambiguousSites: [],
        unsupportedSites: [],
      }],
    }],
  });
  const validate = ({ entry, writer = createWriter() }) =>
    validateStateActionPolicyBindings([writer], {
      contractEntries: [entry],
      modulePaths: [modulePath],
    }).map(({ code }) => code);

  assert.deepEqual(
    validate({
      entry: createEntry([{
        operation: "assign",
        key: "renderPerfMetrics",
        pathPattern: "renderPerfMetrics.*",
      }]),
    }),
    [],
  );
  assert.deepEqual(
    validate({ entry: createEntry() }),
    ["state-action-policy-binding-diagnostics-invalid"],
  );
  assert.deepEqual(
    validate({
      entry: createEntry([{
        operation: "assign",
        key: "renderPerfMetrics",
        pathPattern: "renderPerfMetrics.contextBreakdown.*",
      }]),
    }),
    ["state-action-policy-binding-diagnostics-invalid"],
  );
});

test("renderer diagnostics action source admits only its two registered metric dictionary writes", async () => {
  const modulePath = "js/core/state/actions/renderer_diagnostics_actions.js";
  const source = fs.readFileSync(modulePath, "utf8");
  const { bindingInventories } = await discoverStateWriterBindingsForSource(
    modulePath,
    source,
    "production",
    { includeInventories: true },
  );
  const stateKeyAuthorityIndex = buildCanonicalStateKeyAuthorityIndex();
  const writer = {
    path: modulePath,
    authority: "domain-action",
    bindings: bindingInventories.map(({ binding, findings }) => ({
      ...binding,
      authority: "domain-action",
      grants: buildStateWriterBindingGrants(
        findings,
        modulePath,
        stateKeyAuthorityIndex,
        "production",
      ),
    })),
  };
  const contractEntries = STATE_ACTION_DELEGATION_CONTRACT.filter(
    ({ modulePath: entryModulePath }) => entryModulePath === modulePath,
  );
  const metricBindings = writer.bindings.filter(({ functionName }) =>
    [
      "setRenderPerfMetricEntryState",
      "commitRenderPerfMetricState",
    ].includes(functionName)
  );

  assert.equal(metricBindings.length, 2);
  assert.deepEqual(
    metricBindings.flatMap(({ grants }) =>
      grants.flatMap(({ dynamicSites }) => dynamicSites)
    ).map(({ operation, key, pathPattern }) => ({
      operation,
      key,
      pathPattern,
    })),
    [
      {
        operation: "define-property",
        key: "renderPerfMetrics",
        pathPattern: "renderPerfMetrics.*",
      },
      {
        operation: "assign",
        key: "renderPerfMetrics",
        pathPattern: "renderPerfMetrics.*",
      },
      {
        operation: "define-property",
        key: "renderPerfMetrics",
        pathPattern: "renderPerfMetrics.*",
      },
      {
        operation: "assign",
        key: "renderPerfMetrics",
        pathPattern: "renderPerfMetrics.*",
      },
    ],
  );
  assert.deepEqual(
    validateStateActionPolicyBindings([writer], {
      contractEntries,
      modulePaths: [modulePath],
    }),
    [],
  );
  assert.deepEqual(
    validateStateActionPolicyBindings([writer], {
      contractEntries: contractEntries.map((entry) => ({
        ...entry,
        allowedDynamicSites: [],
      })),
      modulePaths: [modulePath],
    }).map(({ code, exportName }) => ({ code, exportName })),
    [
      {
        code: "state-action-policy-binding-diagnostics-invalid",
        exportName: "setRenderPerfMetricEntryState",
      },
      {
        code: "state-action-policy-binding-diagnostics-invalid",
        exportName: "commitRenderPerfMetricState",
      },
    ],
  );
});

test("existing frozen paths refresh strict diagnostics additively", async () => {
  const sourceBaseSha = "1".repeat(40);
  const legacySource = `
    export function update(model) {
      model.bootPhase = "ready";
    }
  `;
  const frozenSource = `
    export function update(model) {
      model.bootPhase = "ready";
      consumeUnknown({ first: model });
      consumeUnknown({ second: model });
    }
  `;
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    legacySource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  const legacySemanticBaseline =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);
  const completeBaseline = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha,
    relativePaths: ["js/fixture.js"],
    legacySemanticBaseline,
    readSourceAtRevision: async () => frozenSource,
  });
  assert.equal(
    completeBaseline.diagnosticDelta.unsupportedSites.length,
    2,
  );
  const partialBaseline = structuredClone(completeBaseline);
  partialBaseline.diagnosticDelta.unsupportedSites.pop();
  const reads = [];

  const refreshed = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha,
    relativePaths: ["js/fixture.js"],
    legacySemanticBaseline,
    existingBaseline: partialBaseline,
    readSourceAtRevision: async (revision, relativePath) => {
      reads.push([revision, relativePath]);
      return frozenSource;
    },
  });

  assert.deepEqual(reads, [[sourceBaseSha, "js/fixture.js"]]);
  assert.deepEqual(refreshed.diagnosticDelta, completeBaseline.diagnosticDelta);
});

test("existing frozen proof is replaced exactly by current frozen-source recompute", async () => {
  const sourceBaseSha = "1".repeat(40);
  const legacySource = `
    export function update(model) {
      model.bootPhase = "ready";
    }
  `;
  const frozenSource = `
    export function update(model) {
      model.bootPhase = "ready";
      consumeUnknown({ retained: model });
      consumeUnknown({ added: model });
      consumeUnknown({ additional: model });
    }
  `;
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    legacySource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  const legacySemanticBaseline =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);
  const expectedBaseline = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha,
    relativePaths: ["js/fixture.js"],
    legacySemanticBaseline,
    readSourceAtRevision: async () => frozenSource,
  });
  const existingBaseline = structuredClone(expectedBaseline);
  const expectedUnsupported =
    expectedBaseline.diagnosticDelta.unsupportedSites;
  assert.equal(expectedUnsupported.length, 3);
  const currentSignature =
    existingBaseline.diagnosticDelta.unsupportedSites.pop();
  const staleSignature = `${currentSignature}|legacy-scanner-expression`;
  existingBaseline.diagnosticDelta.unsupportedSites.push(staleSignature);
  existingBaseline.diagnosticDelta.unsupportedSites.sort();
  const previousCurrentCount =
    existingBaseline.diagnosticDelta.unsupportedSites.filter(
      (signature) => signature === currentSignature,
    ).length;
  const expectedCurrentCount = expectedUnsupported.filter(
    (signature) => signature === currentSignature,
  ).length;

  assert.ok(
    expectedCurrentCount > previousCurrentCount,
  );
  assert.ok(
    existingBaseline.diagnosticDelta.unsupportedSites.includes(
      staleSignature,
    ),
  );
  assert.ok(!expectedUnsupported.includes(staleSignature));

  const refreshed = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha,
    relativePaths: ["js/fixture.js"],
    legacySemanticBaseline,
    existingBaseline,
    readSourceAtRevision: async () => frozenSource,
  });

  assert.deepEqual(
    refreshed.diagnosticDelta,
    expectedBaseline.diagnosticDelta,
  );
  assert.ok(
    !refreshed.diagnosticDelta.unsupportedSites.includes(staleSignature),
  );
});

test("existing frozen path refresh preserves accepted transition semantics", async () => {
  const sourceBaseSha = "1".repeat(40);
  const acceptedSourceSha = "2".repeat(40);
  const policyBlobSha256 = "3".repeat(64);
  const legacySource = `
    export function update(model) {
      model.bootPhase = "ready";
    }
  `;
  const acceptedSource = `
    export function update(model) {
      model.bootPhase = "ready";
      consumeUnknown(model.renderPerfMetrics);
    }
  `;
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    legacySource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  const legacySemanticBaseline =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);
  const existingBaseline = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha,
    relativePaths: ["js/fixture.js"],
    legacySemanticBaseline,
    acceptedPolicyCheckpoint: {
      sourceSha: acceptedSourceSha,
      policyBlobSha256,
    },
    readSourceAtRevision: async () => acceptedSource,
  });
  const previousTransitionSemanticDelta = structuredClone(
    existingBaseline.transitionSemanticDelta,
  );
  const previousTransitionCheckpoints = structuredClone(
    existingBaseline.transitionCheckpoints,
  );

  const refreshed = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha,
    relativePaths: ["js/fixture.js"],
    legacySemanticBaseline,
    existingBaseline,
    readSourceAtRevision: async (revision) => {
      assert.equal(revision, acceptedSourceSha);
      return acceptedSource;
    },
  });

  assert.deepEqual(
    refreshed.transitionSemanticDelta,
    previousTransitionSemanticDelta,
  );
  assert.deepEqual(
    refreshed.transitionCheckpoints,
    previousTransitionCheckpoints,
  );
});

test("P4.3 exact refresh and cache actions admit without binding diagnostics", async () => {
  const modulePaths = [
    "js/core/state/actions/renderer_exact_refresh_actions.js",
    "js/core/state/actions/renderer_cache_actions.js",
  ];
  const stateKeyAuthorityIndex = buildCanonicalStateKeyAuthorityIndex();

  for (const modulePath of modulePaths) {
    const source = fs.readFileSync(modulePath, "utf8");
    const { bindingInventories } = await discoverStateWriterBindingsForSource(
      modulePath,
      source,
      "production",
      { includeInventories: true },
    );
    const contractEntries = STATE_ACTION_DELEGATION_CONTRACT.filter(
      ({ modulePath: entryModulePath }) => entryModulePath === modulePath,
    );
    const writer = {
      path: modulePath,
      authority: "domain-action",
      bindings: bindingInventories.map(({ binding, findings }) => ({
        ...binding,
        authority: "domain-action",
        grants: buildStateWriterBindingGrants(
          findings,
          modulePath,
          stateKeyAuthorityIndex,
          "production",
        ),
      })),
    };

    assert.deepEqual(
      contractEntries.flatMap(({ allowedDynamicSites }) => allowedDynamicSites),
      [],
      `${modulePath} keeps a finite static action surface`,
    );
    assert.deepEqual(
      validateStateActionPolicyBindings([writer], {
        contractEntries,
        modulePaths: [modulePath],
      }),
      [],
      `${modulePath} has no unregistered binding diagnostics`,
    );
  }
});

test("policy snapshot fails closed when delegation-only scan evidence drifts", () => {
  const policy = createDelegationOnlyPolicyFixture();
  const actionBinding = policy.writers[0].bindings[0];
  const scans = [
    {
      path: policy.writers[0].path,
      surface: "production",
      bindingId: actionBinding.id,
      delegationOnly: true,
      findings: [],
    },
    {
      path: "tests/fixture.test.mjs",
      surface: "test",
      bindingId: "test-state",
      findings: [createFinding({
        filePath: "tests/fixture.test.mjs",
        bindingId: "test-state",
      })],
    },
  ];
  const matching = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["tests/fixture.test.mjs"],
    scans,
  });
  assert.equal(
    matching.violations.some(
      ({ code }) => code === "binding-delegation-only-drift",
    ),
    false,
  );

  const drifted = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["tests/fixture.test.mjs"],
    scans: scans.map((scan, index) =>
      index === 0 ? { ...scan, delegationOnly: false } : scan
    ),
  });
  assert.ok(
    drifted.violations.some(
      ({ code }) => code === "binding-delegation-only-drift",
    ),
  );
});

test("policy schema admits only explicit production action delegation-only bindings", () => {
  const valid = createDelegationOnlyPolicyFixture();
  assert.deepEqual(
    validateStateWriterPolicySchema(valid).filter(({ code }) =>
      code.startsWith("binding-delegation-only")
      || code === "binding-grants-empty"
    ),
    [],
  );

  const missingMarker = createDelegationOnlyPolicyFixture();
  delete missingMarker.writers[0].bindings[0].delegationOnly;
  assert.ok(
    validateStateWriterPolicySchema(missingMarker).some(
      ({ code }) => code === "binding-grants-empty",
    ),
  );

  const falseMarker = createDelegationOnlyPolicyFixture();
  falseMarker.writers[0].bindings[0].delegationOnly = false;
  assert.ok(
    validateStateWriterPolicySchema(falseMarker).some(
      ({ code }) => code === "binding-delegation-only-invalid",
    ),
  );

  const grantsPresent = createDelegationOnlyPolicyFixture();
  grantsPresent.writers[0].bindings[0].grants = structuredClone(
    createPolicyFixture().writers[0].bindings[0].grants,
  );
  assert.ok(
    validateStateWriterPolicySchema(grantsPresent).some(
      ({ code }) => code === "binding-delegation-only-grants-present",
    ),
  );

  for (const mutate of [
    (policy) => { policy.writers[0].path = "js/core/fixture.js"; },
    (policy) => { policy.writers[0].surface = "test"; },
    (policy) => { policy.writers[0].bindings[0].kind = "module"; },
  ]) {
    const invalidScope = createDelegationOnlyPolicyFixture();
    mutate(invalidScope);
    assert.ok(
      validateStateWriterPolicySchema(invalidScope).some(
        ({ code }) => code === "binding-delegation-only-scope-invalid",
      ),
    );
  }
});

test("P4.4 action modules admit without target-binding diagnostics", async () => {
  const modulePaths = Array.from(new Set(
    STATE_ACTION_DELEGATION_CONTRACT
      .filter(({ introducedInPhase }) => introducedInPhase === "P4.4")
      .map(({ modulePath }) => modulePath),
  ));
  const stateKeyAuthorityIndex = buildCanonicalStateKeyAuthorityIndex();

  for (const modulePath of modulePaths) {
    const source = fs.readFileSync(modulePath, "utf8");
    const { bindingInventories } = await discoverStateWriterBindingsForSource(
      modulePath,
      source,
      "production",
      { includeInventories: true },
    );
    const contractEntries = STATE_ACTION_DELEGATION_CONTRACT.filter(
      ({ modulePath: entryModulePath }) => entryModulePath === modulePath,
    );
    const retainedBindingInventories = bindingInventories.filter(
      ({ binding, findings, actionDelegations }) =>
        shouldRetainScannedWriterCandidate({
          relativePath: modulePath,
          surface: "production",
          binding,
          findings,
          actionDelegations,
        }),
    );
    const writer = {
      path: modulePath,
      authority: "domain-action",
      bindings: retainedBindingInventories.map(({ binding, findings }) => ({
        ...binding,
        authority: "domain-action",
        grants: buildStateWriterBindingGrants(
          findings,
          modulePath,
          stateKeyAuthorityIndex,
          "production",
        ),
      })),
    };

    assert.deepEqual(
      validateStateActionPolicyBindings([writer], {
        contractEntries,
        modulePaths: [modulePath],
      }),
      [],
      `${modulePath} has no unregistered binding diagnostics`,
    );
  }
});

test("P4.3 renderer action calls stay within the frozen runtime-state escape budget", async () => {
  const modulePath = "js/core/map_renderer.js";
  const source = fs.readFileSync(modulePath, "utf8");
  const { inventory } = await prepareSharedCurrentPhasePolicyInputs();
  assert.deepEqual(inventory.unknownCandidateBindings, []);
  assert.deepEqual(inventory.stalePolicyBindings, []);
  const runtimeStateInventory = inventory.scans.find(
    ({ path: scannedPath, bindingId }) =>
      scannedPath === modulePath
      && bindingId === "module:runtimeState",
  );
  assert.ok(runtimeStateInventory, "map renderer runtimeState binding is scanned");

  const runtimeStateEscapeFingerprint =
    "2e51c4d469637774e394d4d8cf5c379bebc66669a88c5e54a716cd9277c294c7";
  const runtimeStateEscapes = runtimeStateInventory.findings.filter(
    (finding) =>
      finding.reason === "state-alias-escape"
      && finding.operation === "unsupported"
      && finding.key === "*"
      && finding.sourceFingerprint === runtimeStateEscapeFingerprint,
  );
  assert.equal(runtimeStateEscapes.length, 27);

  const repairedFunctionIdentities = new Set([
    '{"kind":"function","ancestry":[{"name":"getSetMapDataTransactionOwner","ordinal":0},{"name":"clearSphericalFeatureDiagnosticsCache","ordinal":0}]}',
    '{"kind":"function","ancestry":[{"name":"getVisibleFrameDiagnosticsOwner","ordinal":0},{"name":"setFirstVisibleFramePainted","ordinal":0}]}',
    '{"kind":"function","ancestry":[{"name":"getSphericalFeatureDiagnostics","ordinal":0}]}',
  ]);
  assert.deepEqual(
    runtimeStateEscapes.filter(({ enclosingFunctionIdentity }) => (
      repairedFunctionIdentities.has(enclosingFunctionIdentity)
    )),
    [],
  );
  assert.equal(
    source.split("ensureProjectedBoundsCacheState(runtimeState)").length - 1,
    1,
    "the composition root keeps one canonical projected-bounds ensure sink",
  );
});

test("same-phase policy rebuild preserves the committed progress checkpoint", () => {
  const committedCheckpoint = Object.freeze({
    phase: "P4.2b",
    productionLegacyDirectFiles: 75,
    productionLegacyMemberships: 1011,
    productionLegacyDynamicSites: 138,
    productionLegacyAliasSites: 218,
    productionLegacyAmbiguousSites: 621,
    productionLegacyUnsupportedSites: 4079,
  });
  const progress = buildProgressState({
    phase: "P4.2b",
    currentMetrics: {
      ...committedCheckpoint,
      productionLegacyUnsupportedSites: 4075,
    },
    previousPolicy: {
      progress: {
        checkpoints: [committedCheckpoint],
      },
    },
    refreshP4Baseline: false,
    retiredLegacySemanticAuthority: {
      bindings: [],
      memberships: [],
      writes: [],
      sites: [],
    },
    callerToActionLedger: null,
  });

  assert.equal(progress.latestPhase, "P4.2b");
  assert.deepEqual(progress.checkpoints, [committedCheckpoint]);
});

test("checker replays derived alias diagnostics from accepted transition checkpoints", async () => {
  const sourceBaseSha = "1".repeat(40);
  const trustedSourceSha = "2".repeat(40);
  const trustedPolicyBlobSha256 = "3".repeat(64);
  const acceptedSourceSha = "4".repeat(40);
  const policyBlobSha256 = "5".repeat(64);
  const frozenSource = `
    export function update(model) {
      model.bootPhase = "ready";
    }
  `;
  const acceptedSource = `
    export function update(model) {
      model.bootPhase = "ready";
      consumeUnknown(model.renderPerfMetrics);
      consumeUnknown(model.mapSemanticMode);
    }
  `;
  const legacyWriters = await buildFixtureLegacyWritersForSource(
    frozenSource,
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  const legacySemanticAuthority =
    buildLegacyStateWriterSemanticAuthority(legacyWriters);
  const trustedPreviousBaseline =
    await buildFrozenDerivedAliasTaintBaseline({
      sourceBaseSha,
      relativePaths: ["js/trusted.js"],
      legacySemanticBaseline: legacySemanticAuthority,
      acceptedPolicyCheckpoint: {
        sourceSha: trustedSourceSha,
        policyBlobSha256: trustedPolicyBlobSha256,
      },
      readSourceAtRevision: async () => acceptedSource,
    });
  // Model a transition signature recorded by an earlier scanner. The current
  // scanner cannot reconstruct it, but the committed previous policy owns it.
  const historicalSignature = "js/trusted.js|legacy-scanner-only-signature";
  trustedPreviousBaseline.transitionSemanticDelta.unsupportedSites.push(
    historicalSignature,
  );
  trustedPreviousBaseline.transitionSemanticDelta.unsupportedSites.sort();
  const derivedAliasTaint = await buildFrozenDerivedAliasTaintBaseline({
    sourceBaseSha,
    relativePaths: ["js/trusted.js", "js/fixture.js"],
    legacySemanticBaseline: legacySemanticAuthority,
    existingBaseline: trustedPreviousBaseline,
    acceptedPolicyCheckpoint: {
      sourceSha: acceptedSourceSha,
      policyBlobSha256,
    },
    readSourceAtRevision: async (revision) => (
      revision === trustedSourceSha ? acceptedSource : frozenSource
    ),
  });
  const previousPolicy = {
    schemaVersion: 2,
    baseline: { sourceBaseSha },
    baselines: {
      legacySemanticAuthority,
      derivedAliasTaint: trustedPreviousBaseline,
    },
    progress: { latestPhase: "P4.2c" },
    writers: legacyWriters,
  };
  const currentPolicy = {
    schemaVersion: 2,
    baseline: { sourceBaseSha },
    baselines: { legacySemanticAuthority, derivedAliasTaint },
    progress: { latestPhase: "P4.3" },
  };
  const reads = [];
  const runGit = (args) => {
    const joined = args.join(" ");
    if (joined === `rev-parse --verify ${sourceBaseSha}^{commit}`) {
      return `${sourceBaseSha}\n`;
    }
    if (joined === `merge-base --is-ancestor ${sourceBaseSha} HEAD`) {
      return "";
    }
    if (joined === `diff --name-only ${sourceBaseSha} -- js`) {
      return "js/trusted.js\njs/fixture.js\n";
    }
    if (joined === "ls-files --others --exclude-standard -- js") {
      return "";
    }
    throw new Error(`unexpected git call: ${joined}`);
  };

  const expected = await recomputeDerivedAliasTaintBaseline({
    previousPolicy,
    currentPolicy,
    candidatePaths: ["js/trusted.js", "js/fixture.js"],
    runGit,
    readSourceAtRevision: async (revision, relativePath) => {
      reads.push([revision, relativePath]);
      return revision === trustedSourceSha
        ? acceptedSource
        : frozenSource;
    },
  });

  assert.deepEqual(reads, [
    [acceptedSourceSha, "js/fixture.js"],
    [trustedSourceSha, "js/trusted.js"],
  ]);
  assert.deepEqual(expected, derivedAliasTaint);
  assert.ok(
    expected.transitionSemanticDelta.unsupportedSites.every(
      (signature) => signature !== "forged-current-only",
    ),
  );

  const forgedCurrentPolicy = structuredClone(currentPolicy);
  forgedCurrentPolicy.baselines.derivedAliasTaint
    .transitionSemanticDelta.unsupportedSites.push("forged-current-only");
  forgedCurrentPolicy.baselines.derivedAliasTaint
    .transitionSemanticDelta.unsupportedSites.sort();
  const trustedPreviousReplay = await recomputeDerivedAliasTaintBaseline({
    previousPolicy,
    currentPolicy: forgedCurrentPolicy,
    candidatePaths: ["js/trusted.js", "js/fixture.js"],
    runGit,
    readSourceAtRevision: async (revision) => (
      revision === trustedSourceSha ? acceptedSource : frozenSource
    ),
  });

  assert.deepEqual(trustedPreviousReplay, derivedAliasTaint);
  assert.ok(
    !trustedPreviousReplay.transitionSemanticDelta
      .unsupportedSites.includes("forged-current-only"),
  );
  assert.ok(
    validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: previousPolicy.schemaVersion,
      currentSchemaVersion: forgedCurrentPolicy.schemaVersion,
      previousPhase: previousPolicy.progress.latestPhase,
      currentPhase: forgedCurrentPolicy.progress.latestPhase,
      previousBaseline: previousPolicy.baselines.derivedAliasTaint,
      currentBaseline: forgedCurrentPolicy.baselines.derivedAliasTaint,
      expectedBaseline: trustedPreviousReplay,
    }).some(
      ({ code }) => code === "derived-alias-taint-baseline-source-proof-mismatch",
    ),
  );
});

test("checker proves added transition provenance against the previous accepted policy blob", () => {
  const sourceSha = "2".repeat(40);
  const previousPolicy = {
    schemaVersion: 2,
    progress: { latestPhase: "P4.2c" },
  };
  const source = `${JSON.stringify(previousPolicy, null, 2)}\n`;
  const policyBlobSha256 = createHash("sha256")
    .update(source)
    .digest("hex");
  const currentPolicy = {
    schemaVersion: 2,
    baselines: {
      derivedAliasTaint: {
        transitionCheckpoints: [{
          sourceSha,
          policyBlobSha256,
          paths: ["js/fixture.js"],
        }],
      },
    },
    progress: {
      latestPhase: "P4.3",
      checkpoints: [{
        phase: "P4.3",
        previousAcceptedSourceSha: sourceSha,
        previousAcceptedPolicyBlobSha256: policyBlobSha256,
      }],
    },
  };
  const readPolicySourceAtRevision = (revision) => {
    assert.equal(revision, sourceSha);
    return source;
  };

  assert.deepEqual(
    validateDerivedAliasTaintTransitionCheckpointProof({
      previousPolicy,
      currentPolicy,
      acceptedPolicyCheckpoint: {
        sourceSha,
        policyBlobSha256,
      },
      readPolicySourceAtRevision,
      isSourceAncestor: () => true,
    }),
    [],
  );

  assert.deepEqual(
    validateDerivedAliasTaintTransitionCheckpointProof({
      previousPolicy,
      currentPolicy,
      acceptedPolicyCheckpoint: {
        sourceSha: "4".repeat(40),
        policyBlobSha256,
      },
      readPolicySourceAtRevision,
      isSourceAncestor: () => true,
    }).map(({ code }) => code),
    ["derived-alias-taint-transition-canonical-checkpoint-mismatch"],
  );
  assert.deepEqual(
    validateDerivedAliasTaintTransitionCheckpointProof({
      previousPolicy,
      currentPolicy,
      acceptedPolicyCheckpoint: {
        sourceSha,
        policyBlobSha256,
      },
      readPolicySourceAtRevision,
      isSourceAncestor: () => false,
    }).map(({ code }) => code),
    ["derived-alias-taint-transition-source-not-ancestor"],
  );

  const tampered = structuredClone(currentPolicy);
  tampered.baselines.derivedAliasTaint.transitionCheckpoints[0]
    .policyBlobSha256 = "3".repeat(64);
  assert.deepEqual(
    validateDerivedAliasTaintTransitionCheckpointProof({
      previousPolicy,
      currentPolicy: tampered,
      acceptedPolicyCheckpoint: {
        sourceSha,
        policyBlobSha256,
      },
      readPolicySourceAtRevision,
      isSourceAncestor: () => true,
    }).map(({ code }) => code),
    [
      "derived-alias-taint-transition-canonical-checkpoint-mismatch",
      "derived-alias-taint-transition-policy-blob-mismatch",
      "progress-accepted-policy-checkpoint-mismatch",
    ],
  );
});

test("same-phase transition checkpoint keeps the committed progress checkpoint frozen", () => {
  const sourceSha = "2".repeat(40);
  const previousPolicy = {
    schemaVersion: 2,
    baselines: {
      derivedAliasTaint: { transitionCheckpoints: [] },
    },
    progress: {
      latestPhase: "P4.3",
      checkpoints: [{
        phase: "P4.3",
        previousAcceptedSourceSha: "4".repeat(40),
        previousAcceptedPolicyBlobSha256: "5".repeat(64),
      }],
    },
  };
  const source = `${JSON.stringify(previousPolicy, null, 2)}\n`;
  const policyBlobSha256 = createHash("sha256")
    .update(source)
    .digest("hex");
  const currentPolicy = structuredClone(previousPolicy);
  currentPolicy.baselines.derivedAliasTaint.transitionCheckpoints.push({
    sourceSha,
    policyBlobSha256,
    paths: ["js/fixture.js"],
  });

  assert.deepEqual(
    validateDerivedAliasTaintTransitionCheckpointProof({
      previousPolicy,
      currentPolicy,
      acceptedPolicyCheckpoint: {
        sourceSha,
        policyBlobSha256,
      },
      readPolicySourceAtRevision: () => source,
      isSourceAncestor: () => true,
    }),
    [],
  );

  const tampered = structuredClone(currentPolicy);
  tampered.baselines.derivedAliasTaint.transitionCheckpoints[0]
    .policyBlobSha256 = "3".repeat(64);
  assert.deepEqual(
    validateDerivedAliasTaintTransitionCheckpointProof({
      previousPolicy,
      currentPolicy: tampered,
      acceptedPolicyCheckpoint: {
        sourceSha,
        policyBlobSha256,
      },
      readPolicySourceAtRevision: () => source,
      isSourceAncestor: () => true,
    }).map(({ code }) => code),
    [
      "derived-alias-taint-transition-canonical-checkpoint-mismatch",
      "derived-alias-taint-transition-policy-blob-mismatch",
    ],
  );
});

test("new phase progress records the previous accepted policy checkpoint", () => {
  const acceptedPolicyCheckpoint = {
    sourceSha: "2".repeat(40),
    policyBlobSha256: "3".repeat(64),
  };
  const metrics = {
    productionLegacyDirectFiles: 70,
    productionLegacyMemberships: 700,
    productionLegacyDynamicSites: 50,
    productionLegacyAliasSites: 80,
    productionLegacyAmbiguousSites: 60,
    productionLegacyUnsupportedSites: 40,
  };
  const progress = buildProgressState({
    phase: "P4.3",
    currentMetrics: metrics,
    previousPolicy: {
      progress: {
        latestPhase: "P4.2c",
        checkpoints: [{ phase: "P4.2c", ...metrics }],
      },
    },
    refreshP4Baseline: false,
    retiredLegacySemanticAuthority: {},
    acceptedPolicyCheckpoint,
  });

  assert.deepEqual(progress.checkpoints.at(-1), {
    phase: "P4.3",
    ...metrics,
    previousAcceptedSourceSha: acceptedPolicyCheckpoint.sourceSha,
    previousAcceptedPolicyBlobSha256:
      acceptedPolicyCheckpoint.policyBlobSha256,
  });
});

test("next-phase policy rebuild freezes P4.2b and appends the live P4.2c checkpoint", () => {
  const p42bCheckpoint = Object.freeze({
    phase: "P4.2b",
    productionLegacyDirectFiles: 75,
    productionLegacyMemberships: 1011,
    productionLegacyDynamicSites: 138,
    productionLegacyAliasSites: 218,
    productionLegacyAmbiguousSites: 621,
    productionLegacyUnsupportedSites: 4079,
  });
  const p42cMetrics = Object.freeze({
    ...p42bCheckpoint,
    phase: "P4.2c",
    productionLegacyUnsupportedSites: 4075,
  });
  const progress = buildProgressState({
    phase: "P4.2c",
    currentMetrics: p42cMetrics,
    previousPolicy: {
      progress: {
        checkpoints: [p42bCheckpoint],
      },
    },
    refreshP4Baseline: false,
    retiredLegacySemanticAuthority: {
      bindings: [],
      memberships: [],
      writes: [],
      sites: [],
    },
    callerToActionLedger: null,
  });

  assert.equal(progress.latestPhase, "P4.2c");
  assert.deepEqual(progress.checkpoints, [p42bCheckpoint, p42cMetrics]);
});

test("P4.2a caller proofs remain compatible while later entries require exact mutation-site evidence", () => {
  const historicalEntry = createCallerActionLedgerEntry(0);
  const historicalPolicy =
    createCallerActionLedgerPolicy([historicalEntry]);
  assert.ok(
    !validateStateWriterPolicySchema(historicalPolicy).some(
      ({ code }) => code === "caller-action-ledger-entry-invalid",
    ),
  );

  const futureEntry = {
    ...createCallerActionLedgerEntry(1),
    retiredInPhase: "P4.2b",
    recordedInPhase: "P4.2b",
    backfilled: false,
  };
  const futurePolicy = createCallerActionLedgerPolicy([futureEntry]);
  futurePolicy.progress.latestPhase = "P4.2b";
  assert.ok(
    validateStateWriterPolicySchema(futurePolicy).some(
      ({ code }) => code === "caller-action-ledger-entry-invalid",
    ),
  );

  const enclosingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "applyFixture01", ordinal: 0 }],
  });
  Object.assign(futureEntry, {
    enclosingFunctionIdentity,
    retiredEnclosingFunctionIdentity:
      enclosingFunctionIdentity,
    retiredMutationSiteFingerprint: "e".repeat(64),
    retiredMutationSiteCount: 1,
    proofPrecision: "exact-site",
  });
  const preciseFuturePolicy =
    createCallerActionLedgerPolicy([futureEntry]);
  preciseFuturePolicy.progress.latestPhase = "P4.2b";
  assert.ok(
    !validateStateWriterPolicySchema(preciseFuturePolicy).some(
      ({ code }) => code === "caller-action-ledger-entry-invalid",
    ),
  );
});

test("policy snapshot requires the retired caller to reach its registered action edge", () => {
  const entry = createCallerActionLedgerEntry(0);
  const policy = createCallerActionLedgerPolicy([entry]);
  const actionWriter = policy.writers[0];
  const scans = [{
    path: actionWriter.path,
    surface: actionWriter.surface,
    bindingId: actionWriter.bindings[0].id,
    findings: [
      createFinding({
        filePath: actionWriter.path,
        bindingId: actionWriter.bindings[0].id,
      }),
    ],
  }];

  const missingEdge = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [],
    scans,
    actionDelegations: [],
  });
  assert.ok(
    missingEdge.violations.some(
      ({ code, retiredMembershipIdentity }) =>
        code === "caller-action-ledger-observation-missing"
        && retiredMembershipIdentity === entry.retiredMembershipIdentity,
    ),
    JSON.stringify(missingEdge.violations, null, 2),
  );

  const shiftedOffsets = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [],
    scans,
    actionDelegations: [
      createActionDelegationObservation(entry, {
        start: entry.start + 20,
        end: entry.end + 20,
      }),
    ],
  });
  assert.ok(
    !shiftedOffsets.violations.some(
      ({ code }) => code === "caller-action-ledger-observation-mismatch",
    ),
    JSON.stringify(shiftedOffsets.violations, null, 2),
  );

  const wrongBinding = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [],
    scans,
    actionDelegations: [
      createActionDelegationObservation(entry, {
        callerBindingId: "function:wrongBinding:0:$",
      }),
    ],
  });
  assert.ok(
    wrongBinding.violations.some(
      ({ code, retiredMembershipIdentity }) =>
        code === "caller-action-ledger-observation-mismatch"
        && retiredMembershipIdentity === entry.retiredMembershipIdentity,
    ),
    JSON.stringify(wrongBinding.violations, null, 2),
  );
});

test("caller-to-action normalization rejects stable binding identities shared by distinct bindings", () => {
  const callerBindingIdentity = JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName: "applyScenario",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "$",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
  const base = {
    callerPath: "js/core/scenario_fixture.js",
    callerBindingIdentity,
    actionModulePath: "js/core/state/actions/boot_actions.js",
    actionExportName: "setBootStateFields",
    targetArgumentIndex: 0,
    start: 10,
    end: 20,
    line: 2,
    column: 1,
    sourceFingerprint: "a".repeat(64),
  };

  assert.throws(
    () => normalizeStateActionDelegations([
      { ...base, callerBindingId: "scope-one" },
      {
        ...base,
        callerBindingId: "scope-two",
        start: 30,
        end: 40,
        line: 4,
        sourceFingerprint: "b".repeat(64),
      },
    ]),
    (error) =>
      error?.code === "caller-action-binding-identity-ambiguous",
  );
});

test("enclosing-function occurrence groups keep sibling action identities stable", () => {
  const callerBindingIdentity = JSON.stringify({
    kind: "module",
    name: "runtimeState",
    functionName: "",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "",
    importSource: "./state.js",
    importedName: "state",
    aliasSources: [],
    aliasOperators: [],
  });
  const firstFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "firstCaller", ordinal: 0 }],
  });
  const secondFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "secondCaller", ordinal: 0 }],
  });
  const edge = (enclosingFunctionIdentity, start) => ({
    callerPath: "js/core/fixture.js",
    callerBindingId: "module:runtimeState",
    callerBindingIdentity,
    enclosingFunctionIdentity,
    actionModulePath: "js/core/state/actions/boot_actions.js",
    actionExportName: "setBootStateFields",
    targetArgumentIndex: 0,
    start,
    end: start + 10,
    line: start,
    column: 1,
    sourceFingerprint: `${start % 10}`.repeat(64),
  });
  const before = normalizeStateActionDelegations([
    edge(firstFunctionIdentity, 10),
    edge(secondFunctionIdentity, 20),
  ]);
  const after = normalizeStateActionDelegations([
    edge(firstFunctionIdentity, 5),
    edge(firstFunctionIdentity, 10),
    edge(secondFunctionIdentity, 20),
  ]);

  assert.equal(
    before.find(
      ({ enclosingFunctionIdentity }) =>
        enclosingFunctionIdentity === secondFunctionIdentity,
    ).actionCallEdgeIdentity,
    after.find(
      ({ enclosingFunctionIdentity }) =>
        enclosingFunctionIdentity === secondFunctionIdentity,
    ).actionCallEdgeIdentity,
  );
});

test("P4.2a historical ledger identities match the compatibility edge identity", () => {
  const prototype = createCallerActionLedgerEntry(0);
  const enclosingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "applyFixture00", ordinal: 0 }],
  });
  const [observation] = normalizeStateActionDelegations([{
    callerPath: prototype.callerPath,
    callerBindingId: prototype.callerBindingId,
    callerBindingIdentity: prototype.callerBindingIdentity,
    enclosingFunctionIdentity,
    actionModulePath: prototype.actionModulePath,
    actionExportName: prototype.actionExportName,
    targetArgumentIndex: prototype.targetArgumentIndex,
    start: prototype.start,
    end: prototype.end,
    line: prototype.line,
    column: prototype.column,
    sourceFingerprint: prototype.sourceFingerprint,
  }]);
  const entry = {
    ...prototype,
    actionCallEdgeIdentity:
      observation.legacyActionCallEdgeIdentity,
    occurrenceIndex: observation.legacyOccurrenceIndex,
  };
  const policy = createCallerActionLedgerPolicy([entry]);
  const actionWriter = policy.writers[0];
  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [],
    scans: [{
      path: actionWriter.path,
      surface: actionWriter.surface,
      bindingId: actionWriter.bindings[0].id,
      findings: [
        createFinding({
          filePath: actionWriter.path,
          bindingId: actionWriter.bindings[0].id,
        }),
      ],
    }],
    actionDelegations: [observation],
  });

  assert.ok(
    !result.violations.some(
      ({ code }) =>
        code === "caller-action-ledger-observation-missing"
        || code === "caller-action-ledger-observation-mismatch",
    ),
    JSON.stringify(result.violations, null, 2),
  );
});

test("caller-to-action ledger rejects binding identity collisions even when only one binding calls an action", () => {
  const sharedBinding = {
    kind: "function-parameter",
    name: "targetState",
    functionName: "applyScenario",
    parameterName: "targetState",
    parameterIndex: 0,
    parameterPath: "$",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
    authority: "legacy-target",
    grants: [],
  };

  assert.throws(
    () => buildCallerToActionLedger({
      phase: "P4.2a",
      writers: [{
        path: "js/core/scenario_fixture.js",
        surface: "production",
        authority: "legacy-target",
        bindings: [
          { ...sharedBinding, id: "scope-one" },
          { ...sharedBinding, id: "scope-two" },
        ],
      }],
      retiredLegacySemanticAuthority:
        createEmptyLegacySemanticAuthority(),
      actionDelegations: [{
        callerPath: "js/core/scenario_fixture.js",
        callerBindingId: "scope-two",
        callerBindingIdentity:
          buildStableStateBindingIdentity(sharedBinding),
        actionModulePath:
          "js/core/state/actions/boot_actions.js",
        actionExportName: "setBootStateFields",
        targetArgumentIndex: 0,
        start: 10,
        end: 20,
        line: 2,
        column: 1,
        sourceFingerprint: "a".repeat(64),
      }],
    }),
    (error) =>
      error?.code === "caller-action-binding-identity-ambiguous",
  );
});

test("binding grants retain stable exact mutation-site evidence for future retirement proofs", () => {
  const enclosingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "applyBoot", ordinal: 0 }],
  });
  const grants = buildStateWriterBindingGrants(
    [
      createFinding({
        operation: "assign",
        key: "bootPhase",
        line: 7,
        column: 3,
        sourceFingerprint: "a".repeat(64),
        enclosingFunctionIdentity,
      }),
      createFinding({
        operation: "assign",
        key: "bootPhase",
        line: 9,
        column: 3,
        sourceFingerprint: "a".repeat(64),
        enclosingFunctionIdentity,
      }),
    ],
    "js/bootstrap/fixture.js",
    buildCanonicalStateKeyAuthorityIndex(),
    "production",
  );

  assert.deepEqual(
    grants[0].memberships[0].mutationSites,
    [
      {
        enclosingFunctionIdentity,
        sourceFingerprint: "a".repeat(64),
        occurrenceIndex: 0,
      },
      {
        enclosingFunctionIdentity,
        sourceFingerprint: "a".repeat(64),
        occurrenceIndex: 1,
      },
    ],
  );
});

test("caller-to-action proof requires the action edge in the retired mutation's enclosing function", () => {
  const previousWriter = createPolicyFixture().writers[0];
  const previousBinding = previousWriter.bindings[0];
  const callerBindingIdentity =
    buildStableStateBindingIdentity(previousBinding);
  const firstFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "firstCaller", ordinal: 0 }],
  });
  const siblingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "secondCaller", ordinal: 0 }],
  });
  previousBinding.grants[0].memberships[0].mutationSites = [{
    enclosingFunctionIdentity: firstFunctionIdentity,
    sourceFingerprint: "a".repeat(64),
    occurrenceIndex: 0,
  }];

  const actionWriter = structuredClone(previousWriter);
  actionWriter.path = "js/core/state/actions/boot_actions.js";
  actionWriter.authority = "domain-action";
  actionWriter.bindings[0] = {
    ...actionWriter.bindings[0],
    id: "function:setBootStateFields:0:$",
    kind: "function-parameter",
    functionName: "setBootStateFields",
    parameterIndex: 0,
    parameterPath: "$",
    authority: "domain-action",
  };
  const retiredLegacySemanticAuthority =
    subtractLegacyStateWriterSemanticAuthority(
      buildLegacyStateWriterSemanticAuthority([previousWriter]),
      buildLegacyStateWriterSemanticAuthority([]),
    );
  const previousPolicy = {
    writers: [previousWriter],
    progress: {
      latestPhase: "P4.2a",
      retiredLegacySemanticAuthority:
        createEmptyLegacySemanticAuthority(),
      callerToActionLedger: {
        schemaVersion: 1,
        entries: [],
      },
    },
  };
  const baseEdge = {
    callerPath: previousWriter.path,
    callerBindingId: previousBinding.id,
    callerBindingIdentity,
    actionModulePath: actionWriter.path,
    actionExportName: "setBootStateFields",
    targetArgumentIndex: 0,
    start: 10,
    end: 20,
    line: 2,
    column: 1,
    sourceFingerprint: "b".repeat(64),
  };

  assert.throws(
    () => buildCallerToActionLedger({
      phase: "P4.2b",
      previousPolicy,
      writers: [actionWriter],
      retiredLegacySemanticAuthority,
      actionDelegations: [{
        ...baseEdge,
        enclosingFunctionIdentity: siblingFunctionIdentity,
      }],
    }),
    (error) =>
      error?.code === "caller-action-ledger-proof-missing",
  );

  const ledger = buildCallerToActionLedger({
    phase: "P4.2b",
    previousPolicy,
    writers: [actionWriter],
    retiredLegacySemanticAuthority,
    actionDelegations: [{
      ...baseEdge,
      enclosingFunctionIdentity: firstFunctionIdentity,
    }],
  });
  assert.equal(ledger.entries.length, 1);
  assert.deepEqual(
    {
      enclosingFunctionIdentity:
        ledger.entries[0].enclosingFunctionIdentity,
      retiredEnclosingFunctionIdentity:
        ledger.entries[0].retiredEnclosingFunctionIdentity,
      retiredMutationSiteCount:
        ledger.entries[0].retiredMutationSiteCount,
      proofPrecision: ledger.entries[0].proofPrecision,
    },
    {
      enclosingFunctionIdentity: firstFunctionIdentity,
      retiredEnclosingFunctionIdentity: firstFunctionIdentity,
      retiredMutationSiteCount: 1,
      proofPrecision: "exact-site",
    },
  );
  assert.match(
    ledger.entries[0].retiredMutationSiteFingerprint,
    /^[a-f0-9]{64}$/,
  );
});

test("cross-phase policy rebuild refreshes one owned action successor and preserves retirement evidence", () => {
  const enclosingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "applyFixture00", ordinal: 0 }],
  });
  const entry = createCallerActionLedgerEntry(0, {
    enclosingFunctionIdentity,
    retiredEnclosingFunctionIdentity: enclosingFunctionIdentity,
    retiredMutationSiteFingerprint: "a".repeat(64),
    retiredMutationSiteCount: 2,
    proofPrecision: "exact-site",
  });
  const [normalizedInitialEdge] = normalizeStateActionDelegations([
    createActionDelegationObservation(entry, {
      enclosingFunctionIdentity,
    }),
  ]);
  Object.assign(entry, {
    actionCallEdgeIdentity:
      normalizedInitialEdge.actionCallEdgeIdentity,
    occurrenceIndex: normalizedInitialEdge.occurrenceIndex,
  });
  const previousPolicy = createCallerActionLedgerPolicy([entry]);
  const successorWriter = structuredClone(previousPolicy.writers[0]);
  successorWriter.bindings[0].id =
    "function:replaceBootMetricsState:0:$";
  successorWriter.bindings[0].functionName =
    "replaceBootMetricsState";
  const successorEdge = createActionDelegationObservation(entry, {
    callerBindingId: "function:applyFixture00:renamed:$/property:targetState",
    enclosingFunctionIdentity,
    actionExportName: "replaceBootMetricsState",
    actionCallEdgeIdentity: undefined,
    occurrenceIndex: undefined,
    start: 500,
    end: 550,
    line: 50,
    column: 7,
    sourceFingerprint: "b".repeat(64),
  });
  const [normalizedSuccessorEdge] = normalizeStateActionDelegations([
    successorEdge,
  ]);
  const retirementFields = [
    "retiredMembershipIdentity",
    "retiredEnclosingFunctionIdentity",
    "retiredMutationSiteFingerprint",
    "retiredMutationSiteCount",
    "proofPrecision",
    "retiredInPhase",
    "recordedInPhase",
    "backfilled",
  ];

  const ledger = buildCallerToActionLedger({
    phase: "P4.2b",
    previousPolicy,
    writers: [successorWriter],
    retiredLegacySemanticAuthority:
      previousPolicy.progress.retiredLegacySemanticAuthority,
    actionDelegations: [successorEdge],
  });
  const [refreshed] = ledger.entries;

  assert.deepEqual(
    Object.fromEntries(retirementFields.map((field) => [
      field,
      refreshed[field],
    ])),
    Object.fromEntries(retirementFields.map((field) => [
      field,
      entry[field],
    ])),
  );
  assert.deepEqual(
    {
      actionModulePath: refreshed.actionModulePath,
      actionExportName: refreshed.actionExportName,
      targetArgumentIndex: refreshed.targetArgumentIndex,
      actionCallEdgeIdentity: refreshed.actionCallEdgeIdentity,
      occurrenceIndex: refreshed.occurrenceIndex,
      callerBindingId: refreshed.callerBindingId,
      start: refreshed.start,
      end: refreshed.end,
      line: refreshed.line,
      column: refreshed.column,
      sourceFingerprint: refreshed.sourceFingerprint,
    },
    {
      actionModulePath: normalizedSuccessorEdge.actionModulePath,
      actionExportName: normalizedSuccessorEdge.actionExportName,
      targetArgumentIndex: normalizedSuccessorEdge.targetArgumentIndex,
      actionCallEdgeIdentity:
        normalizedSuccessorEdge.actionCallEdgeIdentity,
      occurrenceIndex: normalizedSuccessorEdge.occurrenceIndex,
      callerBindingId: normalizedSuccessorEdge.callerBindingId,
      start: normalizedSuccessorEdge.start,
      end: normalizedSuccessorEdge.end,
      line: normalizedSuccessorEdge.line,
      column: normalizedSuccessorEdge.column,
      sourceFingerprint: normalizedSuccessorEdge.sourceFingerprint,
    },
  );

  const policy = createCallerActionLedgerPolicy([refreshed]);
  policy.writers = [successorWriter];
  policy.progress.latestPhase = "P4.2b";
  policy.progress.callerToActionLedger = ledger;
  assert.deepEqual(
    validateStateWriterPolicySchema(policy).filter(
      ({ code }) => String(code).startsWith("caller-action-ledger-"),
    ),
    [],
  );
  const snapshot = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [],
    scans: [{
      path: successorWriter.path,
      surface: successorWriter.surface,
      bindingId: successorWriter.bindings[0].id,
      findings: [createFinding({
        filePath: successorWriter.path,
        bindingId: successorWriter.bindings[0].id,
      })],
    }],
    actionDelegations: [normalizedSuccessorEdge],
  });
  assert.ok(
    !snapshot.violations.some(({ code }) =>
      code === "caller-action-ledger-observation-missing"
      || code === "caller-action-ledger-observation-mismatch"
    ),
    JSON.stringify(snapshot.violations, null, 2),
  );
});

test("cross-phase policy rebuild collapses repeated calls to one owned action successor", () => {
  const enclosingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "applyFixture00", ordinal: 0 }],
  });
  const entry = createCallerActionLedgerEntry(0, {
    enclosingFunctionIdentity,
    actionExportName: "legacyBootStateAction",
  });
  const [normalizedInitialEdge] = normalizeStateActionDelegations([
    createActionDelegationObservation(entry, {
      enclosingFunctionIdentity,
    }),
  ]);
  entry.actionCallEdgeIdentity =
    normalizedInitialEdge.actionCallEdgeIdentity;
  entry.occurrenceIndex = normalizedInitialEdge.occurrenceIndex;
  const previousPolicy = createCallerActionLedgerPolicy([entry]);
  const successorWriter = structuredClone(previousPolicy.writers[0]);
  const successorEdge = (start) =>
    createActionDelegationObservation(entry, {
      enclosingFunctionIdentity,
      actionExportName: "setBootStateFields",
      actionCallEdgeIdentity: undefined,
      occurrenceIndex: undefined,
      start,
      end: start + 20,
      line: start,
      sourceFingerprint: `${start % 10}`.repeat(64),
    });
  const observedSuccessors = [successorEdge(30), successorEdge(20)];
  const [expectedSuccessor] = normalizeStateActionDelegations(
    observedSuccessors,
  );

  const ledger = buildCallerToActionLedger({
    phase: "P4.2b",
    previousPolicy,
    writers: [successorWriter],
    retiredLegacySemanticAuthority:
      previousPolicy.progress.retiredLegacySemanticAuthority,
    actionDelegations: observedSuccessors,
  });

  assert.equal(
    ledger.entries[0].actionCallEdgeIdentity,
    expectedSuccessor.actionCallEdgeIdentity,
  );
  assert.equal(ledger.entries[0].occurrenceIndex, 0);
  assert.equal(ledger.entries[0].start, 20);
});

test("cross-phase policy rebuild fails closed when two actions own the successor edge", () => {
  const enclosingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "applyFixture00", ordinal: 0 }],
  });
  const entry = createCallerActionLedgerEntry(0, {
    enclosingFunctionIdentity,
    actionExportName: "legacyBootStateAction",
  });
  const [normalizedInitialEdge] = normalizeStateActionDelegations([
    createActionDelegationObservation(entry, {
      enclosingFunctionIdentity,
    }),
  ]);
  entry.actionCallEdgeIdentity =
    normalizedInitialEdge.actionCallEdgeIdentity;
  entry.occurrenceIndex = normalizedInitialEdge.occurrenceIndex;
  const previousPolicy = createCallerActionLedgerPolicy([entry]);
  const successorWriter = structuredClone(previousPolicy.writers[0]);
  const originalBinding = successorWriter.bindings[0];
  successorWriter.bindings = [
    "setBootStateFields",
    "replaceBootMetricsState",
  ].map((functionName) => ({
    ...structuredClone(originalBinding),
    id: `function:${functionName}:0:$`,
    functionName,
  }));
  const successorEdge = (actionExportName, start) =>
    createActionDelegationObservation(entry, {
      enclosingFunctionIdentity,
      actionExportName,
      actionCallEdgeIdentity: undefined,
      occurrenceIndex: undefined,
      start,
      end: start + 20,
      line: start,
      sourceFingerprint: `${start % 10}`.repeat(64),
    });

  assert.throws(
    () => buildCallerToActionLedger({
      phase: "P4.2b",
      previousPolicy,
      writers: [successorWriter],
      retiredLegacySemanticAuthority:
        previousPolicy.progress.retiredLegacySemanticAuthority,
      actionDelegations: [
        successorEdge("setBootStateFields", 20),
        successorEdge("replaceBootMetricsState", 30),
      ],
    }),
    (error) =>
      error?.code === "caller-action-ledger-proof-missing"
      && error.violations?.[0]?.reason
        === "caller-action-successor-edge-ambiguous",
  );
});

test("P4.4 successor proofs persist the exact contracted relay edge and fail closed", () => {
  assert.deepEqual(validateStateActionSuccessorProofContract(), []);
  assert.equal(STATE_ACTION_SUCCESSOR_PROOF_CONTRACT.length, 21);
  assert.equal(
    STATE_ACTION_SUCCESSOR_PROOF_CONTRACT.reduce(
      (count, entry) => count + entry.successorEdges.length,
      0,
    ),
    24,
  );
  const contract = findStateActionSuccessorProofContractEntry(
    "js/core/state/actions/transport_actions.js",
    "applyTransportWorkbenchOverviewState",
    "ui|P4.4|assign|styleConfig",
  );
  assert.ok(contract);
  const callerBinding = {
    id: "parameter:applyTransportWorkbenchOverviewState:0:fixture",
    kind: "function-parameter",
    name: "target",
    functionName: "applyTransportWorkbenchOverviewState",
    parameterName: "target",
    parameterIndex: 0,
    parameterPath: "$",
    authority: "legacy-target",
    grants: [{
      domain: "ui",
      migrationPhase: "P4.4",
      memberships: [{
        operation: "assign",
        key: "styleConfig",
        mutationSites: [{
          enclosingFunctionIdentity:
            '{"kind":"function","ancestry":[{"name":"applyTransportWorkbenchOverviewState","ordinal":0}]}',
          sourceFingerprint: "a".repeat(64),
          occurrenceIndex: 0,
        }],
      }],
    }],
  };
  const firstActionBinding = {
    ...structuredClone(callerBinding),
    id: "parameter:applyTransportWorkbenchOverviewState:0:action",
    authority: "domain-action",
    grants: [],
    delegationOnly: true,
  };
  const leafBinding = {
    ...structuredClone(callerBinding),
    id: "parameter:setAppearanceStyleGroupState:0:leaf",
    functionName: "setAppearanceStyleGroupState",
    authority: "domain-action",
  };
  const firstActionWriter = {
    path: contract.modulePath,
    surface: "production",
    authority: "domain-action",
    bindings: [firstActionBinding],
  };
  const leafWriter = {
    path: contract.successorEdges[0].actionModulePath,
    surface: "production",
    authority: "domain-action",
    bindings: [leafBinding],
  };
  const retiredIdentity = [
    "js/core/state/ui_state.js",
    buildStableStateBindingIdentity(callerBinding),
    "ui",
    "P4.4",
    "assign",
    "styleConfig",
  ].join("|");
  const firstEdge = {
    callerPath: "js/core/state/ui_state.js",
    callerBindingId: callerBinding.id,
    callerBindingIdentity: buildStableStateBindingIdentity(callerBinding),
    enclosingFunctionIdentity:
      '{"kind":"function","ancestry":[{"name":"applyTransportWorkbenchOverviewState","ordinal":0}]}',
    actionModulePath: contract.modulePath,
    actionExportName: contract.exportName,
    targetArgumentIndex: 0,
    start: 10,
    end: 20,
    line: 2,
    column: 1,
    sourceFingerprint: "b".repeat(64),
  };
  const expectedSuccessor = contract.successorEdges[0];
  const successorEdge = {
    callerPath: contract.modulePath,
    callerBindingId: firstActionBinding.id,
    callerBindingIdentity:
      buildStableStateBindingIdentity(firstActionBinding),
    enclosingFunctionIdentity:
      expectedSuccessor.enclosingFunctionIdentity,
    actionModulePath: expectedSuccessor.actionModulePath,
    actionExportName: expectedSuccessor.actionExportName,
    targetArgumentIndex: expectedSuccessor.targetArgumentIndex,
    start: 30,
    end: 40,
    line: 3,
    column: 1,
    sourceFingerprint: expectedSuccessor.sourceFingerprint,
  };
  const previousPolicy = {
    writers: [{
      path: "js/core/state/ui_state.js",
      surface: "production",
      authority: "legacy-direct",
      bindings: [callerBinding],
    }],
    progress: {
      latestPhase: "P4.3",
      retiredLegacySemanticAuthority: { memberships: [] },
    },
  };
  const build = ({ writers = [firstActionWriter, leafWriter], edges = [firstEdge, successorEdge] } = {}) =>
    buildCallerToActionLedger({
      phase: "P4.4",
      previousPolicy,
      writers,
      retiredLegacySemanticAuthority: { memberships: [retiredIdentity] },
      actionDelegations: edges,
    });
  const ledger = build();
  assert.equal(ledger.schemaVersion, 3);
  assert.equal(ledger.entries[0].successorProofContractIdentity,
    contract.contractIdentity);
  assert.equal(ledger.entries[0].successorActionProofs.length, 1);
  assert.equal(ledger.entries[0].successorActionProofs[0].sourceFingerprint,
    expectedSuccessor.sourceFingerprint);
  assert.equal(
    ledger.entries[0].successorActionProofs[0].terminalMembership,
    expectedSuccessor.terminalMembership,
  );
  const currentPolicy = {
    writers: [firstActionWriter, leafWriter],
    progress: {
      latestPhase: "P4.4",
      retiredLegacySemanticAuthority: { memberships: [retiredIdentity] },
      callerToActionLedger: ledger,
    },
  };
  assert.deepEqual(
    validateStateWriterPolicySchema(currentPolicy).filter(({ code }) =>
      code.startsWith("caller-action-ledger-")
    ),
    [],
  );
  const normalizedEdges = normalizeStateActionDelegations([
    firstEdge,
    successorEdge,
  ]);
  const snapshot = validateStateWriterPolicySnapshot({
    policy: currentPolicy,
    legacyAllowlistPaths: [],
    scans: [],
    actionDelegations: normalizedEdges,
  });
  assert.ok(!snapshot.violations.some(({ code }) =>
    code === "caller-action-ledger-observation-missing"
    || code === "caller-action-ledger-observation-mismatch"
  ), JSON.stringify(snapshot.violations, null, 2));

  const extraSuccessor = structuredClone(currentPolicy);
  extraSuccessor.progress.callerToActionLedger.entries[0]
    .successorActionProofs.push({
      ...extraSuccessor.progress.callerToActionLedger.entries[0]
        .successorActionProofs[0],
      actionCallEdgeIdentity: "d".repeat(64),
    });
  assert.ok(validateStateWriterPolicySchema(extraSuccessor).some(
    ({ code }) => code === "caller-action-ledger-entry-invalid"
  ));
  const wrongTerminalMembership = structuredClone(currentPolicy);
  wrongTerminalMembership.progress.callerToActionLedger.entries[0]
    .successorActionProofs[0].terminalMembership =
      "ui|P4.4|assign|ui";
  assert.ok(validateStateWriterPolicySchema(wrongTerminalMembership).some(
    ({ code }) => code === "caller-action-ledger-entry-invalid"
  ));
  const historicalEntry = structuredClone(ledger.entries[0]);
  historicalEntry.retiredInPhase = "P4.2a";
  historicalEntry.recordedInPhase = "P4.2a";
  const beforeAdoptionEntry = structuredClone(historicalEntry);
  delete beforeAdoptionEntry.successorActionProofs;
  delete beforeAdoptionEntry.successorProofContractIdentity;
  const previousTransitionPolicy = {
    progress: {
      latestPhase: "P4.3",
      retiredLegacySemanticAuthority: { memberships: [retiredIdentity] },
      callerToActionLedger: {
        schemaVersion: 2,
        entries: [beforeAdoptionEntry],
      },
    },
  };
  const currentTransitionPolicy = {
    progress: {
      latestPhase: "P4.4",
      retiredLegacySemanticAuthority: { memberships: [retiredIdentity] },
      callerToActionLedger: {
        schemaVersion: 3,
        entries: [historicalEntry],
      },
    },
  };
  assert.deepEqual(validateCallerToActionLedgerHistoryTransition({
    previousPolicy: previousTransitionPolicy,
    currentPolicy: currentTransitionPolicy,
  }), []);
  const schemaV1TransitionPolicy = structuredClone(
    previousTransitionPolicy,
  );
  schemaV1TransitionPolicy.progress.callerToActionLedger.schemaVersion = 1;
  assert.ok(validateCallerToActionLedgerHistoryTransition({
    previousPolicy: schemaV1TransitionPolicy,
    currentPolicy: currentTransitionPolicy,
  }).some(({ code }) => code === "caller-action-ledger-history-drift"));
  const driftedTransitionPolicy = structuredClone(currentTransitionPolicy);
  driftedTransitionPolicy.progress.callerToActionLedger.entries[0]
    .retiredMutationSiteFingerprint = "e".repeat(64);
  assert.ok(validateCallerToActionLedgerHistoryTransition({
    previousPolicy: previousTransitionPolicy,
    currentPolicy: driftedTransitionPolicy,
  }).some(({ code }) => code === "caller-action-ledger-history-drift"));

  for (const invoke of [
    () => build({ edges: [firstEdge] }),
    () => build({ edges: [firstEdge, {
      ...successorEdge,
      sourceFingerprint: "c".repeat(64),
    }] }),
    () => build({ writers: [firstActionWriter, {
      ...leafWriter,
      bindings: [{ ...leafBinding, grants: [] }],
    }] }),
    () => build({ writers: [{
      ...firstActionWriter,
      bindings: [{
        ...firstActionBinding,
        delegationOnly: undefined,
        grants: structuredClone(leafBinding.grants),
      }],
    }, leafWriter] }),
  ]) {
    assert.throws(invoke, (error) =>
      error?.code === "caller-action-ledger-proof-missing"
    );
  }
});

test("P4.4 successor proof contract exactly matches every live relay edge", async () => {
  const entriesByModule = new Map();
  for (const entry of STATE_ACTION_SUCCESSOR_PROOF_CONTRACT) {
    if (!entriesByModule.has(entry.modulePath)) {
      entriesByModule.set(entry.modulePath, []);
    }
    entriesByModule.get(entry.modulePath).push(entry);
  }
  for (const [modulePath, entries] of entriesByModule) {
    const source = fs.readFileSync(modulePath, "utf8");
    assert.deepEqual(validateStateActionModuleSource(source, {
      filePath: modulePath,
    }), [], modulePath);
    const lfSource = source.replace(/\r\n?/g, "\n");
    const crlfSource = lfSource.replace(/\n/g, "\r\n");
    assert.deepEqual(validateStateActionModuleSource(lfSource, {
      filePath: modulePath,
    }), [], `${modulePath}:lf`);
    assert.deepEqual(validateStateActionModuleSource(crlfSource, {
      filePath: modulePath,
    }), [], `${modulePath}:crlf`);
    const discovery = await discoverStateWriterBindingsForSource(
      modulePath,
      source,
      "production",
      { scanAllParameters: true, includeInventories: true },
    );
    const liveEdges = normalizeStateActionDelegations(
      discovery.bindingInventories.flatMap(
        ({ actionDelegations = [] }) => actionDelegations,
      ),
    );
    for (const entry of entries) {
      const firstActionBindingIdentity = buildStableStateBindingIdentity({
        kind: "function-parameter",
        functionName: entry.exportName,
        parameterIndex: 0,
        parameterPath: "$",
      });
      for (const expected of entry.successorEdges) {
        const matches = liveEdges.filter((edge) =>
          edge.callerBindingIdentity === firstActionBindingIdentity
          && edge.enclosingFunctionIdentity
            === expected.enclosingFunctionIdentity
          && edge.actionModulePath === expected.actionModulePath
          && edge.actionExportName === expected.actionExportName
          && edge.targetArgumentIndex === expected.targetArgumentIndex
          && edge.sourceFingerprint === expected.sourceFingerprint
          && edge.occurrenceIndex === expected.occurrenceIndex
        );
        assert.equal(matches.length, 1, JSON.stringify({
          modulePath,
          replacementMembership: entry.replacementMembership,
          expected,
        }));
      }
    }
  }
  const scenarioStyle = findStateActionSuccessorProofContractEntry(
    "js/core/state/actions/scenario_presentation_actions.js",
    "restoreScenarioTransactionPresentationState",
    "ui|P4.4|assign|styleConfig",
  );
  const scenarioUi = findStateActionSuccessorProofContractEntry(
    "js/core/state/actions/scenario_presentation_actions.js",
    "restoreScenarioTransactionPresentationState",
    "ui|P4.4|assign|ui",
  );
  assert.equal(scenarioStyle.successorEdges.length, 2);
  assert.equal(scenarioUi.successorEdges.length, 2);
});

test("P4.4 hybrid wildcard replacement builds and validates schema-v3 proofs across every enclosing function", () => {
  const previousWriter = createPolicyFixture().writers[0];
  const previousBinding = previousWriter.bindings[0];
  const actionModulePath =
    "js/core/state/actions/scenario_activation_actions.js";
  const requiredConcreteMemberships = [
    ...STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT[0]
      .requiredConcreteMemberships,
  ];
  const retiredMembership = "scenario|P4.2|assign|*";
  previousWriter.domain = "scenario";
  previousWriter.migrationPhase = "P4.2";
  previousBinding.grants = [{
    domain: "scenario",
    migrationPhase: "P4.2",
    operations: ["assign"],
    keys: ["*"],
    memberships: [{
      operation: "assign",
      key: "*",
      mutationSites: [],
    }],
    aliasSites: [],
    dynamicSites: [],
    ambiguousSites: [],
    unsupportedSites: [],
  }];
  const callerBindingIdentity =
    buildStableStateBindingIdentity(previousBinding);
  const firstFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "firstCaller", ordinal: 0 }],
  });
  const secondFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{ name: "secondCaller", ordinal: 0 }],
  });
  previousBinding.grants[0].memberships[0].mutationSites = [
    {
      enclosingFunctionIdentity: firstFunctionIdentity,
      sourceFingerprint: "a".repeat(64),
      occurrenceIndex: 0,
    },
    {
      enclosingFunctionIdentity: secondFunctionIdentity,
      sourceFingerprint: "b".repeat(64),
      occurrenceIndex: 0,
    },
  ];

  const directConcreteMemberships = requiredConcreteMemberships.slice(0, -1);
  const actionGrants = () => [
    {
      domain: "scenario",
      migrationPhase: "P4.2",
      operations: ["assign"],
      keys: directConcreteMemberships
        .filter((membership) => membership.startsWith("scenario|"))
        .map((membership) => membership.split("|").at(-1)),
      memberships: directConcreteMemberships
        .filter((membership) => membership.startsWith("scenario|"))
        .map((membership) => ({
          operation: "assign",
          key: membership.split("|").at(-1),
          mutationSites: [],
        })),
      aliasSites: [],
      dynamicSites: [],
      ambiguousSites: [],
      unsupportedSites: [],
    },
  ];
  const actionWriter = {
    path: actionModulePath,
    surface: "production",
    domain: "scenario",
    authority: "domain-action",
    migrationPhase: "P4.2b",
    bindings: [
      "applyScenarioChunkOptionalLayerState",
      "restoreScenarioChunkPromotionState",
    ].map((functionName) => ({
      id: `function:${functionName}:0:$`,
      kind: "function-parameter",
      name: "target",
      functionName,
      parameterName: "target",
      parameterIndex: 0,
      parameterPath: "$",
      authority: "domain-action",
      grants: actionGrants(),
    })),
  };
  for (const binding of actionWriter.bindings) {
    const concreteMemberships = binding.grants.flatMap((grant) =>
      grant.memberships.map((membership) => [
        grant.domain,
        grant.migrationPhase,
        membership.operation,
        membership.key,
      ].join("|"))
    );
    assert.deepEqual(concreteMemberships, directConcreteMemberships);
    assert.equal(concreteMemberships.includes(retiredMembership), false);
  }
  const specialZoneWriter = {
    path: "js/core/state/actions/special_zone_actions.js",
    surface: "production",
    authority: "domain-action",
    bindings: [{
      id: "function:commitSpecialZoneLayersState:0:$",
      kind: "function-parameter",
      name: "target",
      functionName: "commitSpecialZoneLayersState",
      parameterName: "target",
      parameterIndex: 0,
      parameterPath: "$",
      authority: "domain-action",
      grants: [{
        domain: "ui",
        migrationPhase: "P4.4",
        memberships: [{
          operation: "assign",
          key: "specialZoneLayers",
          mutationSites: [],
        }],
      }],
    }],
  };
  const retiredLegacySemanticAuthority =
    subtractLegacyStateWriterSemanticAuthority(
      buildLegacyStateWriterSemanticAuthority([previousWriter]),
      buildLegacyStateWriterSemanticAuthority([]),
    );
  const previousPolicy = {
    writers: [previousWriter],
    progress: {
      latestPhase: "P4.3",
      retiredLegacySemanticAuthority:
        createEmptyLegacySemanticAuthority(),
      callerToActionLedger: {
        schemaVersion: 1,
        entries: [],
      },
    },
  };
  const edge = (
    enclosingFunctionIdentity,
    start,
    actionExportName = "applyScenarioChunkOptionalLayerState",
  ) => ({
    callerPath: previousWriter.path,
    callerBindingId: previousBinding.id,
    callerBindingIdentity,
    enclosingFunctionIdentity,
    actionModulePath: actionWriter.path,
    actionExportName,
    targetArgumentIndex: 0,
    start,
    end: start + 10,
    line: start,
    column: 1,
    sourceFingerprint: `${start % 10}`.repeat(64),
  });
  const hybridEdges = actionWriter.bindings.flatMap((binding) => {
    const contract = findStateActionSuccessorProofContractEntry(
      actionModulePath,
      binding.functionName,
      retiredMembership,
    );
    return contract.successorEdges.map((successor, index) => ({
      callerPath: actionModulePath,
      callerBindingId: binding.id,
      callerBindingIdentity: buildStableStateBindingIdentity(binding),
      enclosingFunctionIdentity: successor.enclosingFunctionIdentity,
      actionModulePath: successor.actionModulePath,
      actionExportName: successor.actionExportName,
      targetArgumentIndex: successor.targetArgumentIndex,
      start: 100 + index * 20,
      end: 110 + index * 20,
      line: 100 + index,
      column: 1,
      sourceFingerprint: successor.sourceFingerprint,
    }));
  });
  const build = (actionDelegations, {
    writers = [actionWriter, specialZoneWriter],
    successorEdges = hybridEdges,
  } = {}) =>
    buildCallerToActionLedger({
      phase: "P4.4",
      previousPolicy,
      writers,
      retiredLegacySemanticAuthority,
      actionDelegations: [...actionDelegations, ...successorEdges],
    });

  assert.throws(
    () => build([edge(firstFunctionIdentity, 10)]),
    (error) =>
      error?.code === "caller-action-ledger-proof-missing"
      && error.violations?.[0]?.reason
        === "matching-enclosing-function-action-edge-missing",
  );

  const ledger = build([
    edge(firstFunctionIdentity, 10),
    edge(
      secondFunctionIdentity,
      20,
      "restoreScenarioChunkPromotionState",
    ),
  ]);
  const completeFirstHopEdges = [
    edge(firstFunctionIdentity, 10),
    edge(
      secondFunctionIdentity,
      20,
      "restoreScenarioChunkPromotionState",
    ),
  ];
  assert.throws(
    () => build(completeFirstHopEdges, {
      successorEdges: hybridEdges.slice(1),
    }),
    (error) => error?.code === "caller-action-ledger-proof-missing",
  );
  const missingDirectWriter = structuredClone(actionWriter);
  missingDirectWriter.bindings[0].grants[0].memberships.pop();
  missingDirectWriter.bindings[0].grants[0].keys.pop();
  assert.throws(
    () => build(completeFirstHopEdges, {
      writers: [missingDirectWriter, specialZoneWriter],
    }),
    (error) => error?.code === "caller-action-ledger-proof-missing",
  );
  const reacquiredWriter = structuredClone(actionWriter);
  reacquiredWriter.bindings[0].grants.push(
    structuredClone(specialZoneWriter.bindings[0].grants[0]),
  );
  assert.throws(
    () => build(completeFirstHopEdges, {
      writers: [reacquiredWriter, specialZoneWriter],
    }),
    (error) => error?.code === "caller-action-ledger-proof-missing",
  );
  const wrongTerminalWriter = structuredClone(specialZoneWriter);
  wrongTerminalWriter.bindings[0].grants[0].memberships[0].key =
    "showSpecialZones";
  assert.throws(
    () => build(completeFirstHopEdges, {
      writers: [actionWriter, wrongTerminalWriter],
    }),
    (error) => error?.code === "caller-action-ledger-proof-missing",
  );
  const [entry] = ledger.entries;
  assert.equal(ledger.schemaVersion, 3);
  assert.deepEqual(
    {
      proofPrecision: entry.proofPrecision,
      retiredMutationSiteCount: entry.retiredMutationSiteCount,
      retiredMutationFunctionCount:
        entry.retiredMutationFunctionCount,
      functionProofs: entry.functionProofs.map((proof) => ({
        enclosingFunctionIdentity:
          proof.enclosingFunctionIdentity,
        retiredEnclosingFunctionIdentity:
          proof.retiredEnclosingFunctionIdentity,
        retiredMutationSiteCount:
          proof.retiredMutationSiteCount,
        actionExportName: proof.actionExportName,
      })),
    },
    {
      proofPrecision: "exact-site-multi-function",
      retiredMutationSiteCount: 2,
      retiredMutationFunctionCount: 2,
      functionProofs: [
        {
          enclosingFunctionIdentity: firstFunctionIdentity,
          retiredEnclosingFunctionIdentity:
            firstFunctionIdentity,
          retiredMutationSiteCount: 1,
          actionExportName: "applyScenarioChunkOptionalLayerState",
        },
        {
          enclosingFunctionIdentity: secondFunctionIdentity,
          retiredEnclosingFunctionIdentity:
            secondFunctionIdentity,
          retiredMutationSiteCount: 1,
          actionExportName: "restoreScenarioChunkPromotionState",
        },
      ],
    },
  );
  assert.match(
    entry.retiredMutationSiteFingerprint,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(entry.key, "*");
  assert.equal(
    entry.retiredMembershipIdentity.endsWith(`|${retiredMembership}`),
    true,
  );
  assert.deepEqual(
    validateLegacyMembershipRetirementReplacements({
      previousWriters: [previousWriter],
      writers: [actionWriter, specialZoneWriter],
      callerToActionLedger: ledger,
    }),
    [],
  );

  const policy = createCallerActionLedgerPolicy([entry]);
  policy.writers = [
    structuredClone(actionWriter),
    structuredClone(specialZoneWriter),
  ];
  policy.progress.latestPhase = "P4.4";
  policy.progress.callerToActionLedger = ledger;
  const callerActionSchemaViolations =
    validateStateWriterPolicySchema(policy).filter(
      ({ code }) => String(code).startsWith("caller-action-ledger-"),
    );
  assert.deepEqual(callerActionSchemaViolations, []);
  const schemaV3Policy = structuredClone(policy);
  schemaV3Policy.progress.latestPhase = "P4.4";
  schemaV3Policy.progress.callerToActionLedger.schemaVersion = 3;
  assert.deepEqual(
    validateStateWriterPolicySchema(schemaV3Policy).filter(
      ({ code }) => String(code).startsWith("caller-action-ledger-"),
    ),
    [],
  );
  const invalidMultiProofMutations = [
    (multiEntry) => {
      multiEntry.functionProofs.pop();
    },
    (multiEntry) => {
      multiEntry.functionProofs.push(
        structuredClone(multiEntry.functionProofs[0]),
      );
    },
    (multiEntry) => {
      multiEntry.functionProofs.reverse();
    },
    (multiEntry) => {
      multiEntry.retiredMutationSiteCount += 1;
    },
    (multiEntry) => {
      multiEntry.retiredMutationSiteFingerprint = "invalid";
    },
  ];
  for (const basePolicy of [policy, schemaV3Policy]) {
    for (const mutate of invalidMultiProofMutations) {
      const invalidPolicy = structuredClone(basePolicy);
      mutate(
        invalidPolicy.progress.callerToActionLedger.entries[0],
      );
      assert.ok(
        validateStateWriterPolicySchema(invalidPolicy).some(
          ({ code }) =>
            code === "caller-action-ledger-entry-invalid",
        ),
      );
    }
  }

  const refreshedLedger = buildCallerToActionLedger({
    phase: "P4.4",
    previousPolicy: {
      writers: [actionWriter, specialZoneWriter],
      progress: {
        latestPhase: "P4.4",
        retiredLegacySemanticAuthority,
        callerToActionLedger: ledger,
      },
    },
    writers: [actionWriter, specialZoneWriter],
    retiredLegacySemanticAuthority,
    actionDelegations: [
      edge(firstFunctionIdentity, 11),
      edge(
        secondFunctionIdentity,
        22,
        "restoreScenarioChunkPromotionState",
      ),
      ...hybridEdges,
    ],
  });
  assert.deepEqual(
    refreshedLedger.entries[0].functionProofs.map(
      ({ start, line, sourceFingerprint }) => ({
        start,
        line,
        sourceFingerprint,
      }),
    ),
    [
      {
        start: 11,
        line: 11,
        sourceFingerprint: "1".repeat(64),
      },
      {
        start: 22,
        line: 22,
        sourceFingerprint: "2".repeat(64),
      },
    ],
  );

  const normalizedEdges = normalizeStateActionDelegations([
    edge(firstFunctionIdentity, 10),
    edge(
      secondFunctionIdentity,
      20,
      "restoreScenarioChunkPromotionState",
    ),
    ...hybridEdges,
  ]);
  const actionPolicyWriter = policy.writers[0];
  const scans = actionPolicyWriter.bindings.map((binding) => ({
    path: actionPolicyWriter.path,
    surface: actionPolicyWriter.surface,
    bindingId: binding.id,
    findings: [createFinding({
      filePath: actionPolicyWriter.path,
      bindingId: binding.id,
    })],
  }));
  const completeSnapshot = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [],
    scans,
    actionDelegations: normalizedEdges,
  });
  assert.ok(
    !completeSnapshot.violations.some(
      ({ code }) =>
        code === "caller-action-ledger-observation-missing"
        || code === "caller-action-ledger-observation-mismatch",
    ),
    JSON.stringify(completeSnapshot.violations, null, 2),
  );
  const omittedEdge = normalizedEdges.find(
    ({ enclosingFunctionIdentity }) =>
      enclosingFunctionIdentity === secondFunctionIdentity,
  );
  const missingSecondFunction = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [],
    scans,
    actionDelegations: normalizedEdges.filter(
      ({ actionCallEdgeIdentity }) =>
        actionCallEdgeIdentity !== omittedEdge.actionCallEdgeIdentity,
    ),
  });
  assert.ok(
    missingSecondFunction.violations.some(
      ({ code, actionCallEdgeIdentity }) =>
        code === "caller-action-ledger-observation-missing"
        && actionCallEdgeIdentity
          === omittedEdge.actionCallEdgeIdentity,
    ),
    JSON.stringify(missingSecondFunction.violations, null, 2),
  );
});

test("cross-file migration contract is deterministic and rejects forged or duplicate entries", () => {
  assert.deepEqual(
    validateStateActionCrossFileMigrationContract(),
    [],
  );
  const [registered] =
    STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT;
  const forged = structuredClone(registered);
  forged.replacementActionSourceFingerprint = "f".repeat(64);
  assert.ok(
    validateStateActionCrossFileMigrationContract([forged])
      .some(
        ({ code }) =>
          code
          === "state-action-cross-file-migration-entry-invalid",
      ),
  );
  assert.ok(
    validateStateActionCrossFileMigrationContract([
      registered,
      registered,
    ]).some(
      ({ code }) =>
        code
        === "state-action-cross-file-migration-entry-duplicate",
    ),
  );
});

test("P4.4 cross-file migrations exactly match frozen callers and current action edges", async () => {
  const frozenPolicy = JSON.parse(
    fs.readFileSync("tools/state_writer_policy.json", "utf8"),
  );
  const expectedRetiredPaths = new Set([
    "js/core/renderer/strategic_overlay_runtime_owner.js",
    "js/core/special_zone_layers.js",
    "js/core/state/appearance_preset_state.js",
    "js/ui/toolbar/special_zones_workbench_controller.js",
    "js/ui/toolbar/transport_workbench_state_owner.js",
  ]);
  const entries = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT.filter(
    (entry) =>
      entry.migrationPhase === "P4.4"
      && expectedRetiredPaths.has(entry.retiredCallerPath),
  );
  const expectedOriginalMigrations = [
      {
        retiredMembershipIdentity:
          "js/core/renderer/strategic_overlay_runtime_owner.js|{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createStrategicOverlayRuntimeOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:state\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}|ui|P4.4|assign|specialZoneLayers",
        replacementCallerPath:
          "js/core/renderer/strategic_overlay_runtime_owner.js",
        actionModulePath:
          "js/core/state/actions/special_zone_actions.js",
        actionExportName: "commitSpecialZoneLayersState",
      },
      {
        retiredMembershipIdentity:
          "js/core/special_zone_layers.js|{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"mutateRuntimeSpecialZoneLayersState\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}|ui|P4.4|assign|specialZoneLayers",
        replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
        actionModulePath:
          "js/core/state/actions/special_zone_actions.js",
        actionExportName: "commitSpecialZoneLayersState",
      },
      {
        retiredMembershipIdentity:
          "js/core/special_zone_layers.js|{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"setSpecialZoneMembershipBrushModeState\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}|ui|P4.4|assign|specialZoneMembershipBrushMode",
        replacementCallerPath:
          "js/ui/toolbar/special_zones_workbench_controller.js",
        actionModulePath:
          "js/core/state/actions/special_zone_actions.js",
        actionExportName: "setSpecialZoneMembershipBrushModeState",
      },
      {
        retiredMembershipIdentity:
          "js/core/special_zone_layers.js|{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"setSpecialZonePresetCategoryState\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}|ui|P4.4|assign|specialZonePresetCategory",
        replacementCallerPath:
          "js/ui/toolbar/special_zones_workbench_controller.js",
        actionModulePath:
          "js/core/state/actions/special_zone_actions.js",
        actionExportName: "setSpecialZonePresetCategoryState",
      },
      {
        retiredMembershipIdentity:
          "js/core/state/appearance_preset_state.js|{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"applyAppearancePresetToRuntimeState\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}|appearance|P4.4|assign|intensityFields",
        replacementCallerPath:
          "js/core/state/actions/appearance_preset_actions.js",
        actionModulePath:
          "js/core/state/actions/intensity_field_actions.js",
        actionExportName: "setIntensityFieldsState",
      },
      {
        retiredMembershipIdentity:
          "js/ui/toolbar/special_zones_workbench_controller.js|{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createSpecialZonesWorkbenchController\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}|ui|P4.4|assign|specialZonePresetOpenCategories",
        replacementCallerPath:
          "js/ui/toolbar/special_zones_workbench_controller.js",
        actionModulePath:
          "js/core/state/actions/special_zone_actions.js",
        actionExportName: "setSpecialZonePresetCategoryOpenState",
      },
      {
        retiredMembershipIdentity:
          "js/ui/toolbar/transport_workbench_state_owner.js|{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createTransportWorkbenchStateOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}|ui|P4.4|assign|transportWorkbenchUi",
        replacementCallerPath:
          "js/ui/toolbar/transport_workbench_state_owner.js",
        actionModulePath: "js/core/state/actions/transport_actions.js",
        actionExportName: "commitTransportWorkbenchUiState",
      },
    ];
  assert.deepEqual(
    entries.filter((entry) => expectedOriginalMigrations.some((expected) =>
      expected.retiredMembershipIdentity === entry.retiredMembershipIdentity))
      .map(({ retiredMembershipIdentity, replacementCallerPath, actionModulePath, actionExportName }) =>
        ({ retiredMembershipIdentity, replacementCallerPath, actionModulePath, actionExportName })),
    expectedOriginalMigrations,
  );
  assert.deepEqual(
    validateStateActionCrossFileMigrationContract(entries),
    [],
  );

  const actionEdgesByPath = new Map();
  for (const replacementCallerPath of new Set(
    entries.map(({ replacementCallerPath }) => replacementCallerPath),
  )) {
    const source = fs.readFileSync(replacementCallerPath, "utf8");
    const { bindingInventories } =
      await discoverStateWriterBindingsForSource(
        replacementCallerPath,
        source,
        "production",
        {
          scanAllParameters: true,
          includeInventories: true,
        },
      );
    actionEdgesByPath.set(
      replacementCallerPath,
      normalizeStateActionDelegations(
        bindingInventories.flatMap(
          ({ actionDelegations = [] }) => actionDelegations,
        ),
      ),
    );
  }

  for (const entry of entries) {
    const retiredWriter = frozenPolicy.writers.find(
      ({ path: writerPath }) => writerPath === entry.retiredCallerPath,
    );
    const retiredBinding = retiredWriter?.bindings.find(
      (binding) =>
        buildStableStateBindingIdentity(binding)
          === entry.retiredCallerBindingIdentity,
    );
    const retiredMembership = retiredBinding?.grants.flatMap(
      (grant) => grant.memberships.map((membership) => ({
        domain: grant.domain,
        migrationPhase: grant.migrationPhase,
        ...membership,
      })),
    ).find((membership) =>
      membership.domain === entry.domain
      && membership.migrationPhase === entry.migrationPhase
      && membership.operation === entry.operation
      && membership.key === entry.key
    );
    if (retiredMembership) {
      assert.deepEqual(
        retiredMembership.mutationSites,
        entry.retiredMutationSites,
        entry.retiredMembershipIdentity,
      );
    } else {
      const retiredProof =
        frozenPolicy.progress.callerToActionLedger.entries.find(
          ({ retiredMembershipIdentity }) =>
            retiredMembershipIdentity
              === entry.retiredMembershipIdentity,
        );
      assert.ok(retiredProof, entry.retiredMembershipIdentity);
      assert.equal(
        retiredProof.retiredMutationSiteCount,
        entry.retiredMutationSites.length,
        entry.retiredMembershipIdentity,
      );
      assert.deepEqual(
        retiredProof.retiredEnclosingFunctionIdentities
          ?? [retiredProof.retiredEnclosingFunctionIdentity],
        [
          ...new Set(
            entry.retiredMutationSites.map(
              ({ enclosingFunctionIdentity }) =>
                enclosingFunctionIdentity,
            ),
          ),
        ].sort(),
        entry.retiredMembershipIdentity,
      );
      assert.equal(
        retiredProof.crossFileMigrationContractIdentity,
        buildStateActionCrossFileMigrationContractIdentity(entry),
        entry.retiredMembershipIdentity,
      );
    }
    assert.ok(
      actionEdgesByPath.get(entry.replacementCallerPath).some((edge) =>
        edge.callerBindingIdentity
          === entry.replacementCallerBindingIdentity
        && edge.enclosingFunctionIdentity
          === entry.replacementEnclosingFunctionIdentity
        && edge.actionModulePath === entry.actionModulePath
        && edge.actionExportName === entry.actionExportName
        && edge.targetArgumentIndex === entry.targetArgumentIndex
        && edge.sourceFingerprint
          === entry.replacementActionSourceFingerprint
      ),
      entry.retiredMembershipIdentity,
    );
  }
});

test("retired scenario runtime commit resolves real canonical edges and rejects missing replacements", async () => {
  const entries = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT.filter((entry) =>
    JSON.parse(entry.retiredCallerBindingIdentity).functionName === "commitScenarioActivationRuntimeState"
    && entry.replacementCallerPath === "js/core/scenario_apply_pipeline.js");
  assert.equal(entries.length, 51);
  assert.deepEqual(validateStateActionCrossFileMigrationContract(entries), []);
  const callerPath = "js/core/scenario_apply_pipeline.js";
  const { bindingInventories } = await discoverStateWriterBindingsForSource(
    callerPath, fs.readFileSync(callerPath, "utf8"), "production",
    { scanAllParameters: true, includeInventories: true },
  );
  const edges = normalizeStateActionDelegations(bindingInventories.flatMap(({ actionDelegations = [] }) => actionDelegations));
  const binding = JSON.parse(entries[0].retiredCallerBindingIdentity);
  const grants = [];
  for (const entry of entries) {
    let grant = grants.find(({ domain, migrationPhase }) => domain === entry.domain && migrationPhase === entry.migrationPhase);
    if (!grant) {
      grant = { domain: entry.domain, migrationPhase: entry.migrationPhase, memberships: [] };
      grants.push(grant);
    }
    grant.memberships.push({ operation: entry.operation, key: entry.key, mutationSites: entry.retiredMutationSites });
  }
  const policy = JSON.parse(fs.readFileSync("tools/state_writer_policy.json", "utf8"));
  const build = (actionDelegations) => buildCallerToActionLedger({
    phase: "P4.4",
    previousPolicy: {
      writers: [{ path: entries[0].retiredCallerPath, bindings: [{ ...binding, grants }] }],
      progress: { latestPhase: "P4.4" },
    },
    writers: policy.writers.filter(({ path: writerPath }) => writerPath.includes("/actions/")),
    retiredLegacySemanticAuthority: { memberships: entries.map(({ retiredMembershipIdentity }) => retiredMembershipIdentity) },
    actionDelegations,
    crossFileMigrationContract: entries,
  });
  assert.equal(build(edges).entries.length, entries.length);
  assert.throws(() => build([]), ({ code }) => code === "caller-action-ledger-proof-missing");
  assert.throws(() => build(edges.map((edge) => ({ ...edge, sourceFingerprint: "0".repeat(64) }))),
    ({ code }) => code === "caller-action-ledger-proof-missing");
  assert.equal(fs.readFileSync("js/core/state/scenario_runtime_state.js", "utf8").includes("commitScenarioActivationRuntimeState"), false);
  assert.equal(fs.readFileSync(callerPath, "utf8").includes("commitScenarioActivationRuntimeState"), false);
});

test("governance owner retirements require real action edges and concrete write authority", async () => {
  const callerPaths = [
    "js/core/renderer/border_mesh_owner.js",
    "js/core/map_renderer/map_hover_interaction_owner.js",
    "js/ui/sidebar/country_inspector_model.js",
    "js/ui/toolbar/workspace_chrome_support_surface_controller.js",
  ];
  const entries = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT.filter((entry) => callerPaths.includes(entry.replacementCallerPath));
  assert.equal(entries.length, 15);
  const previous = readStateWriterPolicyAtRevision("348a952e");
  const identities = entries.map((entry) => entry.retiredMembershipIdentity);
  const edges = [];
  const writers = [];
  const authorityIndex = buildCanonicalStateKeyAuthorityIndex();
  for (const filePath of new Set([...callerPaths, ...entries.map((entry) => entry.actionModulePath)])) {
    const { bindingInventories } = await discoverStateWriterBindingsForSource(
      filePath, fs.readFileSync(filePath, "utf8"), "production", { scanAllParameters: true, includeInventories: true },
    );
    edges.push(...normalizeStateActionDelegations(bindingInventories.flatMap(({ actionDelegations = [] }) => actionDelegations)));
    if (filePath.includes("/actions/")) {
      writers.push({ path: filePath, surface: "production", authority: "domain-action",
        bindings: bindingInventories.map(({ binding, findings }) => ({ ...binding, authority: "domain-action",
          grants: buildStateWriterBindingGrants(findings, filePath, authorityIndex, "production"),
        })),
      });
    }
  }
  const build = (actionDelegations, currentWriters = writers) => buildCallerToActionLedger({
    phase: "P4.4",
    previousPolicy: { ...previous, progress: { ...previous.progress,
      retiredLegacySemanticAuthority: { memberships: previous.progress.retiredLegacySemanticAuthority.memberships.filter((id) => identities.includes(id)) },
      callerToActionLedger: { ...previous.progress.callerToActionLedger,
        entries: previous.progress.callerToActionLedger.entries.filter((entry) => identities.includes(entry.retiredMembershipIdentity)),
      },
    } },
    writers: currentWriters, retiredLegacySemanticAuthority: { memberships: identities },
    actionDelegations, crossFileMigrationContract: entries,
  });
  assert.equal(build(edges).entries.length, 15);
  assert.throws(() => build([]), ({ code }) => code === "caller-action-ledger-proof-missing");
  const withoutCacheReplacement = writers.map((writer) => ({ ...writer,
    bindings: writer.bindings.filter((binding) => binding.functionName !== "replaceCachedDetailAdmBordersState"),
  }));
  assert.throws(() => build(edges, withoutCacheReplacement), ({ code }) => code === "caller-action-ledger-proof-missing");
});

test("optional-layer chunk retirement preserves historical sites under the surviving binding", async () => {
  const entries = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT.filter((entry) =>
    JSON.parse(entry.retiredCallerBindingIdentity).functionName === "commitScenarioActivationRuntimeState"
    && entry.replacementCallerPath === "js/core/state/scenario_runtime_state.js");
  assert.equal(entries.length, 2);
  const previous = readStateWriterPolicyAtRevision("348a952e");
  const identities = entries.map((entry) => entry.retiredMembershipIdentity);
  const priorEntries = previous.progress.callerToActionLedger.entries.filter((entry) => identities.includes(entry.retiredMembershipIdentity));
  assert.equal(priorEntries.length, 2);
  const filePath = "js/core/state/scenario_runtime_state.js";
  const { bindingInventories } = await discoverStateWriterBindingsForSource(
    filePath, fs.readFileSync(filePath, "utf8"), "production", { scanAllParameters: true, includeInventories: true },
  );
  const edges = normalizeStateActionDelegations(bindingInventories.flatMap(({ actionDelegations = [] }) => actionDelegations));
  const build = (actionDelegations, crossFileMigrationContract = entries) => buildCallerToActionLedger({
    phase: "P4.4",
    previousPolicy: { ...previous, progress: { ...previous.progress,
      retiredLegacySemanticAuthority: { memberships: identities },
      callerToActionLedger: { ...previous.progress.callerToActionLedger, entries: priorEntries },
    } },
    writers: previous.writers.filter(({ path: writerPath }) => writerPath.includes("/actions/")),
    retiredLegacySemanticAuthority: { memberships: identities },
    actionDelegations, crossFileMigrationContract,
  });
  const ledger = build(edges);
  assert.equal(ledger.entries.length, 2);
  for (const entry of ledger.entries) {
    const prior = priorEntries.find((candidate) => candidate.retiredMembershipIdentity === entry.retiredMembershipIdentity);
    assert.equal(entry.retiredMutationSiteFingerprint, prior.retiredMutationSiteFingerprint);
    assert.equal(entry.retiredMutationSiteCount, prior.retiredMutationSiteCount);
    assert.equal(JSON.parse(entry.callerBindingIdentity).functionName, "setScenarioRuntimeOptionalLayerState");
  }
  assert.throws(() => build([]), ({ code }) => code === "caller-action-ledger-proof-missing");
  assert.throws(() => build(edges, entries.map((entry) => ({ ...entry,
    retiredMutationSites: entry.retiredMutationSites.map((site) => ({ ...site, sourceFingerprint: "0".repeat(64) })),
  }))), /proof|contract/i);
});

test("caller-to-action ledger accepts only an exact explicit cross-file migration proof", () => {
  const fixture = createCrossFileMigrationFixture();
  const build = (overrides = {}) =>
    buildCallerToActionLedger({
      phase: "P4.2b",
      previousPolicy: fixture.previousPolicy,
      writers: [fixture.actionWriter],
      retiredLegacySemanticAuthority:
        fixture.retiredLegacySemanticAuthority,
      actionDelegations: [fixture.actionDelegation],
      crossFileMigrationContract: [fixture.contract],
      ...overrides,
    });
  const ledger = build();
  const [entry] = ledger.entries;
  assert.deepEqual(
    validateLegacyMembershipRetirementReplacements({
      previousWriters: [fixture.previousWriter],
      writers: [fixture.actionWriter],
      callerToActionLedger: ledger,
    }),
    [],
  );
  const expectedMutationSiteFingerprint =
    createHash("sha256")
      .update(
        JSON.stringify(fixture.contract.retiredMutationSites),
      )
      .digest("hex");
  assert.deepEqual(
    {
      callerPath: entry.callerPath,
      callerBindingIdentity: entry.callerBindingIdentity,
      enclosingFunctionIdentity:
        entry.enclosingFunctionIdentity,
      retiredCallerPath: entry.retiredCallerPath,
      retiredCallerBindingIdentity:
        entry.retiredCallerBindingIdentity,
      retiredEnclosingFunctionIdentity:
        entry.retiredEnclosingFunctionIdentity,
      retiredMutationSiteFingerprint:
        entry.retiredMutationSiteFingerprint,
      retiredMutationSiteCount:
        entry.retiredMutationSiteCount,
      proofPrecision: entry.proofPrecision,
      crossFileMigrationContractIdentity:
        entry.crossFileMigrationContractIdentity,
    },
    {
      callerPath: fixture.contract.replacementCallerPath,
      callerBindingIdentity:
        fixture.contract.replacementCallerBindingIdentity,
      enclosingFunctionIdentity:
        fixture.contract.replacementEnclosingFunctionIdentity,
      retiredCallerPath: fixture.contract.retiredCallerPath,
      retiredCallerBindingIdentity:
        fixture.contract.retiredCallerBindingIdentity,
      retiredEnclosingFunctionIdentity:
        fixture.contract.retiredMutationSites[0]
          .enclosingFunctionIdentity,
      retiredMutationSiteFingerprint:
        expectedMutationSiteFingerprint,
      retiredMutationSiteCount: 1,
      proofPrecision: "explicit-cross-file",
      crossFileMigrationContractIdentity:
        fixture.contract.contractIdentity,
    },
  );

  const successorWriter = structuredClone(fixture.actionWriter);
  successorWriter.bindings[0].id =
    "function:replaceBootMetricsState:0:$";
  successorWriter.bindings[0].functionName =
    "replaceBootMetricsState";
  assert.throws(
    () => buildCallerToActionLedger({
      phase: "P4.2b",
      previousPolicy: {
        writers: [fixture.actionWriter],
        progress: {
          latestPhase: "P4.2b",
          retiredLegacySemanticAuthority:
            fixture.retiredLegacySemanticAuthority,
          callerToActionLedger: ledger,
        },
      },
      writers: [successorWriter],
      retiredLegacySemanticAuthority:
        fixture.retiredLegacySemanticAuthority,
      actionDelegations: [{
        ...fixture.actionDelegation,
        actionExportName: "replaceBootMetricsState",
      }],
      crossFileMigrationContract: [fixture.contract],
    }),
    (error) =>
      error?.code === "caller-action-ledger-proof-missing"
      && error.violations?.[0]?.reason
        === "explicit-cross-file-action-edge-stale",
  );

  assert.throws(
    () => build({
      crossFileMigrationContract: [],
    }),
    (error) =>
      error?.code === "caller-action-ledger-proof-missing",
  );

  const staleContract = structuredClone(fixture.contract);
  staleContract.retiredMutationSites[0].sourceFingerprint =
    "c".repeat(64);
  staleContract.contractIdentity =
    buildStateActionCrossFileMigrationContractIdentity(
      staleContract,
    );
  assert.throws(
    () => build({
      crossFileMigrationContract: [staleContract],
    }),
    (error) =>
      error?.code === "caller-action-ledger-proof-missing"
      && error.violations?.[0]?.reason
        === "cross-file-retired-mutation-sites-do-not-match-policy",
  );

  assert.throws(
    () => build({
      actionDelegations: [{
        ...fixture.actionDelegation,
        sourceFingerprint: "d".repeat(64),
      }],
    }),
    (error) =>
      error?.code === "caller-action-ledger-proof-missing",
  );

  assert.throws(
    () => build({
      actionDelegations: [{
        ...fixture.actionDelegation,
        enclosingFunctionIdentity: JSON.stringify({
          kind: "function",
          ancestry: [{
            name: "createReplacementFixture",
            ordinal: 0,
          }, {
            name: "siblingCommit",
            ordinal: 0,
          }],
        }),
      }],
    }),
    (error) =>
      error?.code === "caller-action-ledger-proof-missing",
  );
});

test("an existing caller-to-action proof adopts a newly explicit cross-file handoff", () => {
  const fixture = createCrossFileMigrationFixture();
  const legacyDelegation = {
    ...fixture.actionDelegation,
    callerPath: fixture.contract.retiredCallerPath,
    callerBindingId: "module:runtimeState",
    callerBindingIdentity:
      fixture.contract.retiredCallerBindingIdentity,
    enclosingFunctionIdentity:
      fixture.contract.retiredMutationSites[0]
        .enclosingFunctionIdentity,
  };
  const legacyLedger = buildCallerToActionLedger({
    phase: "P4.2b",
    previousPolicy: fixture.previousPolicy,
    writers: [fixture.actionWriter],
    retiredLegacySemanticAuthority:
      fixture.retiredLegacySemanticAuthority,
    actionDelegations: [legacyDelegation],
    crossFileMigrationContract: [],
  });
  assert.equal(
    legacyLedger.entries[0].crossFileMigrationContractIdentity,
    undefined,
  );

  const previousTransitionPolicy = {
    writers: [fixture.previousWriter],
    progress: {
      latestPhase: "P4.2b",
      retiredLegacySemanticAuthority:
        fixture.retiredLegacySemanticAuthority,
      callerToActionLedger: legacyLedger,
    },
  };
  const transitioned = buildCallerToActionLedger({
    phase: "P4.4",
    previousPolicy: previousTransitionPolicy,
    writers: [fixture.actionWriter],
    retiredLegacySemanticAuthority:
      fixture.retiredLegacySemanticAuthority,
    actionDelegations: [fixture.actionDelegation],
    crossFileMigrationContract: [fixture.contract],
  });
  assert.deepEqual(
    {
      callerPath: transitioned.entries[0].callerPath,
      callerBindingIdentity:
        transitioned.entries[0].callerBindingIdentity,
      enclosingFunctionIdentity:
        transitioned.entries[0].enclosingFunctionIdentity,
      crossFileMigrationContractIdentity:
        transitioned.entries[0]
          .crossFileMigrationContractIdentity,
      retiredInPhase: transitioned.entries[0].retiredInPhase,
      recordedInPhase: transitioned.entries[0].recordedInPhase,
    },
    {
      callerPath: fixture.contract.replacementCallerPath,
      callerBindingIdentity:
        fixture.contract.replacementCallerBindingIdentity,
      enclosingFunctionIdentity:
        fixture.contract.replacementEnclosingFunctionIdentity,
      crossFileMigrationContractIdentity:
        fixture.contract.contractIdentity,
      retiredInPhase: "P4.2b",
      recordedInPhase: "P4.2b",
    },
  );
  const currentTransitionPolicy = {
    progress: {
      latestPhase: "P4.4",
      retiredLegacySemanticAuthority:
        fixture.retiredLegacySemanticAuthority,
      callerToActionLedger: transitioned,
    },
  };
  assert.deepEqual(validateCallerToActionLedgerHistoryTransition({
    previousPolicy: previousTransitionPolicy,
    currentPolicy: currentTransitionPolicy,
    crossFileMigrationContract: [fixture.contract],
  }), []);
  const driftedTransitionPolicy = structuredClone(currentTransitionPolicy);
  driftedTransitionPolicy.progress.callerToActionLedger.entries[0]
    .actionExportName = "unregisteredReplacement";
  assert.ok(validateCallerToActionLedgerHistoryTransition({
    previousPolicy: previousTransitionPolicy,
    currentPolicy: driftedTransitionPolicy,
    crossFileMigrationContract: [fixture.contract],
  }).some(({ code }) => code === "caller-action-ledger-history-drift"));
});

test("P4.3 renderer cross-boundary contracts exactly match the frozen retired mutation sites", () => {
  const frozenPolicy = JSON.parse(
    fs.readFileSync("tools/state_writer_policy.json", "utf8"),
  );
  const rendererContracts =
    STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT.filter(
      ({ domain, migrationPhase }) =>
        domain === "renderer"
        && migrationPhase === "P4.3",
    );
  assert.deepEqual(
    rendererContracts.map(({ contractIdentity }) => contractIdentity),
    [
      "0ad5e419c276faf62c7375f4b112c5f0331830938718acc400226629b234aefe",
      "5e6cd046957fc4a7f2d806adaa12afff8f86b5ea7e6fd62c4d023f6fa1885251",
      "f8293fd8d98cb3ab0362a52ae7ebf30372c2cb9cc183641436a3f1895338c139",
      "b039cb07c359bf2a0270c650c3b54a13e66c4d150b84ef369fcd07359f4dff58",
      "661569a4008d4a8a207bab8115268533f7fd94035f2508e5572e1d5289a2d793",
      "447d2f10d0b8a7089a85f38fbdcef8564ffdadc5581fd9628f16bd07948f53cc",
      "6a7f9cf11b3288cbbbee8549e865f12488e0cee699c86f1daa4d08fe59449727",
      "f0392f7324a158420ab19c737cc6fd8be57758a20ea4049e70e9ddd01333f740",
      "4b0f41e40474b9eac61cb1e8afa533e7717f9bc62345afb53b4d9ef0ca4d141d",
      "c01abd31e713c14331a6e2ac8f1c5529813d5fc5048e3d3fb970ad5dbf161a6b",
      "4a1e7970e1ec86ff50ea3785eff073c2d015d2afa766fa2743361ac1ea0dda7d",
      "70e4c965698025b40e1a74945b6880f421dc1260982afffab26c449b531a0277",
      "9289a139b92d4caeaea609c4bbd1b58acc34affcf8f67f3fc10b7e82ca3cc7cf",
      "5bda77ffb52ef7687f2cb7b1a7cdfb2ac6a594dfcc94c696ee94393011d43274",
      "a1574269705ceb9f5a06b7e8f10748e4f77e12778218d68a8e3104d757f1ef59",
      "3ebe1743567ed05509aa5e55b801279d5a765b7dc5a3be42b54c6b5bd28d091f",
      "907a7a73d938121b892601ad956e6cea04f5d1caeeedd038a94b1b76ebb4c440",
      "784e03d190947f705368d03b069701532b6b3575337384b82325d7e2f2790200",
    ],
  );
  const callerToActionEntries =
    frozenPolicy.progress.callerToActionLedger.entries;
  for (const contract of rendererContracts) {
    // These four P4.3 memberships acquired their explicit cross-file proof in P4.4.
    const recordedPhase = ["cachedDetailAdmBorders", "lastMouseMoveTime"].includes(contract.key)
      ? "P4.4" : "P4.3";
    const entry = callerToActionEntries.find(
      ({ retiredMembershipIdentity }) =>
        retiredMembershipIdentity
          === contract.retiredMembershipIdentity,
    );
    const retiredMutationSiteFingerprint = createHash("sha256")
      .update(JSON.stringify(contract.retiredMutationSites))
      .digest("hex");
    assert.deepEqual(
      {
        retiredMembershipIdentity:
          entry?.retiredMembershipIdentity,
        callerPath: entry?.callerPath,
        callerBindingIdentity: entry?.callerBindingIdentity,
        enclosingFunctionIdentity:
          entry?.enclosingFunctionIdentity,
        retiredCallerPath: entry?.retiredCallerPath,
        retiredCallerBindingIdentity:
          entry?.retiredCallerBindingIdentity,
        retiredMutationSiteFingerprint:
          entry?.retiredMutationSiteFingerprint,
        retiredMutationSiteCount:
          entry?.retiredMutationSiteCount,
        crossFileMigrationContractIdentity:
          entry?.crossFileMigrationContractIdentity,
        domain: entry?.domain,
        migrationPhase: entry?.migrationPhase,
        operation: entry?.operation,
        key: entry?.key,
        actionModulePath: entry?.actionModulePath,
        actionExportName: entry?.actionExportName,
        targetArgumentIndex: entry?.targetArgumentIndex,
        sourceFingerprint: entry?.sourceFingerprint,
        retiredInPhase: entry?.retiredInPhase,
        recordedInPhase: entry?.recordedInPhase,
        backfilled: entry?.backfilled,
      },
      {
        retiredMembershipIdentity:
          contract.retiredMembershipIdentity,
        callerPath: contract.replacementCallerPath,
        callerBindingIdentity:
          contract.replacementCallerBindingIdentity,
        enclosingFunctionIdentity:
          contract.replacementEnclosingFunctionIdentity,
        retiredCallerPath: contract.retiredCallerPath,
        retiredCallerBindingIdentity:
          contract.retiredCallerBindingIdentity,
        retiredMutationSiteFingerprint,
        retiredMutationSiteCount:
          contract.retiredMutationSites.length,
        crossFileMigrationContractIdentity:
          contract.contractIdentity,
        domain: contract.domain,
        migrationPhase: contract.migrationPhase,
        operation: contract.operation,
        key: contract.key,
        actionModulePath: contract.actionModulePath,
        actionExportName: contract.actionExportName,
        targetArgumentIndex: contract.targetArgumentIndex,
        sourceFingerprint:
          contract.replacementActionSourceFingerprint,
        retiredInPhase: recordedPhase,
        recordedInPhase: recordedPhase,
        backfilled: false,
      },
      contract.retiredMembershipIdentity,
    );
  }
});

test("caller-to-action ledger accepts one exact cross-file edge for multiple retired enclosing functions", () => {
  const fixture = createCrossFileMigrationFixture();
  const secondRetiredEnclosingFunctionIdentity = JSON.stringify({
    kind: "function",
    ancestry: [{
      name: "resetLegacyBoot",
      ordinal: 0,
    }],
  });
  const secondRetiredMutationSite = {
    enclosingFunctionIdentity:
      secondRetiredEnclosingFunctionIdentity,
    sourceFingerprint: "c".repeat(64),
    occurrenceIndex: 0,
  };
  const originalMutationSite = structuredClone(
    fixture.contract.retiredMutationSites[0],
  );
  const retiredMutationSites = [
    originalMutationSite,
    secondRetiredMutationSite,
  ].sort(
    (left, right) =>
      left.enclosingFunctionIdentity.localeCompare(
        right.enclosingFunctionIdentity,
      ),
  );
  fixture.previousWriter.bindings[0].grants[0]
    .memberships[0].mutationSites = structuredClone(
      retiredMutationSites,
    );
  const rawContract = {
    ...structuredClone(fixture.contract),
    retiredMutationSites,
  };
  delete rawContract.contractIdentity;
  const contract = {
    ...rawContract,
    contractIdentity:
      buildStateActionCrossFileMigrationContractIdentity(
        rawContract,
      ),
  };
  const ledger = buildCallerToActionLedger({
    phase: "P4.2b",
    previousPolicy: fixture.previousPolicy,
    writers: [fixture.actionWriter],
    retiredLegacySemanticAuthority:
      fixture.retiredLegacySemanticAuthority,
    actionDelegations: [fixture.actionDelegation],
    crossFileMigrationContract: [contract],
  });
  assert.deepEqual(
    validateStateActionCrossFileMigrationContract([contract]),
    [],
  );
  const [entry] = ledger.entries;
  const expectedRetiredFunctionIdentities = [
    ...new Set(
      retiredMutationSites.map(
        ({ enclosingFunctionIdentity }) =>
          enclosingFunctionIdentity,
      ),
    ),
  ];
  assert.deepEqual(
    {
      schemaVersion: ledger.schemaVersion,
      callerPath: entry.callerPath,
      callerBindingIdentity:
        entry.callerBindingIdentity,
      enclosingFunctionIdentity:
        entry.enclosingFunctionIdentity,
      retiredEnclosingFunctionIdentity:
        entry.retiredEnclosingFunctionIdentity,
      retiredEnclosingFunctionIdentities:
        entry.retiredEnclosingFunctionIdentities,
      retiredMutationSiteCount:
        entry.retiredMutationSiteCount,
      retiredMutationFunctionCount:
        entry.retiredMutationFunctionCount,
      proofPrecision: entry.proofPrecision,
      sourceFingerprint: entry.sourceFingerprint,
      crossFileMigrationContractIdentity:
        entry.crossFileMigrationContractIdentity,
    },
    {
      schemaVersion: 2,
      callerPath: contract.replacementCallerPath,
      callerBindingIdentity:
        contract.replacementCallerBindingIdentity,
      enclosingFunctionIdentity:
        contract.replacementEnclosingFunctionIdentity,
      retiredEnclosingFunctionIdentity: undefined,
      retiredEnclosingFunctionIdentities:
        expectedRetiredFunctionIdentities,
      retiredMutationSiteCount: 2,
      retiredMutationFunctionCount: 2,
      proofPrecision:
        "explicit-cross-file-multi-function",
      sourceFingerprint:
        contract.replacementActionSourceFingerprint,
      crossFileMigrationContractIdentity:
        contract.contractIdentity,
    },
  );
  const staleContract = structuredClone(contract);
  staleContract.retiredMutationSites.pop();
  staleContract.contractIdentity =
    buildStateActionCrossFileMigrationContractIdentity(
      staleContract,
    );
  assert.throws(
    () => buildCallerToActionLedger({
      phase: "P4.2b",
      previousPolicy: fixture.previousPolicy,
      writers: [fixture.actionWriter],
      retiredLegacySemanticAuthority:
        fixture.retiredLegacySemanticAuthority,
      actionDelegations: [fixture.actionDelegation],
      crossFileMigrationContract: [staleContract],
    }),
    (error) =>
      error?.code === "caller-action-ledger-proof-missing"
      && error.violations?.[0]?.reason
        === "cross-file-retired-mutation-sites-do-not-match-policy",
  );
});

test("domain-action membership authority is unique across action modules", () => {
  const policy = createCallerActionLedgerPolicy([]);
  policy.progress.latestPhase = "P4.1";
  delete policy.progress.callerToActionLedger;
  policy.progress.retiredLegacySemanticAuthority =
    createEmptyLegacySemanticAuthority();
  const bootWriter = structuredClone(policy.writers[0]);
  bootWriter.bindings[0].grants[0] = {
    domain: "boot",
    migrationPhase: "P4.1",
    operations: ["assign"],
    keys: ["bootPhase"],
    memberships: [{ operation: "assign", key: "bootPhase" }],
    aliasSites: [],
    dynamicSites: [],
    ambiguousSites: [],
    unsupportedSites: [],
  };
  const duplicateWriter = structuredClone(bootWriter);
  duplicateWriter.path =
    "js/core/state/actions/scenario_readiness_actions.js";
  duplicateWriter.bindings[0].id =
    "function:commitScenarioReadinessState:0:$";
  duplicateWriter.bindings[0].functionName =
    "commitScenarioReadinessState";
  policy.writers = [bootWriter, duplicateWriter];

  const violations = validateStateWriterPolicySchema(policy);
  assert.ok(
    violations.some(
      ({ code, domain, operation, key }) =>
        code === "duplicate-domain-action-membership-authority"
        && domain === "boot"
        && operation === "assign"
        && key === "bootPhase",
    ),
    JSON.stringify(violations, null, 2),
  );
});

test("multiple action exports in one module may share one membership authority", () => {
  const policy = createCallerActionLedgerPolicy([]);
  policy.progress.latestPhase = "P4.1";
  delete policy.progress.callerToActionLedger;
  policy.progress.retiredLegacySemanticAuthority =
    createEmptyLegacySemanticAuthority();
  const writer = policy.writers[0];
  writer.bindings.push({
    ...structuredClone(writer.bindings[0]),
    id: "function:replaceBootMetricsState:0:$",
    functionName: "replaceBootMetricsState",
  });

  assert.ok(
    !validateStateWriterPolicySchema(policy).some(
      ({ code }) =>
        code === "duplicate-domain-action-membership-authority",
    ),
  );
});

test("policy snapshot keeps every historical caller-to-action proof live after later phases", () => {
  const entry = createCallerActionLedgerEntry(0, {
    actionCallEdgeIdentity: "a".repeat(64),
  });
  const policy = createCallerActionLedgerPolicy([entry]);
  policy.progress.latestPhase = "P4.2b";
  const actionWriter = policy.writers[0];
  const scans = [{
    path: actionWriter.path,
    surface: actionWriter.surface,
    bindingId: actionWriter.bindings[0].id,
    findings: [
      createFinding({
        filePath: actionWriter.path,
        bindingId: actionWriter.bindings[0].id,
      }),
    ],
  }];

  const missingHistoricalEdge = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: [],
    scans,
    actionDelegations: [],
  });
  assert.ok(
    missingHistoricalEdge.violations.some(
      ({ code, retiredMembershipIdentity }) =>
        code === "caller-action-ledger-observation-missing"
        && retiredMembershipIdentity === entry.retiredMembershipIdentity,
    ),
    JSON.stringify(missingHistoricalEdge.violations, null, 2),
  );

  const movedButSemanticallyStableEdge =
    validateStateWriterPolicySnapshot({
      policy,
      legacyAllowlistPaths: [],
      scans,
      actionDelegations: [
        createActionDelegationObservation(entry, {
          callerBindingId: "renamed-local-binding-id",
          start: entry.start + 200,
          end: entry.end + 200,
          line: entry.line + 20,
          column: entry.column + 2,
          sourceFingerprint: "b".repeat(64),
        }),
      ],
    });
  assert.ok(
    !movedButSemanticallyStableEdge.violations.some(
      ({ code }) =>
        code === "caller-action-ledger-observation-missing"
        || code === "caller-action-ledger-observation-mismatch",
    ),
    JSON.stringify(
      movedButSemanticallyStableEdge.violations,
      null,
      2,
    ),
  );
});

test("current phase preserves exactly the 36 checked-in P4.1 caller-to-action proofs", async () => {
  const checkedIn = await readSharedRepositoryPolicy();
  const rebuilt = await buildSharedCurrentPhasePolicy();
  const entries = rebuilt.progress?.callerToActionLedger?.entries;

  assert.ok(Array.isArray(entries));
  const backfilledEntries = entries.filter(
    ({ backfilled }) => backfilled === true,
  );
  assert.equal(backfilledEntries.length, 36);
  assert.deepEqual(
    entries,
    [...entries].sort((left, right) =>
      left.retiredMembershipIdentity.localeCompare(
        right.retiredMembershipIdentity,
      )
      || left.actionCallEdgeIdentity.localeCompare(
        right.actionCallEdgeIdentity,
      )
    ),
  );
  assert.ok(
    backfilledEntries.every(
      ({ retiredInPhase, recordedInPhase, backfilled }) =>
        retiredInPhase === "P4.1"
        && recordedInPhase === "P4.2a"
        && backfilled === true,
    ),
  );
  assert.deepEqual(
    rebuilt.progress.callerToActionLedger,
    checkedIn.progress.callerToActionLedger,
  );
});

test("P4.5b closeout turns missed frozen targets into policy violations", () => {
  const targets = {
    productionLegacyDirectFiles: 54,
    productionLegacyMemberships: 726,
  };
  const currentMetrics = {
    productionLegacyDirectFiles: 55,
    productionLegacyMemberships: 727,
  };

  assert.deepEqual(
    buildStateWriterCloseoutTargetViolations({
      phase: "P4.5b",
      currentMetrics,
      targets,
    }),
    [
      {
        code: "closeout-legacy-direct-files-target-missed",
        actual: 55,
        target: 54,
      },
      {
        code: "closeout-legacy-memberships-target-missed",
        actual: 727,
        target: 726,
      },
    ],
  );
  assert.deepEqual(
    buildStateWriterCloseoutTargetViolations({
      phase: "P4.4",
      currentMetrics,
      targets,
    }),
    [],
  );
});

test("repository checker reports a passing closed-world policy and default-state shape", async () => {
  const policy = await readSharedRepositoryPolicy();
  await prepareSharedCurrentPhasePolicyInputs();
  const report = await buildStateWriterPolicyReport({
    policy,
    repositoryScanCache: SHARED_REPOSITORY_SCAN_CACHE,
    historicalDerivedAliasProofCache:
      SHARED_CHECKER_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE,
  });
  const currentCheckpoint = policy.progress.checkpoints.find(
    ({ phase }) => phase === policy.progress.latestPhase,
  );

  assert.equal(report.verdict, "pass", JSON.stringify(report.violations, null, 2));
  assert.equal(report.phase, policy.progress.latestPhase);
  assert.equal(report.metrics.unknownCandidateBindings, 0);
  assert.equal(report.metrics.stalePolicyBindings, 0);
  assert.deepEqual(report.metrics.legacyDirectFiles, {
    production: 75,
    test: 43,
    total: 118,
  });
  assert.ok(
    report.metrics.legacyMemberships.production
      <= currentCheckpoint.productionLegacyMemberships,
  );
  assert.ok(
    report.metrics.legacyMemberships.production
      <= report.frozenMetrics.bindingScopedMemberships.production.legacyCombined,
  );
  assert.ok(
    report.metrics.bindingScoped.sites.alias.production.legacyCombined
      <= report.frozenMetrics.bindingScopedSites.alias.production.legacyCombined,
  );
  assert.ok(
    report.metrics.bindingScoped.sites.ambiguous.production.legacyCombined
      <= report.frozenMetrics.bindingScopedSites.ambiguous.production.legacyCombined,
  );
  assert.ok(
    report.metrics.bindingScoped.sites.unsupported.production.legacyCombined
      <= report.frozenMetrics.bindingScopedSites.unsupported.production.legacyCombined,
  );
  assert.deepEqual(report.targets, {
    productionLegacyDirectFiles: 54,
    productionLegacyMemberships: 949,
    productionLegacyMembershipRatio: 0.8,
    productionLegacyMembershipDenominator: 1187,
    source:
      "baselines.bindingScopedMemberships.production.legacyCombined",
  });
  assert.equal(report.defaultState.actual.preCompatKeys, 402);
  assert.equal(report.defaultState.actual.postCompatKeys, 488);
  assert.equal(report.defaultState.actual.collisions, 0);
});

test("checker rejects a requested phase that has no matching policy checkpoint", async () => {
  const policy = await readSharedRepositoryPolicy();
  const missingPhase = "P4.5a";
  assert.equal(
    policy.progress.checkpoints.some(
      ({ phase }) => phase === missingPhase,
    ),
    false,
  );
  const report = await buildStateWriterPolicyReport({
    phase: missingPhase,
    policy,
    repositoryScanCache: SHARED_REPOSITORY_SCAN_CACHE,
    historicalDerivedAliasProofCache:
      SHARED_CHECKER_HISTORICAL_DERIVED_ALIAS_PROOF_CACHE,
  });
  assert.equal(report.phase, missingPhase);
  assert.equal(report.verdict, "fail");
  assert.deepEqual(
    report.violations.filter(
      ({ code }) => code === "policy-phase-mismatch",
    ),
    [{
      code: "policy-phase-mismatch",
      requestedPhase: missingPhase,
      policyLatestPhase: "P4.4",
    }],
  );
});

test("P4.0 freezes closeout targets from the authoritative membership denominator", () => {
  const baselines = {
    bindingScopedMemberships: {
      production: {
        legacyCombined: 1187,
      },
    },
  };

  assert.deepEqual(buildP4CloseoutTargets(baselines), {
    productionLegacyDirectFiles: 54,
    productionLegacyMemberships: 949,
    productionLegacyMembershipRatio: 0.8,
    productionLegacyMembershipDenominator: 1187,
    source:
      "baselines.bindingScopedMemberships.production.legacyCombined",
  });
  assert.deepEqual(
    validateFrozenCloseoutTargets({
      ...baselines,
      closeoutTargets: buildP4CloseoutTargets(baselines),
    }),
    [],
  );
  assert.deepEqual(
    validateFrozenCloseoutTargets({
      ...baselines,
      closeoutTargets: {
        ...buildP4CloseoutTargets(baselines),
        productionLegacyMembershipDenominator: 908,
      },
    }).map(({ code }) => code),
    ["closeout-target-denominator-drift"],
  );
  assert.deepEqual(
    validateFrozenCloseoutTargets({
      ...baselines,
      closeoutTargets: {
        productionLegacyDirectFiles: 999,
        productionLegacyMemberships: 830,
        productionLegacyMembershipRatio: 0.7,
        productionLegacyMembershipDenominator: 1187,
        source:
          "baselines.bindingScopedMemberships.production.legacyCombined",
      },
    }).map(({ code }) => code),
    [
      "closeout-target-ratio-drift",
      "closeout-membership-target-drift",
      "closeout-direct-files-target-drift",
    ],
  );
});

test("generic package verifier follows the checked-in policy phase", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const command = packageJson.scripts["verify:p4:state-writer-policy"];

  assert.equal(
    command,
    "npm run test:node:p4:state-writer-policy && node tools/check_state_writer_policy.mjs",
  );
});

test("canonical authority catalog detects collisions across factory explicit lazy and hook registrations", () => {
  const injected = buildCanonicalStateKeyAuthorityCatalog({
    additionalExplicitKeys: [
      {
        key: "bootPhase",
        domain: "boot",
        migrationPhase: "P4.1",
        owner: "explicit:fixture-boot-phase",
      },
    ],
    additionalLazyStateKeyDomains: {
      bootPhase: ["boot", "P4.1"],
      syncDayNightClockTimerFn: ["runtime-hooks", "P4.5"],
    },
    additionalCompatibilityHooks: ["startupInitialScenarioChunkVisualPromotion"],
  });

  assert.deepEqual(
    injected.collisions.map(({ key }) => key),
    [
      "bootPhase",
      "bootPhase",
      "startupInitialScenarioChunkVisualPromotion",
      "syncDayNightClockTimerFn",
    ],
  );
  assert.throws(
    () =>
      buildCanonicalStateKeyAuthorityIndex({
        additionalLazyStateKeyDomains: {
          bootPhase: ["boot", "P4.1"],
        },
      }),
    (error) =>
      error?.code === "state-key-authority-collision"
      && error.collisions.some(({ key }) => key === "bootPhase"),
  );
});

test("progress checkpoints require finite non-negative integer metrics", () => {
  const validMetrics = {
    productionLegacyDirectFiles: 75,
    productionLegacyMemberships: 1090,
    productionLegacyDynamicSites: 96,
    productionLegacyAliasSites: 96,
    productionLegacyAmbiguousSites: 216,
    productionLegacyUnsupportedSites: 2,
  };
  const invalidValues = [
    ["missing", undefined],
    ["nan", Number.NaN],
    ["negative", -1],
    ["fractional", 1.5],
    ["numeric-string", "2"],
  ];

  for (const [label, invalidValue] of invalidValues) {
    const currentMetrics = { ...validMetrics };
    if (label === "missing") {
      delete currentMetrics.productionLegacyUnsupportedSites;
    } else {
      currentMetrics.productionLegacyUnsupportedSites = invalidValue;
    }
    const result = validateStateWriterPolicyProgression({
      phase: "P4.0",
      currentMetrics,
    });
    assert.equal(result.verdict, "fail", label);
    assert.ok(
      result.violations.some(
        ({ code, metric, scope }) =>
          code === "progress-metric-invalid"
          && metric === "productionLegacyUnsupportedSites"
          && scope === "current",
      ),
      label,
    );
  }

  const invalidCheckpoint = validateStateWriterPolicyProgression({
    previousPolicy: {
      baseline: { phase: "P4.0" },
      progress: {
        latestPhase: "P4.0",
        checkpoints: [{
          phase: "P4.0",
          ...validMetrics,
          productionLegacyUnsupportedSites: Number.POSITIVE_INFINITY,
        }],
      },
    },
    phase: "P4.1",
    currentMetrics: validMetrics,
  });
  assert.ok(
    invalidCheckpoint.violations.some(
      ({ code, metric, scope }) =>
        code === "progress-metric-invalid"
        && metric === "productionLegacyUnsupportedSites"
        && scope === "checkpoint:P4.0",
    ),
  );

  const invalidAcceptedPolicyCheckpoint =
    validateStateWriterPolicyProgression({
      previousPolicy: {
        baseline: { phase: "P4.0" },
        progress: {
          latestPhase: "P4.2c",
          checkpoints: [{
            phase: "P4.2c",
            ...validMetrics,
            previousAcceptedSourceSha: "invalid",
            previousAcceptedPolicyBlobSha256: "invalid",
          }],
        },
      },
      phase: "P4.3",
      currentMetrics: validMetrics,
    });
  assert.ok(
    invalidAcceptedPolicyCheckpoint.violations.some(
      ({ code, phase }) =>
        code === "progress-accepted-policy-checkpoint-invalid"
        && phase === "P4.2c",
    ),
  );
});

test("policy snapshot admits exact non-ambiguous unsupported sites and rejects moved or stale sites", () => {
  const policy = createPolicyFixture();
  const grant = policy.writers[0].bindings[0].grants[0];
  grant.unsupportedSites.push({
    line: 11,
    column: 7,
    reason: "state-alias-escape",
    operation: "unsupported",
    key: "*",
  });
  const makeScans = (line, reason = "state-alias-escape") => [
    {
      path: "js/fixture.js",
      surface: "production",
      bindingId: "runtime-state",
      findings: [
        createFinding(),
        createFinding({
          operation: "unsupported",
          key: "*",
          unsupported: true,
          reason,
          line,
          column: 7,
        }),
      ],
    },
    {
      path: "tests/fixture.test.mjs",
      surface: "test",
      bindingId: "test-state",
      findings: [
        createFinding({
          filePath: "tests/fixture.test.mjs",
          bindingId: "test-state",
        }),
      ],
    },
  ];

  const exact = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans: makeScans(11),
  });
  const moved = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans: makeScans(12),
  });
  const changedReason = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans: makeScans(11, "unsupported-call-mutation"),
  });
  const stale = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans: makeScans(Number.NaN).map((scan, index) =>
      index === 0
        ? { ...scan, findings: [createFinding()] }
        : scan
    ),
  });

  assert.equal(exact.verdict, "pass", JSON.stringify(exact.violations));
  assert.equal(
    exact.metrics.bindingScoped.sites.unsupported.production.legacyCombined,
    1,
  );
  assert.ok(
    moved.violations.some(
      ({ code }) => code === "unknown-unsupported-site",
    ),
  );
  assert.ok(
    moved.violations.some(
      ({ code }) => code === "stale-unsupported-site",
    ),
  );
  assert.ok(
    changedReason.violations.some(
      ({ code }) => code === "unknown-unsupported-site",
    ),
  );
  assert.ok(
    changedReason.violations.some(
      ({ code }) => code === "stale-unsupported-site",
    ),
  );
  assert.ok(
    stale.violations.some(
      ({ code }) => code === "stale-unsupported-site",
    ),
  );
});

test("unsupported site progression is monotonic after the frozen baseline", () => {
  const previousPolicy = {
    baseline: { phase: "P4.0" },
    progress: {
      latestPhase: "P4.0",
      checkpoints: [
        {
          phase: "P4.0",
          productionLegacyDirectFiles: 75,
          productionLegacyMemberships: 1090,
          productionLegacyDynamicSites: 96,
          productionLegacyAliasSites: 96,
          productionLegacyAmbiguousSites: 216,
          productionLegacyUnsupportedSites: 2,
        },
      ],
    },
  };
  const result = validateStateWriterPolicyProgression({
    previousPolicy,
    phase: "P4.1",
    currentMetrics: {
      ...previousPolicy.progress.checkpoints[0],
      productionLegacyUnsupportedSites: 3,
    },
  });

  assert.ok(
    result.violations.some(
      ({ code }) => code === "legacy-unsupported-sites-increased",
    ),
  );
});

test("builder freezes exact diagnostic sites only for production bindings", () => {
  const unsupportedFinding = createFinding({
    operation: "unsupported",
    key: "*",
    unsupported: true,
    reason: "state-alias-escape",
    line: 9,
    column: 3,
  });
  const concreteFinding = createFinding({
    operation: "assign",
    key: "bootPhase",
    line: 10,
    column: 3,
  });
  const unknownUnsupportedFinding = createFinding({
    operation: "unsupported",
    key: "forceExactContextBaseRefresh",
    unsupported: true,
    reason: "state-alias-escape",
    line: 11,
    column: 3,
  });
  const unknownConcreteFinding = createFinding({
    operation: "assign",
    key: "forceExactContextBaseRefresh",
    unsupported: false,
    line: 12,
    column: 3,
  });
  const productionGrants = buildStateWriterBindingGrants(
    [unsupportedFinding],
    "js/bootstrap/fixture.js",
    buildCanonicalStateKeyAuthorityIndex(),
    "production",
  );
  const testGrants = buildStateWriterBindingGrants(
    [unsupportedFinding, concreteFinding],
    "tests/fixture.test.mjs",
    buildCanonicalStateKeyAuthorityIndex(),
    "test",
  );

  assert.equal(productionGrants.length, 1);
  assert.deepEqual(productionGrants[0].unsupportedSites, [
    {
      line: 9,
      column: 3,
      reason: "state-alias-escape",
      operation: "unsupported",
      key: "*",
    },
  ]);
  assert.equal(testGrants.length, 1);
  assert.deepEqual(testGrants[0].memberships, [
    {
      operation: "assign",
      key: "bootPhase",
    },
  ]);
  assert.deepEqual(testGrants[0].ambiguousSites, []);
  assert.deepEqual(testGrants[0].unsupportedSites, []);
  assert.deepEqual(
    buildStateWriterBindingGrants(
      [unsupportedFinding],
      "tests/diagnostic_only.test.mjs",
      buildCanonicalStateKeyAuthorityIndex(),
      "test",
    ),
    [],
  );
  assert.throws(
    () => buildStateWriterBindingGrants(
      [unknownUnsupportedFinding],
      "js/bootstrap/fixture.js",
      buildCanonicalStateKeyAuthorityIndex(),
      "production",
    ),
    { code: "unknown-state-key-authority" },
  );
  assert.throws(
    () => buildStateWriterBindingGrants(
      [unknownConcreteFinding],
      "js/bootstrap/fixture.js",
      buildCanonicalStateKeyAuthorityIndex(),
      "production",
    ),
    { code: "unknown-state-key-authority" },
  );
  const conservativeBaselineGrants = buildStateWriterBindingGrants(
    [unknownUnsupportedFinding],
    "js/bootstrap/fixture.js",
    buildCanonicalStateKeyAuthorityIndex(),
    "production",
    { allowUnknownUnsupportedAuthority: true },
  );
  assert.equal(conservativeBaselineGrants.length, 1);
  assert.equal(conservativeBaselineGrants[0].domain, "boot");
  assert.equal(
    conservativeBaselineGrants[0].migrationPhase,
    "P4.1",
  );
  assert.deepEqual(
    conservativeBaselineGrants[0].unsupportedSites,
    [{
      line: 11,
      column: 3,
      reason: "state-alias-escape",
      operation: "unsupported",
      key: "forceExactContextBaseRefresh",
    }],
  );
  assert.throws(
    () => buildStateWriterBindingGrants(
      [unknownConcreteFinding],
      "js/bootstrap/fixture.js",
      buildCanonicalStateKeyAuthorityIndex(),
      "production",
      { allowUnknownUnsupportedAuthority: true },
    ),
    { code: "unknown-state-key-authority" },
  );
});

test("test-fixture diagnostics use aggregate budgets while concrete memberships remain exact", () => {
  const policy = createPolicyFixture();
  const testScan = {
    path: "tests/fixture.test.mjs",
    surface: "test",
    bindingId: "test-state",
    findings: [
      createFinding({
        filePath: "tests/fixture.test.mjs",
        bindingId: "test-state",
      }),
      createFinding({
        filePath: "tests/fixture.test.mjs",
        bindingId: "test-state",
        operation: "unsupported",
        key: "*",
        unsupported: true,
        reason: "ambiguous-alias-flow",
        line: 12,
        column: 2,
      }),
      createFinding({
        filePath: "tests/fixture.test.mjs",
        bindingId: "test-state",
        operation: "unsupported",
        key: "*",
        unsupported: true,
        reason: "state-alias-escape",
        line: 13,
        column: 2,
      }),
    ],
  };
  const scans = [
    {
      path: "js/fixture.js",
      surface: "production",
      bindingId: "runtime-state",
      findings: [createFinding()],
    },
    testScan,
  ];
  const result = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans,
  });

  assert.equal(result.verdict, "pass", JSON.stringify(result.violations));
  assert.deepEqual(result.metrics.bindingScoped.diagnostics.test, {
    byReason: {
      "ambiguous-alias-flow": 1,
      "state-alias-escape": 1,
    },
    total: 2,
  });

  const exactTestGrant = structuredClone(policy);
  exactTestGrant.writers[1].bindings[0].grants[0].unsupportedSites.push({
    line: 13,
    column: 2,
    reason: "state-alias-escape",
    operation: "unsupported",
    key: "*",
  });
  const exactGrantResult = validateStateWriterPolicySnapshot({
    policy: exactTestGrant,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans,
  });
  assert.ok(
    exactGrantResult.violations.some(
      ({ code }) =>
        code === "test-fixture-exact-diagnostic-grant-forbidden",
    ),
  );

  const concreteDrift = validateStateWriterPolicySnapshot({
    policy,
    legacyAllowlistPaths: ["js/fixture.js", "tests/fixture.test.mjs"],
    scans: [
      scans[0],
      {
        ...testScan,
        findings: [
          createFinding({
            filePath: "tests/fixture.test.mjs",
            bindingId: "test-state",
            key: "bootMessage",
          }),
        ],
      },
    ],
  });
  assert.ok(
    concreteDrift.violations.some(
      ({ code }) => code === "unknown-membership",
    ),
  );
  assert.ok(
    concreteDrift.violations.some(
      ({ code }) => code === "stale-membership",
    ),
  );
});

test("test diagnostic aggregate budget rejects new reasons and count increases", () => {
  const baseline = {
    byReason: {
      "ambiguous-alias-flow": 2,
      "state-alias-escape": 3,
    },
    total: 5,
  };
  assert.deepEqual(
    validateTestDiagnosticBudget({
      baseline,
      current: {
        byReason: {
          "ambiguous-alias-flow": 1,
          "state-alias-escape": 3,
        },
        total: 4,
      },
    }),
    [],
  );

  const violations = validateTestDiagnosticBudget({
    baseline,
    current: {
      byReason: {
        "ambiguous-alias-flow": 3,
        "state-alias-escape": 3,
        "unsupported-call-mutation": 1,
      },
      total: 7,
    },
  });
  assert.deepEqual(
    violations.map(({ code, reason }) => [code, reason || ""]),
    [
      ["test-diagnostic-reason-increased", "ambiguous-alias-flow"],
      ["test-diagnostic-reason-added", "unsupported-call-mutation"],
      ["test-diagnostic-total-increased", ""],
    ],
  );
  assert.deepEqual(
    validateTestDiagnosticBudget({
      baseline: {
        byReason: { "ambiguous-alias-flow": 2 },
        total: 1,
      },
      current: {
        byReason: { "ambiguous-alias-flow": 1 },
        total: 2,
      },
    }).map(({ code }) => code),
    [
      "test-diagnostic-baseline-total-mismatch",
      "test-diagnostic-total-mismatch",
      "test-diagnostic-total-increased",
    ],
  );
});

test("verification identity distinguishes source and verification SHAs and fails closed on tracked dirt", () => {
  const calls = [];
  const cleanIdentity = buildStateWriterVerificationIdentity({
    sourceBaseSha: "1".repeat(40),
    requireClean: true,
    runGit(args) {
      calls.push(args);
      const joined = args.join(" ");
      if (joined === "rev-parse --verify HEAD^{commit}") {
        return `${"2".repeat(40)}\n`;
      }
      if (joined === "rev-parse HEAD^{tree}") {
        return `${"3".repeat(40)}\n`;
      }
      if (joined.startsWith("status --porcelain")) {
        return "";
      }
      if (joined.startsWith("hash-object ")) {
        return `${"4".repeat(40)}\n`;
      }
      throw new Error(`unexpected git call: ${joined}`);
    },
    policyPath: "tools/state_writer_policy.json",
    configPaths: [
      "tools/state_writer_policy.mjs",
      "tools/build_state_writer_policy.mjs",
    ],
  });

  assert.equal(cleanIdentity.sourceBaseSha, "1".repeat(40));
  assert.equal(cleanIdentity.verificationSha, "2".repeat(40));
  assert.equal(cleanIdentity.verificationTreeSha, "3".repeat(40));
  assert.equal(cleanIdentity.trackedClean, true);
  assert.equal(cleanIdentity.policyBlobSha, "4".repeat(40));
  assert.equal(cleanIdentity.configBlobShas.length, 2);
  assert.match(cleanIdentity.configTreeIdentity, /^[0-9a-f]{64}$/);
  assert.deepEqual(cleanIdentity.violations, []);
  assert.ok(calls.length >= 5);
  assert.ok(
    calls.some(
      (args) =>
        args.join(" ")
        === "status --porcelain=v1 --untracked-files=all",
    ),
  );

  const dirtyIdentity = buildStateWriterVerificationIdentity({
    sourceBaseSha: "1".repeat(40),
    requireClean: true,
    runGit(args) {
      const joined = args.join(" ");
      if (joined === "rev-parse --verify HEAD^{commit}") {
        return `${"2".repeat(40)}\n`;
      }
      if (joined === "rev-parse HEAD^{tree}") {
        return `${"3".repeat(40)}\n`;
      }
      if (joined.startsWith("status --porcelain")) {
        return " M tools/state_writer_policy.mjs\n";
      }
      if (joined.startsWith("hash-object ")) {
        return `${"4".repeat(40)}\n`;
      }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });

  assert.equal(dirtyIdentity.trackedClean, false);
  assert.deepEqual(
    dirtyIdentity.violations.map(({ code }) => code),
    ["tracked-worktree-dirty"],
  );

  const untrackedIdentity = buildStateWriterVerificationIdentity({
    sourceBaseSha: "1".repeat(40),
    requireClean: true,
    runGit(args) {
      const joined = args.join(" ");
      if (joined === "rev-parse --verify HEAD^{commit}") {
        return `${"2".repeat(40)}\n`;
      }
      if (joined === "rev-parse HEAD^{tree}") {
        return `${"3".repeat(40)}\n`;
      }
      if (joined.startsWith("status --porcelain")) {
        return "?? tools/state_writer_policy.json\n";
      }
      if (joined.startsWith("hash-object ")) {
        return `${"4".repeat(40)}\n`;
      }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(untrackedIdentity.trackedClean, false);
  assert.deepEqual(
    untrackedIdentity.violations.map(({ code }) => code),
    ["tracked-worktree-dirty"],
  );
});

test("source base SHA resolves to a commit and rejects non-commit revisions", () => {
  const head = resolveGitCommitSha("HEAD");
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.throws(
    () => resolveGitCommitSha("refs/heads/__missing_p4_fixture__"),
    /commit/i,
  );
});

test("accepted policy checkpoint resolves the newest exact committed policy blob", () => {
  const acceptedSha = "2".repeat(40);
  const olderSha = "1".repeat(40);
  const policy = {
    schemaVersion: 2,
    progress: { latestPhase: "P4.2c" },
  };
  const acceptedSource = `${JSON.stringify({
    progress: policy.progress,
    schemaVersion: policy.schemaVersion,
  }, null, 2)}\n`;
  const calls = [];
  const checkpoint = resolveAcceptedStateWriterPolicyCheckpoint({
    policy,
    runGit(args) {
      calls.push(args);
      const joined = args.join(" ");
      if (
        joined
        === "log --format=%H HEAD -- tools/state_writer_policy.json"
      ) {
        return `${acceptedSha}\n${olderSha}\n`;
      }
      if (
        joined
        === `show ${acceptedSha}:tools/state_writer_policy.json`
      ) {
        return acceptedSource;
      }
      if (
        joined
        === `show ${olderSha}:tools/state_writer_policy.json`
      ) {
        return "{}\n";
      }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });

  assert.deepEqual(checkpoint, {
    sourceSha: acceptedSha,
    policyBlobSha256: createHash("sha256")
      .update(acceptedSource)
      .digest("hex"),
  });
  assert.deepEqual(calls, [
    ["log", "--format=%H", "HEAD", "--", "tools/state_writer_policy.json"],
    ["show", `${acceptedSha}:tools/state_writer_policy.json`],
  ]);
});

test("derived alias taint manifest retains deleted production paths without adding scan candidates", () => {
  const sourceBaseSha = "1".repeat(40);
  const candidatePaths = ["js/current.js"];
  const manifest = buildStateWriterDerivedAliasTaintModeManifest({
    sourceBaseSha,
    candidatePaths,
    runGit(args) {
      if (args[0] === "rev-parse") return sourceBaseSha;
      if (args[0] === "diff") return "js/deleted.js\n";
      return "";
    },
  });
  assert.deepEqual(candidatePaths, ["js/current.js"]);
  assert.deepEqual(manifest.changedProductionPaths, ["js/deleted.js"]);
  assert.equal(manifest.modeByPath["js/deleted.js"], DERIVED_ALIAS_TAINT_MODES.STRICT);
  assert.deepEqual(validateStateWriterDerivedAliasTaintModeManifest(manifest), []);
  const { ["js/deleted.js"]: removed, ...modeByPath } = manifest.modeByPath;
  assert.ok(validateStateWriterDerivedAliasTaintModeManifest({ ...manifest, modeByPath })
    .some(({ code }) => code === "derived-alias-taint-changed-path-mode-missing"));
});

test("derived alias taint manifest makes changed production strict and preserves unchanged baseline production", () => {
  const baselineSha = "1".repeat(40);
  const candidatePaths = [
    "js/changed.js",
    "js/committed_since_baseline.js",
    "js/renamed_since_baseline.js",
    "js/copied_since_baseline.js",
    "js/staged_or_unstaged.js",
    "js/untracked.js",
    "js/persisted_strict.js",
    "js/unchanged.js",
    "js/core/state/actions/unchanged_action.js",
    "tests/changed_fixture.js",
  ];
  const calls = [];
  const manifest = buildStateWriterDerivedAliasTaintModeManifest({
    previousPolicy: {
      baseline: { sourceBaseSha: baselineSha },
      baselines: {
        derivedAliasTaint: {
          paths: ["js/persisted_strict.js"],
        },
      },
    },
    sourceBaseSha: baselineSha,
    candidatePaths,
    runGit(args) {
      calls.push(args);
      const joined = args.join(" ");
      if (
        joined
        === `rev-parse --verify ${baselineSha}^{commit}`
      ) {
        return `${baselineSha}\n`;
      }
      if (
        joined
        === `merge-base --is-ancestor ${baselineSha} HEAD`
      ) {
        return "";
      }
      if (
        joined
        === `diff --name-only ${baselineSha} -- js`
      ) {
        return [
          "js/changed.js",
          "js/committed_since_baseline.js",
          "js/renamed_since_baseline.js",
          "js/copied_since_baseline.js",
          "js/staged_or_unstaged.js",
        ].join("\n");
      }
      if (
        joined
        === "ls-files --others --exclude-standard -- js"
      ) {
        return "js/untracked.js\n";
      }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });

  assert.deepEqual(
    manifest.changedProductionPaths,
    [
      "js/changed.js",
      "js/committed_since_baseline.js",
      "js/copied_since_baseline.js",
      "js/renamed_since_baseline.js",
      "js/staged_or_unstaged.js",
      "js/untracked.js",
    ],
  );
  for (const relativePath of [
    "js/changed.js",
    "js/committed_since_baseline.js",
    "js/renamed_since_baseline.js",
    "js/copied_since_baseline.js",
    "js/staged_or_unstaged.js",
    "js/untracked.js",
    "js/persisted_strict.js",
    "js/core/state/actions/unchanged_action.js",
  ]) {
    assert.equal(
      manifest.modeByPath[relativePath],
      DERIVED_ALIAS_TAINT_MODES.STRICT,
      relativePath,
    );
  }
  assert.equal(
    manifest.modeByPath["js/unchanged.js"],
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  assert.equal(
    manifest.modeByPath["tests/changed_fixture.js"],
    DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
  );
  assert.deepEqual(
    manifest.persistentStrictProductionPaths,
    ["js/persisted_strict.js"],
  );
  assert.deepEqual(
    validateStateWriterDerivedAliasTaintModeManifest(manifest),
    [],
  );
  assert.equal(calls.length, 4);
});

test("derived alias taint manifest rejects changed-path legacy resolution, git failures, and baseline drift", () => {
  const baselineSha = "1".repeat(40);
  const strictManifest = {
    sourceBaseSha: baselineSha,
    changedProductionPaths: ["js/changed.js"],
    modeByPath: {
      "js/changed.js":
        DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
    },
  };
  assert.ok(
    validateStateWriterDerivedAliasTaintModeManifest(strictManifest)
      .some(
        ({ code }) =>
          code
          === "derived-alias-taint-changed-path-resolved-legacy",
      ),
  );

  assert.throws(
    () =>
      buildStateWriterDerivedAliasTaintModeManifest({
        previousPolicy: {
          baseline: { sourceBaseSha: baselineSha },
        },
        sourceBaseSha: baselineSha,
        candidatePaths: ["js/changed.js"],
        runGit(args) {
          if (args[0] === "rev-parse") {
            return `${baselineSha}\n`;
          }
          if (args[0] === "merge-base") {
            return "";
          }
          throw new Error("diff unavailable");
        },
      }),
    (error) =>
      error?.code === "derived-alias-taint-git-diff-failed",
  );

  assert.throws(
    () =>
      buildStateWriterDerivedAliasTaintModeManifest({
        previousPolicy: {
          baseline: { sourceBaseSha: baselineSha },
        },
        sourceBaseSha: "2".repeat(40),
        candidatePaths: ["js/changed.js"],
        runGit(args) {
          const revision = String(args[2] || "")
            .replace(/\^\{commit\}$/, "");
          return `${revision}\n`;
        },
      }),
    (error) =>
      error?.code === "derived-alias-taint-baseline-drift",
  );

  assert.throws(
    () =>
      buildStateWriterDerivedAliasTaintModeManifest({
        previousPolicy: {
          baseline: { sourceBaseSha: "invalid-base" },
        },
        candidatePaths: ["js/changed.js"],
        runGit() {
          throw new Error("unknown revision");
        },
      }),
    (error) => error?.code === "source-base-sha-invalid",
  );

  assert.throws(
    () =>
      buildStateWriterDerivedAliasTaintModeManifest({
        previousPolicy: {
          baseline: { sourceBaseSha: baselineSha },
        },
        sourceBaseSha: baselineSha,
        candidatePaths: ["js/changed.js"],
        runGit(args) {
          if (args[0] === "rev-parse") {
            return `${baselineSha}\n`;
          }
          if (args[0] === "merge-base") {
            throw new Error("not an ancestor");
          }
          throw new Error(`unexpected git call: ${args.join(" ")}`);
        },
      }),
    (error) =>
      error?.code
      === "derived-alias-taint-baseline-not-ancestor",
  );
});

test("binding discovery honors the same derived alias taint mode as candidate scanning", async () => {
  const source = `
    function identity(value) {
      return value;
    }
    export function update(model) {
      const alias = identity(model);
      alias.bootPhase = "ready";
    }
  `;
  const strictBindings = await discoverStateWriterBindingsForSource(
    "js/changed_derived_alias_fixture.js",
    source,
    "production",
    {
      scanAllParameters: true,
      derivedAliasTaintMode:
        DERIVED_ALIAS_TAINT_MODES.STRICT,
    },
  );
  const legacyBindings = await discoverStateWriterBindingsForSource(
    "js/unchanged_derived_alias_fixture.js",
    source,
    "production",
    {
      scanAllParameters: true,
      derivedAliasTaintMode:
        DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE,
    },
  );

  assert.equal(
    strictBindings.some(
      ({ functionName }) => functionName === "update",
    ),
    true,
  );
  assert.equal(
    legacyBindings.some(
      ({ functionName }) => functionName === "update",
    ),
    false,
  );
});

test("default-state key shape is hermetic across child-process global variations", () => {
  const moduleUrl = new URL("../tools/state_writer_policy.mjs", import.meta.url)
    .href;
  const runProbe = (globals) => {
    const script = `
      Object.assign(globalThis, ${JSON.stringify(globals)});
      const { buildDefaultStateOwnershipReport } = await import(${JSON.stringify(moduleUrl)});
      const report = await buildDefaultStateOwnershipReport();
      process.stdout.write(JSON.stringify({
        factoryGroups: report.factoryGroups.map(({ id, keys }) => ({ id, keys })),
        explicitKeys: report.explicitKeys,
        compatibilityHooks: report.compatibilityHooks,
        preCompatKeyCount: report.preCompatKeyCount,
        postCompatKeyCount: report.postCompatKeyCount,
        actualFacadeKeys: report.actualFacadeKeys,
      }));
    `;
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      script,
    ], {
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };

  const baseline = runProbe({
    currentLanguage: "",
    devicePixelRatio: 0,
    topojson: null,
  });
  const varied = runProbe({
    currentLanguage: "zh-CN",
    devicePixelRatio: 3,
    topojson: { feature: "fixture" },
  });

  assert.deepEqual(varied, baseline);
  assert.equal(baseline.preCompatKeyCount, 402);
  assert.equal(baseline.postCompatKeyCount, 488);
});


test("HGO variant action admits only its two exact country selection writes", async () => {
  const modulePath = "js/core/state/actions/scenario_presentation_actions.js";
  const exportName = "setHgoIdentityVariantSelectionState";
  const entry = STATE_ACTION_DELEGATION_CONTRACT.find(item => item.modulePath === modulePath && item.exportName === exportName);
  const { bindingInventories } = await discoverStateWriterBindingsForSource(
    modulePath, fs.readFileSync(modulePath, "utf8"), "production", { includeInventories: true },
  );
  const inventory = bindingInventories.find(item => item.binding.functionName === exportName);
  assert.ok(inventory, "actual action target must be discovered");
  const binding = {
    ...inventory.binding, authority: "domain-action",
    grants: buildStateWriterBindingGrants(inventory.findings, modulePath, buildCanonicalStateKeyAuthorityIndex(), "production"),
  };
  const writer = { path: modulePath, authority: "domain-action", bindings: [binding] };
  const validate = candidate => validateStateActionPolicyBindings([candidate], { contractEntries: [entry], modulePaths: [modulePath] });
  assert.deepEqual(validate(writer), []);
  assert.deepEqual(binding.grants.flatMap(grant => grant.dynamicSites).map(({ operation, pathPattern }) => ({ operation, pathPattern })).sort((a,b) => a.operation.localeCompare(b.operation)), [
    { operation: "assign", pathPattern: "hgoIdentity.variantSelections.*" },
    { operation: "delete", pathPattern: "hgoIdentity.variantSelections.*" },
  ]);
  for (const pathPattern of ["hgoIdentity.*", "hgoIdentity.otherSelections.*", "hgoIdentity.variantSelections.*.nested"]) {
    const widened = structuredClone(writer);
    widened.bindings[0].grants[0].dynamicSites[0].pathPattern = pathPattern;
    assert.ok(validate(widened).some(({ code }) => code === "state-action-policy-binding-diagnostics-invalid"), pathPattern);
  }
});
