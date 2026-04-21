#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_SCENARIOS = ["blank_base", "tno_1962", "hoi4_1939"];
const DEFAULT_GATE_SCENARIOS = ["tno_1962", "hoi4_1939"];
const DEFAULT_BASELINE_JSON = path.join(REPO_ROOT, "docs", "perf", "baseline_2026-04-20.json");
const DEFAULT_BASELINE_MD = path.join(REPO_ROOT, "docs", "perf", "baseline_2026-04-20.md");
const DEFAULT_RAW_DIR = path.join(REPO_ROOT, ".runtime", "output", "perf", "baseline_2026-04-20");
const ACTIVE_SERVER_PATH = path.join(REPO_ROOT, ".runtime", "dev", "active_server.json");
const DEV_SERVER_OUT = path.join(REPO_ROOT, ".runtime", "tmp", "perf-baseline-dev-server.out.log");
const DEV_SERVER_ERR = path.join(REPO_ROOT, ".runtime", "tmp", "perf-baseline-dev-server.err.log");
const PERF_URL_QUERY = Object.freeze({
  render_profile: "balanced",
  startup_interaction: "full",
  startup_worker: 1,
  startup_cache: 0,
  perf: 1,
});
const GATE_METRICS = Object.freeze([
  { key: "totalStartupMs", label: "totalStartupMs" },
  { key: "scenarioAppliedMs", label: "scenarioAppliedMs" },
  { key: "applyScenarioBundleMs", label: "applyScenarioBundleMs" },
  { key: "refreshScenarioApplyMs", label: "refreshScenarioApplyMs" },
  { key: "renderSampleMedianMs", label: "renderSampleMedianMs", threshold: 1.25 },
]);
const SCENARIO_MANIFEST_MAP = Object.fromEntries(
  DEFAULT_SCENARIOS.map((scenarioId) => [
    scenarioId,
    path.join(REPO_ROOT, "data", "scenarios", scenarioId, "manifest.json"),
  ]),
);

function parseArgs(argv) {
  const options = {
    mode: "baseline",
    scenarios: [...DEFAULT_SCENARIOS],
    runs: 5,
    warmups: 1,
    threshold: 1.15,
    baselineJson: DEFAULT_BASELINE_JSON,
    baselineMd: DEFAULT_BASELINE_MD,
    rawDir: DEFAULT_RAW_DIR,
    writeMarkdown: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--mode" && next) {
      options.mode = String(next).trim();
      index += 1;
    } else if (token === "--scenarios" && next) {
      options.scenarios = String(next).split(",").map((value) => value.trim()).filter(Boolean);
      index += 1;
    } else if (token === "--runs" && next) {
      options.runs = Math.max(1, Number(next) || 1);
      index += 1;
    } else if (token === "--warmups" && next) {
      options.warmups = Math.max(0, Number(next) || 0);
      index += 1;
    } else if (token === "--threshold" && next) {
      options.threshold = Math.max(1, Number(next) || 1.15);
      index += 1;
    } else if (token === "--baseline-json" && next) {
      options.baselineJson = path.resolve(REPO_ROOT, next);
      index += 1;
    } else if (token === "--baseline-md" && next) {
      options.baselineMd = path.resolve(REPO_ROOT, next);
      index += 1;
    } else if (token === "--raw-dir" && next) {
      options.rawDir = path.resolve(REPO_ROOT, next);
      index += 1;
    } else if (token === "--write-markdown" && next) {
      options.writeMarkdown = ["1", "true", "yes"].includes(String(next).trim().toLowerCase());
      index += 1;
    }
  }
  return options;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

async function readJsonStrict(filePath, label = "json payload") {
  let rawText = "";
  try {
    rawText = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`[perf-baseline] Unable to read ${label}: ${filePath}. ${String(error?.message || error)}`);
  }
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`[perf-baseline] Unable to parse ${label}: ${filePath}. ${String(error?.message || error)}`);
  }
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function probeUrl(baseUrl) {
  if (!baseUrl) {
    return false;
  }
  try {
    const response = await fetch(new URL("/app/", baseUrl), { method: "GET" });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

async function resolveExistingServerBaseUrl() {
  const metadata = await readJson(ACTIVE_SERVER_PATH, {});
  const baseUrl = String(metadata?.base_url || metadata?.url || "").trim();
  return (await probeUrl(baseUrl)) ? baseUrl : "";
}

function spawnDevServer() {
  const command = process.platform === "win32" ? "py" : "python3";
  const args = process.platform === "win32" ? ["-3", "tools/dev_server.py"] : ["tools/dev_server.py"];
  const env = {
    ...process.env,
    MAPCREATOR_OPEN_BROWSER: "0",
  };
  return Promise.all([
    ensureDir(path.dirname(DEV_SERVER_OUT)),
    ensureDir(path.dirname(DEV_SERVER_ERR)),
  ]).then(async () => {
    const outHandle = await fs.open(DEV_SERVER_OUT, "w");
    const errHandle = await fs.open(DEV_SERVER_ERR, "w");
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(outHandle.createWriteStream());
    child.stderr.pipe(errHandle.createWriteStream());
    return { child, outHandle, errHandle };
  });
}

async function ensureServerBaseUrl() {
  const existingBaseUrl = await resolveExistingServerBaseUrl();
  if (existingBaseUrl) {
    return { baseUrl: existingBaseUrl, serverOwner: null };
  }
  const serverOwner = await spawnDevServer();
  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 45_000) {
      const nextBaseUrl = await resolveExistingServerBaseUrl();
      if (nextBaseUrl) {
        return { baseUrl: nextBaseUrl, serverOwner };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    await stopServer(serverOwner);
    throw error;
  }
  await stopServer(serverOwner);
  throw new Error("Dev server did not become ready within 45 seconds.");
}

async function stopServer(serverOwner) {
  if (!serverOwner) {
    return;
  }
  serverOwner.child.kill("SIGTERM");
  await Promise.allSettled([serverOwner.outHandle.close(), serverOwner.errHandle.close()]);
}

function buildScenarioUrl(baseUrl, scenarioId) {
  const url = new URL("/app/", baseUrl);
  for (const [key, value] of Object.entries(PERF_URL_QUERY)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("default_scenario", scenarioId);
  return url.toString();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function median(values) {
  const numbers = values.map((value) => finiteNumber(value, NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  return numbers.length ? numbers[Math.floor(numbers.length / 2)] : 0;
}

function metricAtMs(metric, bootTotal) {
  if (!metric || typeof metric !== "object") {
    return 0;
  }
  if (Number.isFinite(metric.atMs)) {
    return Number(metric.atMs);
  }
  const startedAt = finiteNumber(bootTotal?.startedAt, NaN);
  const finishedAt = finiteNumber(metric.finishedAt, NaN);
  if (Number.isFinite(startedAt) && Number.isFinite(finishedAt)) {
    return Math.max(0, finishedAt - startedAt);
  }
  return 0;
}

function summarizeSnapshot(snapshot) {
  const bootMetrics = snapshot?.bootMetrics && typeof snapshot.bootMetrics === "object" ? snapshot.bootMetrics : {};
  const renderPerfMetrics = snapshot?.renderPerfMetrics && typeof snapshot.renderPerfMetrics === "object" ? snapshot.renderPerfMetrics : {};
  const scenarioPerfMetrics = snapshot?.scenarioPerfMetrics && typeof snapshot.scenarioPerfMetrics === "object" ? snapshot.scenarioPerfMetrics : {};
  const renderSamples = snapshot?.renderSamples && typeof snapshot.renderSamples === "object" ? snapshot.renderSamples : {};
  const bootTotal = bootMetrics.total && typeof bootMetrics.total === "object" ? bootMetrics.total : {};
  return {
    totalStartupMs: finiteNumber(bootTotal.durationMs),
    topologyLoadedMs: metricAtMs(bootMetrics["base-data"], bootTotal),
    scenarioAppliedMs: metricAtMs(bootMetrics["scenario-apply"], bootTotal),
    firstInteractiveMs: metricAtMs(bootMetrics["time-to-interactive"], bootTotal),
    applyScenarioBundleMs: finiteNumber(scenarioPerfMetrics.applyScenarioBundle?.durationMs),
    refreshScenarioApplyMs: finiteNumber(renderPerfMetrics.scenarioApplyMapRefresh?.durationMs),
    refreshColorMs: finiteNumber(renderPerfMetrics.refreshColorState?.durationMs),
    rebuildPoliticalCollectionsMs: finiteNumber(renderPerfMetrics.rebuildPoliticalLandCollections?.durationMs),
    rebuildStaticMeshesMs: finiteNumber(renderPerfMetrics.rebuildStaticMeshes?.durationMs),
    invalidateBorderCacheMs: finiteNumber(renderPerfMetrics.invalidateBorderCache?.durationMs),
    renderSampleCount: finiteNumber(renderSamples.count),
    renderSampleTotalMs: finiteNumber(renderSamples.totalMs),
    renderSampleMedianMs: finiteNumber(renderSamples.medianMs),
  };
}

function normalizeScenarioId(value) {
  return String(value || "").trim();
}

function getScenarioSampleRole(scenarioId) {
  return DEFAULT_GATE_SCENARIOS.includes(scenarioId) ? "gate" : "observation";
}

function normalizeOsPlatform(value) {
  const label = String(value || "").trim();
  if (!label) {
    return "";
  }
  const [platformLabel = ""] = label.split(/\s+/, 1);
  return platformLabel.trim();
}

function parseNodeMajor(value) {
  const match = String(value || "").trim().match(/^v?(?<major>\d+)/);
  if (!match?.groups?.major) {
    return 0;
  }
  return finiteNumber(match.groups.major, 0);
}

function collectEnvironment() {
  return {
    os: `${os.platform()} ${os.release()}`,
    platform: os.platform(),
    release: os.release(),
    node: process.version,
    nodeMajor: parseNodeMajor(process.version),
    browser: "chromium-headless",
  };
}

function aggregateRuns(runs) {
  const summaries = runs.map((run) => run.summary || {});
  const fieldNames = [
    "totalStartupMs",
    "topologyLoadedMs",
    "scenarioAppliedMs",
    "firstInteractiveMs",
    "applyScenarioBundleMs",
    "refreshScenarioApplyMs",
    "refreshColorMs",
    "rebuildPoliticalCollectionsMs",
    "rebuildStaticMeshesMs",
    "invalidateBorderCacheMs",
    "renderSampleCount",
    "renderSampleTotalMs",
    "renderSampleMedianMs",
  ];
  const medianSummary = {};
  for (const fieldName of fieldNames) {
    medianSummary[fieldName] = median(summaries.map((summary) => summary[fieldName]));
  }
  return medianSummary;
}

async function readScenarioFeatureCount(scenarioId) {
  const manifest = await readJson(SCENARIO_MANIFEST_MAP[scenarioId], {});
  return finiteNumber(manifest?.summary?.feature_count);
}

async function measureOneRun(browser, baseUrl, scenarioId) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    const targetUrl = buildScenarioUrl(baseUrl, scenarioId);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await waitForPerfSnapshotReady(page, { timeoutMs: 120_000 });
    await page.waitForTimeout(300);
    const snapshot = await page.evaluate(() => globalThis.__mc_perf__?.snapshot?.() ?? null);
    if (!snapshot) {
      throw new Error("window.__mc_perf__.snapshot() returned null.");
    }
    const activeScenarioId = await page.evaluate(async () => {
      const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
      const stateModule = await import(stateModuleUrl);
      return String(stateModule?.state?.activeScenarioId || "").trim();
    });
    if (activeScenarioId !== normalizeScenarioId(scenarioId)) {
      throw new Error(
        `[perf-baseline] Scenario activation mismatch for ${scenarioId}: activeScenarioId=${activeScenarioId || "<empty>"}`
      );
    }
    return {
      url: targetUrl,
      activeScenarioId,
      snapshot,
      summary: summarizeSnapshot(snapshot),
    };
  } finally {
    await context.close();
  }
}

async function waitForPerfSnapshotReady(page, { timeoutMs = 120_000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await page.evaluate(async () => {
      const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
      const stateModule = await import(stateModuleUrl);
      const state = stateModule?.state || null;
      return {
        bootPhase: String(state?.bootPhase || ""),
        bootBlocking: state?.bootBlocking === false ? false : !!state?.bootBlocking,
        startupReadonlyUnlockInFlight: !!state?.startupReadonlyUnlockInFlight,
        scenarioApplyInFlight: !!state?.scenarioApplyInFlight,
        bootError: String(state?.bootError || ""),
      };
    });
    if (snapshot.bootError) {
      throw new Error(`[perf-baseline] bootError=${snapshot.bootError}`);
    }
    if (
      snapshot.bootPhase === "ready"
      && snapshot.bootBlocking === false
      && !snapshot.startupReadonlyUnlockInFlight
      && !snapshot.scenarioApplyInFlight
    ) {
      return snapshot;
    }
    await page.waitForTimeout(500);
  }
  const finalSnapshot = await page.evaluate(async () => {
    const overlay = document.querySelector("#bootOverlay");
    const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
    const stateModule = await import(stateModuleUrl);
    const state = stateModule?.state || null;
    return {
      bootPhase: String(state?.bootPhase || ""),
      bootBlocking: state?.bootBlocking === false ? false : !!state?.bootBlocking,
      startupReadonlyUnlockInFlight: !!state?.startupReadonlyUnlockInFlight,
      scenarioApplyInFlight: !!state?.scenarioApplyInFlight,
      activeScenarioId: String(state?.activeScenarioId || ""),
      overlayHidden: !!overlay?.classList?.contains("hidden"),
      bootError: String(state?.bootError || ""),
    };
  });
  throw new Error(`[perf-baseline] app did not reach ready state in ${timeoutMs}ms: ${JSON.stringify(finalSnapshot)}`);
}

async function runScenarioSeries(browser, baseUrl, scenarioId, options) {
  const featureCount = await readScenarioFeatureCount(scenarioId);
  const scenarioDir = path.join(options.rawDir, scenarioId);
  await ensureDir(scenarioDir);
  const warmups = [];
  for (let index = 0; index < options.warmups; index += 1) {
    const run = await measureOneRun(browser, baseUrl, scenarioId);
    warmups.push(run.summary);
  }
  const runs = [];
  for (let index = 0; index < options.runs; index += 1) {
    const run = await measureOneRun(browser, baseUrl, scenarioId);
    const filePath = path.join(scenarioDir, `run-${String(index + 1).padStart(2, "0")}.json`);
    await writeJson(filePath, run);
    runs.push({
      ...run,
      rawPath: path.relative(REPO_ROOT, filePath).replaceAll("\\", "/"),
    });
  }
  return {
    scenarioId,
    sampleRole: getScenarioSampleRole(scenarioId),
    featureCount,
    warmups,
    runs,
    summary: aggregateRuns(runs),
  };
}

function formatMetricRow(label, value) {
  return `- ${label}: ${finiteNumber(value).toFixed(1)} ms`;
}

function buildMarkdown(report) {
  const gateScenarios = DEFAULT_GATE_SCENARIOS.join(", ");
  const observationScenarios = DEFAULT_SCENARIOS
    .filter((scenarioId) => !DEFAULT_GATE_SCENARIOS.includes(scenarioId))
    .join(", ");
  const lines = [
    "# Perf baseline 2026-04-20",
    "",
    "## Environment",
    `- Generated at: ${report.generatedAt}`,
    `- Git HEAD: ${report.gitHead}`,
    `- OS: ${report.environment.os}`,
    `- Node: ${report.environment.node}`,
    `- Browser: ${report.environment.browser}`,
    `- Gate scenarios: ${gateScenarios}`,
    `- Observation samples: ${observationScenarios}`,
    "",
  ];
  for (const scenarioId of Object.keys(report.scenarios)) {
    const entry = report.scenarios[scenarioId];
    const summary = entry.summary || {};
    lines.push(`## Scenario: ${scenarioId}`);
    lines.push(`- sample_role: ${String(entry.sampleRole || getScenarioSampleRole(scenarioId))}`);
    lines.push(`- Runs: ${entry.runs.length}`);
    lines.push(`- feature_count: ${entry.featureCount}`);
    lines.push(formatMetricRow("Total startup", summary.totalStartupMs));
    lines.push(formatMetricRow("Topology loaded", summary.topologyLoadedMs));
    lines.push(formatMetricRow("Scenario applied", summary.scenarioAppliedMs));
    lines.push(formatMetricRow("First interactive", summary.firstInteractiveMs));
    lines.push(formatMetricRow("applyScenarioBundle", summary.applyScenarioBundleMs));
    lines.push(formatMetricRow("refresh scenario apply", summary.refreshScenarioApplyMs));
    lines.push(formatMetricRow("refresh color", summary.refreshColorMs));
    lines.push(formatMetricRow("rebuild political collections", summary.rebuildPoliticalCollectionsMs));
    lines.push(formatMetricRow("rebuild static meshes", summary.rebuildStaticMeshesMs));
    lines.push(formatMetricRow("invalidate border cache", summary.invalidateBorderCacheMs));
    lines.push(`- render samples: ${finiteNumber(summary.renderSampleCount).toFixed(0)} calls / ${finiteNumber(summary.renderSampleTotalMs).toFixed(1)} ms total / ${finiteNumber(summary.renderSampleMedianMs).toFixed(1)} ms median`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function resolveGitHead() {
  try {
    const { execFile } = await import("node:child_process");
    return await new Promise((resolve) => {
      execFile("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT }, (error, stdout) => {
        resolve(error ? "" : String(stdout || "").trim());
      });
    });
  } catch (_error) {
    return "";
  }
}

async function runMeasurements(options) {
  const { baseUrl, serverOwner } = await ensureServerBaseUrl();
  const browser = await chromium.launch({ headless: true });
  try {
    const scenarios = {};
    for (const scenarioId of options.scenarios) {
      scenarios[scenarioId] = await runScenarioSeries(browser, baseUrl, scenarioId, options);
    }
    return { baseUrl, scenarios };
  } finally {
    await browser.close();
    await stopServer(serverOwner);
  }
}

async function writeBaselineArtifacts(options, report) {
  await writeJson(options.baselineJson, report);
  if (options.writeMarkdown) {
    await ensureDir(path.dirname(options.baselineMd));
    await fs.writeFile(options.baselineMd, buildMarkdown(report), "utf8");
  }
}

function compareAgainstBaseline(currentReport, baselineReport, threshold) {
  const failures = [];
  for (const scenarioId of Object.keys(currentReport.scenarios)) {
    const currentSummary = currentReport.scenarios[scenarioId]?.summary || {};
    const baselineSummary = baselineReport?.scenarios?.[scenarioId]?.summary || {};
    for (const metric of GATE_METRICS) {
      const baselineValue = finiteNumber(baselineSummary?.[metric.key]);
      const currentValue = finiteNumber(currentSummary?.[metric.key]);
      if (baselineValue <= 0) {
        continue;
      }
      const allowedRatio = Number.isFinite(metric.threshold) ? metric.threshold : threshold;
      const limit = baselineValue * allowedRatio;
      if (currentValue > limit) {
        failures.push({
          scenarioId,
          metricKey: metric.key,
          allowedRatio,
          baselineValue,
          currentValue,
          limit,
        });
      }
    }
  }
  return failures;
}

function validateGateBaselineReport(baselineReport, scenarioIds, baselinePath) {
  if (!baselineReport || typeof baselineReport !== "object") {
    throw new Error(`[perf-baseline] Baseline report is invalid: ${baselinePath}`);
  }
  const baselineScenarios = baselineReport.scenarios;
  if (!baselineScenarios || typeof baselineScenarios !== "object") {
    throw new Error(`[perf-baseline] Baseline report misses scenarios map: ${baselinePath}`);
  }
  const missing = [];
  const invalid = [];
  for (const scenarioId of scenarioIds) {
    const summary = baselineScenarios?.[scenarioId]?.summary;
    if (!summary || typeof summary !== "object") {
      missing.push(scenarioId);
      continue;
    }
    const invalidMetrics = GATE_METRICS
      .map((metric) => metric.key)
      .filter((metricKey) => {
        const metricValue = Number(summary[metricKey]);
        return !(Number.isFinite(metricValue) && metricValue > 0);
      });
    if (invalidMetrics.length) {
      invalid.push(`${scenarioId}: ${invalidMetrics.join(", ")}`);
    }
  }
  if (missing.length) {
    throw new Error(
      `[perf-baseline] Baseline report misses required scenarios (${missing.join(", ")}): ${baselinePath}`
    );
  }
  if (invalid.length) {
    throw new Error(
      `[perf-baseline] Baseline report has invalid gate metrics for scenarios (${invalid.join("; ")}): ${baselinePath}`
    );
  }
}

function collectBaselineContractMismatches(currentReport, baselineReport) {
  const mismatches = [];
  const baselinePlatform = normalizeOsPlatform(
    baselineReport?.environment?.platform || baselineReport?.environment?.os
  );
  const currentPlatform = normalizeOsPlatform(
    currentReport?.environment?.platform || currentReport?.environment?.os
  );
  if (baselinePlatform && currentPlatform && baselinePlatform !== currentPlatform) {
    mismatches.push(`os platform mismatch: baseline=${baselinePlatform} current=${currentPlatform}`);
  }

  const baselineNodeMajor = parseNodeMajor(
    baselineReport?.environment?.nodeMajor || baselineReport?.environment?.node
  );
  const currentNodeMajor = parseNodeMajor(
    currentReport?.environment?.nodeMajor || currentReport?.environment?.node
  );
  if (baselineNodeMajor > 0 && currentNodeMajor > 0 && baselineNodeMajor !== currentNodeMajor) {
    mismatches.push(`node major mismatch: baseline=${baselineNodeMajor} current=${currentNodeMajor}`);
  }

  const baselineBrowser = String(baselineReport?.environment?.browser || "").trim();
  const currentBrowser = String(currentReport?.environment?.browser || "").trim();
  if (baselineBrowser && currentBrowser && baselineBrowser !== currentBrowser) {
    mismatches.push(`browser mismatch: baseline=${baselineBrowser} current=${currentBrowser}`);
  }

  const baselineQuery = baselineReport?.config?.urlQuery || {};
  const currentQuery = currentReport?.config?.urlQuery || {};
  if (JSON.stringify(baselineQuery) !== JSON.stringify(currentQuery)) {
    mismatches.push(
      `urlQuery mismatch: baseline=${JSON.stringify(baselineQuery)} current=${JSON.stringify(currentQuery)}`
    );
  }

  return mismatches;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await ensureDir(options.rawDir);
  const gitHead = await resolveGitHead();
  let baselineReportForGate = null;
  if (options.mode === "gate") {
    if (!(await pathExists(options.baselineJson))) {
      throw new Error(`[perf-baseline] Baseline report file does not exist: ${options.baselineJson}`);
    }
    baselineReportForGate = await readJsonStrict(options.baselineJson, "baseline report");
    validateGateBaselineReport(baselineReportForGate, options.scenarios, options.baselineJson);
  }

  const measurement = await runMeasurements(options);
  const report = {
    generatedAt: new Date().toISOString(),
    gitHead,
    mode: options.mode,
    baseUrl: measurement.baseUrl,
    config: {
      scenarios: options.scenarios,
      runs: options.runs,
      warmups: options.warmups,
      threshold: options.threshold,
      urlQuery: PERF_URL_QUERY,
    },
    environment: collectEnvironment(),
    scenarios: measurement.scenarios,
  };

  if (options.mode === "gate") {
    const contractMismatches = collectBaselineContractMismatches(report, baselineReportForGate);
    const failures = compareAgainstBaseline(report, baselineReportForGate, options.threshold);
    const gateReportPath = path.join(options.rawDir, "perf-gate-current.json");
    await writeJson(gateReportPath, { report, contractMismatches, failures });
    if (contractMismatches.length) {
      throw new Error(
        `Perf gate baseline contract mismatch.\n${contractMismatches.map((item) => `- ${item}`).join("\n")}`
      );
    }
    if (failures.length) {
      const message = failures
        .map(
          (failure) => `${failure.scenarioId}.${failure.metricKey}: current=${failure.currentValue.toFixed(1)}ms baseline=${failure.baselineValue.toFixed(1)}ms limit=${failure.limit.toFixed(1)}ms ratio=${failure.allowedRatio.toFixed(2)}`
        )
        .join("\n");
      throw new Error(`Perf gate failed.\n${message}`);
    }
    console.log(`Perf gate passed against ${path.relative(REPO_ROOT, options.baselineJson)}`);
    return;
  }

  await writeBaselineArtifacts(options, report);
  console.log(`Baseline written to ${path.relative(REPO_ROOT, options.baselineJson)}`);
  if (options.writeMarkdown) {
    console.log(`Markdown written to ${path.relative(REPO_ROOT, options.baselineMd)}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
