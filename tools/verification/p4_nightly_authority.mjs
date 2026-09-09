import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  P4_STATE_WRITER_POLICY_FULL_PLAN_IDENTITY,
  P4_STATE_WRITER_POLICY_TEST_FILES,
  isOfficialP4StateWriterPolicyCanonicalAdmissionEligible,
  resolveP4StateWriterPolicyArtifactPaths,
} from "../run_p4_state_writer_policy_tests.mjs";
import {
  STATE_WRITER_POLICY_CHECKER_PRODUCER_ROLE,
  STATE_WRITER_POLICY_LIVE_FALLBACK_ENV,
  STATE_WRITER_POLICY_LIVE_FALLBACK_FORBID,
  buildStateWriterCheckerPlan,
  buildStrictStateWriterEvidenceEnvironment,
  defaultStateWriterPolicyEvidencePath,
  defaultStateWriterPolicyReportPath,
  produceStateWriterPolicyEvidence,
  validateStateWriterPolicyEvidence,
} from "./state_writer_policy_evidence.mjs";
import {
  atomicWriteJsonSync,
  captureVerificationIdentity,
} from "./resumable_verification.mjs";

const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export const P4_NIGHTLY_AUTHORITY_SCHEMA_VERSION = 1;
export const P4_NIGHTLY_AUTHORITY_KIND = "p4-nightly-authority-result";
export const P4_NIGHTLY_AUTHORITY_ROLES = Object.freeze([
  "checker-boundaries",
  "full-policy-tap",
  "fast-contracts-routes",
]);

export const P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS = Object.freeze([
  "npm run test:python:p4:state-write-boundary",
  "npm run test:python:p4:p4-1-boundary",
  "npm run test:python:p4:p4-2a-boundary",
  "npm run test:python:p4:p4-2b-boundary",
  "npm run test:python:p4:p4-2c-boundary",
  "npm run test:python:p4:p4-3-boundary",
  "npm run test:python:p4:p4-4-boundary",
]);

export const P4_NIGHTLY_FAST_COMMANDS = Object.freeze([
  "npm run test:node:p4:p4-4",
  "node tools/check_p4_state_action_routes.mjs --phase P4.4 --history-base HEAD^",
]);

export const P4_NIGHTLY_FULL_POLICY_COMMAND =
  "npm run test:node:p4:state-writer-policy";

function normalizeIdentity(identity = {}) {
  return {
    verificationSha: String(identity.verificationSha || "").trim().toLowerCase(),
    verificationTreeSha: String(identity.verificationTreeSha || "").trim().toLowerCase(),
    workspaceClean: identity.workspaceClean,
    trackedClean: identity.trackedClean,
    includesUntracked: identity.includesUntracked,
    workspaceStatus: typeof identity.workspaceStatus === "string"
      ? identity.workspaceStatus
      : "",
  };
}

function requireCleanIdentity(identity, label) {
  const normalized = normalizeIdentity(identity);
  if (
    !/^[0-9a-f]{40}$/u.test(normalized.verificationSha)
    || !/^[0-9a-f]{40}$/u.test(normalized.verificationTreeSha)
    || normalized.workspaceClean !== true
    || normalized.trackedClean !== true
    || normalized.includesUntracked !== true
    || normalized.workspaceStatus !== ""
  ) {
    throw new Error(`${label} must be an exact clean Git SHA/tree identity.`);
  }
  return normalized;
}

function sameIdentity(left, right) {
  return left.verificationSha === right.verificationSha
    && left.verificationTreeSha === right.verificationTreeSha;
}

function commandProcess(commandRef, platform = process.platform) {
  const tokens = commandRef.split(/\s+/u);
  if (tokens[0] === "npm" && platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", ...tokens] };
  }
  if (tokens[0] === "node") {
    return { command: process.execPath, args: tokens.slice(1) };
  }
  return { command: tokens[0], args: tokens.slice(1) };
}

function runCommand(commandRef, {
  cwd,
  env,
  runner,
  platform,
} = {}) {
  const resolved = commandProcess(commandRef, platform);
  let result;
  try {
    result = runner(resolved.command, resolved.args, {
      cwd,
      env,
      encoding: "utf8",
      shell: false,
      stdio: "inherit",
    });
  } catch (cause) {
    const error = new Error(`P4 Nightly authority command could not start: ${commandRef}`, { cause });
    error.commandRef = commandRef;
    error.failureCategory = "command-start";
    throw error;
  }
  if (result?.error || result?.signal || result?.status !== 0) {
    const error = new Error(`P4 Nightly authority command failed: ${commandRef}`);
    error.commandRef = commandRef;
    error.status = result?.status;
    error.signal = result?.signal;
    error.cause = result?.error;
    error.failureCategory = result?.error ? "command-start"
      : result?.signal ? "command-signal" : "command-exit";
    throw error;
  }
  return { commandRef, status: "pass", exitCode: 0 };
}

export function buildP4NightlyAuthorityPlan(role) {
  if (!P4_NIGHTLY_AUTHORITY_ROLES.includes(role)) {
    throw new Error(`Unknown P4 Nightly authority role: ${role || "<empty>"}`);
  }
  if (role === "checker-boundaries") {
    return Object.freeze({
      role,
      commands: Object.freeze([
        "node tools/verification/state_writer_policy_evidence.mjs produce --phase P4.4",
        ...P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS,
      ]),
    });
  }
  if (role === "full-policy-tap") {
    return Object.freeze({ role, commands: Object.freeze([P4_NIGHTLY_FULL_POLICY_COMMAND]) });
  }
  return Object.freeze({ role, commands: P4_NIGHTLY_FAST_COMMANDS });
}

function receiptDigest(receipt) {
  const body = { ...receipt };
  delete body.receiptDigest;
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function finalizeReceipt(receipt, outPath, cwd) {
  const finalized = { ...receipt, receiptDigest: receiptDigest(receipt) };
  atomicWriteJsonSync(path.resolve(cwd, outPath), finalized);
  return finalized;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function runP4NightlyAuthority(role, {
  cwd = REPO_ROOT,
  outPath = path.join(".runtime", "reports", "generated", "nightly", `p4-${role}.json`),
  runner = spawnSync,
  platform = process.platform,
  baseEnv = process.env,
  identityReader = () => captureVerificationIdentity({ cwd }),
  evidenceProducer = produceStateWriterPolicyEvidence,
  evidenceValidator = validateStateWriterPolicyEvidence,
} = {}) {
  const plan = buildP4NightlyAuthorityPlan(role);
  const commands = [];
  const receipt = {
    schemaVersion: P4_NIGHTLY_AUTHORITY_SCHEMA_VERSION,
    kind: P4_NIGHTLY_AUTHORITY_KIND,
    role,
    status: "pass",
    sourceIdentity: null,
    commands,
  };
  let stage = "source-identity";
  let activeCommand = null;
  try {
    receipt.sourceIdentity = normalizeIdentity(identityReader());
    const sourceIdentity = requireCleanIdentity(receipt.sourceIdentity, "P4 Nightly authority source");

    if (role === "checker-boundaries") {
      const evidencePath = defaultStateWriterPolicyEvidencePath("P4.4");
      const reportPath = defaultStateWriterPolicyReportPath("P4.4");
      const checkerPlan = buildStateWriterCheckerPlan({ phase: "P4.4", reportPath });
      stage = "evidence-production";
      activeCommand = plan.commands[0];
      const produced = evidenceProducer({
        cwd,
        phase: "P4.4",
        evidencePath,
        reportPath,
        checkerPlan,
      });
      commands.push({
        commandRef: plan.commands[0],
        status: "pass",
        exitCode: 0,
        evidenceId: produced.evidenceId,
      });
      const boundaryEvidence = [];
      for (const commandRef of P4_NIGHTLY_PYTHON_BOUNDARY_COMMANDS) {
        activeCommand = commandRef;
        stage = "evidence-validation";
        const validated = evidenceValidator({
          cwd,
          phase: "P4.4",
          evidencePath,
          checkerPlan,
          expectedEvidenceId: produced.evidenceId,
          expectedProducerRole: STATE_WRITER_POLICY_CHECKER_PRODUCER_ROLE,
          routeApplicability: { unmatchedChangedFiles: [] },
        });
        const env = buildStrictStateWriterEvidenceEnvironment(validated, {
          cwd,
          baseEnv: {
            ...baseEnv,
            [STATE_WRITER_POLICY_LIVE_FALLBACK_ENV]: STATE_WRITER_POLICY_LIVE_FALLBACK_FORBID,
          },
        });
        stage = "command";
        commands.push(runCommand(commandRef, { cwd, env, runner, platform }));
        boundaryEvidence.push({ commandRef, evidenceId: validated.evidenceId });
      }
      receipt.checker = {
        producerRole: produced.producer?.role,
        checkerCount: 1,
        liveFallbackAttempts: 0,
        evidenceId: produced.evidenceId,
        evidencePath,
        reportPath,
        boundaryEvidence,
      };
    } else if (role === "full-policy-tap") {
      activeCommand = P4_NIGHTLY_FULL_POLICY_COMMAND;
      stage = "command";
      commands.push(runCommand(P4_NIGHTLY_FULL_POLICY_COMMAND, {
        cwd,
        env: baseEnv,
        runner,
        platform,
      }));
      stage = "canonical-admission";
      const artifactPaths = resolveP4StateWriterPolicyArtifactPaths({ mode: "full" });
      const completedArtifact = readJson(artifactPaths.completedPath);
      const canonicalTap = fs.readFileSync(artifactPaths.reportPath, "utf8");
      const admissionEligible = isOfficialP4StateWriterPolicyCanonicalAdmissionEligible({
        completedArtifact,
        canonicalTap,
        publishingArtifact: fs.existsSync(artifactPaths.publishingPath)
          ? readJson(artifactPaths.publishingPath)
          : null,
      });
      if (!admissionEligible) {
        throw new Error("Windows canonical full policy TAP is not admissionEligible.");
      }
      receipt.fullPolicy = {
        admissionEligible,
        canonicalFullPlanCount: 1,
        planIdentity: completedArtifact.planIdentity,
        expectedPlanIdentity: P4_STATE_WRITER_POLICY_FULL_PLAN_IDENTITY,
        testArguments: P4_STATE_WRITER_POLICY_TEST_FILES,
        canonicalSha256: completedArtifact.canonicalSha256,
        tapPath: path.relative(cwd, artifactPaths.reportPath).replaceAll("\\", "/"),
        completedPath: path.relative(cwd, artifactPaths.completedPath).replaceAll("\\", "/"),
      };
    } else {
      for (const commandRef of P4_NIGHTLY_FAST_COMMANDS) {
        activeCommand = commandRef;
        stage = "command";
        commands.push(runCommand(commandRef, { cwd, env: baseEnv, runner, platform }));
      }
      receipt.fast = {
        contracts: "pass",
        routes: "pass",
      };
    }

    activeCommand = null;
    stage = "final-identity";
    receipt.finalSourceIdentity = normalizeIdentity(identityReader());
    const finalIdentity = requireCleanIdentity(receipt.finalSourceIdentity, "P4 Nightly authority final source");
    if (!sameIdentity(sourceIdentity, finalIdentity)) {
      throw new Error("P4 Nightly authority source SHA/tree drifted during execution.");
    }
    receipt.finalSourceIdentity = finalIdentity;
  } catch (error) {
    receipt.status = "fail";
    const exitCode = Number.isInteger(error?.status) && error.status !== 0 ? error.status : null;
    receipt.failure = {
      category: error?.failureCategory || stage,
      commandRef: error?.commandRef || activeCommand,
      exitCode,
      signal: error?.signal || null,
      code: error?.code || error?.cause?.code || null,
      message: error?.message || String(error),
      stdout: error?.stdout || "",
      stderr: error?.stderr || "",
    };
    if (activeCommand && !commands.some((entry) => entry.commandRef === activeCommand)) {
      commands.push({ commandRef: activeCommand, status: "fail", exitCode });
    }
    receipt.completedSteps = commands.filter((entry) => entry.status === "pass").map((entry) => entry.commandRef);
    try {
      receipt.finalSourceIdentity = normalizeIdentity(identityReader());
    } catch (identityError) {
      receipt.identityCaptureError = identityError?.message || String(identityError);
    }
    try {
      error.receipt = finalizeReceipt(receipt, outPath, cwd);
    } catch (writeError) {
      error.receiptWriteError = writeError;
    }
    throw error;
  }
  return finalizeReceipt(receipt, outPath, cwd);
}

function parseArgs(argv) {
  const args = { role: "", outPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--role") args.role = argv[++index] || "";
    else if (argv[index] === "--out") args.outPath = argv[++index] || "";
    else throw new Error(`Unknown P4 Nightly authority argument: ${argv[index]}`);
  }
  return args;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runP4NightlyAuthority(args.role, {
      outPath: args.outPath || undefined,
    });
    console.log(`P4 Nightly authority passed role=${result.role} sha=${result.sourceIdentity.verificationSha}`);
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    if (error?.receiptWriteError) console.error("P4 failure receipt could not be written:", error.receiptWriteError);
    process.exitCode = Number.isInteger(error?.status) && error.status > 0 ? error.status : 1;
  }
}
