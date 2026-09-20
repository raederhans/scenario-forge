import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  VERIFICATION_DOMAINS,
  VERIFICATION_EXACT_DIRECT_COMMAND_REFS,
  VERIFICATION_CI_PROFILES,
  VERIFICATION_COSTS,
  VERIFICATION_EXECUTION_OWNERS,
  VERIFICATION_ENTRYPOINT_DEPTHS,
  VERIFICATION_ENTRYPOINT_IDS,
  VERIFICATION_LAYERS,
  VERIFICATION_RESOURCE_LOCKS,
  deriveVerificationEntrypointPolicy,
} from "./verification/verification_domains.mjs";
import {
  buildCanonicalRouteIndex,
  VERIFICATION_METADATA_SOURCE_IDENTITY,
} from "./verification/verification_catalog_projection.mjs";

export const REPO_ROOT = process.cwd();
export const E2E_MANIFEST_PATH = path.join(REPO_ROOT, "tests", "e2e", "test-layer-manifest.json");
export const PYTHON_HEAVY_GROUPS_PATH = path.join(REPO_ROOT, "tests", "heavy_dependency_groups.json");
export const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");
const REPO_JS_EXTENSIONS = [".js", ".mjs"];

export const ROUTE_SCHEMA_FIELDS = [
  "id",
  "commandRef",
  "sourceRef",
  "domain",
  "ownerHint",
  "layer",
  "cost",
  "resourceLocks",
  "executionOwner",
  "ciProfile",
];
export const ROUTE_GUIDANCE_FIELDS = Object.freeze([
  "taskEntry",
  "ownerFiles",
  "commonChecks",
  "riskSignals",
  "diagnostics",
  "status",
]);
const ROUTE_GUIDANCE_ARRAY_FIELDS = new Set(["taskEntry", "ownerFiles", "commonChecks", "riskSignals", "diagnostics"]);

export const RESOURCE_LOCKS = VERIFICATION_RESOURCE_LOCKS;
export const EXECUTION_OWNERS = VERIFICATION_EXECUTION_OWNERS;
export const COSTS = VERIFICATION_COSTS;
export const LAYERS = VERIFICATION_LAYERS;
export const CI_PROFILES = VERIFICATION_CI_PROFILES;
export const PLATFORMS = Object.freeze(["all", "win32", "linux", "darwin"]);
export const ROUTE_REGISTRY_SOURCE_IDENTITY = VERIFICATION_METADATA_SOURCE_IDENTITY;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function toRepoPath(value) {
  return value.split(path.sep).join("/");
}

function fileExists(repoPath) {
  return fs.existsSync(path.join(REPO_ROOT, repoPath));
}

function resolveRelativeFile(baseRepoPath, specifier) {
  const resolvedBase = toRepoPath(path.posix.normalize(path.posix.join(path.posix.dirname(baseRepoPath), specifier)));
  const candidates = [];
  if (/\.[A-Za-z0-9]+$/.test(resolvedBase)) {
    candidates.push(resolvedBase);
  } else {
    for (const extension of REPO_JS_EXTENSIONS) {
      candidates.push(`${resolvedBase}${extension}`);
    }
    for (const extension of REPO_JS_EXTENSIONS) {
      candidates.push(path.posix.join(resolvedBase, `index${extension}`));
    }
  }
  return candidates.find((candidate) => fileExists(candidate)) || null;
}

function resolveRepoSpecifier(baseRepoPath, specifier) {
  const value = String(specifier || "").trim();
  if (!value) return null;
  if (value.startsWith(".")) {
    const relativeResolved = resolveRelativeFile(baseRepoPath, value);
    if (relativeResolved) {
      return relativeResolved;
    }
    if (value.startsWith("./js/") || value.startsWith("./tests/")) {
      const repoRootResolved = toRepoPath(value.slice(2));
      return fileExists(repoRootResolved) ? repoRootResolved : null;
    }
    return null;
  }
  if (value.startsWith("/")) {
    const normalized = toRepoPath(value.slice(1));
    return fileExists(normalized) ? normalized : null;
  }
  return null;
}

function extractSpecifiers(content) {
  const specifiers = new Set();
  const expressions = [
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /from\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /new URL\(\s*["']([^"']+)["']/g,
  ];
  for (const expression of expressions) {
    for (const match of content.matchAll(expression)) {
      specifiers.add(String(match[1] || "").trim());
    }
  }
  return [...specifiers];
}

function extractCommandPaths(command, extensionPattern) {
  return [...command.matchAll(new RegExp(`tests\\/[\\w./-]+\\.${extensionPattern}`, "g"))]
    .map((match) => match[0]);
}

function extractNpmScriptRefs(command, prefix) {
  const refs = [];
  const npmRunExpression = /\bnpm\s+(?:run|run-script)\s+([^&|;]+)/g;
  for (const match of String(command || "").matchAll(npmRunExpression)) {
    const args = String(match[1] || "").trim().split(/\s+/).filter(Boolean);
    for (const arg of args) {
      if (arg === "--") break;
      if (arg.startsWith("-")) continue;
      if (arg.startsWith(prefix)) refs.push(arg);
      break;
    }
  }
  return refs;
}

function resolveNodeScriptTestFiles(scripts, scriptName, command, seen = new Set()) {
  if (seen.has(scriptName)) {
    return [];
  }
  seen.add(scriptName);
  const directFiles = extractCommandPaths(command, "mjs");
  const childFiles = extractNpmScriptRefs(command, "test:node:")
    .flatMap((childName) => resolveNodeScriptTestFiles(scripts, childName, scripts[childName] || "", new Set(seen)));
  return uniqueValues([...directFiles, ...childFiles]);
}

function extractNodeEntrypointPaths(command) {
  return [
    ...String(command || "").matchAll(
      /\bnode\s+(?:(?:--[\w-]+(?:=\S+)?)\s+)*((?:tools|tests)\/[\w./-]+\.mjs)\b/g,
    ),
  ].map((match) => match[1]);
}

function collectFileDependencies(baseRepoPath) {
  const absolutePath = path.join(REPO_ROOT, baseRepoPath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }
  const content = fs.readFileSync(absolutePath, "utf8");
  const directDependencies = uniqueValues(
    extractSpecifiers(content)
      .map((specifier) => resolveRepoSpecifier(baseRepoPath, specifier))
      .filter(Boolean),
  ).sort();
  if (baseRepoPath !== "tests/scenario_chunk_contracts.test.mjs") return directDependencies;
  const supportDependency = "tests/helpers/scenario_chunk_contract_support.mjs";
  return uniqueValues([
    ...directDependencies,
    ...(directDependencies.includes(supportDependency)
      ? collectFileDependencies(supportDependency)
      : []),
  ]).sort();
}

function resolveNodeRouteDomain(scriptName, sourceRefs) {
  const haystack = `${scriptName},${sourceRefs.join(",")}`;
  if (haystack.includes("release-smoke") || haystack.includes("release_smoke") || haystack.includes("pages_public_release_gate")) return "release-smoke";
  if (scriptName.includes("p4:state-writer-policy")) return "state-ownership";
  if (scriptName === "test:node:verification-profile") return "test-routing";
  if (
    haystack.includes("test:node:verify-core-runner")
    || haystack.includes("verify_core_runner")
    || haystack.includes("run_core_verification")
    || haystack.includes("windows_job")
    || haystack.includes("process_containment")
  ) return "test-routing";
  if (
    haystack.includes("p4:state-writer-policy")
    || haystack.includes("state_writer_policy")
    || haystack.includes("state_writer_inventory")
    || haystack.includes("p4_state_action_routes")
  ) return "state-ownership";
  if (haystack.includes("supervisor") || haystack.includes("ai_test_supervisor") || haystack.includes("sf-ats")) return "test-routing";
  if (haystack.includes("backend")) return "backend-cloud-support";
  if (haystack.includes("appearance_transport") || haystack.includes("appearance-transport")) return "transport-workbench";
  if (haystack.includes("city") || haystack.includes("urban")) return "city-runtime";
  if (haystack.includes("startup")) return "startup";
  if (haystack.includes("scenario") || haystack.includes("lifecycle_runtime")) return "scenario-runtime";
  if (haystack.includes("physical") || haystack.includes("map_layer")) return "map-layer";
  if (haystack.includes("palette")) return "palette-runtime";
  if (haystack.includes("perf")) return "perf";
  if (haystack.includes("border_mesh") || haystack.includes("renderer")) return "renderer-runtime";
  return "renderer-runtime";
}

function resolveDevE2eDomain(specPaths) {
  const haystack = specPaths.join(",");
  if (haystack.includes("tno_ready_state")) return "tno-startup";
  if (haystack.includes("scenario_chunk")) return "scenario-runtime";
  return "dev-workspace";
}

function isDirectE2EScriptRoute(name) {
  return name.startsWith("test:e2e:dev:")
    || name === "test:e2e:pages-public-release-gate";
}

function resolveDirectE2eMetadata(scriptName, specPaths) {
  if (scriptName === "test:e2e:pages-public-release-gate") {
    return {
      domain: "release-smoke",
      ownerHint: "deploy-runtime",
      ciProfile: "deploy-minimal",
    };
  }
  const domain = resolveDevE2eDomain(specPaths);
  return {
    domain,
    ownerHint: domain,
    ciProfile: "full",
  };
}

function moduleNameFromPythonPath(sourceRef) {
  return sourceRef.replace(/\.py$/, "").split("/").join(".");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function sortedRouteValues(values) {
  const input = Array.isArray(values) ? values : values === undefined || values === null ? [] : [values];
  return [...new Set(input
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map(String))].sort();
}

function routeValues(route, singular, plural) {
  return sortedRouteValues([
    ...(plural && Array.isArray(route?.[plural]) ? route[plural] : []),
    ...(route?.[singular] === undefined ? [] : [route[singular]]),
  ]);
}

function normalizeAuthorityContributor(route) {
  const presence = {
    sourceRefs: Object.hasOwn(route || {}, "sourceRef") || Object.hasOwn(route || {}, "sourceRefs"),
    domains: Object.hasOwn(route || {}, "domain") || Object.hasOwn(route || {}, "domains"),
    ownerHints: Object.hasOwn(route || {}, "ownerHint") || Object.hasOwn(route || {}, "ownerHints"),
    tiers: ["layer", "layers", "tier", "tiers"].some((field) => Object.hasOwn(route || {}, field)),
    costs: Object.hasOwn(route || {}, "cost") || Object.hasOwn(route || {}, "costs"),
    resourceLocks: Object.hasOwn(route || {}, "resourceLocks"),
    executionOwners: Object.hasOwn(route || {}, "executionOwner") || Object.hasOwn(route || {}, "executionOwners"),
    ciProfiles: Object.hasOwn(route || {}, "ciProfile") || Object.hasOwn(route || {}, "ciProfiles"),
    platforms: Object.hasOwn(route || {}, "platform") || Object.hasOwn(route || {}, "platforms"),
    entrypointPolicy: Object.hasOwn(route || {}, "entrypointPolicy"),
  };
  const sourceRefs = Array.isArray(route?.sourceRefs)
    ? sortedRouteValues(route.sourceRefs)
    : sortedRouteValues(String(route?.sourceRef || "").split(","));
  const domains = routeValues(route, "domain", "domains");
  const ownerHints = routeValues(route, "ownerHint", "ownerHints");
  const tiers = sortedRouteValues([
    ...routeValues(route, "layer", "layers"),
    ...routeValues(route, "tier", "tiers"),
  ]);
  const costs = routeValues(route, "cost", "costs");
  const executionOwners = routeValues(route, "executionOwner", "executionOwners");
  const ciProfiles = routeValues(route, "ciProfile", "ciProfiles");
  const platforms = routeValues(route, "platform", "platforms");
  return {
    id: String(route?.id || ""),
    commandRef: String(route?.commandRef || ""),
    sourceRefs,
    domains,
    ownerHints,
    tiers,
    costs,
    resourceLocks: sortedRouteValues(route?.resourceLocks),
    executionOwners,
    ciProfiles,
    platforms: platforms.length > 0 ? platforms : ["all"],
    sourceKinds: sortedRouteValues(route?.authoritySource || route?.sourceKind || "selector-route"),
    entrypointPolicy: route?.entrypointPolicy ? structuredClone(route.entrypointPolicy) : null,
    presence,
  };
}

export function classifyVerificationExecutionOwners(executionOwners) {
  const owners = new Set(executionOwners);
  if (owners.has("ci-only")) return "ci-only";
  if (owners.has("main-thread")) return "main-thread";
  if (owners.size > 0 && [...owners].every((owner) => owner === "child-safe")) return "child-safe";
  return "blocked";
}

function assertAuthorityContributorSchema(contributor) {
  for (const field of [
    "sourceRefs",
    "domains",
    "ownerHints",
    "tiers",
    "costs",
    "executionOwners",
    "ciProfiles",
    "platforms",
  ]) {
    if (!Array.isArray(contributor[field]) || contributor[field].length === 0) {
      throw new Error(`verification-route-authority-required-field:${contributor.id}:${field}`);
    }
  }
  if (contributor.presence?.resourceLocks !== true || !Array.isArray(contributor.resourceLocks)) {
    throw new Error(`verification-route-authority-required-field:${contributor.id}:resourceLocks`);
  }
  for (const owner of contributor.executionOwners) {
    if (!EXECUTION_OWNERS.includes(owner)) {
      throw new Error(`verification-route-authority-invalid-execution-owner:${contributor.id}:${owner}`);
    }
  }
  for (const cost of contributor.costs) {
    if (!COSTS.includes(cost)) {
      throw new Error(`verification-route-authority-invalid-cost:${contributor.id}:${cost}`);
    }
  }
  for (const tier of contributor.tiers) {
    if (!LAYERS.includes(tier)) {
      throw new Error(`verification-route-authority-invalid-tier:${contributor.id}:${tier}`);
    }
  }
  for (const profile of contributor.ciProfiles) {
    if (!CI_PROFILES.includes(profile)) {
      throw new Error(`verification-route-authority-invalid-ci-profile:${contributor.id}:${profile}`);
    }
  }
  for (const lock of contributor.resourceLocks) {
    if (!RESOURCE_LOCKS.includes(lock)) {
      throw new Error(`verification-route-authority-invalid-resource-lock:${contributor.id}:${lock}`);
    }
  }
  for (const platform of contributor.platforms) {
    if (!PLATFORMS.includes(platform)) {
      throw new Error(`verification-route-authority-invalid-platform:${contributor.id}:${platform}`);
    }
  }
  if (contributor.executionOwners.includes("child-safe") && contributor.resourceLocks.length > 0) {
    throw new Error(`verification-route-authority-child-safe-resource-lock:${contributor.id}`);
  }
  if (contributor.executionOwners.includes("child-safe") && contributor.costs.includes("heavy")) {
    throw new Error(`verification-route-authority-child-safe-heavy:${contributor.id}`);
  }
}

/**
 * Reconcile every route contributor for a command into the selector's canonical
 * safety authority. Duplicate route ids must be byte-for-byte equivalent after
 * schema normalization, so retained metadata and generated routes cannot drift.
 */
export function reconcileVerificationRouteAuthority(routes = buildRouteIndex()) {
  if (!Array.isArray(routes)) throw new TypeError("verification-route-authority-invalid-routes");
  const contributorsById = new Map();
  for (const rawRoute of routes) {
    const contributor = normalizeAuthorityContributor(rawRoute);
    if (!contributor.id || !contributor.commandRef) {
      throw new Error(`verification-route-authority-invalid-contributor:${contributor.id || "<unknown>"}`);
    }
    assertAuthorityContributorSchema(contributor);
    const existing = contributorsById.get(contributor.id);
    if (existing) {
      const fields = Object.keys(contributor)
        .filter((field) => !new Set(["sourceKinds", "entrypointPolicy", "presence"]).has(field))
        .filter((field) => JSON.stringify(existing[field]) !== JSON.stringify(contributor[field]))
        .sort();
      const presenceFields = Object.keys(contributor.presence)
        .filter((field) => field !== "entrypointPolicy")
        .filter((field) => existing.presence[field] !== contributor.presence[field]);
      if (presenceFields.length > 0) fields.push("presence");
      if (fields.length > 0) {
        throw new Error(`verification-route-authority-source-drift:${contributor.id}:${fields.join(",")}`);
      }
      if (existing.entrypointPolicy && contributor.entrypointPolicy
        && JSON.stringify(existing.entrypointPolicy) !== JSON.stringify(contributor.entrypointPolicy)) {
        throw new Error(`verification-route-authority-policy-drift:${contributor.commandRef}`);
      }
      existing.entrypointPolicy ||= contributor.entrypointPolicy;
      existing.sourceKinds = sortedRouteValues([...existing.sourceKinds, ...contributor.sourceKinds]);
      existing.presence = Object.fromEntries(Object.keys(existing.presence)
        .map((field) => [field, existing.presence[field] || contributor.presence[field]]));
      continue;
    }
    contributorsById.set(contributor.id, contributor);
  }

  const byCommand = new Map();
  for (const contributor of contributorsById.values()) {
    const current = byCommand.get(contributor.commandRef) || [];
    current.push(contributor);
    byCommand.set(contributor.commandRef, current);
  }
  return [...byCommand.entries()].map(([commandRef, contributors]) => {
    contributors.sort((left, right) => left.id.localeCompare(right.id));
    const executionOwners = sortedRouteValues(contributors.flatMap((entry) => entry.executionOwners));
    const costs = sortedRouteValues(contributors.flatMap((entry) => entry.costs));
    const executionOwner = classifyVerificationExecutionOwners(executionOwners);
    const cost = costs.length === 0
      ? "unclassified"
      : costs.sort((left, right) => COSTS.indexOf(right) - COSTS.indexOf(left))[0];
    const platforms = sortedRouteValues(contributors.flatMap((entry) => entry.platforms));
    const ciProfiles = sortedRouteValues(contributors.flatMap((entry) => entry.ciProfiles));
    const presence = Object.fromEntries(Object.keys(contributors[0].presence)
      .map((field) => [field, contributors.every((entry) => entry.presence[field] === true)]));
    const resourceLocks = sortedRouteValues(contributors.flatMap((entry) => entry.resourceLocks));
    const explicitPolicies = contributors.filter((entry) => entry.presence.entrypointPolicy === true);
    const entrypointPolicy = explicitPolicies.length > 0
      ? structuredClone(explicitPolicies[0].entrypointPolicy)
      : deriveVerificationEntrypointPolicy({
        commandRef,
        cost,
        executionOwner,
        resourceLocks,
        ciProfiles,
      });
    if (explicitPolicies.some((entry) => (
      JSON.stringify(entry.entrypointPolicy) !== JSON.stringify(entrypointPolicy)
    ))) {
      throw new Error(`verification-route-authority-policy-drift:${commandRef}`);
    }
    if (!VERIFICATION_ENTRYPOINT_DEPTHS.includes(entrypointPolicy.minimumDepth)
      || entrypointPolicy.eligibleEntrypoints.some((entrypoint) => !VERIFICATION_ENTRYPOINT_IDS.includes(entrypoint))) {
      throw new Error(`verification-route-authority-invalid-entrypoint-policy:${commandRef}`);
    }
    return {
      commandRef,
      routeIds: contributors.map((entry) => entry.id),
      safetyContributorRouteIds: contributors.map((entry) => entry.id),
      sourceRefs: sortedRouteValues(contributors.flatMap((entry) => entry.sourceRefs)),
      sourceKinds: sortedRouteValues(contributors.flatMap((entry) => entry.sourceKinds)),
      domains: sortedRouteValues(contributors.flatMap((entry) => entry.domains)),
      ownerHints: sortedRouteValues(contributors.flatMap((entry) => entry.ownerHints)),
      executionOwners,
      executionOwner,
      cost,
      platforms: platforms.length > 0 ? platforms : ["all"],
      resourceLocks,
      tiers: sortedRouteValues(contributors.flatMap((entry) => entry.tiers)),
      ciProfiles,
      entrypointPolicy,
      presence,
      metadataComplete: COSTS.includes(cost)
        && EXECUTION_OWNERS.includes(executionOwner)
        && contributors.every((entry) => entry.sourceRefs.length > 0)
        && contributors.every((entry) => entry.domains.length > 0)
        && contributors.every((entry) => entry.ownerHints.length > 0)
        && contributors.every((entry) => entry.tiers.length > 0)
        && contributors.every((entry) => entry.presence.resourceLocks === true)
        && platforms.length > 0
        && ciProfiles.length > 0,
      contributors,
    };
  // Match catalog sealing and the cross-language selector artifact contract.
  // Locale collation orders punctuation differently (e.g. precision.py vs
  // precision_validation.py), which would change the prepared identity.
  }).sort((left, right) => left.commandRef < right.commandRef ? -1 : left.commandRef > right.commandRef ? 1 : 0);
}

function e2eCost(primaryLayer) {
  if (primaryLayer === "smoke") return "fast";
  if (primaryLayer === "contract") return "contract";
  return "heavy";
}

export function buildE2eRoutes() {
  const manifest = readJson(E2E_MANIFEST_PATH);
  const specs = Array.isArray(manifest?.specs) ? manifest.specs : [];
  return specs.map((spec) => ({
    id: `e2e:${spec.specPath}`,
    commandRef: spec.commandRef ?? `node tools/e2e_layering.mjs run-spec ${spec.specPath}`,
    sourceRef: spec.specPath,
    domain: spec.domain,
    ownerHint: spec.ownerHint,
    layer: spec.primaryLayer,
    cost: e2eCost(spec.primaryLayer),
    resourceLocks: ["browser-dev-server", "playwright-browser", ".runtime-output"],
    executionOwner: "main-thread",
    ciProfile: spec.ciProfile ?? (spec.primaryLayer === "smoke" ? "pr-smoke" : "full"),
  }));
}

export function buildNodeRoutes(
  packageJson = readJson(PACKAGE_JSON_PATH),
  verificationMetadata = VERIFICATION_DOMAINS,
) {
  const scripts = packageJson.scripts || {};
  const platformsByCommand = new Map(verificationMetadata
    .filter((entry) => Array.isArray(entry.platforms))
    .map((entry) => [entry.commandRef, entry.platforms]));
  return Object.entries(scripts)
    .filter(([name]) => name.startsWith("test:node:"))
    .map(([name, command]) => {
      const testFiles = resolveNodeScriptTestFiles(scripts, name, command);
      const entryFiles = extractNodeEntrypointPaths(command);
      const sourceRefs = uniqueValues([
        ...entryFiles,
        ...testFiles,
        ...(name === "test:node:ocean-depth-layer-contracts"
          ? ["js/core/renderer/political_background_render_owner.js"]
          : []),
        ...[...entryFiles, ...testFiles]
          .flatMap((sourceFile) => collectFileDependencies(sourceFile)),
      ]);
      const domain = resolveNodeRouteDomain(name, sourceRefs);
      const isFullP4StateWriterPolicy = name === "test:node:p4:state-writer-policy";
      const route = {
        id: `node:${name}`,
        commandRef: name,
        sourceRef: sourceRefs.join(","),
        domain,
        ownerHint: domain === "test-routing" ? "test-infra" : domain,
        layer: isFullP4StateWriterPolicy ? "heavy" : "contract",
        cost: isFullP4StateWriterPolicy ? "heavy" : "fast",
        resourceLocks: isFullP4StateWriterPolicy ? [".runtime-output"] : [],
        executionOwner: isFullP4StateWriterPolicy ? "main-thread" : "child-safe",
        ciProfile: isFullP4StateWriterPolicy ? "full" : "pr-fast",
      };
      const platforms = platformsByCommand.get(name);
      if (platforms) route.platforms = [...platforms];
      return route;
    });
}

export function buildDirectE2EScriptRoutes(packageJson = readJson(PACKAGE_JSON_PATH)) {
  const scripts = packageJson.scripts || {};
  return Object.entries(scripts)
    .filter(([name]) => isDirectE2EScriptRoute(name))
    .map(([name, command]) => {
      const specPaths = extractCommandPaths(command, "spec\\.js");
      const metadata = resolveDirectE2eMetadata(name, specPaths);
      return {
        id: `direct-e2e:${name}`,
        commandRef: name,
        sourceRef: specPaths.join(","),
        domain: metadata.domain,
        ownerHint: metadata.ownerHint,
        layer: "heavy",
        cost: "heavy",
        resourceLocks: ["browser-dev-server", "playwright-browser", ".runtime-output"],
        executionOwner: "main-thread",
        ciProfile: metadata.ciProfile,
      };
    });
}

export function buildRouteIndex() {
  return buildCanonicalRouteIndex();
}

export function pythonCommandForTestPath(sourceRef) {
  const absolutePath = path.join(REPO_ROOT, sourceRef);
  const source = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
  const hasTopLevelPytestTests = /(?:^|\n)def\s+test_[A-Za-z0-9_]*\s*\(/.test(source);
  if (hasTopLevelPytestTests) {
    return `python -m pytest ${sourceRef} -q`;
  }
  const hasUnittestCase = /\bunittest\.TestCase\b/.test(source);
  const hasPytestStyleTests = /(?:^|\n)\s*def\s+test_[A-Za-z0-9_]*\s*\(/.test(source);
  if (hasPytestStyleTests && !hasUnittestCase) {
    return `python -m pytest ${sourceRef} -q`;
  }
  return `python -m unittest ${moduleNameFromPythonPath(sourceRef)} -q`;
}

export function summarizeRoutes(routes) {
  return {
    count: routes.length,
    domains: uniqueValues(routes.map((route) => route.domain)).sort(),
    owners: uniqueValues(routes.map((route) => route.ownerHint)).sort(),
    resourceLocks: uniqueValues(routes.flatMap((route) => route.resourceLocks)).sort(),
    executionOwners: uniqueValues(routes.map((route) => route.executionOwner)).sort(),
  };
}

export function validateRoute(route, packageJson = readJson(PACKAGE_JSON_PATH), directCommands = null) {
  for (const field of ROUTE_SCHEMA_FIELDS) {
    if (!(field in route)) {
      throw new Error(`Route ${route?.id || "<unknown>"} is missing schema field: ${field}`);
    }
  }
  for (const field of ["id", "commandRef", "sourceRef", "domain", "ownerHint", "layer", "cost", "executionOwner", "ciProfile"]) {
    if (typeof route[field] !== "string" || !route[field].trim()) {
      throw new Error(`Route ${route?.id || "<unknown>"} has invalid string field: ${field}`);
    }
  }
  if (!Array.isArray(route.resourceLocks)) {
    throw new Error(`Route ${route.id} resourceLocks must be an array.`);
  }
  if (!EXECUTION_OWNERS.includes(route.executionOwner)) {
    throw new Error(`Route ${route.id} has invalid executionOwner: ${route.executionOwner}`);
  }
  if (!COSTS.includes(route.cost)) {
    throw new Error(`Route ${route.id} has invalid cost: ${route.cost}`);
  }
  if (!LAYERS.includes(route.layer)) {
    throw new Error(`Route ${route.id} has invalid layer: ${route.layer}`);
  }
  if (!CI_PROFILES.includes(route.ciProfile)) {
    throw new Error(`Route ${route.id} has invalid ciProfile: ${route.ciProfile}`);
  }
  if (route.executionOwner === "child-safe" && route.resourceLocks.length > 0) {
    throw new Error(`Route ${route.id} is child-safe but declares resource locks.`);
  }
  if (route.executionOwner === "child-safe" && route.cost === "heavy") {
    throw new Error(`Route ${route.id} is child-safe but has heavy cost.`);
  }
  for (const lock of route.resourceLocks) {
    if (!RESOURCE_LOCKS.includes(lock)) {
      throw new Error(`Route ${route.id} has invalid resource lock: ${lock}`);
    }
  }
  validateRouteGuidance(route);
  const scripts = packageJson.scripts || {};
  const exactDirectCommands = directCommands || new Set([
    ...VERIFICATION_EXACT_DIRECT_COMMAND_REFS,
    ...buildCanonicalRouteIndex().map((entry) => entry.commandRef),
  ]);
  const knownCommand =
    route.commandRef in scripts ||
    exactDirectCommands.has(route.commandRef);
  if (!knownCommand) {
    throw new Error(`Route ${route.id} commandRef is not a package script or known command: ${route.commandRef}`);
  }
}

function validateRouteGuidance(route) {
  if (route.guidance === undefined) return;
  if (!route.guidance || typeof route.guidance !== "object" || Array.isArray(route.guidance)) {
    throw new Error(`Route ${route.id} guidance must be an object.`);
  }
  for (const field of Object.keys(route.guidance)) {
    if (!ROUTE_GUIDANCE_FIELDS.includes(field)) {
      throw new Error(`Route ${route.id} guidance has unknown field: ${field}`);
    }
    if (ROUTE_GUIDANCE_ARRAY_FIELDS.has(field)) {
      const value = route.guidance[field];
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
        throw new Error(`Route ${route.id} guidance.${field} must be an array of strings.`);
      }
    }
  }
  if ("status" in route.guidance && (typeof route.guidance.status !== "string" || !route.guidance.status.trim())) {
    throw new Error(`Route ${route.id} guidance.status must be a string.`);
  }
}

export function validateRouteIndex(routes = buildRouteIndex()) {
  const packageJson = readJson(PACKAGE_JSON_PATH);
  const directCommands = new Set([
    ...VERIFICATION_EXACT_DIRECT_COMMAND_REFS,
    ...buildCanonicalRouteIndex().map((entry) => entry.commandRef),
  ]);
  const seen = new Set();
  for (const route of routes) {
    validateRoute(route, packageJson, directCommands);
    if (seen.has(route.id)) {
      throw new Error(`Duplicate route id: ${route.id}`);
    }
    seen.add(route.id);
  }
  return summarizeRoutes(routes);
}

// Discover executable entrypoints from actual package/manifest files, not a second
// hand-maintained metadata table. This catches a missing canonical route.
export function validateDiscoveredRouteCoverage(routes = buildRouteIndex(), {
  packageJson = readJson(PACKAGE_JSON_PATH),
  e2eRoutes = buildE2eRoutes(),
  heavyGroups = readJson(PYTHON_HEAVY_GROUPS_PATH),
} = {}) {
  const routed = new Set(routes.map((route) => route.commandRef));
  const expected = new Set([
    ...Object.keys(packageJson.scripts || {}).filter((name) => /^test:(?:node|py|python):/u.test(name)),
    ...buildDirectE2EScriptRoutes(packageJson).map((route) => route.commandRef),
    ...e2eRoutes.map((route) => route.commandRef),
    ...Object.values(heavyGroups).flatMap((group) => group.patterns || []).map(pythonCommandForTestPath),
  ]);
  const scripts = packageJson.scripts || {};
  const normalizeCommand = (command) => String(command).trim()
    .replace(/^npm run python -- /u, "python ")
    .replace(/^node tools\/run_python\.mjs /u, "python ");
  const routedCommands = new Set([...routed].map((ref) => normalizeCommand(scripts[ref] || ref)));
  function covered(ref, seen = new Set()) {
    if (routed.has(ref) || routedCommands.has(normalizeCommand(scripts[ref] || ref))) return true;
    if (!scripts[ref] || seen.has(ref)) return false;
    const next = new Set([...seen, ref]);
    // Only pure npm aliases/aggregates inherit coverage. Inline commands or
    // forwarded arguments require their own route, rather than being skipped.
    const pieces = scripts[ref].split("&&").map((piece) => piece.trim());
    return pieces.every((piece) => {
      if (!/^npm (?:run|run-script) [\w:.-]+$/u.test(piece)) return false;
      return extractNpmScriptRefs(piece, "").every((child) => covered(child, next));
    });
  }
  const missing = [...expected].filter((command) => !covered(command)).sort();
  if (missing.length) throw new Error(`verification-route-coverage-missing:${missing.join(",")}`);
  return { discoveredCommands: expected.size };
}
