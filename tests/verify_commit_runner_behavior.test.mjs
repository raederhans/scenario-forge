import assert from "node:assert/strict";
import test from "node:test";
import { bindSelectionToPreparedCatalog, buildExecutionPlan, executeAdaptivePlan } from "../tools/run_adaptive_tests.mjs";
import { prepareRepositoryVerificationCatalogBinding, prepareVerificationCatalog } from "../tools/verification/script_portfolio.mjs";
import { buildPrCostObservation } from "../tools/verification/verification_profile.mjs";
import { VERIFICATION_CATALOG_SOURCE_FILES } from "../tools/verification/catalog/source_files.mjs";
import {
  buildCommitVerificationPlan,
  buildCommitExecutionPlan,
  discoverChangedFiles as discoverCommitChangedFiles,
  parsePorcelainChangedFiles,
  parseCommitVerificationArgs,
  runCommitVerification,
  runCommitVerificationCli,
} from "../tools/run_commit_verification.mjs";

const SELECTOR_REF = "node tools/select_verification_targets.mjs --check";
const CONTROL_FILE = "tools/run_commit_verification.mjs";
const PRODUCT_FILE = "js/core/renderer/border_mesh_owner.js";
const catalogBinding = prepareRepositoryVerificationCatalogBinding();
const preparedCatalog = catalogBinding.preparedCatalog;
const CONTROL_REFS = buildCommitVerificationPlan([CONTROL_FILE]).requiredCanonicalCommandRefs;
const executionFor = (files) => buildCommitExecutionPlan(buildCommitVerificationPlan(files), { catalogBinding });
const mergedPlan = (report, refs = CONTROL_REFS) => buildExecutionPlan(report, {
  preparedCatalog, packageScripts: preparedCatalog.sourceInputs.packageScripts,
  requiredCanonicalCommandRefs: refs,
});

test("commit classifies shared sources without dropping product obligations", () => {
  const control = buildCommitVerificationPlan([CONTROL_FILE]);
  assert.equal(control.mode, "control-plane");
  assert.deepEqual(control.productFiles, []);
  assert.equal(control.requiredCanonicalCommandRefs.length, 4);
  assert.ok(control.requiredCanonicalCommandRefs.includes(SELECTOR_REF));
  const shared = buildCommitVerificationPlan(["package.json"]);
  assert.equal(shared.mode, "control-plane+adaptive-edit");
  assert.deepEqual(shared.productFiles, ["package.json"]);
  assert.deepEqual(shared.requiredCanonicalCommandRefs, control.requiredCanonicalCommandRefs);
  assert.equal(shared.commands.some(([, args]) => args[0] === "--test"), false);
  assert.equal(shared.commands.some(([, args]) => args.includes("tools/run_adaptive_tests.mjs")), false);
});

test("split catalog modules retain exact commit control-plane coverage", () => {
  const baseline = buildCommitVerificationPlan(["tools/verification/verification_catalog_source.mjs"]);
  assert.equal(baseline.mode, "control-plane+adaptive-edit");
  for (const file of VERIFICATION_CATALOG_SOURCE_FILES) {
    const plan = buildCommitVerificationPlan([file]);
    assert.equal(plan.mode, baseline.mode, file);
    assert.deepEqual(plan.commands, baseline.commands, file);
    assert.deepEqual(plan.requiredCanonicalCommandRefs, baseline.requiredCanonicalCommandRefs, file);
    assert.deepEqual(plan.productFiles, [file]);
  }
  for (const file of ["tools/verification/catalog/unregistered.mjs", "tools/verification/catalog/source_files.mjs.bak", "tools/verification/catalog-other/policies.mjs"]) {
    const plan = buildCommitVerificationPlan([file]);
    assert.equal(plan.mode, "adaptive-edit", file);
    assert.deepEqual(plan.requiredCanonicalCommandRefs, [SELECTOR_REF]);
  }
});

test("commit runner discovers unstaged, staged, and untracked paths from porcelain", () => {
  assert.deepEqual(parsePorcelainChangedFiles([
    " M unstaged.js",
    "M  staged.py",
    "?? untracked.mjs",
  ].join("\0") + "\0"), ["staged.py", "unstaged.js", "untracked.mjs"]);
  const renamedFiles = parsePorcelainChangedFiles("R  docs/renamed.md\0js/core/scenario_chunk_manager.js\0");
  assert.deepEqual(renamedFiles, [
    "docs/renamed.md",
    "js/core/scenario_chunk_manager.js",
  ]);
  const renamedPlan = buildCommitVerificationPlan(renamedFiles);
  assert.equal(renamedPlan.mode, "adaptive-edit");
  assert.deepEqual(renamedPlan.productFiles, renamedFiles);
  assert.throws(() => parsePorcelainChangedFiles("M malformed\0"), /verify-commit-porcelain-malformed/);

  const calls = [];
  assert.deepEqual(discoverCommitChangedFiles({
    runner: (bin, args) => {
      calls.push([bin, args]);
      return { status: 0, stdout: " M unstaged.js\0M  staged.py\0?? untracked.mjs\0" };
    },
  }), ["staged.py", "unstaged.js", "untracked.mjs"]);
  assert.deepEqual(calls, [["git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"]]]);
});

test("commit runner CLI takes explicit changed files and fails closed for malformed input", () => {
  assert.deepEqual(parseCommitVerificationArgs([
    "--changed-file", "js/core/scenario_chunk_manager.js",
    "--changed-file", "js/core/scenario_chunk_manager.js",
  ]), {
    changedFiles: ["js/core/scenario_chunk_manager.js"],
    hasExplicitChangedFiles: true,
  });
  assert.throws(() => parseCommitVerificationArgs(["--unknown"]), /verify-commit-cli-unknown-arg/);
  assert.throws(() => parseCommitVerificationArgs(["--changed-file"]), /verify-commit-cli-changed-file-missing/);

  const calls = [];
  assert.equal(runCommitVerificationCli(["--changed-file", PRODUCT_FILE], {
    runner: (bin, args) => { calls.push([bin, args]); return { status: 0 }; },
  }), 0);
  assert.equal(calls.some(([bin]) => bin === "git"), false);
  assert.deepEqual(
    calls.filter(([bin, args]) => bin === "node" && args[0] === "--test").flatMap(([, args]) => args.slice(1)),
    ["tests/border_mesh_owner_behavior.test.mjs", "tests/state_owner_borrowed_storage_behavior.test.mjs"],
  );
});

test("commit executes canonical controls once through platform preflight and shared executor", () => {
  const calls = [];
  const status = runCommitVerification({
    changedFiles: [CONTROL_FILE],
    runner: (bin, args) => { calls.push([bin, args]); return { status: 0 }; },
  });
  assert.equal(status, 0);
  if (process.platform === "win32") {
    assert.equal(calls[0][0], process.env.ComSpec || "cmd.exe");
    assert.deepEqual(calls[0][1], ["/d", "/s", "/c", "npm run verify:script-portfolio"]);
  } else {
    assert.equal(calls[0][0], "npm");
    assert.deepEqual(calls[0][1], ["run", "verify:script-portfolio"]);
  }
  const planned = executionFor([CONTROL_FILE]);
  assert.equal(planned.exitCode, 0);
  assert.equal(calls.length, 2 + planned.executionPlan.executionCommands.length);
  for (const file of ["verification_metadata", "verification_script_portfolio", "verify_core_runner", "verify_commit_runner"]) {
    assert.equal(calls.flatMap(([, args]) => args).filter((arg) => arg === `tests/${file}_behavior.test.mjs`).length, 1, file);
  }
  assert.equal(calls.filter(([, args]) => args[0] === "tools/select_verification_targets.mjs").length, 1);
  assert.equal(calls.flatMap(([, args]) => args).includes("tests/catalog_projection_shadow_behavior.test.mjs"), false);
  assert.equal(planned.productPlan.executionCommands.length, 0);
  assert.deepEqual(planned.report.selectorRootSet, []);
  assert.equal(planned.executionPlan.requiredRootOutcomes.every((root) => root.disposition !== "gap"), true);
});

test("registered product edits retain import integrity and focused behavior only", () => {
  const plan = buildCommitVerificationPlan([PRODUCT_FILE]);
  assert.deepEqual(plan.commands, [["npm", ["run", "verify:test-import-graph"]]]);
  assert.deepEqual(plan.requiredCanonicalCommandRefs, []);
  const result = executionFor([PRODUCT_FILE]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.executionPlan.selectedLeaves.map((leaf) => leaf.target), [
    "tests/border_mesh_owner_behavior.test.mjs",
    "tests/state_owner_borrowed_storage_behavior.test.mjs",
  ]);
  for (const extra of ["js/new_unregistered_module.js", "package.json", "tests/example.test.mjs", "data/example.json"]) {
    const escalated = buildCommitVerificationPlan([PRODUCT_FILE, extra]);
    assert.ok(escalated.commands.some(([, args]) => args.includes("verify:script-portfolio")), extra);
    assert.ok(escalated.requiredCanonicalCommandRefs.includes(SELECTOR_REF), extra);
    assert.ok(escalated.productFiles.includes(extra), extra);
  }
});

test("commit fails before spawning when unknown product coverage accompanies fixed controls", () => {
  let calls = 0;
  const changedFiles = [CONTROL_FILE, "unknown.commit-regression"];
  const result = executionFor(changedFiles);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.report.unmatchedChangedFiles, ["unknown.commit-regression"]);
  assert.equal(runCommitVerification({ changedFiles, runner: () => { calls += 1; return { status: 0 }; } }), 2);
  assert.equal(calls, 0);
});

test("commit stops after preflight or canonical process failures including signals and spawn errors", () => {
  for (const failure of [{ status: 7 }, { status: null, signal: "SIGTERM" }, { status: null, error: new Error("spawn failed") }]) {
    const calls = [];
    const code = runCommitVerification({
      changedFiles: [CONTROL_FILE],
      runner: (bin, args) => { calls.push([bin, args]); return calls.length === 3 ? failure : { status: 0 }; },
    });
    assert.equal(code, failure.status || 1);
    assert.equal(calls.length, 3);
  }
  let calls = 0;
  assert.equal(runCommitVerification({ changedFiles: [PRODUCT_FILE], runner: () => { calls += 1; return { status: 9 }; } }), 9);
  assert.equal(calls, 1);
});

test("required canonical roots preserve selector provenance and reject unknown or unsafe authority", () => {
  const { report } = executionFor([PRODUCT_FILE]);
  const original = structuredClone(report);
  for (const refs of [["unregistered:command"], [CONTROL_REFS[0], CONTROL_REFS[0]], [null], "bad"]) {
    const plan = mergedPlan(report, refs);
    assert.ok(plan.routeGaps.length > 0);
    let calls = 0;
    assert.deepEqual(executeAdaptivePlan(plan, { runner: () => { calls += 1; return { status: 0 }; } }), []);
    assert.equal(calls, 0);
  }
  const mainThread = preparedCatalog.authority.find((entry) => entry.executionOwner === "main-thread");
  assert.ok(mainThread);
  assert.ok(mergedPlan(report, [mainThread.commandRef]).routeGaps.length > 0);
  const windowsOnly = preparedCatalog.authority.find((entry) => entry.executionOwner === "child-safe" && entry.platforms.includes("win32") && !entry.platforms.includes("all"));
  assert.ok(windowsOnly);
  const platformPlan = buildExecutionPlan(report, { preparedCatalog, platform: "linux", requiredCanonicalCommandRefs: [windowsOnly.commandRef] });
  assert.ok(platformPlan.routeGaps.length > 0);
  const corrupt = structuredClone(report);
  corrupt.catalogDigest = "invalid";
  assert.ok(mergedPlan(corrupt).routeGaps.length > 0);
  assert.deepEqual(report, original);
});

test("required roots reject incomplete, CI-only, blocked, or incompatible fixture metadata", () => {
  const emptyReport = executionFor([CONTROL_FILE]).report;
  const ref = "test:node:verification-metadata";
  for (const [mutate, gapCode] of [
    [(entry) => { entry.executionOwner = "ci-only"; entry.executionOwners = ["ci-only"]; entry.entrypointPolicy.executionTarget = "main-thread"; }, "adaptive-selection-cross-disposition"],
    [(entry) => { entry.entrypointPolicy.plannerDisposition = "blocked"; entry.entrypointPolicy.blockedReason = "fixture-blocked"; }, "adaptive-required-root-not-executable"],
    [(entry) => { entry.platforms = [process.platform === "win32" ? "linux" : "win32"]; }, "adaptive-required-root-not-executable"],
  ]) {
    const entry = structuredClone(preparedCatalog.authority.find((entry) => entry.commandRef === ref));
    mutate(entry);
    const fixture = prepareVerificationCatalog({ authority: [entry], selectorCommandRefs: [ref], packageScripts: preparedCatalog.sourceInputs.packageScripts });
    const report = bindSelectionToPreparedCatalog(emptyReport, fixture);
    report.prCost = buildPrCostObservation({ selectorReport: report, observationStage: "selector" });
    const plan = buildExecutionPlan(report, { preparedCatalog: fixture, requiredCanonicalCommandRefs: [ref] });
    assert.ok(plan.routeGaps.some((gap) => gap.code === gapCode), JSON.stringify(plan.routeGaps));
    assert.deepEqual(plan.executionCommands, []);
  }
  const incompleteCatalog = structuredClone(preparedCatalog);
  incompleteCatalog.authority.find((entry) => entry.commandRef === ref).metadataComplete = false;
  const incomplete = buildExecutionPlan(emptyReport, { preparedCatalog: incompleteCatalog, requiredCanonicalCommandRefs: [ref] });
  assert.ok(incomplete.routeGaps.some((gap) => gap.code === "adaptive-required-root-authority-missing"));
});

test("canonical union executes overlapping control and infra leaves once with both root provenances", () => {
  const changedFiles = ["tools/verification/script_portfolio.mjs"];
  const { report, executionPlan: plan, exitCode, productPlan } = executionFor(changedFiles);
  const before = structuredClone(report);
  assert.equal(exitCode, 0);
  assert.deepEqual(plan.routeGaps, []);
  assert.equal(productPlan.localEntrypointBudget.status, "ready");
  const calls = [];
  assert.equal(runCommitVerification({ changedFiles, runner: (bin, args) => { calls.push([bin, args]); return { status: 0 }; } }), 0);
  assert.equal(calls.length, 2 + plan.executionCommands.length);
  const args = calls.flatMap(([, argv]) => argv);
  for (const file of ["verification_metadata", "verification_profile", "verification_script_portfolio", "verify_core_runner", "verify_commit_runner"]) {
    assert.equal(args.filter((arg) => arg === `tests/${file}_behavior.test.mjs`).length, 1, file);
  }
  assert.equal(args.filter((arg) => arg === "tests.test_e2e_structural_tooling").length, 1);
  assert.equal(args.includes("tests/catalog_projection_shadow_behavior.test.mjs"), false);
  assert.equal(args.filter((arg) => arg === "tools/select_verification_targets.mjs").length, 1);
  for (const [file, controlRoot] of [
    ["verification_metadata", "test:node:verification-metadata"],
    ["verification_script_portfolio", "test:node:verification-script-portfolio"],
    ["verify_core_runner", "test:node:verify-core-runner"],
    ["verify_commit_runner", "test:node:verify-core-runner"],
  ]) {
    const leaf = plan.selectedLeaves.find((leaf) => leaf.target === `tests/${file}_behavior.test.mjs`);
    assert.ok(leaf.sourceRootRefs.includes("verify:local-infra"));
    assert.ok(leaf.sourceRootRefs.includes(controlRoot));
    assert.equal(plan.selectorRootOutcomes.find((entry) => entry.commandRef === controlRoot).disposition, "deferred-by-tier");
    assert.notEqual(plan.requiredRootOutcomes.find((entry) => entry.commandRef === controlRoot).disposition, "gap");
  }
  assert.deepEqual(report, before);
  assert.equal(new Set(plan.selectedLeaves.map((leaf) => leaf.leafId)).size, plan.selectedLeaves.length);
});

test("fixed controls cannot repair an already over-budget product plan", () => {
  const result = executionFor(["package.json"]);
  assert.equal(result.exitCode, 2);
  assert.ok(result.productPlan.routeGaps.some((gap) => gap.code === "adaptive-edit-runtime-budget-exceeded"));
  assert.equal(result.executionPlan, result.productPlan);
  assert.deepEqual(result.executionPlan.requiredCanonicalCommandRefs, []);
  let calls = 0;
  assert.equal(runCommitVerification({ changedFiles: ["package.json"], runner: () => { calls += 1; return { status: 0 }; } }), 2);
  assert.equal(calls, 0);
});

test("required root cannot promote a leaf already deferred to main-thread ownership", () => {
  const ref = "test:node:verification-metadata";
  const required = structuredClone(preparedCatalog.authority.find((entry) => entry.commandRef === ref));
  const deferred = structuredClone(required);
  deferred.commandRef = "fixture:main";
  deferred.executionOwner = "main-thread";
  deferred.executionOwners = ["main-thread"];
  deferred.entrypointPolicy.executionTarget = "main-thread";
  const scripts = { [ref]: "node --test tests/shared.test.mjs", "fixture:main": "node --test tests/shared.test.mjs" };
  const fixture = prepareVerificationCatalog({ authority: [required, deferred], selectorCommandRefs: [ref, deferred.commandRef], packageScripts: scripts });
  const contributor = {
    ...deferred, disposition: "main-thread", batchSafe: false, isolation: "process", maxLeaves: 64,
    maxArgvBytes: process.platform === "win32" ? 30000 : 131072,
    provenance: { routeIds: deferred.routeIds, safetyContributorRouteIds: deferred.safetyContributorRouteIds },
  };
  const report = bindSelectionToPreparedCatalog({
    schemaVersion: 1, selectionPlatform: process.platform, changedFiles: [],
    recommendedCommands: [contributor], childAgentStaticTasks: [], mainThreadSerialVerification: [contributor],
    ciOnlyVerification: [], blockedVerification: [], matchedByFile: [], unmatchedChangedFiles: [],
  }, fixture);
  report.prCost = buildPrCostObservation({ selectorReport: report, observationStage: "selector" });
  const plan = buildExecutionPlan(report, { preparedCatalog: fixture, packageScripts: scripts, requiredCanonicalCommandRefs: [ref] });
  assert.ok(plan.routeGaps.some((gap) => gap.code === "adaptive-required-root-deferred-conflict"), JSON.stringify(plan.routeGaps));
  let calls = 0;
  assert.deepEqual(executeAdaptivePlan(plan, { runner: () => { calls += 1; return { status: 0 }; } }), []);
  assert.equal(calls, 0);
});

function controlPlaneFixture() {
  return {
    canonicalEntrypoints: { tier: [{
      id: "commit",
      commitProjection: {
        controlPlaneRecordIds: ["infra", "commit"],
        controlPlaneCommandRefs: ["test:control"],
      },
    }] },
    records: [
      { id: "infra", sourceRefs: ["tools/infra.mjs", "package.json"] },
      { id: "commit", sourceRefs: ["tools/run_commit_verification.mjs"] },
      { id: "product", sourceRefs: ["js/product.js", "package.json"] },
    ],
  };
}

test("commit control-plane records form a union without masking shared product ownership", () => {
  const metadataSource = controlPlaneFixture();
  for (const file of ["tools/infra.mjs", "tools/run_commit_verification.mjs"]) {
    assert.equal(buildCommitVerificationPlan([file], { metadataSource }).mode, "control-plane");
  }
  const shared = buildCommitVerificationPlan(["package.json"], { metadataSource });
  assert.equal(shared.mode, "control-plane+adaptive-edit");
  assert.deepEqual(shared.productFiles, ["package.json"]);
  const mixed = buildCommitVerificationPlan(["tools/run_commit_verification.mjs", "js/product.js"], { metadataSource });
  assert.equal(mixed.mode, "control-plane+adaptive-edit");
  assert.deepEqual(mixed.productFiles, ["js/product.js"]);
  assert.ok(mixed.commands.some(([, args]) => args.includes("verify:script-portfolio")));
});

test("commit control-plane configuration rejects empty duplicate and missing record IDs", () => {
  for (const ids of [undefined, [], [""], ["   "], [null]]) {
    const metadataSource = controlPlaneFixture();
    metadataSource.canonicalEntrypoints.tier[0].commitProjection.controlPlaneRecordIds = ids;
    assert.throws(() => buildCommitVerificationPlan([], { metadataSource }), /record-ids-invalid/);
  }
  const duplicateIds = controlPlaneFixture();
  duplicateIds.canonicalEntrypoints.tier[0].commitProjection.controlPlaneRecordIds = ["infra", "infra"];
  assert.throws(() => buildCommitVerificationPlan([], { metadataSource: duplicateIds }), /record-ids-duplicate/);
  const missing = controlPlaneFixture();
  missing.records = missing.records.filter((record) => record.id !== "commit");
  assert.throws(() => buildCommitVerificationPlan([], { metadataSource: missing }), /record-missing:commit/);
  const duplicateRecord = controlPlaneFixture();
  duplicateRecord.records.push({ ...duplicateRecord.records[1] });
  assert.throws(() => buildCommitVerificationPlan([], { metadataSource: duplicateRecord }), /record-duplicate:commit/);
});

test("commit control-plane configuration rejects missing or duplicate canonical command refs", () => {
  for (const refs of [undefined, [], [null], [" "], ["test:control", "test:control"]]) {
    const metadataSource = controlPlaneFixture();
    metadataSource.canonicalEntrypoints.tier[0].commitProjection.controlPlaneCommandRefs = refs;
    assert.throws(() => buildCommitVerificationPlan([CONTROL_FILE], { metadataSource }), /command-refs-invalid/);
  }
});
