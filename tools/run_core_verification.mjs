import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildVerifyCoreDefaultGroups,
  buildVerifyCoreMainThreadGroup,
  getVerifyCoreOptionalMainThreadCommands,
} from "./verification/verification_metadata_helpers.mjs";
import {
  RESUMABLE_VERIFICATION_KIND,
  RESUMABLE_VERIFICATION_SCHEMA_VERSION,
  atomicWriteJsonSync,
  buildCommandStates,
  buildPlanIdentity,
  captureVerificationIdentity,
  decideResume,
  discoverChangedFilesBetween,
  readResumeCheckpoint,
  runCheckpointedCommands,
  summarizeCommandStates,
} from "./verification/resumable_verification.mjs";
import {
  buildStateWriterPolicyEvidenceTrace,
  buildStrictStateWriterEvidenceEnvironment,
  createStateWriterPolicyEvidenceSession,
  ensureStateWriterPolicyEvidence,
  isStateWriterPythonBoundaryCommandRef,
} from "./verification/state_writer_policy_evidence.mjs";
import {
  buildCommandSupersessionPlan,
} from "./verification/command_supersession.mjs";
import {
  buildVerificationProfile,
  DEFAULT_CORE_VERIFICATION_PROFILE_OUT,
  prepareVerificationProfilePlan,
  publishVerificationProfileSafely,
} from "./verification/verification_profile.mjs";
import {
  buildVerificationSelectionPlan,
  prepareRepositoryVerificationCatalog,
} from "./verification/script_portfolio.mjs";
import { buildRouteIndex } from "./test_route_registry.mjs";
import { VERIFICATION_DOMAINS } from "./verification/verification_domains.mjs";

const REPO_ROOT = process.cwd();
const DEFAULT_JSON_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "verify-core.json");
const DEFAULT_MD_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "verify-core.md");
const NIGHTLY_SCENARIO_HEAVY_ROUTE_PREFIX = "python-heavy:geo_stack:";
const NIGHTLY_SCENARIO_HEAVY_ROUTE_COUNT = 18;

export const NIGHTLY_LINUX_CORE_EXCLUDED_COMMAND_REFS = Object.freeze([
  "verify:p4:state-writer-policy",
  "test:python:p4:state-write-boundary",
  "test:node:p4:p4-1",
  "test:python:p4:p4-1-boundary",
  "test:node:p4:p4-2a",
  "test:python:p4:p4-2a-boundary",
  "test:node:p4:p4-2b",
  "test:python:p4:p4-2b-boundary",
  "test:node:p4:p4-2c",
  "test:python:p4:p4-2c-boundary",
  "test:node:p4:p4-3",
  "test:python:p4:p4-3-boundary",
  "test:node:p4:p4-4",
  "test:python:p4:p4-4-boundary",
  "verify:pages-dist-and-drift",
  "verify:scenario-contracts:strict",
  "test:node:windows-job-runtime",
  "test:node:williams-crossover-governance",
  "test:node:williams-crossover-job-runner",
]);

const DEFAULT_GROUPS = buildVerifyCoreDefaultGroups();
const MAIN_THREAD_GROUP = buildVerifyCoreMainThreadGroup();
const OPTIONAL_MAIN_THREAD_COMMANDS = getVerifyCoreOptionalMainThreadCommands();

export function parseArgs(argv) {
  const args = {
    list: false,
    includeMainThread: false,
    includeReserved: false,
    resume: false,
    resumeFrom: null,
    nightlyLinuxCore: false,
    nightlyScenarioHeavy: false,
    shardIndex: 1,
    shardCount: 3,
    jsonOut: DEFAULT_JSON_OUT,
    mdOut: DEFAULT_MD_OUT,
    profileOut: DEFAULT_CORE_VERIFICATION_PROFILE_OUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--list") args.list = true;
    else if (token === "--include-main-thread") args.includeMainThread = true;
    else if (token === "--include-reserved") args.includeReserved = true;
    else if (token === "--resume") args.resume = true;
    else if (token === "--nightly-linux-core") args.nightlyLinuxCore = true;
    else if (token === "--nightly-scenario-heavy") args.nightlyScenarioHeavy = true;
    else if (token === "--shard-index") args.shardIndex = Number(argv[++index]);
    else if (token === "--shard-count") args.shardCount = Number(argv[++index]);
    else if (token === "--resume-from") {
      args.resume = true;
      args.resumeFrom = argv[++index];
    }
    else if (token === "--json-out") args.jsonOut = argv[++index];
    else if (token === "--md-out") args.mdOut = argv[++index];
    else if (token === "--profile-out") args.profileOut = argv[++index];
    else throw new Error(`Unknown verify:core argument: ${token}`);
  }
  if (!Number.isInteger(args.shardCount) || args.shardCount < 2 || args.shardCount > 3) {
    throw new Error("Nightly Linux core shard count must be 2 or 3.");
  }
  if (!Number.isInteger(args.shardIndex)
    || args.shardIndex < 1
    || args.shardIndex > args.shardCount) {
    throw new Error("Nightly Linux core shard index must be within the shard count.");
  }
  if (!args.nightlyLinuxCore
    && (args.shardIndex !== 1 || args.shardCount !== 3)) {
    throw new Error("Nightly shard arguments require --nightly-linux-core.");
  }
  if (args.nightlyLinuxCore && args.nightlyScenarioHeavy) {
    throw new Error("Nightly Linux core and scenario heavy modes are mutually exclusive.");
  }
  if (args.nightlyScenarioHeavy && args.includeMainThread) {
    throw new Error("Nightly scenario heavy mode is mutually exclusive with --include-main-thread.");
  }
  return args;
}

function readPackageScripts(packageJsonPath = path.join(REPO_ROOT, "package.json")) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return packageJson.scripts || {};
}

function tokenizeCommand(command) {
  return String(command || "").match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"(.*)"$/, "$1")) || [];
}

function isPackageScript(commandRef, packageScripts) {
  return Object.prototype.hasOwnProperty.call(packageScripts, commandRef);
}

function isSelfRecursive(commandRef, command = "") {
  const ref = String(commandRef || "").trim();
  const concrete = String(command || "").trim();
  return ref === "verify:core"
    || ref === "verify:core:list"
    || ref === "verify:core:main-thread"
    || /^node\s+tools\/run_core_verification\.mjs(?:\s|$)/.test(ref)
    || /^node\s+tools\/run_core_verification\.mjs(?:\s|$)/.test(concrete);
}

function concreteCommandFor(commandRef, packageScripts) {
  return isPackageScript(commandRef, packageScripts) ? packageScripts[commandRef] : commandRef;
}

function makeCommandEntry(commandRef, group, packageScripts) {
  const command = concreteCommandFor(commandRef, packageScripts);
  return {
    group: group.id,
    groupTitle: group.title,
    commandRef,
    command,
    commandType: isPackageScript(commandRef, packageScripts) ? "package-script" : "direct",
  };
}

export function buildCoreVerificationPlan({
  includeMainThread = false,
  includeReserved = includeMainThread,
  applySupersession = true,
  packageScripts = readPackageScripts(),
  groups = DEFAULT_GROUPS,
  mainThreadGroup = MAIN_THREAD_GROUP,
  optionalMainThreadCommands = OPTIONAL_MAIN_THREAD_COMMANDS,
  metadata = VERIFICATION_DOMAINS,
} = {}) {
  const planGroups = [];
  const omittedCommands = [];
  const duplicateCommands = [];
  const skippedMainThreadCommands = [];
  const seenConcreteCommands = new Map();
  const metadataByCommand = new Map();
  for (const record of metadata) {
    const records = metadataByCommand.get(record.commandRef) || [];
    records.push(record);
    metadataByCommand.set(record.commandRef, records);
  }

  function addGroup(group) {
    const entries = [];
    for (const commandRef of group.commands) {
      if (!String(commandRef || "").trim()) {
        omittedCommands.push({ group: group.id, commandRef, reason: "empty commandRef" });
        continue;
      }
      const command = concreteCommandFor(commandRef, packageScripts);
      if (!isPackageScript(commandRef, packageScripts) && !/^(node|python|npm)\b/.test(commandRef)) {
        omittedCommands.push({ group: group.id, commandRef, reason: "missing package script" });
        continue;
      }
      if (isSelfRecursive(commandRef, command)) {
        omittedCommands.push({ group: group.id, commandRef, reason: "self recursion" });
        continue;
      }
      const records = metadataByCommand.get(commandRef) || [];
      if (!includeReserved && !includeMainThread && (records.length === 0 || records.some((record) => (
        record.executionOwner !== "child-safe"
        || record.resourceLocks?.length !== 0
        || record.cost === "heavy"
      )))) {
        skippedMainThreadCommands.push({
          commandRef,
          reason: "reserved or unclassified command; use an explicit main-thread/nightly lane",
        });
        continue;
      }
      if (seenConcreteCommands.has(command)) {
        duplicateCommands.push({
          group: group.id,
          commandRef,
          command,
          duplicateOf: seenConcreteCommands.get(command),
        });
        continue;
      }
      seenConcreteCommands.set(command, commandRef);
      entries.push(makeCommandEntry(commandRef, group, packageScripts));
    }
    planGroups.push({ id: group.id, title: group.title, commands: entries });
  }

  for (const group of groups) {
    addGroup(group);
  }

  if (includeMainThread) {
    addGroup(mainThreadGroup);
    for (const commandRef of optionalMainThreadCommands) {
      skippedMainThreadCommands.push({ commandRef, reason: "optional main-thread E2E; run explicitly when needed" });
    }
  } else {
    for (const commandRef of [...mainThreadGroup.commands, ...optionalMainThreadCommands]) {
      skippedMainThreadCommands.push({ commandRef, reason: "main-thread lane excluded by default" });
    }
  }

  const commandEntries = planGroups.flatMap((group) => group.commands);
  const supersessionPlan = applySupersession
    ? buildCommandSupersessionPlan(
      commandEntries.map((entry) => entry.commandRef),
    )
    : { commandRefs: commandEntries.map((entry) => entry.commandRef), supersededCommands: [] };
  const retainedCommandRefs = new Set(supersessionPlan.commandRefs);
  for (const group of planGroups) {
    group.commands = group.commands.filter((entry) => retainedCommandRefs.has(entry.commandRef));
  }

  const defaultIncludesPagesGroup = planGroups.some((group) => group.id === "pages" && group.commands.length > 0);

  return {
    schemaVersion: 1,
    lane: includeMainThread
      ? "non-browser deterministic core lane plus main-thread E2E"
      : includeReserved ? "explicit reserved deterministic core lane" : "child-safe core lane without resource locks",
    includeMainThread,
    includeReserved: includeReserved || includeMainThread,
    startsBrowserDevServerOrPlaywright: includeMainThread,
    requiresDistLaneOwner: defaultIncludesPagesGroup,
    groups: planGroups,
    commandsToRun: planGroups.flatMap((group) => group.commands),
    omittedCommands,
    duplicateCommands,
    supersededCommands: supersessionPlan.supersededCommands,
    skippedMainThreadCommands,
    reportPaths: {
      json: DEFAULT_JSON_OUT,
      markdown: DEFAULT_MD_OUT,
      profile: DEFAULT_CORE_VERIFICATION_PROFILE_OUT,
    },
  };
}

export function partitionNightlyLinuxCoreCommands(commands, {
  shardCount = 3,
  leafCounter,
} = {}) {
  if (!Number.isInteger(shardCount) || shardCount < 2 || shardCount > 3) {
    throw new Error("Nightly Linux core shard count must be 2 or 3.");
  }
  if (typeof leafCounter !== "function") {
    throw new Error("Nightly Linux core sharding requires a leaf counter.");
  }
  const weighted = commands.map((entry, order) => {
    const leafCount = Number(leafCounter(entry.commandRef));
    if (!Number.isInteger(leafCount) || leafCount < 1) {
      throw new Error(`Nightly Linux core command has an invalid leaf count: ${entry.commandRef}`);
    }
    return { entry, order, leafCount };
  }).sort((left, right) => (
    right.leafCount - left.leafCount
    || left.entry.commandRef.localeCompare(right.entry.commandRef)
    || left.order - right.order
  ));
  const shards = Array.from({ length: shardCount }, (_, index) => ({
    shardIndex: index + 1,
    leafCount: 0,
    commands: [],
  }));
  for (const candidate of weighted) {
    const shard = shards.reduce((selected, current) => (
      current.leafCount < selected.leafCount
        || (current.leafCount === selected.leafCount
          && current.shardIndex < selected.shardIndex)
        ? current
        : selected
    ));
    shard.commands.push(candidate);
    shard.leafCount += candidate.leafCount;
  }
  for (const shard of shards) {
    shard.commands.sort((left, right) => left.order - right.order);
  }
  return shards;
}

export function buildNightlyLinuxCoreShardPlan({
  basePlan = buildCoreVerificationPlan({ includeReserved: true }),
  shardIndex = 1,
  shardCount = 3,
  repoRoot = REPO_ROOT,
  platform = "linux",
  preparedCatalog = null,
  leafCounter = null,
} = {}) {
  const excluded = new Set(NIGHTLY_LINUX_CORE_EXCLUDED_COMMAND_REFS);
  const eligibleCommands = basePlan.commandsToRun.filter(
    (entry) => !excluded.has(entry.commandRef)
      && !/^(?:verify|test:node|test:python):p4:/.test(entry.commandRef),
  );
  const prepared = leafCounter
    ? null
    : (preparedCatalog || prepareRepositoryVerificationCatalog({ repoRoot, platform }));
  const countLeaves = leafCounter || ((commandRef) => (
    buildVerificationSelectionPlan(prepared.catalog, [commandRef], {
      preparedCatalog: prepared,
      platform,
      repoRoot,
    }).normalizedLeaves.length
  ));
  const shards = partitionNightlyLinuxCoreCommands(eligibleCommands, {
    shardCount,
    leafCounter: countLeaves,
  });
  const selected = shards[shardIndex - 1];
  if (!selected) {
    throw new Error("Nightly Linux core shard index must be within the shard count.");
  }
  const selectedCommandRefs = new Set(
    selected.commands.map(({ entry }) => entry.commandRef),
  );
  const groups = basePlan.groups.map((group) => ({
    ...group,
    commands: group.commands.filter((entry) => selectedCommandRefs.has(entry.commandRef)),
  }));
  const shardAssignments = shards.map((shard) => ({
    shardIndex: shard.shardIndex,
    leafCount: shard.leafCount,
    commandRefs: shard.commands.map(({ entry }) => entry.commandRef),
    commands: shard.commands.map(({ entry, leafCount: commandLeafCount }) => ({
      commandRef: entry.commandRef,
      leafCount: commandLeafCount,
    })),
  }));
  return {
    ...basePlan,
    lane: `nightly Linux deterministic core shard ${shardIndex}/${shardCount}`,
    requiresDistLaneOwner: groups.some(
      (group) => group.id === "pages" && group.commands.length > 0,
    ),
    groups,
    commandsToRun: groups.flatMap((group) => group.commands),
    nightlyShard: {
      schemaVersion: 1,
      kind: "nightly-linux-core-shard",
      shardIndex,
      shardCount,
      leafCount: selected.leafCount,
      totalLeafCount: shards.reduce((total, shard) => total + shard.leafCount, 0),
      excludedCommandRefs: [...NIGHTLY_LINUX_CORE_EXCLUDED_COMMAND_REFS],
      assignments: shardAssignments,
    },
  };
}

function routePlatforms(route) {
  const values = [
    ...(Array.isArray(route?.platforms) ? route.platforms : []),
    ...(route?.platform === undefined ? [] : [route.platform]),
  ].map((value) => String(value).trim()).filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : ["all"];
}

export function buildNightlyScenarioHeavyPlan({ routes = buildRouteIndex() } = {}) {
  if (!Array.isArray(routes)) {
    throw new Error("Nightly scenario heavy routes must be an array.");
  }
  const selected = routes.filter((route) => (
    String(route?.id || "").startsWith(NIGHTLY_SCENARIO_HEAVY_ROUTE_PREFIX)
  ));
  if (selected.length !== NIGHTLY_SCENARIO_HEAVY_ROUTE_COUNT) {
    throw new Error(
      `Nightly scenario heavy requires exactly ${NIGHTLY_SCENARIO_HEAVY_ROUTE_COUNT} canonical routes; found ${selected.length}.`,
    );
  }
  const routeIds = new Set();
  const commandRefs = new Set();
  for (const route of selected) {
    if (routeIds.has(route.id)) {
      throw new Error(`Nightly scenario heavy requires a unique route id: ${route.id}`);
    }
    routeIds.add(route.id);
    if (commandRefs.has(route.commandRef)) {
      throw new Error(`Nightly scenario heavy requires a unique commandRef: ${route.commandRef}`);
    }
    commandRefs.add(route.commandRef);
    if (route.cost !== "heavy") {
      throw new Error(`Nightly scenario heavy route has invalid cost: ${route.id}`);
    }
    if (route.executionOwner !== "main-thread") {
      throw new Error(`Nightly scenario heavy route has invalid executionOwner: ${route.id}`);
    }
    if (route.ciProfile !== "full") {
      throw new Error(`Nightly scenario heavy route has invalid ciProfile: ${route.id}`);
    }
    const platforms = routePlatforms(route);
    if (platforms.some((platform) => platform !== "all" && platform !== "linux")) {
      throw new Error(`Nightly scenario heavy route has invalid platforms: ${route.id}`);
    }
    const locks = new Set(Array.isArray(route.resourceLocks) ? route.resourceLocks : []);
    if (!locks.has(".runtime-output") || !locks.has("heavy-geo")) {
      throw new Error(`Nightly scenario heavy route is missing required resource locks: ${route.id}`);
    }
  }
  const commands = selected.map((route) => ({
    group: "scenario-heavy",
    groupTitle: "Canonical Nightly scenario heavy routes",
    commandRef: route.commandRef,
    command: route.commandRef,
    commandType: "direct",
    routeId: route.id,
  }));
  return {
    schemaVersion: 1,
    lane: "nightly canonical scenario heavy routes",
    includeMainThread: true,
    startsBrowserDevServerOrPlaywright: false,
    requiresDistLaneOwner: false,
    groups: [{
      id: "scenario-heavy",
      title: "Canonical Nightly scenario heavy routes",
      commands,
    }],
    commandsToRun: commands,
    omittedCommands: [],
    duplicateCommands: [],
    supersededCommands: [],
    skippedMainThreadCommands: [],
    nightlyScenarioHeavy: {
      schemaVersion: 1,
      kind: "nightly-scenario-heavy",
      routePrefix: NIGHTLY_SCENARIO_HEAVY_ROUTE_PREFIX,
      routeCount: selected.length,
      routeIds: selected.map((route) => route.id),
    },
    reportPaths: {
      json: DEFAULT_JSON_OUT,
      markdown: DEFAULT_MD_OUT,
      profile: DEFAULT_CORE_VERIFICATION_PROFILE_OUT,
    },
  };
}

export function commandToProcess(commandRef, { packageScripts = readPackageScripts(), platform = process.platform } = {}) {
  const normalized = String(commandRef || "").trim();
  if (!normalized) return null;
  if (isPackageScript(normalized, packageScripts)) {
    if (platform === "win32") {
      return { bin: "cmd.exe", args: ["/d", "/s", "/c", "npm", "run", normalized] };
    }
    return { bin: "npm", args: ["run", normalized] };
  }
  const tokens = tokenizeCommand(normalized);
  if (!tokens.length) return null;
  if (tokens[0] === "npm" && platform === "win32") {
    return { bin: "cmd.exe", args: ["/d", "/s", "/c", ...tokens] };
  }
  return { bin: tokens[0], args: tokens.slice(1) };
}

export function renderMarkdownReport(plan, results = []) {
  const lines = [
    "# verify:core report",
    "",
    `- schemaVersion: ${plan.schemaVersion}`,
    `- lane: ${plan.lane}`,
    `- includeMainThread: ${plan.includeMainThread}`,
    `- startsBrowserDevServerOrPlaywright: ${plan.startsBrowserDevServerOrPlaywright}`,
    `- requiresDistLaneOwner: ${plan.requiresDistLaneOwner}`,
    `- commandsToRun: ${plan.commandsToRun.length}`,
    "",
    "## Command groups",
  ];
  for (const group of plan.groups) {
    lines.push("", `### ${group.title}`);
    lines.push(...(group.commands.length
      ? group.commands.map((entry) => `- ${entry.commandRef}: ${entry.command}`)
      : ["- none"]));
  }
  lines.push("", "## Skipped main-thread commands");
  lines.push(...(plan.skippedMainThreadCommands.length
    ? plan.skippedMainThreadCommands.map((entry) => `- ${entry.commandRef}: ${entry.reason}`)
    : ["- none"]));
  lines.push("", "## Omitted commands");
  lines.push(...(plan.omittedCommands.length
    ? plan.omittedCommands.map((entry) => `- ${entry.commandRef}: ${entry.reason}`)
    : ["- none"]));
  lines.push("", "## Duplicate commands");
  lines.push(...(plan.duplicateCommands.length
    ? plan.duplicateCommands.map((entry) => `- ${entry.commandRef}: duplicates ${entry.duplicateOf}`)
    : ["- none"]));
  lines.push("", "## Superseded commands");
  lines.push(...(plan.supersededCommands.length
    ? plan.supersededCommands.map((entry) => `- ${entry.commandRef}: covered by ${entry.supersededBy}`)
    : ["- none"]));
  lines.push("", "## Execution results");
  lines.push(...(results.length
    ? results.map((entry) => {
      const evidence = entry.externalEvidence;
      const evidenceSuffix = evidence?.evidenceId
        ? ` evidence=${evidence.evidenceId} path=${evidence.evidencePath} disposition=${evidence.disposition}`
        : evidence?.code
          ? ` evidence=${evidence.code} disposition=${evidence.disposition}`
          : "";
      return `- ${entry.commandRef}: exit=${entry.exitCode}${evidenceSuffix}`;
    })
    : ["- none"]));
  return `${lines.join("\n")}\n`;
}

export function writeReports(plan, results = [], { jsonOut = DEFAULT_JSON_OUT, mdOut = DEFAULT_MD_OUT } = {}) {
  const report = {
    ...plan,
    reportPaths: {
      json: jsonOut,
      markdown: mdOut,
    },
    results,
  };
  atomicWriteJsonSync(jsonOut, report);
  fs.mkdirSync(path.dirname(mdOut), { recursive: true });
  fs.writeFileSync(mdOut, renderMarkdownReport(plan, results), "utf8");
  return report;
}

function renderExecutionMarkdown(report) {
  const results = (report.commands || []).filter((entry) => entry.status !== "pending");
  const base = renderMarkdownReport(report, results.map((entry) => ({
    commandRef: entry.commandRef,
    exitCode: entry.exitCode,
    externalEvidence: entry.externalEvidence,
  }))).trimEnd();
  const decision = report.resumeDecision || {};
  const lines = [
    base,
    "",
    "## Resume",
    `- mode: ${decision.mode || "fresh"}`,
    `- blockReason: ${decision.blockReason || "none"}`,
    `- reusedCommands: ${report.summary?.reused || 0}`,
    `- changedFiles: ${(decision.changedFiles || []).length}`,
    `- unmatchedChangedFiles: ${(decision.unmatchedChangedFiles || []).length}`,
    "",
    "## Timings",
    `- observedDurationMs: ${report.summary?.observedDurationMs || 0}`,
  ];
  return `${lines.join("\n")}\n`;
}

function writeExecutionReport(report, {
  jsonOut,
  mdOut,
  profileOut = null,
  preparedProfilePlan = null,
  profilePreparationError = null,
  profileBuilder = buildVerificationProfile,
  profileWriter = atomicWriteJsonSync,
}) {
  report.updatedAt = new Date().toISOString();
  report.summary = summarizeCommandStates(report.commands);
  report.results = report.commands
    .filter((entry) => entry.status !== "pending")
    .map((entry) => ({
      commandRef: entry.commandRef,
      command: entry.command,
      status: entry.status,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      evidenceDisposition: entry.evidenceDisposition,
      externalEvidence: entry.externalEvidence || null,
      processStarted: entry.processStarted === true,
      signal: entry.signal || null,
      error: entry.error || null,
    }));
  if (profileOut) {
    const interruptionSignal = report.commands.find((entry) => entry.signal)?.signal || null;
    const publication = publishVerificationProfileSafely({
      outputPath: profileOut,
      previousDiagnostic: report.observerDiagnostics?.profile,
      buildProfile() {
        if (profilePreparationError) throw profilePreparationError;
        return profileBuilder({
          runnerId: report.runnerId,
          preparedPlan: preparedProfilePlan,
          executionResults: report.commands,
          runnerState: interruptionSignal ? "interrupted" : report.verdict,
          interruptionSignal,
        });
      },
      writeProfile: profileWriter,
    });
    report.observerDiagnostics = {
      ...(report.observerDiagnostics || {}),
      profile: publication.diagnostic,
    };
  }
  atomicWriteJsonSync(jsonOut, report);
  fs.mkdirSync(path.dirname(mdOut), { recursive: true });
  fs.writeFileSync(mdOut, renderExecutionMarkdown(report), "utf8");
  return report;
}

export function runVerificationPlan(plan, {
  runner = spawnSync,
  packageScripts = readPackageScripts(),
  cwd = REPO_ROOT,
  stdio = "inherit",
  platform = process.platform,
  stateWriterEvidenceEnsurer = ensureStateWriterPolicyEvidence,
  baseEnv = process.env,
} = {}) {
  const results = [];
  const liveFallbackSession = createStateWriterPolicyEvidenceSession();
  for (const entry of plan.commandsToRun) {
    const command = commandToProcess(entry.commandRef, { packageScripts, platform });
    if (!command) {
      results.push({ commandRef: entry.commandRef, exitCode: 1, skipped: true, reason: "unresolvable command" });
      break;
    }
    let env = baseEnv;
    let externalEvidence = null;
    if (isStateWriterPythonBoundaryCommandRef(entry.commandRef)) {
      try {
        const evidenceResult = stateWriterEvidenceEnsurer({
          cwd,
          producer: {
            entrypoint: "tools/run_core_verification.mjs",
            commandRef: entry.commandRef,
          },
          routeApplicability: { unmatchedChangedFiles: [] },
          liveFallbackSession,
        });
        externalEvidence = buildStateWriterPolicyEvidenceTrace(evidenceResult);
        env = buildStrictStateWriterEvidenceEnvironment(evidenceResult, {
          cwd,
          baseEnv,
        });
      } catch (error) {
        externalEvidence = {
          kind: "state-writer-policy-checker-evidence",
          status: "blocked",
          code: error?.code || "state-writer-evidence-setup-failed",
          disposition: error?.disposition || "blocked",
          message: error?.message || String(error),
        };
        results.push({
          commandRef: entry.commandRef,
          command: entry.command,
          exitCode: 2,
          externalEvidence,
        });
        break;
      }
    }
    const result = runner(command.bin, command.args, {
      cwd,
      stdio,
      shell: false,
      encoding: "utf8",
      env,
    });
    const exitCode = typeof result?.status === "number" ? result.status : 1;
    results.push({
      commandRef: entry.commandRef,
      command: entry.command,
      exitCode,
      externalEvidence,
    });
    if (exitCode !== 0) break;
  }
  return results;
}

export function runCoreVerification({
  argv = process.argv.slice(2),
  packageScripts = readPackageScripts(),
  runner = spawnSync,
  cwd = REPO_ROOT,
  stdio = "inherit",
  platform = process.platform,
  now = () => new Date(),
  identityReader = () => captureVerificationIdentity({ cwd }),
  checkpointReader = readResumeCheckpoint,
  changedFilesReader = (baseSha) => discoverChangedFilesBetween(baseSha, { cwd }),
  stateWriterEvidenceEnsurer = ensureStateWriterPolicyEvidence,
  baseEnv = process.env,
  profileBuilder = buildVerificationProfile,
  profileWriter = atomicWriteJsonSync,
} = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const liveFallbackSession = createStateWriterPolicyEvidenceSession();
  const basePlan = buildCoreVerificationPlan({
    includeMainThread: args.includeMainThread,
    includeReserved: args.includeReserved || args.includeMainThread || args.nightlyLinuxCore,
    packageScripts,
  });
  const plan = args.nightlyScenarioHeavy
    ? buildNightlyScenarioHeavyPlan()
    : args.nightlyLinuxCore
      ? buildNightlyLinuxCoreShardPlan({
      basePlan,
      shardIndex: args.shardIndex,
      shardCount: args.shardCount,
      repoRoot: cwd,
      platform: "linux",
      })
      : basePlan;
  const runnerId = args.nightlyScenarioHeavy
    ? "verify-nightly-scenario-heavy"
    : args.nightlyLinuxCore
      ? `verify-nightly-linux-core-${args.shardIndex}-of-${args.shardCount}`
      : args.includeMainThread ? "verify-core-main-thread" : "verify-core";
  const planIdentity = buildPlanIdentity({ runnerId, entries: plan.commandsToRun });
  let preparedProfilePlan = null;
  let profilePreparationError = null;
  try {
    preparedProfilePlan = prepareVerificationProfilePlan({
      executionPlan: {
        commandsToRun: (planIdentity?.commands || []).map((entry) => entry.commandRef),
      },
      packageScripts,
    });
  } catch (error) {
    profilePreparationError = error;
  }
  const verificationIdentity = identityReader();
  let previousCheckpoint = null;
  let resumeDecision = {
    mode: "fresh",
    blockReason: null,
    reusedIndexes: [],
    changedFiles: [],
    unmatchedChangedFiles: [],
    invalidatedCommandRefs: [],
  };
  if (args.resume) {
    try {
      previousCheckpoint = checkpointReader(args.resumeFrom || args.jsonOut);
      resumeDecision = decideResume({
        checkpoint: previousCheckpoint,
        runnerId,
        planIdentity,
        verificationIdentity,
        changedFilesReader,
      });
    } catch (error) {
      resumeDecision = {
        mode: "blocked",
        blockReason: error?.code || "checkpoint-invalid",
        detail: error?.message || String(error),
        reusedIndexes: [],
        changedFiles: [],
        unmatchedChangedFiles: [],
        invalidatedCommandRefs: [],
      };
    }
  }
  const report = {
    ...plan,
    schemaVersion: RESUMABLE_VERIFICATION_SCHEMA_VERSION,
    kind: RESUMABLE_VERIFICATION_KIND,
    runnerId,
    planIdentity,
    verificationIdentity,
    finalVerificationIdentity: null,
    startedAt: now().toISOString(),
    updatedAt: null,
    verdict: args.list ? "listed" : resumeDecision.mode === "blocked" ? "blocked" : "running",
    blockReason: resumeDecision.blockReason,
    failedCommandRef: null,
    resumeDecision,
    commands: buildCommandStates(planIdentity, {
      checkpoint: previousCheckpoint,
      resumeDecision,
      verificationIdentity,
    }).map((entry) => ({
      ...entry,
      processStarted: false,
      signal: null,
    })),
    summary: null,
    results: [],
    observerDiagnostics: {},
    reportPaths: {
      json: args.jsonOut,
      markdown: args.mdOut,
      profile: args.profileOut || null,
    },
  };
  const checkpoint = () => writeExecutionReport(report, {
    jsonOut: args.jsonOut,
    mdOut: args.mdOut,
    profileOut: args.profileOut || null,
    preparedProfilePlan,
    profilePreparationError,
    profileBuilder,
    profileWriter,
  });
  if (args.list) {
    checkpoint();
    return { plan, results: [], report, exitCode: 0 };
  }
  if (resumeDecision.mode === "blocked") {
    checkpoint();
    return { plan, results: [], report, exitCode: 2 };
  }
  checkpoint();
  runCheckpointedCommands({
    report,
    now,
    checkpoint,
    identityReader,
    expectedVerificationIdentity: verificationIdentity,
    execute(commandEntry) {
      const command = commandToProcess(commandEntry.commandRef, { packageScripts, platform });
      if (!command) return { status: 1, error: "unresolvable command" };
      let env = baseEnv;
      if (isStateWriterPythonBoundaryCommandRef(commandEntry.commandRef)) {
        try {
          const evidenceResult = stateWriterEvidenceEnsurer({
            cwd,
            producer: {
              entrypoint: "tools/run_core_verification.mjs",
              commandRef: commandEntry.commandRef,
            },
            routeApplicability: {
              unmatchedChangedFiles: resumeDecision.unmatchedChangedFiles,
            },
            liveFallbackSession,
          });
          commandEntry.externalEvidence = buildStateWriterPolicyEvidenceTrace(
            evidenceResult,
          );
          env = buildStrictStateWriterEvidenceEnvironment(evidenceResult, {
            cwd,
            baseEnv,
          });
        } catch (error) {
          commandEntry.externalEvidence = {
            kind: "state-writer-policy-checker-evidence",
            status: "blocked",
            code: error?.code || "state-writer-evidence-setup-failed",
            disposition: error?.disposition || "blocked",
            message: error?.message || String(error),
          };
          return {
            status: 2,
            error: [
              "State writer policy evidence setup failed",
              `code=${commandEntry.externalEvidence.code}`,
              `disposition=${commandEntry.externalEvidence.disposition}`,
            ].join(" "),
          };
        }
      }
      const result = runner(command.bin, command.args, {
        cwd,
        stdio,
        shell: false,
        encoding: "utf8",
        env,
      });
      commandEntry.processStarted = Boolean(result && !result.error);
      commandEntry.signal = result?.signal ? String(result.signal) : null;
      return result;
    },
  });
  const failed = report.commands.find((entry) => entry.status === "failed");
  if (!failed && report.commands.every((entry) => entry.status === "passed")) {
    report.finalVerificationIdentity = identityReader();
    if (
      verificationIdentity.workspaceClean
      && (
        !report.finalVerificationIdentity.workspaceClean
        || report.finalVerificationIdentity.verificationSha !== verificationIdentity.verificationSha
        || report.finalVerificationIdentity.verificationTreeSha !== verificationIdentity.verificationTreeSha
      )
    ) {
      report.verdict = "failed";
      report.blockReason = "verification-identity-drift";
    } else {
      report.verdict = "pass";
    }
  }
  checkpoint();
  const exitCode = failed ? failed.exitCode : report.verdict === "pass" ? 0 : 2;
  return { plan, results: report.results, report, exitCode };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const result = runCoreVerification();
  if (result.plan.commandsToRun.length === 0 || result.exitCode === 0) {
    console.log(`verify:core ${result.plan.commandsToRun.length} command(s); report ${result.report.reportPaths.json}`);
  }
  process.exit(result.exitCode);
}
