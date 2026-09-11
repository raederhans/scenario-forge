import os from "node:os";
import { spawnSync } from "node:child_process";
import process from "node:process";

export const STANDARD_PERF_ADMISSION_EXIT_CODES = Object.freeze({
  accepted: 0,
  gateFailure: 1,
  admissionRejected: 3,
});

export const STANDARD_PERF_GENERATION_FENCE_POLICY_ID = "standard-perf-generation-fence-v1";

export const STANDARD_PERF_ADMISSION_POLICY = Object.freeze({
  policyId: "standard-perf-admission-v1",
  sampleCount: 7,
  sampleIntervalMs: 1000,
  cpuAverageMaxPercent: 20,
  cpuPeakMaxPercent: 35,
  topProcessSingleCoreMaxPercent: 25,
  memoryAvailableMinMiB: 4096,
});

export const STANDARD_PERF_DIRTY_RULES = Object.freeze({
  runtimePrefixes: Object.freeze(["js/", "css/", "vendor/", "data/"]),
  runtimeFiles: Object.freeze(["index.html"]),
  harnessPrefixes: Object.freeze(["tools/perf/", "tests/e2e/support/", "docs/perf/baseline_"]),
  harnessFiles: Object.freeze([
    "tools/dev_server.py",
    "package.json",
    "package-lock.json",
    "requirements-perf.lock.txt",
    "playwright.config.cjs",
  ]),
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function normalizeRepoPath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized
    || normalized.startsWith("/")
    || /^[a-z]:/i.test(normalized)
    || normalized.split("/").includes("..")
  ) {
    return "";
  }
  return normalized;
}

function pathMatches(pathValue, candidate, platform) {
  if (platform === "win32") {
    return pathValue.toLowerCase() === candidate.toLowerCase();
  }
  return pathValue === candidate;
}

function pathStartsWith(pathValue, candidate, platform) {
  if (platform === "win32") {
    return pathValue.toLowerCase().startsWith(candidate.toLowerCase());
  }
  return pathValue.startsWith(candidate);
}

export function parseGitPorcelainZ(text, { platform = process.platform } = {}) {
  const fields = String(text || "").split("\0");
  if (fields.at(-1) === "") fields.pop();
  const entries = [];
  for (let index = 0; index < fields.length; index += 1) {
    const raw = fields[index];
    if (raw.length < 4 || raw[2] !== " ") {
      entries.push(deepFreeze({ status: "!!", paths: [raw], malformed: true }));
      continue;
    }
    const status = raw.slice(0, 2);
    const paths = [raw.slice(3)];
    const requiresPair = status.includes("R") || status.includes("C");
    if (requiresPair) {
      if (index + 1 >= fields.length) {
        entries.push(deepFreeze({ status, paths, platform, malformed: true }));
        continue;
      }
      paths.push(fields[index + 1]);
      index += 1;
    }
    entries.push(deepFreeze({ status, paths, platform, malformed: false }));
  }
  return Object.freeze(entries);
}

export function classifyPerfDirtyPaths(
  entries,
  { platform = process.platform, rules = STANDARD_PERF_DIRTY_RULES } = {},
) {
  const runtimePaths = new Set();
  const harnessPaths = new Set();
  const allowedPaths = new Set();
  const invalidPaths = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const rawPath of Array.isArray(entry?.paths) ? entry.paths : []) {
      const normalized = normalizeRepoPath(rawPath);
      if (!normalized || entry?.malformed) {
        invalidPaths.add(String(rawPath || ""));
        continue;
      }
      const runtimeMatch = rules.runtimeFiles.some((candidate) => pathMatches(normalized, candidate, platform))
        || rules.runtimePrefixes.some((candidate) => pathStartsWith(normalized, candidate, platform));
      const harnessMatch = rules.harnessFiles.some((candidate) => pathMatches(normalized, candidate, platform))
        || rules.harnessPrefixes.some((candidate) => pathStartsWith(normalized, candidate, platform));
      if (runtimeMatch) runtimePaths.add(normalized);
      else if (harnessMatch) harnessPaths.add(normalized);
      else allowedPaths.add(normalized);
    }
  }
  return deepFreeze({
    runtimePaths: [...runtimePaths].sort(),
    harnessPaths: [...harnessPaths].sort(),
    allowedPaths: [...allowedPaths].sort(),
    invalidPaths: [...invalidPaths].sort(),
  });
}

function roundOne(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function summarizePerfAdmissionCpu(samples) {
  const values = Array.isArray(samples) ? [...samples] : [];
  const valid = values.length > 0 && values.every(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100,
  );
  if (!valid) {
    return deepFreeze({ valid: false, sampleCount: values.length, samples: values, averagePercent: null, peakPercent: null });
  }
  const normalizedValues = values.map(roundOne);
  const sorted = [...normalizedValues].sort((left, right) => left - right);
  return deepFreeze({
    valid: true,
    sampleCount: normalizedValues.length,
    samples: normalizedValues,
    averagePercent: roundOne(normalizedValues.reduce((sum, value) => sum + value, 0) / normalizedValues.length),
    peakPercent: roundOne(sorted.at(-1)),
  });
}

function failure(code, detail) {
  return deepFreeze({ code, detail: String(detail || "") });
}

export function buildStandardPerfAdmissionCollectionFailureEvidence(
  error,
  { platform = process.platform, startedAt = new Date().toISOString(), completedAt = new Date().toISOString() } = {},
) {
  const detail = String(error?.stack || error?.message || error || "standard perf admission collection failed");
  return deepFreeze({
    schemaVersion: 1,
    startedAt,
    completedAt,
    platform,
    cpuSamples: [],
    topProcesses: [],
    memoryAvailableMiB: null,
    power: {
      status: platform === "win32" ? "collection-error" : "not-applicable",
      activeSchemeGuid: "",
      activeSchemeName: "",
      acLineStatus: 255,
      detail,
    },
    git: {
      status: "collection-error",
      head: "",
      entries: [],
      detail,
    },
    degradedCapabilities: ["standard-perf-admission-collection"],
  });
}

export function evaluateStandardPerfAdmission(
  evidence,
  policy = STANDARD_PERF_ADMISSION_POLICY,
) {
  const degradedCapabilities = new Set(Array.isArray(evidence?.degradedCapabilities) ? evidence.degradedCapabilities : []);
  const cpu = summarizePerfAdmissionCpu(evidence?.cpuSamples);
  const rawTopProcesses = Array.isArray(evidence?.topProcesses) ? evidence.topProcesses : [];
  const topProcessEvidenceValid = rawTopProcesses.every((entry) => (
    Number.isInteger(entry?.pid)
    && entry.pid > 0
    && typeof entry?.name === "string"
    && typeof entry?.singleCorePercent === "number"
    && Number.isFinite(entry.singleCorePercent)
    && entry.singleCorePercent >= 0
  ));
  const topProcesses = rawTopProcesses
    .filter((entry) => (
      Number.isInteger(entry?.pid)
      && entry.pid > 0
      && typeof entry?.name === "string"
      && typeof entry?.singleCorePercent === "number"
      && Number.isFinite(entry.singleCorePercent)
      && entry.singleCorePercent >= 0
    ))
    .map((entry) => ({
      pid: entry.pid,
      name: entry.name,
      singleCorePercent: roundOne(entry.singleCorePercent),
    }))
    .sort((left, right) => right.singleCorePercent - left.singleCorePercent || left.pid - right.pid);
  const dirty = classifyPerfDirtyPaths(evidence?.git?.entries, { platform: evidence?.platform });
  const failures = [];
  if (!cpu.valid || cpu.sampleCount !== policy.sampleCount) {
    failures.push(failure("cpu-samples-invalid", `expected=${policy.sampleCount} actual=${cpu.sampleCount}`));
  } else {
    if (cpu.averagePercent > policy.cpuAverageMaxPercent) {
      failures.push(failure("cpu-average-high", `current=${cpu.averagePercent} limit=${policy.cpuAverageMaxPercent}`));
    }
    if (cpu.peakPercent > policy.cpuPeakMaxPercent) {
      failures.push(failure("cpu-peak-high", `current=${cpu.peakPercent} limit=${policy.cpuPeakMaxPercent}`));
    }
  }
  if (!topProcessEvidenceValid) {
    failures.push(failure("top-process-evidence-invalid", `entries=${rawTopProcesses.length}`));
  }
  if (evidence?.platform === "win32" && degradedCapabilities.has("windows-processes")) {
    failures.push(failure("windows-process-evidence-unavailable", "Windows process snapshot collection failed"));
  }
  const topProcess = topProcesses[0] || null;
  if (topProcess && topProcess.singleCorePercent > policy.topProcessSingleCoreMaxPercent) {
    failures.push(failure(
      "top-process-high",
      `${topProcess.name || "unknown"}[${topProcess.pid}]=${topProcess.singleCorePercent} limit=${policy.topProcessSingleCoreMaxPercent}`,
    ));
  }
  const rawMemoryAvailableMiB = evidence?.memoryAvailableMiB;
  const memoryAvailableMiB = typeof rawMemoryAvailableMiB === "number" && Number.isFinite(rawMemoryAvailableMiB)
    ? roundOne(rawMemoryAvailableMiB)
    : null;
  if (memoryAvailableMiB === null) {
    failures.push(failure("memory-available-invalid", `current=${JSON.stringify(rawMemoryAvailableMiB)}`));
  } else if (memoryAvailableMiB < policy.memoryAvailableMinMiB) {
    failures.push(failure("memory-available-low", `current=${memoryAvailableMiB} limit=${policy.memoryAvailableMinMiB}`));
  }
  const powerStatus = String(evidence?.power?.status || "");
  const powerSchemeGuid = String(evidence?.power?.activeSchemeGuid || "").trim().toLowerCase();
  const acLineStatus = evidence?.power?.acLineStatus;
  if (evidence?.platform === "win32") {
    if (powerStatus !== "available") {
      failures.push(failure("windows-power-evidence-unavailable", `status=${powerStatus || "missing"}`));
    } else {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(powerSchemeGuid)) {
        failures.push(failure("power-scheme-invalid", `guid=${powerSchemeGuid || "<missing>"}`));
      }
      if (acLineStatus === 0) {
        failures.push(failure("ac-power-required", "known battery-powered measurement window"));
      } else if (acLineStatus !== 1) {
        failures.push(failure("ac-power-evidence-invalid", `status=${JSON.stringify(acLineStatus)}`));
      }
    }
  }
  if (evidence?.git?.status !== "available") {
    failures.push(failure("git-status-unavailable", evidence?.git?.detail || "git status unavailable"));
  } else if (!/^[0-9a-f]{40,64}$/i.test(String(evidence?.git?.head || ""))) {
    failures.push(failure("git-head-invalid", `head=${String(evidence?.git?.head || "<missing>")}`));
  }
  if (dirty.invalidPaths.length) {
    failures.push(failure("dirty-path-evidence-invalid", dirty.invalidPaths.join(",")));
  }
  if (dirty.runtimePaths.length) {
    failures.push(failure("dirty-runtime-source", dirty.runtimePaths.join(",")));
  }
  if (dirty.harnessPaths.length) {
    failures.push(failure("dirty-measurement-harness", dirty.harnessPaths.join(",")));
  }

  if (!["available", "not-applicable"].includes(powerStatus)) {
    degradedCapabilities.add("windows-power");
  }
  const status = failures.length ? "rejected" : "admitted";
  return deepFreeze({
    schemaVersion: 1,
    policyId: policy.policyId,
    status,
    exitCode: status === "admitted"
      ? STANDARD_PERF_ADMISSION_EXIT_CODES.accepted
      : STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected,
    thresholds: { ...policy },
    startedAt: evidence?.startedAt || null,
    completedAt: evidence?.completedAt || null,
    platform: String(evidence?.platform || ""),
    cpu,
    topProcesses,
    memoryAvailableMiB,
    power: { ...(evidence?.power || {}) },
    git: {
      status: String(evidence?.git?.status || "missing"),
      head: String(evidence?.git?.head || "").trim().toLowerCase(),
      runtimePaths: dirty.runtimePaths,
      harnessPaths: dirty.harnessPaths,
      allowedPaths: dirty.allowedPaths,
      invalidPaths: dirty.invalidPaths,
    },
    failures,
    degradedCapabilities: [...degradedCapabilities].sort(),
  });
}

export function validateStandardPerfAdmissionDecision(
  decision,
  { expectedPlatform = "", expectedGitHead = "" } = {},
) {
  const reasons = [];
  const thresholdKeys = Object.keys(STANDARD_PERF_ADMISSION_POLICY);
  const thresholdsMatch = decision?.thresholds
    && typeof decision.thresholds === "object"
    && !Array.isArray(decision.thresholds)
    && Object.keys(decision.thresholds).length === thresholdKeys.length
    && thresholdKeys.every((key) => decision.thresholds[key] === STANDARD_PERF_ADMISSION_POLICY[key]);
  if (!thresholdsMatch) reasons.push("thresholds-mismatch");

  const cpu = summarizePerfAdmissionCpu(decision?.cpu?.samples);
  if (
    decision?.cpu?.valid !== true
    || !cpu.valid
    || cpu.sampleCount !== STANDARD_PERF_ADMISSION_POLICY.sampleCount
    || decision.cpu.sampleCount !== cpu.sampleCount
    || decision.cpu.averagePercent !== cpu.averagePercent
    || decision.cpu.peakPercent !== cpu.peakPercent
    || cpu.averagePercent > STANDARD_PERF_ADMISSION_POLICY.cpuAverageMaxPercent
    || cpu.peakPercent > STANDARD_PERF_ADMISSION_POLICY.cpuPeakMaxPercent
  ) reasons.push("cpu-evidence-invalid");

  const topProcesses = Array.isArray(decision?.topProcesses) ? decision.topProcesses : null;
  if (
    topProcesses === null
    || !topProcesses.every((entry) => (
      Number.isInteger(entry?.pid)
      && entry.pid > 0
      && typeof entry?.name === "string"
      && typeof entry?.singleCorePercent === "number"
      && Number.isFinite(entry.singleCorePercent)
      && entry.singleCorePercent >= 0
      && entry.singleCorePercent <= STANDARD_PERF_ADMISSION_POLICY.topProcessSingleCoreMaxPercent
    ))
  ) reasons.push("top-process-evidence-invalid");

  if (
    typeof decision?.memoryAvailableMiB !== "number"
    || !Number.isFinite(decision.memoryAvailableMiB)
    || decision.memoryAvailableMiB < STANDARD_PERF_ADMISSION_POLICY.memoryAvailableMinMiB
  ) reasons.push("memory-evidence-invalid");

  const decisionPlatform = String(decision?.platform || "").trim();
  const normalizedExpectedPlatform = String(expectedPlatform || "").trim();
  const platform = normalizedExpectedPlatform || decisionPlatform;
  if (!decisionPlatform || (normalizedExpectedPlatform && decisionPlatform !== normalizedExpectedPlatform)) {
    reasons.push("platform-evidence-invalid");
  }
  const degradedCapabilities = Array.isArray(decision?.degradedCapabilities)
    ? decision.degradedCapabilities
    : null;
  if (
    degradedCapabilities === null
    || degradedCapabilities.includes("windows-power")
    || degradedCapabilities.includes("windows-processes")
  ) reasons.push("critical-capability-degraded");

  const gitHead = String(decision?.git?.head || "").trim().toLowerCase();
  const normalizedExpectedGitHead = String(expectedGitHead || "").trim().toLowerCase();
  if (
    decision?.git?.status !== "available"
    || !/^[0-9a-f]{40,64}$/.test(gitHead)
    || (normalizedExpectedGitHead && gitHead !== normalizedExpectedGitHead)
    || !Array.isArray(decision?.git?.runtimePaths)
    || decision.git.runtimePaths.length !== 0
    || !Array.isArray(decision?.git?.harnessPaths)
    || decision.git.harnessPaths.length !== 0
    || !Array.isArray(decision?.git?.invalidPaths)
    || decision.git.invalidPaths.length !== 0
  ) reasons.push("git-evidence-invalid");

  const powerStatus = String(decision?.power?.status || "").trim();
  const powerSchemeGuid = String(decision?.power?.activeSchemeGuid || "").trim().toLowerCase();
  const powerValid = platform === "win32"
    ? powerStatus === "available"
      && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(powerSchemeGuid)
      && decision?.power?.acLineStatus === 1
    : powerStatus === "not-applicable" || powerStatus === "available";
  if (!powerValid) reasons.push("power-evidence-invalid");

  if (
    decision?.schemaVersion !== 1
    || decision?.policyId !== STANDARD_PERF_ADMISSION_POLICY.policyId
    || decision?.status !== "admitted"
    || decision?.exitCode !== STANDARD_PERF_ADMISSION_EXIT_CODES.accepted
    || !Array.isArray(decision?.failures)
    || decision.failures.length !== 0
  ) reasons.push("decision-envelope-invalid");

  return deepFreeze({
    valid: reasons.length === 0,
    reasons,
    identity: {
      platform,
      gitHead,
      powerStatus,
      powerSchemeGuid,
      acLineStatus: decision?.power?.acLineStatus,
    },
  });
}

export class PerfEnvironmentAdmissionError extends Error {
  constructor(decision) {
    const reasons = (decision?.failures || []).map((entry) => `${entry.code}: ${entry.detail}`).join("\n");
    super(`Perf environment admission rejected; rerun required.\n${reasons}`);
    this.name = "PerfEnvironmentAdmissionError";
    this.exitCode = STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected;
    this.decision = decision;
  }
}

function captureCpuTimes(osModule = os) {
  return osModule.cpus().reduce((summary, cpu) => {
    const times = cpu?.times || {};
    const idle = Number(times.idle) || 0;
    const total = Object.values(times).reduce((sum, value) => sum + (Number(value) || 0), 0);
    summary.idle += idle;
    summary.total += total;
    return summary;
  }, { idle: 0, total: 0 });
}

function cpuUtilizationBetween(before, after) {
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (!(total > 0) || idle < 0) return Number.NaN;
  return Math.max(0, Math.min(100, ((total - idle) / total) * 100));
}

function runJsonCommand(command, args, { cwd, spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(String(result.stderr || result.stdout || `exit ${result.status}`).trim());
  }
  return JSON.parse(String(result.stdout || "null"));
}

function collectWindowsProcessSnapshot({ cwd, spawnSyncFn = spawnSync } = {}) {
  const script = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)",
    "@(Get-Process -ErrorAction Stop | Where-Object { $null -ne $_.CPU } | Select-Object Id,ProcessName,CPU) | ConvertTo-Json -Depth 4 -Compress",
  ].join("; ");
  const payload = runJsonCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { cwd, spawnSyncFn });
  return Array.isArray(payload) ? payload : [payload].filter(Boolean);
}

function summarizeProcessDeltas(before, after, elapsedMs) {
  const beforeById = new Map(before.map((entry) => [Number(entry.Id), Number(entry.CPU)]));
  return after.flatMap((entry) => {
    const pid = Number(entry.Id);
    const initialCpu = beforeById.has(pid) ? beforeById.get(pid) : 0;
    const finalCpu = Number(entry.CPU);
    if (!Number.isFinite(initialCpu) || !Number.isFinite(finalCpu) || finalCpu < initialCpu || !(elapsedMs > 0)) return [];
    const singleCorePercent = ((finalCpu - initialCpu) * 1000 / elapsedMs) * 100;
    if (singleCorePercent <= 0.5) return [];
    return [{ pid, name: String(entry.ProcessName || ""), singleCorePercent: roundOne(singleCorePercent) }];
  }).sort((left, right) => right.singleCorePercent - left.singleCorePercent || left.pid - right.pid).slice(0, 12);
}

function collectWindowsPowerEvidence({ cwd, spawnSyncFn = spawnSync } = {}) {
  const script = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)",
    "$powerText=(& powercfg /getactivescheme 2>&1 | Out-String).Trim()",
    "if($LASTEXITCODE -ne 0){throw $powerText}",
    "$guid=[regex]::Match($powerText,'[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}').Value.ToLowerInvariant()",
    "$name=[regex]::Match($powerText,'\\(([^)]+)\\)').Groups[1].Value.Trim()",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$line=[string][System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus",
    "$ac=if($line -eq 'Online'){1}elseif($line -eq 'Offline'){0}else{255}",
    "[pscustomobject]@{status='available';activeSchemeGuid=$guid;activeSchemeName=$name;acLineStatus=$ac}|ConvertTo-Json -Compress",
  ].join("; ");
  return runJsonCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { cwd, spawnSyncFn });
}

function collectGitEvidence({ cwd, spawnSyncFn = spawnSync, platform = process.platform } = {}) {
  try {
    const result = spawnSyncFn("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      return { status: "collection-error", entries: [], detail: String(result.error?.message || result.stderr || result.stdout || "git status failed") };
    }
    const headResult = spawnSyncFn("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    if (headResult.error || headResult.status !== 0) {
      return { status: "collection-error", entries: [], detail: String(headResult.error?.message || headResult.stderr || headResult.stdout || "git rev-parse failed") };
    }
    return {
      status: "available",
      head: String(headResult.stdout || "").trim().toLowerCase(),
      entries: parseGitPorcelainZ(result.stdout, { platform }),
      detail: "",
    };
  } catch (error) {
    return { status: "collection-error", entries: [], detail: String(error?.message || error || "git status failed") };
  }
}

export function collectStandardPerfStabilityEvidence({
  cwd = process.cwd(),
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  const degradedCapabilities = [];
  let power = { status: "not-applicable", activeSchemeGuid: "", activeSchemeName: "", acLineStatus: 255 };
  if (platform === "win32") {
    try {
      power = collectWindowsPowerEvidence({ cwd, spawnSyncFn });
    } catch (error) {
      power = { status: "collection-error", activeSchemeGuid: "", activeSchemeName: "", acLineStatus: 255, detail: String(error?.message || error) };
      degradedCapabilities.push("windows-power");
    }
  }
  return deepFreeze({
    schemaVersion: 1,
    collectedAt: new Date().toISOString(),
    platform,
    power,
    git: collectGitEvidence({ cwd, spawnSyncFn, platform }),
    degradedCapabilities,
  });
}

export function evaluateStandardPerfGenerationFence(
  admission,
  evidence,
  { baselineOracleBeforeSha256 = null, baselineOracleAfterSha256 = null } = {},
) {
  const failures = [];
  const dirty = classifyPerfDirtyPaths(evidence?.git?.entries, { platform: evidence?.platform });
  const admissionHead = String(admission?.git?.head || "").trim().toLowerCase();
  const currentHead = String(evidence?.git?.head || "").trim().toLowerCase();
  if (evidence?.git?.status !== "available") {
    failures.push(failure("git-status-unavailable", evidence?.git?.detail || "git status unavailable"));
  } else if (!/^[0-9a-f]{40,64}$/.test(currentHead)) {
    failures.push(failure("git-head-invalid", `head=${currentHead || "<missing>"}`));
  } else if (currentHead !== admissionHead) {
    failures.push(failure("git-head-changed", `before=${admissionHead || "<missing>"} after=${currentHead}`));
  }
  if (dirty.invalidPaths.length) failures.push(failure("dirty-path-evidence-invalid", dirty.invalidPaths.join(",")));
  if (dirty.runtimePaths.length) failures.push(failure("dirty-runtime-source", dirty.runtimePaths.join(",")));
  if (dirty.harnessPaths.length) failures.push(failure("dirty-measurement-harness", dirty.harnessPaths.join(",")));

  const powerStatus = String(evidence?.power?.status || "");
  const powerSchemeGuid = String(evidence?.power?.activeSchemeGuid || "").trim().toLowerCase();
  const admissionPowerSchemeGuid = String(admission?.power?.activeSchemeGuid || "").trim().toLowerCase();
  if (evidence?.platform === "win32") {
    if (powerStatus !== "available") {
      failures.push(failure("windows-power-evidence-unavailable", `status=${powerStatus || "missing"}`));
    } else if (powerSchemeGuid !== admissionPowerSchemeGuid) {
      failures.push(failure("power-scheme-changed", `before=${admissionPowerSchemeGuid || "<missing>"} after=${powerSchemeGuid || "<missing>"}`));
    }
    if (evidence?.power?.acLineStatus !== 1) {
      failures.push(failure("ac-power-evidence-invalid", `status=${JSON.stringify(evidence?.power?.acLineStatus)}`));
    }
  }

  const oracleBefore = String(baselineOracleBeforeSha256 || "").trim().toLowerCase();
  const oracleAfter = String(baselineOracleAfterSha256 || "").trim().toLowerCase();
  if ((oracleBefore || oracleAfter) && (!oracleBefore || !oracleAfter || oracleBefore !== oracleAfter)) {
    failures.push(failure("baseline-oracle-changed", `before=${oracleBefore || "<missing>"} after=${oracleAfter || "<missing>"}`));
  }

  const status = failures.length ? "rejected" : "stable";
  return deepFreeze({
    schemaVersion: 1,
    policyId: STANDARD_PERF_GENERATION_FENCE_POLICY_ID,
    status,
    exitCode: status === "stable"
      ? STANDARD_PERF_ADMISSION_EXIT_CODES.accepted
      : STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected,
    collectedAt: evidence?.collectedAt || null,
    platform: String(evidence?.platform || ""),
    git: {
      status: String(evidence?.git?.status || "missing"),
      head: currentHead,
      runtimePaths: dirty.runtimePaths,
      harnessPaths: dirty.harnessPaths,
      allowedPaths: dirty.allowedPaths,
      invalidPaths: dirty.invalidPaths,
    },
    power: { ...(evidence?.power || {}) },
    baselineOracle: {
      beforeSha256: oracleBefore || null,
      afterSha256: oracleAfter || null,
    },
    failures,
    degradedCapabilities: [...new Set(Array.isArray(evidence?.degradedCapabilities) ? evidence.degradedCapabilities : [])].sort(),
  });
}

export class PerfGenerationFenceError extends Error {
  constructor(decision) {
    const reasons = (decision?.failures || []).map((entry) => `${entry.code}: ${entry.detail}`).join("\n");
    super(`Perf generation fence rejected; rerun required.\n${reasons}`);
    this.name = "PerfGenerationFenceError";
    this.exitCode = STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected;
    this.decision = decision;
  }
}

export async function collectStandardPerfAdmissionEvidence({
  cwd = process.cwd(),
  platform = process.platform,
  osModule = os,
  spawnSyncFn = spawnSync,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  now = Date.now,
  collectProcessSnapshot = collectWindowsProcessSnapshot,
  collectStabilityEvidence = collectStandardPerfStabilityEvidence,
  policy = STANDARD_PERF_ADMISSION_POLICY,
} = {}) {
  const startedAt = new Date().toISOString();
  const degradedCapabilities = [];
  let processBefore = [];
  if (platform === "win32") {
    try {
      processBefore = collectProcessSnapshot({ cwd, spawnSyncFn });
      if (!processBefore.length) degradedCapabilities.push("windows-processes");
    } catch (_error) {
      degradedCapabilities.push("windows-processes");
    }
  } else {
    degradedCapabilities.push("process-snapshot-not-applicable");
  }

  const cpuSamples = [];
  let previousCpu = captureCpuTimes(osModule);
  const sampleStartedAt = now();
  for (let index = 0; index < policy.sampleCount; index += 1) {
    await sleep(policy.sampleIntervalMs);
    const currentCpu = captureCpuTimes(osModule);
    cpuSamples.push(cpuUtilizationBetween(previousCpu, currentCpu));
    previousCpu = currentCpu;
  }
  let topProcesses = [];
  if (platform === "win32" && processBefore.length) {
    try {
      const processAfter = collectProcessSnapshot({ cwd, spawnSyncFn });
      if (!processAfter.length) degradedCapabilities.push("windows-processes");
      const elapsedMs = Math.max(1, now() - sampleStartedAt);
      topProcesses = summarizeProcessDeltas(
        processBefore,
        processAfter,
        elapsedMs,
      );
    } catch (_error) {
      degradedCapabilities.push("windows-processes");
    }
  }

  const stability = collectStabilityEvidence({ cwd, platform, spawnSyncFn });
  degradedCapabilities.push(...stability.degradedCapabilities);

  return deepFreeze({
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    platform,
    cpuSamples,
    topProcesses,
    memoryAvailableMiB: osModule.freemem() / (1024 ** 2),
    power: stability.power,
    git: stability.git,
    degradedCapabilities: [...new Set(degradedCapabilities)].sort(),
  });
}
