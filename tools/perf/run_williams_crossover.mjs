#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  WILLIAMS_BLOCK_SEQUENCE,
  WILLIAMS_CROSSOVER_POLICY_ID,
  WILLIAMS_EXIT_CODES,
  WILLIAMS_SCENARIOS,
  analyzeWilliamsCrossoverEvidence,
  buildWilliamsPreregistration,
} from "./williams_crossover_policy.mjs";
import {
  WINDOWS_JOB_RUNNER_EVIDENCE_PATH,
  collectWindowsPerformanceWindow,
  collectWindowsProcessSnapshot as collectProcessSnapshot,
  collectWindowsTcpConnections,
  prepareWindowsJobRunner,
  runWindowsJobCommand,
} from "./williams_crossover_windows_runtime.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_RAW_ROOT = path.join(REPO_ROOT, ".runtime", "output", "perf", "p2-williams-crossover");
const DEFAULT_JSON_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "p2-williams-crossover.json");
const DEFAULT_MD_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "p2-williams-crossover.md");
const TASK_PORTS = Object.freeze([8000, 8892]);
const BASELINE_RUNNER_PATH = "tools/perf/run_baseline.mjs";
const ROLE_POLICY_PATH = "tools/perf/render_sample_role_policy.mjs";
const ANALYZER_PATH = "tools/perf/run_williams_crossover.mjs";
const POLICY_PATH = "tools/perf/williams_crossover_policy.mjs";
const WINDOWS_RUNTIME_PATH = "tools/perf/williams_crossover_windows_runtime.mjs";
const JOB_RUNNER_SOURCE_PATH = "tools/perf/williams_crossover_windows_job_runner.cs";
const PACKAGE_LOCK_PATH = "package-lock.json";
const LIVE_TIMEOUT_MS = 45 * 60 * 1000;

export class WilliamsInvalidExperimentError extends Error {
  constructor(message, code = "invalid-experiment") {
    super(message);
    this.name = "WilliamsInvalidExperimentError";
    this.code = code;
    this.exitCode = WILLIAMS_EXIT_CODES.invalidExperiment;
  }
}

export function getWilliamsErrorExitCode(error) {
  return error instanceof WilliamsInvalidExperimentError
    ? WILLIAMS_EXIT_CODES.invalidExperiment
    : WILLIAMS_EXIT_CODES.harnessFault;
}

function isDirectExecution() {
  const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entryPath && pathToFileURL(entryPath).href === import.meta.url;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function normalizePath(value) {
  return path.resolve(String(value || ""));
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function lfNormalizedSha256(buffer) {
  return sha256(Buffer.from(buffer.toString("utf8").replace(/\r\n?/g, "\n"), "utf8"));
}

function gitBlobSha1(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(buffer).digest("hex");
}

function artifactDescriptorsEqual(left, right) {
  return String(left?.path || "") === String(right?.path || "")
    && String(left?.gitBlob || "") === String(right?.gitBlob || "")
    && String(left?.lfNormalizedSha256 || "") === String(right?.lfNormalizedSha256 || "");
}

function binaryDescriptorsEqual(left, right) {
  return String(left?.path || "") === String(right?.path || "")
    && String(left?.sha256 || "") === String(right?.sha256 || "")
    && Number(left?.bytes) === Number(right?.bytes);
}

async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, String(value), "utf8");
}

async function writeJsonExclusive(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function writeTextExclusive(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, String(value), { encoding: "utf8", flag: "wx" });
}

function resolveOutputPath(value, fallback) {
  return value ? normalizePath(value) : fallback;
}

export function parseWilliamsArgs(argv = []) {
  const options = {
    mode: "list",
    rawRoot: DEFAULT_RAW_ROOT,
    jsonOut: DEFAULT_JSON_OUT,
    mdOut: DEFAULT_MD_OUT,
    controlWorktree: process.env.WILLIAMS_CONTROL_WORKTREE ? normalizePath(process.env.WILLIAMS_CONTROL_WORKTREE) : "",
    candidateWorktree: process.env.WILLIAMS_CANDIDATE_WORKTREE ? normalizePath(process.env.WILLIAMS_CANDIDATE_WORKTREE) : "",
    controlHead: String(process.env.WILLIAMS_CONTROL_HEAD || "").trim(),
    candidateHead: String(process.env.WILLIAMS_CANDIDATE_HEAD || "").trim(),
    overwriteAnalysis: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (["--list", "--plan", "--dry-run", "--analyze", "--execute"].includes(token)) {
      options.mode = token.slice(2);
    } else if (token === "--raw-root" && next) {
      options.rawRoot = resolveOutputPath(next, DEFAULT_RAW_ROOT);
      index += 1;
    } else if (token === "--json-out" && next) {
      options.jsonOut = resolveOutputPath(next, DEFAULT_JSON_OUT);
      index += 1;
    } else if (token === "--md-out" && next) {
      options.mdOut = resolveOutputPath(next, DEFAULT_MD_OUT);
      index += 1;
    } else if (token === "--control-worktree" && next) {
      options.controlWorktree = normalizePath(next);
      index += 1;
    } else if (token === "--candidate-worktree" && next) {
      options.candidateWorktree = normalizePath(next);
      index += 1;
    } else if (token === "--control-head" && next) {
      options.controlHead = String(next).trim();
      index += 1;
    } else if (token === "--candidate-head" && next) {
      options.candidateHead = String(next).trim();
      index += 1;
    } else if (token === "--overwrite-analysis") {
      options.overwriteAnalysis = true;
    } else {
      throw new Error(`Unknown Williams crossover argument: ${token}`);
    }
  }
  return options;
}

function blockDirectory(rawRoot, block) {
  return path.join(rawRoot, "blocks", block.id);
}

export function buildWilliamsExecutionPlan(options = {}) {
  const preregistration = buildWilliamsPreregistration({
    controlHead: options.controlHead,
    candidateHead: options.candidateHead,
    controlWorktree: options.controlWorktree,
    candidateWorktree: options.candidateWorktree,
    generatedAt: null,
    jobRunnerSource: options.jobRunnerSource || null,
    jobRunnerBinary: options.jobRunnerBinary || null,
  });
  return {
    preregistration,
    blocks: WILLIAMS_BLOCK_SEQUENCE.map((block) => {
      const cwd = block.side === "A" ? options.controlWorktree : options.candidateWorktree;
      const expectedHead = block.side === "A" ? options.controlHead : options.candidateHead;
      const directory = blockDirectory(options.rawRoot || DEFAULT_RAW_ROOT, block);
      return {
        ...block,
        scenarioOrder: [...block.scenarioOrder],
        cwd,
        expectedHead,
        directory,
        command: {
          bin: process.execPath,
          args: [
            BASELINE_RUNNER_PATH,
            "--mode", "baseline",
            "--scenarios", block.scenarioOrder.join(","),
            "--runs", "2",
            "--warmups", "1",
            "--baseline-json", path.join(directory, "baseline.json"),
            "--baseline-md", path.join(directory, "baseline.md"),
            "--raw-dir", path.join(directory, "raw"),
          ],
        },
      };
    }),
  };
}

function formatPlan(plan) {
  const lines = [
    `${WILLIAMS_CROSSOVER_POLICY_ID}: 8 blocks, 1 warmup + 2 measured per scenario`,
    `control A: ${plan.preregistration.control.head || "<required>"} @ ${plan.preregistration.control.worktree || "<required>"}`,
    `candidate B: ${plan.preregistration.candidate.head || "<required>"} @ ${plan.preregistration.candidate.worktree || "<required>"}`,
  ];
  for (const block of plan.blocks) {
    lines.push(`${block.ordinal}. ${block.side} ${block.scenarioOrder.join(" -> ")} cwd=${block.cwd || "<required>"}`);
  }
  return `${lines.join("\n")}\n`;
}

function runSync(command, args, { cwd = REPO_ROOT, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}: ${String(result.stderr || result.stdout || "").trim()}`);
  }
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function runGit(cwd, args, options = {}) {
  return runSync("git", args, { cwd, ...options });
}

async function trackedArtifactDescriptor(worktree, relativePath) {
  const gitBlob = runGit(worktree, ["rev-parse", `HEAD:${toPosix(relativePath)}`]).stdout.trim();
  const content = runGit(worktree, ["show", `HEAD:${toPosix(relativePath)}`]).stdout;
  return {
    path: toPosix(relativePath),
    gitBlob,
    lfNormalizedSha256: lfNormalizedSha256(Buffer.from(content, "utf8")),
  };
}

async function currentArtifactDescriptor(relativePath) {
  const content = await fs.readFile(path.join(REPO_ROOT, relativePath));
  const normalized = Buffer.from(content.toString("utf8").replace(/\r\n?/g, "\n"), "utf8");
  return {
    path: toPosix(relativePath),
    gitBlob: gitBlobSha1(normalized),
    lfNormalizedSha256: sha256(normalized),
  };
}

export async function buildCurrentHarnessArtifacts() {
  return {
    analyzer: await currentArtifactDescriptor(ANALYZER_PATH),
    policy: await currentArtifactDescriptor(POLICY_PATH),
    windowsRuntime: await currentArtifactDescriptor(WINDOWS_RUNTIME_PATH),
    jobRunnerSource: await currentArtifactDescriptor(JOB_RUNNER_SOURCE_PATH),
  };
}

function worktreeGitSnapshot(worktree) {
  const actualHead = runGit(worktree, ["rev-parse", "HEAD"]).stdout.trim();
  const branch = runGit(worktree, ["symbolic-ref", "-q", "--short", "HEAD"], { allowFailure: true });
  const gitStatus = runGit(worktree, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout.trim();
  return {
    actualHead,
    detached: branch.exitCode !== 0,
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    gitStatus,
  };
}

export function validateMeasurementSnapshot(snapshot, expectedHead, label = "measurement") {
  const failures = [];
  if (snapshot.actualHead !== expectedHead) failures.push(`head=${snapshot.actualHead} expected=${expectedHead}`);
  if (!snapshot.detached) failures.push(`branch=${snapshot.branch || "attached"}`);
  if (snapshot.gitStatus) failures.push(`gitStatus=${JSON.stringify(snapshot.gitStatus)}`);
  if (failures.length) throw new WilliamsInvalidExperimentError(
    `${label} measurement worktree is invalid: ${failures.join("; ")}`,
    "identity-mismatch",
  );
  return snapshot;
}

function validateMeasurementWorktree(worktree, expectedHead, label) {
  if (!worktree || !expectedHead) throw new WilliamsInvalidExperimentError(`${label} worktree and exact head are required.`, "identity-missing");
  return validateMeasurementSnapshot(worktreeGitSnapshot(worktree), expectedHead, label);
}

async function collectBlockIdentity(block, harnessArtifacts) {
  const gitSnapshot = validateMeasurementWorktree(block.cwd, block.expectedHead, `${block.id}/${block.side}`);
  return {
    schemaVersion: 1,
    blockId: block.id,
    side: block.side,
    expectedHead: block.expectedHead,
    actualHead: gitSnapshot.actualHead,
    detached: gitSnapshot.detached,
    branch: gitSnapshot.branch,
    gitStatus: gitSnapshot.gitStatus,
    cwd: block.cwd,
    artifacts: {
      packageLock: await trackedArtifactDescriptor(block.cwd, PACKAGE_LOCK_PATH),
      runner: await trackedArtifactDescriptor(block.cwd, BASELINE_RUNNER_PATH),
      rolePolicy: await trackedArtifactDescriptor(block.cwd, ROLE_POLICY_PATH),
      analyzer: harnessArtifacts.analyzer,
      policy: harnessArtifacts.policy,
      windowsRuntime: harnessArtifacts.windowsRuntime,
      jobRunnerSource: harnessArtifacts.jobRunnerSource,
      jobRunnerBinary: harnessArtifacts.jobRunnerBinary,
    },
  };
}

async function fetchProbe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return { url, responded: true, ok: response.ok, status: response.status };
  } catch (error) {
    return { url, responded: false, ok: false, status: null, error: String(error?.message || error) };
  }
}

export function resolveServerMetadataProbeTarget(metadata) {
  const baseUrl = String(metadata?.base_url || metadata?.baseUrl || metadata?.url || "").trim();
  if (!baseUrl) return { status: "missing", baseUrl: null, probeUrl: null };
  try {
    return { status: "valid", baseUrl, probeUrl: new URL("/app/", baseUrl).href };
  } catch (error) {
    return { status: "invalid", baseUrl, probeUrl: null, error: String(error?.message || error) };
  }
}

async function collectServerState(worktree) {
  const metadataPaths = [
    path.join(worktree, ".runtime", "dev", "active_server.json"),
    path.join(worktree, ".runtime", "tmp", "perf-baseline-runtime", "dev", "active_server.json"),
  ];
  const entries = [];
  for (const metadataPath of metadataPaths) {
    if (!(await pathExists(metadataPath))) {
      entries.push({ metadataPath, present: false, metadata: null, probe: null });
      continue;
    }
    let metadata = null;
    try {
      metadata = await readJson(metadataPath);
    } catch (error) {
      entries.push({ metadataPath, present: true, metadata: null, probe: null, error: String(error?.message || error) });
      continue;
    }
    const target = resolveServerMetadataProbeTarget(metadata);
    const probe = target.status === "valid" ? await fetchProbe(target.probeUrl) : null;
    entries.push({ metadataPath, present: true, metadata, metadataUrlStatus: target.status, probe, error: target.error || null });
  }
  return entries;
}

async function collectEnvironmentState(worktree) {
  const listeners = collectWindowsTcpConnections();
  const processes = collectProcessSnapshot();
  const browser = processes.filter((entry) => /(?:chrome|chromium|msedge)/i.test(String(entry?.Name || "")));
  const server = await collectServerState(worktree);
  const probe = await Promise.all(TASK_PORTS.map((port) => fetchProbe(`http://127.0.0.1:${port}/app/`)));
  const git = worktreeGitSnapshot(worktree);
  return {
    ports: Object.fromEntries(TASK_PORTS.map((port) => [String(port), listeners.filter((entry) => entry.port === port)])),
    allListeningPorts: listeners,
    processes,
    server,
    browser,
    cwd: worktree,
    probe,
    gitStatus: git.gitStatus,
    gitHead: git.actualHead,
    detached: git.detached,
  };
}

export async function collectWindowsTelemetryWindow({ worktree, phase } = {}) {
  const counterPayload = collectWindowsPerformanceWindow({ phase });
  if (counterPayload.capability?.status !== "available") return { ...counterPayload, environment: null };
  try {
    const environment = await collectEnvironmentState(worktree);
    return {
      ...counterPayload,
      environment: {
        ...environment,
        power: counterPayload.power,
      },
    };
  } catch (error) {
    return {
      ...counterPayload,
      capability: {
        status: "collection-error",
        missing: [String(error?.stack || error?.message || error)],
      },
      environment: null,
    };
  }
}

export function deriveWilliamsQuietWindow(telemetry) {
  const environment = telemetry?.environment || {};
  const portsClear = TASK_PORTS.every((port) => (environment.ports?.[String(port)] || []).length === 0);
  const activeServer = (environment.server || []).some((entry) => (
    entry?.present === true
    && (entry?.metadataUrlStatus !== "valid" || entry?.probe?.responded === true)
  ));
  const directProbeResponse = (environment.probe || []).some((entry) => entry?.responded === true);
  const valid = telemetry?.capability?.status === "available"
    && Array.isArray(telemetry.samples)
    && telemetry.samples.length === 5
    && portsClear
    && !activeServer
    && !directProbeResponse
    && environment.gitStatus === ""
    && environment.detached === true;
  return {
    schemaVersion: 1,
    status: valid ? "valid" : "invalid",
    valid,
    capabilityStatus: telemetry?.capability?.status || "missing",
    portsClear,
    activeServer,
    directProbeResponse,
    gitClean: environment.gitStatus === "",
    detached: environment.detached === true,
  };
}

async function runLoggedCommand(command, {
  cwd,
  stdoutPath,
  stderrPath,
  jobEvidencePath,
  preparedRunner,
  timeoutMs = LIVE_TIMEOUT_MS,
} = {}) {
  return runWindowsJobCommand(command, {
    preparedRunner,
    cwd,
    stdoutPath,
    stderrPath,
    evidencePath: jobEvidencePath,
    timeoutMs,
  });
}

function pidSet(items) {
  return new Set((items || []).map((item) => Number(item?.ProcessId)).filter(Number.isInteger));
}

function buildCleanup(preTelemetry, postTelemetry, taskOwnedTree, jobEvidence) {
  const preEnvironment = preTelemetry?.environment || {};
  const postEnvironment = postTelemetry?.environment || {};
  const preBrowserPids = pidSet(preEnvironment.browser);
  const postBrowserPids = [...pidSet(postEnvironment.browser)];
  const newBrowserPids = postBrowserPids.filter((pid) => !preBrowserPids.has(pid));
  const taskOwnedPids = taskOwnedTree?.pids || [];
  const taskOwnedPidsRemaining = Array.isArray(jobEvidence?.remainingPids)
    ? jobEvidence.remainingPids.map(Number).filter(Number.isInteger)
    : taskOwnedPids;
  const taskOwnedProcessesRemaining = (taskOwnedTree?.processes || []).filter((entry) => taskOwnedPidsRemaining.includes(entry.ProcessId));
  const terminationResults = [];
  const terminationSucceeded = jobEvidence?.cleanupValid === true;
  const environmentStable = newBrowserPids.length === 0;
  const portsClear = TASK_PORTS.every((port) => (postEnvironment.ports?.[String(port)] || []).length === 0);
  const serverProbesClear = (postEnvironment.server || []).every((entry) => entry?.probe?.responded !== true)
    && (postEnvironment.probe || []).every((entry) => entry?.responded !== true);
  const gitStatusStable = String(preEnvironment.gitStatus || "") === ""
    && String(postEnvironment.gitStatus || "") === "";
  const gitHeadStable = String(preEnvironment.gitHead || "") !== ""
    && preEnvironment.gitHead === postEnvironment.gitHead;
  const detachedStable = preEnvironment.detached === true && postEnvironment.detached === true;
  const valid = postTelemetry?.capability?.status === "available"
    && taskOwnedTree?.captureStatus === "available"
    && terminationSucceeded
    && taskOwnedPidsRemaining.length === 0
    && portsClear
    && serverProbesClear
    && gitStatusStable
    && gitHeadStable
    && detachedStable;
  return {
    schemaVersion: 1,
    valid,
    taskOwnedPids,
    taskOwnedProcesses: taskOwnedTree?.processes || [],
    processTreeCaptureStatus: taskOwnedTree?.captureStatus || "missing",
    terminationResults,
    terminationSucceeded,
    taskOwnedPidsRemaining,
    taskOwnedProcessesRemaining,
    newBrowserPids,
    environmentStable,
    portsClear,
    serverProbesClear,
    gitStatusStable,
    gitHeadStable,
    detachedStable,
    jobObject: jobEvidence || null,
  };
}

async function runBlock(block, harnessArtifacts, preparedRunner) {
  const directory = block.directory;
  await ensureDir(directory);
  const metadata = {
    schemaVersion: 1,
    policyId: WILLIAMS_CROSSOVER_POLICY_ID,
    ordinal: block.ordinal,
    id: block.id,
    side: block.side,
    orderId: block.orderId,
    scenarioOrder: [...block.scenarioOrder],
    cwd: block.cwd,
    expectedHead: block.expectedHead,
  };
  await writeJson(path.join(directory, "block-metadata.json"), metadata);
  const identity = await collectBlockIdentity(block, harnessArtifacts);
  await writeJson(path.join(directory, "identity.json"), identity);
  const preTelemetry = await collectWindowsTelemetryWindow({ worktree: block.cwd, phase: "pre" });
  await writeJson(path.join(directory, "telemetry-pre.json"), preTelemetry);
  const quietWindow = deriveWilliamsQuietWindow(preTelemetry);
  await writeJson(path.join(directory, "quiet-window.json"), quietWindow);
  await writeJson(path.join(directory, "command.json"), block.command);

  let commandResult = {
    pid: null,
    exitCode: 3,
    timedOut: false,
    skipped: true,
    taskOwnedTree: { rootPids: [], pids: [], processes: [], captureStatus: "available", captureErrors: [] },
  };
  let taskOwnedTree = { rootPids: [], pids: [], processes: [], captureStatus: "available", terminationResults: [] };
  try {
    if (quietWindow.valid) {
      commandResult = await runLoggedCommand(block.command, {
        cwd: block.cwd,
        stdoutPath: path.join(directory, "runner.stdout.log"),
        stderrPath: path.join(directory, "runner.stderr.log"),
        jobEvidencePath: path.join(directory, "job-object.json"),
        preparedRunner,
      });
    } else {
      await writeText(path.join(directory, "runner.stdout.log"), "");
      await writeText(path.join(directory, "runner.stderr.log"), "pre-block telemetry or quiet-window invalid\n");
    }
  } finally {
    taskOwnedTree = commandResult.taskOwnedTree || {
      rootPids: Number.isInteger(commandResult.pid) ? [commandResult.pid] : [],
      pids: Number.isInteger(commandResult.pid) ? [commandResult.pid] : [],
      processes: [],
      captureStatus: "collection-error",
      captureErrors: ["job object evidence missing"],
    };
  }
  const postTelemetry = await collectWindowsTelemetryWindow({ worktree: block.cwd, phase: "post" });
  await writeJson(path.join(directory, "telemetry-post.json"), postTelemetry);
  const cleanup = buildCleanup(preTelemetry, postTelemetry, taskOwnedTree, commandResult.jobEvidence);
  await writeJson(path.join(directory, "cleanup.json"), cleanup);
  const complete = quietWindow.valid
    && commandResult.exitCode === 0
    && cleanup.valid
    && cleanup.environmentStable;
  const blockResult = {
    schemaVersion: 1,
    status: complete ? "complete" : "invalid",
    exitCode: commandResult.exitCode,
    timedOut: commandResult.timedOut === true,
    runnerPid: commandResult.pid,
    cleanupValid: cleanup.valid,
    environmentStable: cleanup.environmentStable,
  };
  await writeJson(path.join(directory, "block-result.json"), blockResult);
  return { complete, blockResult };
}

async function walkFiles(root) {
  if (!(await pathExists(root))) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  return files;
}

function requiredEvidencePaths() {
  const paths = [
    "preregistration.json",
    "harness/job-runner-preparation.json",
    WINDOWS_JOB_RUNNER_EVIDENCE_PATH,
  ];
  for (const block of WILLIAMS_BLOCK_SEQUENCE) {
    const prefix = `blocks/${block.id}`;
    for (const fileName of [
      "block-metadata.json",
      "identity.json",
      "telemetry-pre.json",
      "quiet-window.json",
      "command.json",
      "baseline.json",
      "telemetry-post.json",
      "cleanup.json",
      "block-result.json",
      "job-object.json",
    ]) {
      paths.push(`${prefix}/${fileName}`);
    }
    for (const scenarioId of WILLIAMS_SCENARIOS) {
      paths.push(`${prefix}/raw/${scenarioId}/run-01.json`);
      paths.push(`${prefix}/raw/${scenarioId}/run-02.json`);
    }
  }
  return paths;
}

export async function buildWilliamsRawManifest(rawRoot, harnessArtifacts) {
  const files = [];
  for (const relativePath of requiredEvidencePaths()) {
    const absolutePath = path.join(rawRoot, relativePath);
    if (!(await pathExists(absolutePath))) continue;
    const content = await fs.readFile(absolutePath);
    files.push({ path: relativePath, bytes: content.length, sha256: sha256(content) });
  }
  const sideIdentity = {};
  for (const [side, blockId] of [["A", "block-01"], ["B", "block-02"]]) {
    try {
      const identity = await readJson(path.join(rawRoot, "blocks", blockId, "identity.json"));
      sideIdentity[side] = {
        packageLock: identity?.artifacts?.packageLock || null,
        runner: identity?.artifacts?.runner || null,
        rolePolicy: identity?.artifacts?.rolePolicy || null,
      };
    } catch (_error) {
      sideIdentity[side] = null;
    }
  }
  const manifest = {
    schemaVersion: 1,
    policyId: WILLIAMS_CROSSOVER_POLICY_ID,
    requiredEntryCount: requiredEvidencePaths().length,
    measuredRawFileCount: files.filter((entry) => /\/raw\/[^/]+\/run-\d+\.json$/.test(`/${entry.path}`)).length,
    toolIdentity: {
      analyzer: harnessArtifacts.analyzer,
      policy: harnessArtifacts.policy,
      windowsRuntime: harnessArtifacts.windowsRuntime,
      jobRunnerSource: harnessArtifacts.jobRunnerSource,
      jobRunnerBinary: harnessArtifacts.jobRunnerBinary,
      sides: sideIdentity,
    },
    files,
  };
  await writeJsonExclusive(path.join(rawRoot, "raw-sha256-manifest.json"), manifest);
  return manifest;
}

async function readRequiredJson(rawRoot, relativePath, errors) {
  const absolutePath = path.join(rawRoot, relativePath);
  try {
    return await readJson(absolutePath);
  } catch (error) {
    errors.push(`${relativePath}: ${String(error?.message || error)}`);
    return null;
  }
}

async function validateRawManifest(
  rawRoot,
  manifest,
  actualRawFiles,
  loadErrors,
  blocks,
  currentToolIdentity,
  jobRunnerPreparation,
) {
  const errors = [...loadErrors];
  if (!manifest || typeof manifest !== "object") {
    return { status: "invalid", errors: [...errors, "manifest.missing"], measuredRawFileCount: actualRawFiles.length };
  }
  if (manifest.schemaVersion !== 1) errors.push("manifest.schemaVersion");
  if (manifest.policyId !== WILLIAMS_CROSSOVER_POLICY_ID) errors.push("manifest.policyId");
  const required = new Set(requiredEvidencePaths());
  if (!Array.isArray(manifest.files)) errors.push("manifest.files.array");
  const manifestFiles = asArray(manifest.files);
  const entries = new Map(manifestFiles.map((entry) => [toPosix(entry?.path), entry]));
  if (entries.size !== manifestFiles.length) errors.push("manifest.duplicate-entry");
  if (manifest.requiredEntryCount !== required.size) errors.push("manifest.requiredEntryCount");
  for (const requiredPath of required) {
    if (!entries.has(requiredPath)) errors.push(`manifest.missing-entry:${requiredPath}`);
  }
  for (const entryPath of entries.keys()) {
    if (!required.has(entryPath)) errors.push(`manifest.extra-entry:${entryPath}`);
  }
  for (const [relativePath, entry] of entries) {
    const normalizedPath = path.posix.normalize(relativePath);
    if (
      path.posix.isAbsolute(relativePath)
      || normalizedPath === ".."
      || normalizedPath.startsWith("../")
      || normalizedPath !== relativePath
    ) {
      errors.push(`manifest.unsafe-path:${relativePath}`);
      continue;
    }
    const absolutePath = path.join(rawRoot, relativePath);
    try {
      const content = await fs.readFile(absolutePath);
      if (sha256(content) !== entry.sha256) errors.push(`manifest.sha256:${relativePath}`);
      if (content.length !== entry.bytes) errors.push(`manifest.bytes:${relativePath}`);
    } catch (error) {
      errors.push(`manifest.unreadable:${relativePath}:${String(error?.message || error)}`);
    }
  }
  const expectedRaw = new Set(requiredEvidencePaths().filter((relativePath) => relativePath.includes("/raw/")));
  const actualRaw = new Set(actualRawFiles.map((filePath) => toPosix(path.relative(rawRoot, filePath))));
  for (const expectedPath of expectedRaw) if (!actualRaw.has(expectedPath)) errors.push(`raw.missing:${expectedPath}`);
  for (const actualPath of actualRaw) if (!expectedRaw.has(actualPath)) errors.push(`raw.extra:${actualPath}`);
  if (actualRaw.size !== 32) errors.push(`raw.count.expected-32-actual-${actualRaw.size}`);
  if (manifest.measuredRawFileCount !== 32) errors.push(`manifest.raw-count.expected-32-actual-${manifest.measuredRawFileCount}`);
  for (const field of ["analyzer", "policy", "windowsRuntime", "jobRunnerSource"]) {
    if (!/^[a-f0-9]{40}$/i.test(String(manifest.toolIdentity?.[field]?.gitBlob || ""))) {
      errors.push(`manifest.toolIdentity.${field}.gitBlob`);
    }
    if (!/^[a-f0-9]{64}$/i.test(String(manifest.toolIdentity?.[field]?.lfNormalizedSha256 || ""))) {
      errors.push(`manifest.toolIdentity.${field}.lfNormalizedSha256`);
    }
    if (!artifactDescriptorsEqual(manifest.toolIdentity?.[field], currentToolIdentity?.[field])) {
      errors.push(`manifest.toolIdentity.${field}.current`);
    }
    for (const block of blocks) {
      if (!artifactDescriptorsEqual(manifest.toolIdentity?.[field], block?.identity?.artifacts?.[field])) {
        errors.push(`manifest.toolIdentity.${field}.${block?.id || "unknown-block"}`);
      }
    }
  }
  const binaryDescriptor = manifest.toolIdentity?.jobRunnerBinary;
  if (binaryDescriptor?.path !== WINDOWS_JOB_RUNNER_EVIDENCE_PATH) {
    errors.push("manifest.toolIdentity.jobRunnerBinary.path");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(binaryDescriptor?.sha256 || ""))) {
    errors.push("manifest.toolIdentity.jobRunnerBinary.sha256");
  }
  if (!Number.isInteger(binaryDescriptor?.bytes) || binaryDescriptor.bytes <= 0) {
    errors.push("manifest.toolIdentity.jobRunnerBinary.bytes");
  }
  const binaryEntry = entries.get(WINDOWS_JOB_RUNNER_EVIDENCE_PATH);
  if (binaryEntry?.sha256 !== binaryDescriptor?.sha256) {
    errors.push("manifest.toolIdentity.jobRunnerBinary.evidence.sha256");
  }
  if (binaryEntry?.bytes !== binaryDescriptor?.bytes) {
    errors.push("manifest.toolIdentity.jobRunnerBinary.evidence.bytes");
  }
  if (!binaryDescriptorsEqual(binaryDescriptor, jobRunnerPreparation?.binary)) {
    errors.push("manifest.toolIdentity.jobRunnerBinary.preparation");
  }
  if (!artifactDescriptorsEqual(manifest.toolIdentity?.jobRunnerSource, jobRunnerPreparation?.source)) {
    errors.push("manifest.toolIdentity.jobRunnerSource.preparation");
  }
  for (const block of blocks) {
    if (!binaryDescriptorsEqual(binaryDescriptor, block?.identity?.artifacts?.jobRunnerBinary)) {
      errors.push(`manifest.toolIdentity.jobRunnerBinary.${block?.id || "unknown-block"}`);
    }
  }
  for (const side of ["A", "B"]) {
    for (const field of ["packageLock", "runner", "rolePolicy"]) {
      const descriptor = manifest.toolIdentity?.sides?.[side]?.[field];
      if (!/^[a-f0-9]{40}$/i.test(String(descriptor?.gitBlob || ""))) {
        errors.push(`manifest.toolIdentity.sides.${side}.${field}.gitBlob`);
      }
      if (!/^[a-f0-9]{64}$/i.test(String(descriptor?.lfNormalizedSha256 || ""))) {
        errors.push(`manifest.toolIdentity.sides.${side}.${field}.lfNormalizedSha256`);
      }
      for (const block of blocks.filter((entry) => entry?.side === side)) {
        if (!artifactDescriptorsEqual(descriptor, block?.identity?.artifacts?.[field])) {
          errors.push(`manifest.toolIdentity.sides.${side}.${field}.${block?.id || "unknown-block"}`);
        }
      }
    }
  }
  return {
    status: errors.length ? "invalid" : "valid",
    errors,
    measuredRawFileCount: actualRaw.size,
    manifestEntryCount: entries.size,
  };
}

export async function analyzeWilliamsCrossoverRawRoot(rawRoot, { currentToolIdentity = null } = {}) {
  const resolvedRoot = normalizePath(rawRoot);
  const loadErrors = [];
  const preregistration = await readRequiredJson(resolvedRoot, "preregistration.json", loadErrors);
  const jobRunnerPreparation = await readRequiredJson(
    resolvedRoot,
    "harness/job-runner-preparation.json",
    loadErrors,
  );
  const manifest = await readRequiredJson(resolvedRoot, "raw-sha256-manifest.json", loadErrors);
  const allFiles = await walkFiles(path.join(resolvedRoot, "blocks"));
  const actualRawFiles = allFiles.filter((filePath) => /[\\/]raw[\\/].+\.json$/i.test(filePath));
  const blocks = [];
  for (const expectedBlock of WILLIAMS_BLOCK_SEQUENCE) {
    const prefix = `blocks/${expectedBlock.id}`;
    const metadata = await readRequiredJson(resolvedRoot, `${prefix}/block-metadata.json`, loadErrors);
    const rawRuns = {};
    for (const scenarioId of WILLIAMS_SCENARIOS) {
      rawRuns[scenarioId] = [];
      for (const runNumber of [1, 2]) {
        const run = await readRequiredJson(
          resolvedRoot,
          `${prefix}/raw/${scenarioId}/run-${String(runNumber).padStart(2, "0")}.json`,
          loadErrors,
        );
        if (run) rawRuns[scenarioId].push(run);
      }
    }
    blocks.push({
      ordinal: metadata?.ordinal ?? expectedBlock.ordinal,
      id: metadata?.id ?? expectedBlock.id,
      side: metadata?.side ?? expectedBlock.side,
      orderId: metadata?.orderId ?? expectedBlock.orderId,
      scenarioOrder: metadata?.scenarioOrder ?? [],
      identity: await readRequiredJson(resolvedRoot, `${prefix}/identity.json`, loadErrors),
      telemetry: {
        pre: await readRequiredJson(resolvedRoot, `${prefix}/telemetry-pre.json`, loadErrors),
        post: await readRequiredJson(resolvedRoot, `${prefix}/telemetry-post.json`, loadErrors),
      },
      quietWindow: await readRequiredJson(resolvedRoot, `${prefix}/quiet-window.json`, loadErrors),
      command: await readRequiredJson(resolvedRoot, `${prefix}/command.json`, loadErrors),
      baseline: await readRequiredJson(resolvedRoot, `${prefix}/baseline.json`, loadErrors),
      cleanup: await readRequiredJson(resolvedRoot, `${prefix}/cleanup.json`, loadErrors),
      jobObject: await readRequiredJson(resolvedRoot, `${prefix}/job-object.json`, loadErrors),
      blockResult: await readRequiredJson(resolvedRoot, `${prefix}/block-result.json`, loadErrors),
      rawRuns,
    });
  }
  const analyzerToolIdentity = currentToolIdentity || await buildCurrentHarnessArtifacts();
  const manifestValidation = await validateRawManifest(
    resolvedRoot,
    manifest,
    actualRawFiles,
    loadErrors,
    blocks,
    analyzerToolIdentity,
    jobRunnerPreparation,
  );
  return analyzeWilliamsCrossoverEvidence({
    preregistration,
    jobRunnerPreparation,
    blocks,
    manifestValidation,
  });
}

export function buildWilliamsMarkdown(report) {
  const lines = [
    "# P2 Williams crossover performance report",
    "",
    `- Policy: ${report.policyId}`,
    `- Decision: ${report.decision.status}`,
    `- Exit code: ${report.decision.exitCode}`,
    `- Canonical role: ${report.renderSampleRole.canonicalRoleId}`,
    `- Raw files: ${report.manifestValidation.measuredRawFileCount ?? 0}/32`,
    "",
    "## Primary paired estimates",
    "",
  ];
  for (const scenarioId of WILLIAMS_SCENARIOS) {
    for (const metricId of ["startup", "canonicalRender"]) {
      const metric = report.primary?.[scenarioId]?.[metricId] || {};
      lines.push(`- ${scenarioId}.${metricId}: ${Number(metric.deltaMs || 0).toFixed(2)} ms / ${Number(metric.deltaPercent || 0).toFixed(2)}%; pair regressions ${metric.practicalRegressionCount ?? 0}/4; ${metric.pairPolicyStatus || "missing"}`);
    }
  }
  lines.push("", "## Admission", "");
  if (report.decision.invalidReasons?.length) {
    report.decision.invalidReasons.forEach((reason) => lines.push(`- invalid: ${reason}`));
  } else if (report.decision.regressions?.length) {
    report.decision.regressions.forEach((entry) => lines.push(`- regression: ${entry.scenarioId}.${entry.metric}`));
  } else {
    lines.push("- All pre-registered validity and performance checks pass.");
  }
  lines.push("", "Legacy pooled medians remain diagnostic-only.", "");
  return lines.join("\n");
}

async function writeReport(options, report, { allowOverwrite = false } = {}) {
  if (allowOverwrite) {
    await writeJson(options.jsonOut, report);
    await writeText(options.mdOut, buildWilliamsMarkdown(report));
    return;
  }
  await writeJsonExclusive(options.jsonOut, report);
  await writeTextExclusive(options.mdOut, buildWilliamsMarkdown(report));
}

function validateExecuteOptions(options) {
  for (const field of ["controlWorktree", "candidateWorktree", "controlHead", "candidateHead"]) {
    if (!String(options[field] || "").trim()) throw new WilliamsInvalidExperimentError(
      `--${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required for --execute.`,
      "identity-option-missing",
    );
  }
}

function pathIsInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function validateWilliamsOutputPolicy(options, { reserveRawRoot = false, allowReportOverwrite = false } = {}) {
  const paths = [options.rawRoot, options.jsonOut, options.mdOut].map(normalizePath);
  if (new Set(paths.map((entry) => entry.toLowerCase())).size !== paths.length) {
    throw new WilliamsInvalidExperimentError("Raw, JSON, and Markdown output paths must be distinct.", "output-path-collision");
  }
  if (pathIsInside(options.rawRoot, options.jsonOut) || pathIsInside(options.rawRoot, options.mdOut)) {
    throw new WilliamsInvalidExperimentError("Report outputs must stay outside the immutable raw evidence root.", "report-inside-raw-root");
  }
  if (!allowReportOverwrite) {
    for (const reportPath of [options.jsonOut, options.mdOut]) {
      if (await pathExists(reportPath)) throw new WilliamsInvalidExperimentError(
        `Report output already exists; choose a new path or use --overwrite-analysis for an explicit analysis replacement: ${reportPath}`,
        "report-output-exists",
      );
    }
  }
  if (reserveRawRoot) {
    await ensureDir(path.dirname(options.rawRoot));
    try {
      await fs.mkdir(options.rawRoot, { recursive: false });
    } catch (error) {
      if (error?.code === "EEXIST") throw new WilliamsInvalidExperimentError(
        `Raw root already exists; preserve prior evidence and choose a new root: ${options.rawRoot}`,
        "raw-root-exists",
      );
      throw error;
    }
  }
}

async function collectHarnessArtifacts(options) {
  const candidate = options.candidateWorktree;
  const artifacts = {
    analyzer: await trackedArtifactDescriptor(candidate, ANALYZER_PATH),
    policy: await trackedArtifactDescriptor(candidate, POLICY_PATH),
    windowsRuntime: await trackedArtifactDescriptor(candidate, WINDOWS_RUNTIME_PATH),
    jobRunnerSource: await trackedArtifactDescriptor(candidate, JOB_RUNNER_SOURCE_PATH),
  };
  const current = await buildCurrentHarnessArtifacts();
  for (const [field, relativePath] of [
    ["analyzer", ANALYZER_PATH],
    ["policy", POLICY_PATH],
    ["windowsRuntime", WINDOWS_RUNTIME_PATH],
    ["jobRunnerSource", JOB_RUNNER_SOURCE_PATH],
  ]) {
    if (!artifactDescriptorsEqual(current[field], artifacts[field])) {
      throw new WilliamsInvalidExperimentError(
        `Executing ${relativePath} differs from candidate HEAD; commit tooling and recreate the exact detached candidate worktree.`,
        "tool-identity-mismatch",
      );
    }
  }
  return artifacts;
}

export function requireWilliamsJobRunnerReady(preparation) {
  if (preparation?.status !== "available") {
    throw new WilliamsInvalidExperimentError(
      `Windows Job runner preparation failed (${preparation?.status || "missing"}): ${preparation?.error || "unknown error"}`,
      `job-runner-${preparation?.status || "missing"}`,
    );
  }
  return preparation;
}

async function executeExperiment(options) {
  validateExecuteOptions(options);
  validateMeasurementWorktree(options.controlWorktree, options.controlHead, "control/A");
  validateMeasurementWorktree(options.candidateWorktree, options.candidateHead, "candidate/B");
  const harnessArtifacts = await collectHarnessArtifacts(options);
  await validateWilliamsOutputPolicy(options, { reserveRawRoot: true, allowReportOverwrite: false });
  const preparationResult = await prepareWindowsJobRunner({
    evidenceDirectory: path.join(options.rawRoot, "harness", "job-runner"),
    evidenceBinaryPath: path.join(options.rawRoot, WINDOWS_JOB_RUNNER_EVIDENCE_PATH),
    evidenceBinaryDescriptorPath: WINDOWS_JOB_RUNNER_EVIDENCE_PATH,
  });
  await writeJson(path.join(options.rawRoot, "harness", "job-runner-preparation.json"), {
    schemaVersion: 1,
    status: preparationResult.status,
    error: preparationResult.error || null,
    compiledAt: preparationResult.compiledAt || null,
    capabilityProbedAt: preparationResult.capabilityProbedAt || null,
    source: harnessArtifacts.jobRunnerSource,
    binary: preparationResult.binary || null,
    capabilityCommand: preparationResult.capabilityCommand || null,
    capabilityEvidence: preparationResult.capabilityEvidence || preparationResult.probeResult?.jobEvidence || null,
  });
  const preparation = requireWilliamsJobRunnerReady(preparationResult);
  harnessArtifacts.jobRunnerBinary = preparation.binary;
  try {
    const plan = buildWilliamsExecutionPlan({
      ...options,
      jobRunnerSource: harnessArtifacts.jobRunnerSource,
      jobRunnerBinary: harnessArtifacts.jobRunnerBinary,
    });
    const preregistration = {
      ...plan.preregistration,
      generatedAt: new Date().toISOString(),
    };
    await writeJson(path.join(options.rawRoot, "preregistration.json"), preregistration);
    for (const block of plan.blocks) {
      const result = await runBlock(block, harnessArtifacts, preparation);
      if (!result.complete) break;
    }
    await buildWilliamsRawManifest(options.rawRoot, harnessArtifacts);
    const report = await analyzeWilliamsCrossoverRawRoot(options.rawRoot);
    await writeReport(options, report, { allowOverwrite: false });
    return report;
  } finally {
    await preparation.cleanup();
  }
}

export async function runWilliamsCli(options) {
  const plan = buildWilliamsExecutionPlan(options);
  if (["list", "dry-run"].includes(options.mode)) {
    process.stdout.write(formatPlan(plan));
    return { mode: options.mode, exitCode: 0, plan };
  }
  if (options.mode === "plan") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return { mode: options.mode, exitCode: 0, plan };
  }
  if (options.mode === "analyze") {
    await validateWilliamsOutputPolicy(options, { reserveRawRoot: false, allowReportOverwrite: options.overwriteAnalysis === true });
    const report = await analyzeWilliamsCrossoverRawRoot(options.rawRoot);
    await writeReport(options, report, { allowOverwrite: options.overwriteAnalysis === true });
    return { mode: options.mode, exitCode: report.decision.exitCode, report };
  }
  if (options.mode === "execute") {
    const report = await executeExperiment(options);
    return { mode: options.mode, exitCode: report.decision.exitCode, report };
  }
  throw new Error(`Unsupported Williams crossover mode: ${options.mode}`);
}

async function main() {
  const options = parseWilliamsArgs(process.argv.slice(2));
  const result = await runWilliamsCli(options);
  process.exitCode = result.exitCode;
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = getWilliamsErrorExitCode(error);
  });
}
