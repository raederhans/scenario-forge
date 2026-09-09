import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  P4_NIGHTLY_AUTHORITY_KIND,
  P4_NIGHTLY_AUTHORITY_SCHEMA_VERSION,
  P4_NIGHTLY_FAST_COMMANDS,
  P4_NIGHTLY_FULL_POLICY_COMMAND,
  P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS,
  buildP4NightlyAuthorityPlan,
  runP4NightlyAuthority,
} from "../tools/verification/p4_nightly_authority.mjs";
import { validateP4NightlyCloseout } from "../tools/verification/p4_nightly_closeout.mjs";
import { resolveP4NightlyAuthorityReceipt } from "../tools/verification/p4_nightly_receipt_resolver.mjs";
import {
  buildP4NightlyRepairPlan,
  captureP4NightlyRepairToolDigests,
} from "../tools/verification/p4_nightly_repair.mjs";
import { P4_STATE_WRITER_POLICY_TEST_FILES } from "../tools/run_p4_state_writer_policy_tests.mjs";

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const PLAN_ID = "sha256:canonical-full-plan";
const TAP = "TAP version 13\n1..1\nok 1 - canonical\n";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function authorityOutput(t) {
  const runtimeTmp = path.join(REPO_ROOT, ".runtime", "tmp");
  fs.mkdirSync(runtimeTmp, { recursive: true });
  const root = fs.mkdtempSync(path.join(runtimeTmp, "p4-authority-failure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "receipt.json");
}

test("authority writes failed command and completed steps while preserving the original exit", (t) => {
  const outPath = authorityOutput(t);
  let calls = 0;
  assert.throws(() => runP4NightlyAuthority("fast-contracts-routes", {
    outPath,
    identityReader: identity,
    runner: () => ({ status: ++calls === 1 ? 0 : 23 }),
  }), (error) => error.status === 23 && error.receipt.status === "fail");
  const receipt = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(receipt.failure.category, "command-exit");
  assert.equal(receipt.failure.exitCode, 23);
  assert.equal(receipt.failure.commandRef, P4_NIGHTLY_FAST_COMMANDS[1]);
  assert.deepEqual(receipt.completedSteps, [P4_NIGHTLY_FAST_COMMANDS[0]]);
  assert.equal(receipt.commands[1].status, "fail");
  assert.deepEqual(receipt.finalSourceIdentity, identity());
  const { receiptDigest, ...body } = receipt;
  assert.equal(receiptDigest, seal(body).receiptDigest);
  const closeout = fixtures();
  closeout.authorities[2] = receipt;
  assert.throws(() => validateP4NightlyCloseout(closeout),
    (error) => error.code === "p4-nightly-authority-role-set");
});

test("authority writes receipts for returned startup errors, thrown startup errors, and signals", (t) => {
  for (const [runner, category, signal] of [
    [() => ({ error: Object.assign(new Error("missing binary"), { code: "ENOENT" }), status: null }), "command-start", null],
    [() => { throw Object.assign(new Error("cannot spawn"), { code: "ENOENT" }); }, "command-start", null],
    [() => ({ status: null, signal: "SIGTERM" }), "command-signal", "SIGTERM"],
  ]) {
    const outPath = authorityOutput(t);
    assert.throws(() => runP4NightlyAuthority("fast-contracts-routes", { outPath, identityReader: identity, runner }));
    const receipt = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(receipt.failure.category, category);
    assert.equal(receipt.failure.exitCode, null);
    assert.equal(receipt.failure.signal, signal);
    assert.deepEqual(receipt.completedSteps, []);
    assert.equal(receipt.commands.length, 1);
  }
});

test("authority records dirty source rejection before executing commands", (t) => {
  const outPath = authorityOutput(t);
  const dirty = { ...identity(), workspaceClean: false, trackedClean: false, workspaceStatus: " M js/example.js" };
  assert.throws(() => runP4NightlyAuthority("fast-contracts-routes", {
    outPath,
    identityReader: () => dirty,
    runner: () => assert.fail("dirty source must not execute"),
  }), /exact clean Git/);
  const receipt = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(receipt.failure.category, "source-identity");
  assert.deepEqual(receipt.sourceIdentity, dirty);
  assert.deepEqual(receipt.commands, []);
});

test("authority records producer rejection and post-command identity drift", (t) => {
  const outPath = authorityOutput(t);
  assert.throws(() => runP4NightlyAuthority("checker-boundaries", {
    outPath,
    identityReader: identity,
    evidenceProducer: () => { throw Object.assign(new Error("checker failed"), { status: 2, code: "owner-proof", stderr: "proof mismatch" }); },
  }));
  let receipt = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(receipt.failure.category, "evidence-production");
  assert.equal(receipt.failure.exitCode, 2);
  assert.equal(receipt.failure.stderr, "proof mismatch");
  let reads = 0;
  assert.throws(() => runP4NightlyAuthority("fast-contracts-routes", {
    outPath,
    identityReader: () => ({ ...identity(), verificationSha: ++reads === 1 ? SHA : "c".repeat(40) }),
    runner: () => ({ status: 0 }),
  }), /drifted/);
  receipt = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(receipt.failure.category, "final-identity");
  assert.deepEqual(receipt.completedSteps, P4_NIGHTLY_FAST_COMMANDS);
});

test("authority does not replace a child failure when receipt persistence fails", (t) => {
  const outPath = authorityOutput(t);
  fs.mkdirSync(outPath);
  assert.throws(() => runP4NightlyAuthority("full-policy-tap", {
    outPath,
    identityReader: identity,
    runner: () => ({ status: 17 }),
  }), (error) => error.status === 17 && error.receiptWriteError instanceof Error);
});

test("authority preserves successful receipts and records evidence validation failures", (t) => {
  const outPath = authorityOutput(t);
  const success = runP4NightlyAuthority("fast-contracts-routes", {
    outPath,
    identityReader: identity,
    runner: () => ({ status: 0 }),
  });
  assert.equal(success.status, "pass");
  assert.deepEqual(success.commands.map((entry) => entry.commandRef), P4_NIGHTLY_FAST_COMMANDS);
  assert.equal(success.failure, undefined);
  assert.throws(() => runP4NightlyAuthority("checker-boundaries", {
    outPath,
    identityReader: identity,
    evidenceProducer: () => ({ evidenceId: "proof" }),
    evidenceValidator: () => { throw new Error("evidence mismatch"); },
    runner: () => assert.fail("invalid evidence must not execute"),
  }));
  const failure = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(failure.failure.category, "evidence-validation");
  assert.equal(failure.failure.commandRef, P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS[0]);
  assert.equal(failure.completedSteps.length, 1);
});

function identity() {
  return {
    verificationSha: SHA,
    verificationTreeSha: TREE,
    workspaceClean: true,
    trackedClean: true,
    includesUntracked: true,
    workspaceStatus: "",
  };
}

function seal(receipt) {
  return {
    ...receipt,
    receiptDigest: crypto.createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function command(commandRef, evidenceId = undefined) {
  return { commandRef, status: "pass", exitCode: 0, ...(evidenceId ? { evidenceId } : {}) };
}

function fixtures() {
  const evidence = {
    schemaVersion: 1,
    kind: "state-writer-policy-checker-evidence",
    phase: "P4.4",
    producer: { role: "checker-producer" },
    verificationIdentity: identity(),
  };
  evidence.evidenceId = crypto.createHash("sha256").update(stableJson(evidence)).digest("hex");
  const evidenceId = evidence.evidenceId;
  const checkerCommands = [
    command("node tools/verification/state_writer_policy_evidence.mjs produce --phase P4.4", evidenceId),
    ...P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS.map((commandRef) => command(commandRef)),
  ];
  const authorities = [
    seal({
      schemaVersion: P4_NIGHTLY_AUTHORITY_SCHEMA_VERSION,
      kind: P4_NIGHTLY_AUTHORITY_KIND,
      role: "checker-boundaries",
      status: "pass",
      sourceIdentity: identity(),
      finalSourceIdentity: identity(),
      commands: checkerCommands,
      checker: {
        producerRole: "checker-producer",
        checkerCount: 1,
        liveFallbackAttempts: 0,
        evidenceId,
        boundaryEvidence: P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS.map((commandRef) => ({
          commandRef,
          evidenceId,
        })),
      },
    }),
    seal({
      schemaVersion: P4_NIGHTLY_AUTHORITY_SCHEMA_VERSION,
      kind: P4_NIGHTLY_AUTHORITY_KIND,
      role: "full-policy-tap",
      status: "pass",
      sourceIdentity: identity(),
      finalSourceIdentity: identity(),
      commands: [command(P4_NIGHTLY_FULL_POLICY_COMMAND)],
      fullPolicy: {
        admissionEligible: true,
        canonicalFullPlanCount: 1,
        planIdentity: PLAN_ID,
        expectedPlanIdentity: PLAN_ID,
        testArguments: P4_STATE_WRITER_POLICY_TEST_FILES,
        canonicalSha256: crypto.createHash("sha256").update(TAP).digest("hex"),
      },
    }),
    seal({
      schemaVersion: P4_NIGHTLY_AUTHORITY_SCHEMA_VERSION,
      kind: P4_NIGHTLY_AUTHORITY_KIND,
      role: "fast-contracts-routes",
      status: "pass",
      sourceIdentity: identity(),
      finalSourceIdentity: identity(),
      commands: P4_NIGHTLY_FAST_COMMANDS.map((commandRef) => command(commandRef)),
      fast: { contracts: "pass", routes: "pass" },
    }),
  ];
  return {
    authorities,
    expectedSha: SHA,
    expectedTree: TREE,
    evidence,
    canonicalTap: TAP,
    completedArtifact: {
      status: "passed",
      admissionEligible: true,
      planIdentityVerified: true,
      planIdentity: PLAN_ID,
      canonicalSha256: crypto.createHash("sha256").update(TAP).digest("hex"),
      args: ["--test", ...P4_STATE_WRITER_POLICY_TEST_FILES],
      verificationIdentity: {
        start: { ...identity(), available: true },
        end: { ...identity(), available: true },
      },
    },
  };
}

function mixedRepairPlan() {
  return buildP4NightlyRepairPlan({
    sourceRunId: "100",
    currentRunId: "200",
    rerunScope: "failed",
    expectedSha: SHA,
    expectedTree: TREE,
    currentIdentity: identity(),
    sourceRun: {
      id: 100,
      status: "completed",
      event: "schedule",
      path: ".github/workflows/nightly-verification.yml",
      head_sha: SHA,
      run_attempt: 2,
    },
    sourceJobs: [
      { name: "Nightly P4 Checker and Python Boundaries", conclusion: "failure" },
      { name: "Nightly P4 Canonical Full Policy TAP", conclusion: "success" },
      { name: "Nightly P4.4 Fast Contracts and Routes", conclusion: "success" },
    ],
    sourceJobTotalCount: 3,
    sourceArtifacts: [
      {
        id: 11,
        name: `nightly-p4-full-policy-${SHA}-2`,
        expired: false,
        digest: `sha256:${"c".repeat(64)}`,
      },
      {
        id: 12,
        name: `nightly-p4-fast-${SHA}-2`,
        expired: false,
        digest: `sha256:${"d".repeat(64)}`,
      },
    ],
    sourceArtifactTotalCount: 2,
    toolDigests: captureP4NightlyRepairToolDigests(),
  });
}

function resolveMixedAuthorities(value, plan) {
  return value.authorities.map((receipt) => resolveP4NightlyAuthorityReceipt({
    receipt,
    role: receipt.role,
    expectedSha: SHA,
    expectedTree: TREE,
    repairPlan: plan,
    currentRunId: "200",
  }));
}

test("P4 Nightly splits the former exact plan into three disjoint authorities", () => {
  const checker = buildP4NightlyAuthorityPlan("checker-boundaries");
  const full = buildP4NightlyAuthorityPlan("full-policy-tap");
  const fast = buildP4NightlyAuthorityPlan("fast-contracts-routes");
  assert.equal(
    checker.commands[0],
    "node tools/verification/state_writer_policy_evidence.mjs produce --phase P4.4",
  );
  assert.equal(
    P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS.includes(
      "npm run test:python:p4:p4-3-boundary",
    ),
    true,
  );
  assert.equal(
    P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS.includes(
      "npm run test:python:p4:p4-4-boundary",
    ),
    true,
  );
  assert.equal(checker.commands.length, 1 + P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS.length);
  assert.deepEqual(full.commands, [P4_NIGHTLY_FULL_POLICY_COMMAND]);
  assert.deepEqual(fast.commands, [
    "npm run test:node:p4:p4-4",
    "node tools/check_p4_state_action_routes.mjs --phase P4.4 --history-base HEAD^",
  ]);
  assert.equal(new Set([...checker.commands, ...full.commands, ...fast.commands]).size,
    checker.commands.length + full.commands.length + fast.commands.length);
});

test("P4 closeout accepts exactly one passing receipt for every authority", () => {
  const result = validateP4NightlyCloseout(fixtures());
  assert.equal(result.status, "pass");
  assert.equal(result.evidenceId, fixtures().evidence.evidenceId);
  assert.equal(result.checkerCount, 1);
  assert.equal(result.liveFallbackAttempts, 0);
  assert.equal(result.canonicalFullPlanCount, 1);
});

test("P4 closeout fails closed on role, identity, evidence, full-plan, and fast-route drift", () => {
  const cases = [
    (value) => { value.authorities[2] = value.authorities[1]; },
    (value) => { value.authorities[0].sourceIdentity.verificationTreeSha = "d".repeat(40); },
    (value) => { value.evidence.evidenceId = "e".repeat(64); },
    (value) => { value.completedArtifact.admissionEligible = false; },
    (value) => { value.authorities[2].fast.routes = "fail"; },
  ];
  for (const mutate of cases) {
    const value = fixtures();
    mutate(value);
    assert.throws(() => validateP4NightlyCloseout(value));
  }
});

test("P4 closeout accepts mixed executed and exact-prior origins without changing receipt digests", () => {
  const value = fixtures();
  const plan = mixedRepairPlan();
  const priorDigests = value.authorities.map((receipt) => receipt.receiptDigest);
  const result = validateP4NightlyCloseout({
    ...value,
    repairPlan: plan,
    resolvedAuthorities: resolveMixedAuthorities(value, plan),
    currentRunId: "200",
  });
  assert.deepEqual(result.authorityOrigins.map((entry) => entry.disposition), [
    "executed-current-run",
    "reused-exact-prior-run",
    "reused-exact-prior-run",
  ]);
  assert.deepEqual(result.authorityOrigins.map((entry) => entry.originRunId), ["200", "100", "100"]);
  assert.deepEqual(result.authorityOrigins.map((entry) => entry.receiptDigest), priorDigests);
  assert.equal(result.repairPlanDigest, plan.planDigest);
});

test("P4 mixed-origin closeout rejects missing and swapped resolved provenance", () => {
  const value = fixtures();
  const plan = mixedRepairPlan();
  const resolvedAuthorities = resolveMixedAuthorities(value, plan);
  assert.throws(() => validateP4NightlyCloseout({
    ...value,
    repairPlan: plan,
    resolvedAuthorities: resolvedAuthorities.slice(1),
    currentRunId: "200",
  }), (error) => error?.code === "p4-nightly-resolved-authority-count");

  const swapped = structuredClone(resolvedAuthorities);
  [swapped[0].originRunId, swapped[1].originRunId] = [swapped[1].originRunId, swapped[0].originRunId];
  assert.throws(() => validateP4NightlyCloseout({
    ...value,
    repairPlan: plan,
    resolvedAuthorities: swapped,
    currentRunId: "200",
  }), (error) => error?.code === "p4-nightly-resolved-authority-mismatch");
});

test("P4 mixed-origin receipts resolve and close out through the local CLIs", (t) => {
  const value = fixtures();
  const plan = mixedRepairPlan();
  const runtimeTmp = path.join(REPO_ROOT, ".runtime", "tmp");
  fs.mkdirSync(runtimeTmp, { recursive: true });
  const root = fs.mkdtempSync(path.join(runtimeTmp, "p4-nightly-repair-local-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const planPath = path.join(root, "plan", "p4-repair-plan.json");
  const evidencePath = path.join(root, "authorities", "checker", "p4-state-actions", "P4.4", "state-writer-policy-evidence.json");
  const tapPath = path.join(root, "authorities", "full", "p4-state-actions", "P4.0", "state-writer-policy-tests.tap");
  const completedPath = path.join(root, "authorities", "full", "p4-state-actions", "P4.0", "state-writer-policy-tests.completed.json");
  for (const filePath of [planPath, evidencePath, tapPath, completedPath]) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(value.evidence, null, 2)}\n`);
  fs.writeFileSync(tapPath, value.canonicalTap);
  fs.writeFileSync(completedPath, `${JSON.stringify(value.completedArtifact, null, 2)}\n`);

  const roleDirs = {
    "checker-boundaries": "checker",
    "full-policy-tap": "full",
    "fast-contracts-routes": "fast",
  };
  const authorityPaths = [];
  const resolvedPaths = [];
  for (const receipt of value.authorities) {
    const roleDir = roleDirs[receipt.role];
    const authorityPath = path.join(root, "authorities", roleDir, "nightly", `p4-${receipt.role}.json`);
    const resolvedPath = path.join(root, "authorities", roleDir, "nightly", `p4-${receipt.role}.resolved.json`);
    fs.mkdirSync(path.dirname(authorityPath), { recursive: true });
    fs.writeFileSync(authorityPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const resolver = spawnSync(process.execPath, [
      "tools/verification/p4_nightly_receipt_resolver.mjs",
      "--receipt", authorityPath,
      "--role", receipt.role,
      "--expected-sha", SHA,
      "--expected-tree", TREE,
      "--repair-plan", planPath,
      "--current-run-id", "200",
      "--out", resolvedPath,
    ], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(resolver.status, 0, resolver.stderr || resolver.stdout);
    authorityPaths.push(authorityPath);
    resolvedPaths.push(resolvedPath);
  }

  const outPath = path.join(root, "out", "p4-repair-closeout.json");
  const closeout = spawnSync(process.execPath, [
    "tools/verification/p4_nightly_closeout.mjs",
    ...authorityPaths.flatMap((filePath) => ["--authority", filePath]),
    ...resolvedPaths.flatMap((filePath) => ["--resolved-authority", filePath]),
    "--expected-sha", SHA,
    "--expected-tree", TREE,
    "--evidence", evidencePath,
    "--tap", tapPath,
    "--completed", completedPath,
    "--repair-plan", planPath,
    "--current-run-id", "200",
    "--out", outPath,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(closeout.status, 0, closeout.stderr || closeout.stdout);
  const result = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.deepEqual(result.authorityOrigins.map((entry) => entry.originRunId), ["200", "100", "100"]);
  assert.deepEqual(
    result.authorityOrigins.map((entry) => entry.receiptDigest),
    value.authorities.map((receipt) => receipt.receiptDigest),
  );
});
