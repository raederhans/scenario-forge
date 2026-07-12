#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CANONICAL_RENDER_SAMPLE_ROLE_ID,
  RENDER_SAMPLE_ROLE_POLICY_ID,
  analyzeRenderSampleRole,
  median,
} from "./render_sample_role_policy.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_SOURCE_REPORT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "p2-1-performance-ab-20260711.json");
const DEFAULT_EXPERIMENT_ROOT = path.join(REPO_ROOT, ".runtime", "output", "perf", "p2-1-acceptance", "20260711");
const DEFAULT_JSON_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "p2-1-performance-ab-governed-20260711.json");
const DEFAULT_MD_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "p2-1-performance-ab-governed-20260711.md");
const DEFAULT_EXPECTED_SOURCE_SHA256 = "f601896f26478ae9e023d97d0193e281cb8a0c3931fdcd8fa4bccebe03f4d839";
const BLOCK_SEQUENCE = Object.freeze(["A1", "B1", "B2", "A2"]);
const SCENARIOS = Object.freeze(["tno_1962", "hoi4_1939"]);
const EXPECTED_CANONICAL_MEDIANS = Object.freeze({
  tno_1962: Object.freeze({ A: 1197.9, B: 1195.35 }),
  hoi4_1939: Object.freeze({ A: 694.55, B: 694.8 }),
});
const THRESHOLDS = Object.freeze({
  startup: Object.freeze({ percent: 3, milliseconds: 75 }),
  render: Object.freeze({ percent: 5, milliseconds: 35 }),
  blockDrift: Object.freeze({ startupPercent: 5, renderPercent: 10 }),
  outlier: Object.freeze({ startupRatio: 1.25, startupMilliseconds: 250, renderRatio: 1.25, renderMilliseconds: 100 }),
  historical: Object.freeze({ startupRatio: 1.15, renderRatio: 1.25 }),
});

function parseArgs(argv) {
  const options = {
    sourceReport: DEFAULT_SOURCE_REPORT,
    experimentRoot: DEFAULT_EXPERIMENT_ROOT,
    jsonOut: DEFAULT_JSON_OUT,
    mdOut: DEFAULT_MD_OUT,
    expectedSourceSha256: DEFAULT_EXPECTED_SOURCE_SHA256,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--source-report" && next) {
      options.sourceReport = path.resolve(REPO_ROOT, next);
      index += 1;
    } else if (token === "--experiment-root" && next) {
      options.experimentRoot = path.resolve(REPO_ROOT, next);
      index += 1;
    } else if (token === "--json-out" && next) {
      options.jsonOut = path.resolve(REPO_ROOT, next);
      index += 1;
    } else if (token === "--md-out" && next) {
      options.mdOut = path.resolve(REPO_ROOT, next);
      index += 1;
    } else if (token === "--expected-source-sha256" && next) {
      options.expectedSourceSha256 = String(next).trim().toLowerCase();
      index += 1;
    }
  }
  return options;
}

function toRepoPath(filePath) {
  return path.relative(REPO_ROOT, filePath).replaceAll("\\", "/");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readJsonWithHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return { payload: JSON.parse(buffer.toString("utf8")), sha256: sha256(buffer) };
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildRawPerformanceMetricIntegrity(records) {
  const invalidRecords = [];
  for (const record of Array.isArray(records) ? records : []) {
    for (const metric of ["totalStartupMs", "canonicalRenderSampleMs"]) {
      const value = record?.[metric];
      if (!Number.isFinite(value) || value <= 0) {
        invalidRecords.push({
          block: record?.block ?? null,
          scenarioId: record?.scenarioId ?? null,
          runNumber: record?.runNumber ?? null,
          metric,
          value: value ?? null,
        });
      }
    }
  }
  return Object.freeze({ pass: invalidRecords.length === 0, invalidRecords: Object.freeze(invalidRecords) });
}

function percentDelta(current, baseline) {
  return baseline > 0 ? ((current - baseline) / baseline) * 100 : null;
}

function summarize(values) {
  const normalized = values.map(finite).filter((value) => value !== null).sort((left, right) => left - right);
  return {
    count: normalized.length,
    median: median(normalized),
    min: normalized.at(0) ?? null,
    max: normalized.at(-1) ?? null,
    values: normalized,
  };
}

function compareSides(aValues, bValues, threshold) {
  const a = summarize(aValues);
  const b = summarize(bValues);
  const deltaMs = b.median === null || a.median === null ? null : b.median - a.median;
  const deltaPercent = deltaMs === null ? null : percentDelta(b.median, a.median);
  const failed = deltaMs === null
    || deltaPercent === null
    || (deltaMs > threshold.milliseconds && deltaPercent > threshold.percent);
  return { a, b, deltaMs, deltaPercent, threshold, status: failed ? "fail" : "pass", failed };
}

function check(id, pass, detail) {
  return { id, status: pass ? "pass" : "fail", detail };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildIdentity(sourceReport) {
  const blocks = BLOCK_SEQUENCE.map((block) => sourceReport?.blocks?.[block] || {});
  const first = blocks[0] || {};
  const blockValidity = blocks.every((block) => (
    block.valid === true
    && Number(block.exitCode) === 0
    && Array.isArray(block.reasons)
    && block.reasons.length === 0
    && Array.isArray(block.quietAttempts)
    && block.quietAttempts.some((attempt) => attempt?.pass === true)
    && (block.listenersAfter?.port8000?.length || 0) === 0
    && (block.listenersAfter?.port8892?.length || 0) === 0
    && (block.taskOwnedChromiumAfter?.length || 0) === 0
  ));
  const runnerHashes = blocks.map((block) => String(block.runnerSha256 || ""));
  const lockHashes = blocks.map((block) => String(block.packageLockSha256 || ""));
  const queryIdentities = blocks.map((block) => stableStringify(block.urlQuery || {}));
  const workloadIdentities = blocks.map((block) => stableStringify(block.workloadIdentity || {}));
  const environmentIdentities = blocks.map((block) => stableStringify(block.environment || {}));
  const same = (values) => values.length > 0 && values.every((value) => value && value === values[0]);
  const headIdentity = blocks.every((block) => (
    block.headMatches === true
    && block.head === block.expectedHead
    && block.side === (String(block.block || "").startsWith("A") ? "A" : "B")
  ));
  const identityPass = blockValidity
    && headIdentity
    && same(runnerHashes)
    && same(lockHashes)
    && same(queryIdentities)
    && same(workloadIdentities)
    && same(environmentIdentities);
  return {
    pass: identityPass,
    blockValidity,
    headIdentity,
    controlCommit: sourceReport?.experiment?.controlCommit || "",
    candidateCommit: sourceReport?.experiment?.candidateCommit || "",
    runnerSha256: runnerHashes[0] || "",
    packageLockSha256: lockHashes[0] || "",
    urlQuery: first.urlQuery || {},
    workloadIdentity: first.workloadIdentity || {},
    environment: first.environment || {},
    runnerIdentityMatch: same(runnerHashes),
    lockIdentityMatch: same(lockHashes),
    queryIdentityMatch: same(queryIdentities),
    workloadIdentityMatch: same(workloadIdentities),
    environmentIdentityMatch: same(environmentIdentities),
  };
}

function buildStrata(records, scenarioId) {
  const result = {};
  for (const role of ["blank", "scenario"]) {
    const roleRecords = records.filter((record) => record.scenarioId === scenarioId && record.role.firstRole.role === role);
    result[role] = {
      A: summarize(roleRecords.filter((record) => record.side === "A").map((record) => record.canonicalRenderSampleMs)),
      B: summarize(roleRecords.filter((record) => record.side === "B").map((record) => record.canonicalRenderSampleMs)),
    };
  }
  return result;
}

function buildBlockSummary(records, scenarioId, block) {
  const selected = records.filter((record) => record.scenarioId === scenarioId && record.block === block);
  return {
    startup: summarize(selected.map((record) => record.totalStartupMs)),
    legacyRender: summarize(selected.map((record) => record.legacyRenderSampleMedianMs)),
    canonicalRender: summarize(selected.map((record) => record.canonicalRenderSampleMs)),
  };
}

function buildBlockDrift(byBlock, scenarioId) {
  const scenario = byBlock[scenarioId];
  const sideDrift = (firstBlock, secondBlock) => ({
    startupPercent: percentDelta(scenario[secondBlock].startup.median, scenario[firstBlock].startup.median),
    canonicalRenderPercent: percentDelta(scenario[secondBlock].canonicalRender.median, scenario[firstBlock].canonicalRender.median),
  });
  const A = sideDrift("A1", "A2");
  const B = sideDrift("B1", "B2");
  const pass = [A, B].every((entry) => (
    Math.abs(entry.startupPercent) <= THRESHOLDS.blockDrift.startupPercent
    && Math.abs(entry.canonicalRenderPercent) <= THRESHOLDS.blockDrift.renderPercent
  ));
  return { scenarioId, A, B, thresholds: THRESHOLDS.blockDrift, status: pass ? "pass" : "fail", pass };
}

function buildOutlierCheck(records) {
  const outliers = [];
  for (const scenarioId of SCENARIOS) {
    const scenarioRecords = records.filter((record) => record.scenarioId === scenarioId);
    const a = scenarioRecords.filter((record) => record.side === "A");
    const b = scenarioRecords.filter((record) => record.side === "B");
    for (const [metric, ratio, milliseconds] of [
      ["totalStartupMs", THRESHOLDS.outlier.startupRatio, THRESHOLDS.outlier.startupMilliseconds],
      ["canonicalRenderSampleMs", THRESHOLDS.outlier.renderRatio, THRESHOLDS.outlier.renderMilliseconds],
    ]) {
      const aMedian = median(a.map((record) => record[metric]));
      const bMedian = median(b.map((record) => record[metric]));
      for (const record of scenarioRecords) {
        const oppositeMedian = record.side === "A" ? bMedian : aMedian;
        const value = record[metric];
        if (value > oppositeMedian * ratio && value - oppositeMedian > milliseconds) {
          outliers.push({ block: record.block, scenarioId, runNumber: record.runNumber, metric, value, oppositeMedian });
        }
      }
    }
  }
  return { status: outliers.length ? "fail" : "pass", outliers, thresholds: THRESHOLDS.outlier };
}

function buildDirectionCheck(byBlock) {
  const vetoes = [];
  for (const scenarioId of SCENARIOS) {
    for (const [metric, threshold] of [["startup", THRESHOLDS.startup], ["canonicalRender", THRESHOLDS.render]]) {
      const firstDelta = byBlock[scenarioId].B1[metric].median - byBlock[scenarioId].A1[metric].median;
      const secondDelta = byBlock[scenarioId].B2[metric].median - byBlock[scenarioId].A2[metric].median;
      const firstBeyond = Math.abs(firstDelta) > threshold.milliseconds;
      const secondBeyond = Math.abs(secondDelta) > threshold.milliseconds;
      if (firstBeyond && secondBeyond && Math.sign(firstDelta) !== Math.sign(secondDelta)) {
        vetoes.push({ scenarioId, metric, firstDelta, secondDelta, threshold });
      }
    }
  }
  return { status: vetoes.length ? "fail" : "pass", vetoes };
}

export function evaluateGovernedDecision(checks) {
  const failedChecks = checks.filter((entry) => entry.status === "fail").map((entry) => entry.id);
  return {
    status: failedChecks.length ? "blocked-rerun-required" : "accepted-with-governed-reanalysis",
    admitted: failedChecks.length === 0,
    failedChecks,
    reason: failedChecks.length
      ? `Governed reanalysis failed closed: ${failedChecks.join(", ")}`
      : "Canonical post-promotion render roles match across all runs and all governed A/B checks pass.",
  };
}

export async function buildGovernedCompanionReport({
  sourceReportPath = DEFAULT_SOURCE_REPORT,
  experimentRoot = DEFAULT_EXPERIMENT_ROOT,
  expectedSourceSha256 = DEFAULT_EXPECTED_SOURCE_SHA256,
} = {}) {
  const source = await readJsonWithHash(sourceReportPath);
  const rawFiles = [];
  const records = [];
  for (const block of BLOCK_SEQUENCE) {
    const side = block.startsWith("A") ? "A" : "B";
    for (const scenarioId of SCENARIOS) {
      for (let runNumber = 1; runNumber <= 5; runNumber += 1) {
        const filePath = path.join(experimentRoot, side, block, "raw", scenarioId, `run-${String(runNumber).padStart(2, "0")}.json`);
        const raw = await readJsonWithHash(filePath);
        const role = analyzeRenderSampleRole({ scenarioId, snapshot: raw.payload.snapshot, summary: raw.payload.summary });
        rawFiles.push({ path: toRepoPath(filePath), sha256: raw.sha256 });
        records.push({
          block,
          side,
          scenarioId,
          runNumber,
          rawPath: toRepoPath(filePath),
          rawSha256: raw.sha256,
          totalStartupMs: finite(raw.payload?.summary?.totalStartupMs),
          legacyRenderSampleMedianMs: finite(raw.payload?.summary?.renderSampleMedianMs),
          canonicalRenderSampleMs: role.canonicalRenderSampleMs,
          promotionDurationMs: finite(raw.payload?.summary?.scenarioChunkPromotionVisualStageMs),
          role,
        });
      }
    }
  }

  const identity = buildIdentity(source.payload);
  const roleMismatches = records
    .filter((record) => !record.role.roleMatched)
    .map((record) => ({ block: record.block, scenarioId: record.scenarioId, runNumber: record.runNumber, mismatches: record.role.roleMismatches }));
  const byBlock = Object.fromEntries(SCENARIOS.map((scenarioId) => [
    scenarioId,
    Object.fromEntries(BLOCK_SEQUENCE.map((block) => [block, buildBlockSummary(records, scenarioId, block)])),
  ]));
  const canonicalComparisons = {};
  const startupComparisons = {};
  for (const scenarioId of SCENARIOS) {
    const scenarioRecords = records.filter((record) => record.scenarioId === scenarioId);
    const a = scenarioRecords.filter((record) => record.side === "A");
    const b = scenarioRecords.filter((record) => record.side === "B");
    startupComparisons[scenarioId] = compareSides(
      a.map((record) => record.totalStartupMs),
      b.map((record) => record.totalStartupMs),
      THRESHOLDS.startup
    );
    canonicalComparisons[scenarioId] = compareSides(
      a.map((record) => record.canonicalRenderSampleMs),
      b.map((record) => record.canonicalRenderSampleMs),
      THRESHOLDS.render
    );
  }
  const blockDrift = Object.fromEntries(SCENARIOS.map((scenarioId) => [scenarioId, buildBlockDrift(byBlock, scenarioId)]));
  const outlierCheck = buildOutlierCheck(records);
  const directionCheck = buildDirectionCheck(byBlock);
  const rawMetricIntegrity = buildRawPerformanceMetricIntegrity(records);
  const expectedCanonicalValuesPass = SCENARIOS.every((scenarioId) => (
    Math.abs(canonicalComparisons[scenarioId].a.median - EXPECTED_CANONICAL_MEDIANS[scenarioId].A) < 0.01
    && Math.abs(canonicalComparisons[scenarioId].b.median - EXPECTED_CANONICAL_MEDIANS[scenarioId].B) < 0.01
  ));
  const sourceLegacyDecision = source.payload?.decision || {};
  const checks = [
    check("source_report_sha", source.sha256 === expectedSourceSha256, { expected: expectedSourceSha256, actual: source.sha256 }),
    check("source_legacy_failure_preserved", sourceLegacyDecision.status === "failed/blocked" && sourceLegacyDecision.admitted === false, sourceLegacyDecision),
    check("block_validity_and_quiet_windows", identity.blockValidity, identity),
    check("runner_lock_query_workload_identity", identity.pass, identity),
    check(
      "raw_file_count_and_hashes",
      rawFiles.length === 40 && rawFiles.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)),
      { count: rawFiles.length, hashCount: rawFiles.filter((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)).length }
    ),
    check("render_sample_roles", roleMismatches.length === 0 && records.length === 40, { matches: records.length - roleMismatches.length, mismatches: roleMismatches }),
    check("raw_performance_metrics_complete", rawMetricIntegrity.pass, rawMetricIntegrity),
    check("expected_canonical_medians", expectedCanonicalValuesPass, { expected: EXPECTED_CANONICAL_MEDIANS, actual: canonicalComparisons }),
    check("startup_regression", Object.values(startupComparisons).every((comparison) => !comparison.failed), startupComparisons),
    check("canonical_render_regression", Object.values(canonicalComparisons).every((comparison) => !comparison.failed), canonicalComparisons),
    check("block_drift", Object.values(blockDrift).every((entry) => entry.pass), blockDrift),
    check("outlier_rules", outlierCheck.status === "pass", outlierCheck),
    check("opposite_direction_beyond_deadband", directionCheck.status === "pass", directionCheck),
    check("hoi4_promotion_gap", source.payload?.promotionClassification?.materialGap === false, {
      status: source.payload?.promotionClassification?.materialGap === false ? "not-applicable/pass" : "blocked-rerun-required",
      materialGap: source.payload?.promotionClassification?.materialGap,
      detail: "No material HOI4 promotion split exists, so promotion-stratified render admission is not applicable.",
    }),
  ];
  const legacyTnoComposition = {
    A: {
      blank: records.filter((record) => record.scenarioId === "tno_1962" && record.side === "A" && record.role.firstRole.role === "blank").length,
      scenario: records.filter((record) => record.scenarioId === "tno_1962" && record.side === "A" && record.role.firstRole.role === "scenario").length,
    },
    B: {
      blank: records.filter((record) => record.scenarioId === "tno_1962" && record.side === "B" && record.role.firstRole.role === "blank").length,
      scenario: records.filter((record) => record.scenarioId === "tno_1962" && record.side === "B" && record.role.firstRole.role === "scenario").length,
    },
  };

  return {
    schemaVersion: 1,
    reportId: "p2-1-performance-ab-governed-20260711",
    generatedFrom: source.payload?.generatedAt || null,
    policy: {
      policyId: RENDER_SAMPLE_ROLE_POLICY_ID,
      canonicalRoleId: CANONICAL_RENDER_SAMPLE_ROLE_ID,
      governedScenarios: SCENARIOS,
      predicates: [
        "renderSamples.count === 2",
        "sample sequences are [1, 2]",
        "canonical candidate is unique and samples.at(-1)",
        "activeScenarioId equals requested scenario",
        "phase is idle",
        "politicalBgProgressive is true",
        "contextScenarioMs is positive",
        "recordedAt is at or after scenarioChunkPromotionVisualStage.recordedAt",
      ],
      durationIndependent: true,
    },
    sourceReport: {
      path: toRepoPath(sourceReportPath),
      sha256: source.sha256,
      expectedSha256: expectedSourceSha256,
      legacyDecision: sourceLegacyDecision,
      preservedLegacyFailure: true,
    },
    experimentIdentity: identity,
    thresholds: THRESHOLDS,
    evidence: {
      rawFileCount: rawFiles.length,
      rawFiles,
      roleMatches: records.length - roleMismatches.length,
      roleMismatches,
    },
    legacyMetric: {
      name: "renderSampleMedianMs",
      status: "diagnostic-only",
      tnoFirstRoleComposition: legacyTnoComposition,
      originalPooledRegression: source.payload?.pooledRegressions || [],
    },
    canonicalMetric: {
      name: "canonicalRenderSampleMs",
      comparisons: canonicalComparisons,
      expectedMedians: EXPECTED_CANONICAL_MEDIANS,
    },
    startupComparisons,
    byBlock,
    blockDrift,
    strata: Object.fromEntries(SCENARIOS.map((scenarioId) => [scenarioId, buildStrata(records, scenarioId)])),
    roleAnalyses: records,
    outliers: outlierCheck,
    direction: directionCheck,
    hoi4PromotionGap: {
      status: source.payload?.promotionClassification?.materialGap === false ? "not-applicable/pass" : "blocked-rerun-required",
      materialGap: source.payload?.promotionClassification?.materialGap,
      source: source.payload?.promotionClassification || {},
    },
    checks,
    decision: evaluateGovernedDecision(checks),
    preregistration: {
      nextPhases: ["P2.2a", "P2.2b"],
      rolePolicyId: RENDER_SAMPLE_ROLE_POLICY_ID,
      canonicalRoleId: CANONICAL_RENDER_SAMPLE_ROLE_ID,
      experimentSequence: BLOCK_SEQUENCE,
      warmupsPerScenarioPerBlock: 3,
      measuredRunsPerScenarioPerBlock: 5,
      startupGate: THRESHOLDS.startup,
      renderGate: THRESHOLDS.render,
      blockDriftGate: THRESHOLDS.blockDrift,
    },
  };
}

export function buildMarkdown(report) {
  const formatMetric = (value, digits) => (
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "missing"
  );
  const lines = [
    "# P2.1 governed render-sample reanalysis",
    "",
    `- Decision: ${report.decision.status}`,
    `- Admitted: ${report.decision.admitted}`,
    `- Policy: ${report.policy.policyId}`,
    `- Canonical role: ${report.policy.canonicalRoleId}`,
    `- Source report SHA-256: ${report.sourceReport.sha256}`,
    `- Source legacy decision: ${report.sourceReport.legacyDecision.status}`,
    `- Raw evidence: ${report.evidence.rawFileCount} files / ${report.evidence.roleMatches} role matches / ${report.evidence.roleMismatches.length} mismatches`,
    "",
    "## Canonical comparisons",
  ];
  for (const scenarioId of SCENARIOS) {
    const comparison = report.canonicalMetric.comparisons[scenarioId];
    lines.push(`- ${scenarioId}: A=${formatMetric(comparison.a.median, 2)} ms, B=${formatMetric(comparison.b.median, 2)} ms, delta=${formatMetric(comparison.deltaMs, 2)} ms (${formatMetric(comparison.deltaPercent, 3)}%), ${comparison.status}`);
  }
  lines.push("", "## Legacy composition", `- TNO A: blank=${report.legacyMetric.tnoFirstRoleComposition.A.blank}, scenario=${report.legacyMetric.tnoFirstRoleComposition.A.scenario}`, `- TNO B: blank=${report.legacyMetric.tnoFirstRoleComposition.B.blank}, scenario=${report.legacyMetric.tnoFirstRoleComposition.B.scenario}`);
  lines.push("", "## Checks");
  for (const entry of report.checks) {
    lines.push(`- ${entry.id}: ${entry.status}`);
  }
  lines.push("", "## Interpretation", "The original pooled legacy-render failure remains preserved. The governed decision uses only the unique final post-promotion idle scenario frame from every measured run.", "");
  return `${lines.join("\n")}\n`;
}

async function writeReport(options, report) {
  await fs.mkdir(path.dirname(options.jsonOut), { recursive: true });
  await fs.mkdir(path.dirname(options.mdOut), { recursive: true });
  await fs.writeFile(options.jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(options.mdOut, buildMarkdown(report), "utf8");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await buildGovernedCompanionReport(options);
  await writeReport(options, report);
  console.log(`[perf-role-governance] ${report.decision.status}`);
  console.log(`[perf-role-governance] JSON: ${toRepoPath(options.jsonOut)}`);
  console.log(`[perf-role-governance] Markdown: ${toRepoPath(options.mdOut)}`);
  if (!report.decision.admitted) {
    process.exitCode = 2;
  }
  return report;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
  });
}
