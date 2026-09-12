import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildCanonicalP4StateWriterPolicyTap,
  buildP4StateWriterPolicyPlanIdentity,
  frameP4StateWriterPolicyStderr,
  isP4StateWriterPolicyCanonicalAdmissionEligible,
  isP4StateWriterPolicyCanonicalReusable,
  resolveP4StateWriterPolicyArtifactPaths,
  runP4StateWriterPolicyTestLifecycle as runLifecycle,
} from "./verification/p4_state_writer_policy_test_lifecycle.mjs";
import {
  prepareWindowsJobRunnerV2,
  spawnWindowsJobSession,
  validateWindowsJobRunnerV2Evidence,
} from "./process_containment/windows_job_runtime.mjs";

const REPO_ROOT = process.cwd();
const REPORT_DIR = path.join(
  REPO_ROOT,
  ".runtime",
  "reports",
  "generated",
  "p4-state-actions",
  "P4.0",
);
const REPORT_PATH = path.join(REPORT_DIR, "state-writer-policy-tests.tap");
const QUICK_REPORT_PATH = path.join(REPORT_DIR, "state-writer-policy-tests.quick.tap");
const FOCUSED_REPORT_PATH = path.join(REPORT_DIR, "state-writer-policy-tests.focused.tap");
export const P4_STATE_WRITER_POLICY_WINDOWS_JOB_TIMEOUT_MS = 45 * 60 * 1000;

export {
  buildCanonicalP4StateWriterPolicyTap,
  frameP4StateWriterPolicyStderr,
  isP4StateWriterPolicyCanonicalAdmissionEligible,
  isP4StateWriterPolicyCanonicalReusable,
  resolveP4StateWriterPolicyArtifactPaths,
};

export const P4_STATE_WRITER_POLICY_RUN_MODE_ENV =
  "MAPCREATOR_INTERNAL_P4_STATE_WRITER_POLICY_RUN_MODE";
const P4_STATE_WRITER_POLICY_RUN_MODES = Object.freeze([
  "full",
  "focused",
  "quick",
]);
export const P4_STATE_WRITER_POLICY_TEST_FILES = Object.freeze([
  "tests/day_night_runtime_owner_behavior.test.mjs",
  "tests/political_background_render_owner_behavior.test.mjs",
  "tests/state_action_delegation_edges_behavior.test.mjs",
  "tests/state_borrowed_effect_contract_behavior.test.mjs",
  "tests/state_owner_borrowed_storage_behavior.test.mjs",
  "tests/state_writer_policy_behavior.test.mjs",
  "tests/state_writer_policy_batch_scan_behavior.test.mjs",
  "tests/state_writer_policy_soundness_behavior.test.mjs",
  "tests/state_writer_scanner_soundness_behavior.test.mjs",
  "tests/state_writer_policy_manifest_behavior.test.mjs",
  "tests/state_writer_policy_evidence_behavior.test.mjs",
  "tests/p4_state_action_routes_behavior.test.mjs",
  "tests/p4_state_writer_runner_reachability_behavior.test.mjs",
  "tests/p4_state_writer_streaming_runner_behavior.test.mjs",
]);
export const P4_STATE_WRITER_POLICY_QUICK_TEST_FILES = Object.freeze(
  P4_STATE_WRITER_POLICY_TEST_FILES.filter((testFile) => (
    testFile !== "tests/state_writer_policy_manifest_behavior.test.mjs"
  )),
);
export const P4_STATE_WRITER_POLICY_FULL_PLAN_IDENTITY =
  buildP4StateWriterPolicyPlanIdentity(
    process.execPath,
    ["--test", ...P4_STATE_WRITER_POLICY_TEST_FILES],
  );

function isExactFullPlan(testArguments, mode) {
  return mode === "full"
    && testArguments.length === P4_STATE_WRITER_POLICY_TEST_FILES.length
    && testArguments.every(
      (testArgument, index) => testArgument === P4_STATE_WRITER_POLICY_TEST_FILES[index],
    );
}

export function isOfficialP4StateWriterPolicyCanonicalReusable({
  completedArtifact,
  canonicalTap,
  publishingArtifact = null,
} = {}) {
  return isP4StateWriterPolicyCanonicalReusable({
    completedArtifact,
    canonicalTap,
    publishingArtifact,
    expectedMode: "full",
    expectedTestArguments: P4_STATE_WRITER_POLICY_TEST_FILES,
    expectedCommand: process.execPath,
    expectedReportTarget: REPORT_PATH,
    expectedPlanIdentity: P4_STATE_WRITER_POLICY_FULL_PLAN_IDENTITY,
  });
}

export function isOfficialP4StateWriterPolicyCanonicalAdmissionEligible({
  completedArtifact,
  canonicalTap,
  publishingArtifact = null,
} = {}) {
  if (!isP4StateWriterPolicyCanonicalAdmissionEligible({
    completedArtifact,
    canonicalTap,
    publishingArtifact,
    expectedMode: "full",
    expectedTestArguments: P4_STATE_WRITER_POLICY_TEST_FILES,
    expectedCommand: process.execPath,
    expectedReportTarget: REPORT_PATH,
    expectedPlanIdentity: P4_STATE_WRITER_POLICY_FULL_PLAN_IDENTITY,
  })) return false;
  const evidence = completedArtifact?.containmentEvidence;
  const evidenceErrors = validateWindowsJobRunnerV2Evidence(evidence, {
    command: {
      bin: process.execPath,
      args: ["--test", ...P4_STATE_WRITER_POLICY_TEST_FILES],
    },
    cwd: REPO_ROOT,
    runId: completedArtifact.runId,
    parentPid: completedArtifact.producerPid,
    rootPid: completedArtifact.childPid,
    timeoutMs: P4_STATE_WRITER_POLICY_WINDOWS_JOB_TIMEOUT_MS,
  });
  const embeddedEvidenceSha256 = evidence && typeof evidence === "object"
    ? createHash("sha256")
      .update(`${JSON.stringify(evidence)}\r\n`)
      .digest("hex")
    : null;
  return evidenceErrors.length === 0
    && evidence.primaryCause === "root-exit"
    && evidence.root.exitCode === 0
    && evidence.control.cancelRequestId === null
    && typeof completedArtifact.containmentEvidenceSha256 === "string"
    && completedArtifact.containmentEvidenceSha256 === embeddedEvidenceSha256;
}

export function shouldUseP4StateWriterPolicyWindowsJobV2({
  platform = process.platform,
  fullPlan = false,
} = {}) {
  return platform === "win32" && fullPlan === true;
}

export function resolveP4StateWriterPolicyTestFiles(requestedTestFiles = []) {
  return requestedTestFiles.length
    ? [...requestedTestFiles]
    : [...P4_STATE_WRITER_POLICY_TEST_FILES];
}

export function resolveP4StateWriterPolicyRun(argv = []) {
  if (argv.includes("--quick")) {
    if (argv.length !== 1) {
      throw new Error("--quick cannot be combined with focused Node test arguments.");
    }
    return {
      mode: "quick",
      testArguments: [...P4_STATE_WRITER_POLICY_QUICK_TEST_FILES],
      reportPath: QUICK_REPORT_PATH,
    };
  }
  return {
    mode: argv.length ? "focused" : "full",
    testArguments: resolveP4StateWriterPolicyTestFiles(argv),
    reportPath: argv.length ? FOCUSED_REPORT_PATH : REPORT_PATH,
  };
}

export function buildP4StateWriterPolicyChildEnv(
  mode,
  parentEnv = process.env,
) {
  const normalizedMode = String(mode || "");
  if (!P4_STATE_WRITER_POLICY_RUN_MODES.includes(normalizedMode)) {
    const error = new Error(
      `Unsupported P4 state-writer policy run mode: ${normalizedMode || "<empty>"}.`,
    );
    error.code = "p4-state-writer-policy-run-mode-invalid";
    error.mode = normalizedMode;
    throw error;
  }
  return {
    ...parentEnv,
    [P4_STATE_WRITER_POLICY_RUN_MODE_ENV]: normalizedMode,
  };
}

export function assertP4StateWriterPolicyManifestRunMode({
  env = process.env,
} = {}) {
  const mode = String(env?.[P4_STATE_WRITER_POLICY_RUN_MODE_ENV] || "");
  if (mode === "full" || mode === "focused") return mode;
  const error = new Error([
    "The state-writer policy manifest suite requires the official full or focused runner.",
    "Run: npm run test:node:p4:state-writer-policy -- --test-name-pattern=\"<pattern>\" tests/state_writer_policy_manifest_behavior.test.mjs",
  ].join(" "));
  error.code = "p4-state-writer-policy-manifest-run-mode-required";
  error.mode = mode;
  throw error;
}

export function spawnP4StateWriterPolicyTestProcess(
  testArguments,
  { mode, runner = spawn, parentEnv = process.env } = {},
) {
  return runner(process.execPath, ["--test", ...testArguments], {
    cwd: REPO_ROOT,
    env: buildP4StateWriterPolicyChildEnv(mode, parentEnv),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function spawnP4StateWriterPolicyWindowsJobProcess(
  testArguments,
  {
    mode,
    parentEnv = process.env,
    preparedRunner,
    artifactPaths,
    runId,
    timeoutMs = P4_STATE_WRITER_POLICY_WINDOWS_JOB_TIMEOUT_MS,
    sessionSpawner = spawnWindowsJobSession,
  } = {},
) {
  return sessionSpawner({
    bin: process.execPath,
    args: ["--test", ...testArguments],
    cwd: REPO_ROOT,
  }, {
    preparedRunner,
    cwd: REPO_ROOT,
    evidencePath: `${artifactPaths.reportPath.slice(0, -4)}.containment.${runId}.json`,
    timeoutMs,
    env: buildP4StateWriterPolicyChildEnv(mode, parentEnv),
    runId,
  });
}

export function readP4StateWriterPolicyWindowsJobContainmentResult(
  child,
  terminal = {},
) {
  const result = child.getContainmentResult();
  const primaryCause = result?.evidence?.primaryCause;
  if (
    primaryCause === "root-exit"
    || (
      primaryCause === "cancel-requested"
      && Boolean(terminal.signal || terminal.requestedSignal)
    )
  ) return result;
  if (result?.error) return result;
  return {
    ...result,
    error: {
      code: "p4-state-writer-policy-windows-job-v2-terminal-cause",
      message: `Windows Job V2 ended with terminal cause ${primaryCause || "unavailable"}.`,
    },
  };
}

export async function cleanupP4StateWriterPolicyWindowsJobSession(
  session,
  { removeFile = fs.rm } = {},
) {
  const evidencePath = session?.getContainmentResult?.()?.evidencePath;
  if (typeof evidencePath !== "string" || !evidencePath) return null;
  try {
    await removeFile(evidencePath, { force: true });
    return null;
  } catch (error) {
    return {
      code: error.code
        || "p4-state-writer-policy-windows-job-v2-evidence-cleanup-failed",
      message: error.message || String(error),
    };
  }
}

export async function runP4StateWriterPolicyTestLifecycle({
  testArguments = [],
  mode = "full",
  runner = spawn,
  parentEnv = process.env,
  artifactRoot = REPORT_DIR,
  reportPath = null,
  platform = process.platform,
  prepareWindowsJobRunner = prepareWindowsJobRunnerV2,
  spawnWindowsJobSessionFn = spawnWindowsJobSession,
  windowsJobTimeoutMs = P4_STATE_WRITER_POLICY_WINDOWS_JOB_TIMEOUT_MS,
  ...options
} = {}) {
  const artifactPaths = resolveP4StateWriterPolicyArtifactPaths({
    mode,
    artifactRoot,
    reportPath,
  });
  const fullPlan = isExactFullPlan(testArguments, mode)
    && artifactPaths.reportPath === path.resolve(REPORT_PATH);
  const useWindowsJobV2 = shouldUseP4StateWriterPolicyWindowsJobV2({
    platform,
    fullPlan,
  });
  let preparedRunner = null;
  let windowsJobSession = null;
  if (useWindowsJobV2) {
    try {
      preparedRunner = await prepareWindowsJobRunner({
        platform,
        buildRoot: path.join(
          REPO_ROOT,
          ".runtime",
          "tmp",
          "p4-state-writer-policy-windows-job-v2",
        ),
      });
    } catch (error) {
      preparedRunner = {
        status: "compile-error",
        error: String(error?.stack || error?.message || error),
      };
    }
  }
  const preparationError = useWindowsJobV2
    && preparedRunner?.status !== "available"
    ? Object.assign(new Error(
      `Windows Job V2 preparation failed: ${preparedRunner?.error || preparedRunner?.status || "missing result"}`,
    ), { code: "p4-state-writer-policy-windows-job-v2-unavailable" })
    : null;
  const lifecycle = runLifecycle({
    ...options,
    testArguments,
    mode,
    artifactRoot,
    reportPath,
    command: process.execPath,
    commandArguments: ["--test", ...testArguments],
    admissionCandidate: fullPlan,
    fullPlanIdentity: fullPlan
      ? P4_STATE_WRITER_POLICY_FULL_PLAN_IDENTITY
      : null,
    containmentStatus: useWindowsJobV2
      ? "root-only"
      : (options.containmentStatus ?? "root-only"),
    cleanupVerified: useWindowsJobV2
      ? false
      : (options.cleanupVerified ?? false),
    containmentResultReader: useWindowsJobV2
      ? readP4StateWriterPolicyWindowsJobContainmentResult
      : options.containmentResultReader,
    terminateChild: useWindowsJobV2
      ? (child, signal, diagnostic) => child.requestCancel({
        reasonCode: diagnostic?.code || "p4-state-writer-policy-parent-signal",
        requestedSignal: signal,
      })
      : options.terminateChild,
    spawnChild: ({ runId, artifactPaths: paths } = {}) => {
      if (preparationError) throw preparationError;
      if (useWindowsJobV2) {
        windowsJobSession = spawnP4StateWriterPolicyWindowsJobProcess(testArguments, {
          mode,
          parentEnv,
          preparedRunner,
          artifactPaths: paths || artifactPaths,
          runId,
          timeoutMs: windowsJobTimeoutMs,
          sessionSpawner: spawnWindowsJobSessionFn,
        });
        return windowsJobSession;
      }
      return spawnP4StateWriterPolicyTestProcess(testArguments, {
        mode,
        runner,
        parentEnv,
      });
    },
  });
  let result;
  let lifecycleError = null;
  try {
    result = await lifecycle;
  } catch (error) {
    lifecycleError = error;
  }
  const cleanupDiagnostics = [];
  const evidenceCleanupDiagnostic = await cleanupP4StateWriterPolicyWindowsJobSession(
    windowsJobSession,
  );
  if (evidenceCleanupDiagnostic) cleanupDiagnostics.push(evidenceCleanupDiagnostic);
  try {
    await preparedRunner?.cleanup?.();
  } catch (error) {
    cleanupDiagnostics.push({
      code: error.code
        || "p4-state-writer-policy-windows-job-v2-cleanup-failed",
      message: error.message || String(error),
    });
  }
  if (lifecycleError) {
    if (cleanupDiagnostics.length) {
      lifecycleError.cleanupDiagnostics = cleanupDiagnostics;
    }
    throw lifecycleError;
  }
  if (cleanupDiagnostics.length) {
    return Object.freeze({
      ...result,
      additionalDiagnostics: [
        ...(result.additionalDiagnostics || []),
        ...cleanupDiagnostics,
      ],
    });
  }
  return result;
}

export async function run(
  testArguments = resolveP4StateWriterPolicyRun(process.argv.slice(2)).testArguments,
  { reportPath = REPORT_PATH, mode = "full" } = {},
) {
  const result = await runP4StateWriterPolicyTestLifecycle({
    testArguments,
    mode,
    reportPath,
  });
  if (result.error?.message) console.error(result.error.message);
  if (result.signal) {
    console.error(`P4 state writer policy tests exited with signal ${result.signal}.`);
  }
  return resolveP4StateWriterPolicyExitCode(result);
}

export function resolveP4StateWriterPolicyExitCode(result) {
  return result?.status === "passed"
    ? 0
    : (result?.exitCode && result.exitCode !== 0 ? result.exitCode : 1);
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const request = resolveP4StateWriterPolicyRun(process.argv.slice(2));
  run(request.testArguments, {
    mode: request.mode,
    reportPath: request.reportPath,
  }).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
