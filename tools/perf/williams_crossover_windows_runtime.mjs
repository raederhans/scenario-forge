import crypto from "node:crypto";
import { constants as fsConstants, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

export const WINDOWS_JOB_RUNNER_PROTOCOL_ID = "SF_WILLIAMS_JOB_V1";
export const WINDOWS_JOB_RUNNER_SOURCE_PATH = fileURLToPath(
  new URL("./williams_crossover_windows_job_runner.cs", import.meta.url),
);

const WINDOWS_JOB_RUNNER_BINARY_NAME = "williams_crossover_windows_job_runner.exe";
const WINDOWS_JOB_RUNNER_DESCRIPTOR_PATH = `runtime-compiled/${WINDOWS_JOB_RUNNER_BINARY_NAME}`;
export const WINDOWS_JOB_RUNNER_EVIDENCE_PATH = "tooling/windows-job-runner.exe";
const WINDOWS_CAPABILITY_PROBE_TIMEOUT_MS = 60_000;
const WINDOWS_JOB_RUNNER_COMPILE_TIMEOUT_MS = 120_000;
const DEFAULT_JOB_RUNNER_BUILD_ROOT = path.resolve(
  path.dirname(WINDOWS_JOB_RUNNER_SOURCE_PATH),
  "..",
  "..",
  ".runtime",
  "tmp",
  "williams-job-runner",
);

const WINDOWS_COUNTER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$samples = @()
$sampleClock = [Diagnostics.Stopwatch]::StartNew()
for ($index = 0; $index -lt 5; $index += 1) {
  $targetElapsedMs = ($index + 1) * 1000
  $remainingMs = [math]::Ceiling($targetElapsedMs - $sampleClock.Elapsed.TotalMilliseconds)
  if ($remainingMs -gt 0) { Start-Sleep -Milliseconds $remainingMs }
  $sampleAt = [datetime]::UtcNow.ToString('o')
  $processorSample = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -ErrorAction Stop
  $memorySample = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
  foreach ($propertyName in @('PercentProcessorTime','PercentProcessorPerformance','PercentofMaximumFrequency','ProcessorFrequency')) {
    if ($null -eq $processorSample.$propertyName) { throw "required processor counter missing: $propertyName" }
  }
  foreach ($propertyName in @('PercentCommittedBytesInUse','AvailableMBytes')) {
    if ($null -eq $memorySample.$propertyName) { throw "required memory counter missing: $propertyName" }
  }
  $samples += [pscustomobject]@{
    at = $sampleAt
    cpuUtilizationPercent = [double]$processorSample.PercentProcessorTime
    processorPerformancePercent = [double]$processorSample.PercentProcessorPerformance
    percentOfMaximumFrequency = [double]$processorSample.PercentofMaximumFrequency
    processorFrequencyMHz = [double]$processorSample.ProcessorFrequency
    performanceAdjustedFrequencyMHz = ([double]$processorSample.ProcessorFrequency * [double]$processorSample.PercentProcessorPerformance) / 100.0
    memoryCommittedPercent = [double]$memorySample.PercentCommittedBytesInUse
    memoryAvailableMBytes = [double]$memorySample.AvailableMBytes
  }
}
if ($samples.Count -ne 5) { throw "required sample count mismatch: $($samples.Count)" }
$processors = @(Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object Name,MaxClockSpeed,CurrentClockSpeed,NumberOfCores,NumberOfLogicalProcessors)
$operatingSystem = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Select-Object TotalVisibleMemorySize,FreePhysicalMemory
$powerText = (& powercfg /getactivescheme 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "powercfg /getactivescheme failed: $powerText" }
$guidMatch = [regex]::Match($powerText, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
$nameMatch = [regex]::Match($powerText, '\(([^)]+)\)')
if (-not $guidMatch.Success) { throw "active power scheme GUID missing" }
if (-not $nameMatch.Success) { throw "active power scheme name missing" }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ScenarioForgePowerStatus {
  [StructLayout(LayoutKind.Sequential)]
  public struct SYSTEM_POWER_STATUS {
    public byte ACLineStatus;
    public byte BatteryFlag;
    public byte BatteryLifePercent;
    public byte SystemStatusFlag;
    public int BatteryLifeTime;
    public int BatteryFullLifeTime;
  }
  [DllImport("kernel32.dll")]
  public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);
}
'@
$powerStatus = New-Object ScenarioForgePowerStatus+SYSTEM_POWER_STATUS
if (-not [ScenarioForgePowerStatus]::GetSystemPowerStatus([ref]$powerStatus)) { throw "GetSystemPowerStatus failed" }
[pscustomobject]@{
  schemaVersion = 1
  capability = [pscustomobject]@{
    status = 'available'
    missing = @()
    provider = 'Win32_PerfFormattedData'
    requiredCounters = @(
      'ProcessorInformation._Total.PercentProcessorTime',
      'ProcessorInformation._Total.PercentProcessorPerformance',
      'ProcessorInformation._Total.PercentofMaximumFrequency',
      'ProcessorInformation._Total.ProcessorFrequency',
      'PerfOS_Memory.PercentCommittedBytesInUse',
      'PerfOS_Memory.AvailableMBytes'
    )
  }
  samples = @($samples)
  processor = @($processors)
  memory = $operatingSystem
  power = [pscustomobject]@{
    activeSchemeGuid = $guidMatch.Value.ToLowerInvariant()
    activeSchemeName = $nameMatch.Groups[1].Value.Trim()
    acLineStatus = [int]$powerStatus.ACLineStatus
    batteryFlag = [int]$powerStatus.BatteryFlag
    batteryLifePercent = [int]$powerStatus.BatteryLifePercent
  }
} | ConvertTo-Json -Depth 8 -Compress
`;

const WINDOWS_PROCESS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
@(
  Get-CimInstance Win32_Process -ErrorAction Stop |
    Select-Object ProcessId,ParentProcessId,Name
) | ConvertTo-Json -Depth 5 -Compress
`;

const WINDOWS_TCP_CONNECTION_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
@(
  Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Select-Object LocalAddress,LocalPort,OwningProcess,State
) | ConvertTo-Json -Depth 5 -Compress
`;

export class WilliamsWindowsRuntimeError extends Error {
  constructor(message, code, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "WilliamsWindowsRuntimeError";
    this.code = code;
  }
}

function runPowerShell(script, spawnSyncFn = spawnSync) {
  const result = spawnSyncFn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: WINDOWS_CAPABILITY_PROBE_TIMEOUT_MS,
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new WilliamsWindowsRuntimeError(
      `PowerShell capability probe exceeded ${WINDOWS_CAPABILITY_PROBE_TIMEOUT_MS} ms`,
      "windows-capability-probe-timeout",
      result.error,
    );
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`PowerShell capability probe exited ${result.status}: ${String(result.stderr || result.stdout || "").trim()}`);
  }
  return JSON.parse(String(result.stdout || "null"));
}

function missingWindow(phase, status, detail) {
  return {
    schemaVersion: 1,
    phase,
    capability: { status, missing: [String(detail || "unknown Windows counter capability")] },
    samples: [],
    processor: [],
    memory: null,
    power: null,
  };
}

export function collectWindowsPerformanceWindow({ phase, platform = process.platform, spawnSyncFn = spawnSync } = {}) {
  if (platform !== "win32") {
    return missingWindow(phase, "required-capability-missing", `platform=${platform}`);
  }
  try {
    const payload = runPowerShell(WINDOWS_COUNTER_SCRIPT, spawnSyncFn);
    return {
      schemaVersion: 1,
      phase,
      capability: payload.capability,
      samples: Array.isArray(payload.samples) ? payload.samples : [payload.samples].filter(Boolean),
      processor: Array.isArray(payload.processor) ? payload.processor : [payload.processor].filter(Boolean),
      memory: payload.memory,
      power: payload.power,
    };
  } catch (error) {
    return missingWindow(phase, "collection-error", String(error?.stack || error?.message || error));
  }
}

export function collectWindowsProcessSnapshot({ platform = process.platform, spawnSyncFn = spawnSync } = {}) {
  if (platform !== "win32") {
    throw new Error(`Windows process capability required; platform=${platform}`);
  }
  const payload = runPowerShell(WINDOWS_PROCESS_SCRIPT, spawnSyncFn);
  return Array.isArray(payload) ? payload : [payload].filter(Boolean);
}

export function collectWindowsTcpConnections({ platform = process.platform, spawnSyncFn = spawnSync } = {}) {
  if (platform !== "win32") {
    throw new Error(`Windows TCP capability required; platform=${platform}`);
  }
  const payload = runPowerShell(WINDOWS_TCP_CONNECTION_SCRIPT, spawnSyncFn);
  return (Array.isArray(payload) ? payload : [payload].filter(Boolean)).map((entry) => ({
    localAddress: String(entry?.LocalAddress || ""),
    port: Number(entry?.LocalPort),
    pid: Number(entry?.OwningProcess),
    state: String(entry?.State || ""),
  }));
}

function base64Line(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function encodePowerShellCommand(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

export class WilliamsJobRunnerTransportError extends Error {
  constructor(message, code, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "WilliamsJobRunnerTransportError";
    this.code = code;
  }
}

export function validateJobRunnerEvidence(evidence, { command = null, cwd = null } = {}) {
  const errors = [];
  if (!evidence || typeof evidence !== "object") return ["job-evidence.missing"];
  if (evidence.schemaVersion !== 1) errors.push("job-evidence.schemaVersion");
  if (evidence.protocolId !== WINDOWS_JOB_RUNNER_PROTOCOL_ID) errors.push("job-evidence.protocolId");
  if (evidence.provider !== "windows-job-object") errors.push("job-evidence.provider");
  if (evidence.status !== "complete") errors.push("job-evidence.status");
  if (evidence.createSuspended !== true) errors.push("job-evidence.createSuspended");
  if (evidence.createNoWindow !== true) errors.push("job-evidence.createNoWindow");
  if (evidence.assignedBeforeResume !== true) errors.push("job-evidence.assignedBeforeResume");
  if (evidence.rootInJobBeforeResume !== true) errors.push("job-evidence.rootInJobBeforeResume");
  if (evidence.killOnJobClose !== true) errors.push("job-evidence.killOnJobClose");
  if (evidence.breakawayAllowed !== false) errors.push("job-evidence.breakawayAllowed");
  if (evidence.jobCloseSucceeded !== true) errors.push("job-evidence.jobCloseSucceeded");
  if (evidence.rootTerminationConfirmed !== true) errors.push("job-evidence.rootTerminationConfirmed");
  if (evidence.cleanupValid !== true) errors.push("job-evidence.cleanupValid");
  if (!Array.isArray(evidence.remainingPids) || evidence.remainingPids.length !== 0) {
    errors.push("job-evidence.remainingPids");
  }
  if (!Array.isArray(evidence.unverifiedPids) || evidence.unverifiedPids.length !== 0) {
    errors.push("job-evidence.unverifiedPids");
  }
  if (evidence.timedOut === true && evidence.terminateJobSucceeded !== true) {
    errors.push("job-evidence.terminateJobSucceeded");
  }
  if (!Number.isInteger(evidence.rootExitCode)) errors.push("job-evidence.rootExitCode");
  if (command) {
    if (evidence.commandExecutablePath !== command.bin) errors.push("job-evidence.commandExecutablePath");
    if (evidence.commandWorkingDirectory !== cwd) errors.push("job-evidence.commandWorkingDirectory");
    if (
      !Array.isArray(evidence.commandArguments)
      || evidence.commandArguments.length !== (command.args || []).length
      || evidence.commandArguments.some((argument, index) => argument !== command.args[index])
    ) {
      errors.push("job-evidence.commandArguments");
    }
  }
  return errors;
}

export function encodeWindowsJobRunnerSpec({
  command,
  executablePath = command?.bin,
  workingDirectory,
  cwd = workingDirectory,
  evidencePath,
  timeoutMs,
  args = command?.args || [],
} = {}) {
  if (!String(executablePath || "").trim()) throw new TypeError("executablePath is required");
  if (!String(cwd || "").trim()) throw new TypeError("workingDirectory is required");
  if (!String(evidencePath || "").trim()) throw new TypeError("evidencePath is required");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive integer");
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  return [
    WINDOWS_JOB_RUNNER_PROTOCOL_ID,
    base64Line(executablePath),
    base64Line(cwd),
    base64Line(evidencePath),
    String(timeoutMs),
    String(args.length),
    ...args.map(base64Line),
    "",
  ].join("\n");
}

export async function compileWindowsJobRunner({
  platform = process.platform,
  sourcePath = WINDOWS_JOB_RUNNER_SOURCE_PATH,
  buildRoot = DEFAULT_JOB_RUNNER_BUILD_ROOT,
  spawnSyncFn = spawnSync,
} = {}) {
  if (platform !== "win32") throw new Error(`Windows Job Object capability required; platform=${platform}`);
  await fs.mkdir(buildRoot, { recursive: true });
  const buildDirectory = await fs.mkdtemp(path.join(buildRoot, "build-"));
  const executablePath = path.join(buildDirectory, WINDOWS_JOB_RUNNER_BINARY_NAME);
  const sourceEncoded = base64Line(path.resolve(sourcePath));
  const outputEncoded = base64Line(executablePath);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${sourceEncoded}'))`,
    `$output = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${outputEncoded}'))`,
    "Add-Type -Path $source -OutputAssembly $output -OutputType ConsoleApplication -ErrorAction Stop",
  ].join("\n");
  const result = spawnSyncFn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShellCommand(script)],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: WINDOWS_JOB_RUNNER_COMPILE_TIMEOUT_MS,
    },
  );
  if (result.error || result.status !== 0) {
    await fs.rm(buildDirectory, { recursive: true, force: true });
    if (result.error?.code === "ETIMEDOUT") {
      throw new WilliamsWindowsRuntimeError(
        `Windows Job runner compilation exceeded ${WINDOWS_JOB_RUNNER_COMPILE_TIMEOUT_MS} ms`,
        "job-runner-compile-timeout",
        result.error,
      );
    }
    throw result.error || new Error(
      `Windows Job runner compilation exited ${result.status}: ${String(result.stderr || result.stdout || "").trim()}`,
    );
  }
  const binary = await fs.readFile(executablePath);
  return Object.freeze({
    status: "compiled",
    compiledAt: new Date().toISOString(),
    buildDirectory,
    executablePath,
    binary: Object.freeze({
      path: WINDOWS_JOB_RUNNER_DESCRIPTOR_PATH,
      sha256: sha256(binary),
      bytes: binary.length,
    }),
    async cleanup() {
      await fs.rm(buildDirectory, { recursive: true, force: true });
    },
  });
}

export async function runWindowsJobCommand(command, {
  preparedRunner,
  cwd,
  stdoutPath,
  stderrPath,
  evidencePath,
  timeoutMs,
  spawnFn = spawn,
} = {}) {
  if (preparedRunner?.status !== "available" && preparedRunner?.status !== "compiled") {
    throw new Error(`Windows Job runner is not prepared: ${preparedRunner?.status || "missing"}`);
  }
  await Promise.all([
    fs.mkdir(path.dirname(stdoutPath), { recursive: true }),
    fs.mkdir(path.dirname(stderrPath), { recursive: true }),
    fs.mkdir(path.dirname(evidencePath), { recursive: true }),
  ]);
  await fs.rm(evidencePath, { force: true });
  return new Promise((resolve, reject) => {
    const child = spawnFn(preparedRunner.executablePath, [], {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let outerTimedOut = false;
    let guardTimer = null;
    let transportError = null;
    const stopForTransportError = (error, { stopChild = true } = {}) => {
      if (transportError) return;
      transportError = error;
      if (stopChild) child.kill();
    };
    const pipeOutput = (source, filePath) => pipeline(source, createWriteStream(filePath, { flags: "w" }))
      .then(() => null, (writeError) => {
        stopForTransportError(new WilliamsJobRunnerTransportError(
          `Windows Job runner output write failed: ${String(writeError?.message || writeError)}`,
          "job-runner-output-write-error",
          writeError,
        ));
        return writeError;
      });
    const stdoutPipeline = pipeOutput(child.stdout, stdoutPath);
    const stderrPipeline = pipeOutput(child.stderr, stderrPath);

    const finish = async ({ code, signal }) => {
      if (settled) return;
      settled = true;
      try {
        if (guardTimer) clearTimeout(guardTimer);
        await Promise.all([stdoutPipeline, stderrPipeline]);
        if (transportError) throw transportError;
        let evidence = null;
        let evidenceError = null;
        try {
          evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));
        } catch (readError) {
          evidenceError = String(readError?.message || readError);
        }
        const evidenceErrors = validateJobRunnerEvidence(evidence, { command, cwd });
        if (evidenceError) evidenceErrors.unshift(`job-evidence.read:${evidenceError}`);
        if (code !== 0) evidenceErrors.unshift(`job-runner.exitCode:${code}`);
        if (outerTimedOut) evidenceErrors.unshift("job-runner.outer-timeout");
        const rootPid = Number(evidence?.rootPid);
        const jobPids = [...new Set([
          ...(Array.isArray(evidence?.jobProcessIdsAtRootExit) ? evidence.jobProcessIdsAtRootExit : []),
          ...(Number.isInteger(rootPid) && rootPid > 0 ? [rootPid] : []),
        ].map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))];
        const containmentAvailable = evidenceErrors.length === 0;
        resolve({
          pid: Number.isInteger(rootPid) && rootPid > 0 ? rootPid : null,
          exitCode: containmentAvailable && Number.isInteger(evidence?.rootExitCode)
            ? evidence.rootExitCode
            : 3,
          signal,
          timedOut: evidence?.timedOut === true || outerTimedOut,
          stdoutPath,
          stderrPath,
          jobEvidencePath: evidencePath,
          jobEvidence: evidence,
          jobRunnerBinary: preparedRunner.binary,
          containmentStatus: containmentAvailable ? "available" : "invalid",
          containmentErrors: evidenceErrors,
          taskOwnedTree: {
            rootPids: Number.isInteger(rootPid) && rootPid > 0 ? [rootPid] : [],
            pids: jobPids,
            processes: jobPids.map((pid) => ({
              ProcessId: pid,
              ParentProcessId: null,
              Name: null,
              ExecutablePath: null,
              CommandLine: null,
              depth: pid === rootPid ? 0 : 1,
              root: pid === rootPid,
            })),
            captureStatus: containmentAvailable ? "available" : "collection-error",
            captureErrors: evidenceErrors,
            jobEvidence: evidence,
          },
          error: evidenceErrors[0],
        });
      } catch (finishError) {
        reject(finishError);
      }
    };
    child.on("close", (code, signal) => { void finish({ code, signal }); });
    child.on("error", (error) => {
      stopForTransportError(new WilliamsJobRunnerTransportError(
        `Windows Job runner spawn failed: ${String(error?.message || error)}`,
        "job-runner-spawn-error",
        error,
      ), { stopChild: false });
      child.stdout?.destroy();
      child.stderr?.destroy();
      void finish({ code: 1, signal: null });
    });
    child.stdin?.once("error", (stdinError) => {
      stopForTransportError(new WilliamsJobRunnerTransportError(
        `Windows Job runner stdin failed: ${String(stdinError?.message || stdinError)}`,
        "job-runner-stdin-error",
        stdinError,
      ));
      void finish({
        code: 1,
        signal: null,
      });
    });
    guardTimer = setTimeout(() => {
      outerTimedOut = true;
      child.kill();
      void finish({ code: 1, signal: null });
    }, timeoutMs + 10_000);
    try {
      child.stdin?.end(encodeWindowsJobRunnerSpec({
        executablePath: command.bin,
        workingDirectory: cwd,
        evidencePath,
        timeoutMs,
        args: command.args,
      }));
    } catch (stdinError) {
      stopForTransportError(new WilliamsJobRunnerTransportError(
        `Windows Job runner stdin failed: ${String(stdinError?.message || stdinError)}`,
        "job-runner-stdin-error",
        stdinError,
      ));
      void finish({
        code: 1,
        signal: null,
      });
    }
  });
}

export async function prepareWindowsJobRunner({
  platform = process.platform,
  buildRoot = DEFAULT_JOB_RUNNER_BUILD_ROOT,
  evidenceDirectory = buildRoot,
  evidenceBinaryPath = null,
  evidenceBinaryDescriptorPath = WINDOWS_JOB_RUNNER_EVIDENCE_PATH,
  compileFn = compileWindowsJobRunner,
  runFn = runWindowsJobCommand,
} = {}) {
  if (platform !== "win32") {
    return Object.freeze({ status: "required-capability-missing", error: `platform=${platform}` });
  }
  let compiled;
  try {
    compiled = await compileFn({ platform, buildRoot });
  } catch (error) {
    return Object.freeze({ status: "compile-error", error: String(error?.stack || error?.message || error) });
  }
  let preparedExecutablePath = compiled.executablePath;
  let preparedBinary = compiled.binary;
  try {
    if (evidenceBinaryPath) {
      await fs.mkdir(path.dirname(evidenceBinaryPath), { recursive: true });
      await fs.copyFile(compiled.executablePath, evidenceBinaryPath, fsConstants.COPYFILE_EXCL);
      const evidenceBinary = await fs.readFile(evidenceBinaryPath);
      preparedExecutablePath = evidenceBinaryPath;
      preparedBinary = Object.freeze({
        path: evidenceBinaryDescriptorPath,
        sha256: sha256(evidenceBinary),
        bytes: evidenceBinary.length,
      });
    }
    const capabilityCommand = Object.freeze({
      bin: process.execPath,
      args: Object.freeze(["-e", "process.stdout.write('williams-job-runner-ready')"]),
      cwd: path.dirname(WINDOWS_JOB_RUNNER_SOURCE_PATH),
    });
    const prepared = {
      ...compiled,
      executablePath: preparedExecutablePath,
      binary: preparedBinary,
      status: "available",
    };
    const probeResult = await runFn(
      capabilityCommand,
      {
        preparedRunner: prepared,
        cwd: capabilityCommand.cwd,
        stdoutPath: path.join(evidenceDirectory, "capability.stdout.log"),
        stderrPath: path.join(evidenceDirectory, "capability.stderr.log"),
        evidencePath: path.join(evidenceDirectory, "capability.job.json"),
        timeoutMs: 10_000,
      },
    );
    if (probeResult.containmentStatus !== "available" || probeResult.exitCode !== 0) {
      await compiled.cleanup();
      return Object.freeze({
        status: "capability-error",
        error: probeResult.error || `probe exit ${probeResult.exitCode}`,
        probeResult,
      });
    }
    return Object.freeze({
      ...prepared,
      compiledAt: compiled.compiledAt,
      capabilityProbedAt: new Date().toISOString(),
      capabilityCommand,
      capabilityEvidence: probeResult.jobEvidence,
      capabilityEvidencePath: probeResult.jobEvidencePath,
    });
  } catch (error) {
    await compiled.cleanup();
    return Object.freeze({ status: "ready-error", error: String(error?.stack || error?.message || error) });
  }
}
