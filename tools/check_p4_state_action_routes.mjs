import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildRecommendation,
  nonBehavioralClassification,
  normalizeChangedFiles,
} from "./select_verification_targets.mjs";
import { discoverChangedFiles } from "./run_adaptive_tests.mjs";
import { buildRouteIndex } from "./test_route_registry.mjs";
import { VERIFICATION_CATALOG_SOURCE_FILES } from "./verification/catalog/source_files.mjs";

export const P4_PHASE_EXPECTED_COMMANDS = Object.freeze({
  "P4.0": Object.freeze(["verify:p4:state-writer-policy"]),
  "P4.1": Object.freeze(["verify:p4:p4-1"]),
  "P4.2a": Object.freeze(["verify:p4:p4-2a"]),
  "P4.2b": Object.freeze(["verify:p4:p4-2b"]),
  "P4.2c": Object.freeze(["verify:p4:p4-2c"]),
  "P4.3": Object.freeze(["verify:p4:p4-3"]),
  "P4.4": Object.freeze(["verify:p4:p4-4"]),
  "P4.5a": Object.freeze(["verify:p4:p4-5a"]),
  "P4.5b": Object.freeze(["verify:p4:p4-5b"]),
});

const P4_SHARED_TOOLING_PATHS = new Set([
  "docs/active/_worktree_registry.md",
  "package.json",
  "package-lock.json",
  "tests/test_state_write_guardrail_contract.py",
  "tools/ai_test_supervisor/check_supervisor_schemas.mjs",
  "tools/ai_test_supervisor/domain_registry.json",
  "tools/eslint-rules/state-writer-allowlist.json",
  "tools/select_verification_targets.mjs",
  "tools/test_route_registry.mjs",
  "tools/verification/command_supersession.mjs",
  ...VERIFICATION_CATALOG_SOURCE_FILES,
  "tools/verification/verification_domains.mjs",
  "tools/verification/verification_metadata_helpers.mjs",
]);

function normalizeRepoPath(value) {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

function splitChangedFiles(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readChangedFileList(filePath) {
  if (!filePath) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function validatePhase(phase) {
  if (!phase) {
    throw new Error("P4 route verification requires an exact phase from P4.0 through P4.5b.");
  }
  if (!Object.hasOwn(P4_PHASE_EXPECTED_COMMANDS, phase)) {
    throw new Error(`Unsupported P4 phase: ${phase}`);
  }
  return phase;
}

export function defaultP4RouteReportPath(phase) {
  return path.join(
    ".runtime",
    "reports",
    "generated",
    "p4-state-actions",
    validatePhase(phase),
    "adaptive-selection.json",
  );
}

export function parseArgs(argv) {
  const args = {
    phase: null,
    changedFiles: [],
    includeBranchHistory: false,
    historyBase: "",
    allowEmpty: false,
    jsonOut: null,
    printJson: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--phase") args.phase = argv[++index];
    else if (token === "--changed-file") args.changedFiles.push(argv[++index]);
    else if (token === "--changed-files") args.changedFiles.push(...splitChangedFiles(argv[++index]));
    else if (token === "--changed-files-list") args.changedFiles.push(...readChangedFileList(argv[++index]));
    else if (token === "--include-branch-history") args.includeBranchHistory = true;
    else if (token === "--history-base") args.historyBase = String(argv[++index] || "").trim();
    else if (token === "--allow-empty") args.allowEmpty = true;
    else if (token === "--json-out") args.jsonOut = argv[++index];
    else if (token === "--json") args.printJson = true;
    else args.changedFiles.push(token);
  }
  args.phase = validatePhase(args.phase);
  if (args.includeBranchHistory && args.historyBase) {
    throw new Error("--include-branch-history and --history-base are mutually exclusive.");
  }
  args.changedFiles = args.changedFiles.filter(Boolean);
  args.jsonOut = args.jsonOut || defaultP4RouteReportPath(args.phase);
  return args;
}

export function isP4OwnedChangedFile(changedFile) {
  const normalized = normalizeRepoPath(changedFile);
  if (normalized.startsWith("js/")) return true;
  if (
    normalized.startsWith("tests/state_writer_")
    || normalized.startsWith("tests/p4_")
    || (
      normalized.startsWith("tests/")
      && normalized.includes("_actions_")
    )
    || normalized === "tests/test_state_write_guardrail_contract.py"
  ) return true;
  if (
    normalized.startsWith("tools/state_writer_")
    || normalized === "tools/state_action_delegation_contract.mjs"
    || normalized === "tools/build_state_writer_policy.mjs"
    || normalized === "tools/check_state_writer_policy.mjs"
    || normalized === "tools/check_p4_state_action_routes.mjs"
    || normalized === "tools/p4_state_action_phases.mjs"
    || normalized === "tools/run_p4_phase_verification.mjs"
    || normalized === "tools/run_p4_state_writer_policy_tests.mjs"
    || normalized === "tools/run_p4_state_write_boundary.mjs"
  ) return true;
  if (normalized.startsWith("css/") || normalized === "index.html") return true;
  if (P4_SHARED_TOOLING_PATHS.has(normalized)) return true;
  if (normalized.startsWith("docs/active/state-action-ownership-p4-")) return true;
  return false;
}

function routeSourceRefs(route) {
  return String(route?.sourceRef || "")
    .split(",")
    .map(normalizeRepoPath)
    .filter(Boolean);
}

function sourceRefDirectlyMatchesFile(sourceRef, changedFile) {
  if (sourceRef === changedFile) return true;
  const looksLikeFile = /\.[^/]+$/.test(sourceRef);
  return !looksLikeFile && changedFile.startsWith(`${sourceRef.replace(/\/$/, "")}/`);
}

function directStateOwnershipRoutesForFile(routes, changedFile) {
  return routes
    .filter((route) => route.domain === "state-ownership")
    .filter((route) => routeSourceRefs(route).some((sourceRef) => sourceRefDirectlyMatchesFile(sourceRef, changedFile)));
}

function perFileRecommendation(recommendation, changedFile) {
  return (recommendation.matchedByFile || [])
    .find((entry) => normalizeRepoPath(entry.changedFile) === changedFile)
    || {
      changedFile,
      matchedRouteIds: [],
      recommendedCommands: [],
    };
}

function routeWasRecommended(route, fileRecommendation) {
  return (fileRecommendation.recommendedCommands || []).some((entry) => (
    entry.commandRef === route.commandRef
    && (entry.domains || []).includes("state-ownership")
    && (entry.routeIds || []).includes(route.id)
  ));
}

function recommendedStateOwnershipCommands(fileRecommendation) {
  return [...new Set(
    (fileRecommendation.recommendedCommands || [])
      .filter((entry) => (entry.domains || []).includes("state-ownership"))
      .map((entry) => entry.commandRef),
  )].sort();
}

function toDirectRecommendation(route) {
  return {
    routeId: route.id,
    commandRef: route.commandRef,
    domain: route.domain,
    sourceRefs: routeSourceRefs(route),
  };
}

function createGap(changedFile, code, message, details = {}) {
  return {
    changedFile,
    code,
    message,
    ...details,
  };
}

export function buildP4StateActionRouteReport({
  phase,
  changedFiles,
  recommendation,
  routes,
  allowEmpty = false,
} = {}) {
  const normalizedPhase = validatePhase(phase);
  const expectedPhaseCommands = [...P4_PHASE_EXPECTED_COMMANDS[normalizedPhase]];
  const normalizedChangedFiles = normalizeChangedFiles(
    changedFiles?.length ? changedFiles : recommendation?.changedFiles || [],
  );
  const selectorUnmatchedChangedFiles = (recommendation?.unroutedChangedFiles || recommendation?.unmatchedChangedFiles || [])
    .map(normalizeRepoPath)
    .filter((file) => normalizedChangedFiles.includes(file));
  const nonBehavioralChangedFiles = normalizedChangedFiles
    .filter((file) => nonBehavioralClassification(file))
    .map((file) => ({
      changedFile: file,
      classification: nonBehavioralClassification(file),
      disposition: "no-app-behavior-validation",
      behaviorTestsRun: false,
    }));
  const unmatchedChangedFiles = selectorUnmatchedChangedFiles
    .filter((file) => !nonBehavioralClassification(file));
  const unmatchedSet = new Set(selectorUnmatchedChangedFiles);
  const routeGaps = normalizedChangedFiles.length === 0 && !allowEmpty
    ? [createGap(
      "",
      "no-changed-files",
      "P4 route verification requires an explicit changed-file set or branch history.",
    )]
    : [];
  routeGaps.push(...unmatchedChangedFiles.map((changedFile) => createGap(
    changedFile,
    "selector-unmatched-file",
    "The adaptive selector returned no route for this changed file.",
  )));

  const files = normalizedChangedFiles.map((changedFile) => {
    const p4Owned = isP4OwnedChangedFile(changedFile);
    const selectorEntry = perFileRecommendation(recommendation || {}, changedFile);
    const directRoutes = p4Owned
      ? directStateOwnershipRoutesForFile(routes || [], changedFile)
      : [];
    const recommendedDirectRoutes = directRoutes.filter((route) => routeWasRecommended(route, selectorEntry));
    const stateOwnershipCommands = recommendedStateOwnershipCommands(selectorEntry);
    const matchedExpectedPhaseCommands = [...new Set(
      stateOwnershipCommands
        .filter((commandRef) => expectedPhaseCommands.includes(commandRef)),
    )].sort();
    const fileGaps = [];

    if (p4Owned && directRoutes.length === 0) {
      fileGaps.push(createGap(
        changedFile,
        "missing-direct-state-ownership-route",
        "P4-owned files require a state-ownership route whose sourceRef directly matches the file.",
        { expectedPhaseCommands },
      ));
    } else if (p4Owned && recommendedDirectRoutes.length === 0) {
      fileGaps.push(createGap(
        changedFile,
        "direct-route-not-recommended",
        "A direct state-ownership route exists, but the adaptive selector did not recommend it for this file.",
        {
          directRouteIds: directRoutes.map((route) => route.id).sort(),
          expectedPhaseCommands,
        },
      ));
    } else if (p4Owned && matchedExpectedPhaseCommands.length === 0) {
      fileGaps.push(createGap(
        changedFile,
        "missing-expected-phase-command",
        "The direct state-ownership recommendation does not include an accepted command for this phase.",
        {
          recommendedDirectCommands: recommendedDirectRoutes.map((route) => route.commandRef).sort(),
          recommendedStateOwnershipCommands: stateOwnershipCommands,
          expectedPhaseCommands,
        },
      ));
    }
    routeGaps.push(...fileGaps);

    return {
      changedFile,
      p4Owned,
      nonBehavioralClassification: nonBehavioralClassification(changedFile),
      selectorMatched: !unmatchedSet.has(changedFile),
      selectorMatchedRouteIds: [...(selectorEntry.matchedRouteIds || [])].sort(),
      selectorRecommendedCommands: (selectorEntry.recommendedCommands || [])
        .map((entry) => ({
          commandRef: entry.commandRef,
          domains: [...(entry.domains || [])].sort(),
          routeIds: [...(entry.routeIds || [])].sort(),
        })),
      directStateOwnershipRoutes: directRoutes.map(toDirectRecommendation),
      directStateOwnershipRecommendations: recommendedDirectRoutes.map(toDirectRecommendation),
      matchedExpectedPhaseCommands,
      gaps: fileGaps.map((gap) => gap.code),
    };
  });

  const p4OwnedChangedFiles = files
    .filter((entry) => entry.p4Owned)
    .map((entry) => entry.changedFile);
  const verdict = routeGaps.length === 0 ? "pass" : "fail";

  return {
    schemaVersion: 1,
    kind: "p4-state-action-adaptive-route-gate",
    phase: normalizedPhase,
    verdict,
    expectedPhaseCommands,
    changedFiles: normalizedChangedFiles,
    p4OwnedChangedFiles,
    recommendedCommands: recommendation?.recommendedCommands || [],
    unmatchedChangedFiles,
    selectorUnmatchedChangedFiles,
    nonBehavioralChangedFiles,
    files,
    routeGaps,
    summary: {
      changedFileCount: normalizedChangedFiles.length,
      p4OwnedChangedFileCount: p4OwnedChangedFiles.length,
      unmatchedChangedFileCount: unmatchedChangedFiles.length,
      routeGapCount: routeGaps.length,
      directStateOwnershipCoveredFileCount: files.filter(
        (entry) => entry.p4Owned && entry.directStateOwnershipRecommendations.length > 0,
      ).length,
      expectedPhaseCommandCoveredFileCount: files.filter(
        (entry) => entry.p4Owned && entry.matchedExpectedPhaseCommands.length > 0,
      ).length,
    },
  };
}

function writeReport(report, outputPath) {
  const resolvedPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolvedPath;
}

export function runP4StateActionRouteCheck({
  args,
  recommendationBuilder = buildRecommendation,
  routeBuilder = buildRouteIndex,
  changedFileDiscoverer = discoverChangedFiles,
  reportWriter = writeReport,
} = {}) {
  const changedFiles = args.changedFiles.length
    ? args.changedFiles
    : changedFileDiscoverer({
      includeBranchHistory: args.includeBranchHistory,
      historyBase: args.historyBase,
    });
  const routes = routeBuilder();
  const recommendation = recommendationBuilder(changedFiles, routes);
  const report = buildP4StateActionRouteReport({
    phase: args.phase,
    changedFiles,
    recommendation,
    routes,
    allowEmpty: args.allowEmpty,
  });
  const reportPath = reportWriter(report, args.jsonOut);
  return {
    report: {
      ...report,
      reportPath,
    },
    exitCode: report.verdict === "pass" ? 0 : 2,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runP4StateActionRouteCheck({ args });
    if (args.printJson) {
      process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    } else {
      const summary = result.report.summary;
      const output = [
        `P4 route gate ${result.report.verdict.toUpperCase()} for ${result.report.phase}.`,
        `changed=${summary.changedFileCount}`,
        `p4-owned=${summary.p4OwnedChangedFileCount}`,
        `unmatched=${summary.unmatchedChangedFileCount}`,
        `route-gaps=${summary.routeGapCount}`,
        `report=${result.report.reportPath}`,
      ];
      const writer = result.exitCode === 0 ? console.log : console.error;
      writer(output.join(" "));
    }
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
