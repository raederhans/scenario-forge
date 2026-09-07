import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  findStateActionCrossFileMigrationContractEntry,
} from "./state_action_delegation_contract.mjs";

import {
  buildFrozenDerivedAliasTaintBaseline,
  buildHistoricalDerivedAliasProofCheckpoint,
  buildHistoricalDerivedAliasProofIdentity,
  buildIncrementalDerivedAliasTaintBaseline,
  buildLegacyStateWriterSemanticAuthority,
  buildStateWriterDerivedAliasTaintModeManifest,
  buildUnbaselinedLegacyDiagnosticCounts,
  composeLegacySemanticBaseline,
  P4_CLOSEOUT_DIRECT_FILES_TARGET,
  P4_CLOSEOUT_MEMBERSHIP_RATIO,
  readStateWriterPolicy,
  resolveAcceptedStateWriterPolicyCheckpoint,
  resolveCachedHistoricalDerivedAliasProof,
  resolveGitCommitSha,
  scanStateWriterPolicySnapshot,
  STATE_WRITER_POLICY_PATH,
  validateLegacyMembershipRetirementReplacements,
  validateLegacyStateWriterSemanticAuthority,
  validateLegacyStateWriterSemanticLedger,
  validateStateWriterPolicyProgression,
} from "./build_state_writer_policy.mjs";
import {
  buildDefaultStateOwnershipReport,
  validateTestDiagnosticBudget,
  validateStateWriterPolicySnapshot,
} from "./state_writer_policy.mjs";
import {
  isP4StateActionCloseoutPhase,
  normalizeP4StateActionPhase,
} from "./p4_state_action_phases.mjs";
import {
  hashP4StateWriterHistoricalProofJson,
  startP4StateWriterHistoricalProofWorker,
} from "./verification/p4_state_writer_historical_proof_worker.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPORT_ROOT = path.join(
  PROJECT_ROOT,
  ".runtime",
  "reports",
  "generated",
  "p4-state-actions",
);
const POLICY_CONFIG_PATHS = Object.freeze([
  "package-lock.json",
  "tools/eslint-rules/state-writer-allowlist.json",
  "tools/state_action_delegation_contract.mjs",
  "tools/state_writer_inventory.mjs",
  "tools/state_writer_policy.mjs",
  "tools/build_state_writer_policy.mjs",
  "tools/check_state_writer_policy.mjs",
  "tools/p4_state_action_phases.mjs",
]);

function parseArgs(argv) {
  const args = {
    phase: "",
    jsonOut: "",
    json: false,
    requireClean: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--phase") {
      args.phase = normalizeP4StateActionPhase(argv[index + 1]);
      index += 1;
    } else if (arg === "--json-out") {
      args.jsonOut = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--require-clean") {
      args.requireClean = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.phase) {
    args.phase = normalizeP4StateActionPhase(args.phase);
  }
  return args;
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function buildExpectedP4ProgressCheckpoint(policy = {}) {
  const baselines = policy?.baselines || {};
  return {
    phase: "P4.0",
    productionLegacyDirectFiles:
      baselines?.legacyDirectFiles?.production,
    productionLegacyMemberships:
      baselines?.bindingScopedMemberships?.production?.legacyCombined,
    productionLegacyDynamicSites:
      baselines?.bindingScopedSites?.dynamic?.production?.legacyCombined,
    productionLegacyAliasSites:
      baselines?.bindingScopedSites?.alias?.production?.legacyCombined,
    productionLegacyAmbiguousSites:
      baselines?.bindingScopedSites?.ambiguous?.production?.legacyCombined,
    productionLegacyUnsupportedSites:
      baselines?.bindingScopedSites?.unsupported?.production?.legacyCombined,
  };
}

export function validateFrozenP4ProgressCheckpoint(policy = {}) {
  const checkpoints = Array.isArray(policy?.progress?.checkpoints)
    ? policy.progress.checkpoints
    : [];
  const p4BaselineCheckpoints = checkpoints.filter(
    (checkpoint) => checkpoint?.phase === "P4.0",
  );
  if (p4BaselineCheckpoints.length !== 1) {
    return [{
      code: "p4-baseline-progress-checkpoint-count-invalid",
      expected: 1,
      actual: p4BaselineCheckpoints.length,
    }];
  }
  const expected = buildExpectedP4ProgressCheckpoint(policy);
  const actual = p4BaselineCheckpoints[0];
  return isDeepStrictEqual(expected, actual)
    ? []
    : [{
      code: "p4-baseline-progress-checkpoint-drift",
      expected,
      actual,
    }];
}

function validateProgressCheckpointHistoryTransition({
  previousPolicy = {},
  currentPolicy = {},
} = {}) {
  const previousCheckpoints = Array.isArray(
    previousPolicy?.progress?.checkpoints,
  )
    ? previousPolicy.progress.checkpoints
    : [];
  const currentCheckpoints = Array.isArray(
    currentPolicy?.progress?.checkpoints,
  )
    ? currentPolicy.progress.checkpoints
    : [];
  const violations = [];
  for (let index = 0; index < previousCheckpoints.length; index += 1) {
    const expected = previousCheckpoints[index];
    const actual = currentCheckpoints[index];
    if (!actual) {
      violations.push({
        code: "progress-checkpoint-history-missing",
        index,
        phase: expected?.phase || "",
        expected,
      });
      continue;
    }
    if (!isDeepStrictEqual(expected, actual)) {
      violations.push({
        code: "progress-checkpoint-history-drift",
        index,
        phase: expected?.phase || "",
        expected,
        actual,
      });
    }
  }
  return violations;
}

export function validateCallerToActionLedgerHistoryTransition({
  previousPolicy = null,
  currentPolicy = {},
  crossFileMigrationContract = undefined,
} = {}) {
  if (!previousPolicy) {
    return [];
  }
  const previousEntries = Array.isArray(
    previousPolicy?.progress?.callerToActionLedger?.entries,
  )
    ? previousPolicy.progress.callerToActionLedger.entries
    : [];
  const currentEntries = Array.isArray(
    currentPolicy?.progress?.callerToActionLedger?.entries,
  )
    ? currentPolicy.progress.callerToActionLedger.entries
    : [];
  const previousPhase = String(
    previousPolicy?.progress?.latestPhase || "",
  );
  const currentPhase = String(
    currentPolicy?.progress?.latestPhase || "",
  );
  const isOneTimeBackfill =
    previousEntries.length === 0
    && previousPhase === "P4.1"
    && currentPhase === "P4.2a";
  const violations = [];
  const previouslyRetiredMemberships = new Set(
    previousPolicy?.progress?.retiredLegacySemanticAuthority
      ?.memberships || [],
  );
  const currentByRetiredIdentity = new Map(
    currentEntries.map((entry) => [
      entry.retiredMembershipIdentity,
      entry,
    ]),
  );
  for (const previousEntry of previousEntries) {
    const currentEntry = currentByRetiredIdentity.get(
      previousEntry.retiredMembershipIdentity,
    );
    if (!currentEntry) {
      violations.push({
        code: "caller-action-ledger-history-missing",
        retiredMembershipIdentity:
          previousEntry.retiredMembershipIdentity,
      });
      continue;
    }
    const migrationContract =
      findStateActionCrossFileMigrationContractEntry(
        previousEntry.retiredMembershipIdentity,
        crossFileMigrationContract,
      );
    const retiredMutationSites = migrationContract?.retiredMutationSites || [];
    const retiredFunctionIdentities = [...new Set(
      retiredMutationSites.map(({ enclosingFunctionIdentity }) => enclosingFunctionIdentity),
    )].sort();
    const canonicalCrossFileAdoption = Boolean(
      migrationContract
      && previousEntry.crossFileMigrationContractIdentity
        !== migrationContract.contractIdentity
      && currentEntry.crossFileMigrationContractIdentity
        === migrationContract.contractIdentity
      && currentEntry.retiredCallerPath
        === migrationContract.retiredCallerPath
      && currentEntry.retiredCallerBindingIdentity
        === migrationContract.retiredCallerBindingIdentity
      && currentEntry.callerPath
        === migrationContract.replacementCallerPath
      && currentEntry.callerBindingIdentity
        === migrationContract.replacementCallerBindingIdentity
      && currentEntry.enclosingFunctionIdentity
        === migrationContract.replacementEnclosingFunctionIdentity
      && currentEntry.actionModulePath
        === migrationContract.actionModulePath
      && currentEntry.actionExportName
        === migrationContract.actionExportName
      && currentEntry.targetArgumentIndex
        === migrationContract.targetArgumentIndex
      && currentEntry.sourceFingerprint
        === migrationContract.replacementActionSourceFingerprint
      && currentEntry.retiredMutationSiteCount
        === retiredMutationSites.length
      && currentEntry.retiredMutationSiteFingerprint
        === createHash("sha256")
          .update(JSON.stringify(retiredMutationSites))
          .digest("hex")
      && (
        retiredFunctionIdentities.length === 1
          ? currentEntry.retiredEnclosingFunctionIdentity
            === retiredFunctionIdentities[0]
          : isDeepStrictEqual(
            currentEntry.retiredEnclosingFunctionIdentities,
            retiredFunctionIdentities,
          )
      )
    );
    if (canonicalCrossFileAdoption) {
      continue;
    }
    const samePhaseObservationRefresh =
      previousPhase === currentPhase
      && previousEntry.recordedInPhase === currentPhase;
    const crossPhaseObservationRefresh =
      previousPhase !== currentPhase;
    const observationRefresh =
      samePhaseObservationRefresh || crossPhaseObservationRefresh;
    const expectedHistory = observationRefresh
      ? structuredClone(previousEntry)
      : previousEntry;
    const actualHistory = observationRefresh
      ? structuredClone(currentEntry)
      : currentEntry;
    if (observationRefresh) {
      // The builder refreshes live source coordinates within the recording
      // phase and may refresh the action edge across phases. Snapshot
      // validation binds every live field to the current observation.
      const liveFields = [
        "callerBindingId",
        "start",
        "end",
        "line",
        "column",
        "sourceFingerprint",
        ...(crossPhaseObservationRefresh
          ? [
            "actionModulePath",
            "actionExportName",
            "targetArgumentIndex",
            "actionCallEdgeIdentity",
            "occurrenceIndex",
          ]
          : []),
      ];
      for (const field of liveFields) {
        delete expectedHistory[field];
        delete actualHistory[field];
      }
      for (const proof of Array.isArray(expectedHistory.functionProofs)
        ? expectedHistory.functionProofs
        : []) {
        for (const field of liveFields) {
          delete proof[field];
        }
      }
      for (const proof of Array.isArray(actualHistory.functionProofs)
        ? actualHistory.functionProofs
        : []) {
        for (const field of liveFields) {
          delete proof[field];
        }
      }
      const canonicalP44SuccessorAdoption =
        previousPhase === "P4.3"
        && currentPhase === "P4.4"
        && Number(
          previousPolicy?.progress?.callerToActionLedger
            ?.schemaVersion,
        ) === 2
        && Number(
          currentPolicy?.progress?.callerToActionLedger
            ?.schemaVersion,
        ) === 3;
      if (canonicalP44SuccessorAdoption) {
        delete expectedHistory.successorActionProofs;
        delete actualHistory.successorActionProofs;
        delete expectedHistory.successorProofContractIdentity;
        delete actualHistory.successorProofContractIdentity;
        for (const proof of Array.isArray(expectedHistory.functionProofs)
          ? expectedHistory.functionProofs
          : []) {
          delete proof.successorActionProofs;
          delete proof.successorProofContractIdentity;
        }
        for (const proof of Array.isArray(actualHistory.functionProofs)
          ? actualHistory.functionProofs
          : []) {
          delete proof.successorActionProofs;
          delete proof.successorProofContractIdentity;
        }
      } else {
        for (const proof of [expectedHistory, actualHistory]) {
          const proofs = Array.isArray(proof.functionProofs)
            ? proof.functionProofs
            : [proof];
          for (const functionProof of proofs) {
            for (const successor of
              functionProof.successorActionProofs || []) {
              for (const field of liveFields) delete successor[field];
            }
          }
        }
      }
    }
    if (!isDeepStrictEqual(expectedHistory, actualHistory)) {
      violations.push({
        code: "caller-action-ledger-history-drift",
        retiredMembershipIdentity:
          previousEntry.retiredMembershipIdentity,
        expected: previousEntry,
        actual: currentEntry,
      });
    }
  }
  const retiredMemberships = new Set(
    currentPolicy?.progress?.retiredLegacySemanticAuthority
      ?.memberships || [],
  );
  const ledgerMemberships = new Set(
    currentEntries.map(
      ({ retiredMembershipIdentity }) =>
        retiredMembershipIdentity,
    ),
  );
  const missingRetiredProofs = [...retiredMemberships]
    .filter((identity) => !ledgerMemberships.has(identity));
  const extraProofs = [...ledgerMemberships]
    .filter((identity) => !retiredMemberships.has(identity));
  if (
    isOneTimeBackfill
    && (
      missingRetiredProofs.length
      || extraProofs.length
      || currentEntries.length !== retiredMemberships.size
    )
  ) {
    violations.push({
      code: "caller-action-ledger-backfill-incomplete",
      expected: retiredMemberships.size,
      actual: currentEntries.length,
      missingRetiredMembershipIdentities: missingRetiredProofs,
      extraRetiredMembershipIdentities: extraProofs,
    });
  }
  if (isOneTimeBackfill) {
    for (const entry of currentEntries) {
      const wasPreviouslyRetired =
        previouslyRetiredMemberships.has(
          entry.retiredMembershipIdentity,
        );
      const provenanceValid = wasPreviouslyRetired
        ? (
          entry.backfilled === true
          && entry.retiredInPhase === previousPhase
          && entry.recordedInPhase === currentPhase
        )
        : (
          entry.backfilled === false
          && entry.retiredInPhase === currentPhase
          && entry.recordedInPhase === currentPhase
        );
      if (!provenanceValid) {
        violations.push({
          code:
            "caller-action-ledger-backfill-provenance-invalid",
          retiredMembershipIdentity:
            entry.retiredMembershipIdentity,
          expected: wasPreviouslyRetired
            ? {
              backfilled: true,
              retiredInPhase: previousPhase,
              recordedInPhase: currentPhase,
            }
            : {
              backfilled: false,
              retiredInPhase: currentPhase,
              recordedInPhase: currentPhase,
            },
          actual: {
            backfilled: entry.backfilled,
            retiredInPhase: entry.retiredInPhase,
            recordedInPhase: entry.recordedInPhase,
          },
        });
      }
    }
  }
  if (!isOneTimeBackfill) {
    const previousIdentities = new Set(
      previousEntries.map(
        ({ retiredMembershipIdentity }) =>
          retiredMembershipIdentity,
      ),
    );
    for (const entry of currentEntries) {
      if (previousIdentities.has(entry.retiredMembershipIdentity)) {
        continue;
      }
      if (entry.recordedInPhase !== currentPhase) {
        violations.push({
          code: "caller-action-ledger-entry-invalid",
          retiredMembershipIdentity:
            entry.retiredMembershipIdentity,
          reason: "new-entry-recorded-phase-mismatch",
          expected: currentPhase,
          actual: entry.recordedInPhase,
        });
      }
      if (
        entry.backfilled !== false
        || entry.retiredInPhase !== currentPhase
      ) {
        violations.push({
          code: "caller-action-ledger-entry-invalid",
          retiredMembershipIdentity:
            entry.retiredMembershipIdentity,
          reason: "new-entry-provenance-mismatch",
          expected: {
            backfilled: false,
            retiredInPhase: currentPhase,
            recordedInPhase: currentPhase,
          },
          actual: {
            backfilled: entry.backfilled,
            retiredInPhase: entry.retiredInPhase,
            recordedInPhase: entry.recordedInPhase,
          },
        });
      }
    }
  }
  return violations;
}

function stringMultisetCounts(values = []) {
  const counts = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return counts;
}

export function validateDerivedAliasTaintBaselineTransition({
  previousSchemaVersion = 1,
  currentSchemaVersion = 1,
  previousPhase = "",
  currentPhase = "",
  previousBaseline = null,
  currentBaseline = null,
  expectedBaseline = null,
} = {}) {
  const violations = [];
  const previousVersion = Number(previousSchemaVersion);
  const currentVersion = Number(currentSchemaVersion);
  if (currentVersion < previousVersion) {
    violations.push({
      code: "derived-alias-taint-schema-version-regressed",
      previousSchemaVersion: previousVersion,
      currentSchemaVersion: currentVersion,
    });
    return violations;
  }
  if (currentVersion < 2) {
    return violations;
  }
  if (!currentBaseline || typeof currentBaseline !== "object") {
    return [{
      code: "derived-alias-taint-baseline-transition-missing",
    }];
  }
  if (
    previousVersion < 2
    && (
      String(previousPhase || "") !== "P4.1"
      || String(currentPhase || "") !== "P4.2a"
    )
  ) {
    violations.push({
      code: "derived-alias-taint-baseline-transition-phase-invalid",
      previousPhase: String(previousPhase || ""),
      currentPhase: String(currentPhase || ""),
    });
  }
  if (!expectedBaseline) {
    violations.push({
      code: "derived-alias-taint-baseline-source-proof-missing",
    });
  } else if (!isDeepStrictEqual(currentBaseline, expectedBaseline)) {
    violations.push({
      code: "derived-alias-taint-baseline-source-proof-mismatch",
      expected: expectedBaseline,
      actual: currentBaseline,
    });
  }
  if (previousVersion < 2 || !previousBaseline) {
    return violations;
  }
  if (
    Number(currentBaseline.algorithmVersion)
      !== Number(previousBaseline.algorithmVersion)
    || String(currentBaseline.sourceBaseSha || "")
      !== String(previousBaseline.sourceBaseSha || "")
  ) {
    violations.push({
      code: "derived-alias-taint-baseline-identity-drift",
    });
  }
  const previousTransitionCheckpoints = Array.isArray(
    previousBaseline.transitionCheckpoints,
  )
    ? previousBaseline.transitionCheckpoints
    : [];
  const currentTransitionCheckpoints = Array.isArray(
    currentBaseline.transitionCheckpoints,
  )
    ? currentBaseline.transitionCheckpoints
    : [];
  for (
    let index = 0;
    index < previousTransitionCheckpoints.length;
    index += 1
  ) {
    if (
      !isDeepStrictEqual(
        previousTransitionCheckpoints[index],
        currentTransitionCheckpoints[index],
      )
    ) {
      violations.push({
        code:
          "derived-alias-taint-transition-checkpoint-history-drift",
        index,
        expected: previousTransitionCheckpoints[index],
        actual: currentTransitionCheckpoints[index] ?? null,
      });
    }
  }
  const previousPaths = new Set(
    Array.isArray(previousBaseline.paths)
      ? previousBaseline.paths.map(String)
      : [],
  );
  const currentPaths = new Set(
    Array.isArray(currentBaseline.paths)
      ? currentBaseline.paths.map(String)
      : [],
  );
  const addedTransitionPaths = new Set(
    currentTransitionCheckpoints
      .slice(previousTransitionCheckpoints.length)
      .flatMap((checkpoint) =>
        Array.isArray(checkpoint?.paths)
          ? checkpoint.paths.map(String)
          : []),
  );
  if (
    String(previousPhase || "")
    && String(currentPhase || "")
    && String(previousPhase) !== String(currentPhase)
  ) {
    for (const relativePath of currentPaths) {
      if (
        !previousPaths.has(relativePath)
        && !addedTransitionPaths.has(relativePath)
      ) {
        violations.push({
          code: "derived-alias-taint-transition-path-proof-missing",
          path: relativePath,
        });
      }
    }
  }
  for (
    const relativePath of
      Array.isArray(previousBaseline.paths)
        ? previousBaseline.paths
        : []
  ) {
    if (!currentPaths.has(String(relativePath))) {
      violations.push({
        code: "derived-alias-taint-baseline-path-regressed",
        path: String(relativePath),
      });
    }
  }
  for (const section of [
    "bindings",
    "memberships",
    "aliasSites",
    "dynamicSites",
    "ambiguousSites",
    "unsupportedSites",
  ]) {
    const currentCounts = stringMultisetCounts(
      currentBaseline?.transitionSemanticDelta?.[section],
    );
    for (
      const [signature, previousCount] of
        stringMultisetCounts(
          previousBaseline?.transitionSemanticDelta?.[section],
        )
    ) {
      const currentCount = currentCounts.get(signature) || 0;
      if (currentCount < previousCount) {
        violations.push({
          code: "derived-alias-taint-transition-semantic-regressed",
          section,
          signature,
          previousCount,
          currentCount,
        });
      }
    }
  }
  return violations;
}

export function validateStateWriterPolicyTransition({
  previousPolicy = null,
  currentPolicy = {},
  expectedDerivedAliasTaintBaseline = null,
} = {}) {
  if (!previousPolicy) {
    return [];
  }
  const violations = [
    ...validateFrozenP4ProgressCheckpoint(currentPolicy),
    ...validateProgressCheckpointHistoryTransition({
      previousPolicy,
      currentPolicy,
    }),
    ...validateCallerToActionLedgerHistoryTransition({
      previousPolicy,
      currentPolicy,
    }),
  ];
  if (!isDeepStrictEqual(previousPolicy?.baseline, currentPolicy?.baseline)) {
    violations.push({
      code: "policy-baseline-drift",
      expected: previousPolicy?.baseline ?? null,
      actual: currentPolicy?.baseline ?? null,
    });
  }
  const {
    derivedAliasTaint: previousDerivedAliasTaint,
    ...previousFrozenBaselines
  } = previousPolicy?.baselines || {};
  const {
    derivedAliasTaint: currentDerivedAliasTaint,
    ...currentFrozenBaselines
  } = currentPolicy?.baselines || {};
  if (
    !isDeepStrictEqual(
      previousFrozenBaselines,
      currentFrozenBaselines,
    )
  ) {
    violations.push({
      code: "policy-baselines-drift",
      expected: previousFrozenBaselines,
      actual: currentFrozenBaselines,
    });
  }
  violations.push(
    ...validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: previousPolicy?.schemaVersion,
      currentSchemaVersion: currentPolicy?.schemaVersion,
      previousPhase: previousPolicy?.progress?.latestPhase,
      currentPhase: currentPolicy?.progress?.latestPhase,
      previousBaseline: previousDerivedAliasTaint,
      currentBaseline: currentDerivedAliasTaint,
      expectedBaseline: expectedDerivedAliasTaintBaseline,
    }),
  );
  const effectiveFrozenLegacySemanticAuthority =
    composeLegacySemanticBaseline({
      legacyBaseline:
        previousPolicy?.baselines?.legacySemanticAuthority,
      derivedAliasTaint: currentDerivedAliasTaint,
    });
  const effectivePreviousLegacySemanticAuthority =
    composeLegacySemanticBaseline({
      legacyBaseline:
        buildLegacyStateWriterSemanticAuthority(
          previousPolicy?.writers,
        ),
      derivedAliasTaint:
        buildIncrementalDerivedAliasTaintBaseline({
          currentBaseline: currentDerivedAliasTaint,
          previousBaseline: previousDerivedAliasTaint,
        }),
    });
  violations.push(
    ...validateLegacyStateWriterSemanticLedger({
      baseline: effectiveFrozenLegacySemanticAuthority,
      writers: currentPolicy?.writers,
      retired:
        currentPolicy?.progress?.retiredLegacySemanticAuthority,
      previousWriters: previousPolicy?.writers,
      previousAuthorityBaseline:
        effectivePreviousLegacySemanticAuthority,
      previousRetired:
        previousPolicy?.progress?.retiredLegacySemanticAuthority,
    }).violations,
    ...validateLegacyMembershipRetirementReplacements({
      previousWriters: previousPolicy?.writers,
      writers: currentPolicy?.writers,
      callerToActionLedger:
        currentPolicy?.progress?.callerToActionLedger,
    }),
  );
  return violations;
}

export function validateDerivedAliasTaintTransitionCheckpointProof({
  previousPolicy = null,
  currentPolicy = {},
  acceptedPolicyCheckpoint = null,
  isSourceAncestor = (sourceSha) => {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", sourceSha, "HEAD"],
        {
          cwd: PROJECT_ROOT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      return true;
    } catch {
      return false;
    }
  },
  readPolicySourceAtRevision = (sourceSha) => {
    const policyPath = path
      .relative(PROJECT_ROOT, STATE_WRITER_POLICY_PATH)
      .replaceAll("\\", "/");
    return execFileSync(
      "git",
      ["show", `${sourceSha}:${policyPath}`],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  },
} = {}) {
  if (!previousPolicy) {
    return [];
  }
  const previousCheckpoints = Array.isArray(
    previousPolicy?.baselines?.derivedAliasTaint?.transitionCheckpoints,
  )
    ? previousPolicy.baselines.derivedAliasTaint.transitionCheckpoints
    : [];
  const currentCheckpoints = Array.isArray(
    currentPolicy?.baselines?.derivedAliasTaint?.transitionCheckpoints,
  )
    ? currentPolicy.baselines.derivedAliasTaint.transitionCheckpoints
    : [];
  const addedCheckpoints = currentCheckpoints.slice(
    previousCheckpoints.length,
  );
  const violations = [];
  if (
    addedCheckpoints.length
    && (
      addedCheckpoints.length !== 1
      || addedCheckpoints[0]?.sourceSha
        !== acceptedPolicyCheckpoint?.sourceSha
      || addedCheckpoints[0]?.policyBlobSha256
        !== acceptedPolicyCheckpoint?.policyBlobSha256
    )
  ) {
    violations.push({
      code:
        "derived-alias-taint-transition-canonical-checkpoint-mismatch",
      expected: acceptedPolicyCheckpoint,
      actual: addedCheckpoints.length === 1
        ? {
          sourceSha: addedCheckpoints[0]?.sourceSha,
          policyBlobSha256: addedCheckpoints[0]?.policyBlobSha256,
        }
        : null,
    });
  }
  for (const checkpoint of addedCheckpoints) {
    if (!isSourceAncestor(checkpoint.sourceSha)) {
      violations.push({
        code: "derived-alias-taint-transition-source-not-ancestor",
        sourceSha: String(checkpoint?.sourceSha || ""),
      });
    }
    let source;
    try {
      source = String(
        readPolicySourceAtRevision(checkpoint.sourceSha) || "",
      );
    } catch (error) {
      violations.push({
        code: "derived-alias-taint-transition-policy-blob-unavailable",
        sourceSha: String(checkpoint?.sourceSha || ""),
        message: String(error?.message || error),
      });
      continue;
    }
    const policyBlobSha256 = createHash("sha256")
      .update(source)
      .digest("hex");
    if (policyBlobSha256 !== checkpoint.policyBlobSha256) {
      violations.push({
        code: "derived-alias-taint-transition-policy-blob-mismatch",
        sourceSha: checkpoint.sourceSha,
        expected: checkpoint.policyBlobSha256,
        actual: policyBlobSha256,
      });
    }
    let acceptedPolicy;
    try {
      acceptedPolicy = JSON.parse(source);
    } catch {
      violations.push({
        code: "derived-alias-taint-transition-policy-blob-invalid",
        sourceSha: checkpoint.sourceSha,
      });
      continue;
    }
    if (!isDeepStrictEqual(acceptedPolicy, previousPolicy)) {
      violations.push({
        code: "derived-alias-taint-transition-previous-policy-mismatch",
        sourceSha: checkpoint.sourceSha,
      });
    }
  }
  if (addedCheckpoints.length) {
    const previousPhase = String(
      previousPolicy?.progress?.latestPhase || "",
    );
    const latestPhase = String(
      currentPolicy?.progress?.latestPhase || "",
    );
    const progressCheckpoint = (
      currentPolicy?.progress?.checkpoints || []
    ).find(({ phase }) => String(phase || "") === latestPhase);
    if (
      previousPhase !== latestPhase
      && (
        addedCheckpoints.length !== 1
        || progressCheckpoint?.previousAcceptedSourceSha
          !== addedCheckpoints[0]?.sourceSha
        || progressCheckpoint?.previousAcceptedPolicyBlobSha256
          !== addedCheckpoints[0]?.policyBlobSha256
      )
    ) {
      violations.push({
        code: "progress-accepted-policy-checkpoint-mismatch",
        phase: latestPhase,
      });
    }
  }
  return violations;
}

export async function recomputeDerivedAliasTaintBaseline({
  previousPolicy = null,
  currentPolicy = {},
  candidatePaths = [],
  runGit,
  readSourceAtRevision,
  historicalDerivedAliasProofCache = null,
} = {}) {
  if (Number(currentPolicy?.schemaVersion) < 2) {
    return null;
  }
  const sourceBaseSha = String(
    currentPolicy?.baseline?.sourceBaseSha || "",
  );
  const manifest =
    buildStateWriterDerivedAliasTaintModeManifest({
      previousPolicy,
      sourceBaseSha,
      candidatePaths,
      ...(runGit ? { runGit } : {}),
    });
  const strictProductionPaths = Object.entries(
    manifest.modeByPath,
  )
    .filter(
      ([relativePath, mode]) =>
        !relativePath.startsWith("tests/")
        && mode === "strict",
    )
    .map(([relativePath]) => relativePath);
  const expectedPaths = [
    ...new Set([
      ...(previousPolicy?.baselines?.derivedAliasTaint?.paths || []),
      ...strictProductionPaths,
    ]),
  ].map(String).sort((left, right) => left.localeCompare(right));
  const phase = currentPolicy?.progress?.latestPhase || "P4.0";
  return resolveCachedHistoricalDerivedAliasProof({
    historicalDerivedAliasProofCache,
    sourceSha: sourceBaseSha,
    candidatePaths: expectedPaths,
    phase,
    taintMode: "strict",
    checkpoint: buildHistoricalDerivedAliasProofCheckpoint({
      phase,
      policy: currentPolicy,
    }),
    previousPolicy,
    policy: currentPolicy,
    prove: () => buildFrozenDerivedAliasTaintBaseline({
      sourceBaseSha,
      relativePaths: expectedPaths,
      legacySemanticBaseline:
        currentPolicy?.baselines?.legacySemanticAuthority,
      existingBaseline:
        previousPolicy?.baselines?.derivedAliasTaint || null,
      transitionCheckpoints:
        currentPolicy?.baselines?.derivedAliasTaint
          ?.transitionCheckpoints || [],
      ...(readSourceAtRevision ? { readSourceAtRevision } : {}),
    }),
  });
}

function loadPreviousStateWriterPolicy({
  phase,
  trackedClean,
  executeGit = runGit,
} = {}) {
  const revision = trackedClean ? "HEAD^1" : "HEAD";
  const policyPath = path
    .relative(PROJECT_ROOT, STATE_WRITER_POLICY_PATH)
    .replaceAll("\\", "/");
  try {
    const source = executeGit(["show", `${revision}:${policyPath}`]);
    return {
      revision,
      policy: JSON.parse(String(source || "")),
      violations: [],
    };
  } catch (error) {
    return {
      revision,
      policy: null,
      violations: normalizeP4StateActionPhase(phase) === "P4.0"
        ? []
        : [{
          code: "previous-policy-unavailable",
          revision,
          policyPath,
          message: String(error?.message || error),
        }],
    };
  }
}

export function buildStateWriterVerificationIdentity({
  sourceBaseSha = "",
  requireClean = false,
  runGit: executeGit = runGit,
  policyPath = "tools/state_writer_policy.json",
  configPaths = POLICY_CONFIG_PATHS,
} = {}) {
  const verificationSha = String(
    executeGit(["rev-parse", "--verify", "HEAD^{commit}"]) || "",
  ).trim().toLowerCase();
  const verificationTreeSha = String(
    executeGit(["rev-parse", "HEAD^{tree}"]) || "",
  ).trim().toLowerCase();
  const trackedStatus = String(
    executeGit([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]) || "",
  ).trim();
  const trackedClean = trackedStatus === "";
  const hashBlob = (filePath) =>
    String(executeGit(["hash-object", filePath]) || "").trim().toLowerCase();
  const policyBlobSha = hashBlob(policyPath);
  const configBlobShas = [...configPaths].sort().map((configPath) => ({
    path: configPath,
    blobSha: hashBlob(configPath),
  }));
  const configTreeIdentity = createHash("sha256")
    .update(
      configBlobShas.map(({ path: configPath, blobSha }) =>
        `${configPath}\0${blobSha}`
      ).join("\n"),
    )
    .digest("hex");
  const violations = [];
  if (requireClean && !trackedClean) {
    violations.push({
      code: "tracked-worktree-dirty",
      trackedStatus,
    });
  }
  return {
    sourceBaseSha: String(sourceBaseSha || "").trim().toLowerCase(),
    verificationSha,
    verificationTreeSha,
    workspaceClean: trackedClean,
    workspaceStatus: trackedStatus,
    trackedClean,
    trackedStatus,
    includesUntracked: true,
    policyPath,
    policyBlobSha,
    configBlobShas,
    configTreeIdentity,
    violations,
  };
}

export function validateFrozenCloseoutTargets(baselines = {}) {
  const targets = baselines?.closeoutTargets || {};
  const denominator =
    baselines?.bindingScopedMemberships?.production?.legacyCombined;
  const violations = [];
  const expectedSource =
    "baselines.bindingScopedMemberships.production.legacyCombined";
  if (
    typeof denominator !== "number"
    || !Number.isInteger(denominator)
    || denominator < 0
  ) {
    violations.push({
      code: "closeout-target-denominator-invalid",
      denominator,
    });
    return violations;
  }
  if (
    targets.productionLegacyMembershipDenominator !== denominator
  ) {
    violations.push({
      code: "closeout-target-denominator-drift",
      expected: denominator,
      actual: targets.productionLegacyMembershipDenominator,
    });
  }
  if (
    targets.productionLegacyMembershipRatio
    !== P4_CLOSEOUT_MEMBERSHIP_RATIO
  ) {
    violations.push({
      code: "closeout-target-ratio-drift",
      expected: P4_CLOSEOUT_MEMBERSHIP_RATIO,
      actual: targets.productionLegacyMembershipRatio,
    });
  }
  if (
    targets.productionLegacyMemberships
    !== Math.floor(
      denominator * P4_CLOSEOUT_MEMBERSHIP_RATIO,
    )
  ) {
    violations.push({
      code: "closeout-membership-target-drift",
      expected: Math.floor(
        denominator * P4_CLOSEOUT_MEMBERSHIP_RATIO,
      ),
      actual: targets.productionLegacyMemberships,
    });
  }
  if (
    targets.productionLegacyDirectFiles
    !== P4_CLOSEOUT_DIRECT_FILES_TARGET
  ) {
    violations.push({
      code: "closeout-direct-files-target-drift",
      expected: P4_CLOSEOUT_DIRECT_FILES_TARGET,
      actual: targets.productionLegacyDirectFiles,
    });
  }
  if (targets.source !== expectedSource) {
    violations.push({
      code: "closeout-target-source-drift",
      expected: expectedSource,
      actual: targets.source,
    });
  }
  return violations;
}

function compareDefaultStateBaselines(policy, report) {
  const expected = policy?.baselines?.defaultState || {};
  const actual = {
    factoryGroups: report.factoryGroups.length,
    explicitKeys: report.explicitKeys.length,
    preCompatKeys: report.preCompatKeyCount,
    compatibilityHooks: report.compatibilityHookCount,
    postCompatKeys: report.postCompatKeyCount,
    actualFacadeKeys: report.actualFacadeKeyCount,
    unownedActualFacadeKeys: report.unownedActualFacadeKeys.length,
    registeredKeysMissingFromFacade:
      report.registeredKeysMissingFromFacade.length,
    collisions: report.collisions.length,
  };
  const violations = [];
  for (const [key, actualValue] of Object.entries(actual)) {
    if (Number(expected[key]) !== Number(actualValue)) {
      violations.push({
        code: "default-state-baseline-drift",
        key,
        expected: expected[key],
        actual: actualValue,
      });
    }
  }
  for (const collision of report.collisions) {
    violations.push({
      code: "default-state-key-collision",
      ...collision,
    });
  }
  for (const key of report.unownedActualFacadeKeys) {
    violations.push({
      code: "unowned-actual-state-key",
      key,
    });
  }
  for (const key of report.registeredKeysMissingFromFacade) {
    violations.push({
      code: "registered-state-key-missing-from-facade",
      key,
    });
  }
  return {
    expected,
    actual,
    collisions: report.collisions,
    violations,
  };
}

export function buildStateWriterCloseoutTargetViolations({
  phase,
  currentMetrics = {},
  targets = {},
} = {}) {
  const normalizedPhase = normalizeP4StateActionPhase(phase);
  if (!isP4StateActionCloseoutPhase(normalizedPhase)) {
    return [];
  }
  const violations = [];
  if (
    Number(currentMetrics.productionLegacyDirectFiles || 0)
    > Number(targets.productionLegacyDirectFiles || 0)
  ) {
    violations.push({
      code: "closeout-legacy-direct-files-target-missed",
      actual: Number(currentMetrics.productionLegacyDirectFiles || 0),
      target: Number(targets.productionLegacyDirectFiles || 0),
    });
  }
  if (
    Number(currentMetrics.productionLegacyMemberships || 0)
    > Number(targets.productionLegacyMemberships || 0)
  ) {
    violations.push({
      code: "closeout-legacy-memberships-target-missed",
      actual: Number(currentMetrics.productionLegacyMemberships || 0),
      target: Number(targets.productionLegacyMemberships || 0),
    });
  }
  return violations;
}

export function validateP4StateWriterHistoricalProofResult({
  workerSummary = null,
  expectedIdentity = null,
  expectedProof = null,
} = {}) {
  const expectedIdentitySha256 =
    hashP4StateWriterHistoricalProofJson(expectedIdentity);
  if (
    !workerSummary
    || workerSummary.status !== "passed"
    || workerSummary.identitySha256 !== expectedIdentitySha256
    || workerSummary.proofSha256
      !== hashP4StateWriterHistoricalProofJson(expectedProof)
    || workerSummary.policySha256 !== expectedIdentity?.policySha256
    || !isDeepStrictEqual(workerSummary.identity, expectedIdentity)
  ) {
    const error = new Error(
      "P4 historical proof worker result identity drifted from the checker request.",
    );
    error.code = "p4-historical-proof-worker-result-identity-mismatch";
    throw error;
  }
  return structuredClone(expectedProof);
}

export async function joinP4StateWriterHistoricalProofWork({
  inventoryPromise,
  workerSession = null,
} = {}) {
  if (!workerSession) {
    return {
      inventory: await inventoryPromise,
      workerSummary: null,
    };
  }
  const guardedInventoryPromise = Promise.resolve(inventoryPromise)
    .catch(async (error) => {
      await workerSession.terminate();
      throw error;
    });
  const [inventoryOutcome, workerOutcome] = await Promise.allSettled([
    guardedInventoryPromise,
    workerSession.result,
  ]);
  if (inventoryOutcome.status === "rejected") {
    throw inventoryOutcome.reason;
  }
  if (workerOutcome.status === "rejected") {
    throw workerOutcome.reason;
  }
  return {
    inventory: inventoryOutcome.value,
    workerSummary: workerOutcome.value,
  };
}

export async function buildStateWriterPolicyReport({
  phase = "",
  policy = null,
  previousPolicy = undefined,
  requireClean = false,
  repositoryScanCache = null,
  historicalDerivedAliasProofCache = null,
} = {}) {
  const ownsCanonicalPolicy = policy === null;
  const loadedPolicy = policy || await readStateWriterPolicy();
  const requestedPhase = String(phase || "").trim()
    || String(loadedPolicy?.progress?.latestPhase || "").trim()
    || "P4.0";
  const normalizedPhase = normalizeP4StateActionPhase(requestedPhase);
  const policyLatestPhase = String(
    loadedPolicy?.progress?.latestPhase || "",
  ).trim();
  const sourceBaseSha = String(
    loadedPolicy?.baseline?.sourceBaseSha || "",
  ).trim();
  const identity = buildStateWriterVerificationIdentity({
    sourceBaseSha,
    requireClean,
  });
  const previousPolicyState = previousPolicy === undefined
    ? loadPreviousStateWriterPolicy({
      phase: normalizedPhase,
      trackedClean: identity.trackedClean,
    })
    : {
      revision: "injected",
      policy: previousPolicy,
      violations: [],
    };
  const workerCandidatePaths = [
    ...(loadedPolicy?.baselines?.derivedAliasTaint?.paths || []),
  ].map(String).sort((left, right) => left.localeCompare(right));
  const workerIdentityInputs = {
    sourceSha: sourceBaseSha,
    candidatePaths: workerCandidatePaths,
    phase: policyLatestPhase,
    taintMode: "strict",
    checkpoint: buildHistoricalDerivedAliasProofCheckpoint({
      phase: policyLatestPhase,
      policy: loadedPolicy,
    }),
    previousPolicy: previousPolicyState.policy,
    policy: loadedPolicy,
  };
  const historicalProofWorkerSession = (
    ownsCanonicalPolicy
    && Number(loadedPolicy?.schemaVersion) >= 2
    && previousPolicyState.policy
    && historicalDerivedAliasProofCache === null
  )
    ? startP4StateWriterHistoricalProofWorker({
      request: {
        identity: buildHistoricalDerivedAliasProofIdentity(
          workerIdentityInputs,
        ),
        previousPolicy: previousPolicyState.policy,
        policy: loadedPolicy,
      },
    })
    : null;
  const inventoryPromise = scanStateWriterPolicySnapshot(loadedPolicy, {
    repositoryScanCache,
  });
  const {
    inventory,
    workerSummary: historicalProofWorkerSummary,
  } = await joinP4StateWriterHistoricalProofWork({
    inventoryPromise,
    workerSession: historicalProofWorkerSession,
  });
  const validation = validateStateWriterPolicySnapshot({
    policy: loadedPolicy,
    legacyAllowlistPaths: inventory.legacyAllowlistPaths,
    scans: inventory.scans,
    actionDelegations: inventory.actionDelegations,
  });
  const defaultStateReport = await buildDefaultStateOwnershipReport();
  const defaultState = compareDefaultStateBaselines(
    loadedPolicy,
    defaultStateReport,
  );
  const currentLegacySemanticAuthority =
    buildLegacyStateWriterSemanticAuthority(loadedPolicy?.writers);
  const unbaselinedLegacyDiagnosticCounts =
    buildUnbaselinedLegacyDiagnosticCounts({
      legacySemanticAuthority: currentLegacySemanticAuthority,
      derivedAliasTaint:
        loadedPolicy?.baselines?.derivedAliasTaint,
    });
  const currentProgressMetrics = {
    productionLegacyDirectFiles:
      validation.metrics.legacyDirectFiles.production,
    productionLegacyMemberships:
      validation.metrics.legacyMemberships.production,
    productionLegacyDynamicSites:
      validation.metrics.bindingScoped.sites.dynamic.production.legacyCombined,
    productionLegacyAliasSites:
      validation.metrics.bindingScoped.sites.alias.production.legacyCombined,
    productionLegacyAmbiguousSites:
      unbaselinedLegacyDiagnosticCounts.ambiguousSites,
    productionLegacyUnsupportedSites:
      unbaselinedLegacyDiagnosticCounts.unsupportedSites,
  };
  const progression = validateStateWriterPolicyProgression({
    previousPolicy: loadedPolicy,
    phase: normalizedPhase,
    currentMetrics: currentProgressMetrics,
  });
  let acceptedPolicyCheckpoint = null;
  const acceptedPolicyCheckpointViolations = [];
  if (previousPolicyState.policy) {
    try {
      acceptedPolicyCheckpoint =
        resolveAcceptedStateWriterPolicyCheckpoint({
          policy: previousPolicyState.policy,
          revision: previousPolicyState.revision === "injected"
            ? "HEAD"
            : previousPolicyState.revision,
        });
    } catch (error) {
      acceptedPolicyCheckpointViolations.push({
        code: "accepted-policy-checkpoint-resolution-failed",
        revision: previousPolicyState.revision,
        message: String(error?.message || error),
      });
    }
  }
  let expectedDerivedAliasTaintBaseline = null;
  const derivedAliasTaintProofViolations = [];
  if (Number(loadedPolicy?.schemaVersion) >= 2) {
    try {
      if (historicalProofWorkerSession) {
        const workerSummary = historicalProofWorkerSummary;
        const expectedIdentity = buildHistoricalDerivedAliasProofIdentity(
          workerIdentityInputs,
        );
        const scannedStrictProductionPaths = Object.entries(
          inventory?.derivedAliasTaintModeManifest?.modeByPath || {},
        )
          .filter(([relativePath, mode]) => (
            !relativePath.startsWith("tests/") && mode === "strict"
          ))
          .map(([relativePath]) => relativePath)
          .sort((left, right) => left.localeCompare(right));
        const expectedPaths = [...new Set([
          ...(previousPolicyState.policy?.baselines?.derivedAliasTaint?.paths || []),
          ...scannedStrictProductionPaths,
        ])].map(String).sort((left, right) => left.localeCompare(right));
        if (!isDeepStrictEqual(expectedPaths, workerCandidatePaths)) {
          const error = new Error(
            "P4 historical proof worker candidate paths do not match the current repository scan.",
          );
          error.code = "p4-historical-proof-worker-path-identity-mismatch";
          throw error;
        }
        expectedDerivedAliasTaintBaseline =
          validateP4StateWriterHistoricalProofResult({
            workerSummary,
            expectedIdentity,
            expectedProof: loadedPolicy.baselines.derivedAliasTaint,
          });
      } else {
        expectedDerivedAliasTaintBaseline =
          await recomputeDerivedAliasTaintBaseline({
            previousPolicy: previousPolicyState.policy,
            currentPolicy: loadedPolicy,
            historicalDerivedAliasProofCache,
            candidatePaths: Object.keys(
              inventory?.derivedAliasTaintModeManifest?.modeByPath
                || {},
            ),
          });
      }
    } catch (error) {
      derivedAliasTaintProofViolations.push({
        code: "derived-alias-taint-baseline-source-proof-failed",
        message: String(error?.message || error),
      });
    }
  }
  const transitionViolations = previousPolicyState.policy
    ? validateStateWriterPolicyTransition({
      previousPolicy: previousPolicyState.policy,
      currentPolicy: loadedPolicy,
      expectedDerivedAliasTaintBaseline,
    })
    : validateDerivedAliasTaintBaselineTransition({
      previousSchemaVersion: 1,
      currentSchemaVersion: loadedPolicy?.schemaVersion,
      previousPhase: previousPolicyState.policy?.progress?.latestPhase,
      currentPhase: loadedPolicy?.progress?.latestPhase,
      currentBaseline:
        loadedPolicy?.baselines?.derivedAliasTaint,
      expectedBaseline: expectedDerivedAliasTaintBaseline,
    });
  const transitionCheckpointProofViolations =
    validateDerivedAliasTaintTransitionCheckpointProof({
      previousPolicy: previousPolicyState.policy,
      currentPolicy: loadedPolicy,
      acceptedPolicyCheckpoint,
    });
  const frozenProgressViolations = previousPolicyState.policy
    ? []
    : validateFrozenP4ProgressCheckpoint(loadedPolicy);
  const effectiveLoadedLegacySemanticAuthority =
    composeLegacySemanticBaseline({
      legacyBaseline:
        loadedPolicy?.baselines?.legacySemanticAuthority,
      derivedAliasTaint:
        loadedPolicy?.baselines?.derivedAliasTaint,
    });
  const violations = [
    ...validation.violations,
    ...inventory.unknownCandidateBindings.map((binding) => ({
      code: "unknown-candidate-binding",
      binding,
    })),
    ...inventory.stalePolicyBindings.map((binding) => ({
      code: "stale-policy-binding",
      binding,
    })),
    ...defaultState.violations,
    ...progression.violations,
    ...frozenProgressViolations,
    ...identity.violations,
    ...previousPolicyState.violations,
    ...acceptedPolicyCheckpointViolations,
    ...derivedAliasTaintProofViolations,
    ...transitionViolations,
    ...transitionCheckpointProofViolations,
    ...validateFrozenCloseoutTargets(loadedPolicy?.baselines),
    ...validateLegacyStateWriterSemanticAuthority({
      baseline: effectiveLoadedLegacySemanticAuthority,
      writers: loadedPolicy?.writers,
    }).violations,
    ...(previousPolicyState.policy
      ? []
      : validateLegacyStateWriterSemanticLedger({
        baseline: effectiveLoadedLegacySemanticAuthority,
        writers: loadedPolicy?.writers,
        retired:
          loadedPolicy?.progress?.retiredLegacySemanticAuthority,
      }).violations),
    ...validateTestDiagnosticBudget({
      baseline: loadedPolicy?.baselines?.testDiagnosticBudget,
      current: validation.metrics.bindingScoped.diagnostics.test,
    }),
  ];
  try {
    resolveGitCommitSha(sourceBaseSha);
  } catch (error) {
    violations.push({
      code: "source-base-sha-invalid",
      sourceBaseSha,
      message: error.message,
    });
  }
  if (policyLatestPhase !== normalizedPhase) {
    violations.push({
      code: "policy-phase-mismatch",
      requestedPhase: normalizedPhase,
      policyLatestPhase,
    });
  }
  const frozenMemberships =
    loadedPolicy?.baselines?.bindingScopedMemberships || {};
  const targets = loadedPolicy?.baselines?.closeoutTargets || {};
  violations.push(...buildStateWriterCloseoutTargetViolations({
    phase: normalizedPhase,
    currentMetrics: currentProgressMetrics,
    targets,
  }));
  return {
    schemaVersion: 1,
    phase: normalizedPhase,
    sourceBaseSha,
    verificationSha: identity.verificationSha,
    verificationIdentity: identity,
    policyPath: path
      .relative(PROJECT_ROOT, STATE_WRITER_POLICY_PATH)
      .replaceAll("\\", "/"),
    policyBaseline: loadedPolicy.baseline,
    verdict: violations.length ? "fail" : "pass",
    violations,
    metrics: {
      ...validation.metrics,
      policyWriters: loadedPolicy.writers.length,
      policyBindings: loadedPolicy.writers.reduce(
        (count, writer) => count + (writer.bindings || []).length,
        0,
      ),
      unknownCandidateBindings: inventory.unknownCandidateBindings.length,
      stalePolicyBindings: inventory.stalePolicyBindings.length,
    },
    frozenMetrics: {
      legacyDirectFiles: loadedPolicy?.baselines?.legacyDirectFiles || {},
      bindingScopedMemberships: frozenMemberships,
      bindingScopedSites:
        loadedPolicy?.baselines?.bindingScopedSites || {},
      testDiagnosticBudget:
        loadedPolicy?.baselines?.testDiagnosticBudget || null,
    },
    progress: {
      policy: loadedPolicy.progress || null,
      current: currentProgressMetrics,
      validation: progression,
      previousPolicyRevision: previousPolicyState.revision,
      transitionViolations,
    },
    targets,
    defaultState,
  };
}

export async function writeStateWriterPolicyReport(
  report,
  { jsonOut = "" } = {},
) {
  const outputPath = jsonOut
    ? path.resolve(PROJECT_ROOT, jsonOut)
    : path.join(
      DEFAULT_REPORT_ROOT,
      report.phase,
      "policy-report.json",
    );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildStateWriterPolicyReport({
    phase: args.phase,
    requireClean: args.requireClean,
  });
  const outputPath = await writeStateWriterPolicyReport(report, {
    jsonOut: args.jsonOut,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(
      `P4 state writer policy ${report.verdict}: ${report.metrics.legacyDirectFiles.production} production + ${report.metrics.legacyDirectFiles.test} test legacy-direct files; report ${path.relative(PROJECT_ROOT, outputPath).replaceAll("\\", "/")}.`,
    );
    if (report.violations.length) {
      for (const violation of report.violations) {
        console.error(`  ${violation.code}: ${JSON.stringify(violation)}`);
      }
    }
  }
  process.exitCode = report.verdict === "pass" ? 0 : 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
