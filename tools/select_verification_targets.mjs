import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { normalizeP4StateActionPhase } from "./p4_state_action_phases.mjs";
import {
  buildRouteIndex,
  classifyVerificationExecutionOwners,
  reconcileVerificationRouteAuthority,
  summarizeRoutes,
  validateRouteIndex,
  validateDiscoveredRouteCoverage,
  toRepoPath,
} from "./test_route_registry.mjs";
import { VERIFICATION_DOMAINS } from "./verification/verification_domains.mjs";
import {
  prepareRepositoryVerificationCatalogBinding,
} from "./verification/script_portfolio.mjs";
import { buildPrCostObservation } from "./verification/verification_profile.mjs";

export function nonBehavioralClassification(changedFile) {
  // Task records are prose, not application or verification inputs. Unknown
  // Markdown and adjacent executable files still require an explicit route.
  if (/^docs\/active\/(?:[^/]+\/)+(?:plan|context|task)\.md$/u.test(changedFile)
    || /^docs\/archive\/(?:contour-optimization-20260910|tno-mediterranean-sea-closure)\/(?:plan|context|task|land-handoff|lod-handoff|ocean-handoff)\.md$/u.test(changedFile)
    || changedFile === "docs/active/business-efficiency-20260908/editing-analysis.md"
    || changedFile === "docs/active/business-efficiency-20260908/render-reuse-analysis.md") {
    return "task-documentation";
  }
  // This is an agent setting, not an application state writer. Classification
  // here does not validate TOML syntax or authorize its configuration values.
  if (changedFile === ".codex/config.toml") return "agent-tool-config";
  return null;
}


const REPO_ROOT = process.cwd();
const IMPORT_GRAPH_PATH = path.join(REPO_ROOT, "tests", "e2e", "test-import-graph.json");
const P4_STATE_WRITER_POLICY_PATH = path.join(REPO_ROOT, "tools", "state_writer_policy.json");
const P4_EXACT_PHASE_COMMAND_PATTERN = /^verify:p4:p4-(\d+)([a-z]?)$/;
const BOOTSTRAP_FALLBACK_ROUTE_IDS = new Set([
  "e2e:tests/e2e/city_label_i18n_redraw.spec.js",
  "e2e:tests/e2e/startup_bundle_recovery_contract.spec.js",
  "e2e:tests/e2e/tno_startup_visible_context_layers_contract.spec.js",
  "python:tests.test_app_entry_resolver",
  "python:tests.test_startup_shell",
]);
const BROWSER_SMOKE_STATIC_SUPPORT_FILES = new Set([
  "ops/browser-mcp/run-smoke-browser-inspection.sh",
  "ops/browser-mcp/inspection-profile.toml",
  "ops/browser-mcp/inspection-profile.schema.md",
  "tools/browser_smoke_profile_contract.py",
]);
const PERF_STATIC_SUPPORT_FILES = new Set([
  "ops/browser-mcp/editor-performance-benchmark.py",
]);
const SAMPLE_GUIDE_RUNTIME_REFS = [
  "js/bootstrap/startup_sample_project_deeplink.js",
  "js/core/sample_project_import_workflow.js",
  "js/core/sample_project_registry.js",
  "js/ui/toolbar.js",
  "js/ui/toolbar/sample_project_banner_controller.js",
  "js/ui/ui_surface_url_state.js",
  "landing/app.js",
  "landing/assets/sample-projects",
  "landing/assets/sample-runs.json",
  "landing/index.html",
  "landing/styles.css",
];
const GUIDANCE_ARRAY_FIELDS = ["taskEntry", "ownerFiles", "commonChecks", "riskSignals", "diagnostics"];
let cachedP4LatestPhase = null;

function parseArgs(argv) {
  const args = { command: "recommend", changedFiles: [], jsonOut: null, mdOut: null, format: "text" };
  const rest = [...argv];
  const knownCommands = new Set(["check", "list", "explain", "recommend"]);
  if (rest[0] && knownCommands.has(rest[0])) {
    args.command = rest.shift();
  }
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--check") args.command = "check";
    else if (value === "--list") args.command = "list";
    else if (value === "--json") args.format = "json";
    else if (value === "--changed-files-list") args.changedFiles.push(...readChangedFileList(rest[++index]));
    else if (value === "--changed-file") args.changedFiles.push(rest[++index]);
    else if (value === "--changed-files") args.changedFiles.push(...splitChangedFiles(rest[++index]));
    else if (value === "--json-out") args.jsonOut = rest[++index];
    else if (value === "--md-out") args.mdOut = rest[++index];
    else args.changedFiles.push(value);
  }
  return args;
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

function normalizeChangedFiles(values) {
  const normalizedInputs = (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value && !/^,+$/.test(value));
  return [...new Set(normalizedInputs.map((value) => (
    toRepoPath(path.relative(REPO_ROOT, path.resolve(REPO_ROOT, value))).replace(/^\.\//, "")
  )))].sort();
}

function routeSourceRefs(route) {
  return String(route.sourceRef)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function p4ExactPhaseForRoute(route) {
  const match = P4_EXACT_PHASE_COMMAND_PATTERN.exec(String(route?.commandRef || ""));
  if (!match) return null;
  return normalizeP4StateActionPhase(`P4.${match[1]}${match[2]}`);
}

function readP4LatestPhase() {
  if (cachedP4LatestPhase) return cachedP4LatestPhase;
  const policy = JSON.parse(fs.readFileSync(P4_STATE_WRITER_POLICY_PATH, "utf8"));
  const latestPhase = String(policy?.progress?.latestPhase || "").trim();
  if (!latestPhase) {
    throw new Error("State writer policy is missing progress.latestPhase");
  }
  cachedP4LatestPhase = normalizeP4StateActionPhase(latestPhase);
  return cachedP4LatestPhase;
}

function resolveP4ExactPhaseSelection(routes) {
  const exactPhaseRoutes = new Set(routes.filter((route) => p4ExactPhaseForRoute(route)));
  if (!exactPhaseRoutes.size) {
    return { exactPhaseRoutes, currentExactPhaseRoute: null };
  }
  const latestPhase = readP4LatestPhase();
  const currentExactPhaseRoute = [...exactPhaseRoutes]
    .find((route) => p4ExactPhaseForRoute(route) === latestPhase);
  if (!currentExactPhaseRoute) {
    throw new Error(`No exact verification route is registered for current P4 phase ${latestPhase}`);
  }
  return { exactPhaseRoutes, currentExactPhaseRoute };
}

function currentPhaseRoutesForChangedFile(routes, changedFile, importGraph, p4ExactPhaseSelection) {
  const matchedRoutes = routes.filter((route) => routeMatchesChangedFile(route, changedFile, importGraph));
  const matchedExactPhase = matchedRoutes.some((route) => p4ExactPhaseSelection.exactPhaseRoutes.has(route));
  if (!matchedExactPhase) return matchedRoutes;
  return [
    ...matchedRoutes.filter((route) => !p4ExactPhaseSelection.exactPhaseRoutes.has(route)),
    p4ExactPhaseSelection.currentExactPhaseRoute,
  ];
}

function isDirectRouteMatch(route, changedFile) {
  return routeSourceRefs(route).some((sourceRef) => {
    if (sourceRef === changedFile) return true;
    const looksLikeFile = /\.[^/]+$/.test(sourceRef);
    return !looksLikeFile && changedFile.startsWith(`${sourceRef.replace(/\/$/, "")}/`);
  });
}

function projectLocalEntrypointTestRoutes({ changedFile, matchedRoutes }) {
  if (!/^tests\/.*\.(?:mjs|py)$/.test(changedFile)) return matchedRoutes;
  const hasExactIndivisibleRoute = matchedRoutes.some((route) => (
    route.id !== "infra:verification-selector"
    && route.entrypointPolicy?.localProjection?.mode === "indivisible"
    && routeSourceRefs(route).includes(changedFile)
  ));
  if (!hasExactIndivisibleRoute) return matchedRoutes;
  return matchedRoutes.filter((route) => route.id !== "infra:verification-selector");
}

function isPythonUnitTestFile(changedFile) {
  return /^tests\/(?:.*\/)?test_[^/]+\.py$/.test(changedFile);
}

function changedFileMatchesSourceRef(changedFile, sourceRef) {
  if (sourceRef === changedFile) return true;
  const looksLikeFile = /\.[^/]+$/.test(sourceRef);
  return !looksLikeFile && changedFile.startsWith(`${sourceRef.replace(/\/$/, "")}/`);
}

function isSampleGuideRuntimeFile(changedFile) {
  return SAMPLE_GUIDE_RUNTIME_REFS.some((sourceRef) => changedFileMatchesSourceRef(changedFile, sourceRef));
}

function isCheckedInPagesDistFile(changedFile) {
  return changedFile === "dist/.nojekyll"
    || changedFile === "dist/app.js"
    || changedFile === "dist/index.html"
    || changedFile === "dist/styles.css"
    || changedFile === "dist/pages-dist-manifest.json"
    || changedFile.startsWith("dist/app/")
    || changedFile.startsWith("dist/assets/");
}

function isPagesDistSourceMirrorFile(changedFile) {
  return changedFile === "js/core/map_renderer.js"
    || changedFile.startsWith("js/core/map_renderer/");
}

function readImportGraph() {
  if (!fs.existsSync(IMPORT_GRAPH_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(IMPORT_GRAPH_PATH, "utf8"));
}

function routeMatchesImportGraph(route, changedFile, importGraph) {
  const affectedSpecs = importGraph?.reverseIndex?.[changedFile];
  if (!Array.isArray(affectedSpecs) || !affectedSpecs.length) {
    return false;
  }
  return (route.id.startsWith("e2e:") || route.id.startsWith("direct-e2e:")) && affectedSpecs.includes(route.sourceRef);
}

function routeMatchesChangedFile(route, changedFile, importGraph = null) {
  if (BROWSER_SMOKE_STATIC_SUPPORT_FILES.has(changedFile)) {
    return route.id === "infra:browser-smoke-static-contract";
  }
  if (PERF_STATIC_SUPPORT_FILES.has(changedFile)) {
    return route.domain === "perf";
  }

  if (route.id === "infra:heavy-test-classification" && isPythonUnitTestFile(changedFile)) {
    return true;
  }

  if (isCheckedInPagesDistFile(changedFile)) {
    return route.id === "infra:pages-dist" || isDirectRouteMatch(route, changedFile);
  }

  if (isPagesDistSourceMirrorFile(changedFile)) {
    return route.id === "infra:pages-dist" || isDirectRouteMatch(route, changedFile);
  }

  if (isDirectRouteMatch(route, changedFile)) return true;
  // Local projections cover their declared source scope, not domain fallbacks.
  if (route.entrypointPolicy?.localProjection?.mode === "indivisible") return false;
  if (routeMatchesImportGraph(route, changedFile, importGraph)) return true;

  if (changedFile === "package.json" || changedFile === "package-lock.json") {
    return route.id.startsWith("node:")
      || route.id.startsWith("direct-e2e:")
      || route.domain === "test-routing"
      || route.id === "infra:e2e-layer-manifest"
      || route.id === "infra:verification-selector"
      || route.id === "infra:playwright-observability"
      || route.id === "infra:test-import-graph"
      || route.id === "infra:architecture-boundaries"
      || route.id === "infra:test-timeout-inventory"
      || route.id === "infra:test-console-allowlist"
      || route.id === "infra:test-timeout-guardrails"
      || route.id === "infra:perf-gate-contract";
  }

  if (changedFile === "tools/e2e_layering.mjs" || changedFile === "tests/e2e/test-layer-manifest.json") {
    return route.id === "infra:e2e-layer-manifest";
  }

  if (changedFile === "tools/select_verification_targets.mjs" || changedFile === "tools/test_route_registry.mjs") {
    return route.domain === "test-routing";
  }

  if (changedFile.startsWith("tools/verification/") || changedFile === "docs/testing/verification-metadata.md") {
    return route.domain === "test-routing";
  }

  if (changedFile.startsWith("tests/e2e/")) {
    return route.id === "infra:e2e-layer-manifest" || isDirectRouteMatch(route, changedFile);
  }

  if (changedFile.startsWith("tests/") && changedFile.endsWith(".py")) {
    return route.id === "infra:verification-selector" || isDirectRouteMatch(route, changedFile);
  }

  if (changedFile.startsWith("tests/") && changedFile.endsWith(".mjs")) {
    return route.id === "infra:verification-selector" || isDirectRouteMatch(route, changedFile);
  }

  if (isSampleGuideRuntimeFile(changedFile)) {
    return route.id === "e2e:tests/e2e/sample_guide_deeplink.spec.js"
      || route.commandRef === "test:node:sample-project-contracts";
  }

  if (changedFile.startsWith("js/bootstrap/")) {
    return BOOTSTRAP_FALLBACK_ROUTE_IDS.has(route.id);
  }

  if (changedFile.startsWith("map_backend/") || changedFile === "js/api/backend_client.js") {
    return route.domain === "backend-cloud-support";
  }

  if (changedFile === "js/ui/sidebar/project_support_diagnostics_controller.js" && route.domain === "backend-cloud-support") {
    return true;
  }

  if (changedFile.startsWith("js/") && changedFile.includes("city")) return route.domain === "city-runtime";
  if (changedFile.startsWith("js/") && changedFile.includes("scenario")) return route.domain === "scenario-runtime";
  if (changedFile.startsWith("js/") && changedFile.includes("palette")) return route.domain === "palette-runtime";
  if (changedFile.startsWith("js/") && changedFile.includes("transport")) return route.domain === "transport-workbench";
  if (changedFile.startsWith("data/transport_layers/") || changedFile.includes("transport_workbench")) return route.domain === "transport-workbench";
  if (changedFile.startsWith("data/scenarios/")) return route.domain.includes("scenario") || route.domain === "tno-water";
  if (changedFile.startsWith("tools/perf/")) return route.domain === "perf";
  if (changedFile === "index.html" || changedFile.startsWith("css/") || changedFile.startsWith("js/ui/")) {
    return route.ownerHint === "ui-shell" || route.domain === "main-shell";
  }

  return false;
}

function uniqueByCommand(routes) {
  const seen = new Set();
  const result = [];
  for (const route of routes) {
    if (seen.has(route.commandRef)) continue;
    seen.add(route.commandRef);
    result.push(route);
  }
  return result;
}

function createGuidanceSets() {
  return Object.fromEntries(GUIDANCE_ARRAY_FIELDS.map((field) => [field, new Set()]));
}

function collectRouteGuidance(target, guidance) {
  if (!guidance) return;
  for (const field of GUIDANCE_ARRAY_FIELDS) {
    for (const value of guidance[field] || []) {
      target[field].add(value);
    }
  }
  if (typeof guidance.status === "string" && guidance.status.trim()) {
    target.status.add(guidance.status);
  }
}

function guidanceSetsToObject(guidanceSets) {
  const result = Object.fromEntries(GUIDANCE_ARRAY_FIELDS.map((field) => [field, [...guidanceSets[field]].sort()]));
  result.status = [...guidanceSets.status].sort();
  return result;
}

function hasGuidance(guidance) {
  return GUIDANCE_ARRAY_FIELDS.some((field) => (guidance?.[field] || []).length > 0) || (guidance?.status || []).length > 0;
}

function buildDiagnosticNextSteps(commandEntries) {
  return commandEntries
    .filter((entry) => hasGuidance(entry.guidance) || entry.executionOwners.includes("main-thread") || entry.resourceLocks.length > 0)
    .map((entry) => ({
      commandRef: entry.commandRef,
      domains: entry.domains,
      ownerHints: entry.ownerHints,
      executionOwners: entry.executionOwners,
      resourceLocks: entry.resourceLocks,
      routeIds: entry.routeIds,
      guidance: entry.guidance,
    }));
}

function buildAdvisoryNotes(commandEntries) {
  const notes = [];
  const mainThreadCommands = commandEntries.filter((entry) => entry.executionOwners.includes("main-thread"));
  if (mainThreadCommands.length) {
    notes.push(`${mainThreadCommands.length} command(s) require main-thread serial ownership before execution.`);
  }
  const lockedCommands = commandEntries.filter((entry) => entry.resourceLocks.length > 0);
  if (lockedCommands.length) {
    const locks = [...new Set(lockedCommands.flatMap((entry) => entry.resourceLocks))].sort();
    notes.push(`Resource locks required: ${locks.join(", ")}.`);
  }
  const guidedDomains = [...new Set(commandEntries.filter((entry) => hasGuidance(entry.guidance)).flatMap((entry) => entry.domains))].sort();
  if (guidedDomains.length) {
    notes.push(`Guidance available for: ${guidedDomains.join(", ")}.`);
  }
  return notes;
}

function expandedSpecsForCommand(commandRef, allRoutes) {
  const normalized = String(commandRef || "").trim();
  if (!normalized) return [];
  const runSpecPrefix = "node tools/e2e_layering.mjs run-spec ";
  const runDomainPrefix = "node tools/e2e_layering.mjs run-domain ";
  const runOwnerPrefix = "node tools/e2e_layering.mjs run-owner ";
  if (normalized.startsWith(runSpecPrefix)) {
    return [normalized.slice(runSpecPrefix.length).trim()].filter(Boolean);
  }
  if (normalized.startsWith(runDomainPrefix)) {
    const domain = normalized.slice(runDomainPrefix.length).trim();
    return [...new Set(
      allRoutes
        .filter((route) => route.id.startsWith("e2e:") && route.domain === domain)
        .map((route) => route.sourceRef),
    )].sort();
  }
  if (normalized.startsWith(runOwnerPrefix)) {
    const ownerHint = normalized.slice(runOwnerPrefix.length).trim();
    return [...new Set(
      allRoutes
        .filter((route) => route.id.startsWith("e2e:") && route.ownerHint === ownerHint)
        .map((route) => route.sourceRef),
    )].sort();
  }
  return [...new Set(
    allRoutes
      .filter((route) => route.commandRef === normalized)
      .flatMap((route) => routeSourceRefs(route).filter((sourceRef) => sourceRef.endsWith(".spec.js"))),
  )].sort();
}

function commandEntryPriority(entry) {
  const childSafe = entry.executionOwners.every((owner) => owner === "child-safe");
  return [
    childSafe ? 0 : 1,
    entry.resourceLocks.length,
    entry.expandedSpecs.length,
    entry.commandRef,
  ];
}

function compareCommandEntries(left, right) {
  const [leftOwnerRank, leftLockCount, leftSpecCount, leftCommand] = commandEntryPriority(left);
  const [rightOwnerRank, rightLockCount, rightSpecCount, rightCommand] = commandEntryPriority(right);
  return leftOwnerRank - rightOwnerRank
    || leftLockCount - rightLockCount
    || leftSpecCount - rightSpecCount
    || leftCommand.localeCompare(rightCommand);
}

export function classifyExecutionOwners(executionOwners) {
  return classifyVerificationExecutionOwners(executionOwners);
}

const DEFAULT_EXECUTION_MAX_LEAVES = 64;
const DEFAULT_EXECUTION_MAX_ARGV_BYTES = process.platform === "win32" ? 30_000 : 131_072;

function executionAuthorityForCommand(entry, disposition = classifyExecutionOwners(entry.executionOwners)) {
  const routeIds = [...entry.routeIds].sort();
  const safetyContributorRouteIds = [...entry.safetyContributorRouteIds].sort();
  const ciProfiles = [...entry.ciProfiles].sort();
  return {
    executionOwner: disposition,
    executionOwners: [...entry.executionOwners].sort(),
    sourceRefs: [...entry.sourceRefs].sort(),
    domains: [...entry.domains].sort(),
    ownerHints: [...entry.ownerHints].sort(),
    cost: entry.cost,
    platforms: [...entry.platforms].sort(),
    resourceLocks: [...entry.resourceLocks].sort(),
    tiers: [...entry.tiers].sort(),
    ciProfiles,
    routeIds,
    safetyContributorRouteIds,
    entrypointPolicy: structuredClone(entry.entrypointPolicy),
    provenance: {
      routeIds,
      safetyContributorRouteIds,
    },
    disposition,
    batchSafe: false,
    isolation: "process",
    maxLeaves: DEFAULT_EXECUTION_MAX_LEAVES,
    maxArgvBytes: DEFAULT_EXECUTION_MAX_ARGV_BYTES,
  };
}

function selectionContributor(entry, disposition, extra = {}) {
  return {
    commandRef: entry.commandRef,
    ...extra,
    ...executionAuthorityForCommand(entry, disposition),
  };
}

function buildCommandEntries(routes, allRoutes = buildRouteIndex(), reconciledAuthority = null) {
  const byCommand = new Map();
  const authorityByCommand = new Map(
    (reconciledAuthority || reconcileVerificationRouteAuthority(allRoutes))
      .map((entry) => [entry.commandRef, entry]),
  );
  for (const route of routes) {
    const existing = byCommand.get(route.commandRef) || {
      commandRef: route.commandRef,
      domains: new Set(),
      ownerHints: new Set(),
      resourceLocks: new Set(),
      executionOwners: new Set(),
      ciProfiles: new Set(),
      routeIds: new Set(),
      safetyContributorRouteIds: new Set(),
      expandedSpecs: new Set(expandedSpecsForCommand(route.commandRef, allRoutes)),
      matchedFiles: new Set(),
      guidance: { ...createGuidanceSets(), status: new Set() },
    };
    existing.domains.add(route.domain);
    existing.ownerHints.add(route.ownerHint);
    existing.routeIds.add(route.id);
    const authority = authorityByCommand.get(route.commandRef);
    for (const contributorId of authority?.safetyContributorRouteIds || [route.id]) {
      existing.safetyContributorRouteIds.add(contributorId);
    }
    for (const executionOwner of authority?.executionOwners || [route.executionOwner]) {
      existing.executionOwners.add(executionOwner);
    }
    for (const ciProfile of authority?.ciProfiles || [route.ciProfile]) {
      existing.ciProfiles.add(ciProfile);
    }
    for (const lock of authority?.resourceLocks || route.resourceLocks) {
      existing.resourceLocks.add(lock);
    }
    collectRouteGuidance(existing.guidance, route.guidance);
    byCommand.set(route.commandRef, existing);
  }
  return [...byCommand.values()]
    .map((entry) => {
      const authority = authorityByCommand.get(entry.commandRef);
      return {
        commandRef: entry.commandRef,
        sourceRefs: [...(authority?.sourceRefs || [])].sort(),
        domains: [...(authority?.domains || entry.domains)].sort(),
        ownerHints: [...(authority?.ownerHints || entry.ownerHints)].sort(),
        cost: authority?.cost || "unclassified",
        platforms: [...(authority?.platforms || ["all"])].sort(),
        resourceLocks: [...entry.resourceLocks].sort(),
        executionOwners: [...entry.executionOwners].sort(),
        tiers: [...(authority?.tiers || [])].sort(),
        ciProfiles: [...entry.ciProfiles].sort(),
        routeIds: [...entry.routeIds].sort(),
        safetyContributorRouteIds: [...entry.safetyContributorRouteIds].sort(),
        expandedSpecs: [...entry.expandedSpecs].sort(),
        matchedFiles: [...entry.matchedFiles].sort(),
        guidance: guidanceSetsToObject(entry.guidance),
        entrypointPolicy: structuredClone(authority?.entrypointPolicy),
      };
    })
    .sort(compareCommandEntries);
}

function summarizeImpactedDomains(commandEntries) {
  const byDomain = new Map();
  for (const entry of commandEntries) {
    for (const domain of entry.domains) {
      const current = byDomain.get(domain) || {
        domain,
        commandCount: 0,
        ownerHints: new Set(),
        expandedSpecs: new Set(),
      };
      current.commandCount += 1;
      for (const ownerHint of entry.ownerHints) {
        current.ownerHints.add(ownerHint);
      }
      for (const specPath of entry.expandedSpecs) {
        current.expandedSpecs.add(specPath);
      }
      byDomain.set(domain, current);
    }
  }
  return [...byDomain.values()]
    .map((entry) => ({
      domain: entry.domain,
      commandCount: entry.commandCount,
      ownerHints: [...entry.ownerHints].sort(),
      specCount: entry.expandedSpecs.size,
    }))
    .sort((left, right) => right.commandCount - left.commandCount || left.domain.localeCompare(right.domain));
}

function skippedHeavyRoutes(allRoutes, selectedRoutes) {
  const selectedCommands = new Set(selectedRoutes.map((route) => route.commandRef));
  const skipped = allRoutes
    .filter((route) => route.cost === "heavy" || route.executionOwner === "ci-only" || route.resourceLocks.length > 0)
    .filter((route) => !selectedCommands.has(route.commandRef));
  return uniqueByCommand(skipped).map((route) => ({
    id: route.id,
    commandRef: route.commandRef,
    reason: "changed files do not map to this route",
  }));
}

function buildRecommendation(changedFiles, allRoutes = buildRouteIndex(), {
  routeAuthority = null,
  matchedRouteProjector = null,
  platform = process.platform,
} = {}) {
  validateRouteIndex(allRoutes);
  const reconciledRouteAuthority = routeAuthority || reconcileVerificationRouteAuthority(allRoutes);
  const p4ExactPhaseSelection = resolveP4ExactPhaseSelection(allRoutes);
  const normalizedChangedFiles = normalizeChangedFiles(changedFiles);
  const importGraph = readImportGraph();
  const matchedRoutesByFile = normalizedChangedFiles.map((file) => {
    const routes = currentPhaseRoutesForChangedFile(allRoutes, file, importGraph, p4ExactPhaseSelection);
    const projectedRoutes = matchedRouteProjector
      ? matchedRouteProjector({ changedFile: file, matchedRoutes: routes, allRoutes })
      : routes;
    if (!Array.isArray(projectedRoutes) || projectedRoutes.some((route) => !routes.includes(route))) {
      throw new Error(`verification-selector-invalid-route-projection:${file}`);
    }
    return { changedFile: file, routes: projectedRoutes };
  });
  const matchedRoutes = matchedRoutesByFile.flatMap((entry) => entry.routes);
  const supportsCurrentPlatform = (entry) => (
    entry.platforms.includes("all") || entry.platforms.includes(platform)
  );
  const commandEntries = buildCommandEntries(matchedRoutes, allRoutes, reconciledRouteAuthority)
    .filter(supportsCurrentPlatform);
  for (const entry of matchedRoutesByFile) {
    const perFileCommandEntries = buildCommandEntries(entry.routes, allRoutes, reconciledRouteAuthority)
      .filter(supportsCurrentPlatform);
    entry.commandEntries = perFileCommandEntries;
  }
  const childSafeRoutes = commandEntries.filter((entry) => classifyExecutionOwners(entry.executionOwners) === "child-safe");
  const mainThreadRoutes = commandEntries.filter((entry) => classifyExecutionOwners(entry.executionOwners) === "main-thread");
  const ciOnlyRoutes = commandEntries.filter((entry) => classifyExecutionOwners(entry.executionOwners) === "ci-only");
  const blockedRoutes = commandEntries.filter((entry) => classifyExecutionOwners(entry.executionOwners) === "blocked");
  const unroutedChangedFiles = matchedRoutesByFile
    .filter((entry) => entry.routes.length === 0)
    .map((entry) => entry.changedFile);
  const nonBehavioralChangedFiles = unroutedChangedFiles
    .filter((file) => nonBehavioralClassification(file))
    .map((changedFile) => ({
      changedFile,
      classification: nonBehavioralClassification(changedFile),
      disposition: "no-app-behavior-validation",
      behaviorTestsRun: false,
    }));
  const unmatchedChangedFiles = unroutedChangedFiles
    .filter((file) => !nonBehavioralClassification(file));

  return {
    schemaVersion: 1,
    selectionPlatform: platform,
    routeAuthority: reconciledRouteAuthority,
    changedFiles: normalizedChangedFiles,
    importGraphLoaded: !!importGraph,
    recommendedCommands: commandEntries.map((entry) => ({
      commandRef: entry.commandRef,
      reason: `matches ${entry.domains.join("+")}/${entry.ownerHints.join("+")}`,
      domains: entry.domains,
      ownerHints: entry.ownerHints,
      resourceLocks: entry.resourceLocks,
      executionOwners: entry.executionOwners,
      ciProfiles: entry.ciProfiles,
      expandedSpecs: entry.expandedSpecs,
      routeIds: entry.routeIds,
      safetyContributorRouteIds: entry.safetyContributorRouteIds,
      guidance: entry.guidance,
      ...executionAuthorityForCommand(entry),
    })),
    coveredDomains: [...new Set(commandEntries.flatMap((entry) => entry.domains))].sort(),
    coveredOwners: [...new Set(commandEntries.flatMap((entry) => entry.ownerHints))].sort(),
    resourceLocks: [...new Set(commandEntries.flatMap((entry) => entry.resourceLocks))].sort(),
    executionOwners: [...new Set(commandEntries.flatMap((entry) => entry.executionOwners))].sort(),
    childAgentStaticTasks: childSafeRoutes.map((entry) => selectionContributor(entry, "child-safe", {
      reason: "short contract route",
      expandedSpecs: entry.expandedSpecs,
    })),
    mainThreadSerialVerification: mainThreadRoutes.map((entry) => selectionContributor(entry, "main-thread", {
      expandedSpecs: entry.expandedSpecs,
      guidance: entry.guidance,
    })),
    ciOnlyVerification: ciOnlyRoutes.map((entry) => selectionContributor(entry, "ci-only", {
      reason: "reserved for CI profile",
    })),
    blockedVerification: blockedRoutes.map((entry) => selectionContributor(entry, "blocked", {
      reason: "execution owner metadata could not be classified",
    })),
    matchedByFile: matchedRoutesByFile.map((entry) => ({
      changedFile: entry.changedFile,
      matchedRouteIds: entry.routes.map((route) => route.id).sort(),
      recommendedCommands: entry.commandEntries.map((commandEntry) => ({
        commandRef: commandEntry.commandRef,
        domains: commandEntry.domains,
        ownerHints: commandEntry.ownerHints,
        resourceLocks: commandEntry.resourceLocks,
        executionOwners: commandEntry.executionOwners,
        routeIds: commandEntry.routeIds,
        safetyContributorRouteIds: commandEntry.safetyContributorRouteIds,
        expandedSpecs: commandEntry.expandedSpecs,
        guidance: commandEntry.guidance,
        ...executionAuthorityForCommand(commandEntry),
      })),
    })),
    impactedDomains: summarizeImpactedDomains(commandEntries),
    diagnosticNextSteps: buildDiagnosticNextSteps(commandEntries),
    advisoryNotes: buildAdvisoryNotes(commandEntries),
    unroutedChangedFiles,
    nonBehavioralChangedFiles,
    unmatchedChangedFiles,
    skippedHeavyTests: skippedHeavyRoutes(allRoutes, matchedRoutes),
  };
}

function renderMarkdown(report) {
  const lines = ["# Verification selector explain", "", "## Changed files"];
  lines.push(...(report.changedFiles.length ? report.changedFiles.map((file) => `- ${file}`) : ["- none"]));
  lines.push("", "## Matched by changed file");
  for (const entry of report.matchedByFile || []) {
    lines.push(`- ${entry.changedFile}`);
    if (!entry.recommendedCommands.length) {
      const nonBehavioral = (report.nonBehavioralChangedFiles || [])
        .find((file) => file.changedFile === entry.changedFile);
      lines.push(nonBehavioral
        ? `  - ${nonBehavioral.classification}: no application behavior tests required or run`
        : "  - no matched commands");
      continue;
    }
    for (const command of entry.recommendedCommands) {
      lines.push(`  - ${command.commandRef} (${command.domains.join("+")}/${command.ownerHints.join("+")})`);
      if (command.expandedSpecs.length) {
        lines.push(...command.expandedSpecs.map((specPath) => `    - ${specPath}`));
      }
    }
  }
  lines.push("", "## Unmatched changed files");
  lines.push(...(report.unmatchedChangedFiles.length ? report.unmatchedChangedFiles.map((file) => `- ${file}`) : ["- none"]));
  lines.push("", "## Impacted domains");
  lines.push(...((report.impactedDomains || []).length
    ? report.impactedDomains.map((entry) => `- ${entry.domain}: commands=${entry.commandCount}, specs=${entry.specCount}, owners=${entry.ownerHints.join("+")}`)
    : ["- none"]));
  lines.push("", "## Recommended commands");
  lines.push(...(report.recommendedCommands.length ? report.recommendedCommands.map((route) => {
    const ownerText = route.executionOwners.join("+") || "unknown-owner";
    const routeText = route.domains.join("+") || "unknown-domain";
    const specCount = route.expandedSpecs.length ? `; specs=${route.expandedSpecs.length}` : "";
    return `- ${route.commandRef} (${ownerText}; ${routeText}${specCount})`;
  }) : ["- none"]));
  lines.push("", "## Resource locks");
  lines.push(...(report.resourceLocks.length ? report.resourceLocks.map((lock) => `- ${lock}`) : ["- none"]));
  lines.push("", "## Main-thread serial verification");
  lines.push(...(report.mainThreadSerialVerification.length ? report.mainThreadSerialVerification.map((route) => `- ${route.commandRef}`) : ["- none"]));
  lines.push("", "## Diagnostic next steps");
  lines.push(...((report.diagnosticNextSteps || []).length ? report.diagnosticNextSteps.map((entry) => {
    const owners = entry.executionOwners.join("+") || "unknown-owner";
    const locks = entry.resourceLocks.length ? `; locks=${entry.resourceLocks.join("+")}` : "";
    return `- ${entry.commandRef} (${owners}${locks})`;
  }) : ["- none"]));
  lines.push("", "## Advisory notes");
  lines.push(...((report.advisoryNotes || []).length ? report.advisoryNotes.map((note) => `- ${note}`) : ["- none"]));
  lines.push("", "## Child-safe tasks");
  lines.push(...(report.childAgentStaticTasks.length ? report.childAgentStaticTasks.map((route) => `- ${route.commandRef}`) : ["- none"]));
  lines.push("", "## Skipped heavy tests");
  lines.push(...(report.skippedHeavyTests.length ? report.skippedHeavyTests.slice(0, 25).map((route) => `- ${route.commandRef}: ${route.reason}`) : ["- none"]));
  lines.push("", "## Gate policy signals");
  for (const [signalName, signal] of Object.entries(report.gatePolicySignals?.signals || {})) {
    lines.push(`- ${signalName}: ${signal.state}`);
    for (const reason of signal.reasons || []) {
      lines.push(`  - ${reason.code}: ${reason.source?.type || "unknown"}=${reason.source?.value || "unknown"}`);
    }
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

function writeOutputFiles(report, args) {
  if (args.jsonOut) {
    fs.mkdirSync(path.dirname(args.jsonOut), { recursive: true });
    fs.writeFileSync(args.jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (args.mdOut) {
    fs.mkdirSync(path.dirname(args.mdOut), { recursive: true });
    fs.writeFileSync(args.mdOut, renderMarkdown(report), "utf8");
  }
}

function readPackageScripts(packagePath = path.join(REPO_ROOT, "package.json")) {
  return JSON.parse(fs.readFileSync(packagePath, "utf8")).scripts || {};
}

export function buildRepositoryRecommendation(changedFiles, {
  packageScripts = readPackageScripts(),
  verificationRecords = VERIFICATION_DOMAINS,
  selectorRoutes = buildRouteIndex(),
  repoRoot = REPO_ROOT,
  platform = process.platform,
} = {}) {
  const selectorStartedAt = performance.now();
  const binding = prepareRepositoryVerificationCatalogBinding({
    packageScripts,
    verificationRecords,
    selectorRoutes,
    repoRoot,
    platform,
  });
  const report = binding.bindSelectionReport(buildRecommendation(changedFiles, selectorRoutes, {
    routeAuthority: binding.preparedCatalog.authority,
    platform,
  }));
  return {
    ...report,
    prCost: buildPrCostObservation({
      selectorReport: report,
      observationStage: "selector",
      timingInputs: {
        selectorMs: {
          value: performance.now() - selectorStartedAt,
          source: "local-monotonic-clock",
        },
      },
    }),
  };
}

function listRoutes() {
  const routes = buildRouteIndex();
  console.log(JSON.stringify({ summary: summarizeRoutes(routes), routes }, null, 2));
}

function explainRoute(target) {
  const routes = buildRouteIndex();
  const route = routes.find((candidate) => candidate.id === target);
  if (route) {
    console.log(JSON.stringify(route, null, 2));
    return;
  }
  const normalizedTarget = target ? normalizeChangedFiles([target])[0] : "";
  const recommendation = buildRecommendation([target], routes);
  const targetExists = normalizedTarget ? fs.existsSync(path.join(REPO_ROOT, normalizedTarget)) : false;
  if (targetExists && (recommendation.recommendedCommands.length > 0
    || recommendation.nonBehavioralChangedFiles.length > 0)) {
    console.log(JSON.stringify({
      mode: "recommendation-fallback",
      target,
      recommendation,
    }, null, 2));
    return;
  }
  throw new Error(`No route found for ${target}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "check") {
    const summary = validateRouteIndex();
    validateDiscoveredRouteCoverage();
    console.log(`Route schema check passed for ${summary.count} routes.`);
    return;
  }
  if (args.command === "list") {
    listRoutes();
    return;
  }
  if (args.command === "explain") {
    explainRoute(args.changedFiles[0]);
    return;
  }

  const report = buildRepositoryRecommendation(args.changedFiles);
  writeOutputFiles(report, args);
  if (args.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderMarkdown(report));
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}

export {
  buildRecommendation,
  normalizeChangedFiles,
  projectLocalEntrypointTestRoutes,
  routeMatchesChangedFile,
};
