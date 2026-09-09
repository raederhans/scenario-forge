import {
  createDefaultAppearancePresetsState,
} from "../js/core/state/appearance_preset_state.js";
import {
  createDefaultBootState,
} from "../js/core/state/boot_state.js";
import {
  createDefaultBorderCacheState,
} from "../js/core/state/border_cache_state.js";
import {
  createDefaultColorPresetState,
  createDefaultColorState,
} from "../js/core/state/color_state.js";
import {
  createDefaultContentState,
} from "../js/core/state/content_state.js";
import {
  createDefaultDevState,
} from "../js/core/state/dev_state.js";
import {
  createDefaultHistoryState,
} from "../js/core/state/history_state.js";
import {
  createDefaultIntensityFieldsState,
} from "../js/core/state/intensity_field_state.js";
import {
  createDefaultRendererInfrastructureState,
  createDefaultIntensityFieldToolState,
  createDefaultRendererTransientRuntimeState,
} from "../js/core/state/renderer_runtime_state.js";
import {
  createDefaultScenarioRuntimeState,
} from "../js/core/state/scenario_runtime_state.js";
import {
  createDefaultSpatialIndexState,
} from "../js/core/state/spatial_index_state.js";
import {
  createDefaultStrategicOverlayState,
} from "../js/core/state/strategic_overlay_state.js";
import {
  createDefaultUiChromeState,
  createDefaultUiPresentationState,
  createDefaultUiState,
} from "../js/core/state/ui_state.js";
import {
  STATE_HANDLER_HOOK_NAMES,
  STATE_NOTIFICATION_HOOK_NAMES,
} from "../js/core/state/config.js";
import {
  createDefaultStateCatalog,
} from "../js/core/state_catalog.js";
import {
  state as runtimeStateFacade,
} from "../js/core/state.js";
import {
  buildStateActionCrossFileMigrationContractIdentity,
  expandStateActionMembershipsWithLegacyReplacements,
  findStateActionDelegationContractEntry,
  findStateActionCrossFileMigrationContractEntry,
  findStateActionSuccessorProofContractEntry,
  validateStateActionCrossFileMigrationContract,
} from "./state_action_delegation_contract.mjs";
import {
  compareP4StateActionPhases,
  normalizeP4StateActionPhase,
} from "./p4_state_action_phases.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "acorn";
import * as walk from "acorn-walk";

const DEFAULT_FACTORY_DEFINITIONS = Object.freeze([
  ["boot", "js/core/state/boot_state.js#createDefaultBootState", createDefaultBootState],
  [
    "renderer-infrastructure",
    "js/core/state/renderer_runtime_state.js#createDefaultRendererInfrastructureState",
    createDefaultRendererInfrastructureState,
  ],
  [
    "content",
    "js/core/state/content_state.js#createDefaultContentState",
    createDefaultContentState,
  ],
  [
    "scenario-runtime",
    "js/core/state/scenario_runtime_state.js#createDefaultScenarioRuntimeState",
    createDefaultScenarioRuntimeState,
  ],
  [
    "state-catalog",
    "js/core/state_catalog.js#createDefaultStateCatalog",
    createDefaultStateCatalog,
  ],
  ["color", "js/core/state/color_state.js#createDefaultColorState", createDefaultColorState],
  ["dev", "js/core/state/dev_state.js#createDefaultDevState", createDefaultDevState],
  ["ui", "js/core/state/ui_state.js#createDefaultUiState", createDefaultUiState],
  [
    "strategic-overlay",
    "js/core/state/strategic_overlay_state.js#createDefaultStrategicOverlayState",
    createDefaultStrategicOverlayState,
  ],
  [
    "border-cache",
    "js/core/state/border_cache_state.js#createDefaultBorderCacheState",
    createDefaultBorderCacheState,
  ],
  [
    "ui-presentation",
    "js/core/state/ui_state.js#createDefaultUiPresentationState",
    createDefaultUiPresentationState,
  ],
  [
    "history",
    "js/core/state/history_state.js#createDefaultHistoryState",
    createDefaultHistoryState,
  ],
  [
    "color-preset",
    "js/core/state/color_state.js#createDefaultColorPresetState",
    createDefaultColorPresetState,
  ],
  [
    "ui-chrome",
    "js/core/state/ui_state.js#createDefaultUiChromeState",
    createDefaultUiChromeState,
  ],
  [
    "spatial-index",
    "js/core/state/spatial_index_state.js#createDefaultSpatialIndexState",
    createDefaultSpatialIndexState,
  ],
  [
    "renderer-transient",
    "js/core/state/renderer_runtime_state.js#createDefaultRendererTransientRuntimeState",
    createDefaultRendererTransientRuntimeState,
  ],
]);

const EXPLICIT_STATE_KEYS = Object.freeze([
  "intensityFieldTool",
  "intensityFields",
  "appearancePresets",
  "countryPalette",
  "defaultCountryPalette",
  "legacyDefaultCountryPalette",
  "countryNames",
  "countryPresets",
  "detailOverlaySupportTiers",
]);

const FACTORY_DOMAIN_BY_ID = Object.freeze({
  boot: Object.freeze(["boot", "P4.1"]),
  "renderer-infrastructure": Object.freeze(["renderer", "P4.3"]),
  content: Object.freeze(["content", "P4.2"]),
  "scenario-runtime": Object.freeze(["scenario", "P4.2"]),
  "state-catalog": Object.freeze(["scenario", "P4.2"]),
  color: Object.freeze(["color", "P4.4"]),
  dev: Object.freeze(["dev", "P4.4"]),
  ui: Object.freeze(["ui", "P4.4"]),
  "strategic-overlay": Object.freeze(["strategic-overlay", "P4.4"]),
  "border-cache": Object.freeze(["renderer", "P4.3"]),
  "ui-presentation": Object.freeze(["ui", "P4.4"]),
  history: Object.freeze(["history", "P4.4"]),
  "color-preset": Object.freeze(["color", "P4.4"]),
  "ui-chrome": Object.freeze(["ui", "P4.4"]),
  "spatial-index": Object.freeze(["renderer", "P4.3"]),
  "renderer-transient": Object.freeze(["renderer", "P4.3"]),
});

const EXPLICIT_KEY_DOMAINS = Object.freeze({
  intensityFieldTool: Object.freeze(["appearance", "P4.4"]),
  intensityFields: Object.freeze(["appearance", "P4.4"]),
  appearancePresets: Object.freeze(["appearance", "P4.4"]),
  countryPalette: Object.freeze(["color", "P4.4"]),
  defaultCountryPalette: Object.freeze(["color", "P4.4"]),
  legacyDefaultCountryPalette: Object.freeze(["color", "P4.4"]),
  countryNames: Object.freeze(["content", "P4.2"]),
  countryPresets: Object.freeze(["content", "P4.2"]),
  detailOverlaySupportTiers: Object.freeze(["scenario", "P4.2"]),
});

const LAZY_STATE_KEY_DOMAINS = Object.freeze({
  activePostReadyTaskKey: Object.freeze(["boot", "P4.1"]),
  activePostReadyTaskStartedAt: Object.freeze(["boot", "P4.1"]),
  canvasLayers: Object.freeze(["renderer", "P4.3"]),
  colorCanvas: Object.freeze(["renderer", "P4.3"]),
  colorCtx: Object.freeze(["renderer", "P4.3"]),
  countryInspectorShowDetails: Object.freeze(["ui", "P4.4"]),
  currentScenarioApplyRequestId: Object.freeze(["scenario", "P4.2"]),
  currentScenarioApplyTargetId: Object.freeze(["scenario", "P4.2"]),
  debugMode: Object.freeze(["renderer", "P4.3"]),
  devWorkspaceTagPopoverDismissHandler: Object.freeze(["dev", "P4.4"]),
  hgoRuntimePreview: Object.freeze(["renderer", "P4.3"]),
  inspectorHighlightFeatureIds: Object.freeze(["color", "P4.4"]),
  inspectorHighlightGroupMode: Object.freeze(["color", "P4.4"]),
  inspectorHighlightLabel: Object.freeze(["color", "P4.4"]),
  interactionOverlayCanvas: Object.freeze(["renderer", "P4.3"]),
  interactionOverlayCtx: Object.freeze(["renderer", "P4.3"]),
  lastDirtyReason: Object.freeze(["ui", "P4.4"]),
  latestScenarioApplyRequestId: Object.freeze(["scenario", "P4.2"]),
  latestScenarioApplyTargetId: Object.freeze(["scenario", "P4.2"]),
  legendColorOrder: Object.freeze(["color", "P4.4"]),
  legendControl: Object.freeze(["ui", "P4.4"]),
  lineCanvas: Object.freeze(["renderer", "P4.3"]),
  lineCtx: Object.freeze(["renderer", "P4.3"]),
  longAnimationFrameObserver: Object.freeze(["boot", "P4.1"]),
  mediterraneanAtlantropaBoundsCache: Object.freeze(["renderer", "P4.3"]),
  politicalPatchCanvas: Object.freeze(["renderer", "P4.3"]),
  politicalPatchCtx: Object.freeze(["renderer", "P4.3"]),
  postReadyTaskDiagnostics: Object.freeze(["boot", "P4.1"]),
  projectedBoundsDiagnostics: Object.freeze(["renderer", "P4.3"]),
  renderPerfMetrics: Object.freeze(["renderer", "P4.3"]),
  renderTransactionDiagnostics: Object.freeze(["renderer", "P4.3"]),
  renderPerfMetricSequence: Object.freeze(["renderer", "P4.3"]),
  scenarioWaterCacheCoverageAlgo: Object.freeze(["renderer", "P4.3"]),
  scenarioWaterCacheMode: Object.freeze(["renderer", "P4.3"]),
  resolveSpecialZoneParentGroupTargetIdsFn: Object.freeze([
    "runtime-hooks",
    "P4.5",
  ]),
  runtimePoliticalFeatureCollectionSeed: Object.freeze(["scenario", "P4.2"]),
  scenarioApplyActiveRequestId: Object.freeze(["scenario", "P4.2"]),
  scenarioApplyActiveTargetId: Object.freeze(["scenario", "P4.2"]),
  scenarioAtlantropaRevision: Object.freeze(["scenario", "P4.2"]),
  scenarioChunkPromotionRenderLocked: Object.freeze(["scenario", "P4.2"]),
  scenarioFatalRecovery: Object.freeze(["scenario", "P4.2"]),
  scenarioPerfMetrics: Object.freeze(["scenario", "P4.2"]),
  scenarioPresentationStyleBeforeActivate: Object.freeze([
    "scenario",
    "P4.2",
  ]),
  scenarioRuntimeShellVersion: Object.freeze(["scenario", "P4.2"]),
  selectionVersion: Object.freeze(["scenario", "P4.2"]),
  specialZoneMembershipTool: Object.freeze(["ui", "P4.4"]),
  specialZonePresetCategory: Object.freeze(["ui", "P4.4"]),
  specialZonePresetOpenCategories: Object.freeze(["ui", "P4.4"]),
  specialZonePreviousTool: Object.freeze(["ui", "P4.4"]),
  startupInitialScenarioChunkVisualPromotion: Object.freeze(["boot", "P4.1"]),
  syncDayNightClockTimerFn: Object.freeze(["runtime-hooks", "P4.5"]),
  uiHydrationError: Object.freeze(["boot", "P4.1"]),
  uiHydrationStatus: Object.freeze(["boot", "P4.1"]),
  uiHydrationUpdatedAt: Object.freeze(["boot", "P4.1"]),
  uiShellDebug: Object.freeze(["boot", "P4.1"]),
  uiShellDebugTerritorySeeded: Object.freeze(["boot", "P4.1"]),
  updateSpecialZonesWorkbenchCurrentTargetUIFn: Object.freeze([
    "runtime-hooks",
    "P4.5",
  ]),
  updateSpecialZonesWorkbenchUIFn: Object.freeze([
    "runtime-hooks",
    "P4.5",
  ]),
  waterCacheCoverageAlgo: Object.freeze(["renderer", "P4.3"]),
  waterCacheMode: Object.freeze(["renderer", "P4.3"]),
});

const CANONICAL_STATE_FACADE_PATH = "js/core/state.js";

function normalizeStringList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(String))]
    .sort((left, right) => left.localeCompare(right));
}

function stablePathList(values = []) {
  return normalizeStringList(values).map((value) => value.replaceAll("\\", "/"));
}

function createViolation(code, details = {}) {
  return {
    code,
    ...details,
  };
}

// 路径分类只为通配键和诊断提供迁移归属；具体未注册键仍由
// resolveStateWriterFindingAuthority 标成 unknown，不能借此获得写权限。
export function classifyStateWriterFallbackAuthority(relativePath = "") {
  const normalizedPath = String(relativePath || "").replaceAll("\\", "/");
  if (
    normalizedPath.includes("/scenario")
    || normalizedPath.includes("scenario_")
  ) {
    return {
      domain: "scenario",
      migrationPhase: "P4.2",
      owner: "path-fallback",
    };
  }
  if (
    normalizedPath.includes("/renderer/")
    || normalizedPath.includes("map_renderer")
    || normalizedPath.includes("hgo_runtime")
  ) {
    return {
      domain: "renderer",
      migrationPhase: "P4.3",
      owner: "path-fallback",
    };
  }
  if (
    normalizedPath.includes("/bootstrap/")
    || normalizedPath.endsWith("/main.js")
  ) {
    return {
      domain: "boot",
      migrationPhase: "P4.1",
      owner: "path-fallback",
    };
  }
  if (normalizedPath.includes("strategic")) {
    return {
      domain: "strategic-overlay",
      migrationPhase: "P4.4",
      owner: "path-fallback",
    };
  }
  if (
    normalizedPath.includes("appearance")
    || normalizedPath.includes("palette")
  ) {
    return {
      domain: "appearance",
      migrationPhase: "P4.4",
      owner: "path-fallback",
    };
  }
  if (normalizedPath.includes("/ui/")) {
    return {
      domain: "ui",
      migrationPhase: "P4.4",
      owner: "path-fallback",
    };
  }
  return {
    domain: "cross-domain",
    migrationPhase: "multi-phase",
    owner: "path-fallback",
  };
}

export function buildCanonicalStateKeyAuthorityCatalog({
  additionalFactoryGroups = [],
  additionalExplicitKeys = [],
  additionalLazyStateKeyDomains = {},
  additionalCompatibilityHooks = [],
} = {}) {
  const factoryGroups = [
    ...DEFAULT_FACTORY_DEFINITIONS.map(([id, source, createValue]) => ({
      id,
      source,
      value: createValue(),
      domain: FACTORY_DOMAIN_BY_ID[id]?.[0] || "cross-domain",
      migrationPhase:
        FACTORY_DOMAIN_BY_ID[id]?.[1] || "multi-phase",
    })),
    ...(Array.isArray(additionalFactoryGroups)
      ? additionalFactoryGroups
      : []),
  ].map((group) => ({
    id: String(group?.id || ""),
    source: String(group?.source || ""),
    value: group?.value && typeof group.value === "object"
      ? group.value
      : {},
    domain: String(group?.domain || "cross-domain"),
    migrationPhase: String(group?.migrationPhase || "multi-phase"),
  }));
  const explicitKeys = [
    ...Object.entries(EXPLICIT_KEY_DOMAINS).map(
      ([key, [domain, migrationPhase]]) => ({
        key,
        domain,
        migrationPhase,
        owner: `explicit:${key}`,
      }),
    ),
    ...(Array.isArray(additionalExplicitKeys) ? additionalExplicitKeys : []),
  ].map((entry) => ({
    key: String(entry?.key || ""),
    domain: String(entry?.domain || "cross-domain"),
    migrationPhase: String(entry?.migrationPhase || "multi-phase"),
    owner: String(entry?.owner || `explicit:${entry?.key || ""}`),
  }));
  const lazyKeys = [
    ...Object.entries(LAZY_STATE_KEY_DOMAINS),
    ...Object.entries(
      additionalLazyStateKeyDomains
      && typeof additionalLazyStateKeyDomains === "object"
        ? additionalLazyStateKeyDomains
        : {},
    ),
  ].map(([key, authority]) => ({
    key: String(key || ""),
    domain: String(authority?.[0] || "cross-domain"),
    migrationPhase: String(authority?.[1] || "multi-phase"),
    owner: `lazy:${key}`,
  }));
  const compatibilityHooks = normalizeStringList([
    ...STATE_NOTIFICATION_HOOK_NAMES,
    ...STATE_HANDLER_HOOK_NAMES,
    ...(Array.isArray(additionalCompatibilityHooks)
      ? additionalCompatibilityHooks
      : []),
  ]);
  const index = new Map();
  const collisions = [];
  const facadeKeys = new Set();
  const register = ({
    key,
    domain,
    migrationPhase,
    owner,
    facade = false,
  }) => {
    const normalizedKey = String(key || "");
    if (!normalizedKey) {
      return;
    }
    const authority = {
      domain: String(domain || ""),
      migrationPhase: String(migrationPhase || ""),
      owner: String(owner || ""),
    };
    if (index.has(normalizedKey)) {
      collisions.push({
        key: normalizedKey,
        owners: [index.get(normalizedKey), authority],
      });
      return;
    }
    index.set(normalizedKey, authority);
    if (facade) {
      facadeKeys.add(normalizedKey);
    }
  };

  for (const group of factoryGroups) {
    for (const key of Object.keys(group.value)) {
      register({
        key,
        domain: group.domain,
        migrationPhase: group.migrationPhase,
        owner: group.id,
        facade: true,
      });
    }
  }
  for (const entry of explicitKeys) {
    register({ ...entry, facade: true });
  }
  const preCompatKeys = new Set(facadeKeys);
  for (const entry of lazyKeys) {
    register({ ...entry, facade: false });
  }
  for (const hookName of compatibilityHooks) {
    register({
      key: hookName,
      domain: "runtime-hooks",
      migrationPhase: "P4.5",
      owner: `compat:${hookName}`,
      facade: true,
    });
  }

  return {
    index,
    collisions: collisions.sort(
      (left, right) => left.key.localeCompare(right.key),
    ),
    factoryGroups,
    explicitKeys,
    lazyKeys,
    compatibilityHooks,
    preCompatKeys: [...preCompatKeys].sort(),
    registeredFacadeKeys: [...facadeKeys].sort(),
  };
}

export function buildCanonicalStateKeyAuthorityIndex(options = {}) {
  const catalog = buildCanonicalStateKeyAuthorityCatalog(options);
  if (catalog.collisions.length) {
    const error = new Error(
      `Canonical state key authority collisions: ${
        catalog.collisions.map(({ key }) => key).join(", ")
      }`,
    );
    error.code = "state-key-authority-collision";
    error.collisions = catalog.collisions;
    throw error;
  }
  return catalog.index;
}

export function resolveStateWriterFindingAuthority(
  finding,
  relativePath,
  stateKeyAuthorityIndex = buildCanonicalStateKeyAuthorityIndex(),
) {
  const key = String(finding?.key || "");
  const canonicalAuthority = stateKeyAuthorityIndex.get(key);
  if (canonicalAuthority) {
    return canonicalAuthority;
  }
  const fallback = classifyStateWriterFallbackAuthority(relativePath);
  if (key && key !== "*") {
    return {
      domain: "",
      migrationPhase: "",
      owner: "unregistered",
      unknown: true,
      fallback,
    };
  }
  return fallback;
}

function getPolicyBindings(policy = {}) {
  const bindings = [];
  for (const writer of Array.isArray(policy?.writers) ? policy.writers : []) {
    for (const binding of Array.isArray(writer?.bindings) ? writer.bindings : []) {
      bindings.push({
        writer,
        binding,
      });
    }
  }
  return bindings;
}

function findPolicyWriter(policy, path) {
  return (Array.isArray(policy?.writers) ? policy.writers : [])
    .find((writer) => writer?.path === path);
}

function findPolicyBinding(writer, bindingId) {
  return (Array.isArray(writer?.bindings) ? writer.bindings : [])
    .find((binding) => binding?.id === bindingId);
}

function flattenBindingGrants(binding = {}) {
  const grants = Array.isArray(binding?.grants) ? binding.grants : [];
  return {
    operations: normalizeStringList(
      grants.flatMap((grant) => grant?.operations || []),
    ),
    keys: normalizeStringList(
      grants.flatMap((grant) => grant?.keys || []),
    ),
    memberships: grants.flatMap((grant) =>
      (Array.isArray(grant?.memberships) ? grant.memberships : []).map(
        (membership) => ({
          domain: String(grant?.domain || ""),
          migrationPhase: String(grant?.migrationPhase || ""),
          operation: String(membership?.operation || ""),
          key: String(membership?.key || ""),
        }),
      )
    ),
    aliasSites: grants.flatMap((grant) => grant?.aliasSites || []),
    dynamicSites: grants.flatMap((grant) => grant?.dynamicSites || []),
    ambiguousSites: grants.flatMap((grant) => grant?.ambiguousSites || []),
    unsupportedSites: grants.flatMap((grant) => grant?.unsupportedSites || []),
  };
}

// 新策略优先用源代码指纹稳定匹配；旧策略缺少指纹时才退回行列坐标，
// 这样插入无关代码不会自动扩大已有授权，同时保留旧快照可读性。
function siteFingerprintMatches(site, finding) {
  const expected = String(site?.sourceFingerprint || "").trim();
  const actual = String(finding?.sourceFingerprint || "").trim();
  return expected && actual ? expected === actual : null;
}

function aliasSiteMatches(site, finding) {
  const fingerprintMatch = siteFingerprintMatches(site, finding);
  return String(site?.alias || "") === String(finding?.alias || "")
    && (
      !Array.isArray(site?.aliasChain)
      || JSON.stringify(site.aliasChain.map(String))
        === JSON.stringify((finding?.aliasChain || []).map(String))
    )
    && (!site?.operation || site.operation === finding.operation)
    && (!site?.key || site.key === finding.key)
    && (
      fingerprintMatch === null
        ? (
          (!site?.line || Number(site.line) === Number(finding?.line))
          && (!site?.column || Number(site.column) === Number(finding?.column))
        )
        : fingerprintMatch
    );
}

function dynamicSiteMatches(site, finding) {
  const fingerprintMatch = siteFingerprintMatches(site, finding);
  return (
    fingerprintMatch === null
      ? (
        Number(site?.line) === Number(finding?.line)
        && Number(site?.column) === Number(finding?.column)
      )
      : fingerprintMatch
  )
    && (!site?.operation || site.operation === finding.operation)
    && (!site?.key || site.key === finding.key);
}

function ambiguousSiteMatches(site, finding) {
  const fingerprintMatch = siteFingerprintMatches(site, finding);
  return (
    fingerprintMatch === null
      ? (
        Number(site?.line) === Number(finding?.line)
        && Number(site?.column) === Number(finding?.column)
      )
      : fingerprintMatch
  )
    && String(site?.reason || "") === String(finding?.reason || "");
}

function unsupportedSiteMatches(site, finding) {
  const fingerprintMatch = siteFingerprintMatches(site, finding);
  return (
    fingerprintMatch === null
      ? (
        Number(site?.line) === Number(finding?.line)
        && Number(site?.column) === Number(finding?.column)
      )
      : fingerprintMatch
  )
    && String(site?.reason || "") === String(finding?.reason || "")
    && String(site?.operation || "") === String(finding?.operation || "")
    && String(site?.key || "") === String(finding?.key || "");
}

function aliasSiteKey(site = {}) {
  return [
    site.alias,
    JSON.stringify((site.aliasChain || []).map(String)),
    site.operation || "",
    site.key || "",
    site.sourceFingerprint
      || [site.line || "", site.column || ""].join(":"),
  ].join("|");
}

function dynamicSiteKey(site = {}) {
  return [
    site.operation || "",
    site.key || "",
    site.sourceFingerprint
      || [site.line || "", site.column || ""].join(":"),
  ].join("|");
}

function ambiguousSiteKey(site = {}) {
  return [
    site.reason,
    site.sourceFingerprint
      || [site.line || "", site.column || ""].join(":"),
  ].join("|");
}

function unsupportedSiteKey(site = {}) {
  return [
    site.reason,
    site.operation || "",
    site.key || "",
    site.sourceFingerprint
      || [site.line || "", site.column || ""].join(":"),
  ].join("|");
}

function incrementOccurrence(counts, key) {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function recordExactSiteOccurrence({
  counts,
  observedLocations,
  registeredSites,
  matchingSite,
  finding,
  keyForSite,
  violations,
  siteKind,
  path,
  bindingId,
}) {
  const siteKey = keyForSite(matchingSite);
  const occurrenceGroupKey = `${siteKind}|${siteKey}`;
  const occurrenceLocation = [
    Number(finding?.line || 0),
    Number(finding?.column || 0),
  ].join(":");
  const locations = observedLocations.get(occurrenceGroupKey) || new Set();
  if (locations.has(occurrenceLocation)) {
    return;
  }
  locations.add(occurrenceLocation);
  observedLocations.set(occurrenceGroupKey, locations);
  incrementOccurrence(counts, siteKey);
  const observedCount = counts.get(siteKey) || 0;
  const allowedCount = registeredSites.reduce(
    (count, site) => count + (keyForSite(site) === siteKey ? 1 : 0),
    0,
  );
  if (observedCount > allowedCount) {
    violations.push(
      createViolation("observed-site-occurrence-overflow", {
        siteKind,
        path,
        bindingId,
        siteKey,
        allowedCount,
        observedCount,
      }),
    );
  }
}

function consumeOccurrence(counts, key) {
  const count = counts.get(key) || 0;
  if (count < 1) {
    return false;
  }
  counts.set(key, count - 1);
  return true;
}

function makeMembershipKey(path, bindingId, finding) {
  return [
    path,
    bindingId,
    finding.operation,
    finding.key,
  ].join("|");
}

const METRIC_AUTHORITY_KEYS = Object.freeze({
  "legacy-direct": "legacyDirect",
  "legacy-target": "legacyTarget",
  "domain-action": "domainAction",
  "compat-facade": "compatFacade",
  "compatibility-only": "compatibilityOnly",
  "test-fixture": "testFixture",
});

function createSurfaceAuthoritySets() {
  return {
    production: Object.fromEntries(
      Object.values(METRIC_AUTHORITY_KEYS).map((key) => [key, new Set()]),
    ),
    test: Object.fromEntries(
      Object.values(METRIC_AUTHORITY_KEYS).map((key) => [key, new Set()]),
    ),
  };
}

function createDiagnosticReasonSets() {
  return {
    production: new Map(),
    test: new Map(),
  };
}

function addDiagnosticReasonSite(reasonSets, surface, reason, siteKey) {
  const normalizedReason = String(reason || "").trim() || "unknown";
  if (!reasonSets[surface].has(normalizedReason)) {
    reasonSets[surface].set(normalizedReason, new Set());
  }
  reasonSets[surface].get(normalizedReason).add(siteKey);
}

function summarizeDiagnosticReasonSets(reasonSets, surface) {
  const byReason = Object.fromEntries(
    [...reasonSets[surface].entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, sites]) => [reason, sites.size]),
  );
  return {
    byReason,
    total: Object.values(byReason).reduce(
      (total, count) => total + count,
      0,
    ),
  };
}

function summarizeSurfaceAuthoritySets(surfaceSets) {
  function summarizeSurface(surface) {
    const counts = Object.fromEntries(
      Object.values(METRIC_AUTHORITY_KEYS).map((key) => [
        key,
        surfaceSets[surface][key].size,
      ]),
    );
    counts.legacyCombined = counts.legacyDirect + counts.legacyTarget;
    counts.all = Object.values(METRIC_AUTHORITY_KEYS)
      .reduce((total, key) => total + counts[key], 0);
    return counts;
  }

  const production = summarizeSurface("production");
  const test = summarizeSurface("test");
  const total = {};
  for (const key of [...Object.values(METRIC_AUTHORITY_KEYS), "legacyCombined", "all"]) {
    total[key] = production[key] + test[key];
  }
  return { production, test, total };
}

function metricSiteKey(path, bindingId, finding) {
  return [
    path,
    bindingId,
    finding.line || "",
    finding.column || "",
    finding.operation || "",
    finding.key || "",
    finding.reason || "",
    finding.alias || "",
  ].join("|");
}

export function summarizeStateWriterFindingRecords(records = []) {
  const memberships = createSurfaceAuthoritySets();
  const dynamicSites = createSurfaceAuthoritySets();
  const aliasSites = createSurfaceAuthoritySets();
  const ambiguousSites = createSurfaceAuthoritySets();
  const unsupportedSites = createSurfaceAuthoritySets();
  const diagnosticReasons = createDiagnosticReasonSets();

  for (const record of Array.isArray(records) ? records : []) {
    const surface = record?.surface === "test" ? "test" : "production";
    const authorityKey = METRIC_AUTHORITY_KEYS[record?.authority];
    if (!authorityKey) continue;
    for (const finding of Array.isArray(record?.findings) ? record.findings : []) {
      const siteKey = metricSiteKey(record.path, record.bindingId, finding);
      if (finding?.unsupported) {
        addDiagnosticReasonSite(
          diagnosticReasons,
          surface,
          finding.reason,
          siteKey,
        );
        if (finding.reason === "ambiguous-alias-flow") {
          ambiguousSites[surface][authorityKey].add(siteKey);
        } else {
          unsupportedSites[surface][authorityKey].add(siteKey);
        }
        continue;
      }
      memberships[surface][authorityKey].add(
        makeMembershipKey(record.path, record.bindingId, finding),
      );
      if (finding?.dynamic) {
        dynamicSites[surface][authorityKey].add(siteKey);
      }
      if (finding?.alias) {
        aliasSites[surface][authorityKey].add(siteKey);
      }
    }
  }

  return {
    memberships: summarizeSurfaceAuthoritySets(memberships),
    sites: {
      dynamic: summarizeSurfaceAuthoritySets(dynamicSites),
      alias: summarizeSurfaceAuthoritySets(aliasSites),
      ambiguous: summarizeSurfaceAuthoritySets(ambiguousSites),
      unsupported: summarizeSurfaceAuthoritySets(unsupportedSites),
    },
    diagnostics: {
      production: summarizeDiagnosticReasonSets(
        diagnosticReasons,
        "production",
      ),
      test: summarizeDiagnosticReasonSets(diagnosticReasons, "test"),
    },
  };
}

export function validateTestDiagnosticBudget({
  baseline = {},
  current = {},
} = {}) {
  const violations = [];
  const baselineReasons = baseline?.byReason
    && typeof baseline.byReason === "object"
    ? baseline.byReason
    : {};
  const currentReasons = current?.byReason
    && typeof current.byReason === "object"
    ? current.byReason
    : {};
  const isValidCount = (value) =>
    typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0;
  let baselineReasonTotal = 0;
  for (const [reason, count] of Object.entries(baselineReasons)
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (!isValidCount(count)) {
      violations.push({
        code: "test-diagnostic-baseline-count-invalid",
        reason,
        actual: count,
      });
      continue;
    }
    baselineReasonTotal += count;
  }
  let currentReasonTotal = 0;
  for (const [reason, count] of Object.entries(currentReasons)
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (!isValidCount(count)) {
      violations.push({
        code: "test-diagnostic-reason-count-invalid",
        reason,
        actual: count,
      });
      continue;
    }
    currentReasonTotal += count;
    if (!(reason in baselineReasons)) {
      if (count > 0) {
        violations.push({
          code: "test-diagnostic-reason-added",
          reason,
          actual: count,
        });
      }
      continue;
    }
    const baselineCount = baselineReasons[reason];
    if (isValidCount(baselineCount) && count > baselineCount) {
      violations.push({
        code: "test-diagnostic-reason-increased",
        reason,
        previous: baselineCount,
        current: count,
      });
    }
  }
  if (!isValidCount(baseline?.total)) {
    violations.push({
      code: "test-diagnostic-baseline-total-invalid",
      actual: baseline?.total,
    });
  } else if (baseline.total !== baselineReasonTotal) {
    violations.push({
      code: "test-diagnostic-baseline-total-mismatch",
      expected: baselineReasonTotal,
      actual: baseline.total,
    });
  }
  if (!isValidCount(current?.total)) {
    violations.push({
      code: "test-diagnostic-total-invalid",
      actual: current?.total,
    });
  } else {
    if (current.total !== currentReasonTotal) {
      violations.push({
        code: "test-diagnostic-total-mismatch",
        expected: currentReasonTotal,
        actual: current.total,
      });
    }
    if (
      isValidCount(baseline?.total)
      && current.total > baseline.total
    ) {
      violations.push({
        code: "test-diagnostic-total-increased",
        previous: baseline.total,
        current: current.total,
      });
    }
  }
  return violations;
}

export function getLegacyDirectAllowlistProjection(policy = {}) {
  return stablePathList(
    (Array.isArray(policy?.writers) ? policy.writers : [])
      .filter((writer) => writer?.authority === "legacy-direct")
      .map((writer) => writer.path),
  );
}

function isRegisteredP4Phase(value) {
  try {
    normalizeP4StateActionPhase(value);
    return true;
  } catch {
    return false;
  }
}

function callerToActionLedgerEntryProofs(entry = {}) {
  const firstHopProofs = Array.isArray(entry?.functionProofs)
    ? entry.functionProofs.map((proof) => ({
      ...entry,
      ...proof,
      functionProofs: undefined,
    }))
    : [entry];
  return firstHopProofs.flatMap((proof) => [
    proof,
    ...(proof.successorActionProofs || []).map((successor) => ({
      ...proof,
      ...successor,
      successorActionProofs: undefined,
      successorProofContractIdentity: undefined,
    })),
  ]);
}

function validateCallerToActionLedgerSchema(policy = {}) {
  const violations = [];
  violations.push(
    ...validateStateActionCrossFileMigrationContract(),
  );
  const progress = policy?.progress;
  if (!progress) {
    return violations;
  }
  const latestPhase = String(progress.latestPhase || "");
  const ledger = progress.callerToActionLedger;
  if (!ledger) {
    if (!["P4.0", "P4.1"].includes(latestPhase)) {
      violations.push(
        createViolation("caller-action-ledger-entry-invalid", {
          reason: "ledger-missing",
          latestPhase,
        }),
      );
    }
    return violations;
  }
  const ledgerSchemaVersion = Number(ledger.schemaVersion);
  const ledgerSchemaVersionValid =
    ledgerSchemaVersion === 1
    || (
      ledgerSchemaVersion === 2
      && isRegisteredP4Phase(latestPhase)
      && compareP4StateActionPhases(
        latestPhase,
        "P4.2b",
      ) >= 0
    )
    || (
      ledgerSchemaVersion === 3
      && isRegisteredP4Phase(latestPhase)
      && compareP4StateActionPhases(latestPhase, "P4.4") >= 0
    );
  if (!ledgerSchemaVersionValid) {
    violations.push(
      createViolation("caller-action-ledger-schema-version-invalid", {
        schemaVersion: ledger.schemaVersion,
      }),
    );
  }
  const entries = Array.isArray(ledger.entries) ? ledger.entries : null;
  if (!entries) {
    violations.push(
      createViolation("caller-action-ledger-entry-invalid", {
        reason: "entries-not-array",
      }),
    );
    return violations;
  }
  const sortedEntries = [...entries].sort(
    (left, right) =>
      String(left?.retiredMembershipIdentity || "").localeCompare(
        String(right?.retiredMembershipIdentity || ""),
      )
      || String(
        left?.actionCallEdgeIdentity
          || left?.functionProofs?.[0]?.actionCallEdgeIdentity
          || "",
      ).localeCompare(
        String(
          right?.actionCallEdgeIdentity
            || right?.functionProofs?.[0]?.actionCallEdgeIdentity
            || "",
        ),
      ),
  );
  if (JSON.stringify(entries) !== JSON.stringify(sortedEntries)) {
    violations.push(
      createViolation("caller-action-ledger-order-invalid"),
    );
  }
  const retiredMemberships = new Set(
    progress?.retiredLegacySemanticAuthority?.memberships || [],
  );
  const seenRetiredMemberships = new Set();
  for (const [index, entry] of entries.entries()) {
    const retiredMembershipIdentity = String(
      entry?.retiredMembershipIdentity || "",
    );
    if (seenRetiredMemberships.has(retiredMembershipIdentity)) {
      violations.push(
        createViolation("caller-action-ledger-entry-duplicate", {
          index,
          retiredMembershipIdentity,
        }),
      );
    }
    seenRetiredMemberships.add(retiredMembershipIdentity);
    const functionProofs = Array.isArray(entry?.functionProofs)
      ? entry.functionProofs
      : null;
    if (functionProofs) {
      const retiredCallerPath = String(
        entry?.retiredCallerPath || "",
      );
      const retiredCallerBindingIdentity = String(
        entry?.retiredCallerBindingIdentity || "",
      );
      let parsedRetiredCallerBindingIdentity = null;
      try {
        parsedRetiredCallerBindingIdentity = JSON.parse(
          retiredCallerBindingIdentity,
        );
      } catch {
        parsedRetiredCallerBindingIdentity = null;
      }
      const sortedFunctionProofs = [...functionProofs].sort(
        (left, right) =>
          String(
            left?.retiredEnclosingFunctionIdentity || "",
          ).localeCompare(
            String(
              right?.retiredEnclosingFunctionIdentity || "",
            ),
          )
          || String(
            left?.actionCallEdgeIdentity || "",
          ).localeCompare(
            String(right?.actionCallEdgeIdentity || ""),
          ),
      );
      const retiredFunctionIdentities = functionProofs.map(
        (proof) =>
          String(
            proof?.retiredEnclosingFunctionIdentity || "",
          ),
      );
      const retiredMutationSiteCount = Number(
        entry?.retiredMutationSiteCount,
      );
      const topLevelEdgeFields = [
        "callerPath",
        "callerBindingId",
        "callerBindingIdentity",
        "enclosingFunctionIdentity",
        "retiredEnclosingFunctionIdentity",
        "actionModulePath",
        "actionExportName",
        "targetArgumentIndex",
        "actionCallEdgeIdentity",
        "occurrenceIndex",
        "start",
        "end",
        "line",
        "column",
        "sourceFingerprint",
        "successorActionProofs",
        "successorProofContractIdentity",
      ];
      const multiFunctionProofInvalid =
        ![2, 3].includes(ledgerSchemaVersion)
        || !retiredCallerPath
        || !parsedRetiredCallerBindingIdentity
        || retiredMembershipIdentity !== [
          retiredCallerPath,
          retiredCallerBindingIdentity,
          String(entry?.domain || ""),
          String(entry?.migrationPhase || ""),
          String(entry?.operation || ""),
          String(entry?.key || ""),
        ].join("|")
        || functionProofs.length < 2
        || JSON.stringify(functionProofs)
          !== JSON.stringify(sortedFunctionProofs)
        || new Set(retiredFunctionIdentities).size
          !== functionProofs.length
        || retiredFunctionIdentities.some((identity) => !identity)
        || !/^[0-9a-f]{64}$/i.test(
          String(entry?.retiredMutationSiteFingerprint || ""),
        )
        || !Number.isInteger(retiredMutationSiteCount)
        || retiredMutationSiteCount <= 0
        || Number(entry?.retiredMutationFunctionCount)
          !== functionProofs.length
        || functionProofs.reduce(
          (total, proof) =>
            total + Number(proof?.retiredMutationSiteCount || 0),
          0,
        ) !== retiredMutationSiteCount
        || entry?.proofPrecision
          !== "exact-site-multi-function"
        || functionProofs.some(
          (proof) =>
            String(proof?.callerPath || "")
              !== retiredCallerPath
            || String(proof?.callerBindingIdentity || "")
              !== retiredCallerBindingIdentity,
        )
        || topLevelEdgeFields.some(
          (field) => entry?.[field] !== undefined,
        );
      if (multiFunctionProofInvalid) {
        violations.push(
          createViolation("caller-action-ledger-entry-invalid", {
            index,
            retiredMembershipIdentity,
            reason: "multi-function-proof-invalid",
          }),
        );
      }
    }
    const proofEntries = functionProofs
      ? functionProofs.map((proof) => ({
        ...entry,
        ...proof,
        functionProofs: undefined,
        proofPrecision: proof?.proofPrecision,
        retiredCallerPath: undefined,
        retiredCallerBindingIdentity: undefined,
      }))
      : [entry];
    for (const entry of proofEntries) {
    const callerPath = String(entry?.callerPath || "");
    const callerBindingId = String(entry?.callerBindingId || "");
    const callerBindingIdentity = String(
      entry?.callerBindingIdentity || "",
    );
    const domain = String(entry?.domain || "");
    const migrationPhase = String(entry?.migrationPhase || "");
    const operation = String(entry?.operation || "");
    const key = String(entry?.key || "");
    const actionModulePath = String(entry?.actionModulePath || "");
    const actionExportName = String(entry?.actionExportName || "");
    const actionCallEdgeIdentity = String(
      entry?.actionCallEdgeIdentity || "",
    );
    const crossFileMigration =
      findStateActionCrossFileMigrationContractEntry(
        retiredMembershipIdentity,
      );
    const retiredCallerPath = String(
      entry?.retiredCallerPath || callerPath,
    );
    const retiredCallerBindingIdentity = String(
      entry?.retiredCallerBindingIdentity
        || callerBindingIdentity,
    );
    const crossFileMigrationContractIdentity = String(
      entry?.crossFileMigrationContractIdentity || "",
    );
    const expectedRetiredIdentity = [
      retiredCallerPath,
      retiredCallerBindingIdentity,
      domain,
      migrationPhase,
      operation,
      key,
    ].join("|");
    let parsedBindingIdentity = null;
    let parsedRetiredBindingIdentity = null;
    try {
      parsedBindingIdentity = JSON.parse(callerBindingIdentity);
    } catch {
      parsedBindingIdentity = null;
    }
    try {
      parsedRetiredBindingIdentity = JSON.parse(
        retiredCallerBindingIdentity,
      );
    } catch {
      parsedRetiredBindingIdentity = null;
    }
    const actionContract =
      findStateActionDelegationContractEntry(
        actionModulePath,
        actionExportName,
      );
    const actionWriter = (policy?.writers || []).find(
      (writer) =>
        writer?.path === actionModulePath
        && writer?.authority === "domain-action",
    );
    const actionBinding = actionWriter?.bindings?.find(
      (binding) =>
        binding?.authority === "domain-action"
        && binding?.functionName === actionExportName,
    );
    const actionBindingMemberships = new Set(
      (actionBinding?.grants || []).flatMap(
        (grant) => (grant?.memberships || []).map(
          (membership) => [
            String(grant?.domain || ""),
            String(grant?.migrationPhase || ""),
            String(membership?.operation || ""),
            String(membership?.key || ""),
          ].join("|"),
        ),
      ),
    );
    const actionOwnsMembership =
      expandStateActionMembershipsWithLegacyReplacements({
        modulePath: actionModulePath,
        exportName: actionExportName,
        memberships: (actionBinding?.grants || []).flatMap(
          (grant) =>
            (grant?.memberships || []).map((membership) =>
              [
                String(grant?.domain || ""),
                String(grant?.migrationPhase || ""),
                String(membership?.operation || ""),
                String(membership?.key || ""),
              ].join("|")
            ),
        ),
      }).has([
        domain,
        migrationPhase,
        operation,
        key,
      ].join("|"));
    const successorActionProofs = Array.isArray(
      entry?.successorActionProofs,
    ) ? entry.successorActionProofs : null;
    const successorContract =
      findStateActionSuccessorProofContractEntry(
        actionModulePath,
        actionExportName,
        [domain, migrationPhase, operation, key].join("|"),
      );
    const firstActionBindingIdentity = actionBinding
      ? JSON.stringify({
        kind: String(actionBinding.kind || ""),
        name: "",
        functionName: String(actionBinding.functionName || ""),
        parameterName: "",
        parameterIndex: Number(actionBinding.parameterIndex),
        parameterPath: String(actionBinding.parameterPath || ""),
        importSource: "",
        importedName: "",
        aliasSources: [],
        aliasOperators: [],
      })
      : "";
    const successorDescriptor = (proof) => ({
      enclosingFunctionIdentity: String(
        proof?.enclosingFunctionIdentity || "",
      ),
      actionModulePath: String(proof?.actionModulePath || ""),
      actionExportName: String(proof?.actionExportName || ""),
      targetArgumentIndex: Number(proof?.targetArgumentIndex),
      sourceFingerprint: String(proof?.sourceFingerprint || ""),
      occurrenceIndex: Number(proof?.occurrenceIndex),
      terminalMembership: String(
        proof?.terminalMembership || "",
      ),
    });
    const expectedSuccessorDescriptors = successorContract
      ? successorContract.successorEdges.map(successorDescriptor)
        .sort((left, right) => JSON.stringify(left).localeCompare(
          JSON.stringify(right),
        ))
      : [];
    const actualSuccessorDescriptors = successorActionProofs
      ? successorActionProofs.map(successorDescriptor)
        .sort((left, right) => JSON.stringify(left).localeCompare(
          JSON.stringify(right),
        ))
      : [];
    const successorProofsValid = successorActionProofs
      ? (
        ledgerSchemaVersion === 3
        && !actionOwnsMembership
        && successorContract
        && entry?.successorProofContractIdentity
          === successorContract.contractIdentity
        && successorActionProofs.length > 0
        && JSON.stringify(actualSuccessorDescriptors)
          === JSON.stringify(expectedSuccessorDescriptors)
        && successorContract.requiredDirectMemberships.every(
          (requiredMembership) =>
            actionBindingMemberships.has(requiredMembership)
        )
        && successorActionProofs.every((successor) => {
          const terminalContract =
            findStateActionDelegationContractEntry(
              successor?.actionModulePath,
              successor?.actionExportName,
            );
          const terminalWriter = (policy?.writers || []).find(
            (writer) =>
              writer?.path === successor?.actionModulePath
              && writer?.authority === "domain-action",
          );
          const terminalBinding = terminalWriter?.bindings?.find(
            (binding) =>
              binding?.authority === "domain-action"
              && binding?.functionName
                === successor?.actionExportName,
          );
          const terminalOwnsMembership = (terminalBinding?.grants || [])
            .some((grant) => (grant?.memberships || []).some(
              (membership) => [
                String(grant?.domain || ""),
                String(grant?.migrationPhase || ""),
                String(membership?.operation || ""),
                String(membership?.key || ""),
              ].join("|")
                === String(successor?.terminalMembership || ""),
            ));
          return successor?.callerPath === actionModulePath
            && successor?.callerBindingIdentity
              === firstActionBindingIdentity
            && terminalContract
            && Number(successor?.targetArgumentIndex)
              === terminalContract.targetArgumentIndex
            && terminalOwnsMembership
            && /^[0-9a-f]{64}$/i.test(
              String(successor?.actionCallEdgeIdentity || ""),
            )
            && /^[0-9a-f]{64}$/i.test(
              String(successor?.sourceFingerprint || ""),
            )
            && Number.isInteger(Number(successor?.start))
            && Number.isInteger(Number(successor?.end))
            && Number.isInteger(Number(successor?.line))
            && Number.isInteger(Number(successor?.column));
        })
      )
      : (
        entry?.successorActionProofs === undefined
        && entry?.successorProofContractIdentity === undefined
        && actionOwnsMembership
        && (
          ledgerSchemaVersion < 3
          || !successorContract
        )
      );
    const targetArgumentIndex = Number(entry?.targetArgumentIndex);
    const occurrenceIndex = Number(entry?.occurrenceIndex);
    const start = Number(entry?.start);
    const end = Number(entry?.end);
    const line = Number(entry?.line);
    const column = Number(entry?.column);
    const sourceFingerprint = String(entry?.sourceFingerprint || "");
    const enclosingFunctionIdentity = String(
      entry?.enclosingFunctionIdentity || "",
    );
    const retiredEnclosingFunctionIdentity = String(
      entry?.retiredEnclosingFunctionIdentity || "",
    );
    const retiredEnclosingFunctionIdentities = Array.isArray(
      entry?.retiredEnclosingFunctionIdentities,
    )
      ? entry.retiredEnclosingFunctionIdentities.map(
        (identity) => String(identity || ""),
      )
      : null;
    const retiredMutationSiteFingerprint = String(
      entry?.retiredMutationSiteFingerprint || "",
    );
    const retiredMutationSiteCount = Number(
      entry?.retiredMutationSiteCount,
    );
    const proofPrecision = String(entry?.proofPrecision || "");
    const crossFileMutationSites = (
      crossFileMigration?.retiredMutationSites || []
    ).map((site) => ({
      enclosingFunctionIdentity: String(
        site?.enclosingFunctionIdentity || "",
      ),
      sourceFingerprint: String(
        site?.sourceFingerprint || "",
      ),
      occurrenceIndex: Number(site?.occurrenceIndex),
    }));
    const crossFileRetiredEnclosingFunctionIdentities =
      new Set(
        crossFileMutationSites.map(
          ({ enclosingFunctionIdentity: identity }) =>
            identity,
        ),
      );
    const crossFileRetiredEnclosingFunctionIdentity =
      crossFileRetiredEnclosingFunctionIdentities.size === 1
        ? [...crossFileRetiredEnclosingFunctionIdentities][0]
        : "";
    const crossFileRetiredEnclosingFunctionIdentityList = [
      ...crossFileRetiredEnclosingFunctionIdentities,
    ].sort((left, right) => left.localeCompare(right));
    const crossFileHasMultipleRetiredFunctions =
      crossFileRetiredEnclosingFunctionIdentityList.length > 1;
    const crossFileMutationSiteFingerprint =
      crossFileMutationSites.length
        ? createHash("sha256")
          .update(JSON.stringify(crossFileMutationSites))
          .digest("hex")
        : "";
    const crossFileProofValid = crossFileMigration
      ? (
        retiredCallerPath
          === crossFileMigration.retiredCallerPath
        && retiredCallerBindingIdentity
          === crossFileMigration.retiredCallerBindingIdentity
        && callerPath
          === crossFileMigration.replacementCallerPath
        && callerBindingIdentity
          === crossFileMigration.replacementCallerBindingIdentity
        && enclosingFunctionIdentity
          === crossFileMigration
            .replacementEnclosingFunctionIdentity
        && (
          crossFileHasMultipleRetiredFunctions
            ? (
              !retiredEnclosingFunctionIdentity
              && JSON.stringify(
                retiredEnclosingFunctionIdentities,
              ) === JSON.stringify(
                crossFileRetiredEnclosingFunctionIdentityList,
              )
              && Number(entry?.retiredMutationFunctionCount)
                === crossFileRetiredEnclosingFunctionIdentityList
                  .length
            )
            : (
              retiredEnclosingFunctionIdentity
                === crossFileRetiredEnclosingFunctionIdentity
              && retiredEnclosingFunctionIdentities === null
              && entry?.retiredMutationFunctionCount === undefined
            )
        )
        && actionModulePath
          === crossFileMigration.actionModulePath
        && actionExportName
          === crossFileMigration.actionExportName
        && targetArgumentIndex
          === crossFileMigration.targetArgumentIndex
        && sourceFingerprint
          === crossFileMigration
            .replacementActionSourceFingerprint
        && crossFileMigrationContractIdentity
          === crossFileMigration.contractIdentity
        && crossFileMigrationContractIdentity
          === buildStateActionCrossFileMigrationContractIdentity(
            crossFileMigration,
          )
        && retiredMutationSiteFingerprint
          === crossFileMutationSiteFingerprint
        && retiredMutationSiteCount
          === crossFileMutationSites.length
        && proofPrecision === (
          crossFileHasMultipleRetiredFunctions
            ? "explicit-cross-file-multi-function"
            : "explicit-cross-file"
        )
      )
      : (
        !entry?.retiredCallerPath
        && !entry?.retiredCallerBindingIdentity
        && retiredEnclosingFunctionIdentities === null
        && !crossFileMigrationContractIdentity
        && ![
          "explicit-cross-file",
          "explicit-cross-file-multi-function",
        ].includes(proofPrecision)
      );
    const retiredInPhase = String(entry?.retiredInPhase || "");
    const recordedInPhase = String(entry?.recordedInPhase || "");
    const registeredRetiredPhase =
      isRegisteredP4Phase(retiredInPhase);
    const registeredRecordedPhase =
      isRegisteredP4Phase(recordedInPhase);
    const registeredLatestPhase =
      isRegisteredP4Phase(latestPhase);
    const phaseOrderValid =
      registeredRetiredPhase
      && registeredRecordedPhase
      && registeredLatestPhase
      && compareP4StateActionPhases(
        retiredInPhase,
        recordedInPhase,
      ) <= 0
      && compareP4StateActionPhases(
        recordedInPhase,
        latestPhase,
      ) <= 0;
    const provenanceValid = entry?.backfilled === true
      ? (
        retiredInPhase === "P4.1"
        && recordedInPhase === "P4.2a"
      )
      : (
        entry?.backfilled === false
        && retiredInPhase === recordedInPhase
      );
    const preciseProofRequired =
      registeredRecordedPhase
      && compareP4StateActionPhases(
        recordedInPhase,
        "P4.2a",
      ) > 0;
    const preciseProofValid =
      crossFileMigration
        ? crossFileProofValid
        : (
          crossFileProofValid
          && (
            !preciseProofRequired
            || (
              enclosingFunctionIdentity
              && retiredEnclosingFunctionIdentity
              && enclosingFunctionIdentity
                === retiredEnclosingFunctionIdentity
              && /^[0-9a-f]{64}$/i.test(
                retiredMutationSiteFingerprint,
              )
              && Number.isInteger(retiredMutationSiteCount)
              && retiredMutationSiteCount > 0
              && proofPrecision === "exact-site"
            )
          )
        );
    const entryInvalid =
      !retiredMembershipIdentity
      || !callerPath
      || !callerBindingId
      || !parsedBindingIdentity
      || !parsedRetiredBindingIdentity
      || !domain
      || !migrationPhase
      || !operation
      || !key
      || !actionModulePath
      || !actionExportName
      || retiredMembershipIdentity !== expectedRetiredIdentity
      || !retiredMemberships.has(retiredMembershipIdentity)
      || !actionContract
      || !successorProofsValid
      || !Number.isInteger(targetArgumentIndex)
      || targetArgumentIndex !== actionContract?.targetArgumentIndex
      || !Number.isInteger(occurrenceIndex)
      || occurrenceIndex < 0
      || !Number.isInteger(start)
      || start < 0
      || !Number.isInteger(end)
      || end < start
      || !Number.isInteger(line)
      || line < 1
      || !Number.isInteger(column)
      || column < 0
      || !/^[0-9a-f]{64}$/i.test(sourceFingerprint)
      || !/^[0-9a-f]{64}$/i.test(actionCallEdgeIdentity)
      || !phaseOrderValid
      || !provenanceValid
      || !preciseProofValid;
    if (entryInvalid) {
      violations.push(
        createViolation("caller-action-ledger-entry-invalid", {
          index,
          retiredMembershipIdentity,
        }),
      );
    }
    }
  }
  if (
    seenRetiredMemberships.size !== retiredMemberships.size
    || [...retiredMemberships].some(
      (identity) => !seenRetiredMemberships.has(identity),
    )
  ) {
    violations.push(
      createViolation("caller-action-ledger-entry-invalid", {
        reason: "retired-membership-coverage-mismatch",
        expected: retiredMemberships.size,
        actual: seenRetiredMemberships.size,
      }),
    );
  }
  return violations;
}

export function validateStateWriterPolicySchema(policy = {}) {
  const violations = [];
  const semanticSections = [
    "bindings",
    "memberships",
    "aliasSites",
    "dynamicSites",
    "ambiguousSites",
    "unsupportedSites",
  ];
  const validateSemanticMultiset = (value, scope) => {
    for (const section of semanticSections) {
      const entries = value?.[section];
      if (
        !Array.isArray(entries)
        || entries.some((entry) => typeof entry !== "string" || !entry)
        || JSON.stringify(entries)
          !== JSON.stringify([...entries].sort())
      ) {
        violations.push(
          createViolation("legacy-semantic-multiset-invalid", {
            scope,
            section,
          }),
        );
      }
    }
  };
  const writerAuthorities = new Set([
    "legacy-direct",
    "legacy-target",
    "domain-action",
    "compat-facade",
  ]);
  const bindingAuthorities = new Set([
    "legacy-direct",
    "legacy-target",
    "domain-action",
    "compat-facade",
    "compatibility-only",
    "test-fixture",
  ]);
  const bindingKinds = new Set([
    "module",
    "function-parameter",
    "function-local",
    "function-local-alias",
    "test-file-root",
    "compatibility-only",
  ]);
  const surfaces = new Set(["production", "test"]);
  const seenWriterPaths = new Set();
  const domainActionAuthorityByMembership = new Map();
  const schemaVersion = Number(policy?.schemaVersion);
  if (![1, 2].includes(schemaVersion)) {
    violations.push(createViolation("unsupported-schema-version"));
  }
  const derivedAliasTaint =
    policy?.baselines?.derivedAliasTaint;
  if (schemaVersion === 1 && derivedAliasTaint !== undefined) {
    violations.push(
      createViolation(
        "derived-alias-taint-policy-schema-version-invalid",
      ),
    );
  }
  if (schemaVersion === 2) {
    if (
      !derivedAliasTaint
      || typeof derivedAliasTaint !== "object"
      || Array.isArray(derivedAliasTaint)
    ) {
      violations.push(
        createViolation("derived-alias-taint-baseline-missing"),
      );
    } else {
      if (Number(derivedAliasTaint.algorithmVersion) !== 1) {
        violations.push(
          createViolation(
            "derived-alias-taint-baseline-algorithm-invalid",
          ),
        );
      }
      const sourceBaseSha = String(
        derivedAliasTaint.sourceBaseSha || "",
      );
      if (
        !/^[0-9a-f]{40}$/.test(sourceBaseSha)
        || sourceBaseSha
          !== String(policy?.baseline?.sourceBaseSha || "")
      ) {
        violations.push(
          createViolation(
            "derived-alias-taint-baseline-source-invalid",
          ),
        );
      }
      const paths = derivedAliasTaint.paths;
      const normalizedPaths = normalizeStringList(paths);
      if (
        !Array.isArray(paths)
        || JSON.stringify(paths) !== JSON.stringify(normalizedPaths)
        || paths.some(
          (relativePath) =>
            !relativePath.startsWith("js/")
            || !relativePath.endsWith(".js")
            || relativePath.includes("\\")
            || relativePath.includes("/tests/"),
        )
      ) {
        violations.push(
          createViolation(
            "derived-alias-taint-baseline-paths-invalid",
          ),
        );
      }
      const transitionCheckpoints =
        derivedAliasTaint.transitionCheckpoints;
      if (transitionCheckpoints !== undefined) {
        const recordedTransitionPaths = new Set();
        if (!Array.isArray(transitionCheckpoints)) {
          violations.push(
            createViolation(
              "derived-alias-taint-transition-checkpoints-invalid",
            ),
          );
        } else {
          for (const checkpoint of transitionCheckpoints) {
            const checkpointPaths = normalizeStringList(
              checkpoint?.paths,
            );
            if (
              !checkpoint
              || typeof checkpoint !== "object"
              || Array.isArray(checkpoint)
              || !/^[0-9a-f]{40}$/.test(
                String(checkpoint.sourceSha || ""),
              )
              || !/^[0-9a-f]{64}$/.test(
                String(checkpoint.policyBlobSha256 || ""),
              )
              || !Array.isArray(checkpoint.paths)
              || JSON.stringify(checkpoint.paths)
                !== JSON.stringify(checkpointPaths)
              || !checkpointPaths.length
            ) {
              violations.push(
                createViolation(
                  "derived-alias-taint-transition-checkpoint-invalid",
                ),
              );
            }
            for (const relativePath of checkpointPaths) {
              if (
                !normalizedPaths.includes(relativePath)
                || recordedTransitionPaths.has(relativePath)
              ) {
                violations.push(
                  createViolation(
                    "derived-alias-taint-transition-path-invalid",
                    { path: relativePath },
                  ),
                );
              }
              recordedTransitionPaths.add(relativePath);
            }
          }
        }
      }
      const diagnosticDelta =
        derivedAliasTaint.diagnosticDelta;
      const diagnosticSections = [
        "ambiguousSites",
        "unsupportedSites",
      ];
      if (
        !diagnosticDelta
        || typeof diagnosticDelta !== "object"
        || Array.isArray(diagnosticDelta)
        || JSON.stringify(Object.keys(diagnosticDelta).sort())
          !== JSON.stringify(diagnosticSections)
      ) {
        violations.push(
          createViolation(
            "derived-alias-taint-baseline-delta-shape-invalid",
          ),
        );
      } else {
        for (const section of diagnosticSections) {
          const entries = diagnosticDelta[section];
          if (
            !Array.isArray(entries)
            || entries.some(
              (entry) => typeof entry !== "string" || !entry,
            )
            || JSON.stringify(entries)
              !== JSON.stringify([...entries].sort())
          ) {
            violations.push(
              createViolation(
                "derived-alias-taint-baseline-delta-invalid",
                { section },
              ),
            );
          }
        }
      }
    }
  }
  violations.push(...validateCallerToActionLedgerSchema(policy));
  if (policy?.baselines) {
    validateSemanticMultiset(
      policy.baselines.legacySemanticAuthority,
      "baselines.legacySemanticAuthority",
    );
    if (
      !Array.isArray(
        policy.baselines?.legacySemanticAuthority?.collisions,
      )
      || policy.baselines.legacySemanticAuthority.collisions.length
    ) {
      violations.push(
        createViolation("legacy-semantic-baseline-collisions", {
          collisions:
            policy.baselines?.legacySemanticAuthority?.collisions,
        }),
      );
    }
  }
  if (policy?.progress) {
    validateSemanticMultiset(
      policy.progress.retiredLegacySemanticAuthority,
      "progress.retiredLegacySemanticAuthority",
    );
  }
  for (const writer of Array.isArray(policy?.writers) ? policy.writers : []) {
    const writerPath = normalizeStringList([writer?.path])[0] || "";
    if (!writerPath) {
      violations.push(createViolation("writer-path-missing"));
      continue;
    }
    if (seenWriterPaths.has(writerPath)) {
      violations.push(createViolation("duplicate-writer-path", { path: writerPath }));
    }
    seenWriterPaths.add(writerPath);
    if (!surfaces.has(writer.surface)) {
      violations.push(
        createViolation("writer-surface-invalid", {
          path: writerPath,
          surface: writer.surface,
        }),
      );
    }
    if (!writerAuthorities.has(writer.authority)) {
      violations.push(
        createViolation("writer-authority-invalid", {
          path: writerPath,
          authority: writer.authority,
        }),
      );
    }
    const seenBindingIds = new Set();
    const bindings = Array.isArray(writer.bindings) ? writer.bindings : [];
    if (!bindings.length) {
      violations.push(createViolation("writer-bindings-empty", { path: writerPath }));
    }
    for (const binding of bindings) {
      const bindingId = String(binding?.id || "");
      if (!bindingId) {
        violations.push(createViolation("binding-id-missing", { path: writerPath }));
        continue;
      }
      if (seenBindingIds.has(bindingId)) {
        violations.push(
          createViolation("duplicate-binding-id", {
            path: writerPath,
            bindingId,
          }),
        );
      }
      seenBindingIds.add(bindingId);
      if (!bindingKinds.has(binding.kind)) {
        violations.push(
          createViolation("binding-kind-invalid", {
            path: writerPath,
            bindingId,
            kind: binding.kind,
          }),
        );
      }
      if (!bindingAuthorities.has(binding.authority)) {
        violations.push(
          createViolation("binding-authority-invalid", {
            path: writerPath,
            bindingId,
            authority: binding.authority,
          }),
        );
      }
      const expectedBindingAuthority =
        binding.authority === "compatibility-only"
          ? "compatibility-only"
          : writer.surface === "test"
            ? "test-fixture"
            : writerPath.startsWith("js/core/state/actions/")
              ? "domain-action"
              : writerPath === "js/core/state/index.js"
                ? "compat-facade"
                : binding.kind === "module"
                  ? "legacy-direct"
                  : "legacy-target";
      if (binding.authority !== expectedBindingAuthority) {
        violations.push(
          createViolation("binding-authority-classification-drift", {
            path: writerPath,
            bindingId,
            expected: expectedBindingAuthority,
            actual: binding.authority,
          }),
        );
      }
      const grants = Array.isArray(binding.grants) ? binding.grants : [];
      const delegationOnly = binding.delegationOnly === true;
      if (
        binding.delegationOnly !== undefined
        && binding.delegationOnly !== true
      ) {
        violations.push(
          createViolation("binding-delegation-only-invalid", {
            path: writerPath,
            bindingId,
          }),
        );
      }
      if (
        delegationOnly
        && (
          writer.surface !== "production"
          || binding.authority !== "domain-action"
          || binding.kind !== "function-parameter"
          || !writerPath.startsWith("js/core/state/actions/")
        )
      ) {
        violations.push(
          createViolation("binding-delegation-only-scope-invalid", {
            path: writerPath,
            bindingId,
          }),
        );
      }
      if (delegationOnly && grants.length) {
        violations.push(
          createViolation("binding-delegation-only-grants-present", {
            path: writerPath,
            bindingId,
          }),
        );
      }
      if (binding.authority === "compatibility-only") {
        if (grants.length) {
          violations.push(
            createViolation("compatibility-only-grants-present", {
              path: writerPath,
              bindingId,
            }),
          );
        }
        continue;
      }
      if (
        !grants.length
        && binding.authority !== "test-fixture"
        && !delegationOnly
      ) {
        violations.push(
          createViolation("binding-grants-empty", {
            path: writerPath,
            bindingId,
          }),
        );
      }
      if (
        binding.authority === "domain-action"
        && !writerPath.startsWith("js/core/state/actions/")
      ) {
        violations.push(
          createViolation("domain-action-placement-invalid", {
            path: writerPath,
            bindingId,
          }),
        );
      }
      const membershipGrantIndexes = new Map();
      const ambiguousSiteGrantIndexes = new Map();
      const unsupportedSiteGrantIndexes = new Map();
      for (const [grantIndex, grant] of grants.entries()) {
        if (policy?.baselines && writer.surface === "production") {
          for (const [siteKind, sites] of [
            ["alias", grant.aliasSites],
            ["dynamic", grant.dynamicSites],
            ["ambiguous", grant.ambiguousSites],
            ["unsupported", grant.unsupportedSites],
          ]) {
            for (const site of Array.isArray(sites) ? sites : []) {
              if (
                !/^[0-9a-f]{64}$/.test(
                  String(site?.sourceFingerprint || ""),
                )
              ) {
                violations.push(
                  createViolation(
                    "grant-site-source-fingerprint-invalid",
                    {
                      path: writerPath,
                      bindingId,
                      domain: grant.domain,
                      siteKind,
                      line: site?.line,
                      column: site?.column,
                    },
                  ),
                );
              }
            }
          }
        }
        if (
          writer.surface === "test"
          && (
            (grant.ambiguousSites || []).length
            || (grant.unsupportedSites || []).length
          )
        ) {
          violations.push(
            createViolation(
              "test-fixture-exact-diagnostic-grant-forbidden",
              {
                path: writerPath,
                bindingId,
                domain: grant.domain,
              },
            ),
          );
        }
        if (!String(grant?.domain || "").trim()) {
          violations.push(
            createViolation("grant-domain-missing", {
              path: writerPath,
              bindingId,
            }),
          );
        }
        if (!String(grant?.migrationPhase || "").trim()) {
          violations.push(
            createViolation("grant-phase-missing", {
              path: writerPath,
              bindingId,
            }),
          );
        }
        const memberships = Array.isArray(grant.memberships)
          ? grant.memberships
          : [];
        const membershipKeys = new Set();
        for (const membership of memberships) {
          const operation = String(membership?.operation || "").trim();
          const key = String(membership?.key || "").trim();
          if (!operation || !key) {
            violations.push(
              createViolation("grant-membership-invalid", {
                path: writerPath,
                bindingId,
                domain: grant.domain,
                operation,
                key,
              }),
            );
            continue;
          }
          const membershipKey = `${operation}|${key}`;
          if (membershipKeys.has(membershipKey)) {
            violations.push(
              createViolation("duplicate-grant-membership", {
                path: writerPath,
                bindingId,
                domain: grant.domain,
                operation,
                key,
              }),
            );
          }
          membershipKeys.add(membershipKey);
          if (
            writer.surface === "production"
            && binding.authority === "domain-action"
          ) {
            const authorityKey = [
              String(grant.domain || ""),
              String(grant.migrationPhase || ""),
              operation,
              key,
            ].join("|");
            const previousModulePath =
              domainActionAuthorityByMembership.get(authorityKey);
            if (
              previousModulePath
              && previousModulePath !== writerPath
            ) {
              violations.push(
                createViolation(
                  "duplicate-domain-action-membership-authority",
                  {
                    domain: String(grant.domain || ""),
                    migrationPhase:
                      String(grant.migrationPhase || ""),
                    operation,
                    key,
                    firstModulePath: previousModulePath,
                    duplicateModulePath: writerPath,
                  },
                ),
              );
            } else if (!previousModulePath) {
              domainActionAuthorityByMembership.set(
                authorityKey,
                writerPath,
              );
            }
          }
          if (membership?.mutationSites !== undefined) {
            const mutationSites = Array.isArray(
              membership.mutationSites,
            )
              ? membership.mutationSites
              : [];
            const mutationSiteIdentities = new Set();
            if (!Array.isArray(membership.mutationSites)) {
              violations.push(
                createViolation(
                  "grant-membership-mutation-sites-invalid",
                  {
                    path: writerPath,
                    bindingId,
                    operation,
                    key,
                  },
                ),
              );
            }
            for (const site of mutationSites) {
              const enclosingFunctionIdentity = String(
                site?.enclosingFunctionIdentity || "",
              );
              const sourceFingerprint = String(
                site?.sourceFingerprint || "",
              );
              const occurrenceIndex = Number(
                site?.occurrenceIndex,
              );
              const siteIdentity = [
                enclosingFunctionIdentity,
                sourceFingerprint,
                occurrenceIndex,
              ].join("|");
              if (
                !enclosingFunctionIdentity
                || !/^[0-9a-f]{64}$/i.test(sourceFingerprint)
                || !Number.isInteger(occurrenceIndex)
                || occurrenceIndex < 0
                || mutationSiteIdentities.has(siteIdentity)
              ) {
                violations.push(
                  createViolation(
                    "grant-membership-mutation-site-invalid",
                    {
                      path: writerPath,
                      bindingId,
                      operation,
                      key,
                    },
                  ),
                );
              }
              mutationSiteIdentities.add(siteIdentity);
            }
          }
          const previousGrantIndex = membershipGrantIndexes.get(membershipKey);
          if (
            previousGrantIndex !== undefined
            && previousGrantIndex !== grantIndex
          ) {
            violations.push(
              createViolation("duplicate-binding-membership", {
                path: writerPath,
                bindingId,
                operation,
                key,
                firstGrantIndex: previousGrantIndex,
                duplicateGrantIndex: grantIndex,
              }),
            );
          } else if (previousGrantIndex === undefined) {
            membershipGrantIndexes.set(membershipKey, grantIndex);
          }
        }
        const projectedOperations = normalizeStringList(
          memberships.map((membership) => membership?.operation),
        );
        const projectedKeys = normalizeStringList(
          memberships
            .map((membership) => membership?.key)
            .filter((key) => key !== "*"),
        );
        if (
          JSON.stringify(projectedOperations)
          !== JSON.stringify(normalizeStringList(grant.operations || []))
          || JSON.stringify(projectedKeys)
          !== JSON.stringify(normalizeStringList(grant.keys || []))
        ) {
          violations.push(
            createViolation("grant-membership-projection-mismatch", {
              path: writerPath,
              bindingId,
              domain: grant.domain,
            }),
          );
        }
        const ambiguousSiteKeys = new Set();
        for (const site of Array.isArray(grant.ambiguousSites)
          ? grant.ambiguousSites
          : []) {
          const isObject = Boolean(
            site
            && typeof site === "object"
            && !Array.isArray(site),
          );
          const line = Number(site?.line);
          const column = Number(site?.column);
          const reason = String(site?.reason || "").trim();
          if (
            !isObject
            || !Number.isInteger(line)
            || line < 1
            || !Number.isInteger(column)
            || column < 0
            || reason !== "ambiguous-alias-flow"
          ) {
            violations.push(
              createViolation("grant-ambiguous-site-invalid", {
                path: writerPath,
                bindingId,
                domain: grant.domain,
                line: site?.line,
                column: site?.column,
                reason,
              }),
            );
            continue;
          }
          const siteKey = [line, column, reason].join("|");
          if (ambiguousSiteKeys.has(siteKey)) {
            violations.push(
              createViolation("duplicate-grant-ambiguous-site", {
                path: writerPath,
                bindingId,
                domain: grant.domain,
                line,
                column,
                reason,
              }),
            );
          }
          ambiguousSiteKeys.add(siteKey);
          const previousGrantIndex = ambiguousSiteGrantIndexes.get(siteKey);
          if (
            previousGrantIndex !== undefined
            && previousGrantIndex !== grantIndex
          ) {
            violations.push(
              createViolation("duplicate-binding-ambiguous-site", {
                path: writerPath,
                bindingId,
                line,
                column,
                reason,
                firstGrantIndex: previousGrantIndex,
                duplicateGrantIndex: grantIndex,
              }),
            );
          } else if (previousGrantIndex === undefined) {
            ambiguousSiteGrantIndexes.set(siteKey, grantIndex);
          }
        }
        const unsupportedSiteKeys = new Set();
        for (const site of Array.isArray(grant.unsupportedSites)
          ? grant.unsupportedSites
          : []) {
          const line = Number(site?.line);
          const column = Number(site?.column);
          const reason = String(site?.reason || "").trim();
          const operation = String(site?.operation || "").trim();
          const key = String(site?.key || "").trim();
          if (
            !Number.isInteger(line)
            || line < 1
            || !Number.isInteger(column)
            || column < 0
            || !reason
            || !operation
            || !key
            || reason === "ambiguous-alias-flow"
          ) {
            violations.push(
              createViolation("grant-unsupported-site-invalid", {
                path: writerPath,
                bindingId,
                domain: grant.domain,
                line: site?.line,
                column: site?.column,
                reason,
                operation,
                key,
              }),
            );
            continue;
          }
          const siteKey = [
            line,
            column,
            reason,
            operation,
            key,
          ].join("|");
          if (unsupportedSiteKeys.has(siteKey)) {
            violations.push(
              createViolation("duplicate-grant-unsupported-site", {
                path: writerPath,
                bindingId,
                domain: grant.domain,
                line,
                column,
                reason,
                operation,
                key,
              }),
            );
          }
          unsupportedSiteKeys.add(siteKey);
          const previousGrantIndex = unsupportedSiteGrantIndexes.get(siteKey);
          if (
            previousGrantIndex !== undefined
            && previousGrantIndex !== grantIndex
          ) {
            violations.push(
              createViolation("duplicate-binding-unsupported-site", {
                path: writerPath,
                bindingId,
                line,
                column,
                reason,
                operation,
                key,
                firstGrantIndex: previousGrantIndex,
                duplicateGrantIndex: grantIndex,
              }),
            );
          } else if (previousGrantIndex === undefined) {
            unsupportedSiteGrantIndexes.set(siteKey, grantIndex);
          }
        }
        if (
          !memberships.length
          && !(grant.ambiguousSites || []).length
          && !(grant.unsupportedSites || []).length
        ) {
          violations.push(
            createViolation("grant-authority-empty", {
              path: writerPath,
              bindingId,
              domain: grant.domain,
            }),
          );
        }
      }
      if (
        writer.surface === "production"
        && binding.kind === "module"
        && writer.authority !== "legacy-direct"
        && grants.some(
          (grant) =>
            Array.isArray(grant?.memberships)
            && grant.memberships.length,
        )
      ) {
        violations.push(
          createViolation(
            "module-direct-membership-outside-allowlist",
            {
              path: writerPath,
              bindingId,
              writerAuthority: writer.authority,
            },
          ),
        );
      }
      if (
        writerPath.startsWith("js/core/state/actions/")
        && binding.kind === "module"
      ) {
        violations.push(
          createViolation("domain-action-global-state-import", {
            path: writerPath,
            bindingId,
          }),
        );
      }
    }
  }
  return violations;
}

function resolveImportPath(filePath, importSource) {
  const normalizedSource = String(importSource || "").replaceAll("\\", "/");
  if (!normalizedSource.startsWith(".") || !filePath) {
    return "";
  }
  let resolved = path.posix.normalize(
    path.posix.join(
      path.posix.dirname(String(filePath).replaceAll("\\", "/")),
      normalizedSource,
    ),
  );
  if (!path.posix.extname(resolved)) {
    resolved = `${resolved}.js`;
  }
  return resolved;
}

function classifyStateFacadeImportSource(importSource, filePath = "") {
  const normalizedSource = String(importSource || "").replaceAll("\\", "/");
  if (normalizedSource.startsWith(".")) {
    if (!filePath) {
      return normalizedSource === "./core/state.js"
        ? "canonical-relative"
        : "noncanonical";
    }
    const resolvedPath = resolveImportPath(filePath, importSource);
    return resolvedPath === CANONICAL_STATE_FACADE_PATH
      ? "canonical-relative"
      : "noncanonical";
  }
  let absolutePath = "";
  if (
    normalizedSource.startsWith("/")
    || /^[A-Za-z]:\//.test(normalizedSource)
  ) {
    absolutePath = normalizedSource.split(/[?#]/u, 1)[0];
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalizedSource)) {
    try {
      absolutePath = new URL(normalizedSource).pathname
        .replaceAll("\\", "/");
    } catch {
      absolutePath = "";
    }
  }
  const canonicalSuffix = `/${CANONICAL_STATE_FACADE_PATH}`;
  return (
    absolutePath === canonicalSuffix
    || absolutePath.endsWith(canonicalSuffix)
  )
    ? "canonical-absolute"
    : "noncanonical";
}

function getStaticModuleSource(node) {
  if (typeof node?.value === "string") {
    return node.value;
  }
  if (
    node?.type === "TemplateLiteral"
    && node.expressions?.length === 0
    && node.quasis?.length === 1
  ) {
    return String(node.quasis[0]?.value?.cooked || "");
  }
  return "";
}

function createModuleReference({
  node,
  importSource,
  sourceKind,
  specifierType,
  importedName = "",
  localName = "",
}) {
  return {
    importSource,
    sourceKind,
    specifierType,
    importedName,
    localName,
    line: Number(node?.loc?.start?.line || 1),
    column: Number(node?.loc?.start?.column || 0) + 1,
  };
}

function analyzeGlobalStateFacadeReferences(
  source = "",
  { filePath = "" } = {},
) {
  const references = [];
  const diagnostics = [];
  const stateShapedImports = [];
  let ast = null;
  try {
    ast = parse(String(source || ""), {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowHashBang: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch (error) {
    diagnostics.push({
      code: "domain-action-source-parse-failed",
      reason: String(error?.message || error),
      line: Number(error?.loc?.line || 1),
      column: Number(error?.loc?.column || 0) + 1,
    });
    return {
      references,
      diagnostics,
      stateShapedImports,
    };
  }

  const canonicalStateImportLocals = new Map();
  for (const node of ast.body || []) {
    if (node?.type !== "ImportDeclaration") {
      continue;
    }
    const importSource = String(node.source?.value || "");
    const sourceKind = classifyStateFacadeImportSource(
      importSource,
      filePath,
    );
    if (sourceKind !== "canonical-relative") {
      continue;
    }
    for (const specifier of node.specifiers || []) {
      if (
        specifier.type === "ImportSpecifier"
        && String(
          specifier.imported?.name
          || specifier.imported?.value
          || "",
        ) === "state"
        && specifier.local?.name
      ) {
        canonicalStateImportLocals.set(
          String(specifier.local.name),
          importSource,
        );
      }
    }
  }

  function recordReference({
    node,
    importSource,
    specifierType,
    importedName = "",
    localName = "",
  }) {
    const normalizedSource = String(importSource || "").replaceAll("\\", "/");
    const sourceKind = classifyStateFacadeImportSource(
      normalizedSource,
      filePath,
    );
    if (sourceKind === "noncanonical") {
      return;
    }
    references.push(
      createModuleReference({
        node,
        importSource: normalizedSource,
        sourceKind,
        specifierType,
        importedName,
        localName,
      }),
    );
  }

  walk.simple(ast, {
    ImportDeclaration(node) {
      const importSource = String(node.source?.value || "");
      if (!(node.specifiers || []).length) {
        recordReference({
          node,
          importSource,
          specifierType: "side-effect",
        });
      }
      for (const specifier of node.specifiers || []) {
        const importedName = specifier.type === "ImportSpecifier"
          ? String(specifier.imported?.name || specifier.imported?.value || "")
          : specifier.type === "ImportNamespaceSpecifier"
            ? "*"
            : "default";
        const sourceKind = classifyStateFacadeImportSource(
          importSource,
          filePath,
        );
        if (
          specifier.type === "ImportSpecifier"
          && importedName === "state"
          && sourceKind === "noncanonical"
        ) {
          stateShapedImports.push(
            createModuleReference({
              node: specifier,
              importSource,
              sourceKind,
              specifierType: "named",
              importedName,
              localName: String(specifier.local?.name || ""),
            }),
          );
        }
        recordReference({
          node: specifier,
          importSource,
          specifierType: specifier.type === "ImportSpecifier"
            ? "named"
            : specifier.type === "ImportNamespaceSpecifier"
              ? "namespace"
              : "default",
          importedName,
          localName: String(specifier.local?.name || ""),
        });
      }
    },
    ImportExpression(node) {
      const importSource = getStaticModuleSource(node.source);
      if (!importSource) {
        diagnostics.push({
          code: "domain-action-dynamic-import-unresolved",
          reason: "dynamic-import-source-is-not-static",
          line: Number(node.loc?.start?.line || 1),
          column: Number(node.loc?.start?.column || 0) + 1,
        });
        return;
      }
      recordReference({
        node,
        importSource,
        specifierType: "dynamic",
        importedName: "*",
      });
    },
    ExportNamedDeclaration(node) {
      if (!node.source) {
        for (const specifier of node.specifiers || []) {
          const importedLocalName = String(
            specifier.local?.name
            || specifier.local?.value
            || "",
          );
          const importSource = canonicalStateImportLocals.get(
            importedLocalName,
          );
          if (!importSource) {
            continue;
          }
          references.push(
            createModuleReference({
              node: specifier,
              importSource,
              sourceKind: "canonical-relative",
              specifierType: "local-re-export",
              importedName: "state",
              localName: String(
                specifier.exported?.name
                || specifier.exported?.value
                || "",
              ),
            }),
          );
        }
        return;
      }
      if (!(node.specifiers || []).length) {
        recordReference({
          node,
          importSource: node.source.value,
          specifierType: "re-export-named",
        });
      }
      for (const specifier of node.specifiers || []) {
        recordReference({
          node: specifier,
          importSource: node.source.value,
          specifierType: "re-export-named",
          importedName: String(
            specifier.local?.name
            || specifier.local?.value
            || "",
          ),
          localName: String(
            specifier.exported?.name
            || specifier.exported?.value
            || "",
          ),
        });
      }
    },
    ExportAllDeclaration(node) {
      recordReference({
        node,
        importSource: node.source?.value,
        specifierType: "re-export-all",
        importedName: "*",
        localName: String(
          node.exported?.name
          || node.exported?.value
          || "",
        ),
      });
    },
  });
  return {
    references,
    diagnostics,
    stateShapedImports,
  };
}

export function discoverGlobalStateFacadeImports(
  source = "",
  { filePath = "" } = {},
) {
  return analyzeGlobalStateFacadeReferences(source, {
    filePath,
  }).references;
}

export function validateDomainActionSourceBoundary(
  source = "",
  { filePath = "" } = {},
) {
  const normalizedPath = String(filePath || "").replaceAll("\\", "/");
  if (!normalizedPath.startsWith("js/core/state/actions/")) {
    return [];
  }
  const analysis = analyzeGlobalStateFacadeReferences(source, {
    filePath: normalizedPath,
  });
  return [
    ...analysis.references.map((entry) => ({
      code: "domain-action-global-state-import",
      path: normalizedPath,
      ...entry,
    })),
    ...analysis.diagnostics.map((diagnostic) => ({
      path: normalizedPath,
      ...diagnostic,
    })),
    ...analysis.stateShapedImports.map((entry) => ({
      code: "domain-action-state-shaped-import",
      path: normalizedPath,
      ...entry,
    })),
  ];
}

export function discoverGlobalStateImportBindings(
  source = "",
  { filePath = "" } = {},
) {
  const references = discoverGlobalStateFacadeImports(source, { filePath });
  const unsupportedReferences = references.filter(
    (entry) =>
      entry.specifierType !== "named"
      || entry.sourceKind !== "canonical-relative",
  );
  if (unsupportedReferences.length) {
    const error = new Error(
      "Canonical state facade access must use static named imports.",
    );
    error.code = "unsupported-global-state-facade-access";
    error.references = unsupportedReferences;
    throw error;
  }
  return references
    .filter(
      (entry) =>
        entry.importedName === "state"
        && entry.localName,
    )
    .map(({ importSource, importedName, localName }) => ({
      importSource,
      importedName,
      localName,
    }));
}

// 一次快照校验同时对齐 schema、历史 allowlist、当前扫描结果和
// caller-to-action ledger，调用方应把完整 violations 视为同一准入结果。
export function validateStateWriterPolicySnapshot({
  policy = {},
  legacyAllowlistPaths = [],
  scans = [],
  actionDelegations = [],
} = {}) {
  const violations = [];
  const stateKeyAuthorityIndex = buildCanonicalStateKeyAuthorityIndex();
  violations.push(...validateStateWriterPolicySchema(policy));
  const ledgerEntries = Array.isArray(
    policy?.progress?.callerToActionLedger?.entries,
  )
    ? policy.progress.callerToActionLedger.entries
    : [];
  const currentLedgerEntries = ledgerEntries.filter(
    ({ recordedInPhase }) =>
      recordedInPhase === policy?.progress?.latestPhase,
  );
  const ledgerProofEntries = ledgerEntries.flatMap(
    callerToActionLedgerEntryProofs,
  );
  const normalizedActionDelegations = (
    Array.isArray(actionDelegations) ? actionDelegations : []
  ).map((edge) => ({
    callerPath: String(edge?.callerPath || edge?.filePath || ""),
    callerBindingId: String(
      edge?.callerBindingId || edge?.bindingId || "",
    ),
    callerBindingIdentity: String(
      edge?.callerBindingIdentity || "",
    ),
    enclosingFunctionIdentity: String(
      edge?.enclosingFunctionIdentity || "",
    ),
    actionModulePath: String(edge?.actionModulePath || ""),
    actionExportName: String(edge?.actionExportName || ""),
    targetArgumentIndex: Number(edge?.targetArgumentIndex),
    actionCallEdgeIdentity: String(
      edge?.actionCallEdgeIdentity || "",
    ),
    legacyActionCallEdgeIdentity: String(
      edge?.legacyActionCallEdgeIdentity || "",
    ),
    occurrenceIndex: Number(edge?.occurrenceIndex),
    legacyOccurrenceIndex: Number(
      edge?.legacyOccurrenceIndex,
    ),
    start: Number(edge?.start),
    end: Number(edge?.end),
    line: Number(edge?.line),
    column: Number(edge?.column),
    sourceFingerprint: String(edge?.sourceFingerprint || ""),
  }));
  let missingCallerActionProofs = 0;
  for (const entry of ledgerProofEntries) {
    const observed = normalizedActionDelegations.find(
      ({
        actionCallEdgeIdentity,
        legacyActionCallEdgeIdentity,
      }) =>
        actionCallEdgeIdentity === entry.actionCallEdgeIdentity
        || legacyActionCallEdgeIdentity
          === entry.actionCallEdgeIdentity,
    );
    if (!observed) {
      missingCallerActionProofs += 1;
      violations.push(
        createViolation("caller-action-ledger-observation-missing", {
          retiredMembershipIdentity:
            entry.retiredMembershipIdentity,
          actionCallEdgeIdentity: entry.actionCallEdgeIdentity,
        }),
      );
      continue;
    }
    const matchedLegacyIdentity =
      observed.actionCallEdgeIdentity
        !== entry.actionCallEdgeIdentity
      && observed.legacyActionCallEdgeIdentity
        === entry.actionCallEdgeIdentity;
    const observedOccurrenceIndex = matchedLegacyIdentity
      ? observed.legacyOccurrenceIndex
      : observed.occurrenceIndex;
    const expectedSemanticObservation = {
      callerPath: entry.callerPath,
      callerBindingIdentity: entry.callerBindingIdentity,
      actionModulePath: entry.actionModulePath,
      actionExportName: entry.actionExportName,
      targetArgumentIndex: entry.targetArgumentIndex,
      actionCallEdgeIdentity: entry.actionCallEdgeIdentity,
      occurrenceIndex: entry.occurrenceIndex,
      ...(entry.enclosingFunctionIdentity
        ? {
          enclosingFunctionIdentity:
            entry.enclosingFunctionIdentity,
        }
        : {}),
    };
    const actualSemanticObservation = {
      callerPath: observed.callerPath,
      callerBindingIdentity: observed.callerBindingIdentity,
      actionModulePath: observed.actionModulePath,
      actionExportName: observed.actionExportName,
      targetArgumentIndex: observed.targetArgumentIndex,
      actionCallEdgeIdentity: entry.actionCallEdgeIdentity,
      occurrenceIndex: observedOccurrenceIndex,
      ...(entry.enclosingFunctionIdentity
        ? {
          enclosingFunctionIdentity:
            observed.enclosingFunctionIdentity,
        }
        : {}),
    };
    const wasRecordedThisPhase =
      entry.recordedInPhase === policy?.progress?.latestPhase;
    const expectedExactObservation = {
      ...expectedSemanticObservation,
      callerBindingId: entry.callerBindingId,
      line: entry.line,
      column: entry.column,
      sourceFingerprint: entry.sourceFingerprint,
    };
    const actualExactObservation = {
      ...actualSemanticObservation,
      callerBindingId: observed.callerBindingId,
      line: observed.line,
      column: observed.column,
      sourceFingerprint: observed.sourceFingerprint,
    };
    if (
      JSON.stringify(actualSemanticObservation)
        !== JSON.stringify(expectedSemanticObservation)
      || (
        wasRecordedThisPhase
        && JSON.stringify(actualExactObservation)
          !== JSON.stringify(expectedExactObservation)
      )
    ) {
      missingCallerActionProofs += 1;
      violations.push(
        createViolation("caller-action-ledger-observation-mismatch", {
          retiredMembershipIdentity:
            entry.retiredMembershipIdentity,
          expected: wasRecordedThisPhase
            ? expectedExactObservation
            : expectedSemanticObservation,
          actual: wasRecordedThisPhase
            ? actualExactObservation
            : actualSemanticObservation,
        }),
      );
    }
  }

  const expectedProjection = getLegacyDirectAllowlistProjection(policy);
  const actualProjection = stablePathList(legacyAllowlistPaths);
  if (JSON.stringify(expectedProjection) !== JSON.stringify(actualProjection)) {
    violations.push(
      createViolation("legacy-allowlist-projection-mismatch", {
        expected: expectedProjection,
        actual: actualProjection,
      }),
    );
  }

  const findingRecords = [];
  const seenByBinding = new Map();
  const unregisteredAuthoritiesByKey = new Map();

  for (const scan of Array.isArray(scans) ? scans : []) {
    const path = String(scan?.path || "");
    const writer = findPolicyWriter(policy, path);
    if (!writer) {
      violations.push(createViolation("unknown-writer", { path }));
      continue;
    }
    if (writer.surface !== scan.surface) {
      violations.push(
        createViolation("surface-classification-drift", {
          path,
          expected: writer.surface,
          actual: scan.surface,
        }),
      );
    }
    const binding = findPolicyBinding(writer, scan.bindingId);
    if (!binding) {
      violations.push(
        createViolation("unknown-binding", {
          path,
          bindingId: scan.bindingId,
        }),
      );
      continue;
    }
    if (
      (binding.delegationOnly === true)
      !== (scan.delegationOnly === true)
    ) {
      violations.push(
        createViolation("binding-delegation-only-drift", {
          path,
          bindingId: binding.id,
          expected: binding.delegationOnly === true,
          actual: scan.delegationOnly === true,
        }),
      );
    }
    findingRecords.push({
      path,
      surface: writer.surface,
      bindingId: binding.id,
      authority: binding.authority,
      findings: Array.isArray(scan?.findings) ? scan.findings : [],
    });

    const seen = seenByBinding.get(binding) || {
      operations: new Set(),
      keys: new Set(),
      memberships: new Set(),
      aliasSites: new Map(),
      dynamicSites: new Map(),
      ambiguousSites: new Map(),
      unsupportedSites: new Map(),
      exactSiteOccurrences: new Map(),
    };
    seenByBinding.set(binding, seen);
    const grants = flattenBindingGrants(binding);

    for (const finding of Array.isArray(scan?.findings) ? scan.findings : []) {
      if (finding?.unsupported) {
        if (writer.surface === "test") {
          continue;
        }
        const ambiguous = finding.reason === "ambiguous-alias-flow";
        const registeredSites = ambiguous
          ? grants.ambiguousSites
          : grants.unsupportedSites;
        const matchingSite = registeredSites.find((site) =>
          ambiguous
            ? ambiguousSiteMatches(site, finding)
            : unsupportedSiteMatches(site, finding)
        );
        if (!matchingSite) {
          violations.push(
            createViolation(
              ambiguous
                ? "unknown-ambiguous-site"
                : "unknown-unsupported-site",
              {
                path,
                bindingId: binding.id,
                reason: finding.reason,
                line: finding.line,
                column: finding.column,
              },
            ),
          );
        } else if (ambiguous) {
          recordExactSiteOccurrence({
            counts: seen.ambiguousSites,
            observedLocations: seen.exactSiteOccurrences,
            registeredSites,
            matchingSite,
            finding,
            keyForSite: ambiguousSiteKey,
            violations,
            siteKind: "ambiguous",
            path,
            bindingId: binding.id,
          });
        } else {
          recordExactSiteOccurrence({
            counts: seen.unsupportedSites,
            observedLocations: seen.exactSiteOccurrences,
            registeredSites,
            matchingSite,
            finding,
            keyForSite: unsupportedSiteKey,
            violations,
            siteKind: "unsupported",
            path,
            bindingId: binding.id,
          });
        }
        continue;
      }

      if (finding?.dynamic) {
        const matchingDynamicSite = grants.dynamicSites
          .find((site) => dynamicSiteMatches(site, finding));
        if (!matchingDynamicSite) {
          violations.push(
            createViolation("unknown-dynamic-site", {
              path,
              bindingId: binding.id,
              operation: finding.operation,
              key: finding.key,
              line: finding.line,
              column: finding.column,
            }),
          );
        } else {
          recordExactSiteOccurrence({
            counts: seen.dynamicSites,
            observedLocations: seen.exactSiteOccurrences,
            registeredSites: grants.dynamicSites,
            matchingSite: matchingDynamicSite,
            finding,
            keyForSite: dynamicSiteKey,
            violations,
            siteKind: "dynamic",
            path,
            bindingId: binding.id,
          });
        }
      } else if (!grants.keys.includes(finding.key)) {
        violations.push(
          createViolation("unknown-key", {
            path,
            bindingId: binding.id,
            key: finding.key,
          }),
        );
      }

      if (!grants.operations.includes(finding.operation)) {
        violations.push(
          createViolation("unknown-operation", {
            path,
            bindingId: binding.id,
            operation: finding.operation,
          }),
        );
      }

      const matchingMembershipCandidates = grants.memberships.filter(
        (membership) =>
          membership.operation === finding.operation
          && membership.key === finding.key,
      );
      const expectedAuthority = writer.surface === "production"
        ? resolveStateWriterFindingAuthority(
          finding,
          path,
          stateKeyAuthorityIndex,
        )
        : null;
      if (expectedAuthority?.unknown) {
        const fallback = expectedAuthority.fallback;
        if (!unregisteredAuthoritiesByKey.has(finding.key)) {
          unregisteredAuthoritiesByKey.set(finding.key, new Map());
        }
        const authorities = unregisteredAuthoritiesByKey.get(finding.key);
        const authorityKey = [
          fallback.domain,
          fallback.migrationPhase,
        ].join("|");
        if (!authorities.has(authorityKey)) {
          authorities.set(authorityKey, {
            domain: fallback.domain,
            migrationPhase: fallback.migrationPhase,
            paths: new Set(),
          });
        }
        authorities.get(authorityKey).paths.add(path);
        violations.push(
          createViolation("unknown-state-key-authority", {
            path,
            bindingId: binding.id,
            operation: finding.operation,
            key: finding.key,
            suggestedDomain: fallback.domain,
            suggestedMigrationPhase: fallback.migrationPhase,
          }),
        );
      }
      const matchingMembership = expectedAuthority?.unknown
        ? matchingMembershipCandidates[0]
        : expectedAuthority
        ? matchingMembershipCandidates.find(
          (membership) =>
            membership.domain === expectedAuthority.domain
            && membership.migrationPhase === expectedAuthority.migrationPhase,
        )
        : matchingMembershipCandidates[0];
      if (!matchingMembership) {
        violations.push(
          createViolation(
            expectedAuthority
              && !expectedAuthority.unknown
              && matchingMembershipCandidates.length
              ? "grant-authority-mismatch"
              : "unknown-membership",
            {
              path,
              bindingId: binding.id,
              operation: finding.operation,
              key: finding.key,
              expectedDomain: expectedAuthority?.domain || "",
              expectedMigrationPhase: expectedAuthority?.migrationPhase || "",
              actualAuthorities: matchingMembershipCandidates.map(
                ({ domain, migrationPhase }) => ({
                  domain,
                  migrationPhase,
                }),
              ),
            },
          ),
        );
      } else {
        seen.memberships.add(
          [
            matchingMembership.domain,
            matchingMembership.migrationPhase,
            matchingMembership.operation,
            matchingMembership.key,
          ].join("|"),
        );
      }

      if (finding?.alias) {
        const matchingAliasSite = grants.aliasSites
          .find((site) => aliasSiteMatches(site, finding));
        if (!matchingAliasSite) {
          violations.push(
            createViolation("unknown-alias-site", {
              path,
              bindingId: binding.id,
              alias: finding.alias,
              operation: finding.operation,
              key: finding.key,
            }),
          );
        } else {
          recordExactSiteOccurrence({
            counts: seen.aliasSites,
            observedLocations: seen.exactSiteOccurrences,
            registeredSites: grants.aliasSites,
            matchingSite: matchingAliasSite,
            finding,
            keyForSite: aliasSiteKey,
            violations,
            siteKind: "alias",
            path,
            bindingId: binding.id,
          });
        }
      }

      seen.operations.add(finding.operation);
      if (finding.key && finding.key !== "*") {
        seen.keys.add(finding.key);
      }
    }
  }

  const unregisteredConcreteKeyAuthorities = [
    ...unregisteredAuthoritiesByKey.entries(),
  ].map(([key, authorityMap]) => ({
    key,
    authorities: [...authorityMap.values()]
      .map((authority) => ({
        domain: authority.domain,
        migrationPhase: authority.migrationPhase,
        paths: [...authority.paths].sort((left, right) =>
          left.localeCompare(right)
        ),
      }))
      .sort(
        (left, right) =>
          left.domain.localeCompare(right.domain)
          || left.migrationPhase.localeCompare(right.migrationPhase),
      ),
  })).sort((left, right) => left.key.localeCompare(right.key));
  for (const entry of unregisteredConcreteKeyAuthorities) {
    if (entry.authorities.length <= 1) {
      continue;
    }
    violations.push(
      createViolation("unregistered-key-authority-conflict", {
        key: entry.key,
        authorities: entry.authorities,
      }),
    );
  }

  for (const { writer, binding } of getPolicyBindings(policy)) {
    if (binding.authority === "compatibility-only") {
      continue;
    }
    const seen = seenByBinding.get(binding);
    if (!seen) {
      violations.push(
        createViolation("stale-binding", {
          path: writer.path,
          bindingId: binding.id,
        }),
      );
      continue;
    }
    const grants = flattenBindingGrants(binding);
    for (const membership of grants.memberships) {
      const membershipKey = [
        membership.domain,
        membership.migrationPhase,
        membership.operation,
        membership.key,
      ].join("|");
      if (!seen.memberships.has(membershipKey)) {
        violations.push(
          createViolation("stale-membership", {
            path: writer.path,
            bindingId: binding.id,
            ...membership,
          }),
        );
      }
    }
    for (const operation of grants.operations) {
      if (!seen.operations.has(operation)) {
        violations.push(
          createViolation("stale-operation", {
            path: writer.path,
            bindingId: binding.id,
            operation,
          }),
        );
      }
    }
    for (const key of grants.keys) {
      if (!seen.keys.has(key)) {
        violations.push(
          createViolation("stale-key", {
            path: writer.path,
            bindingId: binding.id,
            key,
          }),
        );
      }
    }
    for (const site of grants.aliasSites) {
      const siteKey = aliasSiteKey(site);
      if (!consumeOccurrence(seen.aliasSites, siteKey)) {
        violations.push(
          createViolation("stale-alias-site", {
            path: writer.path,
            bindingId: binding.id,
            alias: site.alias,
            operation: site.operation,
            key: site.key,
            line: site.line,
            column: site.column,
          }),
        );
      }
    }
    for (const site of grants.dynamicSites) {
      const siteKey = dynamicSiteKey(site);
      if (!consumeOccurrence(seen.dynamicSites, siteKey)) {
        violations.push(
          createViolation("stale-dynamic-site", {
            path: writer.path,
            bindingId: binding.id,
            line: site.line,
            column: site.column,
            operation: site.operation,
            key: site.key,
          }),
        );
      }
    }
    if (writer.surface === "production") {
      for (const site of grants.ambiguousSites) {
        const siteKey = ambiguousSiteKey(site);
        if (!consumeOccurrence(seen.ambiguousSites, siteKey)) {
          violations.push(
            createViolation("stale-ambiguous-site", {
              path: writer.path,
              bindingId: binding.id,
              line: site.line,
              column: site.column,
              reason: site.reason,
            }),
          );
        }
      }
      for (const site of grants.unsupportedSites) {
        const siteKey = unsupportedSiteKey(site);
        if (!consumeOccurrence(seen.unsupportedSites, siteKey)) {
          violations.push(
            createViolation("stale-unsupported-site", {
              path: writer.path,
              bindingId: binding.id,
              line: site.line,
              column: site.column,
              reason: site.reason,
              operation: site.operation,
              key: site.key,
            }),
          );
        }
      }
    }
  }

  const productionLegacyDirectPaths = new Set(
    (policy.writers || [])
      .filter(
        (writer) =>
          writer.authority === "legacy-direct"
          && writer.surface === "production",
      )
      .map((writer) => writer.path),
  );
  const testLegacyDirectPaths = new Set(
    (policy.writers || [])
      .filter(
        (writer) =>
          writer.authority === "legacy-direct"
          && writer.surface === "test",
      )
      .map((writer) => writer.path),
  );
  const bindingScoped = summarizeStateWriterFindingRecords(findingRecords);

  return {
    verdict: violations.length ? "fail" : "pass",
    violations,
    metrics: {
      legacyDirectFiles: {
        production: productionLegacyDirectPaths.size,
        test: testLegacyDirectPaths.size,
        total:
          productionLegacyDirectPaths.size
          + testLegacyDirectPaths.size,
      },
      legacyMemberships: {
        production: bindingScoped.memberships.production.legacyCombined,
        test: bindingScoped.memberships.test.legacyCombined,
        total: bindingScoped.memberships.total.legacyCombined,
      },
      allMemberships: {
        production: bindingScoped.memberships.production.all,
        test: bindingScoped.memberships.test.all,
        total: bindingScoped.memberships.total.all,
      },
      callerToActionLedger: {
        totalEntries: ledgerEntries.length,
        totalProofs: ledgerProofEntries.length,
        backfilledEntries: ledgerEntries.filter(
          ({ backfilled }) => backfilled === true,
        ).length,
        recordedThisPhase: currentLedgerEntries.length,
        observedEdges: normalizedActionDelegations.length,
        missingProofs: missingCallerActionProofs,
      },
      bindingScoped,
      unregisteredConcreteKeyAuthorities,
    },
  };
}

// 报告并列呈现“目录登记”与真实 runtime facade；两侧差集用于发现
// 新状态漏登记或已移除状态仍残留在权威目录中的漂移。
export async function buildDefaultStateOwnershipReport({
  additionalFactoryGroups = [],
  additionalExplicitKeys = [],
  additionalLazyStateKeyDomains = {},
  additionalCompatibilityHooks = [],
} = {}) {
  const catalog = buildCanonicalStateKeyAuthorityCatalog({
    additionalFactoryGroups,
    additionalExplicitKeys,
    additionalLazyStateKeyDomains,
    additionalCompatibilityHooks,
  });
  const reportedFactoryGroups = catalog.factoryGroups.map((group) => {
    const keys = Object.keys(group.value).sort();
    return {
      id: group.id,
      source: group.source,
      keys,
    };
  });
  const registeredFacadeKeys = catalog.registeredFacadeKeys;
  const actualFacadeKeys = Object.keys(runtimeStateFacade).sort();
  const registeredFacadeKeySet = new Set(registeredFacadeKeys);
  const actualFacadeKeySet = new Set(actualFacadeKeys);

  return {
    factoryGroups: reportedFactoryGroups,
    explicitKeys: catalog.explicitKeys.map(({ key }) => key),
    authorityOnlyLazyKeys: catalog.lazyKeys.map(({ key }) => key).sort(),
    compatibilityHooks: catalog.compatibilityHooks,
    compatibilityHookCount: catalog.compatibilityHooks.length,
    preCompatKeyCount: catalog.preCompatKeys.length,
    postCompatKeyCount: catalog.registeredFacadeKeys.length,
    registeredFacadeKeys,
    actualFacadeKeys,
    actualFacadeKeyCount: actualFacadeKeys.length,
    unownedActualFacadeKeys: actualFacadeKeys.filter(
      (key) => !registeredFacadeKeySet.has(key),
    ),
    registeredKeysMissingFromFacade: registeredFacadeKeys.filter(
      (key) => !actualFacadeKeySet.has(key),
    ),
    collisions: catalog.collisions,
  };
}
