import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildRecommendation,
  classifyExecutionOwners,
  nonBehavioralClassification,
  normalizeChangedFiles,
  projectLocalEntrypointTestRoutes,
} from "./select_verification_targets.mjs";
import { buildRouteIndex } from "./test_route_registry.mjs";
import {
  VERIFICATION_DOMAINS,
} from "./verification/verification_domains.mjs";
import { atomicWriteJsonSync } from "./verification/resumable_verification.mjs";
import {
  assertPreparedVerificationCatalog,
  bindSelectionReportToPreparedCatalog,
  buildVerificationSelectionPlan,
  prepareRepositoryVerificationCatalogBinding,
  prepareVerificationCatalog,
} from "./verification/script_portfolio.mjs";
import {
  assertPrCostObservation,
  buildPrCostObservation,
  buildPrCostSourceBinding,
  buildVerificationProfile,
  DEFAULT_ADAPTIVE_VERIFICATION_PROFILE_OUT,
  prepareVerificationProfilePlan,
  publishVerificationProfileSafely,
  selectorPrCostObservation,
} from "./verification/verification_profile.mjs";

import { discoverWorkspaceChangedFiles } from "./verification/workspace_changes.mjs";

const REPO_ROOT = process.cwd();
const DEFAULT_JSON_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "test-adaptive-selection.json");
const DEFAULT_MD_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "test-adaptive-selection.md");
let packageScriptsForProfile = null;
function readPackageScriptsForProfile() {
  if (packageScriptsForProfile === null) {
    packageScriptsForProfile = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    ).scripts || {};
  }
  return packageScriptsForProfile;
}
const HISTORY_DISCOVERY_COMMANDS = [
  ["diff", "--name-only", "origin/main...HEAD", "--diff-filter=ACMRD", "-z"],
];
const EXECUTION_PLANNER_SCHEMA_VERSION = 1;
const EXECUTION_PLAN_SCHEMA_VERSION = 3;
const HARD_MAX_GROUP_LEAVES = 64;
const WINDOWS_MAX_ARGV_BYTES = 30_000;
const POSIX_MAX_ARGV_BYTES = 131_072;
const AUTHORITY_DISPOSITIONS = new Set(["child-safe", "main-thread", "ci-only", "blocked"]);
const EXECUTION_ISOLATIONS = new Set(["batch", "root", "process", "leaf"]);
export const LOCAL_ENTRYPOINT_BUDGETS = Object.freeze({
  edit: Object.freeze({
    maxCommands: 3,
    maxLeaves: 8,
    maxProcessGroups: 3,
    maxEstimatedRuntimeSeconds: 90,
    maxEstimatedCostUnits: 3,
  }),
  impact: Object.freeze({
    maxCommands: 4,
    maxLeaves: 12,
    maxProcessGroups: 4,
    maxEstimatedRuntimeSeconds: 120,
    maxEstimatedCostUnits: 4,
  }),
});
export function parseArgs(argv) {
  const args = {
    changedFiles: [],
    changedFilesProvided: false,
    inputErrors: [],
    dryRun: true,
    includeBranchHistory: false,
    historyBase: "",
    entrypoint: "",
    includeMainThread: false,
    deferMainThread: false,
    selectionJson: "",
    verificationCatalogFixture: "",
    verificationCatalogFixtureSha256: "",
    jsonOut: DEFAULT_JSON_OUT,
    mdOut: DEFAULT_MD_OUT,
    profileOut: DEFAULT_ADAPTIVE_VERIFICATION_PROFILE_OUT,
  };
  const takeOptionValue = (index) => (
    index + 1 < argv.length && !String(argv[index + 1]).startsWith("--")
      ? { value: argv[index + 1], consumed: true }
      : { value: "", consumed: false }
  );
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--changed-file") {
      args.changedFilesProvided = true;
      const next = takeOptionValue(index);
      args.changedFiles.push(next.value);
      if (next.consumed) index += 1;
    } else if (token === "--changed-files") {
      args.changedFilesProvided = true;
      const next = takeOptionValue(index);
      args.changedFiles.push(...String(next.value).split(","));
      if (next.consumed) index += 1;
    }
    else if (token === "--changed-files-list") {
      args.changedFilesProvided = true;
      const next = takeOptionValue(index);
      const filePath = String(next.value || "").trim();
      if (next.consumed) index += 1;
      if (!filePath) {
        args.inputErrors.push("adaptive-changed-files-list-path-empty");
      } else {
        try {
          args.changedFiles.push(...fs.readFileSync(filePath, "utf8").split(/\r?\n/));
        } catch (error) {
          args.inputErrors.push(`adaptive-changed-files-list-unreadable:${error.message}`);
        }
      }
    } else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--execute") args.dryRun = false;
    else if (token === "--include-branch-history") args.includeBranchHistory = true;
    else if (token === "--entrypoint") {
      args.entrypoint = String(argv[++index] || "").trim();
      if (!args.entrypoint) throw new Error("--entrypoint requires edit or impact");
    }
    else if (token === "--history-base") {
      args.historyBase = String(argv[++index] || "").trim();
      if (!args.historyBase) throw new Error("--history-base requires a non-empty Git revision");
      args.includeBranchHistory = true;
    }
    else if (token === "--base") {
      args.historyBase = String(argv[++index] || "").trim();
      if (!args.historyBase) throw new Error("--base requires a non-empty Git revision");
      args.includeBranchHistory = true;
    }
    else if (token === "--include-main-thread") args.includeMainThread = true;
    else if (token === "--defer-main-thread") args.deferMainThread = true;
    else if (token === "--selection-json") args.selectionJson = argv[++index];
    else if (token === "--verification-catalog-fixture") {
      args.verificationCatalogFixture = String(argv[++index] || "").trim();
      if (!args.verificationCatalogFixture) {
        args.inputErrors.push("adaptive-verification-catalog-fixture-path-empty");
      }
    }
    else if (token === "--verification-catalog-fixture-sha256") {
      args.verificationCatalogFixtureSha256 = String(argv[++index] || "").trim().toLowerCase();
      if (!args.verificationCatalogFixtureSha256) {
        args.inputErrors.push("adaptive-verification-catalog-fixture-sha256-empty");
      }
    }
    else if (token === "--json-out") args.jsonOut = argv[++index];
    else if (token === "--md-out") args.mdOut = argv[++index];
    else if (token === "--profile-out") args.profileOut = argv[++index];
    else {
      args.changedFilesProvided = true;
      args.changedFiles.push(token);
    }
  }
  return args;
}

export function parseGitPathOutput(output) {
  return String(output || "")
    .split("\0")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^"(.*)"$/, "$1"));
}

function runGitPathCommand(gitArgs, runner = spawnSync) {
  return runner("git", ["-c", "core.quotepath=false", ...gitArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });
}

export function discoverChangedFiles({
  runner = spawnSync,
  includeBranchHistory = false,
  historyBase = "",
  historyHead = "HEAD",
} = {}) {
  const discovered = new Set(discoverWorkspaceChangedFiles({ runner, cwd: REPO_ROOT }));
  // workspace 与 branch history 合并时只收集路径；实际 route 判定交给 selector，避免 Git 探测层携带业务语义。
  const normalizedHistoryBase = String(historyBase || "").trim();
  const historyCommands = normalizedHistoryBase
    ? [[
      "diff",
      "--name-only",
      normalizedHistoryBase,
      String(historyHead || "HEAD").trim(),
      "--diff-filter=ACMRD",
      "-z",
    ]]
    : includeBranchHistory
      ? HISTORY_DISCOVERY_COMMANDS
      : [];
  let successfulHistoryCommands = 0;
  for (const gitArgs of historyCommands) {
    const result = runGitPathCommand(gitArgs, runner);
    if (result.status !== 0) {
      if (normalizedHistoryBase) {
        const error = new Error(`adaptive-history-discovery-failed:${normalizedHistoryBase}`);
        error.code = "adaptive-history-discovery-failed";
        error.historyBase = normalizedHistoryBase;
        throw error;
      }
      continue;
    }
    successfulHistoryCommands += 1;
    const files = parseGitPathOutput(result.stdout);
    for (const file of files) discovered.add(file);
  }
  if (includeBranchHistory && !normalizedHistoryBase && historyCommands.length > 0 && successfulHistoryCommands === 0) {
    const error = new Error("adaptive-history-discovery-failed:all-fallbacks");
    error.code = "adaptive-history-discovery-failed";
    throw error;
  }
  return [...discovered].sort();
}

function adaptiveEntrypointError(code, detail = "") {
  const error = new Error(`${code}${detail ? `:${detail}` : ""}`);
  error.code = code;
  error.detail = detail;
  return error;
}

function runGitAuthorityCommand(gitArgs, runner = spawnSync) {
  return runner("git", ["-c", "core.quotepath=false", ...gitArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });
}

function resolveCommitAuthority(ref, runner) {
  const result = runGitAuthorityCommand(
    ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    runner,
  );
  const revision = String(result.stdout || "").trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/i.test(revision)) {
    throw adaptiveEntrypointError("adaptive-impact-authority-unresolved", ref);
  }
  return revision.toLowerCase();
}

export function assertAdaptiveEntrypointAuthority(args, { runner = spawnSync } = {}) {
  const entrypoint = String(args?.entrypoint || "").trim();
  const fixturePath = String(args?.verificationCatalogFixture || "").trim();
  const fixtureSha256 = String(args?.verificationCatalogFixtureSha256 || "").trim();
  const fixtureMode = Boolean(fixturePath || fixtureSha256);
  if (fixtureMode) {
    if (!fixturePath || !/^[0-9a-f]{64}$/iu.test(fixtureSha256)) {
      throw adaptiveEntrypointError("adaptive-verification-catalog-fixture-authority-incomplete");
    }
    if (entrypoint !== "impact") {
      throw adaptiveEntrypointError("adaptive-verification-catalog-fixture-entrypoint-forbidden", entrypoint);
    }
    if (!args.changedFilesProvided || args.includeBranchHistory || args.historyBase) {
      throw adaptiveEntrypointError("adaptive-verification-catalog-fixture-changed-files-authority");
    }
    if (!args.deferMainThread || args.includeMainThread) {
      throw adaptiveEntrypointError("adaptive-verification-catalog-fixture-main-thread-forbidden");
    }
    if (!args.dryRun && !args.selectionJson) {
      throw adaptiveEntrypointError("adaptive-verification-catalog-fixture-selection-required");
    }
    return { historyBase: "", head: "", fixtureMode: true };
  }
  if (!entrypoint) return { historyBase: String(args?.historyBase || "").trim(), head: "" };
  if (!new Set(["edit", "impact"]).has(entrypoint)) {
    throw adaptiveEntrypointError("adaptive-entrypoint-unknown", entrypoint);
  }
  if (!args.deferMainThread || args.includeMainThread) {
    throw adaptiveEntrypointError(`adaptive-${entrypoint}-main-thread-forbidden`);
  }
  if (entrypoint === "edit") {
    if (args.includeBranchHistory || args.historyBase) {
      throw adaptiveEntrypointError("adaptive-edit-history-forbidden");
    }
    return { historyBase: "", head: "" };
  }
  const requestedBase = String(args.historyBase || "").trim();
  if (!requestedBase) throw adaptiveEntrypointError("adaptive-impact-base-required");
  if (args.changedFilesProvided) {
    throw adaptiveEntrypointError("adaptive-impact-explicit-changed-files-forbidden");
  }
  if (args.selectionJson) {
    throw adaptiveEntrypointError("adaptive-impact-selection-artifact-forbidden");
  }
  const historyBase = resolveCommitAuthority(requestedBase, runner);
  const head = resolveCommitAuthority("HEAD", runner);
  const status = runGitAuthorityCommand(["status", "--porcelain=v1", "-z"], runner);
  if (status.status !== 0) {
    throw adaptiveEntrypointError("adaptive-impact-worktree-authority-unresolved");
  }
  if (String(status.stdout || "").length > 0) {
    throw adaptiveEntrypointError("adaptive-impact-dirty-worktree");
  }
  const ancestry = runGitAuthorityCommand(["merge-base", "--is-ancestor", historyBase, head], runner);
  if (ancestry.status === 1) {
    throw adaptiveEntrypointError("adaptive-impact-base-not-ancestor", requestedBase);
  }
  if (ancestry.status !== 0) {
    throw adaptiveEntrypointError("adaptive-impact-ancestry-unresolved", requestedBase);
  }
  return { historyBase, head };
}

export function buildAdaptiveEntrypointRecommendation(changedFiles, allRoutes = buildRouteIndex(), {
  entrypoint = "",
  routeAuthority = null,
} = {}) {
  return buildRecommendation(changedFiles, allRoutes, {
    routeAuthority,
    matchedRouteProjector: new Set(["edit", "impact"]).has(entrypoint)
      ? projectLocalEntrypointTestRoutes
      : null,
  });
}

function canonicalLeavesForRoots(preparedCatalog, commandRefs) {
  assertPreparedVerificationCatalog(preparedCatalog);
  if (commandRefs.length === 0) return [];
  return buildVerificationSelectionPlan(
    preparedCatalog.catalog,
    commandRefs,
    {
      preparedCatalog,
      platform: preparedCatalog.sourceInputs?.platform || process.platform,
    },
  ).normalizedLeaves;
}

export function constrainAdaptiveEntrypointSelection(report, entrypoint, {
  preparedCatalog = null,
} = {}) {
  if (!new Set(["edit", "impact"]).has(entrypoint)) return report;
  const catalogIdentity = preparedCatalog ? {
    schemaVersion: preparedCatalog.schemaVersion,
    kind: preparedCatalog.kind,
    digest: preparedCatalog.catalogDigest,
    sourceIdentity: structuredClone(preparedCatalog.sourceIdentity),
  } : null;
  const policyByCommand = new Map((preparedCatalog?.authority || []).map((entry) => (
    [entry.commandRef, entry.entrypointPolicy]
  )));
  const canonicalPolicy = (entry) => policyByCommand.get(entry?.commandRef) || null;
  const isEligible = (entry) => canonicalPolicy(entry)?.eligibleEntrypoints?.includes(entrypoint) === true;
  const isProjection = (entry) => canonicalPolicy(entry)?.localProjection?.mode === "indivisible";
  const projectionMatchesFile = (command, changedFile) => {
    const normalizedFile = String(changedFile || "").replaceAll("\\", "/").replace(/^\.\//, "");
    return (command.sourceRefs || []).some((sourceRef) => {
      const normalizedRef = String(sourceRef || "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
      return normalizedFile === normalizedRef || normalizedFile.startsWith(`${normalizedRef}/`);
    });
  };
  const selectedCommandRefs = new Set();
  const localEntrypointRouteGaps = [];
  const deferredByCommand = new Map();
  const rawByCommand = new Map();
  const localEligibleByCommand = new Map();
  const matchedByFile = (report.matchedByFile || []).map((entry) => {
    const rawCommands = entry.recommendedCommands || [];
    for (const command of rawCommands) {
      rawByCommand.set(command.commandRef, command);
      if (!canonicalPolicy(command)) {
        localEntrypointRouteGaps.push(planGap(
          `adaptive-${entrypoint}-canonical-eligibility-missing`,
          command.commandRef,
          `changed-file=${entry.changedFile}`,
        ));
      }
    }
    const policyEligibleCommands = rawCommands.filter(isEligible);
    for (const command of policyEligibleCommands) {
      localEligibleByCommand.set(command.commandRef, command);
    }
    const localEligibleCommands = policyEligibleCommands.filter((command) => (
      projectionMatchesFile(command, entry.changedFile)
    ));
    const localSourceMismatches = policyEligibleCommands.filter((command) => (
      !localEligibleCommands.includes(command)
    ));
    for (const command of localSourceMismatches) {
      localEntrypointRouteGaps.push(planGap(
        `adaptive-${entrypoint}-local-source-mismatch`,
        command.commandRef,
        `changed-file=${entry.changedFile};source-refs=${(command.sourceRefs || []).join(",") || "missing"}`,
      ));
    }
    const projectionCommands = localEligibleCommands.filter(isProjection);
    const recommendedCommands = projectionCommands.length > 0 ? projectionCommands : localEligibleCommands;
    const deferredCommands = rawCommands.filter((command) => !policyEligibleCommands.includes(command));
    for (const command of deferredCommands) {
      const existing = deferredByCommand.get(command.commandRef) || {
        commandRef: command.commandRef,
        executionOwner: command.executionOwner,
        executionOwners: [...(command.executionOwners || [])],
        cost: command.cost,
        tiers: [...(command.tiers || [])],
        ciProfiles: [...(command.ciProfiles || [])],
        resourceLocks: [...(command.resourceLocks || [])],
        minimumDepth: canonicalPolicy(command)?.minimumDepth || "unknown",
        executionTarget: canonicalPolicy(command)?.executionTarget || "unknown",
        reason: canonicalPolicy(command)?.deferredReason || "canonical-entrypoint-policy-missing",
        routeIds: new Set(),
        changedFiles: new Set(),
        catalogIdentity,
      };
      for (const routeId of command.routeIds || []) existing.routeIds.add(routeId);
      existing.changedFiles.add(entry.changedFile);
      deferredByCommand.set(command.commandRef, existing);
    }
    for (const command of recommendedCommands) selectedCommandRefs.add(command.commandRef);
    if ((entry.matchedRouteIds || []).length > 0 && recommendedCommands.length === 0) {
      const deeperTiers = [...new Set(deferredCommands
        .map((command) => canonicalPolicy(command)?.minimumDepth)
        .filter(Boolean))].sort();
      localEntrypointRouteGaps.push(planGap(
        `adaptive-${entrypoint}-local-entrypoint-no-eligible-coverage`,
        entry.changedFile,
        `matched-routes=${entry.matchedRouteIds.join(",")};required-depth=${deeperTiers.join("+") || "unknown"}`,
      ));
    }
    return {
      ...entry,
      rawCanonicalCommands: rawCommands,
      rawLocalEligibleCommands: policyEligibleCommands,
      localEligibleCommands,
      localSourceMismatches: localSourceMismatches.map((command) => ({
        commandRef: command.commandRef,
        sourceRefs: [...(command.sourceRefs || [])],
        catalogIdentity,
      })),
      deferredByTier: deferredCommands.map((command) => ({
        commandRef: command.commandRef,
        executionOwner: command.executionOwner,
        cost: command.cost,
        tiers: [...(command.tiers || [])],
        minimumDepth: canonicalPolicy(command)?.minimumDepth || "unknown",
        executionTarget: canonicalPolicy(command)?.executionTarget || "unknown",
        reason: canonicalPolicy(command)?.deferredReason || "canonical-entrypoint-policy-missing",
        catalogIdentity,
      })),
      recommendedCommands,
    };
  });
  const recommendedCommands = (report.recommendedCommands || [])
    .filter((entry) => selectedCommandRefs.has(entry.commandRef));
  const withCanonicalIdentity = (entry) => ({
    ...entry,
    canonicalIdentity: {
      commandRef: entry.commandRef,
      catalogIdentity,
    },
  });
  const rawCanonicalRoots = [...rawByCommand.values()].map(withCanonicalIdentity)
    .sort((left, right) => left.commandRef.localeCompare(right.commandRef));
  const rawLocalEligibleRoots = [...localEligibleByCommand.values()].map(withCanonicalIdentity)
    .sort((left, right) => left.commandRef.localeCompare(right.commandRef));
  const deferredByTier = [...deferredByCommand.values()].map((entry) => ({
    ...entry,
    routeIds: [...entry.routeIds].sort(),
    changedFiles: [...entry.changedFiles].sort(),
  })).sort((left, right) => left.commandRef.localeCompare(right.commandRef));
  let localLeafEquivalence = {
    status: "unverified",
    rawLocalEligibleLeaves: [],
    projectedLocalLeaves: [],
    missingLeaves: [],
    unexpectedLeaves: [],
    catalogIdentity,
  };
  try {
    if (!preparedCatalog) throw new Error("canonical-catalog-required");
    const rawLeaves = canonicalLeavesForRoots(
      preparedCatalog,
      rawLocalEligibleRoots.map((command) => command.commandRef),
    );
    const projectedLeaves = canonicalLeavesForRoots(
      preparedCatalog,
      recommendedCommands.map((command) => command.commandRef),
    );
    const rawSet = new Set(rawLeaves);
    const projectedSet = new Set(projectedLeaves);
    const missingLeaves = rawLeaves.filter((leaf) => !projectedSet.has(leaf));
    const unexpectedLeaves = projectedLeaves.filter((leaf) => !rawSet.has(leaf));
    localLeafEquivalence = {
      status: missingLeaves.length === 0 && unexpectedLeaves.length === 0 ? "equivalent" : "gap",
      rawLocalEligibleLeaves: rawLeaves,
      projectedLocalLeaves: projectedLeaves,
      missingLeaves,
      unexpectedLeaves,
      catalogIdentity,
    };
    if (localLeafEquivalence.status === "gap") {
      localEntrypointRouteGaps.push(planGap(
        `adaptive-${entrypoint}-local-leaf-equivalence-gap`,
        "canonical-local-projection",
        `missing-leaves=${missingLeaves.join(",")};unexpected-leaves=${unexpectedLeaves.join(",")}`,
      ));
    }
  } catch (error) {
    localEntrypointRouteGaps.push(planGap(
      `adaptive-${entrypoint}-local-leaf-equivalence-authority-gap`,
      "canonical-local-projection",
      String(error?.message || error),
    ));
  }
  return {
    ...report,
    recommendedCommands,
    childAgentStaticTasks: (report.childAgentStaticTasks || [])
      .filter((entry) => selectedCommandRefs.has(entry.commandRef)),
    mainThreadSerialVerification: [],
    ciOnlyVerification: [],
    blockedVerification: [],
    matchedByFile,
    rawCanonicalRoots,
    rawLocalEligibleRoots,
    deferredByTier,
    localLeafEquivalence,
    localEntrypointRouteGaps,
    localEntrypointPolicy: {
      entrypoint,
      source: "canonical-verification-catalog",
      catalogIdentity,
      projectionMode: "canonical-eligibility-with-indivisible-local-projection",
    },
  };
}

export function commandToProcess(commandRef, platform = process.platform) {
  const normalized = String(commandRef || "").trim();
  if (!normalized) return null;
  if (/^(node|python|npm)\b/.test(normalized)) {
    const tokens = normalized.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const args = tokens.slice(1).map((token) => token.replace(/^"(.*)"$/, "$1"));
    if (tokens[0] === "python" && platform === "win32") {
      return {
        bin: process.execPath,
        args: ["tools/run_python.mjs", ...args],
      };
    }
    if (tokens[0] === "npm" && platform === "win32") {
      return {
        bin: "cmd.exe",
        args: ["/d", "/s", "/c", "npm", ...args],
      };
    }
    return {
      bin: tokens[0],
      args,
    };
  }
  if (platform === "win32") {
    return {
      bin: "cmd.exe",
      args: ["/d", "/s", "/c", "npm", "run", normalized],
    };
  }
  return {
    bin: "npm",
    args: ["run", normalized],
  };
}

function uniqueSorted(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function readPackageScripts(packagePath = path.join(REPO_ROOT, "package.json")) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  return packageJson.scripts || {};
}

function verificationCatalogFixtureError(code, detail = "") {
  const error = new Error(`${code}${detail ? `:${detail}` : ""}`);
  error.code = code;
  error.detail = detail;
  return error;
}

export function readVerificationCatalogFixture(fixturePath, expectedSha256) {
  const normalizedExpected = String(expectedSha256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalizedExpected)) {
    throw verificationCatalogFixtureError("adaptive-verification-catalog-fixture-sha256-invalid");
  }
  let fixtureBytes;
  try {
    fixtureBytes = fs.readFileSync(fixturePath);
  } catch (error) {
    throw verificationCatalogFixtureError("adaptive-verification-catalog-fixture-unreadable", error.message);
  }
  const actualSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  if (actualSha256 !== normalizedExpected) {
    throw verificationCatalogFixtureError(
      "adaptive-verification-catalog-fixture-sha256-mismatch",
      `expected=${normalizedExpected};actual=${actualSha256}`,
    );
  }
  let fixture;
  try {
    fixture = JSON.parse(fixtureBytes.toString("utf8"));
  } catch (error) {
    throw verificationCatalogFixtureError("adaptive-verification-catalog-fixture-json", error.message);
  }
  const allowedFields = new Set(["schemaVersion", "kind", "id", "packageScripts", "routes"]);
  const unknownField = Object.keys(fixture || {}).find((field) => !allowedFields.has(field));
  if (!fixture
    || typeof fixture !== "object"
    || Array.isArray(fixture)
    || fixture.schemaVersion !== 1
    || fixture.kind !== "adaptive-verification-catalog-fixture"
    || typeof fixture.id !== "string"
    || !fixture.id.trim()
    || !fixture.packageScripts
    || typeof fixture.packageScripts !== "object"
    || Array.isArray(fixture.packageScripts)
    || Object.entries(fixture.packageScripts).some(([name, command]) => (
      !name.trim() || typeof command !== "string" || !command.trim()
    ))
    || !Array.isArray(fixture.routes)
    || fixture.routes.length === 0
    || fixture.routes.some((route) => !route || typeof route !== "object" || Array.isArray(route))
    || unknownField) {
    throw verificationCatalogFixtureError(
      "adaptive-verification-catalog-fixture-schema",
      unknownField || String(fixture?.id || "missing"),
    );
  }
  return {
    fixture,
    binding: {
      id: fixture.id,
      path: path.resolve(fixturePath).replaceAll("\\", "/"),
      identity: {
        algorithm: "sha256",
        digest: actualSha256,
      },
    },
  };
}

function planGap(code, commandRef, detail = "") {
  return {
    code,
    commandRef: String(commandRef || ""),
    detail: String(detail || ""),
  };
}

function selectionRootSet(report) {
  return uniqueSorted((report?.recommendedCommands || []).map((entry) => entry.commandRef));
}

export function bindSelectionToPreparedCatalog(report, preparedCatalog) {
  return bindSelectionReportToPreparedCatalog(report, preparedCatalog);
}

function validateSelectionCatalogBinding(report, preparedCatalog, {
  expectedSelectorRootSet = selectionRootSet(report),
} = {}) {
  const gaps = [];
  const rebound = bindSelectionReportToPreparedCatalog(report, preparedCatalog);
  const compare = (field, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      gaps.push(planGap("adaptive-selection-catalog-drift", "selection-artifact", field));
    }
  };
  compare("catalogDigest", report?.catalogDigest, preparedCatalog.catalogDigest);
  compare("catalogSourceIdentity", report?.catalogSourceIdentity, preparedCatalog.sourceIdentity);
  compare("selectorRootSet", report?.selectorRootSet, expectedSelectorRootSet);
  compare("routeAuthority", report?.routeAuthority, preparedCatalog.authority);
  compare("gatePolicySignals", report?.gatePolicySignals, rebound.gatePolicySignals);
  compare("gatePolicySignalsDigest", report?.gatePolicySignalsDigest, rebound.gatePolicySignalsDigest);
  const selectionCost = selectorPrCostObservation(report);
  if (!selectionCost) {
    gaps.push(planGap("adaptive-selection-catalog-drift", "selection-artifact", "prCost.missing"));
  } else {
    try {
      assertPrCostObservation(selectionCost, {
        expectedObservationStage: "selector",
        expectedSourceBinding: buildPrCostSourceBinding({
          selectorReport: report,
          observationStage: "selector",
        }),
      });
    } catch (error) {
      const field = error.code === "pr-cost-observation-schema-identity-drift"
        ? "prCost.schemaIdentity"
        : error.code === "pr-cost-observation-source-binding-drift"
          ? "prCost.sourceBinding"
          : error.code === "pr-cost-observation-digest-drift"
            ? "prCost.observationDigest"
            : "prCost.schema";
      gaps.push(planGap("adaptive-selection-catalog-drift", "selection-artifact", field));
    }
  }
  return gaps;
}

function shellSyntaxError(code, source) {
  const error = new Error(`${code}:${source}`);
  error.code = code;
  error.commandRef = source;
  return error;
}

export function splitConjunctiveCommands(source) {
  const input = String(source || "").trim();
  if (!input) throw shellSyntaxError("adaptive-command-empty", source);
  const commands = [];
  let quote = "";
  let escaped = false;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote === '"') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "&" && input[index + 1] === "&") {
      const command = input.slice(start, index).trim();
      if (!command) throw shellSyntaxError("adaptive-command-empty-segment", source);
      commands.push(command);
      index += 1;
      start = index + 1;
      continue;
    }
    if (char === "|" || char === ";" || char === "\n" || char === "\r" || char === "&") {
      throw shellSyntaxError("adaptive-command-unsupported-control-operator", source);
    }
  }
  if (quote) throw shellSyntaxError("adaptive-command-unclosed-quote", source);
  const tail = input.slice(start).trim();
  if (!tail) throw shellSyntaxError("adaptive-command-empty-segment", source);
  commands.push(tail);
  return commands;
}

export function tokenizeCommand(source) {
  const input = String(source || "").trim();
  const tokens = [];
  let token = "";
  let quote = "";
  let escaped = false;
  let active = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      token += char;
      escaped = false;
      active = true;
      continue;
    }
    if (char === "\\" && quote === '"') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        token += char;
      }
      active = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      active = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (active) {
        tokens.push(token);
        token = "";
        active = false;
      }
      continue;
    }
    token += char;
    active = true;
  }
  if (quote || escaped) throw shellSyntaxError("adaptive-command-unclosed-quote", source);
  if (active) tokens.push(token);
  if (!tokens.length) throw shellSyntaxError("adaptive-command-empty", source);
  return tokens;
}

function formatCommandTokens(tokens) {
  return tokens.map((token) => {
    const value = String(token);
    return /[\s"'|;&]/.test(value) ? JSON.stringify(value) : value;
  }).join(" ");
}

function aliasError(code, commandRef, aliasPath) {
  const pathText = [...aliasPath, commandRef].join(" -> ");
  const error = new Error(`${code}:${pathText}`);
  error.code = code;
  error.commandRef = commandRef;
  error.aliasPath = [...aliasPath, commandRef];
  return error;
}

export function expandCommandAliases(commandRef, packageScripts, aliasPath = []) {
  const normalized = String(commandRef || "").trim();
  if (!normalized) throw aliasError("adaptive-alias-empty", normalized, aliasPath);
  if (Object.hasOwn(packageScripts, normalized)) {
    if (aliasPath.includes(normalized)) {
      throw aliasError("adaptive-alias-cycle", normalized, aliasPath);
    }
    const nextPath = [...aliasPath, normalized];
    return splitConjunctiveCommands(packageScripts[normalized]).flatMap((command) => (
      expandCommandAliases(command, packageScripts, nextPath)
    ));
  }

  const tokens = tokenizeCommand(normalized);
  if (tokens[0] === "npm" && tokens[1] === "run") {
    const silentOffset = tokens[2] === "-s" ? 1 : 0;
    const alias = tokens[2 + silentOffset];
    if (!alias || !Object.hasOwn(packageScripts, alias)) {
      throw aliasError("adaptive-alias-unresolved", alias || normalized, aliasPath);
    }
    const separatorIndex = 3 + silentOffset;
    const extraArgs = tokens[separatorIndex] === "--"
      ? tokens.slice(separatorIndex + 1)
      : tokens.slice(separatorIndex);
    const expanded = expandCommandAliases(alias, packageScripts, aliasPath);
    if (extraArgs.length > 0 && expanded.length !== 1) {
      throw aliasError("adaptive-alias-ambiguous-arguments", alias, aliasPath);
    }
    return expanded.map((entry) => ({
      ...entry,
      tokens: [...entry.tokens, ...extraArgs],
    }));
  }

  if (tokens.length === 1 && aliasPath.length === 0) {
    throw aliasError("adaptive-command-unresolved", normalized, aliasPath);
  }
  return [{ tokens, aliasPath: [...aliasPath] }];
}

function normalizePathToken(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function leafRecord({
  kind,
  target = "",
  options = [],
  tokens,
  root,
  aliasPath,
  sequence,
  processKey,
}) {
  const normalizedTarget = normalizePathToken(target);
  const normalizedOptions = options.map((entry) => String(entry));
  const identityParts = [kind, normalizedTarget, ...normalizedOptions];
  return {
    leafId: identityParts.join("\u0000"),
    kind,
    target: normalizedTarget,
    options: normalizedOptions,
    tokens: tokens.map((entry) => String(entry)),
    sourceCommandRefs: [root.commandRef],
    aliasPaths: [[...aliasPath]],
    processKeys: [processKey],
    sequence,
    disposition: root.executionDisposition,
    authorityDisposition: root.disposition,
    executionOwner: root.executionOwner,
    executionOwners: [...root.executionOwners],
    platforms: [...root.platforms],
    resourceLocks: [...root.resourceLocks],
    tiers: [...root.tiers],
    ciProfiles: [...root.ciProfiles],
    routeIds: [...root.routeIds],
    safetyContributorRouteIds: [...root.safetyContributorRouteIds],
    batchSafe: root.batchSafe,
    isolation: root.isolation,
    maxLeaves: root.maxLeaves,
    maxArgvBytes: root.maxArgvBytes,
  };
}

function rawLeaf(tokens, root, aliasPath, sequence, processKey, kind = "raw") {
  return leafRecord({
    kind,
    options: tokens,
    tokens,
    root,
    aliasPath,
    sequence,
    processKey,
  });
}

function normalizeExpandedCommand(entry, root, sequence, processKey) {
  let tokens = [...entry.tokens];
  if (tokens[0] === "node" && normalizePathToken(tokens[1]) === "tools/run_python.mjs") {
    tokens = ["python", ...tokens.slice(2)];
  }

  if (tokens[0] === "node" && tokens[1] === "--test") {
    const args = tokens.slice(2);
    const targets = args.filter((arg) => /\.(?:c|m)?js$/.test(arg));
    const options = args.filter((arg) => !targets.includes(arg));
    if (targets.length > 0 && options.every((option) => option.startsWith("-"))) {
      return targets.map((target) => leafRecord({
        kind: "node-test",
        target,
        options,
        tokens: ["node", "--test", target, ...options],
        root,
        aliasPath: entry.aliasPath,
        sequence,
        processKey,
      }));
    }
  }

  if (tokens[0] === "node" && tokens[1] === "--check") {
    const targets = tokens.slice(2);
    if (targets.length > 0 && targets.every((target) => /\.(?:c|m)?js$/.test(target))) {
      return targets.map((target) => leafRecord({
        kind: "node-check",
        target,
        tokens: ["node", "--check", target],
        root,
        aliasPath: entry.aliasPath,
        sequence,
        processKey,
      }));
    }
  }

  if (
    tokens[0] === "node"
    && normalizePathToken(tokens[1]) === "node_modules/@playwright/test/cli.js"
    && tokens[2] === "test"
  ) {
    const args = tokens.slice(3);
    const targets = args.filter((arg) => /\.spec\.js$/.test(arg));
    const options = args.filter((arg) => !targets.includes(arg));
    if (targets.length > 0) {
      return targets.map((target) => leafRecord({
        kind: "playwright",
        target,
        options,
        tokens: ["node", tokens[1], "test", target, ...options],
        root,
        aliasPath: entry.aliasPath,
        sequence,
        processKey,
      }));
    }
  }

  if (
    tokens[0] === "node"
    && normalizePathToken(tokens[1]) === "tools/e2e_layering.mjs"
    && tokens[2] === "run-spec"
    && tokens[3]
  ) {
    return [leafRecord({
      kind: "playwright-layer",
      target: tokens[3],
      options: tokens.slice(4),
      tokens,
      root,
      aliasPath: entry.aliasPath,
      sequence,
      processKey,
    })];
  }

  if (tokens[0] === "python" && tokens[1] === "-m" && tokens[2] === "unittest") {
    const args = tokens.slice(3);
    const allowedOptions = new Set(["-q", "-v", "-f", "--failfast", "-b", "--buffer", "--locals"]);
    const targets = args.filter((arg) => !arg.startsWith("-"));
    const options = args.filter((arg) => arg.startsWith("-"));
    if (targets.length > 0 && options.every((option) => allowedOptions.has(option)) && !targets.includes("discover")) {
      return targets.map((target) => leafRecord({
        kind: "python-unittest",
        target,
        options,
        tokens: ["python", "-m", "unittest", target, ...options],
        root,
        aliasPath: entry.aliasPath,
        sequence,
        processKey,
      }));
    }
  }

  if (tokens[0] === "python" && tokens[1] === "-m" && tokens[2] === "pytest") {
    const args = tokens.slice(3);
    const targets = args.filter((arg) => /\.py$/.test(arg));
    const options = args.filter((arg) => !targets.includes(arg));
    if (targets.length > 0 && options.every((option) => option.startsWith("-"))) {
      return targets.map((target) => leafRecord({
        kind: "python-pytest",
        target,
        options,
        tokens: ["python", "-m", "pytest", target, ...options],
        root,
        aliasPath: entry.aliasPath,
        sequence,
        processKey,
      }));
    }
  }

  if (tokens[0] === "python" && tokens[1] === "-m" && tokens[2] === "py_compile") {
    const targets = tokens.slice(3);
    if (targets.length > 0 && targets.every((target) => /\.py$/.test(target))) {
      return targets.map((target) => leafRecord({
        kind: "python-pycompile",
        target,
        tokens: ["python", "-m", "py_compile", target],
        root,
        aliasPath: entry.aliasPath,
        sequence,
        processKey,
      }));
    }
  }

  const runtime = tokens[0] === "node" ? "node" : tokens[0] === "python" ? "python" : "external";
  return [rawLeaf(tokens, root, entry.aliasPath, sequence, processKey, runtime)];
}

function leafSafetyMetadata(leaf) {
  return {
    kind: leaf.kind,
    target: leaf.target,
    options: leaf.options,
    tokens: leaf.tokens,
    disposition: leaf.disposition,
    authorityDisposition: leaf.authorityDisposition,
    executionOwner: leaf.executionOwner,
    executionOwners: leaf.executionOwners,
    platforms: leaf.platforms,
    resourceLocks: leaf.resourceLocks,
    tiers: leaf.tiers,
    ciProfiles: leaf.ciProfiles,
    batchSafe: leaf.batchSafe,
    isolation: leaf.isolation,
    maxLeaves: leaf.maxLeaves,
    maxArgvBytes: leaf.maxArgvBytes,
  };
}

function mergeLeaves(leaves, routeGaps) {
  const byId = new Map();
  for (const leaf of leaves) {
    const existing = byId.get(leaf.leafId);
    if (!existing) {
      byId.set(leaf.leafId, { ...leaf });
      continue;
    }
    if (JSON.stringify(leafSafetyMetadata(existing)) !== JSON.stringify(leafSafetyMetadata(leaf))) {
      routeGaps.push(planGap(
        "adaptive-leaf-metadata-conflict",
        leaf.sourceCommandRefs.join(","),
        `leaf=${JSON.stringify(leaf.leafId)}`,
      ));
      continue;
    }
    existing.sourceCommandRefs = uniqueSorted([...existing.sourceCommandRefs, ...leaf.sourceCommandRefs]);
    existing.aliasPaths = [...existing.aliasPaths, ...leaf.aliasPaths];
    existing.processKeys = uniqueSorted([...existing.processKeys, ...leaf.processKeys]);
    existing.routeIds = uniqueSorted([...existing.routeIds, ...leaf.routeIds]);
    existing.safetyContributorRouteIds = uniqueSorted([
      ...existing.safetyContributorRouteIds,
      ...leaf.safetyContributorRouteIds,
    ]);
    existing.sequence = Math.min(existing.sequence, leaf.sequence);
  }
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence || left.leafId.localeCompare(right.leafId));
}

function processForTokens(tokens, platform = process.platform) {
  if (tokens[0] === "python" && platform === "win32") {
    return { bin: process.execPath, args: ["tools/run_python.mjs", ...tokens.slice(1)] };
  }
  return { bin: tokens[0], args: tokens.slice(1) };
}

function aggregateTokens(kind, leaves) {
  const targets = uniqueSorted(leaves.map((leaf) => leaf.target));
  const options = leaves[0]?.options || [];
  if (kind === "node-test") return ["node", "--test", ...targets, ...options];
  if (kind === "node-check") return ["node", "--check", ...targets];
  if (kind === "python-unittest") return ["python", "-m", "unittest", ...targets, ...options];
  if (kind === "python-pytest") return ["python", "-m", "pytest", ...targets, ...options];
  if (kind === "python-pycompile") return ["python", "-m", "py_compile", ...targets];
  if (kind === "playwright") return ["node", leaves[0].tokens[1], "test", ...targets, ...options];
  return [...leaves[0].tokens];
}

function argvByteLength(tokens, platform) {
  const encoding = platform === "win32" ? "utf16le" : "utf8";
  return Buffer.byteLength(tokens.map((token) => String(token)).join("\u0000"), encoding);
}

function leafBudget(leaf, platform) {
  const hardArgvLimit = platform === "win32" ? WINDOWS_MAX_ARGV_BYTES : POSIX_MAX_ARGV_BYTES;
  return {
    maxLeaves: Math.min(leaf.maxLeaves, HARD_MAX_GROUP_LEAVES),
    maxArgvBytes: Math.min(leaf.maxArgvBytes, hardArgvLimit),
  };
}

function groupMetadataKey(leaf) {
  return JSON.stringify({
    kind: leaf.kind,
    options: leaf.options,
    executionOwner: leaf.executionOwner,
    executionOwners: leaf.executionOwners,
    platforms: leaf.platforms,
    resourceLocks: leaf.resourceLocks,
    ciProfiles: leaf.ciProfiles,
    batchSafe: leaf.batchSafe,
    isolation: leaf.isolation,
    maxLeaves: leaf.maxLeaves,
    maxArgvBytes: leaf.maxArgvBytes,
  });
}

function makeExecutionGroup(leaves, { disposition, platform, routeGaps }) {
  const first = leaves[0];
  const tokens = aggregateTokens(first.kind, leaves);
  const budget = leafBudget(first, platform);
  const argvBytes = argvByteLength(tokens, platform);
  if (leaves.length > budget.maxLeaves) {
    routeGaps.push(planGap(
      "adaptive-group-leaf-budget-exceeded",
      uniqueSorted(leaves.flatMap((leaf) => leaf.sourceCommandRefs)).join(","),
      `leaves=${leaves.length};maxLeaves=${budget.maxLeaves}`,
    ));
    return null;
  }
  if (argvBytes > budget.maxArgvBytes) {
    routeGaps.push(planGap(
      "adaptive-group-argv-budget-exceeded",
      uniqueSorted(leaves.flatMap((leaf) => leaf.sourceCommandRefs)).join(","),
      `argvBytes=${argvBytes};maxArgvBytes=${budget.maxArgvBytes};platform=${platform}`,
    ));
    return null;
  }
  return {
    disposition,
    kind: first.kind,
    commandRef: formatCommandTokens(tokens),
    process: processForTokens(tokens, platform),
    leafIds: leaves.map((leaf) => leaf.leafId),
    sourceCommandRefs: uniqueSorted(leaves.flatMap((leaf) => leaf.sourceCommandRefs)),
    routeIds: uniqueSorted(leaves.flatMap((leaf) => leaf.routeIds)),
    safetyContributorRouteIds: uniqueSorted(leaves.flatMap((leaf) => leaf.safetyContributorRouteIds)),
    resourceLocks: [...first.resourceLocks],
    executionOwner: first.executionOwner,
    executionOwners: [...first.executionOwners],
    platforms: [...first.platforms],
    tiers: [...first.tiers],
    ciProfiles: [...first.ciProfiles],
    batchSafe: first.batchSafe,
    isolation: first.isolation,
    leafCount: leaves.length,
    argvBytes,
    maxLeaves: budget.maxLeaves,
    maxArgvBytes: budget.maxArgvBytes,
  };
}

function buildExecutionGroups(leaves, { disposition, platform, routeGaps }) {
  const batchKinds = new Set(["node-test", "playwright"]);
  const buckets = new Map();
  for (const leaf of leaves) {
    const canBatch = leaf.resourceLocks.length === 0
      && leaf.batchSafe
      && leaf.isolation === "batch"
      && batchKinds.has(leaf.kind);
    let isolationKey;
    if (canBatch) isolationKey = "batch";
    else if (leaf.resourceLocks.length > 0 || leaf.isolation === "leaf") isolationKey = `leaf:${leaf.leafId}`;
    else if (leaf.isolation === "root") isolationKey = `root:${leaf.sourceCommandRefs.join("\u0000")}`;
    else isolationKey = `process:${leaf.processKeys.join("\u0000")}`;
    const key = `${isolationKey}:${groupMetadataKey(leaf)}`;
    const bucket = buckets.get(key) || { canBatch, leaves: [] };
    bucket.leaves.push(leaf);
    buckets.set(key, bucket);
  }

  const groups = [];
  for (const bucket of buckets.values()) {
    if (!bucket.canBatch) {
      const group = makeExecutionGroup(bucket.leaves, { disposition, platform, routeGaps });
      if (group) groups.push(group);
      continue;
    }
    let chunk = [];
    for (const leaf of bucket.leaves) {
      const candidate = [...chunk, leaf];
      const tokens = aggregateTokens(leaf.kind, candidate);
      const budget = leafBudget(leaf, platform);
      const fits = candidate.length <= budget.maxLeaves
        && argvByteLength(tokens, platform) <= budget.maxArgvBytes;
      if (fits) {
        chunk = candidate;
        continue;
      }
      if (chunk.length > 0) {
        const group = makeExecutionGroup(chunk, { disposition, platform, routeGaps });
        if (group) groups.push(group);
        chunk = [];
      }
      const single = makeExecutionGroup([leaf], { disposition, platform, routeGaps });
      if (single) chunk = [leaf];
    }
    if (chunk.length > 0) {
      const group = makeExecutionGroup(chunk, { disposition, platform, routeGaps });
      if (group) groups.push(group);
    }
  }
  return groups.map((group, index) => ({
    groupId: `${disposition}-${String(index + 1).padStart(3, "0")}`,
    ...group,
  }));
}

function requiredStringArray(entry, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(entry?.[field])) return null;
  if (!entry[field].every((value) => typeof value === "string" && value.trim())) return null;
  const normalized = uniqueSorted(entry[field]);
  if (!allowEmpty && normalized.length === 0) return null;
  return normalized;
}

function authorityMetadata(entry) {
  return {
    executionOwner: entry.executionOwner,
    executionOwners: uniqueSorted(entry.executionOwners),
    sourceRefs: uniqueSorted(entry.sourceRefs),
    domains: uniqueSorted(entry.domains),
    ownerHints: uniqueSorted(entry.ownerHints),
    cost: entry.cost,
    platforms: uniqueSorted(entry.platforms),
    resourceLocks: uniqueSorted(entry.resourceLocks),
    tiers: uniqueSorted(entry.tiers),
    ciProfiles: uniqueSorted(entry.ciProfiles),
    routeIds: uniqueSorted(entry.routeIds),
    safetyContributorRouteIds: uniqueSorted(entry.safetyContributorRouteIds),
    entrypointPolicy: structuredClone(entry.entrypointPolicy),
    provenance: {
      routeIds: uniqueSorted(entry.provenance?.routeIds),
      safetyContributorRouteIds: uniqueSorted(entry.provenance?.safetyContributorRouteIds),
    },
    disposition: entry.disposition,
    batchSafe: entry.batchSafe,
    isolation: entry.isolation,
    maxLeaves: entry.maxLeaves,
    maxArgvBytes: entry.maxArgvBytes,
  };
}

function validateAuthorityContributor(entry, expectedDisposition, platform, routeGaps, field) {
  const commandRef = typeof entry?.commandRef === "string" ? entry.commandRef.trim() : "";
  if (!commandRef) {
    routeGaps.push(planGap("adaptive-selection-authority-field", field, "commandRef"));
    return null;
  }
  const executionOwners = requiredStringArray(entry, "executionOwners", {
    allowEmpty: expectedDisposition === "blocked",
  });
  const sourceRefs = requiredStringArray(entry, "sourceRefs");
  const domains = requiredStringArray(entry, "domains");
  const ownerHints = requiredStringArray(entry, "ownerHints");
  const platforms = requiredStringArray(entry, "platforms");
  const resourceLocks = requiredStringArray(entry, "resourceLocks", { allowEmpty: true });
  const tiers = requiredStringArray(entry, "tiers");
  const ciProfiles = requiredStringArray(entry, "ciProfiles");
  const routeIds = requiredStringArray(entry, "routeIds");
  const safetyContributorRouteIds = requiredStringArray(entry, "safetyContributorRouteIds");
  const provenanceRouteIds = requiredStringArray(entry?.provenance, "routeIds");
  const provenanceSafetyIds = requiredStringArray(entry?.provenance, "safetyContributorRouteIds");
  const missing = [
    ["executionOwners", executionOwners],
    ["sourceRefs", sourceRefs],
    ["domains", domains],
    ["ownerHints", ownerHints],
    ["platforms", platforms],
    ["resourceLocks", resourceLocks],
    ["tiers", tiers],
    ["ciProfiles", ciProfiles],
    ["routeIds", routeIds],
    ["safetyContributorRouteIds", safetyContributorRouteIds],
    ["provenance.routeIds", provenanceRouteIds],
    ["provenance.safetyContributorRouteIds", provenanceSafetyIds],
  ].find(([, value]) => value === null);
  if (missing) {
    routeGaps.push(planGap("adaptive-selection-authority-field", commandRef, `${field}.${missing[0]}`));
    return null;
  }
  if (typeof entry.executionOwner !== "string" || !AUTHORITY_DISPOSITIONS.has(entry.executionOwner)) {
    routeGaps.push(planGap("adaptive-selection-authority-field", commandRef, `${field}.executionOwner`));
    return null;
  }
  if (typeof entry.cost !== "string" || !entry.cost.trim()) {
    routeGaps.push(planGap("adaptive-selection-authority-field", commandRef, `${field}.cost`));
    return null;
  }
  const entrypointPolicy = entry.entrypointPolicy;
  if (!entrypointPolicy
    || entrypointPolicy.schemaVersion !== 1
    || !Array.isArray(entrypointPolicy.eligibleEntrypoints)
    || entrypointPolicy.eligibleEntrypoints.length === 0
    || !["local", "pr", "nightly", "release"].includes(entrypointPolicy.minimumDepth)
    || typeof entrypointPolicy.executionTarget !== "string"
    || !["planned", "blocked"].includes(entrypointPolicy.plannerDisposition)
    || (entrypointPolicy.plannerDisposition === "planned" && entrypointPolicy.blockedReason !== null)
    || (entrypointPolicy.plannerDisposition === "blocked"
      && (typeof entrypointPolicy.blockedReason !== "string" || !entrypointPolicy.blockedReason))
    || (entrypointPolicy.minimumDepth === "local" && entrypointPolicy.deferredReason !== null)
    || (entrypointPolicy.minimumDepth !== "local" && typeof entrypointPolicy.deferredReason !== "string")) {
    routeGaps.push(planGap("adaptive-selection-authority-field", commandRef, `${field}.entrypointPolicy`));
    return null;
  }
  if (!AUTHORITY_DISPOSITIONS.has(entry.disposition)) {
    routeGaps.push(planGap("adaptive-selection-authority-field", commandRef, `${field}.disposition`));
    return null;
  }
  if (entry.disposition !== expectedDisposition) {
    routeGaps.push(planGap(
      "adaptive-selection-cross-disposition",
      commandRef,
      `field=${field};expected=${expectedDisposition};actual=${entry.disposition}`,
    ));
    return null;
  }
  const classifiedOwner = classifyExecutionOwners(executionOwners);
  if (entry.executionOwner !== classifiedOwner || entry.executionOwner !== expectedDisposition) {
    routeGaps.push(planGap(
      "adaptive-selection-disposition-owner-mismatch",
      commandRef,
      `disposition=${expectedDisposition};executionOwner=${entry.executionOwner};owners=${executionOwners.join("+")}`,
    ));
    return null;
  }
  if (JSON.stringify(routeIds) !== JSON.stringify(provenanceRouteIds)
    || JSON.stringify(safetyContributorRouteIds) !== JSON.stringify(provenanceSafetyIds)
    || routeIds.some((routeId) => !safetyContributorRouteIds.includes(routeId))) {
    routeGaps.push(planGap("adaptive-selection-authority-conflict", commandRef, "provenance"));
    return null;
  }
  if (typeof entry.batchSafe !== "boolean"
    || !EXECUTION_ISOLATIONS.has(entry.isolation)
    || !Number.isInteger(entry.maxLeaves)
    || entry.maxLeaves <= 0
    || !Number.isInteger(entry.maxArgvBytes)
    || entry.maxArgvBytes <= 0) {
    routeGaps.push(planGap("adaptive-selection-authority-field", commandRef, `${field}.groupBudget`));
    return null;
  }
  if ((entry.batchSafe && entry.isolation !== "batch") || (!entry.batchSafe && entry.isolation === "batch")) {
    routeGaps.push(planGap("adaptive-selection-authority-conflict", commandRef, "batchSafe/isolation"));
    return null;
  }
  return {
    commandRef,
    ...authorityMetadata(entry),
  };
}

function resolveSelectionAuthority(report, { platform = process.platform } = {}) {
  const routeGaps = [];
  if (report.selectionPlatform !== platform) {
    routeGaps.push(planGap(
      "adaptive-selection-platform-mismatch",
      "selection-artifact",
      `current=${platform};artifact=${String(report.selectionPlatform || "missing")}`,
    ));
  }
  const laneDefinitions = [
    ["childAgentStaticTasks", "child-safe"],
    ["mainThreadSerialVerification", "main-thread"],
    ["ciOnlyVerification", "ci-only"],
    ["blockedVerification", "blocked"],
  ];
  const recommendedByCommand = new Map();
  for (const [index, entry] of (report.recommendedCommands || []).entries()) {
    const normalized = validateAuthorityContributor(
      entry,
      entry?.disposition,
      platform,
      routeGaps,
      `recommendedCommands[${index}]`,
    );
    if (!normalized) continue;
    if (recommendedByCommand.has(normalized.commandRef)) {
      routeGaps.push(planGap("adaptive-selection-authority-conflict", normalized.commandRef, "duplicate-recommended-command"));
      continue;
    }
    recommendedByCommand.set(normalized.commandRef, normalized);
  }

  const byDisposition = new Map(laneDefinitions.map(([, disposition]) => [disposition, []]));
  const observedDisposition = new Map();
  for (const [field, disposition] of laneDefinitions) {
    if (!Array.isArray(report[field])) {
      routeGaps.push(planGap("adaptive-selection-authority-field", "selection-artifact", field));
      continue;
    }
    for (const [index, entry] of report[field].entries()) {
      const normalized = validateAuthorityContributor(entry, disposition, platform, routeGaps, `${field}[${index}]`);
      if (!normalized) continue;
      const priorDisposition = observedDisposition.get(normalized.commandRef);
      if (priorDisposition && priorDisposition !== disposition) {
        routeGaps.push(planGap(
          "adaptive-selection-cross-disposition",
          normalized.commandRef,
          `${priorDisposition}->${disposition}`,
        ));
        continue;
      }
      observedDisposition.set(normalized.commandRef, disposition);
      const recommended = recommendedByCommand.get(normalized.commandRef);
      if (!recommended) {
        routeGaps.push(planGap("adaptive-selection-authority-missing-recommendation", normalized.commandRef, field));
        continue;
      }
      if (JSON.stringify(authorityMetadata(recommended)) !== JSON.stringify(authorityMetadata(normalized))) {
        routeGaps.push(planGap("adaptive-selection-authority-conflict", normalized.commandRef, field));
        continue;
      }
      byDisposition.get(disposition).push(normalized);
    }
  }
  for (const [commandRef, recommended] of recommendedByCommand) {
    if (observedDisposition.get(commandRef) !== recommended.disposition) {
      routeGaps.push(planGap(
        "adaptive-selection-authority-missing-contributor",
        commandRef,
        `disposition=${recommended.disposition}`,
      ));
    }
  }
  return { byDisposition, recommendedByCommand, routeGaps };
}

function validateSelectionArtifactProvenance(report, authority, { platform = process.platform } = {}) {
  const routeGaps = [];
  const expectedFiles = normalizeChangedFiles(report.changedFiles);
  const unmatchedFiles = new Set(normalizeChangedFiles(report.unmatchedChangedFiles));
  const observedFiles = new Set();
  const routeIdsByCommand = new Map();
  for (const [index, entry] of report.matchedByFile.entries()) {
    const normalizedFile = normalizeChangedFiles([entry?.changedFile])[0] || "";
    if (!normalizedFile || !expectedFiles.includes(normalizedFile) || observedFiles.has(normalizedFile)) {
      routeGaps.push(planGap(
        "adaptive-selection-provenance-conflict",
        normalizedFile || `matchedByFile[${index}]`,
        "unknown-or-duplicate-changed-file",
      ));
      continue;
    }
    observedFiles.add(normalizedFile);
    // Recompute from the shared source rules; artifact-provided classifications
    // must never exempt an unknown executable file from route provenance.
    const nonBehavioral = Boolean(nonBehavioralClassification(normalizedFile));
    const matchedRouteIds = requiredStringArray(entry, "matchedRouteIds", {
      allowEmpty: unmatchedFiles.has(normalizedFile) || nonBehavioral,
    });
    if (matchedRouteIds === null || !Array.isArray(entry.recommendedCommands)) {
      routeGaps.push(planGap("adaptive-selection-provenance-field", normalizedFile, `matchedByFile[${index}]`));
      continue;
    }
    const explicitRouteGap = (report.localEntrypointRouteGaps || []).some((gap) => (
      gap?.commandRef === normalizedFile
        || String(gap?.detail || "").includes(`changed-file=${normalizedFile}`)
    ));
    if (!unmatchedFiles.has(normalizedFile)
      && !nonBehavioral
      && (matchedRouteIds.length === 0 || (entry.recommendedCommands.length === 0 && !explicitRouteGap))) {
      routeGaps.push(planGap("adaptive-selection-provenance-empty", normalizedFile, `matchedByFile[${index}]`));
      continue;
    }
    for (const [commandIndex, command] of entry.recommendedCommands.entries()) {
      const normalized = validateAuthorityContributor(
        command,
        command?.disposition,
        platform,
        routeGaps,
        `matchedByFile[${index}].recommendedCommands[${commandIndex}]`,
      );
      if (!normalized) continue;
      const recommended = authority.recommendedByCommand.get(normalized.commandRef);
      if (!recommended) {
        routeGaps.push(planGap("adaptive-selection-provenance-conflict", normalized.commandRef, normalizedFile));
        continue;
      }
      if (normalized.routeIds.some((routeId) => !matchedRouteIds.includes(routeId))) {
        routeGaps.push(planGap("adaptive-selection-provenance-conflict", normalized.commandRef, `${normalizedFile}:routeIds`));
      }
      const observedRouteIds = routeIdsByCommand.get(normalized.commandRef) || new Set();
      for (const routeId of normalized.routeIds) observedRouteIds.add(routeId);
      routeIdsByCommand.set(normalized.commandRef, observedRouteIds);
    }
  }
  for (const changedFile of expectedFiles) {
    if (!observedFiles.has(changedFile)) {
      routeGaps.push(planGap("adaptive-selection-provenance-missing-file", changedFile));
    }
  }
  for (const [commandRef, recommended] of authority.recommendedByCommand) {
    const observedRouteIds = routeIdsByCommand.get(commandRef) || new Set();
    if (recommended.routeIds.some((routeId) => !observedRouteIds.has(routeId))) {
      routeGaps.push(planGap("adaptive-selection-provenance-missing-route", commandRef));
    }
  }
  return routeGaps;
}

export function planExecutionLaneFromPackageScripts({
  disposition,
  rootContributors,
  packageScripts,
}) {
  const plannedRoots = [];
  const routeGaps = [];
  for (const root of rootContributors) {
    try {
      plannedRoots.push({
        commandRef: root.commandRef,
        expandedCommands: expandCommandAliases(root.commandRef, packageScripts),
      });
    } catch (error) {
      routeGaps.push(planGap(error.code || "adaptive-plan-error", root.commandRef, error.message));
      plannedRoots.push({ commandRef: root.commandRef, expandedCommands: [] });
    }
  }
  return {
    schemaVersion: EXECUTION_PLANNER_SCHEMA_VERSION,
    disposition,
    plannedRoots,
    routeGaps,
  };
}

function projectCanonicalLane({
  disposition,
  rootContributors,
  preparedCatalog,
  executionPlanner,
  platform,
  routeGaps,
  plannerInvocations,
}) {
  const rootCommandRefs = rootContributors.map((entry) => entry.commandRef);
  plannerInvocations.push({ disposition, rootCommandRefs: [...rootCommandRefs] });
  let effectiveRootContributors = rootContributors;
  let platformDeferredContributors = [];
  const invokePlanner = (contributors, plannerPlatform) => {
    const maxLeaves = Math.min(HARD_MAX_GROUP_LEAVES, ...contributors.map((entry) => entry.maxLeaves));
    const platformArgvLimit = platform === "win32" ? WINDOWS_MAX_ARGV_BYTES : POSIX_MAX_ARGV_BYTES;
    const maxArgvBytes = Math.min(platformArgvLimit, ...contributors.map((entry) => entry.maxArgvBytes));
    return executionPlanner(
      preparedCatalog.catalog,
      contributors.map((entry) => structuredClone(entry)),
      {
        preparedCatalog,
        disposition,
        platform: plannerPlatform,
        maxLeaves: Number.isFinite(maxLeaves) ? maxLeaves : HARD_MAX_GROUP_LEAVES,
        maxArgvBytes: Number.isFinite(maxArgvBytes) ? maxArgvBytes : platformArgvLimit,
      },
    );
  };
  let plan;
  try {
    plan = invokePlanner(effectiveRootContributors, platform);
  } catch (error) {
    const code = error.code || String(error.message || "adaptive-execution-planner-error").split(":")[0];
    if (!disposition.startsWith("deferred-") || code !== "verification-plan-platform-mismatch") {
      routeGaps.push(planGap(code, disposition, error.message));
      return { plan: null, leaves: [], groups: [], platformDeferredContributors: [] };
    }
    let crossPlatformPlan;
    try {
      plannerInvocations.push({
        disposition: `${disposition}-platform-classification`,
        rootCommandRefs: [...rootCommandRefs],
      });
      crossPlatformPlan = invokePlanner(rootContributors, null);
    } catch (classificationError) {
      const classificationCode = classificationError.code
        || String(classificationError.message || "adaptive-execution-planner-error").split(":")[0];
      routeGaps.push(planGap(classificationCode, disposition, classificationError.message));
      return { plan: null, leaves: [], groups: [], platformDeferredContributors: [] };
    }
    if (!crossPlatformPlan || !Array.isArray(crossPlatformPlan.executions)) {
      routeGaps.push(planGap("adaptive-execution-planner-contract", disposition, "invalid-platform-classification"));
      return { plan: null, leaves: [], groups: [], platformDeferredContributors: [] };
    }
    const incompatiblePlatformsByRoot = new Map();
    for (const execution of crossPlatformPlan.executions) {
      if ((execution.platforms || []).includes("all") || (execution.platforms || []).includes(platform)) continue;
      for (const provenance of execution.provenance || []) {
        if (!provenance.rootCommandRef) continue;
        const requiredPlatforms = incompatiblePlatformsByRoot.get(provenance.rootCommandRef) || new Set();
        for (const requiredPlatform of execution.platforms || []) requiredPlatforms.add(requiredPlatform);
        incompatiblePlatformsByRoot.set(provenance.rootCommandRef, requiredPlatforms);
      }
    }
    if (incompatiblePlatformsByRoot.size === 0) {
      routeGaps.push(planGap(code, disposition, error.message));
      return { plan: null, leaves: [], groups: [], platformDeferredContributors: [] };
    }
    platformDeferredContributors = rootContributors
      .filter((entry) => incompatiblePlatformsByRoot.has(entry.commandRef))
      .map((entry) => ({
        ...entry,
        platformDeferredPlatforms: uniqueSorted([
          ...(incompatiblePlatformsByRoot.get(entry.commandRef) || []),
        ]),
      }));
    effectiveRootContributors = rootContributors.filter((entry) => (
      !incompatiblePlatformsByRoot.has(entry.commandRef)
    ));
    plannerInvocations.push({
      disposition: `${disposition}-platform-compatible`,
      rootCommandRefs: effectiveRootContributors.map((entry) => entry.commandRef),
    });
    try {
      plan = invokePlanner(effectiveRootContributors, platform);
    } catch (retryError) {
      const retryCode = retryError.code
        || String(retryError.message || "adaptive-execution-planner-error").split(":")[0];
      routeGaps.push(planGap(retryCode, disposition, retryError.message));
      return { plan: null, leaves: [], groups: [], platformDeferredContributors };
    }
  }
  if (!plan
    || plan.schemaVersion !== 1
    || plan.kind !== "verification-selection-plan"
    || plan.status !== "ready"
    || plan.catalogDigest !== preparedCatalog.catalogDigest
    || !Array.isArray(plan.requestedCommandRefs)
    || !Array.isArray(plan.selectedCommandRefs)
    || !Array.isArray(plan.rootRecords)
    || !Array.isArray(plan.normalizedLeaves)
    || !Array.isArray(plan.executions)
    || !Array.isArray(plan.dependencyEdges)
    || !Array.isArray(plan.resourceLockGroups)) {
    routeGaps.push(planGap("adaptive-execution-planner-contract", disposition, "invalid-final-plan"));
    return { plan: null, leaves: [], groups: [], platformDeferredContributors };
  }
  const effectiveRootCommandRefs = effectiveRootContributors.map((entry) => entry.commandRef);
  if (JSON.stringify(plan.requestedCommandRefs) !== JSON.stringify(effectiveRootCommandRefs)) {
    routeGaps.push(planGap("adaptive-execution-planner-contract", disposition, "requested-root-drift"));
    return { plan: null, leaves: [], groups: [], platformDeferredContributors };
  }
  const contributorsByCommand = new Map(effectiveRootContributors.map((entry) => [entry.commandRef, entry]));
  const groups = plan.executions.map((execution) => {
    const sourceRootRefs = uniqueSorted(execution.provenance.map((entry) => entry.rootCommandRef));
    const contributors = sourceRootRefs.map((commandRef) => contributorsByCommand.get(commandRef)).filter(Boolean);
    const routeIds = uniqueSorted(execution.provenance.flatMap((entry) => entry.routeIds || []));
    const safetyContributorRouteIds = uniqueSorted(
      execution.provenance.flatMap((entry) => entry.safetyContributorRouteIds || []),
    );
    return {
      disposition,
      kind: execution.runner,
      commandRef: formatCommandTokens([execution.executable, ...execution.effectiveArgv]),
      rootCommandRef: sourceRootRefs[0] || null,
      sourceRootRefs,
      sourceCommandRefs: sourceRootRefs,
      sourceRefs: uniqueSorted(contributors.flatMap((entry) => entry.sourceRefs)),
      process: { bin: execution.executable, args: [...execution.effectiveArgv] },
      processRef: execution.executionId,
      processClass: execution.processClass,
      isolation: execution.isolation,
      groupId: execution.executionId,
      executionGroupRef: execution.executionId,
      canonicalLeafRefs: [...execution.leafKeys],
      leafIds: [...execution.leafKeys],
      files: [...execution.files],
      modules: [...execution.modules],
      specs: [...execution.specs],
      routeIds,
      safetyContributorRouteIds,
      resourceLocks: [...execution.resourceLocks],
      executionOwner: execution.executionOwner,
      executionOwners: uniqueSorted(contributors.flatMap((entry) => entry.executionOwners)),
      platforms: [...execution.platforms],
      tiers: [...execution.tiers],
      ciProfiles: [...execution.ciProfiles],
      domains: [...execution.domains],
      cost: execution.cost,
      leafCount: execution.leafCount,
      argvBytes: execution.argvBytes,
      maxLeaves: execution.maxLeaves,
      maxArgvBytes: execution.maxArgvBytes,
      provenance: structuredClone(execution.provenance),
      dependencyEdges: plan.dependencyEdges.filter((edge) => (
        edge.from === execution.executionId || edge.to === execution.executionId
      )),
      sourceOrder: execution.order,
    };
  });
  const groupByLeaf = new Map(groups.flatMap((group) => (
    group.leafIds.map((leafId) => [leafId, group])
  )));
  const leaves = plan.normalizedLeaves.map((leafId, sequence) => {
    const group = groupByLeaf.get(leafId);
    if (!group) {
      routeGaps.push(planGap("adaptive-execution-planner-contract", disposition, `unprojected-leaf:${leafId}`));
      return null;
    }
    const separator = leafId.indexOf(":");
    return {
      leafId,
      canonicalLeafRef: leafId,
      kind: separator === -1 ? group.kind : leafId.slice(0, separator),
      target: separator === -1 ? leafId : leafId.slice(separator + 1),
      disposition,
      authorityDisposition: disposition,
      executionOwner: group.executionOwner,
      executionOwners: [...group.executionOwners],
      platforms: [...group.platforms],
      resourceLocks: [...group.resourceLocks],
      tiers: [...group.tiers],
      ciProfiles: [...group.ciProfiles],
      isolation: group.isolation,
      batchSafe: group.isolation === "batch",
      maxLeaves: group.maxLeaves,
      maxArgvBytes: group.maxArgvBytes,
      sourceCommandRefs: [...group.sourceCommandRefs],
      sourceRootRefs: [...group.sourceRootRefs],
      routeIds: [...group.routeIds],
      safetyContributorRouteIds: [...group.safetyContributorRouteIds],
      aliasPaths: group.provenance.map((entry) => entry.expansionPath),
      processKeys: [group.processRef],
      executionGroupRef: group.executionGroupRef,
      processRef: group.processRef,
      processClass: group.processClass,
      files: [...group.files],
      modules: [...group.modules],
      specs: [...group.specs],
      provenance: structuredClone(group.provenance),
      dependencyEdges: structuredClone(group.dependencyEdges),
      sourceOrder: group.sourceOrder,
      sequence,
    };
  }).filter(Boolean);
  return { plan, leaves, groups, platformDeferredContributors };
}

function prepareAdaptiveCatalog(report, packageScripts, platform) {
  if (Array.isArray(report.routeAuthority) && report.routeAuthority.length > 0) {
    return prepareVerificationCatalog({
      packageScripts,
      authority: report.routeAuthority,
      selectorCommandRefs: report.routeAuthority.map((entry) => entry.commandRef),
      platform,
      sourceMode: "fixture",
    });
  }
  const selectorRoutes = (report.recommendedCommands || []).map((entry, index) => ({
    ...structuredClone(entry),
    id: entry.routeIds?.[0] || `adaptive-fixture:${String(index + 1).padStart(4, "0")}`,
    authoritySource: "selector-route",
  }));
  return prepareVerificationCatalog({
    packageScripts,
    selectorRoutes,
    selectorCommandRefs: selectorRoutes.map((entry) => entry.commandRef),
    platform,
    sourceMode: "fixture",
  });
}

function buildCanonicalProfileProjection(groups) {
  return groups.flatMap((group) => group.leafIds.map((leafId, leafIndex) => {
    const separator = leafId.indexOf(":");
    const kind = separator === -1 ? group.kind : leafId.slice(0, separator);
    const target = separator === -1 ? leafId : leafId.slice(separator + 1);
    const files = group.files.filter((file) => file === target);
    const modules = group.modules.filter((moduleName) => moduleName === target);
    const specs = group.specs.filter((spec) => spec === target);
    return {
      rootCommandRef: group.rootCommandRef,
      sourceRootRefs: [...group.sourceRootRefs],
      canonicalLeafRef: leafId,
      leafId,
      kind,
      executionGroupRef: group.executionGroupRef,
      groupId: group.groupId,
      files,
      modules,
      specs,
      processRef: group.processRef,
      processClass: group.processClass,
      isolation: group.isolation,
      disposition: group.disposition,
      executionOwner: group.executionOwner,
      executionOwners: [...group.executionOwners],
      platforms: [...group.platforms],
      resourceLocks: [...group.resourceLocks],
      routeIds: [...group.routeIds],
      safetyContributorRouteIds: [...group.safetyContributorRouteIds],
      provenance: structuredClone(group.provenance),
      dependencyEdges: structuredClone(group.dependencyEdges),
      sourceOrder: group.sourceOrder * HARD_MAX_GROUP_LEAVES + leafIndex,
    };
  }));
}

export function buildExecutionPlan(report, {
  includeMainThread = false,
  packageScripts = readPackageScripts(),
  platform = process.platform,
  preparedCatalog = null,
  executionPlanner = buildVerificationSelectionPlan,
  requiredCanonicalCommandRefs = [],
} = {}) {
  const authority = resolveSelectionAuthority(report, { platform });
  const routeGaps = [
    ...authority.routeGaps,
    ...(report.localEntrypointRouteGaps || []),
    ...(report.blockedVerification || []).map((entry) => (
    planGap("adaptive-route-owner-gap", entry.commandRef, entry.reason)
    )),
  ];
  let currentPreparedCatalog = preparedCatalog;
  try {
    currentPreparedCatalog ||= prepareAdaptiveCatalog(report, packageScripts, platform);
    if (preparedCatalog
      && (preparedCatalog.sourceMode === "repository" || report.catalogDigest !== undefined)) {
      routeGaps.push(...validateSelectionCatalogBinding(report, preparedCatalog));
    }
  } catch (error) {
    routeGaps.push(planGap(
      error.code || String(error.message || "adaptive-catalog-preparation-error").split(":")[0],
      "verification-catalog",
      error.message,
    ));
  }
  const canonicalPolicyByCommand = new Map((currentPreparedCatalog?.authority || []).map((entry) => (
    [entry.commandRef, entry.entrypointPolicy]
  )));
  const canonicalBlockedCommands = new Map();
  for (const commandRef of authority.recommendedByCommand.keys()) {
    const policy = canonicalPolicyByCommand.get(commandRef);
    if (policy?.plannerDisposition !== "blocked") continue;
    canonicalBlockedCommands.set(commandRef, policy.blockedReason);
    routeGaps.push(planGap(
      "adaptive-canonical-command-blocked",
      commandRef,
      `reason=${policy.blockedReason};catalog=${currentPreparedCatalog?.catalogDigest || "missing"}`,
    ));
  }
  const childSafeContributors = authority.byDisposition.get("child-safe") || [];
  const mainThreadContributors = authority.byDisposition.get("main-thread") || [];
  const ciOnlyContributors = authority.byDisposition.get("ci-only") || [];
  const childSafeCommands = childSafeContributors.map((entry) => entry.commandRef);
  const mainThreadCommands = mainThreadContributors.map((entry) => entry.commandRef);
  const ciOnlyCommands = ciOnlyContributors.map((entry) => entry.commandRef);
  const supportsCurrentPlatform = (entry) => (
    entry.platforms.includes("all") || entry.platforms.includes(platform)
  );
  const selectedAuthorityContributors = includeMainThread
    ? [...childSafeContributors, ...mainThreadContributors]
    : childSafeContributors;
  for (const entry of selectedAuthorityContributors.filter((candidate) => !supportsCurrentPlatform(candidate))) {
    routeGaps.push(planGap(
      "adaptive-selection-platform-mismatch",
      entry.commandRef,
      `current=${platform};artifact=${entry.platforms.join("+")}`,
    ));
  }
  const contributorsFor = (entries, executionDisposition) => entries.map((entry) => ({
    ...entry,
    executionDisposition,
  }));
  const selectedContributors = contributorsFor(
    selectedAuthorityContributors.filter(supportsCurrentPlatform),
    "selected",
  );
  const requiredRefs = Array.isArray(requiredCanonicalCommandRefs)
    && requiredCanonicalCommandRefs.every((ref) => typeof ref === "string" && ref.trim())
    ? uniqueSorted(requiredCanonicalCommandRefs) : [];
  if (!Array.isArray(requiredCanonicalCommandRefs) || requiredRefs.length !== requiredCanonicalCommandRefs.length) {
    routeGaps.push(planGap("adaptive-required-roots-invalid", "requiredCanonicalCommandRefs", "expected-unique-command-refs"));
  }
  for (const commandRef of requiredRefs) {
    const matches = (currentPreparedCatalog?.authority || []).filter((entry) => entry.commandRef === commandRef);
    const entry = matches[0];
    if (matches.length !== 1 || !entry.metadataComplete) {
      routeGaps.push(planGap("adaptive-required-root-authority-missing", commandRef, "expected-one-complete-canonical-authority"));
      continue;
    }
    const contributor = validateAuthorityContributor({
      ...entry,
      disposition: entry.executionOwner,
      provenance: { routeIds: entry.routeIds, safetyContributorRouteIds: entry.safetyContributorRouteIds },
      batchSafe: false,
      isolation: "process",
      maxLeaves: HARD_MAX_GROUP_LEAVES,
      maxArgvBytes: platform === "win32" ? WINDOWS_MAX_ARGV_BYTES : POSIX_MAX_ARGV_BYTES,
    }, "child-safe", platform, routeGaps, "requiredCanonicalCommandRefs");
    if (!contributor) continue;
    if (!supportsCurrentPlatform(contributor) || contributor.entrypointPolicy.executionTarget !== "child-safe"
      || contributor.entrypointPolicy.plannerDisposition !== "planned") {
      routeGaps.push(planGap("adaptive-required-root-not-executable", commandRef, "requires-child-safe-current-platform-planned-authority"));
      continue;
    }
    if (!selectedContributors.some((candidate) => candidate.commandRef === commandRef)) {
      selectedContributors.push({ ...contributor, executionDisposition: "selected" });
    }
  }
  const deferredMainContributors = contributorsFor(
    includeMainThread ? [] : mainThreadContributors,
    "deferred-main-thread",
  );
  const deferredCiContributors = contributorsFor(
    ciOnlyContributors,
    "deferred-ci-only",
  );
  const plannerInvocations = [];
  let selectedProjection = { plan: null, leaves: [], groups: [], platformDeferredContributors: [] };
  let deferredMainProjection = { plan: null, leaves: [], groups: [], platformDeferredContributors: [] };
  let deferredCiProjection = { plan: null, leaves: [], groups: [], platformDeferredContributors: [] };
  if (routeGaps.length === 0 && currentPreparedCatalog) {
    selectedProjection = projectCanonicalLane({
      disposition: "selected",
      rootContributors: selectedContributors,
      preparedCatalog: currentPreparedCatalog,
      executionPlanner,
      platform,
      routeGaps,
      plannerInvocations,
    });
    deferredMainProjection = projectCanonicalLane({
      disposition: "deferred-main-thread",
      rootContributors: deferredMainContributors,
      preparedCatalog: currentPreparedCatalog,
      executionPlanner,
      platform,
      routeGaps,
      plannerInvocations,
    });
    deferredCiProjection = projectCanonicalLane({
      disposition: "deferred-ci-only",
      rootContributors: deferredCiContributors,
      preparedCatalog: currentPreparedCatalog,
      executionPlanner,
      platform,
      routeGaps,
      plannerInvocations,
    });
  }
  const platformDeferredMainContributors = deferredMainProjection.platformDeferredContributors || [];
  const platformDeferredCiContributors = deferredCiProjection.platformDeferredContributors || [];
  const selectedLeaves = selectedProjection.leaves;
  const deferredMainThreadLeaves = deferredMainProjection.leaves;
  const deferredCiOnlyLeaves = deferredCiProjection.leaves;
  const requiredRefSet = new Set(requiredRefs);
  const deferredLeafIds = new Set([...deferredMainThreadLeaves, ...deferredCiOnlyLeaves].map((leaf) => leaf.leafId));
  for (const leaf of selectedLeaves) {
    if (deferredLeafIds.has(leaf.leafId) && leaf.sourceCommandRefs.some((ref) => requiredRefSet.has(ref))) {
      routeGaps.push(planGap("adaptive-required-root-deferred-conflict", leaf.sourceCommandRefs.join(","), `leaf=${leaf.leafId}`));
    }
  }
  for (const [disposition, leaves] of [
    ["selected", selectedLeaves],
    ["deferred-main-thread", deferredMainThreadLeaves],
    ["deferred-ci-only", deferredCiOnlyLeaves],
  ]) {
    const laneLeafIds = new Set();
    for (const leaf of leaves) {
      if (laneLeafIds.has(leaf.leafId)) {
        routeGaps.push(planGap(
          "adaptive-leaf-duplicate",
          leaf.sourceCommandRefs.join(","),
          `leaf=${JSON.stringify(leaf.leafId)};disposition=${disposition}`,
        ));
      }
      laneLeafIds.add(leaf.leafId);
    }
  }
  const executionGroups = selectedProjection.groups;
  const deferredMainThreadGroups = deferredMainProjection.groups;
  const deferredCiOnlyGroups = deferredCiProjection.groups;
  const superseded = (projection) => (projection.plan?.rootRecords || [])
    .filter((entry) => entry.disposition === "superseded")
    .map(({ commandRef, supersededBy }) => ({ commandRef, supersededBy }));
  const plannedOutcomeByCommand = new Map();
  for (const [disposition, projection] of [
    ["requested", selectedProjection],
    ["deferred-main-thread", deferredMainProjection],
    ["deferred-ci-only", deferredCiProjection],
  ]) {
    for (const rootRecord of projection.plan?.rootRecords || []) {
      plannedOutcomeByCommand.set(rootRecord.commandRef, {
        commandRef: rootRecord.commandRef,
        disposition: rootRecord.disposition === "superseded" ? `${disposition}-superseded` : disposition,
        ...(rootRecord.supersededBy ? { supersededBy: rootRecord.supersededBy } : {}),
      });
    }
  }
  for (const [disposition, contributors] of [
    ["deferred-main-thread-platform", platformDeferredMainContributors],
    ["deferred-ci-only-platform", platformDeferredCiContributors],
  ]) {
    for (const contributor of contributors) {
      plannedOutcomeByCommand.set(contributor.commandRef, {
        commandRef: contributor.commandRef,
        disposition,
        currentPlatform: platform,
        requiredPlatforms: [...(contributor.platformDeferredPlatforms || contributor.platforms)],
      });
    }
  }
  const deferredByCommand = new Map((report.deferredByTier || []).map((entry) => [entry.commandRef, entry]));
  const rawLocalEligibleRefs = new Set((report.rawLocalEligibleRoots || []).map((entry) => entry.commandRef));
  const projectedRootRefs = uniqueSorted([...authority.recommendedByCommand.keys()]);
  const selectorRootRefs = uniqueSorted([
    ...(report.rawCanonicalRoots || []).map((entry) => entry.commandRef),
    ...authority.recommendedByCommand.keys(),
  ]);
  const selectorRootOutcomes = selectorRootRefs.map((commandRef) => {
    const blockedReason = canonicalBlockedCommands.get(commandRef);
    if (blockedReason) {
      return { commandRef, disposition: "blocked", reason: blockedReason };
    }
    const deferred = deferredByCommand.get(commandRef);
    // Commit controls are an independent obligation, not promotion of an edit's
    // deferred PR recommendation. Preserve that selector outcome separately.
    if (deferred && requiredRefSet.has(commandRef) && !authority.recommendedByCommand.has(commandRef)) {
      return { commandRef, disposition: "deferred-by-tier", reason: deferred.reason, minimumDepth: deferred.minimumDepth };
    }
    const planned = plannedOutcomeByCommand.get(commandRef);
    if (planned) return planned;
    if (deferred) {
      return {
        commandRef,
        disposition: "deferred-by-tier",
        reason: deferred.reason,
        minimumDepth: deferred.minimumDepth,
      };
    }
    if (report.localLeafEquivalence?.status === "equivalent"
      && rawLocalEligibleRefs.has(commandRef)
      && projectedRootRefs.length > 0) {
      return {
        commandRef,
        disposition: "superseded-by-projection",
        supersededBy: projectedRootRefs,
        proof: "canonical-local-leaf-equivalence",
      };
    }
    const matchingGap = routeGaps.find((gap) => gap.commandRef === commandRef);
    if (matchingGap) {
      return { commandRef, disposition: "gap", reason: matchingGap.code };
    }
    if (routeGaps.length > 0) {
      routeGaps.push(planGap(
        "adaptive-selector-root-blocked-by-plan-gap",
        commandRef,
        `blocking-gaps=${uniqueSorted(routeGaps.map((gap) => gap.code)).join(",")}`,
      ));
      return { commandRef, disposition: "blocked", reason: "planning-gap" };
    }
    routeGaps.push(planGap("adaptive-selector-root-unaccounted", commandRef, "canonical-outcome=missing"));
    return { commandRef, disposition: "gap", reason: "adaptive-selector-root-unaccounted" };
  });
  const uniqueRouteGaps = [...new Map(routeGaps.map((gap) => [
    `${gap.code}\u0000${gap.commandRef}\u0000${gap.detail}`,
    gap,
  ])).values()];
  const selectionCost = selectorPrCostObservation(report);
  const verificationProfileProjection = buildCanonicalProfileProjection(executionGroups);
  return {
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    plannerSchemaVersion: EXECUTION_PLANNER_SCHEMA_VERSION,
    platform,
    childSafeCommands,
    mainThreadCommands,
    ciOnlyCommands,
    catalogDigest: currentPreparedCatalog?.catalogDigest || null,
    catalogSourceIdentity: currentPreparedCatalog?.sourceIdentity || null,
    gatePolicySignals: report?.gatePolicySignals ? structuredClone(report.gatePolicySignals) : null,
    gatePolicySignalsDigest: report?.gatePolicySignalsDigest || null,
    selectorRootSet: uniqueSorted(report?.selectorRootSet || []),
    requiredCanonicalCommandRefs: requiredRefs,
    requiredRootOutcomes: requiredRefs.map((commandRef) => plannedOutcomeByCommand.get(commandRef)
      || { commandRef, disposition: "gap" }),
    changedFiles: uniqueSorted(report?.changedFiles || []),
    selectorPrCost: selectionCost ? structuredClone(selectionCost) : null,
    selectorPrCostDigest: selectionCost?.observationDigest || null,
    commandsToRun: selectedProjection.plan?.selectedCommandRefs || [],
    supersededCommands: superseded(selectedProjection),
    blockedMainThreadCommands: includeMainThread ? [] : mainThreadCommands,
    platformDeferredMainThreadCommands: platformDeferredMainContributors.map((entry) => entry.commandRef),
    deferredMainThreadSupersededCommands: superseded(deferredMainProjection),
    deferredCiOnlyCommands: ciOnlyCommands,
    platformDeferredCiOnlyCommands: platformDeferredCiContributors.map((entry) => entry.commandRef),
    deferredCiOnlySupersededCommands: superseded(deferredCiProjection),
    selectedLeaves,
    deferredMainThreadLeaves,
    deferredCiOnlyLeaves,
    executionGroups,
    deferredMainThreadGroups,
    deferredCiOnlyGroups,
    verificationProfileProjectionKind: "canonical-final-plan",
    verificationProfileProjection,
    canonicalPlans: {
      selected: selectedProjection.plan,
      deferredMainThread: deferredMainProjection.plan,
      deferredCiOnly: deferredCiProjection.plan,
    },
    executionCommands: uniqueRouteGaps.length > 0 ? [] : executionGroups,
    routeGaps: uniqueRouteGaps,
    selectorRootOutcomes,
    plannerInvocations,
    closure: {
      authorityContributorCount: authority.recommendedByCommand.size,
      selectedRootCount: selectedProjection.plan?.selectedCommandRefs.length || 0,
      selectedLeafCount: selectedLeaves.length,
      executionGroupCount: executionGroups.length,
      deferredMainThreadRootCount: (deferredMainProjection.plan?.selectedCommandRefs.length || 0)
        + platformDeferredMainContributors.length,
      deferredMainThreadLeafCount: deferredMainThreadLeaves.length,
      deferredCiOnlyRootCount: (deferredCiProjection.plan?.selectedCommandRefs.length || 0)
        + platformDeferredCiContributors.length,
      deferredCiOnlyLeafCount: deferredCiOnlyLeaves.length,
      platformDeferredRootCount: platformDeferredMainContributors.length
        + platformDeferredCiContributors.length,
      plannerInvocationCount: plannerInvocations.length,
    },
  };
}

export function applyLocalEntrypointExecutionBudget(executionPlan, entrypoint, {
  preparedCatalog = null,
  limits: limitOverrides = {},
} = {}) {
  if (!new Set(["edit", "impact"]).has(entrypoint)) return executionPlan;
  const limits = { ...LOCAL_ENTRYPOINT_BUDGETS[entrypoint], ...limitOverrides };
  const estimatePolicyGaps = [];
  let estimatePolicy = null;
  if (!preparedCatalog) {
    estimatePolicyGaps.push(planGap(
      `adaptive-${entrypoint}-estimate-policy-authority-missing`,
      entrypoint,
      "prepared-catalog=missing",
    ));
  } else if (!preparedCatalog.catalog?.estimatePolicy) {
    estimatePolicyGaps.push(planGap(
      `adaptive-${entrypoint}-estimate-policy-authority-missing`,
      entrypoint,
      "catalog-policy=missing",
    ));
  } else {
    try {
      assertPreparedVerificationCatalog(preparedCatalog);
      if (executionPlan.catalogDigest && executionPlan.catalogDigest !== preparedCatalog.catalogDigest) {
        throw new Error("verification-plan-estimate-policy-catalog-drift");
      }
      estimatePolicy = preparedCatalog.catalog.estimatePolicy;
    } catch (error) {
      estimatePolicyGaps.push(planGap(
        `adaptive-${entrypoint}-estimate-policy-integrity-mismatch`,
        entrypoint,
        String(error?.message || error),
      ));
    }
  }
  const groupEstimates = (executionPlan.executionGroups || []).map((group) => {
    const costClass = estimatePolicy?.costClasses?.[group.cost];
    const leafCount = Array.isArray(group.leafIds) ? group.leafIds.length : Number(group.leafCount || 0);
    if (!costClass || !Number.isInteger(leafCount) || leafCount < 1) {
      estimatePolicyGaps.push(planGap(
        `adaptive-${entrypoint}-estimate-policy-${costClass ? "leaf-count-invalid" : "unknown-cost"}`,
        group.groupId,
        `cost=${group.cost || "missing"};leaves=${leafCount}`,
      ));
    }
    const calibration = estimatePolicy?.localRuntimeCalibration;
    const calibratedIds = calibration?.platform === preparedCatalog?.catalog?.identity?.platform
      && calibration?.cost === group.cost ? new Set(calibration.leafIds) : new Set();
    const leafRuntimeClasses = (group.leafIds || []).map((id) => calibratedIds.has(id) ? calibration : costClass);
    // Max base plus additive leaf estimates stays monotone for mixed measured
    // and unmeasured groups; cost and execution eligibility remain independent.
    const runtimeSeconds = costClass && leafRuntimeClasses.length === leafCount
      ? Math.max(...leafRuntimeClasses.map((entry) => entry.groupBaseRuntimeSeconds))
        + leafRuntimeClasses.reduce((sum, entry) => sum + entry.perLeafRuntimeSeconds, 0)
      : costClass ? costClass.groupBaseRuntimeSeconds + costClass.perLeafRuntimeSeconds * leafCount
        : limits.maxEstimatedRuntimeSeconds + 1;
    return {
      groupId: group.groupId,
      cost: group.cost,
      leafCount,
      runtimeSeconds,
      costUnits: costClass
        ? costClass.groupBaseCostUnits + costClass.perLeafCostUnits * leafCount
        : limits.maxEstimatedCostUnits + 1,
      estimateAuthority: costClass ? `catalog:${preparedCatalog?.catalogDigest}` : "missing",
    };
  });
  const actual = {
    commandCount: (executionPlan.commandsToRun || []).length,
    leafCount: (executionPlan.selectedLeaves || []).length,
    processGroupCount: (executionPlan.executionGroups || []).length,
    estimatedRuntimeSeconds: groupEstimates.reduce((total, entry) => total + entry.runtimeSeconds, 0),
    estimatedCostUnits: groupEstimates.reduce((total, entry) => total + entry.costUnits, 0),
  };
  const checks = [
    ["command", actual.commandCount, limits.maxCommands],
    ["leaf", actual.leafCount, limits.maxLeaves],
    ["process-group", actual.processGroupCount, limits.maxProcessGroups],
    ["runtime", actual.estimatedRuntimeSeconds, limits.maxEstimatedRuntimeSeconds],
    ["cost", actual.estimatedCostUnits, limits.maxEstimatedCostUnits],
  ];
  const budgetGaps = [
    ...estimatePolicyGaps,
    ...checks
    .filter(([, observed, maximum]) => observed > maximum)
    .map(([dimension, observed, maximum]) => planGap(
      `adaptive-${entrypoint}-${dimension}-budget-exceeded`,
      entrypoint,
      `observed=${observed};maximum=${maximum}`,
    )),
  ];
  const routeGaps = [...(executionPlan.routeGaps || []), ...budgetGaps];
  return {
    ...executionPlan,
    routeGaps,
    executionCommands: routeGaps.length > 0 ? [] : executionPlan.executionCommands,
    localEntrypointBudget: {
      entrypoint,
      limits,
      actual,
      groupEstimates,
      estimatePolicy: estimatePolicy ? {
        schemaVersion: estimatePolicy.schemaVersion,
        kind: estimatePolicy.kind,
        aggregation: estimatePolicy.aggregation,
        catalogDigest: preparedCatalog.catalogDigest,
      } : null,
      status: budgetGaps.length > 0 ? "blocked" : "ready",
    },
  };
}

export function adaptivePlanningExitCode(report, executionPlan) {
  return (report.unmatchedChangedFiles || []).length > 0 || (executionPlan.routeGaps || []).length > 0
    ? 2
    : 0;
}

function renderMarkdown(report, executionResults, executionPlan = null) {
  const lines = [
    "# test-adaptive-selection",
    "",
    `- mode: ${report.adaptiveMode}`,
    `- discoveryMode: ${report.discoveryMode}`,
    `- mainThreadDisposition: ${report.mainThreadDisposition}`,
    "",
    "## Changed files",
    ...(report.changedFiles.length ? report.changedFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    "## Unmatched changed files",
    ...((report.unmatchedChangedFiles || []).length ? report.unmatchedChangedFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    "## Recommended commands",
    ...(report.recommendedCommands.length
      ? report.recommendedCommands.map((entry) => `- ${entry.commandRef} (${entry.executionOwners.join("+")}; ${entry.reason})`)
      : ["- none"]),
  ];
  lines.push(
    "",
    "## Diagnostic next steps",
    ...((report.diagnosticNextSteps || []).length
      ? report.diagnosticNextSteps.map((entry) => `- ${entry.commandRef} (${entry.executionOwners.join("+")}; locks=${entry.resourceLocks.join("+") || "none"})`)
      : ["- none"]),
    "",
    "## Advisory notes",
    ...((report.advisoryNotes || []).length ? report.advisoryNotes.map((note) => `- ${note}`) : ["- none"]),
  );
  lines.push("", "## Gate policy signals");
  for (const [signalName, signal] of Object.entries(report.gatePolicySignals?.signals || {})) {
    lines.push(`- ${signalName}: ${signal.state}`);
    for (const reason of signal.reasons || []) {
      lines.push(`  - ${reason.code}: ${reason.source?.type || "unknown"}=${reason.source?.value || "unknown"}`);
    }
  }
  if (executionPlan) {
    lines.push("", "## Execution plan");
    lines.push(...(executionPlan.commandsToRun.length ? executionPlan.commandsToRun.map((commandRef) => `- run: ${commandRef}`) : ["- run: none"]));
    lines.push(...(executionPlan.blockedMainThreadCommands.length ? executionPlan.blockedMainThreadCommands.map((commandRef) => `- blocked-main-thread: ${commandRef}`) : ["- blocked-main-thread: none"]));
    lines.push(...((executionPlan.platformDeferredMainThreadCommands || []).length
      ? executionPlan.platformDeferredMainThreadCommands.map((commandRef) => `- platform-deferred-main-thread: ${commandRef}`)
      : ["- platform-deferred-main-thread: none"]));
    lines.push(...((executionPlan.deferredCiOnlyCommands || []).length ? executionPlan.deferredCiOnlyCommands.map((commandRef) => `- deferred-ci-only: ${commandRef}`) : ["- deferred-ci-only: none"]));
    lines.push(...((executionPlan.platformDeferredCiOnlyCommands || []).length
      ? executionPlan.platformDeferredCiOnlyCommands.map((commandRef) => `- platform-deferred-ci-only: ${commandRef}`)
      : ["- platform-deferred-ci-only: none"]));
    lines.push(...(executionPlan.supersededCommands.length
      ? executionPlan.supersededCommands.map(({ commandRef, supersededBy }) => `- superseded: ${commandRef} by ${supersededBy}`)
      : ["- superseded: none"]));
    lines.push(...((executionPlan.deferredMainThreadSupersededCommands || []).length
      ? executionPlan.deferredMainThreadSupersededCommands.map(({ commandRef, supersededBy }) => `- deferred-main-thread-superseded: ${commandRef} by ${supersededBy}`)
      : ["- deferred-main-thread-superseded: none"]));
    lines.push(...((executionPlan.deferredCiOnlySupersededCommands || []).length
      ? executionPlan.deferredCiOnlySupersededCommands.map(({ commandRef, supersededBy }) => `- deferred-ci-only-superseded: ${commandRef} by ${supersededBy}`)
      : ["- deferred-ci-only-superseded: none"]));
    lines.push("", "## Selected leaf groups");
    lines.push(...((executionPlan.executionGroups || []).length
      ? executionPlan.executionGroups.map((group) => `- ${group.groupId}: ${group.commandRef} (leaves=${group.leafIds.length}; locks=${group.resourceLocks.join("+") || "none"})`)
      : ["- none"]));
    lines.push("", "## Deferred leaf closure");
    lines.push(`- main-thread roots: ${executionPlan.closure?.deferredMainThreadRootCount || 0}`);
    lines.push(`- main-thread leaves: ${executionPlan.closure?.deferredMainThreadLeafCount || 0}`);
    lines.push(`- ci-only roots: ${executionPlan.closure?.deferredCiOnlyRootCount || 0}`);
    lines.push(`- ci-only leaves: ${executionPlan.closure?.deferredCiOnlyLeafCount || 0}`);
    lines.push(`- platform-deferred roots: ${executionPlan.closure?.platformDeferredRootCount || 0}`);
    if (executionPlan.localEntrypointBudget) {
      const { actual, limits, status } = executionPlan.localEntrypointBudget;
      lines.push("", "## Local entrypoint budget");
      lines.push(`- status: ${status}`);
      lines.push(`- commands: ${actual.commandCount}/${limits.maxCommands}`);
      lines.push(`- leaves: ${actual.leafCount}/${limits.maxLeaves}`);
      lines.push(`- process groups: ${actual.processGroupCount}/${limits.maxProcessGroups}`);
      lines.push(`- estimated runtime seconds: ${actual.estimatedRuntimeSeconds}/${limits.maxEstimatedRuntimeSeconds}`);
      lines.push(`- estimated cost units: ${actual.estimatedCostUnits}/${limits.maxEstimatedCostUnits}`);
    }
    lines.push("", "## Route gaps");
    lines.push(...((executionPlan.routeGaps || []).length
      ? executionPlan.routeGaps.map((gap) => `- ${gap.code}: ${gap.commandRef}${gap.detail ? ` (${gap.detail})` : ""}`)
      : ["- none"]));
  }
  if (executionResults) {
    lines.push("", "## Execution results");
    lines.push(...executionResults.map((entry) => `- ${entry.commandRef}: exit=${entry.exitCode}`));
  }
  if (report.prCost) {
    lines.push("", "## PR cost observation");
    lines.push(`- schemaIdentity: ${report.prCost.schemaIdentity?.digest || "missing"}`);
    lines.push(`- observationDigest: ${report.prCost.observationDigest || "missing"}`);
    lines.push(`- observationStage: ${report.prCost.observationStage || "missing"}`);
    for (const field of [
      "checkoutMs",
      "setupMs",
      "fixedGuardrailMs",
      "selectorMs",
      "selectedExecutionMs",
      "selectedCommands",
      "uniqueLeafTests",
      "duplicateLeafExecutions",
      "deferredMainThreadCommands",
    ]) {
      lines.push(`- ${field}: ${report.prCost[field] ?? "unobserved"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function writeAdaptiveOutputs(report, args, executionResults = null, executionPlan = null, {
  terminalState = "",
  preparedProfilePlan = null,
  profilePreparationError = null,
  profileBuilder = buildVerificationProfile,
  profileWriter = atomicWriteJsonSync,
  packageScripts = null,
  prCostTiming = {},
} = {}) {
  let currentPreparedPlan = preparedProfilePlan;
  let currentPreparationError = profilePreparationError;
  let currentPackageScripts = packageScripts;
  if (!currentPackageScripts && !currentPreparationError) {
    try {
      currentPackageScripts = readPackageScriptsForProfile();
    } catch (error) {
      currentPreparationError = error;
    }
  }
  if (!currentPreparedPlan && !currentPreparationError) {
    try {
      currentPreparedPlan = prepareVerificationProfilePlan({
        selectorReport: report,
        executionPlan,
        packageScripts: currentPackageScripts,
      });
    } catch (error) {
      currentPreparationError = error;
    }
  }
  const publication = publishVerificationProfileSafely({
    outputPath: args.profileOut,
    previousDiagnostic: report.observerDiagnostics?.profile,
    buildProfile() {
      if (currentPreparationError) throw currentPreparationError;
      return profileBuilder({
        runnerId: "adaptive-verification",
        selectorReport: report,
        executionPlan,
        executionResults: executionResults || [],
        preparedPlan: currentPreparedPlan,
        terminalState,
        prCostTiming: {
          ...prCostTiming,
          executionObserved: executionResults !== null,
        },
      });
    },
    writeProfile: profileWriter,
  });
  report.observerDiagnostics = {
    ...(report.observerDiagnostics || {}),
    profile: publication.diagnostic,
  };
  const blockedByOwnership = report.mainThreadDisposition === "blocked"
    && (executionPlan?.blockedMainThreadCommands || []).length > 0;
  const planningBlocked = (report.unmatchedChangedFiles || []).length > 0
    || (executionPlan?.routeGaps || []).length > 0
    || blockedByOwnership;
  const executionStatus = planningBlocked
    ? "blocked"
    : terminalState
      || (executionResults === null
        ? "planned"
        : executionResults.some((entry) => entry.status === "interrupted")
          ? "interrupted"
          : executionResults.some((entry) => entry.status === "running")
            ? "running"
            : executionResults.some((entry) => entry.status !== "passed")
              ? "failed"
              : "passed");
  const selectionCost = selectorPrCostObservation(report);
  const prCost = buildPrCostObservation({
    selectorReport: report,
    executionPlan,
    executionResults,
    timingInputs: prCostTiming,
    observationStage: "adaptive",
  });
  report.selectorPrCost = selectionCost ? structuredClone(selectionCost) : null;
  report.prCost = prCost;
  atomicWriteJsonSync(args.jsonOut, {
    ...report,
    executionStatus,
    executionResults,
    executionPlan,
    verificationProfilePath: args.profileOut,
  });
  fs.mkdirSync(path.dirname(args.mdOut), { recursive: true });
  fs.writeFileSync(args.mdOut, renderMarkdown(report, executionResults, executionPlan), "utf8");
}

export function executeAdaptivePlan(executionPlan, {
  runner = spawnSync,
  cwd = REPO_ROOT,
  now = () => new Date(),
  onCheckpoint = () => {},
  continueOnFailure = false,
} = {}) {
  if ((executionPlan.routeGaps || []).length > 0) return [];
  const executionResults = [];
  const plannedCommands = Array.isArray(executionPlan.executionCommands)
    ? executionPlan.executionCommands
    : [];
  for (const plannedCommand of plannedCommands) {
    const commandRef = plannedCommand.commandRef;
    const startedAtDate = now();
    const entry = {
      commandRef,
      groupId: plannedCommand.groupId || null,
      leafIds: plannedCommand.leafIds || [],
      sourceCommandRefs: plannedCommand.sourceCommandRefs || [commandRef],
      resourceLocks: plannedCommand.resourceLocks || [],
      status: "running",
      startedAt: startedAtDate.toISOString(),
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      signal: null,
      processStarted: false,
      interrupted: false,
    };
    executionResults.push(entry);
    onCheckpoint(executionResults);

    const command = plannedCommand.process || commandToProcess(commandRef);
    if (command) {
      entry.bin = command.bin;
      entry.args = command.args;
    }
    const result = command
      ? runner(command.bin, command.args, {
        cwd,
        stdio: "inherit",
        shell: false,
        encoding: "utf8",
      })
      : { status: 1, error: "Command could not be resolved." };
    entry.processStarted = Boolean(command && result && !result.error);
    entry.actualFiles = entry.processStarted
      ? uniqueSorted([
        ...(plannedCommand.files || []),
        ...(plannedCommand.modules || []),
        ...(plannedCommand.specs || []),
      ])
      : [];
    const finishedAtDate = now();
    entry.finishedAt = finishedAtDate.toISOString();
    entry.durationMs = Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime());
    entry.signal = typeof result?.signal === "string" ? result.signal : null;
    entry.interrupted = entry.signal !== null || result?.error?.code === "EINTR";
    entry.exitCode = typeof result?.status === "number" ? result.status : 1;
    entry.status = entry.interrupted ? "interrupted" : entry.exitCode === 0 ? "passed" : "failed";
    if (result?.error) entry.error = String(result.error);
    onCheckpoint(executionResults);
    if (entry.exitCode !== 0 && !continueOnFailure) break;
  }
  return executionResults;
}

export function assertAdaptiveExecutionInput(changedFiles, { dryRun = true } = {}) {
  if (!dryRun && (!Array.isArray(changedFiles) || changedFiles.length === 0)) {
    const error = new Error("adaptive-execution-empty-changed-files");
    error.code = "adaptive-execution-empty-changed-files";
    throw error;
  }
}

function selectionArtifactError(code, detail = "") {
  const error = new Error(`${code}${detail ? `:${detail}` : ""}`);
  error.code = code;
  error.detail = detail;
  return error;
}

export function readSelectionArtifact(selectionPath, changedFiles, {
  preparedCatalog = null,
  expectedSelectorRootSet = null,
} = {}) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
  } catch (error) {
    throw selectionArtifactError("adaptive-selection-artifact-unreadable", error.message);
  }
  if (!report || typeof report !== "object" || Array.isArray(report) || report.schemaVersion !== 1) {
    throw selectionArtifactError("adaptive-selection-artifact-schema", String(report?.schemaVersion ?? "missing"));
  }
  for (const field of [
    "changedFiles",
    "recommendedCommands",
    "childAgentStaticTasks",
    "mainThreadSerialVerification",
    "ciOnlyVerification",
    "blockedVerification",
    "matchedByFile",
    "unmatchedChangedFiles",
  ]) {
    if (!Array.isArray(report[field])) {
      throw selectionArtifactError("adaptive-selection-artifact-field", field);
    }
  }
  if (!report.changedFiles.every((entry) => typeof entry === "string" && entry.trim())) {
    throw selectionArtifactError("adaptive-selection-artifact-field", "changedFiles[]");
  }
  if (!report.unmatchedChangedFiles.every((entry) => typeof entry === "string" && entry.trim())) {
    throw selectionArtifactError("adaptive-selection-artifact-field", "unmatchedChangedFiles[]");
  }
  const expectedChangedFiles = normalizeChangedFiles(changedFiles);
  const artifactChangedFiles = normalizeChangedFiles(report.changedFiles);
  if (JSON.stringify(expectedChangedFiles) !== JSON.stringify(artifactChangedFiles)) {
    throw selectionArtifactError(
      "adaptive-selection-artifact-changed-files-mismatch",
      `expected=${expectedChangedFiles.join(",")};artifact=${artifactChangedFiles.join(",")}`,
    );
  }
  if (artifactChangedFiles.length > 0
    && !artifactChangedFiles.every((file) => nonBehavioralClassification(file))
    && report.recommendedCommands.length === 0
    && report.unmatchedChangedFiles.length === 0
    && report.blockedVerification.length === 0
    && (!Array.isArray(report.localEntrypointRouteGaps) || report.localEntrypointRouteGaps.length === 0)) {
    throw selectionArtifactError("adaptive-selection-artifact-empty-closure", artifactChangedFiles.join(","));
  }
  if (preparedCatalog) {
    const [bindingGap] = validateSelectionCatalogBinding(report, preparedCatalog, {
      expectedSelectorRootSet: expectedSelectorRootSet || selectionRootSet(report),
    });
    if (bindingGap) {
      throw selectionArtifactError(bindingGap.code, bindingGap.detail);
    }
  }
  const authority = resolveSelectionAuthority(report);
  const provenanceGaps = authority.routeGaps.length > 0
    ? []
    : validateSelectionArtifactProvenance(report, authority);
  if (authority.routeGaps.length > 0 || provenanceGaps.length > 0) {
    const [gap] = [...authority.routeGaps, ...provenanceGaps];
    throw selectionArtifactError(gap.code, `${gap.commandRef}:${gap.detail}`);
  }
  return report;
}

function emptySelectionReport(changedFiles, gap) {
  return {
    schemaVersion: 1,
    selectionPlatform: process.platform,
    changedFiles: normalizeChangedFiles(changedFiles),
    recommendedCommands: [],
    childAgentStaticTasks: [],
    mainThreadSerialVerification: [],
    ciOnlyVerification: [],
    blockedVerification: [],
    matchedByFile: [],
    unmatchedChangedFiles: [],
    diagnosticNextSteps: [{
      commandRef: gap.commandRef || "selection-artifact",
      executionOwners: [],
      resourceLocks: [],
    }],
    advisoryNotes: [],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.includeMainThread && args.deferMainThread) {
    throw new Error("--include-main-thread and --defer-main-thread are mutually exclusive");
  }
  let changedFiles = [];
  let authority = { historyBase: args.historyBase, head: "" };
  try {
    authority = assertAdaptiveEntrypointAuthority(args);
    const rawChangedFiles = args.changedFilesProvided
      ? args.changedFiles
      : discoverChangedFiles({
        includeBranchHistory: args.includeBranchHistory,
        historyBase: authority.historyBase,
        historyHead: authority.head || "HEAD",
      });
    changedFiles = normalizeChangedFiles(rawChangedFiles);
    if (args.inputErrors.length > 0) {
      const error = new Error(args.inputErrors.join(";"));
      error.code = "adaptive-execution-input-error";
      throw error;
    }
    assertAdaptiveExecutionInput(changedFiles, { dryRun: args.dryRun });
  } catch (error) {
    const gap = planGap(error.code || "adaptive-execution-input-error", "changed-files", error.message);
    const failedReport = {
      ...emptySelectionReport(changedFiles, gap),
      adaptiveMode: args.dryRun ? "dry-run" : "execute",
      discoveryMode: args.entrypoint === "impact" ? "impact-base" : "explicit-input",
      mainThreadDisposition: args.includeMainThread ? "included" : args.deferMainThread ? "deferred" : "blocked",
      selectionArtifact: args.selectionJson || null,
    };
    const failedPlan = buildExecutionPlan(failedReport);
    failedPlan.routeGaps = [gap];
    failedPlan.executionCommands = [];
    writeAdaptiveOutputs(failedReport, args, [], failedPlan, { terminalState: "blocked" });
    console.error(`Adaptive execution input failed closed: ${error.message}`);
    process.exit(2);
  }
  let selectedReport;
  let packageScripts = null;
  let preparedCatalog = null;
  let verificationCatalogFixture = null;
  let setupMs = null;
  let selectorMs = null;
  let selectionArtifactValidation = args.selectionJson
    ? { status: "not-reached", path: path.resolve(args.selectionJson).replaceAll("\\", "/") }
    : { status: "not-requested", path: null };
  try {
    const setupStartedAt = performance.now();
    let selectorRoutes;
    let bindSelectionReport;
    if (args.verificationCatalogFixture) {
      const fixtureInput = readVerificationCatalogFixture(
        args.verificationCatalogFixture,
        args.verificationCatalogFixtureSha256,
      );
      packageScripts = fixtureInput.fixture.packageScripts;
      selectorRoutes = fixtureInput.fixture.routes;
      preparedCatalog = prepareVerificationCatalog({
        packageScripts,
        selectorRoutes,
        selectorCommandRefs: selectorRoutes.map((route) => route.commandRef),
        repoRoot: REPO_ROOT,
        platform: process.platform,
        sourceMode: "fixture",
      });
      verificationCatalogFixture = {
        ...fixtureInput.binding,
        catalogIdentity: {
          digest: preparedCatalog.catalogDigest,
          sourceIdentity: structuredClone(preparedCatalog.sourceIdentity),
        },
      };
      bindSelectionReport = (report) => bindSelectionToPreparedCatalog(report, preparedCatalog);
    } else {
      packageScripts = readPackageScriptsForProfile();
      selectorRoutes = buildRouteIndex();
      const catalogBinding = prepareRepositoryVerificationCatalogBinding({
        packageScripts,
        verificationRecords: VERIFICATION_DOMAINS,
        selectorRoutes,
        repoRoot: REPO_ROOT,
        platform: process.platform,
      });
      preparedCatalog = catalogBinding.preparedCatalog;
      bindSelectionReport = catalogBinding.bindSelectionReport;
    }
    setupMs = performance.now() - setupStartedAt;
    const selectorStartedAt = performance.now();
    const recommendation = buildAdaptiveEntrypointRecommendation(changedFiles, selectorRoutes, {
      entrypoint: args.entrypoint,
      routeAuthority: preparedCatalog.authority,
    });
    const boundCurrentSelection = bindSelectionReport(
      constrainAdaptiveEntrypointSelection(recommendation, args.entrypoint, { preparedCatalog }),
    );
    selectorMs = performance.now() - selectorStartedAt;
    const currentSelection = {
      ...boundCurrentSelection,
      prCost: buildPrCostObservation({
        selectorReport: boundCurrentSelection,
        observationStage: "selector",
        timingInputs: {
          selectorMs: {
            value: selectorMs,
            source: "local-monotonic-clock",
          },
        },
      }),
    };
    if (args.selectionJson) {
      selectedReport = readSelectionArtifact(args.selectionJson, changedFiles, {
        preparedCatalog,
        expectedSelectorRootSet: currentSelection.selectorRootSet,
      });
      selectionArtifactValidation = {
        status: "validated",
        path: path.resolve(args.selectionJson).replaceAll("\\", "/"),
      };
    } else {
      selectedReport = currentSelection;
    }
  } catch (error) {
    const gap = planGap(error.code || "adaptive-selection-artifact-error", "selection-artifact", error.message);
    const failedReport = {
      ...emptySelectionReport(changedFiles, gap),
      adaptiveMode: args.dryRun ? "dry-run" : "execute",
      discoveryMode: "explicit-input",
      mainThreadDisposition: args.includeMainThread ? "included" : args.deferMainThread ? "deferred" : "blocked",
      selectionArtifact: args.selectionJson || null,
      selectionArtifactValidation: {
        ...selectionArtifactValidation,
        status: selectionArtifactValidation.status === "not-requested" ? "not-requested" : "rejected",
        errorCode: error.code || "adaptive-selection-artifact-error",
      },
      verificationCatalogFixture,
      catalogDigest: preparedCatalog?.catalogDigest || null,
      catalogSourceIdentity: preparedCatalog?.sourceIdentity || null,
    };
    const failedPlan = buildExecutionPlan(failedReport, {
      packageScripts: packageScripts || undefined,
      preparedCatalog,
    });
    failedPlan.routeGaps = [gap];
    failedPlan.executionCommands = [];
    writeAdaptiveOutputs(failedReport, args, [], failedPlan, { terminalState: "blocked" });
    console.error(`Adaptive selection artifact failed closed: ${error.message}`);
    process.exit(2);
  }
  const report = {
    ...selectedReport,
    adaptiveMode: args.dryRun ? "dry-run" : "execute",
    verificationEntrypoint: args.entrypoint || null,
    baseRevision: args.entrypoint === "impact" ? authority.historyBase : null,
    headRevision: args.entrypoint === "impact" ? authority.head : null,
    discoveryMode: args.changedFilesProvided
      ? "explicit-input"
      : args.includeBranchHistory
        ? "workspace-plus-history"
        : "workspace-only",
    mainThreadDisposition: args.includeMainThread
      ? "included"
      : args.deferMainThread
        ? "deferred"
        : "blocked",
    selectionArtifact: args.selectionJson || null,
    selectionArtifactValidation,
    verificationCatalogFixture,
  };
  const executionPlan = applyLocalEntrypointExecutionBudget(
    buildExecutionPlan(report, {
      includeMainThread: args.includeMainThread,
      packageScripts,
      preparedCatalog,
    }),
    args.entrypoint,
    { preparedCatalog },
  );
  let preparedProfilePlan = null;
  let profilePreparationError = null;
  try {
    preparedProfilePlan = prepareVerificationProfilePlan({
      selectorReport: report,
      executionPlan,
      packageScripts,
    });
  } catch (error) {
    profilePreparationError = error;
  }
  const profileOutputOptions = {
    preparedProfilePlan,
    profilePreparationError,
    packageScripts,
    prCostTiming: {
      checkoutMs: { value: null, source: "unknown" },
      setupMs: setupMs === null
        ? { value: null, source: "unknown" }
        : { value: setupMs, source: "local-monotonic-clock" },
      fixedGuardrailMs: { value: null, source: "unknown" },
      selectorMs: selectorMs === null
        ? { value: null, source: "unknown" }
        : { value: selectorMs, source: "local-monotonic-clock" },
    },
  };
  if (args.dryRun) {
    writeAdaptiveOutputs(report, args, null, executionPlan, {
      ...profileOutputOptions,
      terminalState: (report.unmatchedChangedFiles || []).length > 0 || executionPlan.routeGaps.length > 0
        ? "blocked"
        : "planned",
    });
    if ((report.unmatchedChangedFiles || []).length > 0 || executionPlan.routeGaps.length > 0) {
      console.error(
        `Adaptive planning failed closed with ${report.unmatchedChangedFiles.length} unmatched file(s) `
        + `and ${executionPlan.routeGaps.length} route gap(s).`,
      );
      process.exit(adaptivePlanningExitCode(report, executionPlan));
    }
    console.log(
      `Adaptive selection recommended ${report.recommendedCommands.length} commands; `
      + `execution plan keeps ${executionPlan.commandsToRun.length} and blocks ${executionPlan.blockedMainThreadCommands.length} `
      + "(dry-run only; no verification executed).",
    );
    return;
  }

  if ((report.unmatchedChangedFiles || []).length > 0) {
    executionPlan.executionCommands = [];
    writeAdaptiveOutputs(report, args, [], executionPlan, {
      ...profileOutputOptions,
      terminalState: "blocked",
    });
    console.error(
      `Adaptive selection found ${report.unmatchedChangedFiles.length} unmatched changed files. `
      + "Add route coverage before running --execute.",
    );
    process.exit(adaptivePlanningExitCode(report, executionPlan));
  }

  if ((executionPlan.routeGaps || []).length > 0) {
    executionPlan.executionCommands = [];
    writeAdaptiveOutputs(report, args, [], executionPlan, {
      ...profileOutputOptions,
      terminalState: "blocked",
    });
    console.error(
      `Adaptive execution plan found ${executionPlan.routeGaps.length} route or command gap(s). `
      + "Repair the selector/alias contract before execution.",
    );
    process.exit(adaptivePlanningExitCode(report, executionPlan));
  }

  if (executionPlan.blockedMainThreadCommands.length > 0 && !args.deferMainThread) {
    executionPlan.executionCommands = [];
    writeAdaptiveOutputs(report, args, [], executionPlan, {
      ...profileOutputOptions,
      terminalState: "blocked",
    });
    console.error(
      `Adaptive selection found ${executionPlan.blockedMainThreadCommands.length} main-thread commands. `
      + "Re-run with --include-main-thread after reserving the live test lane.",
    );
    process.exit(2);
  }

  const executionResults = executeAdaptivePlan(executionPlan, {
    onCheckpoint(results) {
      writeAdaptiveOutputs(report, args, results, executionPlan, profileOutputOptions);
    },
  });
  const failed = executionResults.find((entry) => entry.status !== "passed");
  if (failed) process.exit(failed.exitCode);
  if (executionPlan.executionCommands.length > 0) {
    spawnSync("node", ["tools/test_timing_summary.mjs"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: false,
      encoding: "utf8",
    });
  }
  writeAdaptiveOutputs(report, args, executionResults, executionPlan, {
    ...profileOutputOptions,
    terminalState: "passed",
  });
  const deferredSummary = args.deferMainThread
    ? `; deferred ${executionPlan.blockedMainThreadCommands.length} main-thread command(s)`
    : "";
  console.log(`Adaptive selection executed ${executionResults.length} commands${deferredSummary}.`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
