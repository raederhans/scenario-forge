import { isDeepStrictEqual } from "node:util";

import {
  buildStateWriterPolicySnapshot,
  discoverCandidatePaths,
  discoverScannedCandidateBindings,
  readLegacyStateWriterAllowlist,
  readStateWriterPolicy,
} from "../build_state_writer_policy.mjs";
import { buildStateWriterPolicyReport } from "../check_state_writer_policy.mjs";
import {
  validateP4RepositoryAnalysisBundleForChecker,
  validateP4RepositoryAnalysisBundleForManifest,
} from "./p4_repository_analysis_bundle.mjs";
import {
  createGitP4RepositoryAnalysisReader,
  produceGitBackedP4RepositoryAnalysisBundle,
} from "./p4_repository_analysis_bundle_git.mjs";
import { validateP4RepositoryAnalysisDigestReceipt } from "./p4_repository_analysis_bundle_receipt.mjs";

export const STATE_WRITER_REPOSITORY_ANALYSIS_FACTS_KIND =
  "state-writer-repository-analysis-facts";

export const STATE_WRITER_REPOSITORY_ANALYSIS_AUTHORITY_PATHS = Object.freeze({
  scanner: Object.freeze([
    "tools/build_state_writer_policy.mjs",
    "tools/state_writer_inventory.mjs",
    "tools/state_action_delegation_contract.mjs",
    "tools/state_borrowed_effect_contract.mjs",
    "tools/state_writer_policy.mjs",
    "tools/p4_state_action_phases.mjs",
  ]),
  policy: Object.freeze(["tools/state_writer_policy.json"]),
  config: Object.freeze([
    "tools/eslint-rules/state-writer-allowlist.json",
    "package.json",
    "package-lock.json",
  ]),
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateStateWriterFacts(facts) {
  if (
    !facts
    || facts.kind !== STATE_WRITER_REPOSITORY_ANALYSIS_FACTS_KIND
    || facts.schemaVersion !== 1
    || !Array.isArray(facts.legacyAllowlistPaths)
    || !facts.repositoryScan
    || !Array.isArray(facts.repositoryScan.candidates)
    || !Array.isArray(facts.repositoryScan.actionDelegations)
    || !facts.repositoryScan.derivedAliasTaintModeManifest
  ) {
    fail("p4-repository-analysis-state-writer-facts-invalid", "State-writer repository facts are incomplete.");
  }
  return facts;
}

function createRepositoryScanCache({ previousPolicy, baseSha, legacyAllowlistPaths, facts }) {
  const scanIdentity = JSON.stringify({
    baseSha: previousPolicy?.baseline?.sourceBaseSha || baseSha,
    legacyAllowlistPaths,
    refreshP4Baseline: false,
  });
  return new Map([[
    previousPolicy || null,
    new Map([[scanIdentity, Promise.resolve(facts.repositoryScan)]]),
  ]]);
}

function expectedFromReceipt(receipt, expectedReceiptDigest) {
  return validateP4RepositoryAnalysisDigestReceipt({ receipt, expectedReceiptDigest });
}

function validateReceiptBundleBinding(receipt, bundle) {
  if (
    receipt.factsDigest !== bundle.factsDigest
    || !isDeepStrictEqual(receipt.inputClosure, bundle.inputClosure)
  ) {
    fail(
      "p4-repository-analysis-receipt-bundle-mismatch",
      "Trusted receipt does not bind the supplied bundle facts and input closure.",
    );
  }
}

export async function produceStateWriterRepositoryAnalysisBundle({
  cwd = process.cwd(),
  sourceRef = "HEAD",
  previousPolicy = null,
  baseSha = "",
  runner,
} = {}) {
  const legacyAllowlistPaths = await readLegacyStateWriterAllowlist();
  const candidatePaths = await discoverCandidatePaths(legacyAllowlistPaths);
  const authorityPaths = STATE_WRITER_REPOSITORY_ANALYSIS_AUTHORITY_PATHS;
  const inputPaths = [...new Set([
    ...candidatePaths,
    ...authorityPaths.scanner,
    ...authorityPaths.policy,
    ...authorityPaths.config,
  ])];
  return produceGitBackedP4RepositoryAnalysisBundle({
    cwd,
    sourceRef,
    inputPaths,
    authorityPaths,
    ...(runner ? { runner } : {}),
    extractFacts: async () => ({
      schemaVersion: 1,
      kind: STATE_WRITER_REPOSITORY_ANALYSIS_FACTS_KIND,
      legacyAllowlistPaths,
      repositoryScan: await discoverScannedCandidateBindings(
        legacyAllowlistPaths,
        { previousPolicy, baseSha },
      ),
    }),
  });
}

export async function buildStateWriterPolicyReportFromRepositoryAnalysisBundle({
  bundle,
  receipt,
  expectedReceiptDigest,
  cwd = process.cwd(),
  repository = createGitP4RepositoryAnalysisReader({ cwd }),
  reportOptions = {},
} = {}) {
  const expected = expectedFromReceipt(receipt, expectedReceiptDigest);
  validateReceiptBundleBinding(receipt, bundle);
  const accepted = await validateP4RepositoryAnalysisBundleForChecker({
    bundle,
    expected,
    repository,
  });
  const facts = validateStateWriterFacts(accepted.facts);
  const policy = reportOptions.policy || await readStateWriterPolicy();
  const repositoryScanCache = createRepositoryScanCache({
    previousPolicy: policy,
    baseSha: policy?.baseline?.sourceBaseSha || "",
    legacyAllowlistPaths: facts.legacyAllowlistPaths,
    facts,
  });
  return buildStateWriterPolicyReport({
    ...reportOptions,
    policy,
    repositoryScanCache,
  });
}

export async function buildStateWriterPolicySnapshotFromRepositoryAnalysisBundle({
  bundle,
  receipt,
  expectedReceiptDigest,
  cwd = process.cwd(),
  repository = createGitP4RepositoryAnalysisReader({ cwd }),
  manifestOptions = {},
} = {}) {
  const expected = expectedFromReceipt(receipt, expectedReceiptDigest);
  validateReceiptBundleBinding(receipt, bundle);
  const accepted = await validateP4RepositoryAnalysisBundleForManifest({
    bundle,
    expected,
    repository,
  });
  const facts = validateStateWriterFacts(accepted.facts);
  if (manifestOptions.refreshP4Baseline === true) {
    fail(
      "p4-repository-analysis-manifest-shadow-mode-invalid",
      "Repository-analysis shadow adapters require refreshP4Baseline=false.",
    );
  }
  const previousPolicy = manifestOptions.previousPolicy || await readStateWriterPolicy();
  const repositoryScanCache = createRepositoryScanCache({
    previousPolicy,
    baseSha: manifestOptions.baseSha || "",
    legacyAllowlistPaths: facts.legacyAllowlistPaths,
    facts,
  });
  return buildStateWriterPolicySnapshot({
    ...manifestOptions,
    previousPolicy,
    repositoryScanCache,
  });
}
