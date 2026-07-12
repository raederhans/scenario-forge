import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import * as windowsRuntime from "../tools/perf/williams_crossover_windows_runtime.mjs";

const JOB_RUNNER_SOURCE_URL = new URL(
  "../tools/perf/williams_crossover_windows_job_runner.cs",
  import.meta.url,
);
const WINDOWS_RUNTIME_SOURCE_URL = new URL(
  "../tools/perf/williams_crossover_windows_runtime.mjs",
  import.meta.url,
);

function decodeBase64(value) {
  return Buffer.from(String(value), "base64").toString("utf8");
}

function createFakeChild({
  stdinError = null,
  stdinThrow = null,
  closeOnEnd = false,
  prematureCloseOnKill = false,
} = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new EventEmitter();
  child.killCount = 0;
  let closed = false;
  const close = (code) => {
    if (closed) return;
    closed = true;
    child.stdout.end();
    child.stderr.end();
    queueMicrotask(() => child.emit("close", code, null));
  };
  child.stdin.end = () => {
    if (stdinThrow) throw stdinThrow;
    if (stdinError) queueMicrotask(() => child.stdin.emit("error", stdinError));
    if (closeOnEnd) close(0);
  };
  child.kill = () => {
    child.killCount += 1;
    if (prematureCloseOnKill) {
      child.stdout.destroy();
      child.stderr.destroy();
      queueMicrotask(() => child.emit("close", 1, null));
      return true;
    }
    close(1);
    return true;
  };
  return child;
}

test("Windows telemetry schedules fixed one-second deadlines before CIM collection", async () => {
  const source = await fs.readFile(WINDOWS_RUNTIME_SOURCE_URL, "utf8");
  const clockIndex = source.indexOf("[Diagnostics.Stopwatch]::StartNew()");
  const targetIndex = source.indexOf("($index + 1) * 1000");
  const sleepIndex = source.indexOf("Start-Sleep -Milliseconds $remainingMs");
  const timestampIndex = source.indexOf("$sampleAt = [datetime]::UtcNow.ToString('o')");
  const processorQueryIndex = source.indexOf("Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation");
  assert.ok(clockIndex >= 0, "missing monotonic telemetry clock");
  assert.ok(targetIndex > clockIndex, "missing absolute one-second sample deadline");
  assert.ok(sleepIndex > targetIndex, "missing deadline-relative sleep");
  assert.ok(timestampIndex > sleepIndex, "sample timestamp must follow the deadline wait");
  assert.ok(processorQueryIndex > timestampIndex, "sample timestamp must precede CIM query latency");
  assert.doesNotMatch(source, /Start-Sleep -Seconds 1/);
});

test("Windows probes bound synchronous work and persist only minimal process identity", async () => {
  const source = await fs.readFile(WINDOWS_RUNTIME_SOURCE_URL, "utf8");
  assert.match(source, /const WINDOWS_CAPABILITY_PROBE_TIMEOUT_MS = [\d_]+;/);
  assert.match(source, /const WINDOWS_JOB_RUNNER_COMPILE_TIMEOUT_MS = [\d_]+;/);
  assert.match(source, /timeout: WINDOWS_CAPABILITY_PROBE_TIMEOUT_MS/);
  assert.match(source, /timeout: WINDOWS_JOB_RUNNER_COMPILE_TIMEOUT_MS/);
  const processScript = source.slice(
    source.indexOf("const WINDOWS_PROCESS_SCRIPT"),
    source.indexOf("const WINDOWS_TCP_CONNECTION_SCRIPT"),
  );
  assert.match(processScript, /Select-Object ProcessId,ParentProcessId,Name/);
  assert.doesNotMatch(processScript, /ExecutablePath|CommandLine/);
});

test("capability and compile timeouts are typed and clean temporary builds", async (t) => {
  const timeoutError = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
  let capabilityOptions = null;
  const performanceWindow = windowsRuntime.collectWindowsPerformanceWindow({
    phase: "pre",
    platform: "win32",
    spawnSyncFn: (_command, _args, options) => {
      capabilityOptions = options;
      return { error: timeoutError, status: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(capabilityOptions.timeout, 60_000);
  assert.equal(performanceWindow.capability.status, "collection-error");
  assert.match(performanceWindow.capability.missing[0], /exceeded 60000 ms/);

  const buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), "williams-job-timeout-"));
  t.after(() => fs.rm(buildRoot, { recursive: true, force: true }));
  let compileOptions = null;
  await assert.rejects(
    windowsRuntime.compileWindowsJobRunner({
      platform: "win32",
      buildRoot,
      spawnSyncFn: (_command, _args, options) => {
        compileOptions = options;
        return { error: timeoutError, status: null, stdout: "", stderr: "" };
      },
    }),
    (error) => error instanceof windowsRuntime.WilliamsWindowsRuntimeError
      && error.code === "job-runner-compile-timeout",
  );
  assert.equal(compileOptions.timeout, 120_000);
  assert.deepEqual(await fs.readdir(buildRoot), []);
});

test("runtime streams workload output instead of retaining complete runs in memory", async () => {
  const source = await fs.readFile(WINDOWS_RUNTIME_SOURCE_URL, "utf8");
  assert.match(source, /createWriteStream/);
  assert.match(source, /pipeline\(/);
  assert.doesNotMatch(source, /const stdout = \[\]|const stderr = \[\]/);
  assert.doesNotMatch(source, /Buffer\.concat\(stdout\)|Buffer\.concat\(stderr\)/);
});

function validJobEvidence(command, cwd) {
  return {
    schemaVersion: 1,
    protocolId: windowsRuntime.WINDOWS_JOB_RUNNER_PROTOCOL_ID,
    provider: "windows-job-object",
    status: "complete",
    rootPid: 42,
    rootExitCode: 0,
    timedOut: false,
    createSuspended: true,
    createNoWindow: true,
    assignedBeforeResume: true,
    rootInJobBeforeResume: true,
    killOnJobClose: true,
    breakawayAllowed: false,
    jobCloseSucceeded: true,
    terminateJobSucceeded: false,
    rootTerminationConfirmed: true,
    remainingPids: [],
    unverifiedPids: [],
    cleanupValid: true,
    commandExecutablePath: command.bin,
    commandWorkingDirectory: cwd,
    commandArguments: [...command.args],
  };
}

test("job runner protocol preserves empty, spaced, quoted, and trailing-backslash argv", () => {
  assert.equal(typeof windowsRuntime.encodeWindowsJobRunnerSpec, "function");
  const args = ["", "two words", "say\"hello", "C:\\path with space\\"];
  const payload = windowsRuntime.encodeWindowsJobRunnerSpec({
    command: { bin: "C:\\Program Files\\nodejs\\node.exe", args },
    cwd: "C:\\work tree",
    evidencePath: "C:\\evidence root\\job result.json",
    timeoutMs: 1234,
  });
  const lines = payload.trimEnd().split(/\r?\n/);
  assert.equal(lines[0], "SF_WILLIAMS_JOB_V1");
  assert.equal(decodeBase64(lines[1]), "C:\\Program Files\\nodejs\\node.exe");
  assert.equal(decodeBase64(lines[2]), "C:\\work tree");
  assert.equal(decodeBase64(lines[3]), "C:\\evidence root\\job result.json");
  assert.equal(lines[4], "1234");
  assert.equal(lines[5], String(args.length));
  assert.deepEqual(lines.slice(6).map(decodeBase64), args);
});

test("tracked job runner source locks suspended assign-before-resume containment", async () => {
  const source = await fs.readFile(JOB_RUNNER_SOURCE_URL, "utf8");
  for (const token of [
    "CREATE_SUSPENDED",
    "CREATE_NO_WINDOW",
    "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
    "CreateProcessW",
    "AssignProcessToJobObject",
    "ResumeThread",
    "TerminateProcess",
  ]) {
    assert.match(source, new RegExp(token));
  }
  const mainStart = source.indexOf("public static int Main()");
  const mainSource = source.slice(mainStart);
  const createIndex = mainSource.indexOf("CreateProcessW(");
  const assignIndex = mainSource.indexOf("AssignProcessToJobObject(", createIndex);
  const membershipIndex = mainSource.indexOf("IsProcessInJob(", assignIndex);
  const resumeIndex = mainSource.indexOf("ResumeThread(", membershipIndex);
  assert.ok(mainStart >= 0);
  assert.ok(createIndex >= 0 && createIndex < assignIndex && assignIndex < membershipIndex && membershipIndex < resumeIndex);
  assert.doesNotMatch(source, /CREATE_BREAKAWAY_FROM_JOB|JOB_OBJECT_LIMIT_(?:SILENT_)?BREAKAWAY_OK/);
  assert.doesNotMatch(source, /Win32_ProcessStartTrace|Register-CimIndicationEvent|Register-WmiEvent/);
});

test("runtime validates evidence schema and owns stdin plus async finish failures", async () => {
  assert.equal(typeof windowsRuntime.validateJobRunnerEvidence, "function");
  const invalid = windowsRuntime.validateJobRunnerEvidence({ schemaVersion: 0 });
  assert.ok(invalid.includes("job-evidence.schemaVersion"));

  const runtimeSource = await fs.readFile(
    new URL("../tools/perf/williams_crossover_windows_runtime.mjs", import.meta.url),
    "utf8",
  );
  assert.match(runtimeSource, /class WilliamsJobRunnerTransportError extends Error/);
  assert.match(runtimeSource, /child\.stdin\?\.once\("error"/);
  assert.match(runtimeSource, /job-runner-output-write-error/);
});

test("runtime rejects stdin EPIPE with a typed transport error", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "williams-job-stdin-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const epipe = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
  const child = createFakeChild({ stdinError: epipe });
  await assert.rejects(
    windowsRuntime.runWindowsJobCommand(
      { bin: process.execPath, args: ["--version"] },
      {
        preparedRunner: { status: "available", executablePath: "runner.exe", binary: {} },
        cwd: root,
        stdoutPath: path.join(root, "stdout.log"),
        stderrPath: path.join(root, "stderr.log"),
        evidencePath: path.join(root, "job.json"),
        timeoutMs: 100,
        spawnFn: () => child,
      },
    ),
    (error) => error instanceof windowsRuntime.WilliamsJobRunnerTransportError
      && error.code === "job-runner-stdin-error",
  );
});

test("runtime preserves the spawn error when stream shutdown also fails", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "williams-job-spawn-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = createFakeChild();
  const spawnError = Object.assign(new Error("spawn denied"), { code: "EACCES" });
  await assert.rejects(
    windowsRuntime.runWindowsJobCommand(
      { bin: process.execPath, args: ["--version"] },
      {
        preparedRunner: { status: "available", executablePath: "runner.exe", binary: {} },
        cwd: root,
        stdoutPath: path.join(root, "stdout.log"),
        stderrPath: path.join(root, "stderr.log"),
        evidencePath: path.join(root, "job.json"),
        timeoutMs: 100,
        spawnFn: () => {
          queueMicrotask(() => child.emit("error", spawnError));
          return child;
        },
      },
    ),
    (error) => error instanceof windowsRuntime.WilliamsJobRunnerTransportError
      && error.code === "job-runner-spawn-error"
      && error.cause === spawnError,
  );
});

test("runtime preserves a synchronous stdin error when kill closes output streams", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "williams-job-stdin-sync-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stdinError = Object.assign(new Error("stdin closed"), { code: "EPIPE" });
  const child = createFakeChild({ stdinThrow: stdinError, prematureCloseOnKill: true });
  await assert.rejects(
    windowsRuntime.runWindowsJobCommand(
      { bin: process.execPath, args: ["--version"] },
      {
        preparedRunner: { status: "available", executablePath: "runner.exe", binary: {} },
        cwd: root,
        stdoutPath: path.join(root, "stdout.log"),
        stderrPath: path.join(root, "stderr.log"),
        evidencePath: path.join(root, "job.json"),
        timeoutMs: 100,
        spawnFn: () => child,
      },
    ),
    (error) => error instanceof windowsRuntime.WilliamsJobRunnerTransportError
      && error.code === "job-runner-stdin-error"
      && error.cause === stdinError,
  );
});

test("runtime rejects asynchronous output persistence failures", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "williams-job-output-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = createFakeChild({ closeOnEnd: true });
  await assert.rejects(
    windowsRuntime.runWindowsJobCommand(
      { bin: process.execPath, args: ["--version"] },
      {
        preparedRunner: { status: "available", executablePath: "runner.exe", binary: {} },
        cwd: root,
        stdoutPath: root,
        stderrPath: path.join(root, "stderr.log"),
        evidencePath: path.join(root, "job.json"),
        timeoutMs: 100,
        spawnFn: () => child,
      },
    ),
    (error) => error instanceof windowsRuntime.WilliamsJobRunnerTransportError
      && error.code === "job-runner-output-write-error",
  );
  assert.ok(child.killCount > 0, "output sink failure must stop the Job runner immediately");
});

test("preparation probes and returns the immutable evidence binary copy", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "williams-job-evidence-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const compiledPath = path.join(root, "compiled.exe");
  const evidencePath = path.join(root, "raw", "tooling", "windows-job-runner.exe");
  const bytes = Buffer.from("MZ-job-runner", "utf8");
  await fs.writeFile(compiledPath, bytes);
  let cleanupCount = 0;
  let probedExecutablePath = null;
  const preparation = await windowsRuntime.prepareWindowsJobRunner({
    platform: "win32",
    evidenceDirectory: path.join(root, "raw", "harness"),
    evidenceBinaryPath: evidencePath,
    evidenceBinaryDescriptorPath: windowsRuntime.WINDOWS_JOB_RUNNER_EVIDENCE_PATH,
    compileFn: async () => ({
      status: "compiled",
      compiledAt: "2026-07-12T00:00:00.000Z",
      executablePath: compiledPath,
      binary: { path: "temporary.exe", sha256: "0".repeat(64), bytes: bytes.length },
      cleanup: async () => { cleanupCount += 1; },
    }),
    runFn: async (command, options) => {
      probedExecutablePath = options.preparedRunner.executablePath;
      return {
        containmentStatus: "available",
        exitCode: 0,
        jobEvidencePath: options.evidencePath,
        jobEvidence: validJobEvidence(command, options.cwd),
      };
    },
  });
  assert.equal(preparation.status, "available");
  assert.equal(preparation.executablePath, evidencePath);
  assert.equal(probedExecutablePath, evidencePath);
  assert.equal(preparation.binary.path, windowsRuntime.WINDOWS_JOB_RUNNER_EVIDENCE_PATH);
  assert.equal(preparation.binary.bytes, bytes.length);
  assert.deepEqual(await fs.readFile(evidencePath), bytes);
  assert.equal(preparation.compiledAt, "2026-07-12T00:00:00.000Z");
  assert.ok(Number.isFinite(Date.parse(preparation.capabilityProbedAt)));
  await preparation.cleanup();
  assert.equal(cleanupCount, 1);
});

test("job runner cleanup evidence stays fail-closed until every contained process is verified gone", async () => {
  const source = await fs.readFile(JOB_RUNNER_SOURCE_URL, "utf8");
  for (const token of [
    "STARTUPINFOEX",
    "PROC_THREAD_ATTRIBUTE_HANDLE_LIST",
    "jobCloseSucceeded",
    "rootTerminationConfirmed",
    "unverifiedPids",
    "cleanupValid = false",
  ]) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /AssignProcessToJobObject[\s\S]+assignError[\s\S]+TerminateProcess[\s\S]+WAIT_OBJECT_0/);
  assert.doesNotMatch(source, /if \(IsInvalidHandle\(processHandle\)\) continue;/);
});

test("measurement command path excludes process-start tracing and system process polling", async () => {
  const runtimeSource = await fs.readFile(
    new URL("../tools/perf/williams_crossover_windows_runtime.mjs", import.meta.url),
    "utf8",
  );
  const harnessSource = await fs.readFile(
    new URL("../tools/perf/run_williams_crossover.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(runtimeSource, /Win32_ProcessStartTrace|Register-CimIndicationEvent|Wait-Event/);
  const measurementStart = harnessSource.indexOf("async function runLoggedCommand");
  const measurementEnd = harnessSource.indexOf("function pidSet", measurementStart);
  const measurementSource = harnessSource.slice(measurementStart, measurementEnd);
  assert.doesNotMatch(
    measurementSource,
    /startWindowsProcessStartWatcher|createTaskOwnedProcessMonitor|collectWindowsProcessSnapshot|taskkill/,
  );
  assert.match(measurementSource, /runWindowsJobCommand/);
});

test("job runner preparation classifies compile, readiness, and capability failures", async () => {
  const compileFailure = await windowsRuntime.prepareWindowsJobRunner({
    platform: "win32",
    compileFn: async () => { throw new Error("compile denied"); },
  });
  assert.equal(compileFailure.status, "compile-error");

  let readinessCleanup = 0;
  const readyFailure = await windowsRuntime.prepareWindowsJobRunner({
    platform: "win32",
    compileFn: async () => ({
      status: "compiled",
      executablePath: "runner.exe",
      binary: { path: "runner.exe", sha256: "a".repeat(64), bytes: 1 },
      cleanup: async () => { readinessCleanup += 1; },
    }),
    runFn: async () => { throw new Error("ready failed"); },
  });
  assert.equal(readyFailure.status, "ready-error");
  assert.equal(readinessCleanup, 1);

  let capabilityCleanup = 0;
  const capabilityFailure = await windowsRuntime.prepareWindowsJobRunner({
    platform: "win32",
    compileFn: async () => ({
      status: "compiled",
      executablePath: "runner.exe",
      binary: { path: "runner.exe", sha256: "b".repeat(64), bytes: 1 },
      cleanup: async () => { capabilityCleanup += 1; },
    }),
    runFn: async () => ({
      containmentStatus: "invalid",
      exitCode: 3,
      error: "capability invalid",
      jobEvidence: null,
    }),
  });
  assert.equal(capabilityFailure.status, "capability-error");
  assert.equal(capabilityCleanup, 1);
});
