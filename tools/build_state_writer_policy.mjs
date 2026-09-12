import { parse as parseJavaScript } from "acorn";
import * as astWalk from "acorn-walk";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  STATE_BORROWED_EFFECT_CONTRACT,
  STATE_BORROWED_CALLBACK_INJECTION_CONTRACT,
  STATE_BORROWED_RUNTIME_CONTRACT,
  STATE_BORROWED_OWNER_EFFECT_CONTRACT,
  inspectStateBorrowedOwnerEffectSources,
  STATE_BORROWED_SCOPED_OPERATION_CONTRACT,
  inspectStateBorrowedScopedOperationSources,
  inspectStateBorrowedRuntimeSources,
  inspectStateBorrowedCallbackInjectionSources,
  inspectStateBorrowedEffectSource,
} from "./state_borrowed_effect_contract.mjs";

import {
  DERIVED_ALIAS_TAINT_MODES,
  discoverFunctionParameterBindings,
  normalizeJavaScriptSource,
  normalizeDerivedAliasTaintMode,
  scanStateMutationInventory,
  scanStateMutations,
  STATE_WRITER_PARAMETER_NAMES,
} from "./state_writer_inventory.mjs";
import {
  expandStateActionMembershipsWithLegacyReplacements,
  findStateActionCrossFileMigrationContractEntry,
  findStateActionSuccessorProofContractEntry,
  STATE_IMPORTED_BORROWED_PROJECTION_CONTRACT,
  inspectStateImportedBorrowedProjectionSource,
  getStateTargetPureReaderContractEntriesForModule,
  getStateActionDelegationContractEntriesForModule,
  inspectStateDetachedCaptureSource,
  inspectStateTargetPureReaderFunctionSource,
  STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT,
  STATE_ACTION_DELEGATION_CONTRACT,
  STATE_TARGET_EFFECTFUL_DELEGATOR_CONTRACT,
  STATE_ACTION_BORROWED_MAP_STORAGE_CONTRACT,
  STATE_DETACHED_CAPTURE_CONTRACT,
  STATE_TARGET_PURE_READER_CONTRACT,
  validateStateActionCrossFileMigrationContract,
  validateStateActionDelegationContract,
  validateStateActionLegacyMembershipReplacementContract,
  validateStateActionModulePhaseAdmissions,
  validateStateActionModuleSource,
  validateStateActionPolicyBindings,
  validateStateActionSuccessorProofContract,
  validateStateTargetPureReaderContract,
} from "./state_action_delegation_contract.mjs";
import {
  buildCanonicalStateKeyAuthorityIndex,
  buildDefaultStateOwnershipReport,
  discoverGlobalStateImportBindings,
  resolveStateWriterFindingAuthority,
  summarizeStateWriterFindingRecords,
  validateDomainActionSourceBoundary,
  validateStateWriterPolicySchema,
  validateTestDiagnosticBudget,
} from "./state_writer_policy.mjs";
import {
  compareP4StateActionPhases,
  normalizeP4StateActionPhase,
  P4_STATE_ACTION_PHASES,
} from "./p4_state_action_phases.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STATE_WRITER_POLICY_PATH = path.join(
  PROJECT_ROOT,
  "tools",
  "state_writer_policy.json",
);

export async function writeStateWriterPolicyAtomically(
  targetPath,
  serialized,
  {
    fsImpl = fs,
    tempSuffix = `${process.pid}-${randomUUID()}`,
  } = {},
) {
  const resolvedTargetPath = path.resolve(String(targetPath || ""));
  const normalizedSerialized = String(serialized || "");
  JSON.parse(normalizedSerialized);
  const tempPath = path.join(
    path.dirname(resolvedTargetPath),
    `.${path.basename(resolvedTargetPath)}.${String(tempSuffix)}.tmp`,
  );
  let handle = null;
  try {
    handle = await fsImpl.open(tempPath, "wx");
    await handle.writeFile(normalizedSerialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    JSON.parse(await fsImpl.readFile(tempPath, "utf8"));
    await fsImpl.rename(tempPath, resolvedTargetPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fsImpl.unlink(tempPath).catch((unlinkError) => {
      if (unlinkError?.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}
const LEGACY_ALLOWLIST_PATH = path.join(
  PROJECT_ROOT,
  "tools",
  "eslint-rules",
  "state-writer-allowlist.json",
);
const PRODUCTION_JS_ROOT = path.join(PROJECT_ROOT, "js");

const EXCLUDED_PARAMETER_BINDINGS = new Set([
  "js/core/history_manager.js#applyEntries#target",
  "js/core/intensity_field.js#bakeCompositeCell#target",
  "js/core/map_renderer.js#mergeHistorySnapshot#target",
  "js/core/map_renderer.js#recordScenarioPoliticalBackgroundDeferredFullCacheReadyRepaintDeferred#state",
  "js/core/renderer/spatial_index_runtime_builders.js#appendLandIndexEntriesRange#state",
  "js/core/scenario_resources.js#scheduleScenarioDeferredBundleMetadataLoad#bundle",
  "js/core/state/color_state.js#replaceObjectContents#target",
  "js/ui/toolbar/special_zones_workbench_controller.js#renderActions#state",
  "js/ui/toolbar/special_zones_workbench_controller.js#renderLayerList#state",
]);

const SPECIAL_BINDINGS_BY_PATH = Object.freeze({
  "js/core/scenario/chunk_runtime.js": Object.freeze([
    Object.freeze({
      id: "local-alias:createScenarioChunkRuntimeController:runtimeState",
      kind: "function-local-alias",
      name: "runtimeState",
      functionName: "createScenarioChunkRuntimeController",
      aliasSources: Object.freeze(["explicitRuntimeState", "state"]),
      aliasOperators: Object.freeze(["||"]),
    }),
  ]),
  "js/core/scenario/lifecycle_runtime.js": Object.freeze([
    Object.freeze({
      id: "local-alias:createScenarioLifecycleRuntime:runtimeState",
      kind: "function-local-alias",
      name: "runtimeState",
      functionName: "createScenarioLifecycleRuntime",
      aliasSources: Object.freeze(["explicitRuntimeState", "state"]),
      aliasOperators: Object.freeze(["||"]),
    }),
  ]),
  "js/core/map_renderer/scenario_refresh_runtime.js": Object.freeze([
    Object.freeze({
      id: "function-local:createScenarioRefreshRuntime:runtimeState",
      kind: "function-local",
      name: "runtimeState",
      functionName: "createScenarioRefreshRuntime",
    }),
  ]),
});

const COMPATIBILITY_ONLY_PATHS = new Map([
  [
    "js/ui/toolbar/transport_workbench_right_deck_owner.js",
    "raw-root-name-false-positive",
  ],
]);

function normalizeRelativePath(filePath) {
  return String(filePath || "").replaceAll("\\", "/");
}

function stableUnique(values = []) {
  return [...new Set(values.map(String))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function resolveGitCommitSha(
  revision = "HEAD",
  {
    cwd = PROJECT_ROOT,
    runGit = (args) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
  } = {},
) {
  const candidate = String(revision || "HEAD").trim() || "HEAD";
  try {
    const resolved = String(
      runGit(["rev-parse", "--verify", `${candidate}^{commit}`]) || "",
    ).trim();
    if (!/^[0-9a-f]{40}$/i.test(resolved)) {
      throw new Error(`Git returned a non-commit identity: ${resolved}`);
    }
    return resolved.toLowerCase();
  } catch (error) {
    const wrapped = new Error(
      `Unable to resolve ${candidate} to an exact Git commit.`,
      { cause: error },
    );
    wrapped.code = "source-base-sha-invalid";
    wrapped.revision = candidate;
    throw wrapped;
  }
}

export const P4_CLOSEOUT_DIRECT_FILES_TARGET = 54;
export const P4_CLOSEOUT_MEMBERSHIP_RATIO = 0.8;

export function buildP4CloseoutTargets(baselines = {}) {
  const denominator =
    baselines?.bindingScopedMemberships?.production?.legacyCombined;
  if (
    typeof denominator !== "number"
    || !Number.isInteger(denominator)
    || denominator < 0
  ) {
    const error = new Error(
      "P4 closeout target requires a finite non-negative integer membership denominator.",
    );
    error.code = "closeout-target-denominator-invalid";
    throw error;
  }
  const ratio = P4_CLOSEOUT_MEMBERSHIP_RATIO;
  return {
    productionLegacyDirectFiles: P4_CLOSEOUT_DIRECT_FILES_TARGET,
    productionLegacyMemberships: Math.floor(denominator * ratio),
    productionLegacyMembershipRatio: ratio,
    productionLegacyMembershipDenominator: denominator,
    source:
      "baselines.bindingScopedMemberships.production.legacyCombined",
  };
}

const LEGACY_BINDING_AUTHORITIES = new Set([
  "legacy-direct",
  "legacy-target",
]);

export function buildStableStateBindingIdentity(binding = {}) {
  const isFunctionParameter = binding.kind === "function-parameter";
  return JSON.stringify({
    kind: String(binding.kind || ""),
    name: isFunctionParameter ? "" : String(binding.name || ""),
    functionName: String(binding.functionName || ""),
    parameterName: isFunctionParameter ? "" : String(binding.parameterName || ""),
    parameterIndex: Number(binding.parameterIndex || 0),
    parameterPath: isFunctionParameter
      ? String(binding.parameterPath || "$")
      : "",
    importSource: String(binding.importSource || ""),
    importedName: String(binding.importedName || ""),
    aliasSources: (binding.aliasSources || []).map(String),
    aliasOperators: (binding.aliasOperators || []).map(String),
  });
}

const stableLegacyBindingIdentity = buildStableStateBindingIdentity;

export function buildStateActionCallEdgeIdentity({
  callerPath = "",
  callerBindingIdentity = "",
  enclosingFunctionIdentity = "",
  actionModulePath = "",
  actionExportName = "",
  targetArgumentIndex = 0,
  occurrenceIndex = 0,
} = {}) {
  return createHash("sha256")
    .update(JSON.stringify({
      callerPath: normalizeRelativePath(callerPath),
      callerBindingIdentity: String(callerBindingIdentity || ""),
      enclosingFunctionIdentity: String(
        enclosingFunctionIdentity || "",
      ),
      actionModulePath: normalizeRelativePath(actionModulePath),
      actionExportName: String(actionExportName || ""),
      targetArgumentIndex: Number(targetArgumentIndex),
      occurrenceIndex: Number(occurrenceIndex),
    }))
    .digest("hex");
}

function buildLegacyStateActionCallEdgeIdentity({
  callerPath = "",
  callerBindingIdentity = "",
  actionModulePath = "",
  actionExportName = "",
  targetArgumentIndex = 0,
  occurrenceIndex = 0,
} = {}) {
  return createHash("sha256")
    .update(JSON.stringify({
      callerPath: normalizeRelativePath(callerPath),
      callerBindingIdentity: String(callerBindingIdentity || ""),
      actionModulePath: normalizeRelativePath(actionModulePath),
      actionExportName: String(actionExportName || ""),
      targetArgumentIndex: Number(targetArgumentIndex),
      occurrenceIndex: Number(occurrenceIndex),
    }))
    .digest("hex");
}

export function parseLegacyMembershipSemanticSignature(signature = "") {
  const source = String(signature || "");
  const firstSeparator = source.indexOf("|");
  if (firstSeparator <= 0 || source[firstSeparator + 1] !== "{") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  let bindingEnd = -1;
  for (let index = firstSeparator + 1; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        bindingEnd = index + 1;
        break;
      }
    }
  }
  if (
    bindingEnd <= firstSeparator + 1
    || source[bindingEnd] !== "|"
  ) {
    return null;
  }
  let binding;
  try {
    binding = JSON.parse(source.slice(firstSeparator + 1, bindingEnd));
  } catch {
    return null;
  }
  const tail = source.slice(bindingEnd + 1).split("|");
  if (tail.length !== 4 || tail.some((entry) => !entry)) {
    return null;
  }
  const [
    domain,
    migrationPhase,
    operation,
    key,
  ] = tail;
  return {
    signature: source,
    callerPath: normalizeRelativePath(source.slice(0, firstSeparator)),
    callerBindingIdentity: JSON.stringify(binding),
    callerBinding: binding,
    domain,
    migrationPhase,
    operation,
    key,
    replacementKey: [
      domain,
      migrationPhase,
      operation,
      key,
    ].join("|"),
  };
}

function stableSiteFingerprint(site = {}) {
  return String(site.sourceFingerprint || "").trim()
    || [
      Number(site.line || 0),
      Number(site.column || 0),
    ].join(":");
}

// 把 production writer 的既有授权投影成排序后的语义多重集，供后续阶段
// 做“只能收窄”的差分；测试面与重复 binding 不进入冻结基线。
export function buildLegacyStateWriterSemanticAuthority(
  writers = [],
) {
  const sections = {
    bindings: [],
    memberships: [],
    aliasSites: [],
    dynamicSites: [],
    ambiguousSites: [],
    unsupportedSites: [],
  };
  const bindingIdentities = new Set();
  const collisions = [];
  for (const writer of Array.isArray(writers) ? writers : []) {
    if (writer?.surface !== "production") {
      continue;
    }
    for (const binding of Array.isArray(writer?.bindings)
      ? writer.bindings
      : []) {
      if (!LEGACY_BINDING_AUTHORITIES.has(binding?.authority)) {
        continue;
      }
      const bindingIdentity = stableLegacyBindingIdentity(binding);
      const scopedBindingIdentity = `${writer.path}|${bindingIdentity}`;
      if (bindingIdentities.has(scopedBindingIdentity)) {
        collisions.push(scopedBindingIdentity);
        continue;
      }
      bindingIdentities.add(scopedBindingIdentity);
      sections.bindings.push(
        [
          scopedBindingIdentity,
          binding.authority,
        ].join("|"),
      );
      for (const grant of Array.isArray(binding?.grants)
        ? binding.grants
        : []) {
        const grantScope = [
          scopedBindingIdentity,
          String(grant.domain || ""),
          String(grant.migrationPhase || ""),
        ].join("|");
        for (const membership of Array.isArray(grant?.memberships)
          ? grant.memberships
          : []) {
          sections.memberships.push(
            [
              grantScope,
              String(membership.operation || ""),
              String(membership.key || ""),
            ].join("|"),
          );
        }
        for (const site of Array.isArray(grant?.aliasSites)
          ? grant.aliasSites
          : []) {
          sections.aliasSites.push(
            [
              grantScope,
              String(site.alias || ""),
              JSON.stringify((site.aliasChain || []).map(String)),
              String(site.operation || ""),
              String(site.key || ""),
              stableSiteFingerprint(site),
            ].join("|"),
          );
        }
        for (const site of Array.isArray(grant?.dynamicSites)
          ? grant.dynamicSites
          : []) {
          sections.dynamicSites.push(
            [
              grantScope,
              String(site.operation || ""),
              String(site.key || ""),
              String(site.pathPattern || ""),
              stableSiteFingerprint(site),
            ].join("|"),
          );
        }
        for (const site of Array.isArray(grant?.ambiguousSites)
          ? grant.ambiguousSites
          : []) {
          sections.ambiguousSites.push(
            [
              grantScope,
              String(site.reason || ""),
              stableSiteFingerprint(site),
            ].join("|"),
          );
        }
        for (const site of Array.isArray(grant?.unsupportedSites)
          ? grant.unsupportedSites
          : []) {
          sections.unsupportedSites.push(
            [
              grantScope,
              String(site.reason || ""),
              String(site.operation || ""),
              String(site.key || ""),
              stableSiteFingerprint(site),
            ].join("|"),
          );
        }
      }
    }
  }
  return {
    bindings: sections.bindings.sort(),
    memberships: sections.memberships.sort(),
    aliasSites: sections.aliasSites.sort(),
    dynamicSites: sections.dynamicSites.sort(),
    ambiguousSites: sections.ambiguousSites.sort(),
    unsupportedSites: sections.unsupportedSites.sort(),
    collisions: stableUnique(collisions),
  };
}

function signatureCounts(signatures = []) {
  const counts = new Map();
  for (const signature of Array.isArray(signatures) ? signatures : []) {
    const normalized = String(signature);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return counts;
}

export function validateLegacyStateWriterSemanticAuthority({
  baseline = null,
  writers = [],
  scope = "frozen-baseline",
} = {}) {
  const current = buildLegacyStateWriterSemanticAuthority(writers);
  const violations = [];
  if (!baseline || typeof baseline !== "object") {
    return {
      verdict: "fail",
      current,
      violations: [{
        code: "legacy-semantic-authority-baseline-missing",
      }],
    };
  }
  for (const collision of current.collisions) {
    violations.push({
      code: "legacy-semantic-binding-identity-collision",
      binding: collision,
    });
  }
  for (const section of [
    "bindings",
    "memberships",
    "aliasSites",
    "dynamicSites",
    "ambiguousSites",
    "unsupportedSites",
  ]) {
    const allowed = signatureCounts(
      Array.isArray(baseline?.[section]) ? baseline[section] : [],
    );
    const observed = signatureCounts(current[section]);
    for (const [signature, count] of observed) {
      const allowedCount = allowed.get(signature) || 0;
      if (count > allowedCount) {
        violations.push({
          code: "legacy-semantic-authority-added",
          scope,
          section,
          signature,
          allowedCount,
          actualCount: count,
        });
      }
    }
  }
  return {
    verdict: violations.length ? "fail" : "pass",
    current,
    violations,
  };
}

const LEGACY_SEMANTIC_SECTIONS = Object.freeze([
  "bindings",
  "memberships",
  "aliasSites",
  "dynamicSites",
  "ambiguousSites",
  "unsupportedSites",
]);

const DERIVED_ALIAS_TAINT_DIAGNOSTIC_SECTIONS = Object.freeze([
  "ambiguousSites",
  "unsupportedSites",
]);

const LEGACY_SEMANTIC_CUMULATIVE_AUTHORITY_SECTIONS = Object.freeze([
  "bindings",
  "memberships",
  "aliasSites",
  "dynamicSites",
]);

const DERIVED_ALIAS_TAINT_TRANSITION_SEMANTIC_SECTIONS =
  LEGACY_SEMANTIC_SECTIONS;
const ALLOW_UNKNOWN_UNSUPPORTED_AUTHORITY = true;
const STATE_WRITER_PARAMETER_NAME_SET = new Set(
  STATE_WRITER_PARAMETER_NAMES,
);

export const DERIVED_ALIAS_TAINT_BASELINE_ALGORITHM_VERSION = 1;

function subtractSignatureMultiset(observed = [], allowed = []) {
  const remaining = signatureCounts(allowed);
  const delta = [];
  for (const signature of Array.isArray(observed) ? observed : []) {
    const normalized = String(signature);
    const allowedCount = remaining.get(normalized) || 0;
    if (allowedCount > 0) {
      remaining.set(normalized, allowedCount - 1);
    } else {
      delta.push(normalized);
    }
  }
  return delta.sort();
}

export function buildDerivedAliasTaintDiagnosticDelta({
  legacySemanticBaseline = {},
  strictSemanticAuthority = {},
} = {}) {
  return Object.fromEntries(
    DERIVED_ALIAS_TAINT_DIAGNOSTIC_SECTIONS.map((section) => [
      section,
      subtractSignatureMultiset(
        strictSemanticAuthority?.[section],
        legacySemanticBaseline?.[section],
      ),
    ]),
  );
}

export function buildUnbaselinedLegacyDiagnosticCounts({
  legacySemanticAuthority = {},
  derivedAliasTaint = null,
} = {}) {
  return {
    ambiguousSites: subtractSignatureMultiset(
      legacySemanticAuthority?.ambiguousSites,
      derivedAliasTaint?.diagnosticDelta?.ambiguousSites,
    ).length,
    unsupportedSites: subtractSignatureMultiset(
      legacySemanticAuthority?.unsupportedSites,
      derivedAliasTaint?.diagnosticDelta?.unsupportedSites,
    ).length,
  };
}

export function buildIncrementalDerivedAliasTaintBaseline({
  currentBaseline = null,
  previousBaseline = null,
} = {}) {
  if (!currentBaseline) {
    return null;
  }
  return {
    algorithmVersion: currentBaseline.algorithmVersion,
    sourceBaseSha: currentBaseline.sourceBaseSha,
    paths: subtractSignatureMultiset(
      currentBaseline.paths,
      previousBaseline?.paths,
    ),
    diagnosticDelta: Object.fromEntries(
      DERIVED_ALIAS_TAINT_DIAGNOSTIC_SECTIONS.map((section) => [
        section,
        subtractSignatureMultiset(
          currentBaseline?.diagnosticDelta?.[section],
          previousBaseline?.diagnosticDelta?.[section],
        ),
      ]),
    ),
    ...(currentBaseline.transitionSemanticDelta
      ? {
        transitionSemanticDelta: Object.fromEntries(
          DERIVED_ALIAS_TAINT_TRANSITION_SEMANTIC_SECTIONS.map(
            (section) => [
              section,
              subtractSignatureMultiset(
                currentBaseline.transitionSemanticDelta[section],
                previousBaseline?.transitionSemanticDelta?.[section],
              ),
            ],
          ),
        ),
      }
      : {}),
  };
}

export function composeLegacySemanticBaseline({
  legacyBaseline = {},
  derivedAliasTaint = null,
} = {}) {
  const composed = Object.fromEntries(
    LEGACY_SEMANTIC_SECTIONS.map((section) => [
      section,
      [...(Array.isArray(legacyBaseline?.[section])
        ? legacyBaseline[section]
        : [])].map(String).sort(),
    ]),
  );
  for (const section of DERIVED_ALIAS_TAINT_DIAGNOSTIC_SECTIONS) {
    composed[section] = [
      ...composed[section],
      ...(Array.isArray(
        derivedAliasTaint?.diagnosticDelta?.[section],
      )
        ? derivedAliasTaint.diagnosticDelta[section]
        : []),
    ].map(String).sort();
  }
  for (const section of LEGACY_SEMANTIC_CUMULATIVE_AUTHORITY_SECTIONS) {
    composed[section] = [
      ...composed[section],
      ...(Array.isArray(
        derivedAliasTaint?.transitionSemanticDelta?.[section],
      )
        ? derivedAliasTaint.transitionSemanticDelta[section]
        : []),
    ].map(String).sort();
  }
  return {
    ...composed,
    collisions: [...(Array.isArray(legacyBaseline?.collisions)
      ? legacyBaseline.collisions
      : [])].map(String).sort(),
  };
}

function validateDerivedAliasTaintBaseline(
  baseline,
  { sourceBaseSha = "" } = {},
) {
  const violations = [];
  if (!baseline || typeof baseline !== "object") {
    return [{ code: "derived-alias-taint-baseline-missing" }];
  }
  if (
    Number(baseline.algorithmVersion)
    !== DERIVED_ALIAS_TAINT_BASELINE_ALGORITHM_VERSION
  ) {
    violations.push({
      code: "derived-alias-taint-baseline-algorithm-invalid",
    });
  }
  if (
    !/^[0-9a-f]{40}$/i.test(String(baseline.sourceBaseSha || ""))
    || (
      sourceBaseSha
      && String(baseline.sourceBaseSha)
        !== String(sourceBaseSha)
    )
  ) {
    violations.push({
      code: "derived-alias-taint-baseline-source-invalid",
    });
  }
  const paths = normalizeCandidatePathList(baseline.paths);
  if (
    JSON.stringify(paths)
    !== JSON.stringify(baseline.paths || [])
  ) {
    violations.push({
      code: "derived-alias-taint-baseline-paths-invalid",
    });
  }
  const transitionCheckpoints = baseline.transitionCheckpoints;
  if (transitionCheckpoints !== undefined) {
    const recordedTransitionPaths = new Set();
    if (!Array.isArray(transitionCheckpoints)) {
      violations.push({
        code: "derived-alias-taint-transition-checkpoints-invalid",
      });
    } else {
      for (const checkpoint of transitionCheckpoints) {
        const checkpointPaths = normalizeCandidatePathList(
          checkpoint?.paths,
        );
        if (
          !checkpoint
          || typeof checkpoint !== "object"
          || Array.isArray(checkpoint)
          || !/^[0-9a-f]{40}$/i.test(
            String(checkpoint.sourceSha || ""),
          )
          || !/^[0-9a-f]{64}$/i.test(
            String(checkpoint.policyBlobSha256 || ""),
          )
          || JSON.stringify(checkpointPaths)
            !== JSON.stringify(checkpoint.paths || [])
          || !checkpointPaths.length
        ) {
          violations.push({
            code: "derived-alias-taint-transition-checkpoint-invalid",
          });
          continue;
        }
        for (const relativePath of checkpointPaths) {
          if (
            !paths.includes(relativePath)
            || recordedTransitionPaths.has(relativePath)
          ) {
            violations.push({
              code: "derived-alias-taint-transition-path-invalid",
              path: relativePath,
            });
          }
          recordedTransitionPaths.add(relativePath);
        }
      }
    }
  }
  for (const section of DERIVED_ALIAS_TAINT_DIAGNOSTIC_SECTIONS) {
    const signatures = Array.isArray(
      baseline?.diagnosticDelta?.[section],
    )
      ? baseline.diagnosticDelta[section].map(String)
      : null;
    if (
      !signatures
      || JSON.stringify(signatures)
        !== JSON.stringify([...signatures].sort())
    ) {
      violations.push({
        code: "derived-alias-taint-baseline-delta-invalid",
        section,
      });
    }
  }
  if (baseline.transitionSemanticDelta !== undefined) {
    const transitionSemanticDelta = baseline.transitionSemanticDelta;
    if (
      !transitionSemanticDelta
      || typeof transitionSemanticDelta !== "object"
      || Array.isArray(transitionSemanticDelta)
      || JSON.stringify(Object.keys(transitionSemanticDelta))
        !== JSON.stringify(
          DERIVED_ALIAS_TAINT_TRANSITION_SEMANTIC_SECTIONS,
        )
    ) {
      violations.push({
        code: "derived-alias-taint-transition-semantic-shape-invalid",
      });
    } else {
      for (
        const section of
        DERIVED_ALIAS_TAINT_TRANSITION_SEMANTIC_SECTIONS
      ) {
        const signatures = transitionSemanticDelta[section];
        if (
          !Array.isArray(signatures)
          || signatures.some(
            (signature) => typeof signature !== "string" || !signature,
          )
          || JSON.stringify(signatures)
            !== JSON.stringify([...signatures].sort())
        ) {
          violations.push({
            code: "derived-alias-taint-transition-semantic-invalid",
            section,
          });
        }
      }
    }
  }
  return violations;
}

// 冻结 revision 中本来不存在的文件返回 null；已确认存在却读取失败时
// 抛出带路径和基准 SHA 的错误，避免把仓库故障解释为新增文件。
function defaultReadSourceAtRevision(sourceBaseSha, relativePath) {
  const revisionPath = `${sourceBaseSha}:${relativePath}`;
  try {
    execFileSync(
      "git",
      ["cat-file", "-e", revisionPath],
      {
        cwd: PROJECT_ROOT,
        stdio: "ignore",
      },
    );
  } catch {
    return null;
  }
  try {
    return execFileSync(
      "git",
      ["show", revisionPath],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (cause) {
    const error = new Error(
      `Unable to read frozen source: ${relativePath}`,
      { cause },
    );
    error.code = "derived-alias-taint-frozen-source-read-failed";
    error.sourceBaseSha = sourceBaseSha;
    error.path = relativePath;
    throw error;
  }
}

function buildFrozenBaselineWritersByPath(
  legacySemanticBaseline = {},
) {
  const bindingsByPath = new Map();
  for (
    const signature of
      Array.isArray(legacySemanticBaseline?.bindings)
        ? legacySemanticBaseline.bindings
        : []
  ) {
    const normalized = String(signature);
    const identityStart = normalized.indexOf("|{");
    const identityEnd = normalized.lastIndexOf("}|");
    if (identityStart < 0 || identityEnd <= identityStart) {
      continue;
    }
    const relativePath = normalizeRelativePath(
      normalized.slice(0, identityStart),
    );
    try {
      const binding = JSON.parse(
        normalized.slice(identityStart + 1, identityEnd + 1),
      );
      if (!bindingsByPath.has(relativePath)) {
        bindingsByPath.set(relativePath, []);
      }
      bindingsByPath.get(relativePath).push(binding);
    } catch {
      continue;
    }
  }
  return new Map(
    [...bindingsByPath.entries()].map(
      ([relativePath, bindings]) => [
        relativePath,
        { path: relativePath, bindings },
      ],
    ),
  );
}

function isTransitionSemanticBinding(binding, previousWriter = null) {
  const previousBindings = Array.isArray(previousWriter?.bindings)
    ? previousWriter.bindings
    : [];
  if (previousBindings.length) {
    const previousBindingIdentities = new Set(
      previousBindings.map(buildStableStateBindingIdentity),
    );
    return previousBindingIdentities.has(
      buildStableStateBindingIdentity(binding),
    );
  }
  if (binding?.kind === "function-parameter") {
    return STATE_WRITER_PARAMETER_NAME_SET.has(
      String(binding?.parameterName || binding?.name || ""),
    );
  }
  return true;
}

function normalizeHistoricalDerivedAliasProofJson(value, label) {
  let serialized;
  let roundTripped;
  try {
    serialized = JSON.stringify(value);
    roundTripped = JSON.parse(serialized);
  } catch (cause) {
    const error = new TypeError(
      `Historical derived-alias proof ${label} must be JSON-safe.`,
      { cause },
    );
    error.code = "historical-derived-alias-proof-identity-invalid";
    throw error;
  }
  if (!isDeepStrictEqual(roundTripped, value)) {
    const error = new TypeError(
      `Historical derived-alias proof ${label} must round-trip exactly.`,
    );
    error.code = "historical-derived-alias-proof-identity-invalid";
    throw error;
  }
  return { serialized, value: roundTripped };
}

function hashHistoricalDerivedAliasProofPolicy(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new TypeError(
      `Historical derived-alias proof ${label} must be a policy object.`,
    );
    error.code = "historical-derived-alias-proof-identity-invalid";
    throw error;
  }
  const normalized = normalizeHistoricalDerivedAliasProofJson(
    value,
    label,
  );
  return createHash("sha256")
    .update(normalized.serialized)
    .digest("hex");
}

export function buildHistoricalDerivedAliasProofIdentity({
  sourceSha = "",
  candidatePaths = [],
  phase = "",
  taintMode = DERIVED_ALIAS_TAINT_MODES.STRICT,
  checkpoint = null,
  previousPolicy = null,
  policy = previousPolicy,
} = {}) {
  const normalizedSourceSha = String(sourceSha || "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalizedSourceSha)) {
    const error = new Error(
      "Historical derived-alias proof reuse requires an exact source commit.",
    );
    error.code = "historical-derived-alias-proof-source-invalid";
    throw error;
  }
  const normalizedCheckpoint = checkpoint === null
    ? null
    : normalizeHistoricalDerivedAliasProofJson(
      checkpoint,
      "checkpoint",
    ).value;
  return Object.freeze({
    identityVersion: 1,
    proofAlgorithmVersion:
      DERIVED_ALIAS_TAINT_BASELINE_ALGORITHM_VERSION,
    sourceSha: normalizedSourceSha,
    candidatePaths: Object.freeze(
      normalizeCandidatePathList(candidatePaths),
    ),
    phase: normalizeP4StateActionPhase(phase),
    taintMode: normalizeDerivedAliasTaintMode(taintMode),
    checkpoint: normalizedCheckpoint,
    previousPolicySha256: hashHistoricalDerivedAliasProofPolicy(
      previousPolicy,
      "previous policy",
    ),
    policySha256: hashHistoricalDerivedAliasProofPolicy(
      policy,
      "policy",
    ),
  });
}

export function buildHistoricalDerivedAliasProofCheckpoint({
  acceptedPolicyCheckpoint = null,
  phase = "",
  policy = null,
} = {}) {
  const normalizedPhase = normalizeP4StateActionPhase(phase);
  return {
    acceptedPolicyCheckpoint: acceptedPolicyCheckpoint
      ? cloneJsonValue(acceptedPolicyCheckpoint)
      : null,
    progressCheckpoint: cloneJsonValue(
      (policy?.progress?.checkpoints || []).find(
        (checkpoint) => checkpoint?.phase === normalizedPhase,
      ) || null,
    ),
    transitionCheckpoints: cloneJsonValue(
      policy?.baselines?.derivedAliasTaint
        ?.transitionCheckpoints || [],
    ),
  };
}

export async function resolveCachedHistoricalDerivedAliasProof({
  historicalDerivedAliasProofCache = null,
  prove,
  ...identityInputs
} = {}) {
  if (typeof prove !== "function") {
    throw new TypeError(
      "resolveCachedHistoricalDerivedAliasProof requires a proof function.",
    );
  }
  if (!historicalDerivedAliasProofCache) return prove();
  if (!(historicalDerivedAliasProofCache instanceof Map)) {
    throw new TypeError(
      "historicalDerivedAliasProofCache must be a Map when provided.",
    );
  }
  const identity = buildHistoricalDerivedAliasProofIdentity(
    identityInputs,
  );
  const cacheKey = JSON.stringify(identity);
  if (!historicalDerivedAliasProofCache.has(cacheKey)) {
    const pending = Promise.resolve()
      .then(prove)
      .then((result) => structuredClone(result));
    historicalDerivedAliasProofCache.set(cacheKey, pending);
    pending.catch(() => {
      if (historicalDerivedAliasProofCache.get(cacheKey) === pending) {
        historicalDerivedAliasProofCache.delete(cacheKey);
      }
    });
  }
  return structuredClone(
    await historicalDerivedAliasProofCache.get(cacheKey),
  );
}

export async function buildFrozenDerivedAliasTaintBaseline({
  sourceBaseSha = "",
  relativePaths = [],
  legacySemanticBaseline = {},
  existingBaseline = null,
  acceptedPolicyCheckpoint = null,
  transitionCheckpoints = null,
  readSourceAtRevision = defaultReadSourceAtRevision,
  stateKeyAuthorityIndex = buildCanonicalStateKeyAuthorityIndex(),
} = {}) {
  const normalizedSourceBaseSha = String(sourceBaseSha || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(normalizedSourceBaseSha)) {
    const error = new Error(
      "Derived alias taint baseline requires a frozen source commit.",
    );
    error.code = "derived-alias-taint-baseline-source-invalid";
    throw error;
  }
  const normalizedPaths = normalizeCandidatePathList(relativePaths)
    .filter((relativePath) => !isTestPath(relativePath));
  const previousBaseline = existingBaseline || {
    algorithmVersion:
      DERIVED_ALIAS_TAINT_BASELINE_ALGORITHM_VERSION,
    sourceBaseSha: normalizedSourceBaseSha,
    paths: [],
    diagnosticDelta: {
      ambiguousSites: [],
      unsupportedSites: [],
    },
  };
  const baselineViolations =
    validateDerivedAliasTaintBaseline(
      previousBaseline,
      { sourceBaseSha: normalizedSourceBaseSha },
    );
  if (baselineViolations.length) {
    const error = new Error(
      "Derived alias taint baseline is invalid.",
    );
    error.code = "derived-alias-taint-baseline-invalid";
    error.violations = baselineViolations;
    throw error;
  }
  const recordedPaths = new Set(previousBaseline.paths);
  const pendingPaths = normalizedPaths.filter(
    (relativePath) => !recordedPaths.has(relativePath),
  );
  const frozenProofPaths = stableUnique([
    ...previousBaseline.paths,
    ...normalizedPaths,
  ]);
  const pendingPathSet = new Set(pendingPaths);
  const replayedTransitionCheckpoints = (
    transitionCheckpoints === null
      ? previousBaseline.transitionCheckpoints || []
      : transitionCheckpoints
  ).map((checkpoint) => ({
    sourceSha: String(checkpoint?.sourceSha || "").trim().toLowerCase(),
    policyBlobSha256: String(
      checkpoint?.policyBlobSha256 || "",
    ).trim().toLowerCase(),
    paths: normalizeCandidatePathList(checkpoint?.paths),
  }));
  const replayValidation = validateDerivedAliasTaintBaseline({
    ...previousBaseline,
    paths: stableUnique([
      ...previousBaseline.paths,
      ...normalizedPaths,
    ]),
    ...(replayedTransitionCheckpoints.length
      ? { transitionCheckpoints: replayedTransitionCheckpoints }
      : {}),
  }, { sourceBaseSha: normalizedSourceBaseSha });
  if (replayValidation.length) {
    const error = new Error(
      "Derived alias taint transition checkpoints are invalid.",
    );
    error.code = "derived-alias-taint-transition-checkpoints-invalid";
    error.violations = replayValidation;
    throw error;
  }
  const transitionSourceShaByPath = new Map();
  for (const checkpoint of replayedTransitionCheckpoints) {
    for (const relativePath of checkpoint.paths) {
      transitionSourceShaByPath.set(relativePath, checkpoint.sourceSha);
    }
  }
  const acceptedCheckpointPaths = pendingPaths.filter(
    (relativePath) => !transitionSourceShaByPath.has(relativePath),
  );
  const normalizedAcceptedPolicyCheckpoint = acceptedPolicyCheckpoint
    ? {
      sourceSha: String(
        acceptedPolicyCheckpoint.sourceSha || "",
      ).trim().toLowerCase(),
      policyBlobSha256: String(
        acceptedPolicyCheckpoint.policyBlobSha256 || "",
      ).trim().toLowerCase(),
      paths: acceptedCheckpointPaths,
    }
    : null;
  if (
    existingBaseline
    && acceptedCheckpointPaths.length
    && !normalizedAcceptedPolicyCheckpoint
  ) {
    const error = new Error(
      "Derived alias taint transition requires an accepted-policy checkpoint.",
    );
    error.code = "derived-alias-taint-transition-checkpoint-required";
    throw error;
  }
  if (
    acceptedCheckpointPaths.length
    && normalizedAcceptedPolicyCheckpoint
    && (
      !/^[0-9a-f]{40}$/.test(
        normalizedAcceptedPolicyCheckpoint.sourceSha,
      )
      || !/^[0-9a-f]{64}$/.test(
        normalizedAcceptedPolicyCheckpoint.policyBlobSha256,
      )
    )
  ) {
    const error = new Error(
      "Derived alias taint transition requires exact accepted-policy provenance.",
    );
    error.code = "derived-alias-taint-transition-checkpoint-invalid";
    throw error;
  }
  const strictHistoricalWriters = [];
  const transitionHistoricalWriters = [];
  const frozenBaselineWritersByPath =
    buildFrozenBaselineWritersByPath(legacySemanticBaseline);
  for (const relativePath of frozenProofPaths) {
    const frozenSourceSha = transitionSourceShaByPath.get(relativePath)
      || (pendingPathSet.has(relativePath)
        ? normalizedAcceptedPolicyCheckpoint?.sourceSha
        : null)
      || normalizedSourceBaseSha;
    const source = await readSourceAtRevision(
      frozenSourceSha,
      relativePath,
    );
    if (source === null || source === undefined) {
      continue;
    }
    const { bindingInventories } =
      await discoverStateWriterBindingsForSource(
        relativePath,
        String(source),
        "production",
        {
          previousWriter:
            frozenBaselineWritersByPath.get(relativePath),
          scanAllParameters: true,
          enforceCurrentContracts: false,
          derivedAliasTaintMode:
            DERIVED_ALIAS_TAINT_MODES.STRICT,
          includeInventories: true,
        },
      );
    const bindings = bindingInventories.flatMap(
      ({ binding, findings }) => {
        const diagnosticFindings = findings.filter(
          ({ unsupported }) => unsupported,
        );
        if (!diagnosticFindings.length) {
          return [];
        }
        return [{
          ...binding,
          authority: bindingAuthority(
            relativePath,
            "production",
            binding,
          ),
          grants: buildStateWriterBindingGrants(
            diagnosticFindings,
            relativePath,
            stateKeyAuthorityIndex,
            "production",
            { allowUnknownUnsupportedAuthority: true },
          ),
        }];
      },
    );
    if (bindings.length) {
      strictHistoricalWriters.push({
        path: relativePath,
        surface: "production",
        bindings,
      });
    }
    if (
      pendingPathSet.has(relativePath)
      && (
        transitionSourceShaByPath.has(relativePath)
        || (
          acceptedCheckpointPaths.includes(relativePath)
          && normalizedAcceptedPolicyCheckpoint
        )
      )
    ) {
      const previousWriter =
        frozenBaselineWritersByPath.get(relativePath) || null;
      const transitionBindings = bindingInventories
        .filter(({ binding, findings }) =>
          findings.length
          && isTransitionSemanticBinding(binding, previousWriter)
        )
        .map(({ binding, findings }) => ({
          ...binding,
          authority: bindingAuthority(
            relativePath,
            "production",
            binding,
          ),
          grants: buildStateWriterBindingGrants(
            findings,
            relativePath,
            stateKeyAuthorityIndex,
            "production",
            {
              allowUnknownUnsupportedAuthority:
                ALLOW_UNKNOWN_UNSUPPORTED_AUTHORITY,
            },
          ),
        }));
      if (transitionBindings.length) {
        transitionHistoricalWriters.push({
          path: relativePath,
          surface: "production",
          bindings: transitionBindings,
        });
      }
    }
  }
  const strictSemanticAuthority =
    buildLegacyStateWriterSemanticAuthority(
      strictHistoricalWriters,
    );
  const refreshedDiagnosticDelta = buildDerivedAliasTaintDiagnosticDelta({
    legacySemanticBaseline,
    strictSemanticAuthority,
  });
  const transitionSemanticAuthority =
    buildLegacyStateWriterSemanticAuthority(
      transitionHistoricalWriters,
    );
  const pendingTransitionSemanticDelta = Object.fromEntries(
    DERIVED_ALIAS_TAINT_TRANSITION_SEMANTIC_SECTIONS.map((section) => [
      section,
      subtractSignatureMultiset(
        transitionSemanticAuthority[section],
        legacySemanticBaseline?.[section],
      ),
    ]),
  );
  const nextTransitionCheckpoints = [
    ...replayedTransitionCheckpoints,
    ...(acceptedCheckpointPaths.length && normalizedAcceptedPolicyCheckpoint
      ? [normalizedAcceptedPolicyCheckpoint]
      : []),
  ];
  return {
    algorithmVersion:
      DERIVED_ALIAS_TAINT_BASELINE_ALGORITHM_VERSION,
    sourceBaseSha: normalizedSourceBaseSha,
    paths: frozenProofPaths,
    diagnosticDelta: Object.fromEntries(
      DERIVED_ALIAS_TAINT_DIAGNOSTIC_SECTIONS.map((section) => [
        section,
        [...refreshedDiagnosticDelta[section]].sort(),
      ]),
    ),
    ...(nextTransitionCheckpoints.length
      ? {
        transitionSemanticDelta: Object.fromEntries(
          DERIVED_ALIAS_TAINT_TRANSITION_SEMANTIC_SECTIONS.map(
            (section) => [
              section,
              [
                ...(previousBaseline.transitionSemanticDelta?.[section]
                  || []),
                ...pendingTransitionSemanticDelta[section],
              ].sort(),
            ],
          ),
        ),
      }
      : {}),
    ...(nextTransitionCheckpoints.length
      ? { transitionCheckpoints: nextTransitionCheckpoints }
      : {}),
  };
}

export function resolveAcceptedStateWriterPolicyCheckpoint({
  policy,
  revision = "HEAD",
  cwd = PROJECT_ROOT,
  runGit = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }),
} = {}) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    const error = new Error(
      "Accepted policy checkpoint requires a policy object.",
    );
    error.code = "accepted-policy-checkpoint-policy-invalid";
    throw error;
  }
  const policyPath = normalizeRelativePath(
    path.relative(PROJECT_ROOT, STATE_WRITER_POLICY_PATH),
  );
  let revisions;
  try {
    revisions = String(runGit([
      "log",
      "--format=%H",
      String(revision || "HEAD").trim() || "HEAD",
      "--",
      policyPath,
    ]) || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[0-9a-f]{40}$/.test(entry));
  } catch (cause) {
    const error = new Error(
      "Unable to enumerate accepted state-writer policy checkpoints.",
      { cause },
    );
    error.code = "accepted-policy-checkpoint-history-unavailable";
    throw error;
  }
  for (const sourceSha of revisions) {
    let source;
    try {
      source = String(
        runGit(["show", `${sourceSha}:${policyPath}`]) || "",
      );
    } catch {
      continue;
    }
    let candidatePolicy;
    try {
      candidatePolicy = JSON.parse(source);
    } catch {
      continue;
    }
    if (!isDeepStrictEqual(candidatePolicy, policy)) {
      continue;
    }
    return {
      sourceSha,
      policyBlobSha256: createHash("sha256")
        .update(source)
        .digest("hex"),
    };
  }
  const error = new Error(
    "The previous state-writer policy has no exact accepted Git checkpoint.",
  );
  error.code = "accepted-policy-checkpoint-not-found";
  throw error;
}

export function subtractLegacyStateWriterSemanticAuthority(
  baseline = {},
  current = {},
) {
  return Object.fromEntries(
    LEGACY_SEMANTIC_SECTIONS.map((section) => {
      const remaining = signatureCounts(baseline?.[section]);
      for (const [signature, count] of signatureCounts(current?.[section])) {
        remaining.set(
          signature,
          Math.max(0, (remaining.get(signature) || 0) - count),
        );
      }
      const retired = [];
      for (const [signature, count] of remaining) {
        for (let index = 0; index < count; index += 1) {
          retired.push(signature);
        }
      }
      return [section, retired.sort()];
    }),
  );
}

export function validateLegacyStateWriterSemanticLedger({
  baseline = null,
  writers = [],
  retired = null,
  previousWriters = null,
  previousAuthorityBaseline = null,
  previousRetired = null,
} = {}) {
  const current = buildLegacyStateWriterSemanticAuthority(writers);
  const expectedRetired = baseline
    ? subtractLegacyStateWriterSemanticAuthority(baseline, current)
    : null;
  const violations = [];
  if (!baseline || !retired) {
    return {
      verdict: "fail",
      current,
      expectedRetired,
      violations: [{
        code: "legacy-semantic-authority-ledger-missing",
      }],
    };
  }
  for (const section of LEGACY_SEMANTIC_SECTIONS) {
    const actual = Array.isArray(retired?.[section])
      ? [...retired[section]].map(String).sort()
      : null;
    if (
      !actual
      || JSON.stringify(actual)
        !== JSON.stringify(expectedRetired[section])
    ) {
      violations.push({
        code: "legacy-semantic-retired-ledger-drift",
        section,
        expected: expectedRetired[section],
        actual,
      });
    }
  }
  if (previousWriters) {
    violations.push(
      ...validateLegacyStateWriterSemanticAuthority({
        baseline: previousAuthorityBaseline
          || buildLegacyStateWriterSemanticAuthority(previousWriters),
        writers,
        scope: "previous-active",
      }).violations,
    );
  }
  if (previousRetired) {
    for (const section of LEGACY_SEMANTIC_CUMULATIVE_AUTHORITY_SECTIONS) {
      const currentCounts = signatureCounts(retired?.[section]);
      for (
        const [signature, previousCount] of
          signatureCounts(previousRetired?.[section])
      ) {
        const currentCount = currentCounts.get(signature) || 0;
        if (currentCount < previousCount) {
          violations.push({
            code: "legacy-semantic-retirement-regressed",
            section,
            signature,
            previousCount,
            currentCount,
          });
        }
      }
    }
  }
  return {
    verdict: violations.length ? "fail" : "pass",
    current,
    expectedRetired,
    violations,
  };
}

function collectMembershipRecords(
  writers = [],
  { authorities = new Set() } = {},
) {
  const records = [];
  for (const writer of Array.isArray(writers) ? writers : []) {
    if (writer?.surface !== "production") {
      continue;
    }
    for (const binding of Array.isArray(writer?.bindings)
      ? writer.bindings
      : []) {
      if (!authorities.has(binding?.authority)) {
        continue;
      }
      const bindingIdentity = stableLegacyBindingIdentity(binding);
      for (const grant of Array.isArray(binding?.grants)
        ? binding.grants
        : []) {
        for (const membership of Array.isArray(grant?.memberships)
          ? grant.memberships
          : []) {
          records.push({
            signature: [
              writer.path,
              bindingIdentity,
              String(grant.domain || ""),
              String(grant.migrationPhase || ""),
              String(membership.operation || ""),
              String(membership.key || ""),
            ].join("|"),
            replacementKey: [
              String(grant.domain || ""),
              String(grant.migrationPhase || ""),
              String(membership.operation || ""),
              String(membership.key || ""),
            ].join("|"),
            path: writer.path,
            bindingId: binding.id,
            domain: String(grant.domain || ""),
            migrationPhase: String(grant.migrationPhase || ""),
            operation: String(membership.operation || ""),
            key: String(membership.key || ""),
          });
        }
      }
    }
  }
  return records;
}

export function normalizeStateActionDelegations(
  actionDelegations = [],
) {
  const normalized = (Array.isArray(actionDelegations)
    ? actionDelegations
    : [])
    .map((edge) => {
      const callerPath = normalizeRelativePath(
        edge?.callerPath || edge?.filePath,
      );
      const callerBindingId = String(
        edge?.callerBindingId || edge?.bindingId || "",
      );
      const callerBindingIdentity = String(
        edge?.callerBindingIdentity || "",
      ) || buildStableStateBindingIdentity({
        kind: edge?.bindingKind,
        name: edge?.root,
        functionName: edge?.functionName,
        parameterName:
          edge?.bindingKind === "function-parameter"
            ? edge?.parameterName
            : "",
        parameterIndex: edge?.parameterIndex,
        parameterPath: edge?.parameterPath,
        importSource: edge?.importSource,
        importedName: edge?.importedName,
        aliasSources: edge?.aliasSources,
        aliasOperators: edge?.aliasOperators,
      });
      return {
        callerPath,
        callerBindingId,
        callerBindingIdentity,
        enclosingFunctionIdentity: String(
          edge?.enclosingFunctionIdentity || "",
        ),
        actionModulePath: normalizeRelativePath(edge?.actionModulePath),
        actionExportName: String(edge?.actionExportName || ""),
        targetArgumentIndex: Number(edge?.targetArgumentIndex),
        start: Number(edge?.start || 0),
        end: Number(edge?.end || 0),
        line: Number(edge?.line || 0),
        column: Number(edge?.column || 0),
        sourceFingerprint: String(edge?.sourceFingerprint || ""),
      };
    })
    .filter(
      (edge) =>
        edge.callerPath
        && edge.callerBindingId
        && edge.callerBindingIdentity
        && edge.actionModulePath
        && edge.actionExportName
        && Number.isInteger(edge.targetArgumentIndex)
        && edge.targetArgumentIndex >= 0,
    )
    .sort(
      (left, right) =>
        left.callerPath.localeCompare(right.callerPath)
        || left.callerBindingIdentity.localeCompare(
          right.callerBindingIdentity,
        )
        || left.actionModulePath.localeCompare(right.actionModulePath)
        || left.actionExportName.localeCompare(right.actionExportName)
        || left.targetArgumentIndex - right.targetArgumentIndex
        || left.start - right.start
        || left.end - right.end,
    );
  const occurrenceCounts = new Map();
  const legacyOccurrenceCounts = new Map();
  const bindingIdsByStableIdentity = new Map();
  for (const edge of normalized) {
    const stableIdentity = [
      edge.callerPath,
      edge.callerBindingIdentity,
    ].join("|");
    if (!bindingIdsByStableIdentity.has(stableIdentity)) {
      bindingIdsByStableIdentity.set(stableIdentity, new Set());
    }
    bindingIdsByStableIdentity.get(stableIdentity)
      .add(edge.callerBindingId);
  }
  const ambiguousBindingIdentities = [
    ...bindingIdsByStableIdentity.entries(),
  ].filter(([, bindingIds]) => bindingIds.size > 1);
  if (ambiguousBindingIdentities.length) {
    const error = new Error(
      "Caller-to-action binding identity is ambiguous within one source file.",
    );
    error.code = "caller-action-binding-identity-ambiguous";
    error.violations = ambiguousBindingIdentities.map(
      ([stableIdentity, bindingIds]) => ({
        stableIdentity,
        bindingIds: [...bindingIds].sort(),
      }),
    );
    throw error;
  }
  return normalized.map((edge) => {
    const groupIdentity = [
      edge.callerPath,
      edge.callerBindingIdentity,
      edge.enclosingFunctionIdentity,
      edge.actionModulePath,
      edge.actionExportName,
      edge.targetArgumentIndex,
    ].join("|");
    const occurrenceIndex = occurrenceCounts.get(groupIdentity) || 0;
    occurrenceCounts.set(groupIdentity, occurrenceIndex + 1);
    const legacyGroupIdentity = [
      edge.callerPath,
      edge.callerBindingIdentity,
      edge.actionModulePath,
      edge.actionExportName,
      edge.targetArgumentIndex,
    ].join("|");
    const legacyOccurrenceIndex =
      legacyOccurrenceCounts.get(legacyGroupIdentity) || 0;
    legacyOccurrenceCounts.set(
      legacyGroupIdentity,
      legacyOccurrenceIndex + 1,
    );
    return {
      ...edge,
      occurrenceIndex,
      legacyOccurrenceIndex,
      actionCallEdgeIdentity: buildStateActionCallEdgeIdentity({
        ...edge,
        occurrenceIndex,
      }),
      legacyActionCallEdgeIdentity:
        buildLegacyStateActionCallEdgeIdentity({
          ...edge,
          occurrenceIndex: legacyOccurrenceIndex,
        }),
    };
  });
}

function buildActionMembershipIndex(writers = []) {
  const index = new Map();
  for (const writer of Array.isArray(writers) ? writers : []) {
    if (
      writer?.surface !== "production"
      || writer?.authority !== "domain-action"
    ) {
      continue;
    }
    for (const binding of Array.isArray(writer?.bindings)
      ? writer.bindings
      : []) {
      if (binding?.authority !== "domain-action") {
        continue;
      }
      const exportName = String(binding.functionName || "");
      const contract = STATE_ACTION_DELEGATION_CONTRACT.find(
        (entry) =>
          entry.modulePath === writer.path
          && entry.exportName === exportName,
      );
      if (!contract) {
        continue;
      }
      const actionIdentity = `${writer.path}#${exportName}`;
      if (!index.has(actionIdentity)) {
        index.set(actionIdentity, new Set());
      }
      const memberships = index.get(actionIdentity);
      for (const grant of Array.isArray(binding?.grants)
        ? binding.grants
        : []) {
        for (const membership of Array.isArray(grant?.memberships)
          ? grant.memberships
          : []) {
          memberships.add(
            [
              String(grant.domain || ""),
              String(grant.migrationPhase || ""),
              String(membership.operation || ""),
              String(membership.key || ""),
            ].join("|"),
          );
        }
      }
    }
  }
  for (const [actionIdentity, memberships] of index) {
    const separatorIndex = actionIdentity.lastIndexOf("#");
    const modulePath = actionIdentity.slice(0, separatorIndex);
    const exportName = actionIdentity.slice(separatorIndex + 1);
    index.set(
      actionIdentity,
      expandStateActionMembershipsWithLegacyReplacements({
        modulePath,
        exportName,
        memberships,
      }),
    );
  }
  return index;
}

function findActionTargetBinding(writers, modulePath, exportName) {
  const contract = STATE_ACTION_DELEGATION_CONTRACT.find(
    (entry) =>
      entry.modulePath === modulePath
      && entry.exportName === exportName,
  );
  if (!contract) return null;
  const matches = (Array.isArray(writers) ? writers : [])
    .filter((writer) =>
      writer?.surface === "production"
      && writer?.authority === "domain-action"
      && writer?.path === modulePath
    )
    .flatMap((writer) => writer.bindings || [])
    .filter((binding) =>
      binding?.authority === "domain-action"
      && binding?.functionName === exportName
      && binding?.kind === "function-parameter"
      && Number(binding?.parameterIndex)
        === Number(contract.targetArgumentIndex)
    );
  return matches.length === 1 ? matches[0] : null;
}

function actionBindingOwnsExactMembership(binding, membership) {
  return (binding?.grants || []).some((grant) =>
    (grant?.memberships || []).some((candidate) =>
      [
        String(grant?.domain || ""),
        String(grant?.migrationPhase || ""),
        String(candidate?.operation || ""),
        String(candidate?.key || ""),
      ].join("|") === membership
    )
  );
}

function actionEdgeProof(edge) {
  return {
    callerPath: edge.callerPath,
    callerBindingId: edge.callerBindingId,
    callerBindingIdentity: edge.callerBindingIdentity,
    enclosingFunctionIdentity: edge.enclosingFunctionIdentity,
    actionModulePath: edge.actionModulePath,
    actionExportName: edge.actionExportName,
    targetArgumentIndex: edge.targetArgumentIndex,
    actionCallEdgeIdentity: edge.actionCallEdgeIdentity,
    occurrenceIndex: edge.occurrenceIndex,
    start: edge.start,
    end: edge.end,
    line: edge.line,
    column: edge.column,
    sourceFingerprint: edge.sourceFingerprint,
    terminalMembership: edge.terminalMembership,
  };
}

function resolveActionSuccessorProofs({
  edge,
  retiredMembership,
  writers,
  normalizedEdges,
  actionMembershipIndex,
}) {
  const firstActionIdentity =
    `${edge.actionModulePath}#${edge.actionExportName}`;
  const firstActionOwnsMembership = actionMembershipIndex
    .get(firstActionIdentity)
    ?.has(retiredMembership.replacementKey);
  const successorContract =
    findStateActionSuccessorProofContractEntry(
      edge.actionModulePath,
      edge.actionExportName,
      retiredMembership.replacementKey,
    );
  if (successorContract && firstActionOwnsMembership) {
    return { error: "caller-action-successor-membership-reacquired" };
  }
  if (!successorContract && firstActionOwnsMembership) {
    return {
      successorActionProofs: [],
      successorProofContractIdentity: "",
    };
  }
  if (!successorContract) {
    return { error: "caller-action-successor-contract-missing" };
  }
  const targetBinding = findActionTargetBinding(
    writers,
    edge.actionModulePath,
    edge.actionExportName,
  );
  if (!targetBinding) {
    return { error: "caller-action-successor-owner-unresolved" };
  }
  if (successorContract.requiredDirectMemberships.some(
    (membership) =>
      !actionBindingOwnsExactMembership(targetBinding, membership),
  )) {
    return { error: "caller-action-successor-direct-membership-missing" };
  }
  const targetBindingIdentity =
    buildStableStateBindingIdentity(targetBinding);
  const outgoingEdges = normalizedEdges.filter((candidate) =>
    candidate.callerPath === edge.actionModulePath
    && candidate.callerBindingIdentity === targetBindingIdentity
  );
  const terminalEdges = [];
  for (const expected of successorContract.successorEdges) {
    const matches = outgoingEdges.filter((candidate) =>
      candidate.enclosingFunctionIdentity
        === expected.enclosingFunctionIdentity
      && candidate.actionModulePath === expected.actionModulePath
      && candidate.actionExportName === expected.actionExportName
      && candidate.targetArgumentIndex
        === expected.targetArgumentIndex
      && candidate.sourceFingerprint === expected.sourceFingerprint
      && candidate.occurrenceIndex === expected.occurrenceIndex
    );
    if (matches.length !== 1) {
      return {
        error: matches.length
          ? "caller-action-successor-edge-ambiguous"
          : "caller-action-successor-edge-missing",
      };
    }
    const [candidate] = matches;
    if (
      candidate.actionModulePath === edge.actionModulePath
      && candidate.actionExportName === edge.actionExportName
    ) {
      return { error: "caller-action-successor-cycle" };
    }
    const terminalBinding = findActionTargetBinding(
      writers,
      candidate.actionModulePath,
      candidate.actionExportName,
    );
    if (!actionBindingOwnsExactMembership(
      terminalBinding,
      expected.terminalMembership,
    )) {
      return { error: "caller-action-successor-membership-missing" };
    }
    terminalEdges.push({
      ...candidate,
      terminalMembership: expected.terminalMembership,
    });
  }
  return {
    successorActionProofs: terminalEdges
      .map(actionEdgeProof)
      .sort((left, right) =>
        left.actionCallEdgeIdentity.localeCompare(
          right.actionCallEdgeIdentity,
        )
      ),
    successorProofContractIdentity:
      successorContract.contractIdentity,
  };
}

function buildCallerToActionLedgerEntry({
  retiredMembership,
  retiredMutationEvidence,
  edge,
  crossFileMigration = null,
  retiredInPhase,
  recordedInPhase,
  backfilled,
  successorActionProofs = [],
  successorProofContractIdentity = "",
}) {
  return {
    retiredMembershipIdentity: retiredMembership.signature,
    callerPath: edge.callerPath,
    callerBindingId: edge.callerBindingId,
    callerBindingIdentity: edge.callerBindingIdentity,
    enclosingFunctionIdentity: edge.enclosingFunctionIdentity,
    ...(Array.isArray(
      retiredMutationEvidence.retiredEnclosingFunctionIdentities,
    )
      ? {
        retiredEnclosingFunctionIdentities:
          retiredMutationEvidence
            .retiredEnclosingFunctionIdentities,
        retiredMutationFunctionCount:
          retiredMutationEvidence.functionCount,
      }
      : {
        retiredEnclosingFunctionIdentity:
          retiredMutationEvidence.enclosingFunctionIdentity,
      }),
    retiredMutationSiteFingerprint:
      retiredMutationEvidence.siteFingerprint,
    retiredMutationSiteCount:
      retiredMutationEvidence.siteCount,
    proofPrecision: retiredMutationEvidence.proofPrecision,
    ...(crossFileMigration
      ? {
        retiredCallerPath:
          crossFileMigration.retiredCallerPath,
        retiredCallerBindingIdentity:
          crossFileMigration.retiredCallerBindingIdentity,
        crossFileMigrationContractIdentity:
          crossFileMigration.contractIdentity,
      }
      : {}),
    domain: retiredMembership.domain,
    migrationPhase: retiredMembership.migrationPhase,
    operation: retiredMembership.operation,
    key: retiredMembership.key,
    actionModulePath: edge.actionModulePath,
    actionExportName: edge.actionExportName,
    targetArgumentIndex: edge.targetArgumentIndex,
    actionCallEdgeIdentity: edge.actionCallEdgeIdentity,
    occurrenceIndex: edge.occurrenceIndex,
    start: edge.start,
    end: edge.end,
    line: edge.line,
    column: edge.column,
    sourceFingerprint: edge.sourceFingerprint,
    ...(successorActionProofs.length
      ? {
        successorActionProofs,
        successorProofContractIdentity,
      }
      : {}),
    retiredInPhase: normalizeP4StateActionPhase(retiredInPhase),
    recordedInPhase: normalizeP4StateActionPhase(recordedInPhase),
    backfilled: Boolean(backfilled),
  };
}

function buildCallerToActionFunctionProof({
  retiredMutationEvidence,
  edge,
  successorActionProofs = [],
  successorProofContractIdentity = "",
}) {
  return {
    callerPath: edge.callerPath,
    callerBindingId: edge.callerBindingId,
    callerBindingIdentity: edge.callerBindingIdentity,
    enclosingFunctionIdentity: edge.enclosingFunctionIdentity,
    retiredEnclosingFunctionIdentity:
      retiredMutationEvidence.enclosingFunctionIdentity,
    retiredMutationSiteFingerprint:
      retiredMutationEvidence.siteFingerprint,
    retiredMutationSiteCount:
      retiredMutationEvidence.siteCount,
    proofPrecision: retiredMutationEvidence.proofPrecision,
    actionModulePath: edge.actionModulePath,
    actionExportName: edge.actionExportName,
    targetArgumentIndex: edge.targetArgumentIndex,
    actionCallEdgeIdentity: edge.actionCallEdgeIdentity,
    occurrenceIndex: edge.occurrenceIndex,
    start: edge.start,
    end: edge.end,
    line: edge.line,
    column: edge.column,
    sourceFingerprint: edge.sourceFingerprint,
    ...(successorActionProofs.length
      ? {
        successorActionProofs,
        successorProofContractIdentity,
      }
      : {}),
  };
}

function buildMultiFunctionCallerToActionLedgerEntry({
  retiredMembership,
  retiredMutationEvidence,
  functionProofs,
  retiredInPhase,
  recordedInPhase,
  backfilled,
}) {
  return {
    retiredMembershipIdentity: retiredMembership.signature,
    retiredCallerPath: retiredMembership.callerPath,
    retiredCallerBindingIdentity:
      retiredMembership.callerBindingIdentity,
    retiredMutationSiteFingerprint:
      retiredMutationEvidence.siteFingerprint,
    retiredMutationSiteCount:
      retiredMutationEvidence.siteCount,
    retiredMutationFunctionCount:
      retiredMutationEvidence.functionCount,
    proofPrecision: retiredMutationEvidence.proofPrecision,
    functionProofs,
    domain: retiredMembership.domain,
    migrationPhase: retiredMembership.migrationPhase,
    operation: retiredMembership.operation,
    key: retiredMembership.key,
    retiredInPhase: normalizeP4StateActionPhase(retiredInPhase),
    recordedInPhase: normalizeP4StateActionPhase(recordedInPhase),
    backfilled: Boolean(backfilled),
  };
}

function callerToActionEntryProofs(entry = {}) {
  return Array.isArray(entry?.functionProofs)
    ? entry.functionProofs
    : [entry];
}

function callerToActionEntrySortEdgeIdentity(entry = {}) {
  return String(
    entry?.actionCallEdgeIdentity
      || entry?.functionProofs?.[0]?.actionCallEdgeIdentity
      || "",
  );
}

function normalizeMutationSiteEvidence(site = {}) {
  const enclosingFunctionIdentity = String(
    site?.enclosingFunctionIdentity || "",
  );
  const sourceFingerprint = String(
    site?.sourceFingerprint || "",
  );
  const occurrenceIndex = Number(site?.occurrenceIndex);
  if (
    !enclosingFunctionIdentity
    || !/^[0-9a-f]{64}$/i.test(sourceFingerprint)
    || !Number.isInteger(occurrenceIndex)
    || occurrenceIndex < 0
  ) {
    return null;
  }
  return {
    enclosingFunctionIdentity,
    sourceFingerprint,
    occurrenceIndex,
  };
}

function findPreviousRetiredMutationSites(
  previousPolicy,
  retiredMembership,
) {
  const writer = (previousPolicy?.writers || []).find(
    ({ path: writerPath }) =>
      normalizeRelativePath(writerPath)
      === retiredMembership.callerPath,
  );
  const binding = (writer?.bindings || []).find(
    (candidate) =>
      buildStableStateBindingIdentity(candidate)
      === retiredMembership.callerBindingIdentity,
  );
  const grant = (binding?.grants || []).find(
    (candidate) =>
      candidate?.domain === retiredMembership.domain
      && candidate?.migrationPhase
        === retiredMembership.migrationPhase,
  );
  const membership = (grant?.memberships || []).find(
    (candidate) =>
      candidate?.operation === retiredMembership.operation
      && candidate?.key === retiredMembership.key,
  );
  return (membership?.mutationSites || [])
    .map(normalizeMutationSiteEvidence)
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.enclosingFunctionIdentity.localeCompare(
          right.enclosingFunctionIdentity,
        )
        || left.sourceFingerprint.localeCompare(
          right.sourceFingerprint,
        )
        || left.occurrenceIndex - right.occurrenceIndex,
    );
}

function lastEnclosingFunctionName(identity = "") {
  try {
    const parsed = JSON.parse(String(identity || ""));
    return String(parsed?.ancestry?.at(-1)?.name || "");
  } catch {
    return "";
  }
}

function buildRetiredMutationEvidence({
  previousPolicy,
  retiredMembership,
  candidateEdges,
  crossFileMigration = null,
}) {
  const mutationSites = findPreviousRetiredMutationSites(
    previousPolicy,
    retiredMembership,
  );
  if (crossFileMigration) {
    const contractedMutationSites = (
      crossFileMigration.retiredMutationSites || []
    )
      .map(normalizeMutationSiteEvidence)
      .filter(Boolean)
      .sort(
        (left, right) =>
          left.enclosingFunctionIdentity.localeCompare(
            right.enclosingFunctionIdentity,
          )
          || left.sourceFingerprint.localeCompare(
            right.sourceFingerprint,
          )
          || left.occurrenceIndex - right.occurrenceIndex,
      );
    if (
      !contractedMutationSites.length
      || JSON.stringify(
        crossFileMigration.retiredMutationSites || [],
      ) !== JSON.stringify(contractedMutationSites)
    ) {
      return {
        error: "cross-file-retired-mutation-sites-invalid",
      };
    }
    if (
      mutationSites.length
      && JSON.stringify(mutationSites)
        !== JSON.stringify(contractedMutationSites)
    ) {
      return {
        error:
          "cross-file-retired-mutation-sites-do-not-match-policy",
      };
    }
    const functionIdentities = [
      ...new Set(
        contractedMutationSites.map(
          ({ enclosingFunctionIdentity }) =>
            enclosingFunctionIdentity,
        ),
      ),
    ];
    const multipleRetiredFunctions =
      functionIdentities.length > 1;
    return {
      ...(multipleRetiredFunctions
        ? {
          retiredEnclosingFunctionIdentities:
            functionIdentities,
          functionCount: functionIdentities.length,
        }
        : {
          enclosingFunctionIdentity: functionIdentities[0],
        }),
      siteFingerprint: createHash("sha256")
        .update(JSON.stringify(contractedMutationSites))
        .digest("hex"),
      siteCount: contractedMutationSites.length,
      proofPrecision: multipleRetiredFunctions
        ? "explicit-cross-file-multi-function"
        : "explicit-cross-file",
    };
  }
  if (mutationSites.length) {
    const functionIdentities = [
      ...new Set(
        mutationSites.map(
          ({ enclosingFunctionIdentity }) =>
            enclosingFunctionIdentity,
        ),
      ),
    ];
    if (functionIdentities.length !== 1) {
      const functionEvidences = functionIdentities
        .sort((left, right) => left.localeCompare(right))
        .map((enclosingFunctionIdentity) => {
          const functionMutationSites = mutationSites.filter(
            (site) =>
              site.enclosingFunctionIdentity
                === enclosingFunctionIdentity,
          );
          return {
            enclosingFunctionIdentity,
            siteFingerprint: createHash("sha256")
              .update(JSON.stringify(functionMutationSites))
              .digest("hex"),
            siteCount: functionMutationSites.length,
            proofPrecision: "exact-site",
          };
        });
      return {
        functionEvidences,
        siteFingerprint: createHash("sha256")
          .update(JSON.stringify(mutationSites))
          .digest("hex"),
        siteCount: mutationSites.length,
        functionCount: functionEvidences.length,
        proofPrecision: "exact-site-multi-function",
      };
    }
    return {
      enclosingFunctionIdentity: functionIdentities[0],
      siteFingerprint: createHash("sha256")
        .update(JSON.stringify(mutationSites))
        .digest("hex"),
      siteCount: mutationSites.length,
      proofPrecision: "exact-site",
    };
  }

  let bindingFunctionName = "";
  try {
    bindingFunctionName = String(
      JSON.parse(retiredMembership.callerBindingIdentity)
        ?.functionName || "",
    );
  } catch {
    bindingFunctionName = "";
  }
  const compatibleCandidates = bindingFunctionName
    ? candidateEdges.filter(
      ({ enclosingFunctionIdentity }) =>
        lastEnclosingFunctionName(enclosingFunctionIdentity)
        === bindingFunctionName,
    )
    : candidateEdges;
  const enclosingFunctionIdentity = String(
    compatibleCandidates[0]?.enclosingFunctionIdentity || "",
  );
  if (!enclosingFunctionIdentity) {
    return {
      error: "retired-membership-enclosing-function-unresolved",
    };
  }
  return {
    enclosingFunctionIdentity,
    siteFingerprint: createHash("sha256")
      .update(
        [
          retiredMembership.signature,
          enclosingFunctionIdentity,
          "historical-backfill",
        ].join("|"),
      )
      .digest("hex"),
    siteCount: 1,
    proofPrecision: "historical-backfill",
  };
}

function assertUniqueStableCallerBindingIdentities(writers = []) {
  const bindingIdsByStableIdentity = new Map();
  for (const writer of Array.isArray(writers) ? writers : []) {
    if (
      writer?.surface !== "production"
      || !Array.isArray(writer?.bindings)
    ) {
      continue;
    }
    for (const binding of writer.bindings) {
      if (!LEGACY_BINDING_AUTHORITIES.has(binding?.authority)) {
        continue;
      }
      const stableIdentity = [
        normalizeRelativePath(writer.path),
        buildStableStateBindingIdentity(binding),
      ].join("|");
      if (!bindingIdsByStableIdentity.has(stableIdentity)) {
        bindingIdsByStableIdentity.set(stableIdentity, new Set());
      }
      bindingIdsByStableIdentity.get(stableIdentity)
        .add(String(binding.id || ""));
    }
  }
  const ambiguousBindingIdentities = [
    ...bindingIdsByStableIdentity.entries(),
  ].filter(([, bindingIds]) => bindingIds.size > 1);
  if (!ambiguousBindingIdentities.length) {
    return;
  }
  const error = new Error(
    "Caller-to-action binding identity is ambiguous within one source file.",
  );
  error.code = "caller-action-binding-identity-ambiguous";
  error.violations = ambiguousBindingIdentities.map(
    ([stableIdentity, bindingIds]) => ({
      stableIdentity,
      bindingIds: [...bindingIds].sort(),
    }),
  );
  throw error;
}

export function buildCallerToActionLedger({
  phase,
  previousPolicy = null,
  bootstrapSeedEntries = [],
  writers = [],
  retiredLegacySemanticAuthority = null,
  actionDelegations = [],
  crossFileMigrationContract =
    STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT,
} = {}) {
  const normalizedPhase = normalizeP4StateActionPhase(phase);
  const ledgerIntroductionPhaseIndex =
    P4_STATE_ACTION_PHASES.indexOf("P4.2a");
  const normalizedPhaseIndex =
    P4_STATE_ACTION_PHASES.indexOf(normalizedPhase);
  const retiredMembershipIdentities = [
    ...(retiredLegacySemanticAuthority?.memberships || []),
  ].sort();
  const previousLedger =
    previousPolicy?.progress?.callerToActionLedger;
  const previousEntries = Array.isArray(previousLedger?.entries)
    ? cloneJsonValue(previousLedger.entries)
    : [];
  const previousRetiredMembershipIdentities = new Set(
    previousPolicy?.progress?.retiredLegacySemanticAuthority
      ?.memberships || [],
  );
  if (
    previousEntries.length === 0
    && normalizedPhaseIndex < ledgerIntroductionPhaseIndex
  ) {
    return null;
  }
  assertUniqueStableCallerBindingIdentities(writers);
  const crossFileMigrationContractViolations =
    validateStateActionCrossFileMigrationContract(
      crossFileMigrationContract,
    );
  if (crossFileMigrationContractViolations.length) {
    const error = new Error(
      "State action cross-file migration contract is invalid.",
    );
    error.code = "state-action-cross-file-migration-contract-invalid";
    error.violations = crossFileMigrationContractViolations;
    throw error;
  }
  const successorProofContractViolations =
    validateStateActionSuccessorProofContract();
  if (successorProofContractViolations.length) {
    const error = new Error(
      "State action successor proof contract is invalid.",
    );
    error.code = "state-action-successor-proof-contract-invalid";
    error.violations = successorProofContractViolations;
    throw error;
  }
  const backfillAllowed =
    previousPolicy
    && previousEntries.length === 0
    && previousRetiredMembershipIdentities.size > 0
    && previousPolicy?.progress?.latestPhase === "P4.1"
    && normalizedPhase === "P4.2a";
  const normalizedBootstrapSeedEntries =
    Array.isArray(bootstrapSeedEntries)
      ? cloneJsonValue(bootstrapSeedEntries)
      : [];
  const bootstrapSeedByRetiredIdentity = new Map(
    normalizedBootstrapSeedEntries.map((entry) => [
      String(entry?.retiredMembershipIdentity || ""),
      entry,
    ]),
  );
  if (normalizedBootstrapSeedEntries.length) {
    const seedCoverageValid =
      bootstrapSeedByRetiredIdentity.size
        === previousRetiredMembershipIdentities.size
      && normalizedBootstrapSeedEntries.length
        === bootstrapSeedByRetiredIdentity.size
      && [...previousRetiredMembershipIdentities].every(
        (identity) =>
          bootstrapSeedByRetiredIdentity.has(identity),
      );
    const seedProvenanceValid =
      normalizedBootstrapSeedEntries.every(
        (entry) =>
          entry?.backfilled === true
          && entry?.retiredInPhase === "P4.1"
          && entry?.recordedInPhase === "P4.2a"
          && previousRetiredMembershipIdentities.has(
            String(entry?.retiredMembershipIdentity || ""),
          )
          && String(entry?.callerPath || "")
          && String(entry?.callerBindingIdentity || "")
          && String(entry?.actionModulePath || "")
          && String(entry?.actionExportName || "")
          && Number.isInteger(Number(entry?.targetArgumentIndex))
          && Number.isInteger(Number(entry?.occurrenceIndex))
          && Number(entry?.occurrenceIndex) >= 0
          && /^[0-9a-f]{64}$/i.test(
            String(entry?.sourceFingerprint || ""),
          ),
      );
    if (
      !backfillAllowed
      || !seedCoverageValid
      || !seedProvenanceValid
    ) {
      const error = new Error(
        "Caller-to-action ledger bootstrap seed is invalid.",
      );
      error.code = "caller-action-ledger-bootstrap-seed-invalid";
      throw error;
    }
  }
  if (
    previousRetiredMembershipIdentities.size > 0
    && previousEntries.length === 0
    && !backfillAllowed
  ) {
    const error = new Error(
      "Caller-to-action ledger backfill is permitted only at P4.2a.",
    );
    error.code = "caller-action-ledger-backfill-invalid";
    throw error;
  }

  const entriesByRetiredIdentity = new Map(
    previousEntries.map((entry) => [
      entry.retiredMembershipIdentity,
      entry,
    ]),
  );
  const normalizedEdges =
    normalizeStateActionDelegations(actionDelegations);
  const actionMembershipIndex = buildActionMembershipIndex(writers);
  const previousPhase = String(
    previousPolicy?.progress?.latestPhase || "",
  );
  const missingProofs = [];
  for (const entry of entriesByRetiredIdentity.values()) {
    const retiredMembership =
      parseLegacyMembershipSemanticSignature(
        entry.retiredMembershipIdentity,
      );
    if (!retiredMembership) {
      missingProofs.push({
        code: "caller-action-ledger-entry-invalid",
        retiredMembershipIdentity:
          entry.retiredMembershipIdentity,
        reason: "retired-membership-identity-invalid",
      });
      continue;
    }
    const crossFileMigration =
      findStateActionCrossFileMigrationContractEntry(
        entry.retiredMembershipIdentity,
        crossFileMigrationContract,
      ) || null;
    if (
      crossFileMigration
      && entry.crossFileMigrationContractIdentity
        !== crossFileMigration.contractIdentity
    ) {
      const candidateEdges = normalizedEdges.filter((edge) => (
        edge.callerPath
          === crossFileMigration.replacementCallerPath
        && edge.callerBindingIdentity
          === crossFileMigration.replacementCallerBindingIdentity
        && edge.enclosingFunctionIdentity
          === crossFileMigration.replacementEnclosingFunctionIdentity
        && edge.actionModulePath
          === crossFileMigration.actionModulePath
        && edge.actionExportName
          === crossFileMigration.actionExportName
        && edge.targetArgumentIndex
          === crossFileMigration.targetArgumentIndex
        && edge.sourceFingerprint
          === crossFileMigration.replacementActionSourceFingerprint
      ));
      const retiredMutationEvidence = buildRetiredMutationEvidence({
        previousPolicy,
        retiredMembership,
        candidateEdges,
        crossFileMigration,
      });
      const successorResolution = candidateEdges.length === 1
        ? resolveActionSuccessorProofs({
          edge: candidateEdges[0],
          retiredMembership,
          writers,
          normalizedEdges,
          actionMembershipIndex,
        })
        : null;
      if (
        retiredMutationEvidence.error
        || candidateEdges.length !== 1
        || successorResolution?.error
      ) {
        missingProofs.push({
          code: "legacy-membership-retirement-replacement-missing",
          retiredMembershipIdentity: entry.retiredMembershipIdentity,
          reason: retiredMutationEvidence.error
            || successorResolution?.error
            || (candidateEdges.length === 0
              ? "explicit-cross-file-action-edge-missing"
              : "explicit-cross-file-action-edge-ambiguous"),
          successorActionCallEdgeIdentities: candidateEdges
            .map(({ actionCallEdgeIdentity }) => actionCallEdgeIdentity)
            .sort(),
        });
        continue;
      }
      entriesByRetiredIdentity.set(
        entry.retiredMembershipIdentity,
        buildCallerToActionLedgerEntry({
          retiredMembership,
          retiredMutationEvidence,
          edge: candidateEdges[0],
          crossFileMigration,
          retiredInPhase: entry.retiredInPhase || previousPhase,
          recordedInPhase: entry.recordedInPhase || normalizedPhase,
          backfilled: entry.backfilled,
          successorActionProofs:
            successorResolution.successorActionProofs,
          successorProofContractIdentity:
            successorResolution.successorProofContractIdentity,
        }),
      );
      continue;
    }
    for (const proof of callerToActionEntryProofs(entry)) {
      const observed = normalizedEdges.find(
        (edge) =>
          (
            edge.actionCallEdgeIdentity
              === proof.actionCallEdgeIdentity
            || edge.legacyActionCallEdgeIdentity
              === proof.actionCallEdgeIdentity
          )
          && edge.callerPath === proof.callerPath
          && edge.callerBindingIdentity
            === proof.callerBindingIdentity
          && edge.actionModulePath === proof.actionModulePath
          && edge.actionExportName === proof.actionExportName
          && edge.targetArgumentIndex
            === proof.targetArgumentIndex
          && (
            !proof.enclosingFunctionIdentity
            || edge.enclosingFunctionIdentity
              === proof.enclosingFunctionIdentity
          ),
      );
      let liveEdge = observed || null;
      let successorResolution = liveEdge
        ? resolveActionSuccessorProofs({
          edge: liveEdge,
          retiredMembership,
          writers,
          normalizedEdges,
          actionMembershipIndex,
        })
        : null;
      if (successorResolution?.error) liveEdge = null;
      if (!liveEdge && entry.crossFileMigrationContractIdentity) {
        missingProofs.push({
          code: "legacy-membership-retirement-replacement-missing",
          retiredMembershipIdentity:
            entry.retiredMembershipIdentity,
          actionCallEdgeIdentity: proof.actionCallEdgeIdentity,
          reason: "explicit-cross-file-action-edge-stale",
        });
        continue;
      }
      if (!liveEdge) {
        const successorEdges = normalizedEdges.filter((edge) =>
          edge.callerPath === proof.callerPath
          && edge.callerBindingIdentity
            === proof.callerBindingIdentity
          && (
            proof.enclosingFunctionIdentity
              ? edge.enclosingFunctionIdentity
                === proof.enclosingFunctionIdentity
              : !edge.enclosingFunctionIdentity
          )
        ).map((edge) => ({
          edge,
          resolution: resolveActionSuccessorProofs({
            edge,
            retiredMembership,
            writers,
            normalizedEdges,
            actionMembershipIndex,
          }),
        })).filter(({ resolution }) => !resolution.error);
        const successorActionIdentities = new Set(
          successorEdges.map(({ edge }) => [
            edge.actionModulePath,
            edge.actionExportName,
            edge.targetArgumentIndex,
          ].join("#")),
        );
        const hasOneSuccessorAction =
          successorEdges.length > 0
          && successorActionIdentities.size === 1;
        if (!hasOneSuccessorAction) {
          missingProofs.push({
            code: "legacy-membership-retirement-replacement-missing",
            retiredMembershipIdentity:
              entry.retiredMembershipIdentity,
            actionCallEdgeIdentity: proof.actionCallEdgeIdentity,
            reason: successorEdges.length === 0
              ? "caller-action-successor-edge-missing"
              : "caller-action-successor-edge-ambiguous",
            successorActionCallEdgeIdentities:
              successorEdges.map(
                ({ edge }) =>
                  edge.actionCallEdgeIdentity,
              ).sort(),
          });
          continue;
        }
        // Repeated calls to one registered action still prove one authority
        // boundary. normalizedEdges is source-stable, so the proof keeps the
        // first exact call site while distinct action owners remain ambiguous.
        liveEdge = successorEdges[0].edge;
        successorResolution = successorEdges[0].resolution;
      }
      const refreshLiveObservation =
        previousPhase !== normalizedPhase
        || String(entry?.recordedInPhase || "") === normalizedPhase;
      if (refreshLiveObservation) {
        Object.assign(proof, {
          callerBindingId: liveEdge.callerBindingId,
          actionModulePath: liveEdge.actionModulePath,
          actionExportName: liveEdge.actionExportName,
          targetArgumentIndex: liveEdge.targetArgumentIndex,
          actionCallEdgeIdentity: liveEdge.actionCallEdgeIdentity,
          occurrenceIndex: liveEdge.occurrenceIndex,
          start: liveEdge.start,
          end: liveEdge.end,
          line: liveEdge.line,
          column: liveEdge.column,
          sourceFingerprint: liveEdge.sourceFingerprint,
          ...(successorResolution.successorActionProofs.length
            ? {
              successorActionProofs:
                successorResolution.successorActionProofs,
              successorProofContractIdentity:
                successorResolution.successorProofContractIdentity,
            }
            : {}),
        });
        if (!successorResolution.successorActionProofs.length) {
          delete proof.successorActionProofs;
          delete proof.successorProofContractIdentity;
        }
      }
    }
  }
  for (const retiredMembershipIdentity of retiredMembershipIdentities) {
    if (entriesByRetiredIdentity.has(retiredMembershipIdentity)) {
      continue;
    }
    const retiredMembership =
      parseLegacyMembershipSemanticSignature(
        retiredMembershipIdentity,
      );
    if (!retiredMembership) {
      missingProofs.push({
        code: "caller-action-ledger-entry-invalid",
        retiredMembershipIdentity,
      });
      continue;
    }
    const crossFileMigration =
      findStateActionCrossFileMigrationContractEntry(
        retiredMembershipIdentity,
        crossFileMigrationContract,
      ) || null;
    const bootstrapSeed =
      bootstrapSeedByRetiredIdentity.get(
        retiredMembershipIdentity,
      ) || null;
    const candidateEdges = normalizedEdges.filter((edge) => {
      if (crossFileMigration) {
        if (
          edge.callerPath
            !== crossFileMigration.replacementCallerPath
          || edge.callerBindingIdentity
            !== crossFileMigration.replacementCallerBindingIdentity
          || edge.enclosingFunctionIdentity
            !== crossFileMigration
              .replacementEnclosingFunctionIdentity
          || edge.actionModulePath
            !== crossFileMigration.actionModulePath
          || edge.actionExportName
            !== crossFileMigration.actionExportName
          || edge.targetArgumentIndex
            !== crossFileMigration.targetArgumentIndex
          || edge.sourceFingerprint
            !== crossFileMigration
              .replacementActionSourceFingerprint
        ) {
          return false;
        }
      } else if (bootstrapSeed) {
        if (
          edge.callerPath !== bootstrapSeed.callerPath
          || edge.callerBindingIdentity
            !== bootstrapSeed.callerBindingIdentity
          || edge.actionModulePath
            !== bootstrapSeed.actionModulePath
          || edge.actionExportName
            !== bootstrapSeed.actionExportName
          || edge.targetArgumentIndex
            !== Number(bootstrapSeed.targetArgumentIndex)
          || edge.sourceFingerprint
            !== bootstrapSeed.sourceFingerprint
          || edge.legacyOccurrenceIndex
            !== Number(bootstrapSeed.occurrenceIndex)
        ) {
          return false;
        }
      } else if (
        edge.callerPath !== retiredMembership.callerPath
        || edge.callerBindingIdentity
          !== retiredMembership.callerBindingIdentity
      ) {
        return false;
      }
      return true;
    });
    const resolvedCandidates = candidateEdges.map((edge) => ({
      edge,
      resolution: resolveActionSuccessorProofs({
        edge,
        retiredMembership,
        writers,
        normalizedEdges,
        actionMembershipIndex,
      }),
    })).filter(({ resolution }) => !resolution.error);
    let retiredMutationEvidence = buildRetiredMutationEvidence({
      previousPolicy,
      retiredMembership,
      candidateEdges: resolvedCandidates.map(({ edge }) => edge),
      crossFileMigration,
    });
    if (
      bootstrapSeed
      && retiredMutationEvidence.error
      && resolvedCandidates.length === 1
      && resolvedCandidates[0].edge.enclosingFunctionIdentity
    ) {
      retiredMutationEvidence = {
        enclosingFunctionIdentity:
          resolvedCandidates[0].edge.enclosingFunctionIdentity,
        siteFingerprint: createHash("sha256")
          .update(
            [
              retiredMembership.signature,
          resolvedCandidates[0].edge.enclosingFunctionIdentity,
              "historical-bootstrap",
            ].join("|"),
          )
          .digest("hex"),
        siteCount: 1,
        proofPrecision: "historical-backfill",
      };
    }
    const functionProofs = retiredMutationEvidence.functionEvidences
      ?.map((functionEvidence) => {
        const resolved = resolvedCandidates.find(
          ({ edge: candidate }) =>
            candidate.enclosingFunctionIdentity
              === functionEvidence.enclosingFunctionIdentity,
        );
        const edge = resolved?.edge;
        return edge
          ? buildCallerToActionFunctionProof({
            retiredMutationEvidence: functionEvidence,
            edge,
            successorActionProofs:
              resolved.resolution.successorActionProofs,
            successorProofContractIdentity:
              resolved.resolution.successorProofContractIdentity,
          })
          : null;
      });
    const missingFunctionEvidence =
      retiredMutationEvidence.functionEvidences?.find(
        (_, index) => !functionProofs[index],
      ) || null;
    const candidate = retiredMutationEvidence.error
      || retiredMutationEvidence.functionEvidences
      ? null
      : crossFileMigration
        ? resolvedCandidates[0]?.edge
        : resolvedCandidates.find(
          ({ edge }) =>
            edge.enclosingFunctionIdentity
            === retiredMutationEvidence.enclosingFunctionIdentity,
        )?.edge;
    if (
      retiredMutationEvidence.error
      || missingFunctionEvidence
      || (!retiredMutationEvidence.functionEvidences && !candidate)
    ) {
      missingProofs.push({
        code: "legacy-membership-retirement-replacement-missing",
        path: retiredMembership.callerPath,
        bindingIdentity: retiredMembership.callerBindingIdentity,
        domain: retiredMembership.domain,
        migrationPhase: retiredMembership.migrationPhase,
        operation: retiredMembership.operation,
        key: retiredMembership.key,
        reason:
          retiredMutationEvidence.error
          || "matching-enclosing-function-action-edge-missing",
        ...(missingFunctionEvidence
          ? {
            enclosingFunctionIdentity:
              missingFunctionEvidence.enclosingFunctionIdentity,
          }
          : {}),
      });
      continue;
    }
    const backfilled =
      previousRetiredMembershipIdentities.has(
        retiredMembershipIdentity,
      );
    const provenance = {
      retiredInPhase: backfilled
        ? previousPolicy.progress.latestPhase
        : normalizedPhase,
      recordedInPhase: normalizedPhase,
      backfilled,
    };
    entriesByRetiredIdentity.set(
      retiredMembershipIdentity,
      retiredMutationEvidence.functionEvidences
        ? buildMultiFunctionCallerToActionLedgerEntry({
          retiredMembership,
          retiredMutationEvidence,
          functionProofs,
          ...provenance,
        })
        : buildCallerToActionLedgerEntry({
          retiredMembership,
          retiredMutationEvidence,
          edge: candidate,
          crossFileMigration,
          successorActionProofs:
            resolvedCandidates.find(({ edge }) => edge === candidate)
              ?.resolution.successorActionProofs || [],
          successorProofContractIdentity:
            resolvedCandidates.find(({ edge }) => edge === candidate)
              ?.resolution.successorProofContractIdentity || "",
          ...provenance,
        }),
    );
  }
  for (const previousIdentity of entriesByRetiredIdentity.keys()) {
    if (!retiredMembershipIdentities.includes(previousIdentity)) {
      missingProofs.push({
        code: "caller-action-ledger-entry-invalid",
        retiredMembershipIdentity: previousIdentity,
        reason: "entry-not-retired",
      });
    }
  }
  if (missingProofs.length) {
    const error = new Error(
      `Caller-to-action proof generation failed for ${missingProofs.length} retired memberships.`,
    );
    error.code = "caller-action-ledger-proof-missing";
    error.violations = missingProofs;
    throw error;
  }
  const entries = [...entriesByRetiredIdentity.values()].sort(
      (left, right) =>
        left.retiredMembershipIdentity.localeCompare(
          right.retiredMembershipIdentity,
        )
        || callerToActionEntrySortEdgeIdentity(left).localeCompare(
          callerToActionEntrySortEdgeIdentity(right),
        ),
    );
  return {
    schemaVersion:
      Number(previousLedger?.schemaVersion) === 3
      || entries.some((entry) =>
        Array.isArray(entry.successorActionProofs)
        || entry.functionProofs?.some((proof) =>
          Array.isArray(proof.successorActionProofs)
        )
      )
        ? 3
        : Number(previousLedger?.schemaVersion) === 2
      || entries.some((entry) =>
        Array.isArray(entry.functionProofs)
        || entry.proofPrecision
          === "explicit-cross-file-multi-function"
      )
          ? 2
          : 1,
    entries,
  };
}

export function extractP42aCallerToActionBootstrapSeed({
  previousPolicy = null,
  transitionPolicy = null,
} = {}) {
  const previousRetiredMembershipIdentities = new Set(
    previousPolicy?.progress?.retiredLegacySemanticAuthority
      ?.memberships || [],
  );
  if (
    previousPolicy?.progress?.latestPhase !== "P4.1"
    || previousPolicy?.progress?.callerToActionLedger
    || previousRetiredMembershipIdentities.size === 0
    || Number(transitionPolicy?.schemaVersion) !== 1
    || transitionPolicy?.progress?.latestPhase !== "P4.2a"
  ) {
    const error = new Error(
      "P4.2a caller-to-action ledger transition is invalid.",
    );
    error.code = "caller-action-ledger-transition-invalid";
    throw error;
  }
  const entries = (
    transitionPolicy?.progress?.callerToActionLedger?.entries || []
  )
    .filter(
      (entry) =>
        entry?.backfilled === true
        && entry?.retiredInPhase === "P4.1"
        && entry?.recordedInPhase === "P4.2a"
        && previousRetiredMembershipIdentities.has(
          String(entry?.retiredMembershipIdentity || ""),
        ),
    )
    .map(cloneJsonValue)
    .sort(
      (left, right) =>
        left.retiredMembershipIdentity.localeCompare(
          right.retiredMembershipIdentity,
        )
        || left.actionCallEdgeIdentity.localeCompare(
          right.actionCallEdgeIdentity,
        ),
    );
  const seedIdentities = new Set(
    entries.map(({ retiredMembershipIdentity }) =>
      retiredMembershipIdentity
    ),
  );
  if (
    entries.length !== seedIdentities.size
    || seedIdentities.size
      !== previousRetiredMembershipIdentities.size
    || [...previousRetiredMembershipIdentities].some(
      (identity) => !seedIdentities.has(identity),
    )
  ) {
    const error = new Error(
      "P4.2a caller-to-action ledger transition lacks exact P4.1 coverage.",
    );
    error.code =
      "caller-action-ledger-transition-coverage-invalid";
    throw error;
  }
  return entries;
}

export function validateLegacyMembershipRetirementReplacements({
  previousWriters = [],
  writers = [],
  callerToActionLedger = null,
} = {}) {
  const previousRecords = collectMembershipRecords(previousWriters, {
    authorities: LEGACY_BINDING_AUTHORITIES,
  });
  const currentRecords = collectMembershipRecords(writers, {
    authorities: LEGACY_BINDING_AUTHORITIES,
  });
  const currentCounts = signatureCounts(
    currentRecords.map(({ signature }) => signature),
  );
  const ledgerByRetiredMembershipIdentity = new Map(
    (callerToActionLedger?.entries || []).map((entry) => [
      entry.retiredMembershipIdentity,
      entry,
    ]),
  );
  const actionMembershipIndex = buildActionMembershipIndex(writers);
  const violations = [];
  for (const record of previousRecords) {
    const activeCount = currentCounts.get(record.signature) || 0;
    if (activeCount > 0) {
      currentCounts.set(record.signature, activeCount - 1);
      continue;
    }
    const proof = ledgerByRetiredMembershipIdentity.get(
      record.signature,
    );
    const functionProofs = proof
      ? callerToActionEntryProofs(proof)
      : [];
    const proofRetiredCallerPath = String(
      proof?.retiredCallerPath
        || functionProofs[0]?.callerPath
        || "",
    );
    const proofRetiredCallerBindingIdentity = String(
      proof?.retiredCallerBindingIdentity
        || functionProofs[0]?.callerBindingIdentity
        || "",
    );
    const expectedCallerBindingIdentity =
      stableLegacyBindingIdentity(
        previousWriters
          .find(({ path: writerPath }) => writerPath === record.path)
          ?.bindings?.find(({ id }) => id === record.bindingId),
      );
    const explicitCrossFileCaller = Boolean(
      !Array.isArray(proof?.functionProofs)
      && (
      proof?.retiredCallerPath
      || proof?.retiredCallerBindingIdentity
      )
    );
    const functionProofsValid =
      functionProofs.length > 0
      && functionProofs.every((functionProof) => {
        const successorContract =
          findStateActionSuccessorProofContractEntry(
            functionProof.actionModulePath,
            functionProof.actionExportName,
            record.replacementKey,
          );
        const authorityProofs = Array.isArray(
          functionProof.successorActionProofs,
        ) ? functionProof.successorActionProofs : [functionProof];
        const authorityValid = authorityProofs.every((authorityProof) => {
          const requiredMembership = authorityProof.terminalMembership
            || record.replacementKey;
          return successorContract
            ? actionBindingOwnsExactMembership(
              findActionTargetBinding(
                writers,
                authorityProof.actionModulePath,
                authorityProof.actionExportName,
              ),
              requiredMembership,
            )
            : actionMembershipIndex.get(
              `${authorityProof.actionModulePath}#${authorityProof.actionExportName}`,
            )?.has(requiredMembership);
        });
        const directMembershipsValid = !successorContract
          || successorContract.requiredDirectMemberships.every(
            (membership) => actionBindingOwnsExactMembership(
              findActionTargetBinding(
                writers,
                functionProof.actionModulePath,
                functionProof.actionExportName,
              ),
              membership,
            ),
          );
        return authorityValid
        && directMembershipsValid
        && (
          explicitCrossFileCaller
          || (
            functionProof.callerPath === record.path
            && functionProof.callerBindingIdentity
              === expectedCallerBindingIdentity
          )
        );
      });
    if (
      !proof
      || proofRetiredCallerPath !== record.path
      || proofRetiredCallerBindingIdentity
        !== expectedCallerBindingIdentity
      || [
        proof.domain,
        proof.migrationPhase,
        proof.operation,
        proof.key,
      ].join("|") !== record.replacementKey
      || !functionProofsValid
    ) {
      violations.push({
        code: "legacy-membership-retirement-replacement-missing",
        path: record.path,
        bindingId: record.bindingId,
        domain: record.domain,
        migrationPhase: record.migrationPhase,
        operation: record.operation,
        key: record.key,
      });
    }
  }
  return violations;
}

const PROGRESSION_METRICS = Object.freeze([
  Object.freeze({
    key: "productionLegacyDirectFiles",
    violationCode: "legacy-direct-files-increased",
  }),
  Object.freeze({
    key: "productionLegacyMemberships",
    violationCode: "legacy-memberships-increased",
  }),
  Object.freeze({
    key: "productionLegacyDynamicSites",
    violationCode: "legacy-dynamic-sites-increased",
  }),
  Object.freeze({
    key: "productionLegacyAliasSites",
    violationCode: "legacy-alias-sites-increased",
  }),
  Object.freeze({
    key: "productionLegacyAmbiguousSites",
    violationCode: "legacy-ambiguous-sites-increased",
  }),
  Object.freeze({
    key: "productionLegacyUnsupportedSites",
    violationCode: "legacy-unsupported-sites-increased",
  }),
]);

function normalizeProgressionMetrics(metrics = {}) {
  return Object.fromEntries(
    PROGRESSION_METRICS.map(({ key }) => {
      return [key, metrics?.[key]];
    }),
  );
}

function validateProgressionMetricSet(metrics, scope) {
  const violations = [];
  for (const { key } of PROGRESSION_METRICS) {
    const value = metrics?.[key];
    if (
      typeof value !== "number"
      || !Number.isFinite(value)
      || !Number.isInteger(value)
      || value < 0
    ) {
      violations.push({
        code: "progress-metric-invalid",
        metric: key,
        scope,
        value: Number.isNaN(value) ? "NaN" : value,
      });
    }
  }
  return violations;
}

function validateProgressCheckpointAcceptedPolicyProvenance(
  checkpoint,
  phase,
) {
  const sourceSha = checkpoint?.previousAcceptedSourceSha;
  const policyBlobSha256 =
    checkpoint?.previousAcceptedPolicyBlobSha256;
  if (sourceSha === undefined && policyBlobSha256 === undefined) {
    return [];
  }
  if (
    /^[0-9a-f]{40}$/.test(String(sourceSha || ""))
    && /^[0-9a-f]{64}$/.test(String(policyBlobSha256 || ""))
  ) {
    return [];
  }
  return [{
    code: "progress-accepted-policy-checkpoint-invalid",
    phase,
  }];
}

function latestProgressCheckpoint(policy = {}) {
  const checkpoints = Array.isArray(policy?.progress?.checkpoints)
    ? policy.progress.checkpoints
    : [];
  const latestPhase = String(policy?.progress?.latestPhase || "").trim();
  return checkpoints.find((checkpoint) => checkpoint?.phase === latestPhase)
    || [...checkpoints].sort((left, right) =>
      compareP4StateActionPhases(right.phase, left.phase)
    )[0]
    || null;
}

export function validateStateWriterPolicyProgression({
  previousPolicy = null,
  phase = "P4.0",
  currentMetrics = {},
} = {}) {
  const normalizedPhase = normalizeP4StateActionPhase(phase);
  const violations = [
    ...validateProgressionMetricSet(currentMetrics, "current"),
  ];
  if (!previousPolicy) {
    return {
      verdict: violations.length ? "fail" : "pass",
      phase: normalizedPhase,
      previousPhase: "",
      violations,
    };
  }

  const progress = previousPolicy?.progress;
  if (
    !progress
    || !Array.isArray(progress.checkpoints)
    || !progress.checkpoints.length
  ) {
    return {
      verdict: "fail",
      phase: normalizedPhase,
      previousPhase: "",
      violations: [
        ...violations,
        {
          code: "progress-contract-missing",
          phase: normalizedPhase,
        },
      ],
    };
  }

  const previousPhase = normalizeP4StateActionPhase(progress.latestPhase);
  const seenPhases = new Set();
  let priorCheckpoint = null;
  for (const checkpoint of progress.checkpoints) {
    const checkpointPhase = normalizeP4StateActionPhase(checkpoint?.phase);
    const checkpointMetricViolations = validateProgressionMetricSet(
      checkpoint,
      `checkpoint:${checkpointPhase}`,
    );
    violations.push(...checkpointMetricViolations);
    violations.push(
      ...validateProgressCheckpointAcceptedPolicyProvenance(
        checkpoint,
        checkpointPhase,
      ),
    );
    if (seenPhases.has(checkpointPhase)) {
      violations.push({
        code: "duplicate-progress-checkpoint",
        phase: checkpointPhase,
      });
      continue;
    }
    seenPhases.add(checkpointPhase);
    if (
      priorCheckpoint
      && compareP4StateActionPhases(
        checkpointPhase,
        priorCheckpoint.phase,
      ) <= 0
    ) {
      violations.push({
        code: "progress-checkpoint-order-invalid",
        previousPhase: priorCheckpoint.phase,
        phase: checkpointPhase,
      });
    }
    if (
      priorCheckpoint
      && !validateProgressionMetricSet(
        priorCheckpoint,
        `checkpoint:${priorCheckpoint.phase}`,
      ).length
      && !checkpointMetricViolations.length
    ) {
      for (const { key } of PROGRESSION_METRICS) {
        const previous = priorCheckpoint[key];
        const current = checkpoint[key];
        if (current > previous) {
          violations.push({
            code: "progress-checkpoint-metric-increased",
            metric: key,
            previous,
            current,
            previousPhase: priorCheckpoint.phase,
            phase: checkpointPhase,
          });
        }
      }
    }
    priorCheckpoint = checkpoint;
  }
  if (!seenPhases.has(previousPhase)) {
    violations.push({
      code: "progress-latest-checkpoint-missing",
      phase: previousPhase,
    });
  }
  if (compareP4StateActionPhases(normalizedPhase, previousPhase) < 0) {
    violations.push({
      code: "phase-regression",
      previousPhase,
      phase: normalizedPhase,
    });
  } else {
    const previousCheckpoint = latestProgressCheckpoint(previousPolicy);
    if (
      previousCheckpoint
      && !validateProgressionMetricSet(
        previousCheckpoint,
        `checkpoint:${previousCheckpoint.phase}`,
      ).length
      && !validateProgressionMetricSet(currentMetrics, "current").length
    ) {
      const normalizedCurrentMetrics = normalizeProgressionMetrics(
        currentMetrics,
      );
      for (const { key, violationCode } of PROGRESSION_METRICS) {
        const previous = previousCheckpoint[key];
        const current = normalizedCurrentMetrics[key];
        if (current > previous) {
          violations.push({
            code: violationCode,
            metric: key,
            previous,
            current,
            previousPhase,
            phase: normalizedPhase,
          });
        }
      }
    }
  }
  return {
    verdict: violations.length ? "fail" : "pass",
    phase: normalizedPhase,
    previousPhase,
    violations,
  };
}

function createProgressCheckpoint(phase, {
  productionLegacyDirectFiles,
  productionLegacyMemberships,
  productionLegacyDynamicSites,
  productionLegacyAliasSites,
  productionLegacyAmbiguousSites,
  productionLegacyUnsupportedSites,
}, acceptedPolicyCheckpoint = null) {
  const metrics = {
    productionLegacyDirectFiles,
    productionLegacyMemberships,
    productionLegacyDynamicSites,
    productionLegacyAliasSites,
    productionLegacyAmbiguousSites,
    productionLegacyUnsupportedSites,
  };
  const violations = validateProgressionMetricSet(metrics, "checkpoint");
  if (violations.length) {
    const error = new Error(
      `Invalid state writer progress checkpoint: ${
        violations.map(({ metric }) => metric).join(", ")
      }`,
    );
    error.code = "progress-metric-invalid";
    error.violations = violations;
    throw error;
  }
  const checkpoint = {
    phase: normalizeP4StateActionPhase(phase),
    ...normalizeProgressionMetrics(metrics),
  };
  if (acceptedPolicyCheckpoint) {
    const previousAcceptedSourceSha = String(
      acceptedPolicyCheckpoint.sourceSha || "",
    ).trim().toLowerCase();
    const previousAcceptedPolicyBlobSha256 = String(
      acceptedPolicyCheckpoint.policyBlobSha256 || "",
    ).trim().toLowerCase();
    if (
      !/^[0-9a-f]{40}$/.test(previousAcceptedSourceSha)
      || !/^[0-9a-f]{64}$/.test(
        previousAcceptedPolicyBlobSha256,
      )
    ) {
      const error = new Error(
        "Progress checkpoint requires exact accepted-policy provenance.",
      );
      error.code = "progress-accepted-policy-checkpoint-invalid";
      throw error;
    }
    checkpoint.previousAcceptedSourceSha = previousAcceptedSourceSha;
    checkpoint.previousAcceptedPolicyBlobSha256 =
      previousAcceptedPolicyBlobSha256;
  }
  return checkpoint;
}

export function buildProgressState({
  phase,
  currentMetrics,
  previousPolicy,
  refreshP4Baseline,
  retiredLegacySemanticAuthority,
  callerToActionLedger,
  acceptedPolicyCheckpoint = null,
}) {
  const checkpoint = createProgressCheckpoint(
    phase,
    currentMetrics,
    acceptedPolicyCheckpoint,
  );
  const previousCheckpoints =
    previousPolicy && !refreshP4Baseline
      ? cloneJsonValue(previousPolicy?.progress?.checkpoints || [])
      : [];
  const checkpointsByPhase = new Map(
    previousCheckpoints.map((entry) => [entry.phase, entry]),
  );
  if (!checkpointsByPhase.has(checkpoint.phase)) {
    checkpointsByPhase.set(checkpoint.phase, checkpoint);
  }
  const progress = {
    latestPhase: checkpoint.phase,
    checkpoints: P4_STATE_ACTION_PHASES
      .filter((candidatePhase) => checkpointsByPhase.has(candidatePhase))
      .map((candidatePhase) => checkpointsByPhase.get(candidatePhase)),
    retiredLegacySemanticAuthority,
  };
  if (callerToActionLedger) {
    progress.callerToActionLedger = callerToActionLedger;
  }
  return progress;
}

function bindingIdPart(value) {
  return String(value || "")
    .replaceAll(/[^A-Za-z0-9_$.-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkJavaScriptFiles(rootDir) {
  if (!(await fileExists(rootDir))) {
    return [];
  }
  const results = [];
  const queue = [rootDir];
  while (queue.length) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        results.push(normalizeRelativePath(path.relative(PROJECT_ROOT, nextPath)));
      }
    }
  }
  return results.sort((left, right) => left.localeCompare(right));
}

export async function readLegacyStateWriterAllowlist() {
  const parsed = JSON.parse(await fs.readFile(LEGACY_ALLOWLIST_PATH, "utf8"));
  return stableUnique(Array.isArray(parsed?.files) ? parsed.files : []);
}

export async function readStateWriterPolicy() {
  return JSON.parse(await fs.readFile(STATE_WRITER_POLICY_PATH, "utf8"));
}

export function readStateWriterPolicyAtRevision(
  revision = "HEAD",
  {
    runGit = (args) =>
      execFileSync("git", args, {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      }),
  } = {},
) {
  const normalizedRevision =
    String(revision || "HEAD").trim() || "HEAD";
  try {
    return JSON.parse(
      runGit([
        "show",
        `${normalizedRevision}:tools/state_writer_policy.json`,
      ]),
    );
  } catch (cause) {
    const error = new Error(
      `Unable to read state writer policy at ${normalizedRevision}.`,
      { cause },
    );
    error.code = "state-writer-policy-revision-read-failed";
    error.revision = normalizedRevision;
    throw error;
  }
}

function toScannerBinding(binding) {
  return {
    id: binding.id,
    kind: binding.kind,
    name: binding.name,
    functionName: binding.functionName || "",
    parameterName: binding.parameterName || "",
    parameterIndex: Number.isInteger(binding.parameterIndex)
      ? binding.parameterIndex
      : null,
    parameterPath: binding.parameterPath || "",
    importSource: binding.importSource || "",
    importedName: binding.importedName || "",
    aliasSources: binding.aliasSources || [],
    aliasOperators: binding.aliasOperators || [],
    locator: binding.locator || null,
  };
}

function createModuleBinding(importBinding) {
  return {
    id: `module:${bindingIdPart(importBinding.localName)}`,
    kind: "module",
    name: importBinding.localName,
    importSource: importBinding.importSource,
    importedName: importBinding.importedName,
  };
}

function createParameterBinding(candidate) {
  const parameterPath = String(candidate.parameterPath || "$");
  const parameterPathHash = createHash("sha256")
    .update(parameterPath)
    .digest("hex")
    .slice(0, 12);
  return {
    id: [
      "parameter",
      bindingIdPart(candidate.functionName),
      Number(candidate.parameterIndex || 0),
      parameterPathHash,
      Number(candidate.line || 0),
      Number(candidate.column || 0),
    ].join(":"),
    kind: "function-parameter",
    name: candidate.parameterName,
    functionName: candidate.functionName,
    parameterName: candidate.parameterName,
    parameterIndex: Number(candidate.parameterIndex || 0),
    parameterPath,
    locator: {
      line: candidate.line,
      column: candidate.column,
    },
  };
}

function createTestRootBinding(rootName) {
  return {
    id: `test-file-root:${rootName}`,
    kind: "test-file-root",
    name: rootName,
  };
}

function bindingSignature(binding) {
  if (binding.kind === "function-parameter") {
    return [
      binding.kind,
      binding.functionName || "",
      Number(binding.parameterIndex || 0),
      binding.parameterPath || "$",
      Number(binding.locator?.line || 0),
      Number(binding.locator?.column || 0),
    ].join("|");
  }
  return [
    binding.kind,
    binding.name,
    binding.functionName || "",
    binding.parameterName || "",
    Number(binding.parameterIndex || 0),
    Number(binding.locator?.line || 0),
    Number(binding.locator?.column || 0),
    ...(binding.aliasSources || []),
    ...(binding.aliasOperators || []),
  ].join("|");
}

function dedupeBindings(bindings) {
  const seen = new Set();
  const results = [];
  for (const binding of bindings) {
    const signature = bindingSignature(binding);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    results.push(binding);
  }
  return results.sort((left, right) => left.id.localeCompare(right.id));
}

export async function discoverCandidatePaths(legacyAllowlistPaths) {
  return stableUnique([
    ...legacyAllowlistPaths,
    ...(await walkJavaScriptFiles(PRODUCTION_JS_ROOT)),
  ]);
}

function isTestPath(relativePath) {
  return normalizeRelativePath(relativePath).startsWith("tests/");
}

function isActionPath(relativePath) {
  return normalizeRelativePath(relativePath).startsWith("js/core/state/actions/");
}

function isCompatFacadePath(relativePath) {
  return normalizeRelativePath(relativePath) === "js/core/state/index.js";
}

function borrowedMapStorageArgumentSites(relativePath, source, entry) {
  const contract = STATE_ACTION_BORROWED_MAP_STORAGE_CONTRACT.find(candidate =>
    candidate.modulePath === relativePath && candidate.exportName === entry.exportName);
  if (!contract) return new Set();
  const normalized = normalizeJavaScriptSource(source);
  if (createHash("sha256").update(normalized).digest("hex") !== contract.moduleSourceFingerprint) return new Set();
  const ast = parseJavaScript(normalized, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const fn = ast.body.map(node => node.declaration).find(node => node?.id?.name === entry.exportName);
  if (!fn || createHash("sha256").update(normalized.slice(fn.start, fn.end).trim()).digest("hex") !== contract.sourceFingerprint) return new Set();
  const sites = new Set();
  astWalk.simple(fn.body, { CallExpression(node) {
    const method = node.callee;
    const receiver = method?.object;
    if (method?.type !== "MemberExpression" || method.computed || !["get", "set", "delete"].includes(method.property.name)
      || receiver?.type !== "MemberExpression" || receiver.computed || receiver.property.name !== contract.containerField
      || receiver.object?.type !== "Identifier" || receiver.object.name !== contract.targetParameterName) return;
    for (const argument of node.arguments) {
      if (argument.type === "Identifier") sites.add(`${argument.loc.start.line}:${argument.loc.start.column + 1}:${argument.name}`);
    }
  }});
  return sites;
}

export async function validateStateActionNonTargetParameterMutations(
  relativePath,
  source,
  contractEntries =
    getStateActionDelegationContractEntriesForModule(relativePath),
) {
  const discovery = discoverFunctionParameterBindings(
    source,
    { parameterNames: null },
  );
  if (discovery.diagnostics.length) {
    return [];
  }
  const violations = [];
  for (const entry of contractEntries || []) {
    const storageSites = borrowedMapStorageArgumentSites(relativePath, source, entry);
    for (
      const candidate of discovery.bindings.filter(
        ({ functionName }) => functionName === entry.exportName,
      )
    ) {
      if (
        candidate.parameterIndex === entry.targetArgumentIndex
        && candidate.parameterPath === "$"
      ) {
        continue;
      }
      const binding = createParameterBinding(candidate);
      const mutationFindings = scanBinding(
        source,
        relativePath,
        binding,
      );
      for (const finding of mutationFindings) {
        if (finding.reason === "state-alias-escape" && finding.evidenceKind === "unknown-call-argument"
          && storageSites.has(`${finding.line}:${finding.column}:${candidate.parameterName}`)) continue;
        const conservativeMutationEvidence = Boolean(
          !finding?.unsupported
          || finding.reason !== "state-alias-escape"
          || finding.evidenceKind === "unknown-call-argument",
        );
        if (!conservativeMutationEvidence) {
          continue;
        }
        violations.push({
          code: "state-action-non-target-parameter-mutation",
          modulePath: normalizeRelativePath(relativePath),
          exportName: entry.exportName,
          parameterName: candidate.parameterName,
          parameterIndex: candidate.parameterIndex,
          parameterPath: candidate.parameterPath,
          operation: finding.operation,
          key: finding.key,
          unsupported: Boolean(finding.unsupported),
          reason: String(finding.reason || ""),
          evidenceKind: String(finding.evidenceKind || ""),
          alias: String(finding.alias || ""),
          aliasChain: (finding.aliasChain || []).map(String),
          line: finding.line,
          column: finding.column,
        });
      }
    }
  }
  return violations.sort(
    (left, right) =>
      left.exportName.localeCompare(right.exportName)
      || left.parameterIndex - right.parameterIndex
      || left.parameterPath.localeCompare(right.parameterPath)
      || left.line - right.line
      || left.column - right.column,
  );
}

function stateTargetPureReaderCandidateIdentity(candidate = {}) {
  return [
    String(candidate.functionName || ""),
    Number(candidate.parameterIndex),
    String(candidate.parameterPath || ""),
  ].join("|");
}

function buildStateDetachedCaptureCandidateIdentities({
  relativePath,
  source,
  allParameterDiscovery,
}) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const entries = STATE_DETACHED_CAPTURE_CONTRACT.filter(
    (entry) => normalizeRelativePath(entry.modulePath) === normalizedPath,
  );
  if (!entries.length) {
    return new Set();
  }
  const violations = [];
  const identities = new Set();
  for (const entry of entries) {
    violations.push(
      ...inspectStateDetachedCaptureSource(source, entry).violations,
    );
    const candidates = allParameterDiscovery.bindings.filter(
      (candidate) =>
        candidate.functionName === entry.exportName
        && candidate.parameterIndex === entry.targetArgumentIndex
        && candidate.parameterPath === "$",
    );
    if (candidates.length !== 1) {
      violations.push({
        code: "state-detached-capture-target-binding-missing",
        modulePath: normalizedPath,
        exportName: entry.exportName,
        targetArgumentIndex: entry.targetArgumentIndex,
        count: candidates.length,
      });
      continue;
    }
    identities.add(stateTargetPureReaderCandidateIdentity(candidates[0]));
  }
  if (violations.length) {
    const error = new Error(
      `State detached-capture contract violated: ${normalizedPath}`,
    );
    error.code = "state-detached-capture-contract-violation";
    error.violations = violations;
    throw error;
  }
  return identities;
}

function stateTargetPureReaderConservativeFindingIdentity(
  finding = {},
) {
  return [
    String(finding.enclosingFunctionIdentity || ""),
    String(finding.reason || ""),
    String(finding.operation || ""),
    String(finding.key || ""),
    String(finding.sourceFingerprint || ""),
  ].join("|");
}

function countStateTargetPureReaderConservativeFindings(
  findings = [],
) {
  const counts = new Map();
  for (
    const finding of
    Array.isArray(findings) ? findings : []
  ) {
    const identity =
      stateTargetPureReaderConservativeFindingIdentity(finding);
    counts.set(identity, (counts.get(identity) || 0) + 1);
  }
  return counts;
}

function filterStateTargetPureReaderModuleFindings({
  relativePath,
  binding,
  findings = [],
}) {
  if (binding?.kind !== "module") {
    return findings;
  }
  const contractEntries =
    getStateTargetPureReaderContractEntriesForModule(relativePath);
  if (!contractEntries.length) {
    return findings;
  }
  const remainingContractCounts = new Map();
  for (const entry of contractEntries) {
    for (const finding of entry.conservativeFindings) {
      const identity = [
        String(finding.enclosingFunctionIdentity || ""),
        String(finding.reason || ""),
        String(finding.operation || ""),
        String(finding.sourceFingerprint || ""),
      ].join("|");
      remainingContractCounts.set(
        identity,
        (remainingContractCounts.get(identity) || 0)
          + Number(finding.count),
      );
    }
  }
  return findings.filter((finding) => {
    const identity = [
      String(finding.enclosingFunctionIdentity || ""),
      String(finding.reason || ""),
      String(finding.operation || ""),
      String(finding.sourceFingerprint || ""),
    ].join("|");
    const remaining = remainingContractCounts.get(identity) || 0;
    if (remaining < 1) {
      return true;
    }
    remainingContractCounts.set(identity, remaining - 1);
    return false;
  });
}

export function applyStateWriterBindingFindingContracts({
  relativePath,
  binding,
  findings = [],
  enforceCurrentContracts = true,
} = {}) {
  return withoutRedundantContainerAliasEscapeFindings(
    enforceCurrentContracts
      ? filterStateTargetPureReaderModuleFindings({
        relativePath,
        binding,
        findings,
      })
      : findings,
  );
}

function validateStateTargetPureReaderBinding({
  relativePath,
  source,
  entry,
  candidate,
}) {
  const inspection = inspectStateTargetPureReaderFunctionSource(
    source,
    entry,
  );
  const violations = [...inspection.violations];
  if (!inspection.functionSource) {
    return violations;
  }
  const isolatedDiscovery = discoverFunctionParameterBindings(
    inspection.functionSource,
    { parameterNames: null },
  );
  const isolatedCandidates = isolatedDiscovery.bindings.filter(
    (isolatedCandidate) =>
      isolatedCandidate.functionName === entry.functionName
      && isolatedCandidate.parameterName === entry.targetParameterName
      && isolatedCandidate.parameterIndex === entry.targetParameterIndex
      && isolatedCandidate.parameterPath === entry.targetParameterPath,
  );
  if (isolatedCandidates.length !== 1) {
    violations.push({
      code: "state-target-pure-reader-target-binding-missing",
      modulePath: normalizeRelativePath(relativePath),
      functionName: entry.functionName,
      targetParameterName: entry.targetParameterName,
      targetParameterIndex: entry.targetParameterIndex,
      targetParameterPath: entry.targetParameterPath,
      count: isolatedCandidates.length,
    });
    return violations;
  }
  const isolatedBinding = createParameterBinding(isolatedCandidates[0]);
  const findings = scanStateMutationInventory(
    inspection.functionSource,
    {
      filePath: relativePath,
      bindings: [toScannerBinding(isolatedBinding)],
      derivedAliasTaintMode:
        DERIVED_ALIAS_TAINT_MODES.STRICT,
    },
  ).findings.map((finding) =>
    withStateWriterFindingSourceFingerprint(
      inspection.functionSource,
      finding,
    )
  );
  const observedConservativeFindings = [];
  for (const finding of findings) {
    if (
      finding?.unsupported
      && (finding.reason === "state-alias-escape"
        || (["unsupported-call-mutation", "ambiguous-alias-flow"].includes(finding.reason)
          && (entry.reviewedReadSiteFingerprints || []).includes(finding.sourceFingerprint)))
    ) {
      observedConservativeFindings.push(finding);
      continue;
    }
    violations.push({
      code: "state-target-pure-reader-mutation",
      modulePath: normalizeRelativePath(relativePath),
      functionName: entry.functionName,
      targetParameterName: entry.targetParameterName,
      operation: String(finding?.operation || ""),
      key: String(finding?.key || ""),
      reason: String(finding?.reason || ""),
      sourceFingerprint: String(finding?.sourceFingerprint || ""),
      line: Number(finding?.line || 0),
      column: Number(finding?.column || 0),
    });
  }
  const expectedCounts = new Map(
    entry.conservativeFindings.map((finding) => [
      stateTargetPureReaderConservativeFindingIdentity(finding),
      Number(finding.count),
    ]),
  );
  const observedCounts =
    countStateTargetPureReaderConservativeFindings(
      observedConservativeFindings,
    );
  for (const [identity, observedCount] of observedCounts) {
    const expectedCount = expectedCounts.get(identity) || 0;
    if (observedCount > expectedCount) {
      violations.push({
        code:
          "state-target-pure-reader-conservative-finding-unregistered",
        modulePath: normalizeRelativePath(relativePath),
        functionName: entry.functionName,
        targetParameterName: entry.targetParameterName,
        escapeIdentity: identity,
        expectedCount,
        observedCount,
      });
    }
  }
  for (const [identity, expectedCount] of expectedCounts) {
    const observedCount = observedCounts.get(identity) || 0;
    if (observedCount < expectedCount) {
      violations.push({
        code:
          "state-target-pure-reader-conservative-finding-missing",
        modulePath: normalizeRelativePath(relativePath),
        functionName: entry.functionName,
        targetParameterName: entry.targetParameterName,
        escapeIdentity: identity,
        expectedCount,
        observedCount,
      });
    }
  }
  if (
    candidate.functionName !== entry.functionName
    || candidate.parameterName !== entry.targetParameterName
    || candidate.parameterIndex !== entry.targetParameterIndex
    || candidate.parameterPath !== entry.targetParameterPath
  ) {
    violations.push({
      code: "state-target-pure-reader-target-binding-drift",
      modulePath: normalizeRelativePath(relativePath),
      functionName: entry.functionName,
      targetParameterName: entry.targetParameterName,
    });
  }
  return violations;
}

function buildStateTargetPureReaderCandidateIdentities({
  relativePath,
  source,
  allParameterDiscovery,
}) {
  const entries = getStateTargetPureReaderContractEntriesForModule(
    relativePath,
  );
  if (!entries.length) {
    return new Set();
  }
  const violations = [
    ...validateStateTargetPureReaderContract(
      STATE_TARGET_PURE_READER_CONTRACT,
    ),
  ];
  const identities = new Set();
  for (const entry of entries) {
    const candidates = allParameterDiscovery.bindings.filter(
      (candidate) =>
        candidate.functionName === entry.functionName
        && candidate.parameterName === entry.targetParameterName
        && candidate.parameterIndex === entry.targetParameterIndex
        && candidate.parameterPath === entry.targetParameterPath,
    );
    if (candidates.length !== 1) {
      violations.push({
        code: "state-target-pure-reader-target-binding-missing",
        modulePath: normalizeRelativePath(relativePath),
        functionName: entry.functionName,
        targetParameterName: entry.targetParameterName,
        targetParameterIndex: entry.targetParameterIndex,
        targetParameterPath: entry.targetParameterPath,
        count: candidates.length,
      });
      continue;
    }
    violations.push(
      ...validateStateTargetPureReaderBinding({
        relativePath,
        source,
        entry,
        candidate: candidates[0],
      }),
    );
    identities.add(
      stateTargetPureReaderCandidateIdentity(candidates[0]),
    );
  }
  if (violations.length) {
    const error = new Error(
      `State target pure-reader contract violated: ${relativePath}`,
    );
    error.code = "state-target-pure-reader-contract-violation";
    error.violations = violations;
    throw error;
  }
  return identities;
}

export async function discoverStateWriterBindingsForSource(
  relativePath,
  source,
  surface,
  {
    previousWriter = null,
    scanAllParameters = false,
    enforceCurrentContracts = true,
    derivedAliasTaintMode =
      DERIVED_ALIAS_TAINT_MODES.STRICT,
    scanner = scanStateMutationInventory,
    includeInventories = false,
  } = {},
) {
  if (enforceCurrentContracts) {
    for (const entry of STATE_TARGET_EFFECTFUL_DELEGATOR_CONTRACT.filter(entry => entry.modulePath === relativePath)) {
      validateEffectfulDelegatorSource(source, entry);
    }
    for (const entry of STATE_BORROWED_EFFECT_CONTRACT.filter(entry => entry.modulePath === relativePath)) {
      const { violations } = inspectStateBorrowedEffectSource(source, entry);
      if (violations.length) {
        const error = new Error(`Borrowed effect source proof failed: ${relativePath}`);
        error.code = "state-borrowed-effect-contract-violation";
        error.violations = violations;
        throw error;
      }
    }
  }
  const normalizedDerivedAliasTaintMode =
    normalizeDerivedAliasTaintMode(derivedAliasTaintMode);
  if (surface === "test") {
    const testBindings =
      ["state", "runtimeState", "appState"].map(createTestRootBinding);
    const bindingInventories =
      scanStateWriterBindingInventoriesBatch(
        source,
        relativePath,
        testBindings,
        normalizedDerivedAliasTaintMode,
        { scanner },
      );
    return includeInventories
      ? { bindings: testBindings, bindingInventories }
      : testBindings;
  }

  const bindings = discoverGlobalStateImportBindings(source, {
    filePath: relativePath,
  }).map(createModuleBinding);
  const discovery = discoverFunctionParameterBindings(source);
  if (discovery.diagnostics.length) {
    const diagnosticBindings = [{
      id: "syntax",
      kind: "module",
      name: "",
      discoveryDiagnostics: discovery.diagnostics,
    }];
    const bindingInventories =
      scanStateWriterBindingInventoriesBatch(
        source,
        relativePath,
        diagnosticBindings,
        normalizedDerivedAliasTaintMode,
        {
          scanner,
          recognizeCurrentContracts: enforceCurrentContracts,
        },
      );
    return includeInventories
      ? { bindings: diagnosticBindings, bindingInventories }
      : diagnosticBindings;
  }
  const allParameterDiscovery = discoverFunctionParameterBindings(
    source,
    { parameterNames: null },
  );
  const detachedCaptureCandidateIdentities = enforceCurrentContracts
    ? buildStateDetachedCaptureCandidateIdentities({
      relativePath,
      source,
      allParameterDiscovery,
    })
    : new Set();
  if (isActionPath(relativePath) && enforceCurrentContracts) {
    const nonTargetParameterMutationViolations =
      await validateStateActionNonTargetParameterMutations(
        relativePath,
        source,
      );
    if (nonTargetParameterMutationViolations.length) {
      const error = new Error(
        `State action mutates a non-target parameter: ${relativePath}`,
      );
      error.code = "state-action-non-target-parameter-mutation";
      error.violations = nonTargetParameterMutationViolations;
      throw error;
    }
    for (
      const entry of
      getStateActionDelegationContractEntriesForModule(relativePath)
    ) {
      const candidates = allParameterDiscovery.bindings.filter(
        (candidate) =>
          candidate.functionName === entry.exportName
          && candidate.parameterIndex === entry.targetArgumentIndex
          && candidate.parameterPath === "$",
      );
      if (candidates.length === 1) {
        bindings.push(createParameterBinding(candidates[0]));
      }
    }
    const actionBindings = dedupeBindings(bindings.filter((binding) => (
      binding.kind !== "function-parameter"
      || !detachedCaptureCandidateIdentities.has(
        stateTargetPureReaderCandidateIdentity(binding),
      )
    )));
    const bindingInventories =
      scanStateWriterBindingInventoriesBatch(
        source,
        relativePath,
        actionBindings,
        normalizedDerivedAliasTaintMode,
        {
          scanner,
          recognizeCurrentContracts: true,
        },
      );
    return includeInventories
      ? { bindings: actionBindings, bindingInventories }
      : actionBindings;
  }
  const pureReaderCandidateIdentities = enforceCurrentContracts
    ? buildStateTargetPureReaderCandidateIdentities({
      relativePath,
      source,
      allParameterDiscovery,
    })
    : new Set();
  for (const candidate of discovery.bindings) {
    if (
      pureReaderCandidateIdentities.has(
        stateTargetPureReaderCandidateIdentity(candidate),
      )
      || detachedCaptureCandidateIdentities.has(
        stateTargetPureReaderCandidateIdentity(candidate),
      )
    ) {
      continue;
    }
    const exclusionKey = [
      relativePath,
      candidate.functionName,
      candidate.parameterName,
    ].join("#");
    if (!EXCLUDED_PARAMETER_BINDINGS.has(exclusionKey)) {
      bindings.push(createParameterBinding(candidate));
    }
  }
  const canonicalAuthorityIndex =
    buildCanonicalStateKeyAuthorityIndex();
  const previousParameterIdentities = new Set(
    (previousWriter?.bindings || [])
      .filter((binding) => binding?.kind === "function-parameter")
      .map(
        (binding) =>
          [
            binding.functionName,
            Number(binding.parameterIndex || 0),
            binding.parameterPath || "$",
          ].join("|"),
      ),
  );
  const candidateBindings = [];
  for (const candidate of allParameterDiscovery.bindings) {
    if (
      pureReaderCandidateIdentities.has(
        stateTargetPureReaderCandidateIdentity(candidate),
      )
      || detachedCaptureCandidateIdentities.has(
        stateTargetPureReaderCandidateIdentity(candidate),
      )
    ) {
      continue;
    }
    const priorIdentity = [
      candidate.functionName,
      Number(candidate.parameterIndex || 0),
      candidate.parameterPath || "$",
    ].join("|");
    if (
      !scanAllParameters
      && !previousParameterIdentities.has(priorIdentity)
    ) {
      continue;
    }
    const exclusionKey = [
      relativePath,
      candidate.functionName,
      candidate.parameterName,
    ].join("#");
    if (EXCLUDED_PARAMETER_BINDINGS.has(exclusionKey)) {
      continue;
    }
    candidateBindings.push({
      binding: createParameterBinding(candidate),
      priorIdentity,
    });
  }
  const specialBindings =
    SPECIAL_BINDINGS_BY_PATH[relativePath] || [];
  const scannedBindings = dedupeBindings([
    ...bindings,
    ...candidateBindings.map(({ binding }) => binding),
    ...specialBindings,
  ]);
  const scannedBindingInventories =
    scanStateWriterBindingInventoriesBatch(
      source,
      relativePath,
      scannedBindings,
      normalizedDerivedAliasTaintMode,
      {
        scanner,
        recognizeCurrentContracts: enforceCurrentContracts,
      },
    ).map((inventory) => ({
      ...inventory,
      findings: applyStateWriterBindingFindingContracts({
        relativePath,
        binding: inventory.binding,
        findings: inventory.findings,
        enforceCurrentContracts,
      }),
    }));
  const inventoryByBindingId = new Map(
    scannedBindingInventories.map((inventory) => [
      inventory.binding.id,
      inventory,
    ]),
  );
  for (const { binding, priorIdentity } of candidateBindings) {
    const findings =
      inventoryByBindingId.get(binding.id)?.findings || [];
    const hasCanonicalStateMutation =
      hasCanonicalStateMutationFinding(
        findings,
        relativePath,
        canonicalAuthorityIndex,
      );
    const hasConservativeStateTargetEvidence = findings.some(
      (finding) => finding?.dynamic || finding?.unsupported,
    );
    if (
      hasCanonicalStateMutation
      || (
        previousParameterIdentities.has(priorIdentity)
        && hasConservativeStateTargetEvidence
      )
    ) {
      bindings.push(binding);
    }
  }
  bindings.push(...specialBindings);
  const selectedBindings = dedupeBindings(bindings);
  if (!includeInventories) {
    return selectedBindings;
  }
  return {
    bindings: selectedBindings,
    bindingInventories: selectedBindings.map(
      (binding) => inventoryByBindingId.get(binding.id),
    ),
  };
}

export function hasCanonicalStateMutationFinding(
  findings = [],
  relativePath = "",
  stateKeyAuthorityIndex = buildCanonicalStateKeyAuthorityIndex(),
) {
  return (Array.isArray(findings) ? findings : []).some((finding) => {
    if (
      finding?.unsupported
      || !finding?.key
      || finding.key === "*"
    ) {
      return false;
    }
    return !resolveStateWriterFindingAuthority(
      finding,
      relativePath,
      stateKeyAuthorityIndex,
    ).unknown;
  });
}

function buildBindingDiscoveryDiagnosticInventory(
  relativePath,
  binding,
) {
  return {
    findings: binding.discoveryDiagnostics.map((diagnostic) => ({
      filePath: relativePath,
      bindingId: binding.id,
      bindingKind: binding.kind,
      root: binding.name,
      alias: "",
      aliasChain: [],
      operation: "unsupported",
      key: "*",
      pathSegments: ["*"],
      dynamic: true,
      unsupported: true,
      reason: diagnostic.reason || "binding-discovery-failed",
      line: 1,
      column: 1,
      sourceFingerprint: createHash("sha256")
        .update(
          [
            relativePath,
            binding.id,
            diagnostic.reason || "binding-discovery-failed",
          ].join("|"),
        )
        .digest("hex"),
    })),
    actionDelegations: [],
  };
}

function withStateWriterFindingSourceFingerprint(source, finding) {
  const normalizedSource = normalizeJavaScriptSource(source);
  const start = Math.max(0, Number(finding.start || 0));
  const end = Math.max(start, Number(finding.end || start));
  const sourceSlice = normalizedSource
    .slice(start, end)
    .trim();
  return {
    ...finding,
    sourceFingerprint: sourceSlice
      ? createHash("sha256").update(sourceSlice).digest("hex")
      : "",
  };
}

const CONTAINER_ALIAS_ESCAPE_EVIDENCE_KINDS = new Set([
  "assignment-value",
  "return-value",
  "unknown-call-argument",
]);

function withoutRedundantContainerAliasEscapeFindings(
  findings = [],
) {
  const sourceFindings = Array.isArray(findings)
    ? findings
    : [];
  return sourceFindings.filter((finding) => {
    if (
      finding?.reason !== "state-alias-escape"
      || !CONTAINER_ALIAS_ESCAPE_EVIDENCE_KINDS.has(
        String(finding?.evidenceKind || ""),
      )
    ) {
      return true;
    }
    const start = Number(finding?.start);
    const end = Number(finding?.end);
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || end <= start
    ) {
      return true;
    }
    const hasNestedFullRootEscape = sourceFindings.some(
      (candidate) => {
        if (
          candidate === finding
          || candidate?.bindingId !== finding.bindingId
          || candidate?.enclosingFunctionIdentity
            !== finding.enclosingFunctionIdentity
          || candidate?.reason !== "state-alias-escape"
          || candidate?.key !== "*"
        ) {
          return false;
        }
        const candidateStart = Number(candidate?.start);
        const candidateEnd = Number(candidate?.end);
        return Number.isInteger(candidateStart)
          && Number.isInteger(candidateEnd)
          && candidateStart >= start
          && candidateEnd <= end
          && (
            candidateStart > start
            || candidateEnd < end
          );
      },
    );
    return !hasNestedFullRootEscape;
  });
}

const JAVASCRIPT_PARSE_FAILURE_REASONS = new Set([
  "javascript-parse-error",
  "unterminated-block-comment",
  "unterminated-regular-expression",
  "unterminated-string",
  "unterminated-template",
]);

function isBatchJavaScriptParseFailure(inventory) {
  return inventory.actionDelegations.length === 0
    && inventory.findings.length === 1
    && inventory.findings[0]?.unsupported
    && inventory.findings[0]?.operation === "unsupported"
    && JAVASCRIPT_PARSE_FAILURE_REASONS.has(
      inventory.findings[0]?.reason,
    );
}

// 同一源码只解析一次，再把共享扫描结果投影回每个 binding；语法失败也
// 只生成一份文件级证据，避免 binding 数量放大同一个解析错误。
export function scanStateWriterBindingInventoriesBatch(
  source,
  relativePath,
  bindings = [],
  derivedAliasTaintMode =
    DERIVED_ALIAS_TAINT_MODES.STRICT,
  {
    scanner = scanStateMutationInventory,
    recognizeCurrentContracts = true,
  } = {},
) {
  const normalizedDerivedAliasTaintMode =
    normalizeDerivedAliasTaintMode(derivedAliasTaintMode);
  const orderedBindings = Array.isArray(bindings) ? bindings : [];
  const inventoriesByBindingId = new Map();
  const scannableBindings = [];
  for (const binding of orderedBindings) {
    if (binding.discoveryDiagnostics?.length) {
      inventoriesByBindingId.set(
        binding.id,
        buildBindingDiscoveryDiagnosticInventory(
          relativePath,
          binding,
        ),
      );
      continue;
    }
    scannableBindings.push(binding);
    inventoriesByBindingId.set(binding.id, {
      findings: [],
      actionDelegations: [],
    });
  }

  if (scannableBindings.length) {
    const inventory = scanner(source, {
      filePath: relativePath,
      bindings: scannableBindings.map(toScannerBinding),
      derivedAliasTaintMode:
        normalizedDerivedAliasTaintMode,
      recognizeCurrentContracts,
    });
    if (isBatchJavaScriptParseFailure(inventory)) {
      const parseFailure = inventory.findings[0];
      for (const binding of scannableBindings) {
        inventoriesByBindingId.get(binding.id).findings.push(
          withStateWriterFindingSourceFingerprint(source, {
            ...parseFailure,
            bindingId: binding.id,
            bindingKind: binding.kind,
            root: binding.name,
          }),
        );
      }
    } else {
      for (const finding of inventory.findings) {
        const bindingInventory =
          inventoriesByBindingId.get(finding.bindingId);
        if (!bindingInventory) {
          throw new Error(
            `State writer batch scan returned an unknown binding: ${finding.bindingId}`,
          );
        }
        bindingInventory.findings.push(
          withStateWriterFindingSourceFingerprint(source, finding),
        );
      }
      for (const edge of inventory.actionDelegations) {
        const bindingInventory =
          inventoriesByBindingId.get(edge.bindingId);
        if (!bindingInventory) {
          throw new Error(
            `State writer batch scan returned an unknown binding delegation: ${edge.bindingId}`,
          );
        }
        bindingInventory.actionDelegations.push(edge);
      }
      for (const binding of scannableBindings) {
        const bindingInventory =
          inventoriesByBindingId.get(binding.id);
        bindingInventory.findings =
          withoutRedundantContainerAliasEscapeFindings(
            bindingInventory.findings,
          );
      }
    }
  }

  return orderedBindings.map((binding) => ({
    binding,
    ...inventoriesByBindingId.get(binding.id),
  }));
}

function scanBindingInventory(
  source,
  relativePath,
  binding,
  derivedAliasTaintMode =
    DERIVED_ALIAS_TAINT_MODES.STRICT,
) {
  const [inventory] = scanStateWriterBindingInventoriesBatch(
    source,
    relativePath,
    [binding],
    derivedAliasTaintMode,
  );
  return inventory;
}

function scanBinding(
  source,
  relativePath,
  binding,
  derivedAliasTaintMode =
    DERIVED_ALIAS_TAINT_MODES.STRICT,
) {
  return scanBindingInventory(
    source,
    relativePath,
    binding,
    derivedAliasTaintMode,
  ).findings;
}

export const STATE_WRITER_DERIVED_ALIAS_TAINT_POLICY =
  Object.freeze({
    algorithmVersion: 1,
    scope:
      "production-paths-changed-since-frozen-p4-baseline",
  });

function defaultDerivedAliasTaintRunGit(args) {
  return execFileSync("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function normalizeCandidatePathList(candidatePaths = []) {
  return stableUnique(
    (Array.isArray(candidatePaths) ? candidatePaths : [])
      .map(normalizeRelativePath)
      .filter(Boolean),
  );
}

function derivedAliasTaintEnabledPathHash(
  modeByPath = {},
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(modeByPath)
          .filter(
            ([, mode]) =>
              mode === DERIVED_ALIAS_TAINT_MODES.STRICT,
          )
          .map(([relativePath]) => relativePath)
          .sort((left, right) => left.localeCompare(right)),
      ),
    )
    .digest("hex");
}

export function resolveStateWriterDerivedAliasTaintMode({
  relativePath = "",
  surface = "",
  changedProductionPaths = [],
  persistentStrictProductionPaths = [],
} = {}) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedSurface = String(surface || "")
    || (isTestPath(normalizedPath) ? "test" : "production");
  if (normalizedSurface === "test") {
    return DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE;
  }
  const changed = changedProductionPaths instanceof Set
    ? changedProductionPaths
    : new Set(normalizeCandidatePathList(changedProductionPaths));
  const persistent = persistentStrictProductionPaths instanceof Set
    ? persistentStrictProductionPaths
    : new Set(
      normalizeCandidatePathList(persistentStrictProductionPaths),
    );
  return (
    isActionPath(normalizedPath)
    || changed.has(normalizedPath)
    || persistent.has(normalizedPath)
  )
    ? DERIVED_ALIAS_TAINT_MODES.STRICT
    : DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE;
}

export function validateStateWriterDerivedAliasTaintModeManifest(
  manifest = {},
) {
  const violations = [];
  if (
    Number(manifest.algorithmVersion)
    !== STATE_WRITER_DERIVED_ALIAS_TAINT_POLICY.algorithmVersion
  ) {
    violations.push({
      code: "derived-alias-taint-algorithm-version-invalid",
    });
  }
  if (
    String(manifest.scope || "")
    !== STATE_WRITER_DERIVED_ALIAS_TAINT_POLICY.scope
  ) {
    violations.push({
      code: "derived-alias-taint-scope-invalid",
    });
  }
  if (
    !/^[0-9a-f]{40}$/.test(
      String(manifest.sourceBaseSha || ""),
    )
  ) {
    violations.push({
      code: "derived-alias-taint-source-base-invalid",
    });
  }
  const changedProductionPaths =
    normalizeCandidatePathList(
      manifest.changedProductionPaths,
    );
  if (
    JSON.stringify(changedProductionPaths)
    !== JSON.stringify(manifest.changedProductionPaths || [])
  ) {
    violations.push({
      code: "derived-alias-taint-changed-paths-invalid",
    });
  }
  const changed = new Set(changedProductionPaths);
  const persistentStrictProductionPaths =
    normalizeCandidatePathList(
      manifest.persistentStrictProductionPaths,
    );
  if (
    JSON.stringify(persistentStrictProductionPaths)
    !== JSON.stringify(
      manifest.persistentStrictProductionPaths || [],
    )
  ) {
    violations.push({
      code:
        "derived-alias-taint-persistent-strict-paths-invalid",
    });
  }
  const persistent = new Set(persistentStrictProductionPaths);
  const modeByPath =
    manifest.modeByPath
    && typeof manifest.modeByPath === "object"
    && !Array.isArray(manifest.modeByPath)
      ? manifest.modeByPath
      : {};
  for (const [relativePath, mode] of Object.entries(modeByPath)) {
    try {
      normalizeDerivedAliasTaintMode(mode);
    } catch {
      violations.push({
        code: "derived-alias-taint-path-mode-invalid",
        path: relativePath,
        mode,
      });
      continue;
    }
    if (
      changed.has(relativePath)
      && mode !== DERIVED_ALIAS_TAINT_MODES.STRICT
    ) {
      violations.push({
        code:
          "derived-alias-taint-changed-path-resolved-legacy",
        path: relativePath,
      });
    }
    if (
      persistent.has(relativePath)
      && mode !== DERIVED_ALIAS_TAINT_MODES.STRICT
    ) {
      violations.push({
        code:
          "derived-alias-taint-persistent-path-resolved-legacy",
        path: relativePath,
      });
    }
    if (
      isActionPath(relativePath)
      && mode !== DERIVED_ALIAS_TAINT_MODES.STRICT
    ) {
      violations.push({
        code:
          "derived-alias-taint-action-path-resolved-legacy",
        path: relativePath,
      });
    }
    if (
      isTestPath(relativePath)
      && mode !== DERIVED_ALIAS_TAINT_MODES.LEGACY_BASELINE
    ) {
      violations.push({
        code: "derived-alias-taint-test-path-resolved-strict",
        path: relativePath,
      });
    }
  }
  for (const relativePath of changedProductionPaths) {
    if (!(relativePath in modeByPath)) {
      violations.push({
        code: "derived-alias-taint-changed-path-mode-missing",
        path: relativePath,
      });
    }
  }
  for (const relativePath of persistentStrictProductionPaths) {
    if (isTestPath(relativePath)) {
      violations.push({
        code:
          "derived-alias-taint-persistent-test-path-invalid",
        path: relativePath,
      });
    }
  }
  const expectedEnabledPathHash =
    derivedAliasTaintEnabledPathHash(modeByPath);
  if (
    String(manifest.enabledPathHash || "")
    !== expectedEnabledPathHash
  ) {
    violations.push({
      code: "derived-alias-taint-enabled-path-hash-invalid",
      expected: expectedEnabledPathHash,
      actual: String(manifest.enabledPathHash || ""),
    });
  }
  return violations;
}

export function buildStateWriterDerivedAliasTaintModeManifest({
  previousPolicy = null,
  sourceBaseSha = "",
  candidatePaths = [],
  runGit = defaultDerivedAliasTaintRunGit,
} = {}) {
  const frozenSourceBaseSha = String(
    previousPolicy?.baseline?.sourceBaseSha || sourceBaseSha || "",
  ).trim();
  if (!frozenSourceBaseSha) {
    const error = new Error(
      "Derived alias taint requires a source baseline commit.",
    );
    error.code = "derived-alias-taint-source-base-missing";
    throw error;
  }
  const resolvedFrozenSourceBaseSha = resolveGitCommitSha(
    frozenSourceBaseSha,
    { runGit },
  );
  const requestedSourceBaseSha = String(
    sourceBaseSha || "",
  ).trim();
  if (requestedSourceBaseSha) {
    const resolvedRequestedSourceBaseSha =
      requestedSourceBaseSha === frozenSourceBaseSha
        ? resolvedFrozenSourceBaseSha
        : resolveGitCommitSha(
          requestedSourceBaseSha,
          { runGit },
        );
    if (
      resolvedRequestedSourceBaseSha
      !== resolvedFrozenSourceBaseSha
    ) {
      const error = new Error(
        "Derived alias taint source baseline drifted from the frozen policy.",
      );
      error.code = "derived-alias-taint-baseline-drift";
      error.expected = resolvedFrozenSourceBaseSha;
      error.actual = resolvedRequestedSourceBaseSha;
      throw error;
    }
  }
  try {
    runGit([
      "merge-base",
      "--is-ancestor",
      resolvedFrozenSourceBaseSha,
      "HEAD",
    ]);
  } catch (cause) {
    const error = new Error(
      "Derived alias taint source baseline is not an ancestor of HEAD.",
      { cause },
    );
    error.code = "derived-alias-taint-baseline-not-ancestor";
    error.sourceBaseSha = resolvedFrozenSourceBaseSha;
    throw error;
  }

  const changed = new Set();
  try {
    const output = runGit([
      "diff",
      "--name-only",
      resolvedFrozenSourceBaseSha,
      "--",
      "js",
    ]);
    for (const entry of String(output || "").split(/\r?\n/)) {
      const normalized = normalizeRelativePath(entry).trim();
      if (normalized.endsWith(".js")) {
        changed.add(normalized);
      }
    }
  } catch (cause) {
    const error = new Error(
      "Unable to diff production paths from the frozen state-writer baseline.",
      { cause },
    );
    error.code = "derived-alias-taint-git-diff-failed";
    error.sourceBaseSha = resolvedFrozenSourceBaseSha;
    throw error;
  }
  try {
    const untrackedOutput = runGit([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      "js",
    ]);
    for (const entry of String(untrackedOutput || "").split(/\r?\n/)) {
      const normalized = normalizeRelativePath(entry).trim();
      if (normalized.endsWith(".js")) {
        changed.add(normalized);
      }
    }
  } catch (cause) {
    const error = new Error(
      "Unable to discover untracked production paths for derived alias taint.",
      { cause },
    );
    error.code = "derived-alias-taint-git-status-failed";
    throw error;
  }
  const changedProductionPaths = [...changed]
    .sort((left, right) => left.localeCompare(right));
  const persistentStrictProductionPaths =
    normalizeCandidatePathList(
      previousPolicy?.baselines?.derivedAliasTaint?.paths,
    ).filter((relativePath) => !isTestPath(relativePath));
  const persistent = new Set(persistentStrictProductionPaths);
  const modeByPath = Object.fromEntries(
    // Deleted production files remain in the frozen-baseline diff. Keep their
    // strict modes for historical proof without adding them to current scans.
    normalizeCandidatePathList([...candidatePaths, ...changedProductionPaths]).map((relativePath) => [
      relativePath,
      resolveStateWriterDerivedAliasTaintMode({
        relativePath,
        changedProductionPaths: changed,
        persistentStrictProductionPaths: persistent,
      }),
    ]),
  );
  const manifest = Object.freeze({
    algorithmVersion:
      STATE_WRITER_DERIVED_ALIAS_TAINT_POLICY.algorithmVersion,
    scope: STATE_WRITER_DERIVED_ALIAS_TAINT_POLICY.scope,
    sourceBaseSha: resolvedFrozenSourceBaseSha,
    changedProductionPaths: Object.freeze(changedProductionPaths),
    persistentStrictProductionPaths: Object.freeze(
      persistentStrictProductionPaths,
    ),
    modeByPath: Object.freeze(modeByPath),
    enabledPathHash:
      derivedAliasTaintEnabledPathHash(modeByPath),
  });
  const violations =
    validateStateWriterDerivedAliasTaintModeManifest(manifest);
  if (violations.length) {
    const error = new Error(
      "Derived alias taint mode manifest is invalid.",
    );
    error.code = "derived-alias-taint-manifest-invalid";
    error.violations = violations;
    throw error;
  }
  return manifest;
}

export async function discoverScannedCandidateBindings(
  legacyAllowlistPaths,
  {
    previousPolicy = null,
    baseSha = "",
  } = {},
) {
  const candidates = [];
  const actionDelegations = [];
  const candidatePaths = await discoverCandidatePaths(legacyAllowlistPaths);
  const previousWritersByPath = new Map(
    (previousPolicy?.writers || [])
      .map((writer) => [writer.path, writer]),
  );
  const derivedAliasTaintModeManifest =
    buildStateWriterDerivedAliasTaintModeManifest({
      previousPolicy,
      sourceBaseSha:
        baseSha || previousPolicy?.baseline?.sourceBaseSha,
      candidatePaths,
    });
  for (const relativePath of candidatePaths) {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    if (!(await fileExists(absolutePath))) {
      continue;
    }
    const source = normalizeJavaScriptSource(
      await fs.readFile(absolutePath, "utf8"),
    );
    const surface = isTestPath(relativePath) ? "test" : "production";
    const derivedAliasTaintMode =
      derivedAliasTaintModeManifest.modeByPath[relativePath];
    if (isActionPath(relativePath)) {
      const actionDelegationSourceViolations =
        validateStateActionModuleSource(
          source,
          { filePath: relativePath },
        );
      if (actionDelegationSourceViolations.length) {
        const error = new Error(
          `State action delegation source is invalid: ${relativePath}`,
        );
        error.code = "state-action-delegation-source-invalid";
        error.violations = actionDelegationSourceViolations;
        throw error;
      }
    }
    const actionBoundaryViolations = validateDomainActionSourceBoundary(
      source,
      { filePath: relativePath },
    );
    if (actionBoundaryViolations.length) {
      const error = new Error(
        `Domain action imports the global state facade: ${relativePath}`,
      );
      error.violations = actionBoundaryViolations;
      throw error;
    }
    const {
      bindings,
      bindingInventories,
    } = await discoverStateWriterBindingsForSource(
      relativePath,
      source,
      surface,
      {
        previousWriter: previousWritersByPath.get(relativePath),
        scanAllParameters:
          derivedAliasTaintMode
          === DERIVED_ALIAS_TAINT_MODES.STRICT,
        derivedAliasTaintMode,
        includeInventories: true,
      },
    );
    for (
      const {
        binding,
        findings,
        actionDelegations: bindingActionDelegations,
      } of bindingInventories
    ) {
      actionDelegations.push(...bindingActionDelegations);
      if (!shouldRetainScannedWriterCandidate({
        relativePath,
        surface,
        binding,
        findings,
        actionDelegations: bindingActionDelegations,
      })) {
        continue;
      }
      candidates.push({
        path: relativePath,
        surface,
        binding,
        findings,
        delegationOnly: isDelegationOnlyStateWriterCandidate({
          relativePath,
          surface,
          binding,
          findings,
          actionDelegations: bindingActionDelegations,
        }),
      });
    }
  }
  return {
    candidates: candidates.sort(
      (left, right) =>
        left.path.localeCompare(right.path)
        || left.binding.id.localeCompare(right.binding.id),
    ),
    actionDelegations:
      normalizeStateActionDelegations(actionDelegations),
    derivedAliasTaintModeManifest,
  };
}

export function shouldRetainScannedWriterCandidate({
  relativePath = "",
  surface = "",
  binding = null,
  findings = [],
  actionDelegations = [],
} = {}) {
  if (Array.isArray(findings) && findings.length) return true;
  return isDelegationOnlyStateWriterCandidate({
    relativePath,
    surface,
    binding,
    findings,
    actionDelegations,
  });
}

export function isDelegationOnlyStateWriterCandidate({
  relativePath = "",
  surface = "",
  binding = null,
  findings = [],
  actionDelegations = [],
} = {}) {
  return surface === "production"
    && isActionPath(relativePath)
    && binding?.kind === "function-parameter"
    && Array.isArray(findings)
    && findings.length === 0
    && Array.isArray(actionDelegations)
    && actionDelegations.length > 0;
}

export async function resolveCachedStateWriterRepositoryScan({
  repositoryScanCache = null,
  previousPolicy = null,
  scanIdentity = "",
  scan,
}) {
  if (typeof scan !== "function") {
    throw new TypeError("resolveCachedStateWriterRepositoryScan requires a scan function.");
  }
  if (!repositoryScanCache) return scan();
  if (!(repositoryScanCache instanceof Map)) {
    throw new TypeError("repositoryScanCache must be a Map when provided.");
  }
  const policyKey = previousPolicy || null;
  let scansByIdentity = repositoryScanCache.get(policyKey);
  if (!scansByIdentity) {
    scansByIdentity = new Map();
    repositoryScanCache.set(policyKey, scansByIdentity);
  }
  const normalizedIdentity = String(scanIdentity || "default");
  if (!scansByIdentity.has(normalizedIdentity)) {
    const pending = Promise.resolve().then(scan);
    scansByIdentity.set(normalizedIdentity, pending);
    pending.catch(() => {
      if (scansByIdentity.get(normalizedIdentity) === pending) {
        scansByIdentity.delete(normalizedIdentity);
      }
    });
  }
  return structuredClone(await scansByIdentity.get(normalizedIdentity));
}

function createGrantKey(domain, migrationPhase) {
  return `${domain}|${migrationPhase}`;
}

export function collectUnknownStateKeyAuthorityViolations(
  candidates = [],
  stateKeyAuthorityIndex = buildCanonicalStateKeyAuthorityIndex(),
) {
  const violations = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (candidate?.surface !== "production") {
      continue;
    }
    for (const finding of Array.isArray(candidate?.findings)
      ? candidate.findings
      : []) {
      const authority = resolveStateWriterFindingAuthority(
        finding,
        candidate.path,
        stateKeyAuthorityIndex,
      );
      if (!authority.unknown) {
        continue;
      }
      const violation = {
        code: "unknown-state-key-authority",
        path: candidate.path,
        bindingId: candidate.binding?.id || finding.bindingId || "",
        operation: finding.operation,
        key: finding.key,
        line: Number(finding.line || 1),
        column: Number(finding.column || 1),
        suggestedDomain: authority.fallback.domain,
        suggestedMigrationPhase: authority.fallback.migrationPhase,
      };
      const identity = [
        violation.path,
        violation.bindingId,
        violation.operation,
        violation.key,
        violation.line,
        violation.column,
      ].join("|");
      violations.set(identity, violation);
    }
  }
  return [...violations.values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path)
      || left.bindingId.localeCompare(right.bindingId)
      || left.key.localeCompare(right.key)
      || left.operation.localeCompare(right.operation)
      || left.line - right.line
      || left.column - right.column,
  );
}

export function buildStateWriterBindingGrants(
  findings,
  relativePath,
  stateKeyAuthorityIndex,
  surface,
  { allowUnknownUnsupportedAuthority = false } = {},
) {
  const grantsByKey = new Map();
  for (const finding of findings) {
    if (finding.unsupported && surface === "test") {
      continue;
    }
    let authority = resolveStateWriterFindingAuthority(
      finding,
      relativePath,
      stateKeyAuthorityIndex,
    );
    if (authority.unknown) {
      const canUseConservativeFallback =
        allowUnknownUnsupportedAuthority && finding.unsupported;
      if (surface === "production" && !canUseConservativeFallback) {
        const error = new Error(
          `Unknown state key authority for ${finding.key} in ${relativePath}.`,
        );
        error.code = "unknown-state-key-authority";
        error.details = {
          path: relativePath,
          operation: finding.operation,
          key: finding.key,
          suggestedDomain: authority.fallback.domain,
          suggestedMigrationPhase: authority.fallback.migrationPhase,
        };
        throw error;
      }
      authority = authority.fallback;
    }
    const { domain, migrationPhase } = authority;
    const grantKey = createGrantKey(domain, migrationPhase);
    if (!grantsByKey.has(grantKey)) {
      grantsByKey.set(grantKey, {
        domain,
        migrationPhase,
        operations: new Set(),
        keys: new Set(),
        memberships: new Map(),
        aliasSites: new Map(),
        dynamicSites: new Map(),
        ambiguousSites: new Map(),
        unsupportedSites: new Map(),
      });
    }
    const grant = grantsByKey.get(grantKey);
    if (finding.unsupported) {
      if (finding.reason === "ambiguous-alias-flow") {
        const siteKey = [
          finding.line,
          finding.column,
          finding.reason,
        ].join("|");
        grant.ambiguousSites.set(siteKey, {
          line: finding.line,
          column: finding.column,
          reason: finding.reason,
          ...(finding.sourceFingerprint
            ? { sourceFingerprint: finding.sourceFingerprint }
            : {}),
        });
      } else {
        const siteKey = [
          finding.line,
          finding.column,
          finding.reason,
          finding.operation,
          finding.key,
        ].join("|");
        grant.unsupportedSites.set(siteKey, {
          line: finding.line,
          column: finding.column,
          reason: finding.reason,
          operation: finding.operation,
          key: finding.key,
          ...(finding.sourceFingerprint
            ? { sourceFingerprint: finding.sourceFingerprint }
            : {}),
        });
      }
      continue;
    }
    grant.operations.add(finding.operation);
    const membershipKey = `${finding.operation}|${finding.key}`;
    if (!grant.memberships.has(membershipKey)) {
      grant.memberships.set(membershipKey, {
        operation: finding.operation,
        key: finding.key,
        mutationSites: [],
      });
    }
    const membership = grant.memberships.get(membershipKey);
    if (
      surface === "production"
      && !isActionPath(relativePath)
      && finding.enclosingFunctionIdentity
      && /^[0-9a-f]{64}$/i.test(
        String(finding.sourceFingerprint || ""),
      )
    ) {
      const occurrenceIndex = membership.mutationSites.filter(
        (site) =>
          site.enclosingFunctionIdentity
            === finding.enclosingFunctionIdentity
          && site.sourceFingerprint
            === finding.sourceFingerprint,
      ).length;
      membership.mutationSites.push({
        enclosingFunctionIdentity:
          finding.enclosingFunctionIdentity,
        sourceFingerprint: finding.sourceFingerprint,
        occurrenceIndex,
      });
    }
    if (finding.key !== "*") {
      grant.keys.add(finding.key);
    }
    if (finding.alias) {
      const siteKey = [
        finding.alias,
        finding.operation,
        finding.key,
        finding.line,
        finding.column,
      ].join("|");
      grant.aliasSites.set(siteKey, {
        alias: finding.alias,
        aliasChain: finding.aliasChain,
        operation: finding.operation,
        key: finding.key,
        line: finding.line,
        column: finding.column,
        ...(finding.sourceFingerprint
          ? { sourceFingerprint: finding.sourceFingerprint }
          : {}),
      });
    }
    if (finding.dynamic) {
      const siteKey = [
        finding.line,
        finding.column,
        finding.operation,
        finding.key,
      ].join("|");
      grant.dynamicSites.set(siteKey, {
        line: finding.line,
        column: finding.column,
        operation: finding.operation,
        key: finding.key,
        pathPattern: finding.pathSegments.join("."),
        ...(finding.sourceFingerprint
          ? { sourceFingerprint: finding.sourceFingerprint }
          : {}),
      });
    }
  }
  return [...grantsByKey.values()]
    .map((grant) => ({
      domain: grant.domain,
      migrationPhase: grant.migrationPhase,
      operations: stableUnique([...grant.operations]),
      keys: stableUnique([...grant.keys]),
      memberships: [...grant.memberships.values()]
        .map((membership) => ({
          operation: membership.operation,
          key: membership.key,
          ...(membership.mutationSites.length
            ? {
              mutationSites: [...membership.mutationSites].sort(
                (left, right) =>
                  left.enclosingFunctionIdentity.localeCompare(
                    right.enclosingFunctionIdentity,
                  )
                  || left.sourceFingerprint.localeCompare(
                    right.sourceFingerprint,
                  )
                  || left.occurrenceIndex - right.occurrenceIndex,
              ),
            }
            : {}),
        }))
        .sort(
          (left, right) =>
            left.operation.localeCompare(right.operation)
            || left.key.localeCompare(right.key),
        ),
      aliasSites: [...grant.aliasSites.values()].sort(
        (left, right) =>
          left.line - right.line
          || left.column - right.column
          || left.alias.localeCompare(right.alias),
      ),
      dynamicSites: [...grant.dynamicSites.values()].sort(
        (left, right) =>
          left.line - right.line
          || left.column - right.column,
      ),
      ambiguousSites: [...grant.ambiguousSites.values()].sort(
        (left, right) =>
          left.line - right.line
          || left.column - right.column,
      ),
      unsupportedSites: [...grant.unsupportedSites.values()].sort(
        (left, right) =>
          left.line - right.line
          || left.column - right.column
          || left.reason.localeCompare(right.reason),
      ),
    }))
    .sort(
      (left, right) =>
        left.migrationPhase.localeCompare(right.migrationPhase)
        || left.domain.localeCompare(right.domain),
    );
}

function bindingAuthority(relativePath, surface, binding) {
  if (surface === "test") {
    return "test-fixture";
  }
  if (isCompatFacadePath(relativePath)) {
    return "compat-facade";
  }
  if (isActionPath(relativePath)) {
    return "domain-action";
  }
  if (binding.kind === "module") {
    return "legacy-direct";
  }
  return "legacy-target";
}

function summarizeWriterClassification(bindings) {
  const domainValues = stableUnique(
    bindings.flatMap((binding) => binding.grants.map((grant) => grant.domain)),
  );
  const phaseValues = stableUnique(
    bindings.flatMap(
      (binding) => binding.grants.map((grant) => grant.migrationPhase),
    ),
  );
  return {
    domain: domainValues.length === 1 ? domainValues[0] : "cross-domain",
    migrationPhase: phaseValues.length === 1 ? phaseValues[0] : "multi-phase",
  };
}

// P4.0 冻结基线后，各阶段只能基于 previousPolicy 递进生成；显式刷新
// 被限制在 P4.0，防止维护命令悄悄重定义历史允许面。
function validateEffectfulDelegatorSource(source, entry) {
  if (createHash("sha256").update(normalizeJavaScriptSource(source)).digest("hex") !== entry.sourceFingerprint) {
    const error = new Error(`Effectful delegator source proof failed: ${entry.modulePath}`);
    error.code = "state-effectful-delegator-source-mismatch";
    throw error;
  }
}

export async function validateImportedBorrowedProjectionSources() {
  for (const entry of STATE_BORROWED_SCOPED_OPERATION_CONTRACT) {
    const { violations } = inspectStateBorrowedScopedOperationSources(entry);
    if (violations.length) {
      const error = new Error(`Borrowed scoped operation proof failed: ${entry.factoryModulePath}`);
      error.code = "state-borrowed-scoped-operation-source-mismatch";
      error.violations = violations;
      throw error;
    }
  }
  for (const entry of STATE_BORROWED_OWNER_EFFECT_CONTRACT) {
    const { violations } = inspectStateBorrowedOwnerEffectSources(entry);
    if (violations.length) {
      const error = new Error(`Borrowed owner effect proof failed: ${entry.factoryModulePath}`);
      error.code = "state-borrowed-owner-effect-source-mismatch";
      error.violations = violations;
      throw error;
    }
  }
  for (const entry of STATE_BORROWED_RUNTIME_CONTRACT) {
    const { violations } = inspectStateBorrowedRuntimeSources(entry);
    if (violations.length) {
      const error = new Error(`Borrowed runtime source proof failed: ${entry.factoryModulePath}`);
      error.code = "state-borrowed-runtime-source-mismatch";
      error.violations = violations;
      throw error;
    }
  }
  for (const entry of STATE_BORROWED_CALLBACK_INJECTION_CONTRACT) {
    const { violations } = inspectStateBorrowedCallbackInjectionSources(entry);
    if (violations.length) {
      const error = new Error(`Callback injection source proof failed: ${entry.modulePath}#${entry.parameterName}`);
      error.code = "state-callback-injection-source-mismatch";
      error.violations = violations;
      throw error;
    }
  }

  for (const entry of STATE_TARGET_EFFECTFUL_DELEGATOR_CONTRACT) {
    validateEffectfulDelegatorSource(await fs.readFile(path.join(PROJECT_ROOT, entry.modulePath), "utf8"), entry);
  }
  for (const entry of STATE_BORROWED_EFFECT_CONTRACT) {
    const source = await fs.readFile(path.join(PROJECT_ROOT, entry.modulePath), "utf8");
    const { violations } = inspectStateBorrowedEffectSource(source, entry);
    if (violations.length) {
      const error = new Error(`Borrowed effect source proof failed: ${entry.modulePath}#${entry.exportName}`);
      error.code = "state-borrowed-effect-contract-violation";
      error.violations = violations;
      throw error;
    }
  }
  const seen = new Set();
  for (const entry of STATE_IMPORTED_BORROWED_PROJECTION_CONTRACT) {
    const id = `${entry.modulePath}#${entry.exportName}`;
    if (seen.has(id)) throw new Error(`Duplicate borrowed projection contract: ${id}`);
    seen.add(id);
    const source = await fs.readFile(path.join(PROJECT_ROOT, entry.modulePath), "utf8");
    const { violations } = inspectStateImportedBorrowedProjectionSource(source, entry);
    if (violations.length) {
      const error = new Error(`Borrowed projection source proof failed: ${id}`);
      error.code = "state-imported-borrowed-projection-contract-violation";
      error.violations = violations;
      throw error;
    }
  }
}

export async function buildStateWriterPolicySnapshot({
  baseSha = "",
  generatedAt = "",
  phase = "P4.0",
  previousPolicy = null,
  callerToActionBootstrapSeed = [],
  refreshP4Baseline = false,
  acceptedPolicyCheckpoint = null,
  repositoryScanCache = null,
  historicalDerivedAliasProofCache = null,
} = {}) {
  await validateImportedBorrowedProjectionSources();
  const normalizedPhase = normalizeP4StateActionPhase(phase);
  if (refreshP4Baseline && normalizedPhase !== "P4.0") {
    throw new Error("--refresh-p4-baseline is valid only for phase P4.0.");
  }
  if (
    previousPolicy
    && !refreshP4Baseline
    && (
      !previousPolicy.baseline
      || !previousPolicy.baselines
      || !previousPolicy.progress
      || !previousPolicy.baseline.sourceBaseSha
    )
  ) {
    throw new Error(
      "Previous policy lacks the frozen P4.0 baseline or progress contract; refresh explicitly at P4.0.",
    );
  }
  if (!previousPolicy && normalizedPhase !== "P4.0") {
    throw new Error(
      `Phase ${normalizedPhase} requires a previous policy with a frozen P4.0 baseline.`,
    );
  }
  if (previousPolicy && !refreshP4Baseline) {
    resolveGitCommitSha(previousPolicy.baseline.sourceBaseSha);
  }
  const actionDelegationContractViolations =
    validateStateActionDelegationContract();
  if (actionDelegationContractViolations.length) {
    const error = new Error(
      "State action delegation contract is invalid.",
    );
    error.code = "state-action-delegation-contract-invalid";
    error.violations = actionDelegationContractViolations;
    throw error;
  }
  const legacyMembershipReplacementContractViolations =
    validateStateActionLegacyMembershipReplacementContract();
  if (legacyMembershipReplacementContractViolations.length) {
    const error = new Error(
      "State action legacy membership replacement contract is invalid.",
    );
    error.code =
      "state-action-legacy-membership-replacement-contract-invalid";
    error.violations = legacyMembershipReplacementContractViolations;
    throw error;
  }
  const crossFileMigrationContractViolations =
    validateStateActionCrossFileMigrationContract();
  if (crossFileMigrationContractViolations.length) {
    const error = new Error(
      "State action cross-file migration contract is invalid.",
    );
    error.code = "state-action-cross-file-migration-contract-invalid";
    error.violations = crossFileMigrationContractViolations;
    throw error;
  }
  const legacyAllowlistPaths = await readLegacyStateWriterAllowlist();
  const defaultStateReport = await buildDefaultStateOwnershipReport();
  const stateKeyAuthorityIndex = buildCanonicalStateKeyAuthorityIndex();
  const {
    candidates: scannedCandidates,
    actionDelegations,
    derivedAliasTaintModeManifest,
  } = await resolveCachedStateWriterRepositoryScan({
    repositoryScanCache,
    previousPolicy: refreshP4Baseline ? null : previousPolicy,
    scanIdentity: JSON.stringify({
      baseSha: previousPolicy?.baseline?.sourceBaseSha || baseSha,
      legacyAllowlistPaths,
      refreshP4Baseline,
    }),
    scan: () => discoverScannedCandidateBindings(
      legacyAllowlistPaths,
      {
        previousPolicy: refreshP4Baseline ? null : previousPolicy,
        baseSha: previousPolicy?.baseline?.sourceBaseSha
          || baseSha,
      },
    ),
  });
  const unknownStateKeyAuthorityViolations =
    collectUnknownStateKeyAuthorityViolations(
      scannedCandidates,
      stateKeyAuthorityIndex,
    );
  if (unknownStateKeyAuthorityViolations.length) {
    const error = new Error(
      [
        `Found ${unknownStateKeyAuthorityViolations.length} production state mutations without canonical key authority:`,
        ...unknownStateKeyAuthorityViolations.map(
          (violation) =>
            `- ${violation.key} at ${violation.path}:${violation.line}:${violation.column} (${violation.bindingId})`,
        ),
      ].join("\n"),
    );
    error.code = "unknown-state-key-authority";
    error.violations = unknownStateKeyAuthorityViolations;
    throw error;
  }
  const byPath = new Map();
  const findingRecords = [];
  for (const candidate of scannedCandidates) {
    const binding = {
      ...candidate.binding,
      authority: bindingAuthority(
        candidate.path,
        candidate.surface,
        candidate.binding,
      ),
      ...(candidate.delegationOnly === true
        ? { delegationOnly: true }
        : {}),
      grants: buildStateWriterBindingGrants(
        candidate.findings,
        candidate.path,
        stateKeyAuthorityIndex,
        candidate.surface,
      ),
    };
    findingRecords.push({
      path: candidate.path,
      surface: candidate.surface,
      bindingId: binding.id,
      authority: binding.authority,
      findings: candidate.findings,
    });
    if (!byPath.has(candidate.path)) {
      byPath.set(candidate.path, {
        path: candidate.path,
        surface: candidate.surface,
        bindings: [],
      });
    }
    byPath.get(candidate.path).bindings.push(binding);
  }

  const legacyAllowlist = new Set(legacyAllowlistPaths);
  for (const relativePath of legacyAllowlistPaths) {
    if (byPath.has(relativePath)) {
      continue;
    }
    const reason = COMPATIBILITY_ONLY_PATHS.get(relativePath)
      || "legacy-root-scanner-compatibility-only";
    byPath.set(relativePath, {
      path: relativePath,
      surface: isTestPath(relativePath) ? "test" : "production",
      bindings: [
        {
          id: "compatibility-only",
          kind: "compatibility-only",
          name: "",
          authority: "compatibility-only",
          reason,
          grants: [],
        },
      ],
    });
  }

  const writers = [...byPath.values()]
    .map((writer) => {
      writer.bindings.sort((left, right) => left.id.localeCompare(right.id));
      const classification = summarizeWriterClassification(writer.bindings);
      return {
        path: writer.path,
        surface: writer.surface,
        domain: classification.domain,
        authority: legacyAllowlist.has(writer.path)
          ? "legacy-direct"
          : isCompatFacadePath(writer.path)
            ? "compat-facade"
            : isActionPath(writer.path)
              ? "domain-action"
              : "legacy-target",
        migrationPhase: classification.migrationPhase,
        bindings: writer.bindings,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const activeActionModulePaths = [];
  for (
    const modulePath of stableUnique(
      STATE_ACTION_DELEGATION_CONTRACT.map(
        ({ modulePath: contractModulePath }) => contractModulePath,
      ),
    )
  ) {
    if (await fileExists(path.join(PROJECT_ROOT, modulePath))) {
      activeActionModulePaths.push(modulePath);
    }
  }
  const actionModulePhaseAdmissionViolations =
    validateStateActionModulePhaseAdmissions({
      modulePaths: activeActionModulePaths,
      phase: normalizedPhase,
    });
  if (actionModulePhaseAdmissionViolations.length) {
    const error = new Error(
      "Generated state action modules exceed the admitted phase.",
    );
    error.code = "state-action-module-phase-admission-invalid";
    error.violations = actionModulePhaseAdmissionViolations;
    throw error;
  }
  const actionDelegationPolicyViolations =
    validateStateActionPolicyBindings(
      writers,
      {
        modulePaths: activeActionModulePaths,
      },
    );
  if (actionDelegationPolicyViolations.length) {
    const error = new Error(
      "Generated state action delegation policy is invalid.",
    );
    error.code = "state-action-delegation-policy-invalid";
    error.violations = actionDelegationPolicyViolations;
    throw error;
  }

  const productionProjection = legacyAllowlistPaths.filter(
    (relativePath) => !isTestPath(relativePath),
  );
  const testProjection = legacyAllowlistPaths.filter(isTestPath);
  const bindingScopedMetrics = summarizeStateWriterFindingRecords(
    findingRecords,
  );
  const resolvedBaseSha = String(baseSha || "").trim()
    || "HEAD";
  const currentBaselines = {
    legacyDirectFiles: {
      production: productionProjection.length,
      test: testProjection.length,
      total: legacyAllowlistPaths.length,
    },
    bindingScopedMemberships: bindingScopedMetrics.memberships,
    bindingScopedSites: bindingScopedMetrics.sites,
    historicalRootScanner: {
      productionMatches: 1186,
      productionLiteralKeys: 366,
      productionComputedSites: 7,
      testMatches: 475,
      testLiteralKeys: 147,
      testComputedSites: 8,
      note:
        "Historical regex-root oracle retained for reconciliation; binding-scoped counts are authoritative for P4 migration.",
    },
    defaultState: {
      factoryGroups: defaultStateReport.factoryGroups.length,
      explicitKeys: defaultStateReport.explicitKeys.length,
      preCompatKeys: defaultStateReport.preCompatKeyCount,
      compatibilityHooks: defaultStateReport.compatibilityHookCount,
      postCompatKeys: defaultStateReport.postCompatKeyCount,
      actualFacadeKeys: defaultStateReport.actualFacadeKeyCount,
      unownedActualFacadeKeys:
        defaultStateReport.unownedActualFacadeKeys.length,
      registeredKeysMissingFromFacade:
        defaultStateReport.registeredKeysMissingFromFacade.length,
      collisions: defaultStateReport.collisions.length,
    },
    testDiagnosticBudget: bindingScopedMetrics.diagnostics.test,
    legacySemanticAuthority:
      buildLegacyStateWriterSemanticAuthority(writers),
  };
  currentBaselines.closeoutTargets = buildP4CloseoutTargets(currentBaselines);
  const derivedAliasTaintEnabled =
    previousPolicy
    && !refreshP4Baseline
    && compareP4StateActionPhases(normalizedPhase, "P4.2a") >= 0;
  const strictProductionPaths = Object.entries(
    derivedAliasTaintModeManifest.modeByPath,
  )
    .filter(
      ([relativePath, mode]) =>
        !isTestPath(relativePath)
        && mode === DERIVED_ALIAS_TAINT_MODES.STRICT,
    )
    .map(([relativePath]) => relativePath);
  const derivedAliasTaint = derivedAliasTaintEnabled
    ? await resolveCachedHistoricalDerivedAliasProof({
      historicalDerivedAliasProofCache,
      sourceSha: previousPolicy.baseline.sourceBaseSha,
      candidatePaths: strictProductionPaths,
      phase: normalizedPhase,
      taintMode: DERIVED_ALIAS_TAINT_MODES.STRICT,
      checkpoint: buildHistoricalDerivedAliasProofCheckpoint({
        acceptedPolicyCheckpoint,
        phase: normalizedPhase,
        policy: previousPolicy,
      }),
      previousPolicy,
      policy: previousPolicy,
      prove: () => buildFrozenDerivedAliasTaintBaseline({
        sourceBaseSha: previousPolicy.baseline.sourceBaseSha,
        relativePaths: strictProductionPaths,
        legacySemanticBaseline:
          previousPolicy.baselines.legacySemanticAuthority,
        existingBaseline:
          previousPolicy.baselines.derivedAliasTaint || null,
        acceptedPolicyCheckpoint,
        stateKeyAuthorityIndex,
      }),
    })
    : null;
  const unbaselinedLegacyDiagnosticCounts =
    buildUnbaselinedLegacyDiagnosticCounts({
      legacySemanticAuthority:
        currentBaselines.legacySemanticAuthority,
      derivedAliasTaint,
    });
  const currentProgressMetrics = {
    productionLegacyDirectFiles: productionProjection.length,
    productionLegacyMemberships:
      bindingScopedMetrics.memberships.production.legacyCombined,
    productionLegacyDynamicSites:
      bindingScopedMetrics.sites.dynamic.production.legacyCombined,
    productionLegacyAliasSites:
      bindingScopedMetrics.sites.alias.production.legacyCombined,
    productionLegacyAmbiguousSites:
      derivedAliasTaint
        ? unbaselinedLegacyDiagnosticCounts.ambiguousSites
        : bindingScopedMetrics.sites.ambiguous.production.legacyCombined,
    productionLegacyUnsupportedSites:
      derivedAliasTaint
        ? unbaselinedLegacyDiagnosticCounts.unsupportedSites
        : bindingScopedMetrics.sites.unsupported.production.legacyCombined,
  };
  const frozenLegacySemanticAuthority =
    previousPolicy && !refreshP4Baseline
      ? previousPolicy.baselines.legacySemanticAuthority
      : currentBaselines.legacySemanticAuthority;
  const effectiveFrozenLegacySemanticAuthority =
    composeLegacySemanticBaseline({
      legacyBaseline: frozenLegacySemanticAuthority,
      derivedAliasTaint,
    });
  const incrementalDerivedAliasTaint =
    buildIncrementalDerivedAliasTaintBaseline({
      currentBaseline: derivedAliasTaint,
      previousBaseline:
        previousPolicy?.baselines?.derivedAliasTaint,
    });
  const effectivePreviousLegacySemanticAuthority =
    previousPolicy && !refreshP4Baseline
      ? composeLegacySemanticBaseline({
        legacyBaseline:
          buildLegacyStateWriterSemanticAuthority(
            previousPolicy.writers,
          ),
        derivedAliasTaint: incrementalDerivedAliasTaint,
      })
      : null;
  const retiredLegacySemanticAuthority =
    subtractLegacyStateWriterSemanticAuthority(
      effectiveFrozenLegacySemanticAuthority,
      buildLegacyStateWriterSemanticAuthority(writers),
    );
  const callerToActionLedger = buildCallerToActionLedger({
    phase: normalizedPhase,
    previousPolicy: refreshP4Baseline ? null : previousPolicy,
    bootstrapSeedEntries:
      refreshP4Baseline ? [] : callerToActionBootstrapSeed,
    writers,
    retiredLegacySemanticAuthority,
    actionDelegations,
  });
  const progression = validateStateWriterPolicyProgression({
    previousPolicy: refreshP4Baseline ? null : previousPolicy,
    phase: normalizedPhase,
    currentMetrics: currentProgressMetrics,
  });
  const testDiagnosticBudgetViolations =
    previousPolicy && !refreshP4Baseline
      ? validateTestDiagnosticBudget({
        baseline: previousPolicy?.baselines?.testDiagnosticBudget,
        current: bindingScopedMetrics.diagnostics.test,
      })
      : [];
  const legacySemanticAuthorityViolations =
    previousPolicy && !refreshP4Baseline
      ? [
        ...validateLegacyStateWriterSemanticAuthority({
          baseline: effectiveFrozenLegacySemanticAuthority,
          writers,
        }).violations,
        ...validateLegacyStateWriterSemanticLedger({
          baseline: effectiveFrozenLegacySemanticAuthority,
          writers,
          retired: retiredLegacySemanticAuthority,
          previousWriters: previousPolicy?.writers,
          previousAuthorityBaseline:
            effectivePreviousLegacySemanticAuthority,
          previousRetired:
            previousPolicy?.progress?.retiredLegacySemanticAuthority,
        }).violations,
        ...validateLegacyMembershipRetirementReplacements({
          previousWriters: previousPolicy?.writers,
          writers,
          callerToActionLedger,
        }),
      ]
      : currentBaselines.legacySemanticAuthority.collisions.map(
        (binding) => ({
          code: "legacy-semantic-binding-identity-collision",
          binding,
        }),
      );
  const governanceViolations = [
    ...progression.violations,
    ...testDiagnosticBudgetViolations,
    ...legacySemanticAuthorityViolations,
  ];
  if (governanceViolations.length) {
    const error = new Error(
      `State writer policy progression failed: ${
        governanceViolations.map(({ code }) => code).join(", ")
      }`,
    );
    error.violations = governanceViolations;
    throw error;
  }
  const preserveFrozenBaseline = previousPolicy && !refreshP4Baseline;
  const baseline = preserveFrozenBaseline
    ? cloneJsonValue(previousPolicy.baseline)
    : {
      phase: "P4.0",
      sourceBaseSha: resolveGitCommitSha(resolvedBaseSha),
      generatedAt: String(generatedAt || "").trim()
        || new Date().toISOString(),
    };
  const baselines = preserveFrozenBaseline
    ? cloneJsonValue(previousPolicy.baselines)
    : currentBaselines;
  if (derivedAliasTaint) {
    baselines.derivedAliasTaint =
      cloneJsonValue(derivedAliasTaint);
  }

  return {
    schemaVersion: derivedAliasTaint ? 2 : 1,
    stateFacade: "js/core/state.js#state",
    baseline,
    writers,
    defaultOwners: {
      factoryGroups: defaultStateReport.factoryGroups,
      explicitKeys: defaultStateReport.explicitKeys,
      compatibilityHooks: defaultStateReport.compatibilityHooks,
    },
    baselines,
    progress: buildProgressState({
      phase: normalizedPhase,
      currentMetrics: currentProgressMetrics,
      previousPolicy,
      refreshP4Baseline,
      retiredLegacySemanticAuthority,
      callerToActionLedger,
      acceptedPolicyCheckpoint,
    }),
  };
}

function policyBindingSignatures(policy) {
  const signatures = new Set();
  for (const writer of policy.writers || []) {
    for (const binding of writer.bindings || []) {
      if (binding.authority === "compatibility-only") {
        continue;
      }
      signatures.add(`${writer.path}|${bindingSignature(binding)}`);
    }
  }
  return signatures;
}

// 先以稳定 binding signature 对齐当前发现与策略记录，再扫描已登记项；
// compatibility-only 入口由专用合同管理，不进入生产 mutation inventory。
export async function scanStateWriterPolicySnapshot(policy, {
  repositoryScanCache = null,
} = {}) {
  await validateImportedBorrowedProjectionSources();
  const legacyAllowlistPaths = await readLegacyStateWriterAllowlist();
  const policySignatures = policyBindingSignatures(policy);
  const {
    candidates,
    actionDelegations,
    derivedAliasTaintModeManifest,
  } = await resolveCachedStateWriterRepositoryScan({
    repositoryScanCache,
    previousPolicy: policy,
    scanIdentity: JSON.stringify({
      baseSha: policy?.baseline?.sourceBaseSha || "",
      legacyAllowlistPaths,
      refreshP4Baseline: false,
    }),
    scan: () => discoverScannedCandidateBindings(
      legacyAllowlistPaths,
      {
        previousPolicy: policy,
        baseSha: policy?.baseline?.sourceBaseSha,
      },
    ),
  });
  const candidateSignatures = new Set(
    candidates.map(
      (candidate) =>
        `${candidate.path}|${bindingSignature(candidate.binding)}`,
    ),
  );
  const candidatesBySignature = new Map(
    candidates.map((candidate) => [
      `${candidate.path}|${bindingSignature(candidate.binding)}`,
      candidate,
    ]),
  );
  const unknownCandidateBindings = [...candidateSignatures]
    .filter((signature) => !policySignatures.has(signature))
    .sort();
  const stalePolicyBindings = [...policySignatures]
    .filter((signature) => !candidateSignatures.has(signature))
    .sort();
  const scans = [];
  for (const writer of policy.writers || []) {
    const absolutePath = path.join(PROJECT_ROOT, writer.path);
    if (!(await fileExists(absolutePath))) {
      scans.push({
        path: writer.path,
        surface: writer.surface,
        bindingId: "__missing-file__",
        findings: [{
          unsupported: true,
          reason: "writer-file-missing",
          line: 1,
          column: 1,
        }],
      });
      continue;
    }
    const bindings = (writer.bindings || []).filter(
      (binding) => binding.authority !== "compatibility-only",
    );
    for (const binding of bindings) {
      const candidate = candidatesBySignature.get(
        `${writer.path}|${bindingSignature(binding)}`,
      );
      scans.push({
        path: writer.path,
        surface: writer.surface,
        bindingId: binding.id,
        delegationOnly: candidate?.delegationOnly === true,
        findings: applyStateWriterBindingFindingContracts({
          relativePath: writer.path,
          binding,
          findings: candidate?.findings || [],
        }),
      });
    }
  }
  return {
    legacyAllowlistPaths,
    scans,
    actionDelegations,
    derivedAliasTaintModeManifest,
    unknownCandidateBindings,
    stalePolicyBindings,
  };
}

function parseCliArgs(argv) {
  const args = {
    write: false,
    baseSha: "",
    generatedAt: "",
    phase: "P4.0",
    previousPolicyRevision: "",
    refreshP4Baseline: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      args.write = true;
    } else if (arg === "--base-sha") {
      args.baseSha = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--generated-at") {
      args.generatedAt = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--phase") {
      args.phase = normalizeP4StateActionPhase(argv[index + 1]);
      index += 1;
    } else if (arg === "--previous-policy-revision") {
      args.previousPolicyRevision = String(argv[index + 1] || "").trim();
      if (!args.previousPolicyRevision) {
        throw new Error("--previous-policy-revision requires a Git revision");
      }
      index += 1;
    } else if (arg === "--refresh-p4-baseline") {
      args.refreshP4Baseline = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const workingPolicy = args.refreshP4Baseline
    ? null
    : args.previousPolicyRevision
      ? readStateWriterPolicyAtRevision(args.previousPolicyRevision)
      : await readStateWriterPolicy().catch(() => null);
  let previousPolicy = workingPolicy;
  let callerToActionBootstrapSeed = [];
  if (
    !args.refreshP4Baseline
    && args.phase === "P4.2a"
    && Number(workingPolicy?.schemaVersion) === 1
    && workingPolicy?.progress?.latestPhase === "P4.2a"
    && !workingPolicy?.baselines?.derivedAliasTaint
  ) {
    previousPolicy = readStateWriterPolicyAtRevision("HEAD");
    callerToActionBootstrapSeed =
      extractP42aCallerToActionBootstrapSeed({
        previousPolicy,
        transitionPolicy: workingPolicy,
      });
  }
  const policy = await buildStateWriterPolicySnapshot({
    baseSha: args.baseSha,
    generatedAt: args.generatedAt,
    phase: args.phase,
    previousPolicy,
    callerToActionBootstrapSeed,
    refreshP4Baseline: args.refreshP4Baseline,
    acceptedPolicyCheckpoint: previousPolicy
      ? resolveAcceptedStateWriterPolicyCheckpoint({
        policy: previousPolicy,
      })
      : null,
  });
  const serialized = `${JSON.stringify(policy, null, 2)}\n`;
  if (args.write) {
    const schemaViolations = validateStateWriterPolicySchema(policy);
    if (schemaViolations.length) {
      const error = new Error("Generated state writer policy schema is invalid.");
      error.code = "state-writer-policy-schema-invalid";
      error.violations = schemaViolations;
      throw error;
    }
    await writeStateWriterPolicyAtomically(
      STATE_WRITER_POLICY_PATH,
      serialized,
    );
    console.log(
      `Wrote ${normalizeRelativePath(path.relative(PROJECT_ROOT, STATE_WRITER_POLICY_PATH))} with ${policy.writers.length} writers.`,
    );
    return;
  }
  process.stdout.write(serialized);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    if (Array.isArray(error?.violations)) {
      console.error(JSON.stringify(error.violations, null, 2));
    }
    process.exitCode = 1;
  });
}
