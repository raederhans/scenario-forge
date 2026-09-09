import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { VERIFICATION_CATALOG_SOURCE_FILES } from "../tools/verification/catalog/source_files.mjs";
import {
  buildAdaptiveEntrypointRecommendation,
  constrainAdaptiveEntrypointSelection,
} from "../tools/run_adaptive_tests.mjs";
import { buildVerificationSelectionPlan, prepareRepositoryVerificationCatalog } from "../tools/verification/script_portfolio.mjs";
import {
  buildCoreVerificationPlan,
} from "../tools/run_core_verification.mjs";
import {
  buildRecommendation,
  buildRepositoryRecommendation,
} from "../tools/select_verification_targets.mjs";
import {
  buildNodeRoutes,
  buildRouteIndex,
  reconcileVerificationRouteAuthority,
  validateRouteIndex,
  validateDiscoveredRouteCoverage,
} from "../tools/test_route_registry.mjs";
import {
  VERIFICATION_DOMAINS,
} from "../tools/verification/verification_domains.mjs";
import {
  buildCanonicalCatalogProjections,
  buildCanonicalDocumentationProjection,
  buildCanonicalHeavyDependencyGroups,
  buildCanonicalNightlyTopology,
  buildCanonicalPackageAliases,
  buildCanonicalPrProfiles,
  normalizeVerificationMetadataSource,
  projectVerificationGatePolicySignals,
  VERIFICATION_GATE_POLICY_AUTHORITY,
  VERIFICATION_GATE_POLICY_AUTHORITY_IDENTITY,
  VERIFICATION_METADATA_SOURCE,
  VERIFICATION_METADATA_SOURCE_IDENTITY,
  verificationGatePolicySignalsDigest,
  verificationMetadataSourceDigest,
  verificationMetadataSourceSummary,
} from "../tools/verification/verification_catalog_projection.mjs";
import {
  buildVerificationMetadataRoutes,
  buildVerifyCoreDefaultGroups,
  buildVerifyCoreMainThreadGroup,
  getVerifyCoreOptionalMainThreadCommands,
  validateVerificationMetadata,
} from "../tools/verification/verification_metadata_helpers.mjs";

const REPO_ROOT = process.cwd();

test("reviewed city names select executable Python and Node regression routes", () => {
  const routes = buildRouteIndex();
  const python = routes.find((route) => route.id === "city:reviewed-place-names-python");
  const chinaPython = routes.find((route) => route.id === "city:tno-china-place-names-python");
  const node = routes.find((route) => route.id === "city:tno-reviewed-labels-node");
  assert.equal(python.executionOwner, "main-thread");
  assert.ok(python.resourceLocks.includes("heavy-geo"));
  assert.equal(node.executionOwner, "child-safe");
  const pythonFiles = ["tests/test_reviewed_place_names.py"];
  assert.equal(chinaPython.commandRef, "python -m unittest tests.test_tno_china_place_names -q");
  assert.equal(chinaPython.executionOwner, "child-safe");
  const nodeFiles = [
    "tests/tno_china_city_labels_behavior.test.mjs", "tests/tno_russia_city_labels_behavior.test.mjs",
    "tests/tno_eastern_city_labels_behavior.test.mjs", "tests/tno_burgundy_africa_city_labels_behavior.test.mjs",
  ];
  for (const file of pythonFiles) {
    assert.ok(python.commandRef.includes(file.replaceAll("/", ".").replace(/\.py$/, "")));
  }
  for (const file of nodeFiles) assert.ok(node.commandRef.includes(file));
  for (const [file, route] of [
    ...pythonFiles.map((file) => [file, python]), ...nodeFiles.map((file) => [file, node]),
    ["tests/test_tno_china_place_names.py", chinaPython],
    ["map_builder/cities.py", python], ["data/i18n/manual_geo_overrides.json", python],
    ["data/scenarios/tno_1962/geo_locale_patch.zh.json", python],
    ["data/world_cities.geojson", node], ["data/scenarios/tno_1962/city_overrides.json", node],
  ]) {
    const recommendation = buildRepositoryRecommendation([file]);
    assert.deepEqual(recommendation.unmatchedChangedFiles, [], file);
    assert.ok(recommendation.recommendedCommands.some((command) =>
      command.commandRef === route.commandRef), file);
  }
});

test("round two lifecycle regressions have executable local and reserved browser routes", () => {
  const routes = buildRouteIndex();
  const preparedCatalog = prepareRepositoryVerificationCatalog();
  const localCases = [
    ["tests/startup_data_pipeline_lifecycle_behavior.test.mjs", "test:node:startup-lifecycle"],
    ["tests/startup_interaction_lifecycle_behavior.test.mjs", "test:node:startup-lifecycle"],
    ["tests/project_import_completion_behavior.test.mjs", "test:node:project-import-lifecycle"],
    ["tests/project_package_stream_import_behavior.test.mjs", "test:node:project-import-lifecycle"],
    ["tests/scenario_import_trust_projection_behavior.test.mjs", "test:node:project-import-lifecycle"],
    ["tests/scenario_project_import_recovery_behavior.test.mjs", "test:node:project-import-lifecycle"],
    ["js/core/interaction_funnel/import_trust_projection.js", "test:node:project-import-lifecycle"],
    ["tests/legend_actions_behavior.test.mjs", "node --test tests/legend_actions_behavior.test.mjs"],
    ["js/core/legend_state_normalizers.js", "node --test tests/legend_actions_behavior.test.mjs"],
  ];
  for (const [file, commandRef] of localCases) {
    const selection = constrainAdaptiveEntrypointSelection(
      buildAdaptiveEntrypointRecommendation([file], routes, { entrypoint: "edit" }), "edit", { preparedCatalog },
    );
    assert.deepEqual(selection.unmatchedChangedFiles, [], file);
    assert.deepEqual(selection.localEntrypointRouteGaps, [], file);
    assert.ok(selection.recommendedCommands.some((command) => command.commandRef === commandRef), file);
  }
  const browser = routes.find((route) => route.id === "e2e:project-import-recovery-round2");
  assert.ok(browser.sourceRef.split(",").includes("tests/e2e/dev/project_import_recovery_round2.dev.spec.js"));
  assert.equal(browser.executionOwner, "main-thread");
  assert.ok(browser.resourceLocks.includes("playwright-browser"));
  assert.ok(browser.commandRef.includes("--workers=1 --retries=0"));
  const diagnostics = routes.find((route) => route.id === "node:test:node:render-transaction-diagnostics");
  assert.equal(diagnostics.commandRef, "test:node:render-transaction-diagnostics");
  assert.ok(diagnostics.sourceRef.split(",").includes("tests/renderer_transaction_diagnostics_actions_behavior.test.mjs"));
  assert.ok(diagnostics.sourceRef.split(",").includes("js/core/state/actions/renderer_transaction_diagnostics_actions.js"));
  assert.equal(diagnostics.entrypointPolicy.minimumDepth, "pr");
});

test("selector explicitly classifies task prose and agent config without inventing behavior coverage", () => {
  const files = [
    ".codex/config.toml",
    ...["business-efficiency-20260908", "development-recovery-m0-m1-20260907",
      "editing-response-v1-20260908", "editor-kernel-renewal-20260909"]
      .flatMap((task) => ["plan", "context", "task"].map((name) => `docs/active/${task}/${name}.md`)),
    "docs/active/business-efficiency-20260908/editing-analysis.md",
    "docs/active/business-efficiency-20260908/render-reuse-analysis.md",
  ];
  const report = buildRepositoryRecommendation(files);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.deepEqual(report.unroutedChangedFiles, [...files].sort());
  assert.equal(report.nonBehavioralChangedFiles.length, files.length);
  assert.deepEqual(report.recommendedCommands, []);
  assert.ok(report.matchedByFile.every((entry) => entry.matchedRouteIds.length === 0));
  assert.ok(report.nonBehavioralChangedFiles.every((entry) =>
    entry.disposition === "no-app-behavior-validation" && entry.behaviorTestsRun === false));
  assert.equal(report.nonBehavioralChangedFiles.find((entry) => entry.changedFile === ".codex/config.toml").classification,
    "agent-tool-config");
  assert.deepEqual(buildAdaptiveEntrypointRecommendation(files).unmatchedChangedFiles, []);
});

test("nonbehavioral classification preserves unknown-file rejection and actual runtime routes", () => {
  const unknown = [
    "docs/active/editor-kernel-renewal-20260909/new-runtime.js",
    "docs/active/editor-kernel-renewal-20260909/unknown-analysis.md",
    "docs/archive/unregistered/plan.md",
    ".codex/unknown.toml",
  ];
  const report = buildRepositoryRecommendation([
    "docs/active/editor-kernel-renewal-20260909/plan.md", ...unknown,
    "js/core/state/actions/project_import_actions.js", "docs/active/_worktree_registry.md",
  ]);
  assert.deepEqual(report.unmatchedChangedFiles, [...unknown].sort());
  assert.ok(report.recommendedCommands.some((entry) =>
    entry.commandRef === "node --test tests/project_import_transaction_behavior.test.mjs"));
  assert.ok(report.matchedByFile.find((entry) => entry.changedFile === "docs/active/_worktree_registry.md")
    .matchedRouteIds.length > 0);
});

test("repository route inventory validates schema and independently discovered coverage", () => {
  validateRouteIndex();
  validateDiscoveredRouteCoverage();
});

test("split catalog sources preserve explicit local edit and impact control-plane routes", () => {
  assert.ok(Object.isFrozen(VERIFICATION_CATALOG_SOURCE_FILES));
  assert.equal(new Set(VERIFICATION_CATALOG_SOURCE_FILES).size, VERIFICATION_CATALOG_SOURCE_FILES.length);
  assert.ok(VERIFICATION_CATALOG_SOURCE_FILES.includes("tools/verification/verification_catalog_source.mjs"));
  assert.ok(VERIFICATION_CATALOG_SOURCE_FILES.includes("tools/verification/catalog/source_files.mjs"));
  const catalogFiles = fs.readdirSync(path.join(REPO_ROOT, "tools/verification/catalog"), { recursive: true })
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => `tools/verification/catalog/${file.replaceAll("\\", "/")}`);
  assert.deepEqual([...VERIFICATION_CATALOG_SOURCE_FILES].sort(), [
    "tools/verification/verification_catalog_source.mjs", ...catalogFiles,
  ].sort());
  const routes = buildRouteIndex();
  const preparedCatalog = prepareRepositoryVerificationCatalog();
  for (const entrypoint of ["edit", "impact"]) {
    for (const file of VERIFICATION_CATALOG_SOURCE_FILES) {
      assert.ok(fs.statSync(path.join(REPO_ROOT, file)).isFile(), file);
      const selection = constrainAdaptiveEntrypointSelection(
        buildAdaptiveEntrypointRecommendation([file], routes, { entrypoint }), entrypoint, { preparedCatalog },
      );
      assert.deepEqual(selection.unmatchedChangedFiles, [], file);
      assert.deepEqual(selection.localEntrypointRouteGaps, [], file);
      assert.ok(selection.recommendedCommands.some(({ commandRef }) => commandRef === "verify:local-infra"), file);
    }
    const unknown = "tools/verification/catalog/unregistered.mjs";
    const selection = constrainAdaptiveEntrypointSelection(
      buildAdaptiveEntrypointRecommendation([unknown], routes, { entrypoint }), entrypoint, { preparedCatalog },
    );
    assert.ok(selection.unmatchedChangedFiles.length > 0 || selection.localEntrypointRouteGaps.length > 0);
  }
});

test("core runner edits use declared aggregate coverage without unrelated domain leaves", () => {
  const routes = buildRouteIndex();
  const preparedCatalog = prepareRepositoryVerificationCatalog();
  const file = "tools/run_core_verification.mjs";
  for (const entrypoint of ["edit", "impact"]) {
    const selection = constrainAdaptiveEntrypointSelection(
      buildAdaptiveEntrypointRecommendation([file], routes, { entrypoint }), entrypoint, { preparedCatalog },
    );
    assert.deepEqual(selection.unmatchedChangedFiles, [], file);
    assert.deepEqual(selection.localEntrypointRouteGaps, [], file);
    assert.deepEqual(selection.recommendedCommands.map(({ commandRef }) => commandRef), ["verify:local-infra"]);
    for (const command of selection.rawCanonicalRoots) {
      assert.notEqual(command.commandRef, "test:node:verification-profile", file);
      assert.notEqual(command.commandRef, "node tools/select_verification_targets.mjs --check", file);
    }
  }
});

test("renderer and scenario convergence selects owner behavior and live assembly coverage", () => {
  const cases = [
    ["js/core/renderer/city_paint_style_model.js", ["node --test tests/city_paint_style_model_behavior.test.mjs", "test:node:renderer-surface-host"]],
    ["js/core/renderer/city_label_owner.js", ["test:node:renderer-surface-host"]],
    ["js/core/scenario/chunk_payload_loader.js", ["node --test tests/scenario_chunk_payload_loader_behavior.test.mjs", "node --test tests/scenario_chunk_cancellation_behavior.test.mjs", "test:node:scenario-chunk-contracts:quick"]],
    ["js/core/scenario/chunk_layer_payloads.js", ["node --test tests/scenario_chunk_layer_payloads_behavior.test.mjs", "test:node:scenario-chunk-contracts:quick"]],
    ["js/core/scenario/optional_layer_runtime.js", ["node --test tests/scenario_optional_layers_behavior.test.mjs"]],
  ];
  for (const [source, expectedCommands] of cases) {
    const selection = buildRepositoryRecommendation([source]);
    assert.deepEqual(selection.unmatchedChangedFiles, [], source);
    for (const commandRef of expectedCommands) {
      assert.ok(selection.recommendedCommands.some((entry) => entry.commandRef === commandRef), `${source}: ${commandRef}`);
    }
  }
});

test("local owner feedback selects existing behavior without admitting broader roots", () => {
  const cases = [
    ["js/core/renderer/ocean_render_owner.js", "tests/ocean_render_owner_behavior.test.mjs"],
    ["js/core/renderer/renderer_viewport_update_owner.js", "tests/renderer_viewport_update_owner_behavior.test.mjs"],
    ["js/core/map_renderer/map_hover_interaction_owner.js", "tests/map_hover_interaction_owner_behavior.test.mjs"],
    ["js/core/renderer/city_lights_render_owner.js", "tests/city_lights_render_owner_behavior.test.mjs"],
    ["js/ui/sidebar/project_support_diagnostics_controller.js", "tests/project_support_diagnostics_controller_behavior.test.mjs"],
    ["tools/run_commit_verification.mjs", "tests/verify_commit_runner_behavior.test.mjs"],
    ["js/ui/sidebar/strategic_overlay/unit_counter_catalog_helper.js", "tests/unit_counter_catalog_behavior.test.mjs"],
    ["js/ui/toolbar/workspace_chrome_support_surface_controller.js", "tests/workspace_chrome_support_surface_controller_behavior.test.mjs"],
    ["tests/contracts/command_supersession_contracts.mjs", "tests/command_supersession_contracts.test.mjs"],
    ["tests/contracts/state_action_source_boundary_contracts.mjs", "tests/state_action_source_boundary_contracts.test.mjs"],
    ["js/core/worker_task_client.js", "tests/worker_task_client_behavior.test.mjs"],
    ["tests/scenario_chunk_cancellation_behavior.test.mjs", "tests/scenario_chunk_cancellation_behavior.test.mjs"],
    ["tests/startup_boot_worker_cancellation.test.mjs", "tests/startup_boot_worker_cancellation.test.mjs"],
  ];
  const routes = buildRouteIndex();
  const preparedCatalog = prepareRepositoryVerificationCatalog();
  const select = (files, entrypoint) => constrainAdaptiveEntrypointSelection(
    buildAdaptiveEntrypointRecommendation(files, routes, { entrypoint }), entrypoint, { preparedCatalog },
  );
  for (const entrypoint of ["edit", "impact"]) {
    for (const [source, testFile] of cases) {
      const local = select([source, testFile], entrypoint);
      assert.deepEqual(local.unmatchedChangedFiles, [], source);
      assert.deepEqual(local.localEntrypointRouteGaps, [], source);
      assert.deepEqual(local.recommendedCommands.map((entry) => entry.commandRef), ["node --test " + testFile], source);
      assert.equal(local.recommendedCommands[0].executionOwner, "child-safe");
      assert.deepEqual(local.recommendedCommands[0].resourceLocks, []);
      if (source.startsWith("js/") && !source.includes("unit_counter_catalog_helper")) {
        assert.ok(local.matchedByFile[0].deferredByTier.length > 0, source);
      }
    }
    for (const broadOrUnknown of ["data/scenarios/tno_1962/manifest.json", "unregistered/unsupported-source.xyz"]) {
      const mixed = select([cases[0][0], broadOrUnknown], entrypoint);
      assert.ok(mixed.unmatchedChangedFiles.length > 0 || mixed.localEntrypointRouteGaps.length > 0, broadOrUnknown);
    }
    for (const broadRoot of ["js/core/map_renderer.js", "js/ui/sidebar.js", "js/ui/toolbar.js"]) {
      const broad = select([broadRoot], entrypoint);
      assert.ok(broad.recommendedCommands.every((command) => !cases.some(([, testFile]) => command.commandRef === "node --test " + testFile)));
    }
    for (const shared of ["package.json", "tools/run_core_verification.mjs", "tools/verification/verification_catalog_source.mjs"]) {
      const sharedSelection = select([shared], entrypoint);
      assert.ok(sharedSelection.recommendedCommands.some((command) => command.commandRef === "verify:local-infra"), shared);
      assert.ok(!sharedSelection.rawCanonicalRoots.some((command) => command.commandRef === "node --test tests/verify_commit_runner_behavior.test.mjs"), shared);
    }
  }
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).scripts;
  assert.match(scripts["test:node:verify-core-runner"], /tests\/verify_commit_runner_behavior\.test\.mjs/);
  assert.match(scripts["verify:local-infra"], /tests\/verify_commit_runner_behavior\.test\.mjs/);
  const commitRoots = VERIFICATION_METADATA_SOURCE.canonicalEntrypoints.tier.find((entry) => entry.id === "commit")
    .commitProjection.controlPlaneCommandRefs;
  const controlPlan = buildVerificationSelectionPlan(preparedCatalog.catalog, commitRoots, { preparedCatalog });
  const commitFiles = controlPlan.executions.flatMap((execution) => execution.logicalArgv)
    .filter((argument) => argument.endsWith(".test.mjs"));
  assert.equal(commitFiles.filter((file) => file === "tests/verify_commit_runner_behavior.test.mjs").length, 1);
});

test("authored catalog source covers command authority, policies, and every projection key", () => {
  const summary = verificationMetadataSourceSummary();
  assert.equal(summary.authoredSurfaces, 1);
  assert.equal(summary.packageScriptCount, Object.keys(readJson("package.json").scripts).length);
  assert.equal(summary.contributorRecords, VERIFICATION_METADATA_SOURCE.records.length);
  assert.equal(summary.verificationRecordProjectionCount, 140);
  assert.equal(summary.routeProjectionCount, VERIFICATION_METADATA_SOURCE.records.filter((record) => record.selector !== null).length);
  assert.equal(summary.commandCount, new Set(VERIFICATION_METADATA_SOURCE.records.map((record) => record.commandRef)).size);
  assert.deepEqual(summary.identity, VERIFICATION_METADATA_SOURCE_IDENTITY);
  assert.equal(new Set(VERIFICATION_METADATA_SOURCE.records.map((entry) => entry.id)).size, VERIFICATION_METADATA_SOURCE.records.length);
  for (const entry of VERIFICATION_METADATA_SOURCE.records) {
    assert.equal(typeof entry.commandRef, "string");
    assert.ok(entry.commandRef.length > 0);
    for (const field of ["sourceRefs", "ownerHints", "domains", "tiers", "resourceLocks", "executionOwners", "profiles", "platforms"]) {
      assert.ok(Array.isArray(entry[field]), `${entry.id}.${field}`);
      assert.equal(new Set(entry[field]).size, entry[field].length, `${entry.id}.${field}.unique`);
      assert.deepEqual(entry[field], [...entry[field]].sort(), `${entry.id}.${field}.sorted`);
    }
    assert.ok(entry.sourceRefs.length > 0);
    assert.ok(entry.ownerHints.length > 0);
    assert.ok(entry.domains.length > 0);
    assert.ok(entry.tiers.length > 0);
    assert.ok(entry.executionOwners.length > 0);
    assert.ok(entry.profiles.length > 0);
    assert.ok(entry.platforms.length > 0);
    assert.equal(typeof entry.cost, "string");
    assert.ok(VERIFICATION_METADATA_SOURCE.entrypointPolicies[entry.entrypointPolicyIndex]);
  }
  assert.equal(VERIFICATION_METADATA_SOURCE.estimatePolicy.kind, "verification-estimate-policy");
  assert.equal(Object.keys(VERIFICATION_METADATA_SOURCE.supersession).length, 16);
  assert.equal(summary.heavyDependencyGroupCount, 1);
  assert.equal(summary.packageAliasCount, 17);
  assert.equal(summary.prProfileCount, 4);
  assert.equal(summary.nightlyRoleCount, 12);
  assert.equal(summary.documentationProjectionCount, 59);
});

test("renderer split delivery records route to assembly verification", () => {
  for (const name of ["context", "plan", "task"]) {
    const sourceRef = `docs/active/renderer-cohesive-splits-20260907/${name}.md`;
    const report = buildRecommendation([sourceRef]);
    assert.deepEqual(report.unmatchedChangedFiles, [], sourceRef);
    assert.ok(report.recommendedCommands.some(
      (command) => command.commandRef === "test:node:renderer-surface-host",
    ), sourceRef);
  }
});

test("development closeout records have metadata verification ownership", () => {
  for (const sourceRef of [
    "docs/active/development-loop-simplification-20260905/context.md",
    "docs/active/development-loop-simplification-20260905/plan.md",
    "docs/active/development-loop-simplification-20260905/task.md",
    "docs/archive/worktree-registry-history-through-20260831.md",
  ]) {
    const report = buildRecommendation([sourceRef]);
    assert.deepEqual(report.unmatchedChangedFiles, [], sourceRef);
    assert.ok(report.recommendedCommands.some(
      (command) => command.commandRef === "test:node:verification-metadata",
    ), sourceRef);
  }
});

test("authored catalog normalization rejects duplicate arrays and stabilizes semantic digests", () => {
  const reordered = structuredClone(VERIFICATION_METADATA_SOURCE);
  const record = reordered.records.find((entry) => entry.sourceRefs.length > 1);
  record.sourceRefs.reverse();
  assert.equal(
    verificationMetadataSourceDigest(reordered),
    VERIFICATION_METADATA_SOURCE_IDENTITY.digest,
  );

  const reversedSupersession = structuredClone(VERIFICATION_METADATA_SOURCE);
  const [superseder] = Object.entries(reversedSupersession.supersession)
    .find(([, superseded]) => superseded.length > 1);
  reversedSupersession.supersession[superseder].reverse();
  assert.equal(
    verificationMetadataSourceDigest(reversedSupersession),
    VERIFICATION_METADATA_SOURCE_IDENTITY.digest,
  );

  const duplicateValue = structuredClone(VERIFICATION_METADATA_SOURCE);
  duplicateValue.records[0].sourceRefs.push(duplicateValue.records[0].sourceRefs[0]);
  assert.throws(
    () => normalizeVerificationMetadataSource(duplicateValue),
    /verification-metadata-source-duplicate-array-value/,
  );

  const duplicateRecord = structuredClone(VERIFICATION_METADATA_SOURCE);
  duplicateRecord.records.push(structuredClone(duplicateRecord.records[0]));
  assert.throws(
    () => normalizeVerificationMetadataSource(duplicateRecord),
    /verification-metadata-source-duplicate-record/,
  );

  const duplicateSupersession = structuredClone(VERIFICATION_METADATA_SOURCE);
  duplicateSupersession.supersession[superseder].push(
    duplicateSupersession.supersession[superseder][0],
  );
  assert.throws(
    () => normalizeVerificationMetadataSource(duplicateSupersession),
    /verification-metadata-source-duplicate-array-value:supersession\./,
  );
});

test("M5 canonical projections are deterministic, detached, and source-identity bound", () => {
  assert.deepEqual(Object.keys(buildCanonicalCatalogProjections()), [
    "heavyDependencyGroups",
    "packageAliases",
    "prProfiles",
    "nightlyTopology",
    "documentation",
  ]);
  const projections = [
    [buildCanonicalHeavyDependencyGroups, "heavyDependencyGroups"],
    [buildCanonicalPackageAliases, "packageAliases"],
    [buildCanonicalPrProfiles, "prProfiles"],
    [buildCanonicalNightlyTopology, "nightlyTopology"],
    [buildCanonicalDocumentationProjection, "documentation"],
  ];
  for (const [build, key] of projections) {
    const first = build();
    const second = build();
    assert.deepEqual(first, second, key);
    assert.deepEqual(first.authorityIdentity, VERIFICATION_METADATA_SOURCE_IDENTITY, key);
    assert.notStrictEqual(first.authorityIdentity, VERIFICATION_METADATA_SOURCE_IDENTITY, key);
  }

  const heavy = buildCanonicalHeavyDependencyGroups();
  assert.equal(heavy.heavyDependencyGroups[0].id, "geo_stack");
  assert.equal(heavy.heavyDependencyGroups[0].patterns.length, 17);
  assert.ok(heavy.heavyDependencyGroups[0].patterns.includes("tests/test_city_data_contract.py"));
  assert.ok(heavy.heavyDependencyGroups[0].patterns.includes("tests/test_reviewed_place_names.py"));
  const cityRoute = buildRouteIndex().find((route) => route.id === "city:data-contract-python");
  assert.equal(cityRoute.executionOwner, "main-thread");
  assert.equal(cityRoute.cost, "heavy");
  assert.ok(cityRoute.resourceLocks.includes("heavy-geo"));
  heavy.heavyDependencyGroups[0].patterns.push("detached-only.py");
  assert.equal(VERIFICATION_METADATA_SOURCE.projectionAuthority.heavyDependencyGroups[0].patterns.length, 17);

  const aliases = buildCanonicalPackageAliases().packageAliases;
  assert.deepEqual(
    aliases.find((entry) => entry.commandRef === "test:node:modern-city-lights-owner"),
    {
      commandRef: "test:node:modern-city-lights-owner",
      supersedes: [],
      targetCommandRef: "test:node:city-lights-render-owner",
    },
  );
  assert.ok(aliases.some((entry) => entry.commandRef === "verify:p4:p4-3" && entry.supersedes.length > 0));

  const profiles = buildCanonicalPrProfiles().prProfiles;
  assert.deepEqual(profiles.map((entry) => entry.id), ["demo", "perf-pr-gate", "pr-fast", "pr-smoke"]);

  const topology = buildCanonicalNightlyTopology().nightlyTopology;
  assert.deepEqual(
    topology.roles.find((role) => role.id === "linux-core").shards,
    ["1", "2", "3"],
  );
  assert.equal(topology.shards.filter((shard) => shard.roleId === "linux-core").length, 3);
  assert.deepEqual(topology.finalDependencies, [
    "browser",
    "linux-core",
    "metadata",
    "p4-closeout",
    "pages",
    "pages-artifact-shadow",
    "scenario-heavy",
    "windows-governance",
  ]);

  const documentation = buildCanonicalDocumentationProjection().documentation;
  assert.ok(documentation.length > 0);
  assert.ok(documentation.every((entry) => entry.sourceRef.startsWith("docs/")));
  assert.deepEqual(documentation.map((entry) => entry.sourceRef), documentation.map((entry) => entry.sourceRef).sort());
});

test("M5 projection authority normalizes order and binds injected source identity", () => {
  const reordered = structuredClone(VERIFICATION_METADATA_SOURCE);
  reordered.projectionAuthority.heavyDependencyGroups[0].patterns.reverse();
  reordered.projectionAuthority.prProfiles.reverse();
  reordered.projectionAuthority.nightlyRoles.reverse();
  reordered.projectionAuthority.nightlyRoles[0].shards.reverse();
  reordered.projectionAuthority.nightlyFinalDependencies.reverse();
  assert.equal(verificationMetadataSourceDigest(reordered), VERIFICATION_METADATA_SOURCE_IDENTITY.digest);

  const extendedDocumentation = structuredClone(VERIFICATION_METADATA_SOURCE);
  extendedDocumentation.projectionAuthority.documentation.sourceRefPrefixes.push("docs/active/");
  const projection = buildCanonicalDocumentationProjection(extendedDocumentation);
  assert.notEqual(projection.authorityIdentity.digest, VERIFICATION_METADATA_SOURCE_IDENTITY.digest);
  assert.equal(
    projection.authorityIdentity.digest,
    verificationMetadataSourceDigest(extendedDocumentation),
  );
});

test("M5 projections fail closed on heavy, alias, profile, Nightly, and documentation drift", () => {
  const unknownHeavyRef = structuredClone(VERIFICATION_METADATA_SOURCE);
  unknownHeavyRef.projectionAuthority.heavyDependencyGroups[0].patterns.push("tests/unknown-heavy.py");
  assert.throws(
    () => buildCanonicalHeavyDependencyGroups(unknownHeavyRef),
    /verification-metadata-source-projection-source-gap:heavyDependencyGroups\.geo_stack:tests\/unknown-heavy\.py/,
  );

  const unknownAliasTarget = structuredClone(VERIFICATION_METADATA_SOURCE);
  unknownAliasTarget.packageScripts["test:node:modern-city-lights-owner"] = "npm run missing:alias-target";
  assert.throws(
    () => buildCanonicalPackageAliases(unknownAliasTarget),
    /verification-metadata-package-alias-target:test:node:modern-city-lights-owner:missing:alias-target/,
  );

  const unknownProfile = structuredClone(VERIFICATION_METADATA_SOURCE);
  unknownProfile.projectionAuthority.prProfiles.push("unknown-pr-profile");
  assert.throws(
    () => buildCanonicalPrProfiles(unknownProfile),
    /verification-metadata-source-projection-profile-gap:prProfiles:unknown-pr-profile/,
  );

  const duplicateNightlyShard = structuredClone(VERIFICATION_METADATA_SOURCE);
  const linuxCore = duplicateNightlyShard.projectionAuthority.nightlyRoles.find((role) => role.id === "linux-core");
  linuxCore.shards.push(linuxCore.shards[0]);
  assert.throws(
    () => buildCanonicalNightlyTopology(duplicateNightlyShard),
    /verification-metadata-source-duplicate-array-value:projectionAuthority\.nightlyRoles\.linux-core\.shards/,
  );

  const invalidDocumentation = structuredClone(VERIFICATION_METADATA_SOURCE);
  invalidDocumentation.projectionAuthority.documentation.sourceRefPrefixes = ["docs"];
  assert.throws(
    () => buildCanonicalDocumentationProjection(invalidDocumentation),
    /verification-metadata-source-projection-documentation-prefix/,
  );

  const unknownAuthorityField = structuredClone(VERIFICATION_METADATA_SOURCE);
  unknownAuthorityField.projectionAuthority.shadowOverride = true;
  assert.throws(
    () => normalizeVerificationMetadataSource(unknownAuthorityField),
    /verification-metadata-source-projection-fields:authority/,
  );
});

test("canonical gate policy projects true false and unknown with allowed reason sources", () => {
  assert.equal(VERIFICATION_GATE_POLICY_AUTHORITY.mode, "observation-only");
  assert.equal(VERIFICATION_GATE_POLICY_AUTHORITY.requiredExecutionSetEffect, "unchanged");
  assert.match(VERIFICATION_GATE_POLICY_AUTHORITY_IDENTITY.digest, /^[0-9a-f]{64}$/u);
  const cases = [
    ["data/scenarios/tno_1962/water_regions.geojson", "requiresStrictTno"],
    ["tests/e2e/sample_guide_deeplink.spec.js", "requiresDemo"],
    ["tools/verification/verification_profile.mjs", "requiresTestInfra"],
    ["tests/e2e/release/pages_public_release_gate.spec.js", "requiresDeployPreflight"],
  ];
  const allowedSourceTypes = new Set(["domain", "sourceRef", "entrypoint", "sharedRisk"]);
  for (const [changedFile, expectedTrueSignal] of cases) {
    for (const platform of ["win32", "linux"]) {
      const report = buildRepositoryRecommendation([changedFile], { platform });
      assert.equal(report.gatePolicySignals.signals[expectedTrueSignal].state, "true", `${platform}:${changedFile}`);
      assert.equal(
        report.gatePolicySignalsDigest,
        verificationGatePolicySignalsDigest(report.gatePolicySignals),
      );
      assert.deepEqual(report.gatePolicySignals.authorityIdentity, VERIFICATION_GATE_POLICY_AUTHORITY_IDENTITY);
      for (const signal of Object.values(report.gatePolicySignals.signals)) {
        assert.ok(["true", "false", "unknown"].includes(signal.state));
        assert.ok(signal.reasons.length > 0);
        assert.ok(signal.reasons.every((reason) => allowedSourceTypes.has(reason.source.type)));
      }
    }
  }

  const falseReport = buildRepositoryRecommendation(["tests/ocean_render_owner_behavior.test.mjs"]);
  assert.equal(falseReport.gatePolicySignals.signals.requiresStrictTno.state, "false");
  assert.equal(falseReport.gatePolicySignals.signals.requiresDemo.state, "false");
  assert.equal(falseReport.gatePolicySignals.signals.requiresDeployPreflight.state, "false");

  const unknownSignals = projectVerificationGatePolicySignals({
    changedFiles: ["unmatched.phase1a"],
    matchedByFile: [{
      changedFile: "unmatched.phase1a",
      matchedRouteIds: [],
      recommendedCommands: [],
    }],
    unmatchedChangedFiles: ["unmatched.phase1a"],
    routeAuthority: [],
  });
  assert.ok(Object.values(unknownSignals.signals).every((signal) => signal.state === "unknown"));
  assert.ok(Object.values(unknownSignals.signals).every((signal) => (
    signal.reasons[0].source.type === "sharedRisk"
      && signal.reasons[0].source.value === "selection-authority-gap"
  )));
});

test("gate policy authored arrays normalize stably and reject duplicate policy values", () => {
  const reordered = structuredClone(VERIFICATION_METADATA_SOURCE);
  reordered.gatePolicy.signals.requiresStrictTno.matchAny.domains.reverse();
  assert.equal(
    verificationMetadataSourceDigest(reordered),
    VERIFICATION_METADATA_SOURCE_IDENTITY.digest,
  );
  const duplicate = structuredClone(VERIFICATION_METADATA_SOURCE);
  duplicate.gatePolicy.signals.requiresStrictTno.matchAny.domains.push(
    duplicate.gatePolicy.signals.requiresStrictTno.matchAny.domains[0],
  );
  assert.throws(
    () => normalizeVerificationMetadataSource(duplicate),
    /verification-metadata-source-duplicate-array-value:gatePolicy\.signals\.requiresStrictTno/,
  );
  const forgedSource = structuredClone(VERIFICATION_METADATA_SOURCE);
  forgedSource.gatePolicy.signals.requiresDemo.matchAny.domains = ["forged-domain"];
  assert.throws(
    () => normalizeVerificationMetadataSource(forgedSource),
    /verification-gate-policy-authority-source-gap:requiresDemo:domains:forged-domain/,
  );
});
const P4_POLICY_SOURCE_REFS = Object.freeze([
  "tools/state_writer_inventory.mjs",
  "tools/state_action_delegation_contract.mjs",
  "tools/state_writer_policy.mjs",
  "tools/state_writer_policy.json",
  "tools/build_state_writer_policy.mjs",
  "tools/check_state_writer_policy.mjs",
  "tools/p4_state_action_phases.mjs",
  "tools/run_p4_state_writer_policy_tests.mjs",
  "tools/verification/p4_state_writer_policy_test_lifecycle.mjs",
  "tools/verification/p4_state_writer_historical_proof_worker.mjs",
  "tools/process_containment/windows_job_runtime.mjs",
  "tools/process_containment/windows_job_runner_v2.cs",
  "tools/process_containment/windows_job_runner_core.cs",
  "tools/run_p4_state_write_boundary.mjs",
  "tools/check_p4_state_action_routes.mjs",
  "tests/state_action_delegation_edges_behavior.test.mjs",
  "tests/state_writer_policy_behavior.test.mjs",
  "tests/state_writer_policy_batch_scan_behavior.test.mjs",
  "tests/state_writer_scanner_soundness_behavior.test.mjs",
  "tests/state_writer_policy_soundness_behavior.test.mjs",
  "tests/p4_state_action_routes_behavior.test.mjs",
  "tests/p4_state_writer_runner_reachability_behavior.test.mjs",
  "tests/p4_state_writer_streaming_runner_behavior.test.mjs",
  "tests/state_writer_policy_manifest_behavior.test.mjs",
  "tests/test_state_write_guardrail_contract.py",
  "tests/supervisor_domain_registry_behavior.test.mjs",
  "tests/verification_metadata_behavior.test.mjs",
  "tests/verify_core_runner_behavior.test.mjs",
  "docs/active/state-action-ownership-p4-20260719",
  "docs/active/_worktree_registry.md",
  "tools/eslint-rules/no-direct-state-mutation.js",
  "tools/eslint-rules/state-writer-allowlist.json",
  "tools/check_state_write_allowlist.mjs",
  "tools/verification/verification_domains.mjs",
  "tools/verification/verification_metadata_helpers.mjs",
  "tools/test_route_registry.mjs",
  "tools/select_verification_targets.mjs",
  "tools/ai_test_supervisor/domain_registry.json",
  "tools/ai_test_supervisor/check_supervisor_schemas.mjs",
  "package.json",
  "package-lock.json",
]);

function readJson(...parts) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...parts), "utf8"));
}

function commandRefsFromGroups(groups) {
  return groups.flatMap((group) => group.commands);
}

function routeFields(route) {
  return {
    commandRef: route.commandRef,
    sourceRef: route.sourceRef,
    domain: route.domain,
    ownerHint: route.ownerHint,
    layer: route.layer,
    cost: route.cost,
    resourceLocks: route.resourceLocks,
    executionOwner: route.executionOwner,
    ciProfile: route.ciProfile,
  };
}

function commandsForChangedFile(report, changedFile) {
  const entry = report.matchedByFile.find((candidate) => candidate.changedFile === changedFile);
  assert.ok(entry, `${changedFile} should be present in matchedByFile`);
  return entry.recommendedCommands;
}

test("verification metadata validates against package scripts and supervisor domains", () => {
  const packageJson = readJson("package.json");
  const domainRegistry = readJson("tools", "ai_test_supervisor", "domain_registry.json");
  const supervisorDomainIds = domainRegistry.domains.map((domain) => domain.id);

  assert.deepEqual(
    validateVerificationMetadata({
      packageScripts: packageJson.scripts,
      supervisorDomainIds,
    }),
    {
      count: VERIFICATION_DOMAINS.length,
      routeRegistryCount: buildVerificationMetadataRoutes().length,
      verifyCoreDefaultCount: commandRefsFromGroups(buildVerifyCoreDefaultGroups()).length,
      verifyCoreMainThreadCount: buildVerifyCoreMainThreadGroup().commands.length,
      optionalMainThreadCount: getVerifyCoreOptionalMainThreadCommands().length,
    },
  );
});

test("current metadata and local infra exclude historical projection tests", () => {
  const preparedCatalog = prepareRepositoryVerificationCatalog();
  const historicalTest = "tests/catalog_projection_shadow_behavior.test.mjs";
  const testFilesFor = (commandRef) => buildVerificationSelectionPlan(
    preparedCatalog.catalog, [commandRef], { preparedCatalog },
  ).executions.flatMap((execution) => execution.logicalArgv)
    .filter((argument) => argument.endsWith(".test.mjs"));

  assert.deepEqual(testFilesFor("test:node:verification-metadata"), [
    "tests/verification_metadata_behavior.test.mjs",
  ]);
  assert.ok(!testFilesFor("verify:local-infra").includes(historicalTest));
  assert.deepEqual(testFilesFor("test:node:catalog-projection-history"), [historicalTest]);
  assert.ok(!commandRefsFromGroups(buildVerifyCoreDefaultGroups()).includes("test:node:catalog-projection-history"));

  const historyFiles = [
    "tools/verification/catalog_projection_shadow.mjs",
    "tools/verification/catalog_projection_legacy.mjs",
    "tools/verification/catalog_projection_historical_baseline.json",
    "tools/verification/catalog_projection_shadow_cli.mjs",
    historicalTest,
  ];
  const report = buildRecommendation(historyFiles);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  for (const file of historyFiles) {
    assert.ok(commandsForChangedFile(report, file).some(({ commandRef }) => (
      commandRef === "test:node:catalog-projection-history"
    )), file);
  }
  const currentReport = buildRecommendation(["tests/verification_metadata_behavior.test.mjs"]);
  assert.ok(!currentReport.recommendedCommands.some(({ commandRef }) => (
    commandRef === "test:node:catalog-projection-history"
  )));
});

test("timeout guardrail allowlist selects the timeout guardrail contract", () => {
  const sourceRef = "tools/test-timeout-guardrail-allowlist.json";
  const verificationEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:test-timeout-guardrails"
  ));
  const selectorRoute = buildRouteIndex().find((entry) => (
    entry.id === "infra:test-timeout-guardrails"
  ));

  assert.ok(verificationEntry?.sourceRefs.includes(sourceRef));
  assert.ok(selectorRoute?.sourceRef.split(",").includes(sourceRef));

  const report = buildRecommendation([sourceRef]);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  const command = commandsForChangedFile(report, sourceRef).find((entry) => (
    entry.commandRef === "verify:test-timeout-guardrails"
  ));
  assert.ok(command);
  assert.equal(command.executionOwner, "child-safe");
  assert.deepEqual(command.routeIds, ["infra:test-timeout-guardrails"]);
});

test("landing map generators and checked-in assets route to the map asset contracts", () => {
  const sourceRefs = [
    "tools/build_landing_europe_1936_showcase.py",
    "tools/build_landing_japan_preview.py",
    "tools/build_landing_work_maps.py",
    "landing/assets/hero-blank.webp",
    "landing/assets/hero-hoi4-1936.webp",
    "landing/assets/hero-hoi4-1939.webp",
    "landing/assets/hero-tno-1962.json",
    "landing/assets/hero-tno-1962.webp",
    "landing/assets/japan-preview-transport.svg",
    "landing/assets/work-atlas-japan-corridor.svg",
  ];
  const report = buildRecommendation(sourceRefs);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  for (const sourceRef of sourceRefs) {
    assert.ok(
      commandsForChangedFile(report, sourceRef).some((command) => (
        command.commandRef === "test:py:landing-map-asset-contracts"
      )),
      `${sourceRef} should select the landing map asset contracts`,
    );
  }
});

test("startup resource graph implementation and contract select the canonical child-safe contract", () => {
  const sourceRefs = [
    "tools/startup_resource_graph.mjs",
    "tests/startup_resource_graph_contract.test.mjs",
  ];
  const report = buildRecommendation(sourceRefs);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  for (const sourceRef of sourceRefs) {
    const graphCommand = commandsForChangedFile(report, sourceRef).find((command) => (
      command.commandRef === "test:node:startup-resource-graph"
    ));
    assert.ok(graphCommand, `${sourceRef} should select the startup resource graph contract`);
    assert.equal(graphCommand.executionOwner, "child-safe");
    assert.deepEqual(graphCommand.resourceLocks, []);
    assert.deepEqual(graphCommand.routeIds, ["node:test:node:startup-resource-graph"]);
  }
  assert.deepEqual(
    commandsForChangedFile(report, "tools/startup_resource_graph.mjs")
      .map((command) => command.commandRef),
    ["test:node:startup-resource-graph"],
  );
});

test("scenario chunk split routes keep quick local and defer data-reading paths to full", () => {
  const byCommand = (commandRef) => VERIFICATION_METADATA_SOURCE.records.find((entry) => (
    entry.commandRef === commandRef && entry.selector !== null
  ));
  const quick = byCommand("test:node:scenario-chunk-contracts:quick");
  assert.ok(quick);
  const quickCases = "tests/scenario_chunk_contracts.quick_cases.mjs";
  const heavyCases = "tests/scenario_chunk_contracts.heavy_cases.mjs";
  assert.ok(quick.sourceRefs.includes(quickCases));
  assert.ok(!quick.sourceRefs.includes(heavyCases));
  assert.ok(!quick.sourceRefs.includes("tests/scenario_chunk_contracts.test.mjs"));
  assert.ok(byCommand("test:node:scenario-chunk-contracts:heavy").sourceRefs.includes(heavyCases));
  const routes = buildRouteIndex();
  const preparedCatalog = prepareRepositoryVerificationCatalog();
  for (const entrypoint of ["edit", "impact"]) {
    const select = (file) => constrainAdaptiveEntrypointSelection(
      buildAdaptiveEntrypointRecommendation([file], routes, { entrypoint }), entrypoint, { preparedCatalog },
    );
    const quickSelection = select(quickCases);
    assert.deepEqual(quickSelection.unmatchedChangedFiles, []);
    assert.deepEqual(quickSelection.localEntrypointRouteGaps, []);
    assert.deepEqual(quickSelection.recommendedCommands.map(({ commandRef }) => commandRef), [quick.commandRef]);
    const heavySelection = select(heavyCases);
    assert.ok(heavySelection.recommendedCommands.every(({ commandRef }) => commandRef !== quick.commandRef));
  }
  assert.equal(quick.cost, "fast");
  assert.deepEqual(quick.resourceLocks, []);
  assert.deepEqual(quick.executionOwners, ["child-safe"]);
  assert.deepEqual(quick.profiles, ["pr-fast"]);
  assert.deepEqual(
    VERIFICATION_METADATA_SOURCE.entrypointPolicies[quick.entrypointPolicyIndex].eligibleEntrypoints,
    ["edit", "impact", "pr"],
  );

  for (const commandRef of [
    "test:node:scenario-chunk-contracts:heavy",
    "test:node:scenario-chunk-contracts:split",
    "test:node:scenario-chunk-contracts:shadow",
  ]) {
    const entry = byCommand(commandRef);
    assert.ok(entry);
    assert.equal(entry.cost, "heavy");
    assert.deepEqual(entry.executionOwners, ["main-thread"]);
    assert.deepEqual(entry.profiles, ["full"]);
    assert.deepEqual(
      VERIFICATION_METADATA_SOURCE.entrypointPolicies[entry.entrypointPolicyIndex].eligibleEntrypoints,
      ["nightly"],
    );
    assert.ok(entry.resourceLocks.includes("scenario-data"));
  }
  assert.deepEqual(byCommand("test:node:scenario-chunk-contracts:shadow").resourceLocks, [
    ".runtime-output",
    "scenario-data",
  ]);
});

test("P4.0 state ownership policy owns its files, routes, and verify-core commands", () => {
  const policyEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:state-writer-policy"
  ));
  const boundaryEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:state-write-boundary"
  ));
  assert.ok(policyEntry);
  assert.ok(boundaryEntry);
  assert.deepEqual(policyEntry.sourceRefs, [...P4_POLICY_SOURCE_REFS].sort());
  for (const entry of [policyEntry, boundaryEntry]) {
    assert.equal(entry.domain, "state-ownership");
    assert.equal(entry.ownerHint, "state-ownership");
    assert.equal(entry.executionOwner, "main-thread");
    assert.equal(entry.cost, "heavy");
    assert.deepEqual(entry.resourceLocks, [".runtime-output"]);
    assert.equal(entry.supervisorDomain, "state-ownership");
    assert.equal(entry.verifyCoreDefaultGroup, "infra");
    assert.equal(entry.routeRegistry, true);
    assert.ok(buildVerificationMetadataRoutes().some((route) => route.id === entry.id));
  }
  assert.deepEqual(
    commandRefsFromGroups(buildVerifyCoreDefaultGroups()).filter((commandRef) => (
      commandRef === policyEntry.commandRef || commandRef === boundaryEntry.commandRef
    )),
    [
      "verify:p4:state-writer-policy",
      "test:python:p4:state-write-boundary",
    ],
  );

  const policyReport = buildRecommendation(P4_POLICY_SOURCE_REFS);
  assert.deepEqual(policyReport.unmatchedChangedFiles, []);
  for (const sourceRef of P4_POLICY_SOURCE_REFS) {
    const command = commandsForChangedFile(policyReport, sourceRef).find((entry) => (
      entry.commandRef === policyEntry.commandRef
    ));
    assert.ok(command, `${sourceRef} should select the P4 policy command`);
    assert.ok(command.domains.includes("state-ownership"));
    assert.equal(command.domains.includes("renderer-runtime"), false);
  }
});

const P4_SHARED_NODE_LOCKS = [".runtime-output", "heavy-geo", "scenario-data"];

test("P4.1 full boot root and exact gate stay in the nightly main-thread tier", () => {
  const actionEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-1-boot-actions"
  ));
  const boundaryEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-1-boot-boundary"
  ));
  const exactPhaseEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "p4:p4-1-exact-phase"
  ));

  assert.ok(actionEntry);
  assert.ok(boundaryEntry);
  assert.ok(exactPhaseEntry);

  for (const entry of [actionEntry]) {
    assert.equal(entry.domain, "state-ownership");
    assert.equal(entry.ownerHint, "state-ownership");
    assert.equal(entry.executionOwner, "main-thread");
    assert.equal(entry.cost, "heavy");
    assert.equal(entry.ciProfile, "full");
    assert.deepEqual(entry.resourceLocks, P4_SHARED_NODE_LOCKS);
    assert.equal(entry.supervisorDomain, "state-ownership");
    assert.equal(entry.routeRegistry, true);
    assert.ok(buildVerificationMetadataRoutes().some((route) => route.id === entry.id));
  }
  assert.equal(boundaryEntry.executionOwner, "main-thread");
  assert.equal(boundaryEntry.cost, "heavy");
  assert.deepEqual(boundaryEntry.resourceLocks, [".runtime-output"]);
  assert.equal(boundaryEntry.ciProfile, "full");
  assert.equal(boundaryEntry.routeRegistry, true);
  assert.equal(exactPhaseEntry.executionOwner, "main-thread");
  assert.equal(exactPhaseEntry.cost, "heavy");
  assert.deepEqual(exactPhaseEntry.resourceLocks, [".runtime-output"]);
  assert.equal(exactPhaseEntry.routeRegistry, true);

  assert.equal(actionEntry.verifyCoreDefaultGroup, "startup-node");
  assert.equal(boundaryEntry.verifyCoreDefaultGroup, "startup-node");
  assert.equal(exactPhaseEntry.verifyCoreDefaultGroup, undefined);
  assert.ok(
    exactPhaseEntry.sourceRefs.includes(
      "tools/eslint-rules/state-writer-allowlist.json",
    ),
  );
  assert.ok(
    exactPhaseEntry.sourceRefs.includes(
      "tests/state_writer_scanner_soundness_behavior.test.mjs",
    ),
  );

  const defaultCommandRefs = commandRefsFromGroups(buildVerifyCoreDefaultGroups());
  assert.ok(defaultCommandRefs.includes(actionEntry.commandRef));
  assert.ok(defaultCommandRefs.includes(boundaryEntry.commandRef));
  assert.equal(defaultCommandRefs.includes(exactPhaseEntry.commandRef), false);

  const exactPhaseReport = buildRecommendation(exactPhaseEntry.sourceRefs);
  assert.deepEqual(exactPhaseReport.unmatchedChangedFiles, []);
  for (const sourceRef of exactPhaseEntry.sourceRefs) {
    const perFileCommands = commandsForChangedFile(exactPhaseReport, sourceRef);
    const staleCommand = perFileCommands.find((entry) => (
      entry.commandRef === exactPhaseEntry.commandRef
    ));
    const currentCommand = perFileCommands.find((entry) => (
      entry.commandRef === "verify:p4:p4-4"
    ));
    assert.equal(staleCommand, undefined, `${sourceRef} should not select the stale P4.1 exact phase command`);
    assert.ok(currentCommand, `${sourceRef} should select the current P4.4 exact phase command`);
    assert.ok(currentCommand.domains.includes("state-ownership"));
  }
});

test("P4.3 routes include renderer runtime owners and their contracts", () => {
  const routeIds = [
    "verify-core:p4:p4-3-renderer-actions",
    "verify-core:p4:p4-3-renderer-boundary",
    "p4:p4-3-exact-phase",
  ];
  for (const routeId of routeIds) {
    const entry = VERIFICATION_DOMAINS.find((candidate) => candidate.id === routeId);
    assert.ok(entry, routeId);
    assert.ok(entry.sourceRefs.includes("js/core/renderer/render_perf_metrics_runtime_owner.js"));
    assert.ok(entry.sourceRefs.includes("tests/render_perf_metrics_runtime_owner_behavior.test.mjs"));
    assert.ok(entry.sourceRefs.includes("js/core/renderer/day_night_runtime_owner.js"));
    assert.ok(entry.sourceRefs.includes("tests/day_night_runtime_owner_behavior.test.mjs"));
    assert.ok(entry.sourceRefs.includes("js/core/renderer/visual_effects_pass_owner.js"));
    assert.ok(entry.sourceRefs.includes("tests/visual_effects_pass_owner_behavior.test.mjs"));
    assert.ok(entry.sourceRefs.includes("js/core/renderer/render_snapshot.js"));
  }

  const exactEntry = VERIFICATION_DOMAINS.find((entry) => entry.id === "p4:p4-3-exact-phase");
  assert.ok(exactEntry.sourceRefs.includes("js/core/map_renderer/click_selection_transaction_owner.js"));
  assert.ok(exactEntry.sourceRefs.includes("js/core/renderer/political_background_render_owner.js"));
  assert.ok(exactEntry.sourceRefs.includes("tests/political_background_render_owner_behavior.test.mjs"));
  assert.ok(exactEntry.sourceRefs.includes(
    "tests/test_map_renderer_political_background_render_owner_boundary_contract.py",
  ));
  const evidenceSources = [
    "tools/verification/state_writer_policy_evidence.mjs",
    "tests/state_writer_policy_evidence_behavior.test.mjs",
  ];
  for (const sourceRef of evidenceSources) {
    assert.ok(exactEntry.sourceRefs.includes(sourceRef));
  }
  const evidenceReport = buildRecommendation(evidenceSources);
  assert.deepEqual(evidenceReport.unmatchedChangedFiles, []);
  for (const sourceRef of evidenceSources) {
    assert.ok(commandsForChangedFile(evidenceReport, sourceRef).some((entry) => (
      entry.commandRef === "verify:p4:p4-4"
      && entry.domains.includes("state-ownership")
    )));
  }
  const actionEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-3-renderer-actions"
  ));
  const boundaryEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-3-renderer-boundary"
  ));
  assert.deepEqual(actionEntry.resourceLocks, P4_SHARED_NODE_LOCKS);
  assert.equal(boundaryEntry.executionOwner, "main-thread");
  assert.equal(boundaryEntry.cost, "heavy");
  assert.deepEqual(boundaryEntry.resourceLocks, [".runtime-output"]);
  assert.equal(boundaryEntry.ciProfile, "full");
  assert.ok(
    boundaryEntry.sourceRefs.includes(
      "tests/test_day_night_runtime_owner_boundary_contract.py",
    ),
  );
  assert.ok(actionEntry.sourceRefs.includes("tests/render_snapshot_behavior.test.mjs"));
  assert.ok(
    boundaryEntry.sourceRefs.includes(
      "tests/test_map_renderer_render_snapshot_boundary_contract.py",
    ),
  );
  assert.ok(
    exactEntry.sourceRefs.includes(
      "tests/exact_after_settle_scheduler_state_actions_behavior.test.mjs",
    ),
  );
});

test("P4.4 routes include every replay lane and the exact admission gate", () => {
  const routeIds = [
    "verify-core:p4:p4-4-ui-actions",
    "verify-core:p4:p4-4-writer-guardrail",
    "p4:p4-4-exact-phase",
  ];
  for (const routeId of routeIds) {
    const entry = VERIFICATION_DOMAINS.find((candidate) => candidate.id === routeId);
    assert.ok(entry, routeId);
    for (const sourceRef of [
      "js/core/state/actions/appearance_actions.js",
      "js/core/state/actions/transport_actions.js",
      "js/core/state/actions/strategic_overlay_actions.js",
      "js/core/state/actions/special_zone_actions.js",
      "tests/transport_workbench_state_owner_behavior.test.mjs",
    ]) {
      assert.ok(entry.sourceRefs.includes(sourceRef), `${routeId}:${sourceRef}`);
    }
  }

  const actionEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-4-ui-actions"
  ));
  const boundaryEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-4-writer-guardrail"
  ));
  const exactEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "p4:p4-4-exact-phase"
  ));
  assert.deepEqual(actionEntry.resourceLocks, P4_SHARED_NODE_LOCKS);
  assert.equal(boundaryEntry.commandRef, "test:python:p4:p4-4-boundary");
  assert.deepEqual(boundaryEntry.resourceLocks, [".runtime-output"]);
  assert.equal(exactEntry.commandRef, "verify:p4:p4-4");
  assert.ok(exactEntry.sourceRefs.includes("tools/run_p4_phase_verification.mjs"));
  assert.ok(exactEntry.sourceRefs.includes("tools/state_action_delegation_contract.mjs"));
});

test("shared P4 control files select only the policy current exact phase gate", () => {
  const changedFiles = [
    "docs/active/_worktree_registry.md",
    "docs/active/state-action-ownership-p4-20260719/task.md",
  ];
  const report = buildRecommendation(changedFiles);
  const exactPhaseCommands = report.recommendedCommands
    .map((entry) => entry.commandRef)
    .filter((commandRef) => commandRef.startsWith("verify:p4:p4-"));

  assert.deepEqual(exactPhaseCommands, ["verify:p4:p4-4"]);
  assert.throws(
    () => buildRecommendation(
      changedFiles,
      buildRouteIndex().filter((route) => route.id !== "p4:p4-4-exact-phase"),
    ),
    /No exact verification route is registered for current P4 phase P4\.4/,
  );

  const renamedHistoricalRoutes = buildRouteIndex().map((route) => (
    route.id === "p4:p4-1-exact-phase"
      ? Object.freeze({ ...route, id: "p4:historical-boot-exact" })
      : route
  ));
  const renamedSources = [...changedFiles, "js/core/state/actions/boot_actions.js"];
  const renamedReport = buildRecommendation(renamedSources, renamedHistoricalRoutes);
  for (const sourceRef of renamedSources) {
    const renamedExactCommands = commandsForChangedFile(renamedReport, sourceRef)
      .map((entry) => entry.commandRef)
      .filter((commandRef) => commandRef.startsWith("verify:p4:p4-"));
    assert.deepEqual(renamedExactCommands, ["verify:p4:p4-4"]);
  }
});

test("P4.2a full scenario root and exact gate stay in the nightly main-thread tier", () => {
  const actionEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-2a-scenario-actions"
  ));
  const boundaryEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-2a-scenario-boundary"
  ));
  const exactPhaseEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "p4:p4-2a-exact-phase"
  ));

  assert.ok(actionEntry);
  assert.ok(boundaryEntry);
  assert.ok(exactPhaseEntry);

  for (const entry of [actionEntry]) {
    assert.equal(entry.domain, "state-ownership");
    assert.equal(entry.ownerHint, "state-ownership");
    assert.equal(entry.executionOwner, "main-thread");
    assert.equal(entry.cost, "heavy");
    assert.equal(entry.ciProfile, "full");
    assert.deepEqual(entry.resourceLocks, P4_SHARED_NODE_LOCKS);
    assert.equal(entry.supervisorDomain, "state-ownership");
    assert.equal(entry.routeRegistry, true);
    assert.ok(buildVerificationMetadataRoutes().some((route) => route.id === entry.id));
  }
  assert.equal(boundaryEntry.executionOwner, "main-thread");
  assert.equal(boundaryEntry.cost, "heavy");
  assert.deepEqual(boundaryEntry.resourceLocks, [".runtime-output"]);
  assert.equal(boundaryEntry.ciProfile, "full");
  assert.equal(boundaryEntry.routeRegistry, true);
  assert.equal(exactPhaseEntry.executionOwner, "main-thread");
  assert.equal(exactPhaseEntry.cost, "heavy");
  assert.deepEqual(exactPhaseEntry.resourceLocks, [".runtime-output"]);
  assert.equal(exactPhaseEntry.routeRegistry, true);

  assert.equal(actionEntry.verifyCoreDefaultGroup, "scenario-project-chunk");
  assert.equal(boundaryEntry.verifyCoreDefaultGroup, "scenario-project-chunk");
  assert.equal(exactPhaseEntry.verifyCoreDefaultGroup, undefined);

  const defaultCommandRefs = commandRefsFromGroups(buildVerifyCoreDefaultGroups());
  assert.ok(defaultCommandRefs.includes(actionEntry.commandRef));
  assert.ok(defaultCommandRefs.includes(boundaryEntry.commandRef));
  assert.equal(defaultCommandRefs.includes(exactPhaseEntry.commandRef), false);

  const exactPhaseReport = buildRecommendation(exactPhaseEntry.sourceRefs);
  assert.deepEqual(exactPhaseReport.unmatchedChangedFiles, []);
  for (const sourceRef of exactPhaseEntry.sourceRefs) {
    const command = commandsForChangedFile(exactPhaseReport, sourceRef).find((entry) => (
      entry.commandRef === "verify:p4:p4-4"
    ));
    assert.ok(command, `${sourceRef} should select the current P4.4 exact phase command`);
    assert.ok(command.domains.includes("state-ownership"));
    assert.equal(command.domains.includes("renderer-runtime"), false);
  }
});

test("P4.2b full scenario chunk root stays in the nightly main-thread tier", () => {
  const actionEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-2b-scenario-chunk-actions"
  ));
  const boundaryEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-2b-scenario-chunk-boundary"
  ));
  const exactPhaseEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "p4:p4-2b-exact-phase"
  ));

  for (const entry of [actionEntry]) {
    assert.ok(entry);
    assert.equal(entry.domain, "state-ownership");
    assert.equal(entry.ownerHint, "state-ownership");
    assert.equal(entry.executionOwner, "main-thread");
    assert.equal(entry.cost, "heavy");
    assert.equal(entry.ciProfile, "full");
    assert.deepEqual(entry.resourceLocks, P4_SHARED_NODE_LOCKS);
    assert.equal(entry.routeRegistry, true);
  }
  assert.equal(boundaryEntry.executionOwner, "main-thread");
  assert.equal(boundaryEntry.cost, "heavy");
  assert.deepEqual(boundaryEntry.resourceLocks, [".runtime-output"]);
  assert.equal(boundaryEntry.ciProfile, "full");
  assert.equal(boundaryEntry.routeRegistry, true);
  assert.equal(exactPhaseEntry.executionOwner, "main-thread");
  assert.equal(exactPhaseEntry.cost, "heavy");
  assert.deepEqual(exactPhaseEntry.resourceLocks, [".runtime-output"]);
  assert.equal(exactPhaseEntry.routeRegistry, true);
  assert.equal(actionEntry.commandRef, "test:node:p4:p4-2b");
  assert.equal(boundaryEntry.commandRef, "test:python:p4:p4-2b-boundary");
  assert.equal(exactPhaseEntry.commandRef, "verify:p4:p4-2b");
  const childCoveredSourceRefs = [
    "js/core/state/actions/scenario_chunk_runtime_actions.js",
    "js/core/state/actions/scenario_chunk_promotion_actions.js",
    "js/core/scenario/chunk_runtime.js",
    "tests/scenario_chunk_state_actions_behavior.test.mjs",
    "tests/test_scenario_chunk_state_actions_boundary_contract.py",
  ];
  for (const sourceRef of childCoveredSourceRefs) {
    assert.ok(actionEntry.sourceRefs.includes(sourceRef) || boundaryEntry.sourceRefs.includes(sourceRef));
  }
  for (const sourceRef of [
    ...childCoveredSourceRefs,
    "js/core/state/actions/scenario_presentation_actions.js",
    "js/core/scenario_localization_state.js",
    "js/core/scenario/bundle_loader.js",
    "js/core/scenario_resources.js",
    "js/core/scenario_rollback.js",
    "tools/select_verification_targets.mjs",
    "tests/test_scenario_state_actions_boundary_contract.py",
  ]) {
    assert.ok(exactPhaseEntry.sourceRefs.includes(sourceRef));
  }
  const defaultCommandRefs = new Set(commandRefsFromGroups(buildVerifyCoreDefaultGroups()));
  assert.ok(defaultCommandRefs.has(actionEntry.commandRef));
  assert.ok(defaultCommandRefs.has(boundaryEntry.commandRef));
  assert.equal(defaultCommandRefs.has(exactPhaseEntry.commandRef), false);
});

test("P4.2c full scenario health root stays in the nightly main-thread tier", () => {
  const actionEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-2c-scenario-health-actions"
  ));
  const boundaryEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "verify-core:p4:p4-2c-scenario-health-boundary"
  ));
  const exactPhaseEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "p4:p4-2c-exact-phase"
  ));

  for (const entry of [actionEntry]) {
    assert.ok(entry);
    assert.equal(entry.domain, "state-ownership");
    assert.equal(entry.ownerHint, "state-ownership");
    assert.equal(entry.executionOwner, "main-thread");
    assert.equal(entry.cost, "heavy");
    assert.equal(entry.ciProfile, "full");
    assert.deepEqual(entry.resourceLocks, P4_SHARED_NODE_LOCKS);
    assert.equal(entry.supervisorDomain, "state-ownership");
    assert.equal(entry.routeRegistry, true);
    assert.ok(buildVerificationMetadataRoutes().some((route) => route.id === entry.id));
  }
  assert.equal(boundaryEntry.executionOwner, "main-thread");
  assert.equal(boundaryEntry.cost, "heavy");
  assert.deepEqual(boundaryEntry.resourceLocks, [".runtime-output"]);
  assert.equal(boundaryEntry.ciProfile, "full");
  assert.equal(boundaryEntry.routeRegistry, true);
  assert.equal(exactPhaseEntry.executionOwner, "main-thread");
  assert.equal(exactPhaseEntry.cost, "heavy");
  assert.deepEqual(exactPhaseEntry.resourceLocks, [".runtime-output"]);
  assert.equal(exactPhaseEntry.routeRegistry, true);
  assert.equal(actionEntry.commandRef, "test:node:p4:p4-2c");
  assert.equal(boundaryEntry.commandRef, "test:python:p4:p4-2c-boundary");
  assert.equal(exactPhaseEntry.commandRef, "verify:p4:p4-2c");

  const childCoveredSourceRefs = [
    "js/core/state/actions/scenario_health_actions.js",
    "js/core/scenario/startup_hydration.js",
    "js/core/scenario_data_health.js",
    "tests/scenario_health_actions_behavior.test.mjs",
    "tests/test_scenario_health_actions_boundary_contract.py",
    "tests/test_scenario_presentation_runtime_boundary_contract.py",
  ];
  for (const sourceRef of childCoveredSourceRefs) {
    assert.ok(actionEntry.sourceRefs.includes(sourceRef) || boundaryEntry.sourceRefs.includes(sourceRef));
  }
  for (const sourceRef of [
    ...childCoveredSourceRefs,
    "js/core/state/actions/scenario_presentation_actions.js",
    "js/core/state/actions/scenario_transaction_rollback_actions.js",
    "js/core/scenario/presentation_display_restore.js",
    "js/core/scenario/lifecycle_runtime.js",
    "js/core/scenario_rollback.js",
    "tools/select_verification_targets.mjs",
    "tests/test_scenario_state_actions_boundary_contract.py",
  ]) {
    assert.ok(exactPhaseEntry.sourceRefs.includes(sourceRef));
  }

  const defaultCommandRefs = new Set(commandRefsFromGroups(buildVerifyCoreDefaultGroups()));
  assert.ok(defaultCommandRefs.has(actionEntry.commandRef));
  assert.ok(defaultCommandRefs.has(boundaryEntry.commandRef));
  assert.equal(defaultCommandRefs.has(exactPhaseEntry.commandRef), false);
});

test("P3.0 renderer pass family route is child-safe, exact, and part of renderer-owner", () => {
  const expectedSourceRefs = [
    "js",
    "dist",
    "tools/renderer_pass_family_inventory.mjs",
    "tests/renderer_pass_family_inventory_behavior.test.mjs",
    "js/core/renderer/render_pipeline_catalog.js",
    "js/core/map_renderer/render_pass_catalog.js",
    "js/core/map_renderer.js",
    "js/core/map_renderer/hgo_runtime_preview_render_owner.js",
    "js/core/renderer/transport_overview_render_owner.js",
    "js/core/state/ui_state.js",
    "docs/archive/renderer-pass-family-p3-20260713/plan.md",
    "docs/archive/renderer-pass-family-p3-20260713/context.md",
    "docs/archive/renderer-pass-family-p3-20260713/task.md",
    "docs/archive/renderer-pass-family-p3-20260713/closeout.md",
    "docs/archive/renderer-pass-family-p3-20260713/coupling-matrix-p3-0.md",
    "docs/active/renderer-pass-family-p3-20260713/plan.md",
    "docs/active/renderer-pass-family-p3-20260713/context.md",
    "docs/active/renderer-pass-family-p3-20260713/task.md",
    "docs/active/renderer-pass-family-p3-closeout-20260715.md",
    "docs/active/renderer-pass-family-coupling-matrix-p3-0-20260713.md",
    "package.json",
  ].sort();
  const entry = VERIFICATION_DOMAINS.find((candidate) => (
    candidate.id === "verify-core:test:node:renderer-pass-family-inventory"
  ));

  assert.deepEqual(entry, {
    id: "verify-core:test:node:renderer-pass-family-inventory",
    commandRef: "test:node:renderer-pass-family-inventory",
    commandType: "package-script",
    packageScriptRequired: true,
    sourceRefs: expectedSourceRefs,
    domain: "renderer-runtime",
    ownerHint: "renderer-runtime",
    layer: "contract",
    cost: "fast",
    resourceLocks: [],
    executionOwner: "child-safe",
    ciProfile: "pr-fast",
    verifyCoreDefaultGroup: "renderer-owner",
    supervisorDomain: "renderer-runtime",
    routeRegistry: true,
  });
  assert.ok(buildVerificationMetadataRoutes().some((route) => route.commandRef === entry.commandRef));
  assert.ok(commandRefsFromGroups(buildVerifyCoreDefaultGroups()).includes(entry.commandRef));
  assert.equal(buildVerifyCoreMainThreadGroup().commands.includes(entry.commandRef), false);
  assert.equal(getVerifyCoreOptionalMainThreadCommands().includes(entry.commandRef), false);

  const inventorySourceRefs = expectedSourceRefs.filter((candidate) => candidate !== "package.json");
  const inventoryReport = buildRecommendation(inventorySourceRefs);
  assert.deepEqual(inventoryReport.unmatchedChangedFiles, []);
  for (const sourceRef of inventorySourceRefs) {
    assert.equal(
      commandsForChangedFile(inventoryReport, sourceRef).some((command) => command.commandRef === entry.commandRef),
      true,
      `${sourceRef} should select the inventory contract`,
    );
  }
  const unrelatedReport = buildRecommendation(["tests/render_pass_catalog_behavior.test.mjs"]);
  assert.equal(
    unrelatedReport.recommendedCommands.some((command) => command.commandRef === entry.commandRef),
    false,
  );
  const hgoOwnerReport = buildRecommendation(["js/core/map_renderer/hgo_runtime_preview_render_owner.js"]);
  assert.equal(
    hgoOwnerReport.recommendedCommands.some((command) => command.commandRef === entry.commandRef),
    true,
  );
  const routedProductPaths = ["js/core/renderer/ocean_render_owner.js", "dist/app.js"];
  const productReport = buildRecommendation(routedProductPaths);
  assert.deepEqual(productReport.unmatchedChangedFiles, []);
  for (const routedProductPath of routedProductPaths) {
    assert.equal(
      commandsForChangedFile(productReport, routedProductPath).some((command) => command.commandRef === entry.commandRef),
      true,
      `${routedProductPath} should select the inventory contract`,
    );
  }
});

test("P3.1 through P3.3b pass-family contracts stay in the child-safe renderer lane", () => {
  const expectedEntries = [
    {
      id: "node:test:node:day-night-runtime-owner",
      commandRef: "test:node:day-night-runtime-owner",
      requiredSourceRefs: [
        "js/core/map_renderer.js",
        "js/core/renderer/day_night_runtime_owner.js",
        "tests/day_night_runtime_owner_behavior.test.mjs",
      ],
    },
    {
      id: "verify-core:test:python:day-night-runtime-owner-boundary",
      commandRef: "test:python:day-night-runtime-owner-boundary",
      requiredSourceRefs: [
        "js/core/map_renderer.js",
        "js/core/renderer/day_night_runtime_owner.js",
        "tests/test_day_night_runtime_owner_boundary_contract.py",
      ],
    },
    {
      id: "verify-core:test:node:visual-effects-pass-owner",
      commandRef: "test:node:visual-effects-pass-owner",
      requiredSourceRefs: [
        "js/core/map_renderer.js",
        "js/core/renderer/visual_effects_pass_owner.js",
        "tests/visual_effects_pass_owner_behavior.test.mjs",
      ],
    },
    {
      id: "verify-core:test:node:context-pass-orchestrator-owner",
      commandRef: "test:node:context-pass-orchestrator-owner",
      requiredSourceRefs: [
        "js/core/map_renderer.js",
        "js/core/renderer/context_pass_orchestrator_owner.js",
        "tests/context_pass_orchestrator_owner_behavior.test.mjs",
      ],
    },
    {
      id: "verify-core:test:node:renderer-political-pass-orchestration-preflight",
      commandRef: "test:node:renderer-political-pass-orchestration-preflight",
      requiredSourceRefs: [
        "js/core",
        "tests/renderer_political_pass_orchestration_preflight.test.mjs",
        "docs/active/renderer-political-pass-preflight-p3-3a-20260714.md",
      ],
    },
    {
      id: "verify-core:test:node:political-pass-orchestrator-owner",
      commandRef: "test:node:political-pass-orchestrator-owner",
      requiredSourceRefs: [
        "js/core/renderer/political_pass_orchestrator_owner.js",
        "tests/political_pass_orchestrator_owner_behavior.test.mjs",
        "docs/active/renderer-political-pass-orchestrator-owner-p3-3b-20260714.md",
        "package.json",
      ],
    },
    {
      id: "verify-core:test:python:map-renderer-political-pass-orchestrator-boundary",
      commandRef: "test:python:map-renderer-political-pass-orchestrator-boundary",
      requiredSourceRefs: [
        "js/core/map_renderer.js",
        "js/core/renderer/political_pass_orchestrator_owner.js",
        "tests/test_map_renderer_political_pass_orchestrator_boundary_contract.py",
      ],
    },
    {
      id: "verify-core:test:node:political-partial-repaint-owner",
      commandRef: "test:node:political-partial-repaint-owner",
      requiredSourceRefs: [
        "js/core/renderer/political_partial_repaint_owner.js",
        "tests/political_partial_repaint_owner_behavior.test.mjs",
        "package.json",
      ],
    },
    {
      id: "verify-core:test:python:map-renderer-political-partial-repaint-owner-boundary",
      commandRef: "test:python:map-renderer-political-partial-repaint-owner-boundary",
      requiredSourceRefs: [
        "js/core/map_renderer.js",
        "js/core/renderer/political_partial_repaint_owner.js",
        "tests/test_map_renderer_political_partial_repaint_owner_boundary_contract.py",
      ],
    },
    {
      id: "verify-core:test:node:political-background-render-owner",
      commandRef: "test:node:political-background-render-owner",
      requiredSourceRefs: [
        "js/core/renderer/political_background_render_owner.js",
        "tests/political_background_render_owner_behavior.test.mjs",
        "package.json",
      ],
    },
    {
      id: "verify-core:test:python:map-renderer-political-background-render-owner-boundary",
      commandRef: "test:python:map-renderer-political-background-render-owner-boundary",
      requiredSourceRefs: [
        "js/core/map_renderer.js",
        "js/core/renderer/political_background_render_owner.js",
        "tests/test_map_renderer_political_background_render_owner_boundary_contract.py",
      ],
    },
    {
      id: "verify-core:test:python:map-renderer-render-pipeline-passes-boundary",
      commandRef: "test:python:map-renderer-render-pipeline-passes-boundary",
      requiredSourceRefs: [
        "js/core/map_renderer.js",
        "js/core/renderer/visual_effects_pass_owner.js",
        "js/core/renderer/context_pass_orchestrator_owner.js",
        "js/core/renderer/political_pass_orchestrator_owner.js",
        "tests/test_map_renderer_render_pipeline_passes_boundary_contract.py",
      ],
    },
  ];

  for (const expected of expectedEntries) {
    const entry = VERIFICATION_DOMAINS.find((candidate) => candidate.id === expected.id);
    assert.ok(entry, `${expected.id} should exist`);
    assert.equal(entry.commandRef, expected.commandRef);
    assert.equal(entry.domain, "renderer-runtime");
    assert.equal(entry.ownerHint, "renderer-runtime");
    assert.equal(entry.executionOwner, "child-safe");
    assert.equal(entry.verifyCoreDefaultGroup, "renderer-owner");
    assert.equal(entry.routeRegistry, true);
    for (const sourceRef of expected.requiredSourceRefs) {
      assert.ok(entry.sourceRefs.includes(sourceRef), `${entry.id} should route ${sourceRef}`);
    }
    assert.ok(buildVerificationMetadataRoutes().some((route) => route.commandRef === entry.commandRef));
    assert.ok(commandRefsFromGroups(buildVerifyCoreDefaultGroups()).includes(entry.commandRef));
  }
});

test("P3 pass-family owner changes select their full contract, dist, browser, and perf lanes", () => {
  const packageJson = readJson("package.json");
  const contextReport = buildRecommendation([
    "js/core/renderer/context_pass_orchestrator_owner.js",
  ]);
  const contextCommandRefs = new Set(
    contextReport.recommendedCommands.map((command) => command.commandRef),
  );
  assert.deepEqual(contextReport.unmatchedChangedFiles, []);
  for (const commandRef of [
    "test:node:context-pass-orchestrator-owner",
    "test:node:renderer-pass-family-inventory",
    "test:python:map-renderer-render-pipeline-passes-boundary",
    "test:node:physical-layer-contracts",
    "test:node:river-layer-contracts",
    "test:node:scenario-chunk-contracts",
    "verify:pages-dist-and-drift",
    "perf:gate",
    "test:e2e:physical-layer-runtime-contract",
    "test:e2e:water-rendering",
    "test:e2e:scenario-resilience",
    "test:e2e:tno-contracts",
    "test:e2e:city-rendering",
  ]) {
    assert.equal(
      contextCommandRefs.has(commandRef),
      true,
      `context owner should select ${commandRef}`,
    );
  }

  const visualReport = buildRecommendation([
    "js/core/renderer/visual_effects_pass_owner.js",
  ]);
  const visualCommandRefs = new Set(
    visualReport.recommendedCommands.map((command) => command.commandRef),
  );
  assert.deepEqual(visualReport.unmatchedChangedFiles, []);
  for (const commandRef of [
    "test:node:visual-effects-pass-owner",
    "test:node:renderer-pass-family-inventory",
    "test:python:map-renderer-render-pipeline-passes-boundary",
    "verify:pages-dist-and-drift",
    "perf:gate",
    "test:e2e:layer:regression",
    "test:e2e:city-rendering",
  ]) {
    assert.equal(
      visualCommandRefs.has(commandRef),
      true,
      `visual effects owner should select ${commandRef}`,
    );
  }

  const politicalPreflightReport = buildRecommendation([
    "tests/renderer_political_pass_orchestration_preflight.test.mjs",
  ]);
  const politicalPreflightCommandRefs = new Set(
    politicalPreflightReport.recommendedCommands.map((command) => command.commandRef),
  );
  assert.deepEqual(politicalPreflightReport.unmatchedChangedFiles, []);
  assert.equal(
    politicalPreflightCommandRefs.has("test:node:renderer-political-pass-orchestration-preflight"),
    true,
  );

  const politicalReport = buildRecommendation([
    "js/core/renderer/political_pass_orchestrator_owner.js",
  ]);
  const politicalCommandRefs = new Set(
    politicalReport.recommendedCommands.map((command) => command.commandRef),
  );
  assert.deepEqual(politicalReport.unmatchedChangedFiles, []);
  for (const commandRef of [
    "test:node:political-pass-orchestrator-owner",
    "test:node:renderer-political-pass-orchestration-preflight",
    "test:python:map-renderer-political-pass-orchestrator-boundary",
    "test:node:renderer-pass-family-inventory",
    "test:python:map-renderer-render-pipeline-passes-boundary",
    "test:node:scenario-chunk-contracts",
    "test:node:political-raster-worker-packet",
    "test:node:political-collection-fragment-camouflage",
    "verify:pages-dist-and-drift",
    "perf:gate",
    "test:e2e:dev:political-progressive-recovery",
    "test:e2e:dev:scenario-chunk-runtime",
    "test:e2e:scenario-resilience",
    "test:e2e:physical-layer-runtime-contract",
    "test:e2e:water-rendering",
    "test:e2e:tno-contracts",
  ]) {
    assert.equal(
      politicalCommandRefs.has(commandRef),
      true,
      `political pass owner should select ${commandRef}`,
    );
  }

  const politicalBackgroundReport = buildRecommendation([
    "js/core/renderer/political_background_render_owner.js",
  ]);
  const politicalBackgroundCommandRefs = new Set(
    politicalBackgroundReport.recommendedCommands.map((command) => command.commandRef),
  );
  assert.deepEqual(politicalBackgroundReport.unmatchedChangedFiles, []);
  for (const commandRef of [
    "test:node:ocean-depth-layer-contracts",
    "test:node:political-background-render-owner",
    "test:node:political-pass-orchestrator-owner",
    "test:node:renderer-pass-family-inventory",
    "test:python:map-renderer-political-background-render-owner-boundary",
    "test:node:scenario-chunk-contracts",
    "verify:pages-dist-and-drift",
    "perf:gate",
    "test:e2e:dev:political-progressive-recovery",
    "test:e2e:dev:scenario-chunk-runtime",
    "test:e2e:scenario-resilience",
    "test:e2e:physical-layer-runtime-contract",
    "test:e2e:water-rendering",
    "test:e2e:tno-contracts",
  ]) {
    assert.equal(
      politicalBackgroundCommandRefs.has(commandRef),
      true,
      `political background owner should select ${commandRef}`,
    );
  }

  const politicalPartialReport = buildRecommendation([
    "js/core/renderer/political_partial_repaint_owner.js",
  ]);
  const politicalPartialCommandRefs = new Set(
    politicalPartialReport.recommendedCommands.map((command) => command.commandRef),
  );
  assert.deepEqual(politicalPartialReport.unmatchedChangedFiles, []);
  for (const commandRef of [
    "test:node:political-partial-repaint-owner",
    "test:python:map-renderer-political-partial-repaint-owner-boundary",
    "test:node:political-pass-orchestrator-owner",
    "test:node:scenario-chunk-contracts",
    "test:node:political-raster-worker-packet",
    "perf:gate",
    "test:e2e:dev:political-progressive-recovery",
    "test:e2e:dev:scenario-chunk-runtime",
    "test:e2e:scenario-resilience",
    "test:e2e:physical-layer-runtime-contract",
    "test:e2e:water-rendering",
    "test:e2e:tno-contracts",
  ]) {
    assert.equal(
      politicalPartialCommandRefs.has(commandRef),
      true,
      `political partial repaint owner should select ${commandRef}`,
    );
  }

  assert.match(
    packageJson.scripts["test:python:map-renderer-render-pipeline-passes-boundary"],
    /tests\.test_map_renderer_render_pipeline_passes_boundary_contract[\s\S]*tests\.test_map_renderer_strategic_values_render_contract/,
  );
  const pipelineBoundaryEntry = VERIFICATION_DOMAINS.find((candidate) => (
    candidate.id === "verify-core:test:python:map-renderer-render-pipeline-passes-boundary"
  ));
  assert.ok(
    pipelineBoundaryEntry.sourceRefs.includes(
      "tests/test_map_renderer_strategic_values_render_contract.py",
    ),
  );
  assert.ok(
    pipelineBoundaryEntry.sourceRefs.includes(
      "js/core/renderer/political_pass_orchestrator_owner.js",
    ),
  );
});

test("verify-core reserved plan preserves metadata closure before command supersession", () => {
  const packageJson = readJson("package.json");
  const metadataDefaultRefs = commandRefsFromGroups(buildVerifyCoreDefaultGroups());
  const metadataPlan = buildCoreVerificationPlan({
    packageScripts: packageJson.scripts,
    applySupersession: false,
    includeReserved: true,
  });
  const plan = buildCoreVerificationPlan({ packageScripts: packageJson.scripts, includeReserved: true });

  assert.deepEqual(
    metadataPlan.commandsToRun.map((entry) => entry.commandRef),
    metadataDefaultRefs,
  );
  const supersededRefs = plan.supersededCommands.map((entry) => entry.commandRef);
  assert.deepEqual(
    plan.commandsToRun.map((entry) => entry.commandRef),
    metadataDefaultRefs.filter((ref) => !supersededRefs.includes(ref)),
  );
  assert.deepEqual(
    plan.supersededCommands.map((entry) => entry.commandRef),
    [
      "test:node:renderer-render-phase-lifecycle",
      "test:node:zoom-interaction-lifecycle-owner",
      "test:node:scenario-chunk-contracts",
      "test:node:scenario-apply-transaction-ownership",
      "test:node:scenario-lifecycle-runtime-behavior",
      "test:node:scenario-runtime-state-behavior",
    ],
  );
  assert.equal(plan.omittedCommands.length, 0);
  assert.equal(plan.duplicateCommands.length, 0);
  assert.ok(metadataDefaultRefs.includes("test:node:verification-metadata"));
  assert.ok(metadataDefaultRefs.includes("test:node:political-background-render-owner"));
  assert.ok(metadataDefaultRefs.includes(
    "test:python:map-renderer-political-background-render-owner-boundary",
  ));
});

test("verify-core main-thread and optional E2E commands are generated from verification metadata", () => {
  const packageJson = readJson("package.json");
  const includeMainThreadPlan = buildCoreVerificationPlan({
    packageScripts: packageJson.scripts,
    includeMainThread: true,
  });

  assert.deepEqual(
    includeMainThreadPlan.groups.find((group) => group.id === "main-thread-e2e")?.commands.map((entry) => entry.commandRef),
    buildVerifyCoreMainThreadGroup().commands,
  );
  assert.deepEqual(
    includeMainThreadPlan.skippedMainThreadCommands.map((entry) => entry.commandRef),
    getVerifyCoreOptionalMainThreadCommands(),
  );
});

test("route registry consumes verification metadata route projection", () => {
  const routesById = new Map(buildRouteIndex().map((route) => [route.id, route]));
  for (const metadataRoute of buildVerificationMetadataRoutes()) {
    assert.deepEqual(
      routeFields(routesById.get(metadataRoute.id)),
      routeFields(metadataRoute),
      `${metadataRoute.id} should match the verification metadata route projection`,
    );
  }
});

test("metadata files route to test-routing without unmatched changed files", () => {
  const report = buildRecommendation([
    "tools/verification/verification_domains.mjs",
    "tools/verification/verification_metadata_helpers.mjs",
    "tests/verification_metadata_behavior.test.mjs",
    "docs/testing/verification-metadata.md",
  ]);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(report.coveredDomains.includes("test-routing"));
  assert.ok(report.recommendedCommands.some((command) => command.commandRef === "test:node:verification-metadata"));
});

test("adaptive production CLI JSON fixtures use exact core-runner route scope", () => {
  const fixturePaths = [
    "tests/fixtures/adaptive_local_cli_source_mismatch.json",
    "tests/fixtures/adaptive_local_cli_missing_selector.json",
    "tests/fixtures/adaptive_local_cli_renamed_selector.json",
    "tests/fixtures/adaptive_local_cli_valid.json",
    "tests/fixtures/adaptive_local_cli_recursive.json",
  ];
  const report = buildRecommendation(fixturePaths);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  for (const entry of report.matchedByFile) {
    assert.ok(entry.matchedRouteIds.includes("infra:core-verification-runner"));
    assert.ok(entry.recommendedCommands.some((command) => (
      command.commandRef === "test:node:verify-core-runner"
    )));
  }

  const route = buildRouteIndex().find((entry) => entry.id === "infra:core-verification-runner");
  const sourceRefs = route.sourceRef.split(",");
  for (const fixturePath of fixturePaths) assert.ok(sourceRefs.includes(fixturePath));
  assert.equal(sourceRefs.includes("tests/fixtures/adaptive_local_cli_fixture.mjs"), false);

  const adjacentPaths = [
    "tests/fixtures/adaptive_local_cli_source_mismatch_renamed.json",
    "tests/fixtures/adaptive_local_cli_budget_gap.json",
  ];
  const adjacentReport = buildRecommendation(adjacentPaths);
  assert.deepEqual(adjacentReport.unmatchedChangedFiles, adjacentPaths.sort());
  assert.equal(adjacentReport.matchedByFile.some((entry) => (
    entry.matchedRouteIds.includes("infra:core-verification-runner")
  )), false);
});

test("heavy dependency classification selects Python unit tests without consuming adjacent fixtures", () => {
  const pythonTestPaths = [
    "tests/test_future_heavy_dependency.py",
    "tests/nested/test_future_heavy_dependency.py",
    "tests/heavy_dependency_groups.json",
  ];
  const report = buildRecommendation(pythonTestPaths);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  for (const entry of report.matchedByFile) {
    assert.ok(entry.matchedRouteIds.includes("infra:heavy-test-classification"));
  }

  const adjacentPaths = [
    "tests/fixtures/adaptive_local_cli_source_mismatch_renamed.json",
    "tests/fixtures/adaptive_local_cli_budget_gap.json",
  ];
  const adjacentReport = buildRecommendation(adjacentPaths);
  assert.deepEqual(adjacentReport.unmatchedChangedFiles, adjacentPaths.sort());
  assert.equal(adjacentReport.matchedByFile.some((entry) => (
    entry.matchedRouteIds.includes("infra:heavy-test-classification")
  )), false);
});

test("adaptive and selector direct route commands require exact parameter contracts", () => {
  const route = {
    id: "fixture:exact-direct-command",
    commandRef: "node tools/run_adaptive_tests.mjs --entrypoint impact --execute --defer-main-thread",
    sourceRef: "tools/run_adaptive_tests.mjs",
    domain: "test-routing",
    ownerHint: "test-infra",
    layer: "contract",
    cost: "fast",
    resourceLocks: [],
    executionOwner: "child-safe",
    ciProfile: "pr-fast",
  };
  assert.equal(validateRouteIndex([route]).count, 1);
  for (const commandRef of [
    "node tools/run_adaptive_tests.mjs --entrypoint impact --execute --defer-main-thread-renamed",
    "node tools/run_adaptive_tests.mjs --execute --defer-main-thread",
    "node tools/select_verification_targets.mjs --check-renamed",
  ]) {
    assert.throws(
      () => validateRouteIndex([{ ...route, id: `fixture:${commandRef}`, commandRef }]),
      /commandRef is not a package script or known command/,
    );
  }
});

test("retired renderer context commands leave real owner verification routes intact", () => {
  const retiredCommandPrefix = "test:node:renderer-runtime-context-";
  assert.equal(Object.keys(VERIFICATION_METADATA_SOURCE.packageScripts).some((name) => name.startsWith(retiredCommandPrefix)), false);
  assert.equal(VERIFICATION_METADATA_SOURCE.records.some((record) => record.commandRef.startsWith(retiredCommandPrefix)), false);
  assert.equal(VERIFICATION_METADATA_SOURCE.records.some((record) => record.sourceRefs.includes("js/core/map_renderer/renderer_runtime_context.js")), false);

  for (const [files, commands] of [
    [["js/core/map_renderer/render_pass_cache_host_owner.js", "js/core/map_renderer/render_pass_commit_accounting_owner.js"],
      ["test:node:render-pass-cache-host-owner-suite", "test:node:render-pass-commit-accounting-owner-suite"]],
    [["js/core/renderer/render_cache_owner.js"], ["test:node:render-cache-owner"]],
    [["js/core/renderer/renderer_projection_path_owner.js", "js/core/renderer/viewport_read_model_owner.js", "js/core/renderer/viewport_command_owner.js"],
      ["test:node:renderer-projection-path-owner", "test:node:renderer-projection-contract", "test:node:viewport-read-model-owner", "test:node:viewport-command-owner"]],
    [["js/core/renderer/renderer_viewport_update_owner.js", "js/core/renderer/viewport_resize_lifecycle_owner.js"],
      ["test:node:renderer-viewport-update-owner", "test:node:viewport-resize-lifecycle-owner"]],
    [["js/core/renderer/zoom_interaction_lifecycle_owner.js", "js/core/renderer/map_interaction_event_binding_owner.js"],
      ["test:node:zoom-interaction-lifecycle-owner", "test:node:map-interaction-event-binding-owner"]],
    [["js/core/map_renderer/hit_canvas_scheduling_owner.js", "js/core/map_renderer/map_hover_interaction_owner.js"],
      ["test:node:hit-canvas-scheduling-owner-suite", "test:node:map-hover-interaction-owner"]],
  ]) {
    const report = buildRecommendation(files);
    assert.deepEqual(report.unmatchedChangedFiles, []);
    assert.ok(report.coveredDomains.includes("renderer-runtime"));
    const selected = new Set(report.recommendedCommands.map((command) => command.commandRef));
    for (const command of commands) assert.ok(selected.has(command), command);
  }
});

test("renderer click selection P1.8 files route to owner and both canonical boundary commands", () => {
  const expectedEntries = new Map([
    [
      "verify-core:test:node:click-selection-transaction-owner",
      "test:node:click-selection-transaction-owner",
    ],
    [
      "verify-core:test:node:renderer-click-selection-transaction-inventory",
      "test:node:renderer-click-selection-transaction-inventory",
    ],
    [
      "verify-core:test:python:map-renderer-click-selection-transaction-boundary",
      "test:python:map-renderer-click-selection-transaction-boundary",
    ],
  ]);
  for (const [id, commandRef] of expectedEntries) {
    const entry = VERIFICATION_DOMAINS.find((candidate) => candidate.id === id);
    assert.ok(entry, `${id} should exist in verification metadata`);
    assert.deepEqual(
      {
        commandRef: entry.commandRef,
        domain: entry.domain,
        ownerHint: entry.ownerHint,
        layer: entry.layer,
        cost: entry.cost,
        resourceLocks: entry.resourceLocks,
        executionOwner: entry.executionOwner,
        ciProfile: entry.ciProfile,
        verifyCoreDefaultGroup: entry.verifyCoreDefaultGroup,
        supervisorDomain: entry.supervisorDomain,
        routeRegistry: entry.routeRegistry,
      },
      {
        commandRef,
        domain: "renderer-runtime",
        ownerHint: "renderer-runtime",
        layer: "contract",
        cost: "fast",
        resourceLocks: [],
        executionOwner: "child-safe",
        ciProfile: "pr-fast",
        verifyCoreDefaultGroup: "renderer-owner",
        supervisorDomain: "renderer-runtime",
        routeRegistry: true,
      },
    );
    assert.ok(entry.sourceRefs.includes("docs/active/renderer-click-selection-transaction-preflight-p1-7-20260709.md"));
    assert.ok(entry.sourceRefs.includes("docs/active/renderer-click-selection-pure-decision-owner-p1-8-20260709.md"));
    assert.ok(entry.sourceRefs.includes("js/core/map_renderer/click_selection_transaction_owner.js"));
    assert.ok(entry.sourceRefs.includes("tests/click_selection_transaction_owner_behavior.test.mjs"));
  }

  const ownerOnlyReport = buildRecommendation([
    "js/core/map_renderer/click_selection_transaction_owner.js",
  ]);
  assert.deepEqual(ownerOnlyReport.unmatchedChangedFiles, []);
  for (const commandRef of [
    "test:node:click-selection-transaction-owner",
    "test:node:renderer-click-selection-transaction-inventory",
    "test:python:map-renderer-click-selection-transaction-boundary",
    "verify:architecture-boundaries",
    "verify:pages-dist-and-drift",
  ]) {
    assert.ok(
      ownerOnlyReport.recommendedCommands.some((command) => command.commandRef === commandRef),
      `owner-only routing must recommend ${commandRef}`,
    );
  }

  const report = buildRecommendation([
    "docs/active/_worktree_registry.md",
    "docs/active/renderer-click-selection-transaction-preflight-20260702.md",
    "docs/active/renderer-click-selection-transaction-preflight-p1-7-20260709.md",
    "docs/active/renderer-click-selection-pure-decision-owner-p1-8-20260709.md",
    "docs/active/renderer-runtime-context-p1-remaining-20260709/context.md",
    "docs/active/renderer-runtime-context-p1-remaining-20260709/plan.md",
    "docs/active/renderer-runtime-context-p1-remaining-20260709/task.md",
    "package.json",
    "js/core/map_renderer.js",
    "js/core/map_renderer/click_selection_transaction_owner.js",
    "tests/click_selection_transaction_owner_behavior.test.mjs",
    "tests/renderer_click_selection_transaction_inventory_boundary.test.mjs",
    "tests/test_map_renderer_click_selection_transaction_boundary_contract.py",
    "tests/verification_metadata_behavior.test.mjs",
    "tests/verify_core_runner_behavior.test.mjs",
    "tools/check_architecture_boundaries.mjs",
    "tools/verification/verification_domains.mjs",
  ]);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(report.coveredDomains.includes("renderer-runtime"));
  assert.ok(report.recommendedCommands.some((command) => command.commandRef === "test:node:click-selection-transaction-owner"));
  assert.ok(report.recommendedCommands.some((command) => command.commandRef === "test:node:renderer-click-selection-transaction-inventory"));
  assert.ok(report.recommendedCommands.some((command) => command.commandRef === "test:python:map-renderer-click-selection-transaction-boundary"));
});

test("renderer draw canvas P2.1 files route to owner behavior inventory and boundary commands", () => {
  const expectedEntries = new Map([
    [
      "verify-core:test:node:draw-canvas-orchestration-owner",
      "test:node:draw-canvas-orchestration-owner",
    ],
    [
      "verify-core:test:node:renderer-draw-canvas-orchestration-inventory",
      "test:node:renderer-draw-canvas-orchestration-inventory",
    ],
    [
      "verify-core:test:python:map-renderer-draw-canvas-orchestration-boundary",
      "test:python:map-renderer-draw-canvas-orchestration-boundary",
    ],
  ]);
  for (const [id, commandRef] of expectedEntries) {
    const entry = VERIFICATION_DOMAINS.find((candidate) => candidate.id === id);
    assert.ok(entry, `${id} should exist in verification metadata`);
    assert.deepEqual(
      {
        commandRef: entry.commandRef,
        domain: entry.domain,
        ownerHint: entry.ownerHint,
        layer: entry.layer,
        cost: entry.cost,
        resourceLocks: entry.resourceLocks,
        executionOwner: entry.executionOwner,
        ciProfile: entry.ciProfile,
        verifyCoreDefaultGroup: entry.verifyCoreDefaultGroup,
        supervisorDomain: entry.supervisorDomain,
        routeRegistry: entry.routeRegistry,
      },
      {
        commandRef,
        domain: "renderer-runtime",
        ownerHint: "renderer-runtime",
        layer: "contract",
        cost: "fast",
        resourceLocks: [],
        executionOwner: "child-safe",
        ciProfile: "pr-fast",
        verifyCoreDefaultGroup: "renderer-owner",
        supervisorDomain: "renderer-runtime",
        routeRegistry: true,
      },
    );
    assert.ok(entry.sourceRefs.includes("js/core/map_renderer/draw_canvas_orchestration_owner.js"));
    assert.ok(entry.sourceRefs.includes("tests/draw_canvas_orchestration_owner_behavior.test.mjs"));
    assert.ok(entry.sourceRefs.includes("docs/archive/renderer-frame-orchestration-p2-20260710/renderer-draw-canvas-orchestration-owner-p2-1-20260710.md"));
  }

  const ownerOnlyReport = buildRecommendation([
    "js/core/map_renderer/draw_canvas_orchestration_owner.js",
  ]);
  assert.deepEqual(ownerOnlyReport.unmatchedChangedFiles, []);
  for (const commandRef of [
    "test:node:draw-canvas-orchestration-owner",
    "test:node:renderer-draw-canvas-orchestration-inventory",
    "test:python:map-renderer-draw-canvas-orchestration-boundary",
    "verify:architecture-boundaries",
    "verify:pages-dist-and-drift",
  ]) {
    assert.ok(
      ownerOnlyReport.recommendedCommands.some((command) => command.commandRef === commandRef),
      `owner-only routing must recommend ${commandRef}`,
    );
  }

  const report = buildRecommendation([
    "docs/active/_worktree_registry.md",
    "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-draw-canvas-orchestration-preflight-20260702.md",
    "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-draw-canvas-orchestration-owner-p2-1-20260710.md",
    "docs/archive/renderer-frame-orchestration-p2-20260710/context.md",
    "docs/archive/renderer-frame-orchestration-p2-20260710/task.md",
    "package.json",
    "js/core/map_renderer.js",
    "js/core/map_renderer/draw_canvas_orchestration_owner.js",
    "tests/draw_canvas_orchestration_owner_behavior.test.mjs",
    "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
    "tests/test_map_renderer_draw_canvas_orchestration_owner_boundary_contract.py",
    "tests/verification_metadata_behavior.test.mjs",
    "tests/verify_core_runner_behavior.test.mjs",
    "tools/check_architecture_boundaries.mjs",
    "tools/verification/verification_domains.mjs",
  ]);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(report.coveredDomains.includes("renderer-runtime"));
  assert.ok(report.recommendedCommands.some((command) => command.commandRef === "test:node:draw-canvas-orchestration-owner"));
  assert.ok(report.recommendedCommands.some((command) => command.commandRef === "test:node:renderer-draw-canvas-orchestration-inventory"));
  assert.ok(report.recommendedCommands.some((command) => command.commandRef === "test:python:map-renderer-draw-canvas-orchestration-boundary"));
});

test("renderer frame compositor P2.2 files route to behavior inventory boundary and Pages commands", () => {
  const expectedEntries = new Map([
    [
      "verify-core:test:node:cached-pass-compositor-owner",
      "test:node:cached-pass-compositor-owner",
    ],
    [
      "verify-core:test:node:transformed-frame-compositor-owner",
      "test:node:transformed-frame-compositor-owner",
    ],
    [
      "verify-core:test:python:map-renderer-frame-compositor-boundary",
      "test:python:map-renderer-frame-compositor-boundary",
    ],
  ]);
  for (const [id, commandRef] of expectedEntries) {
    const entry = VERIFICATION_DOMAINS.find((candidate) => candidate.id === id);
    assert.ok(entry, `${id} should exist in verification metadata`);
    assert.deepEqual(
      {
        commandRef: entry.commandRef,
        domain: entry.domain,
        ownerHint: entry.ownerHint,
        layer: entry.layer,
        cost: entry.cost,
        resourceLocks: entry.resourceLocks,
        executionOwner: entry.executionOwner,
        ciProfile: entry.ciProfile,
        verifyCoreDefaultGroup: entry.verifyCoreDefaultGroup,
        supervisorDomain: entry.supervisorDomain,
        routeRegistry: entry.routeRegistry,
      },
      {
        commandRef,
        domain: "renderer-runtime",
        ownerHint: "renderer-runtime",
        layer: "contract",
        cost: "fast",
        resourceLocks: [],
        executionOwner: "child-safe",
        ciProfile: "pr-fast",
        verifyCoreDefaultGroup: "renderer-owner",
        supervisorDomain: "renderer-runtime",
        routeRegistry: true,
      },
    );
    if (commandRef === "test:node:cached-pass-compositor-owner") {
      assert.ok(entry.sourceRefs.includes("js/core/renderer/cached_pass_compositor_owner.js"));
      assert.ok(entry.sourceRefs.includes("tests/cached_pass_compositor_owner_behavior.test.mjs"));
    }
    if (commandRef === "test:node:transformed-frame-compositor-owner") {
      assert.ok(entry.sourceRefs.includes("js/core/map_renderer/transformed_frame_compositor_owner.js"));
      assert.ok(entry.sourceRefs.includes("tests/transformed_frame_compositor_owner_behavior.test.mjs"));
    }
    assert.ok(entry.sourceRefs.some((sourceRef) => sourceRef.includes("renderer-") && sourceRef.endsWith(".md")));
  }

  const ownerOnlyReport = buildRecommendation([
    "js/core/renderer/cached_pass_compositor_owner.js",
    "js/core/map_renderer/transformed_frame_compositor_owner.js",
  ]);
  assert.deepEqual(ownerOnlyReport.unmatchedChangedFiles, []);
  for (const commandRef of [
    "test:node:cached-pass-compositor-owner",
    "test:node:transformed-frame-compositor-owner",
    "test:node:renderer-draw-canvas-orchestration-inventory",
    "test:python:map-renderer-frame-compositor-boundary",
    "verify:architecture-boundaries",
    "verify:pages-dist-and-drift",
  ]) {
    assert.ok(
      ownerOnlyReport.recommendedCommands.some((command) => command.commandRef === commandRef),
      `cached-pass owner routing must recommend ${commandRef}`,
    );
  }
  const transformedRuntimeEntry = VERIFICATION_DOMAINS.find((entry) => entry.id === "renderer:transformed-frame-compositor-runtime");
  assert.ok(transformedRuntimeEntry);
  assert.equal(transformedRuntimeEntry.commandRef, "test:e2e:dev:scenario-chunk-runtime");
  assert.equal(transformedRuntimeEntry.executionOwner, "main-thread");
  assert.ok(transformedRuntimeEntry.sourceRefs.includes("js/core/map_renderer/transformed_frame_compositor_owner.js"));
  assert.ok(ownerOnlyReport.mainThreadSerialVerification.some((command) => (
    command.commandRef === "test:e2e:dev:scenario-chunk-runtime"
  )));
});

test("Windows Job V2 routes child-safe contracts separately from bounded live integration", () => {
  const generatedNodeRoutes = buildNodeRoutes();
  for (const commandRef of [
    "test:node:p4:state-writer-policy",
    "test:node:p4:state-writer-policy:quick",
  ]) {
    assert.equal(
      generatedNodeRoutes.find((entry) => entry.commandRef === commandRef)?.domain,
      "state-ownership",
    );
  }
  const fullPolicyRoute = generatedNodeRoutes.find((entry) => (
    entry.commandRef === "test:node:p4:state-writer-policy"
  ));
  const quickPolicyRoute = generatedNodeRoutes.find((entry) => (
    entry.commandRef === "test:node:p4:state-writer-policy:quick"
  ));
  assert.deepEqual({
    cost: fullPolicyRoute.cost,
    resourceLocks: fullPolicyRoute.resourceLocks,
    executionOwner: fullPolicyRoute.executionOwner,
    ciProfile: fullPolicyRoute.ciProfile,
  }, {
    cost: "heavy",
    resourceLocks: [".runtime-output"],
    executionOwner: "main-thread",
    ciProfile: "full",
  });
  assert.deepEqual({
    cost: quickPolicyRoute.cost,
    resourceLocks: quickPolicyRoute.resourceLocks,
    executionOwner: quickPolicyRoute.executionOwner,
    ciProfile: quickPolicyRoute.ciProfile,
  }, {
    cost: "fast",
    resourceLocks: [],
    executionOwner: "child-safe",
    ciProfile: "pr-fast",
  });
  for (const commandRef of [
    "test:node:windows-job-runtime",
    "test:node:windows-job-runtime:integration",
  ]) {
    assert.equal(
      generatedNodeRoutes.find((entry) => entry.commandRef === commandRef)?.domain,
      "test-routing",
    );
  }

  const contractEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "infra:windows-job-runtime-contract"
  ));
  const integrationEntry = VERIFICATION_DOMAINS.find((entry) => (
    entry.id === "infra:windows-job-runtime-integration"
  ));
  assert.ok(contractEntry);
  assert.ok(integrationEntry);
  assert.equal(contractEntry.commandRef, "test:node:windows-job-runtime");
  assert.equal(contractEntry.executionOwner, "child-safe");
  assert.deepEqual(contractEntry.platforms, ["win32"]);
  assert.equal(contractEntry.verifyCoreDefaultGroup, "infra");
  assert.deepEqual(contractEntry.resourceLocks, []);
  assert.equal(integrationEntry.commandRef, "test:node:windows-job-runtime:integration");
  assert.equal(integrationEntry.executionOwner, "main-thread");
  assert.deepEqual(integrationEntry.platforms, ["win32"]);
  assert.equal(integrationEntry.optionalMainThread, true);
  assert.deepEqual(integrationEntry.resourceLocks, [".runtime-output"]);

  for (const sourceRef of [
    "tools/process_containment/windows_job_runtime.mjs",
    "tools/process_containment/windows_job_runner_v2.cs",
    "tools/process_containment/windows_job_runner_core.cs",
  ]) {
    const report = buildRecommendation([sourceRef], undefined, { platform: "win32" });
    assert.deepEqual(report.unmatchedChangedFiles, []);
    const commands = commandsForChangedFile(report, sourceRef);
    assert.ok(commands.some((command) => command.commandRef === contractEntry.commandRef));
    assert.ok(commands.some((command) => command.commandRef === integrationEntry.commandRef));
    for (const command of commands.filter((entry) => (
      entry.commandRef === contractEntry.commandRef
      || entry.commandRef === integrationEntry.commandRef
    ))) {
      assert.ok(command.domains.includes("test-routing"));
      assert.equal(command.domains.includes("renderer-runtime"), false);
    }
  }
  const testReport = buildRecommendation([
    "tests/windows_job_runner_v2_native_contract.test.mjs",
    "tests/windows_job_runtime_behavior.test.mjs",
    "tests/windows_job_runtime_integration.test.mjs",
  ], undefined, { platform: "win32" });
  assert.deepEqual(testReport.unmatchedChangedFiles, []);
});

test("Williams crossover tooling routes to child-safe governance plus an explicit heavy perf lane", () => {
  const policyEntry = VERIFICATION_DOMAINS.find((entry) => entry.id === "infra:williams-crossover-governance");
  const jobRunnerEntry = VERIFICATION_DOMAINS.find((entry) => entry.id === "infra:williams-crossover-job-runner");
  const liveEntry = VERIFICATION_DOMAINS.find((entry) => entry.id === "perf:williams-crossover-live");
  const liveTelemetryEntry = VERIFICATION_DOMAINS.find((entry) => entry.id === "perf:williams-crossover-telemetry-live");
  assert.ok(policyEntry);
  assert.ok(jobRunnerEntry);
  assert.ok(liveEntry);
  assert.ok(liveTelemetryEntry);
  assert.equal(policyEntry.commandRef, "test:node:williams-crossover-governance");
  assert.equal(policyEntry.executionOwner, "child-safe");
  assert.deepEqual(policyEntry.platforms, ["win32"]);
  assert.equal(policyEntry.verifyCoreDefaultGroup, "infra");
  assert.equal(jobRunnerEntry.commandRef, "test:node:williams-crossover-job-runner");
  assert.equal(jobRunnerEntry.executionOwner, "child-safe");
  assert.deepEqual(jobRunnerEntry.platforms, ["win32"]);
  assert.equal(jobRunnerEntry.verifyCoreDefaultGroup, "infra");
  assert.ok(policyEntry.sourceRefs.includes("tools/process_containment/windows_job_runner_core.cs"));
  assert.ok(jobRunnerEntry.sourceRefs.includes("tools/process_containment/windows_job_runner_core.cs"));
  assert.ok(policyEntry.sourceRefs.includes("tools/process_containment/ordered_source_set_identity.mjs"));
  assert.ok(jobRunnerEntry.sourceRefs.includes("tools/process_containment/ordered_source_set_identity.mjs"));
  assert.deepEqual(liveEntry, {
    ...liveEntry,
    commandRef: "perf:williams-crossover:run",
    domain: "perf",
    ownerHint: "perf-runtime",
    layer: "heavy",
    cost: "heavy",
    resourceLocks: [".runtime-output", "browser-dev-server", "perf-dev-server", "playwright-browser", "system-power-scheme"],
    executionOwner: "main-thread",
    ciProfile: "perf-pr-gate",
    supervisorDomain: "perf",
    routeRegistry: true,
  });
  assert.equal(liveEntry.verifyCoreDefaultGroup, undefined);
  assert.deepEqual(liveEntry.platforms, ["win32"]);
  assert.deepEqual(liveEntry.sourceRefs, [
    "tools/perf/williams_crossover_policy.mjs",
    "tools/perf/run_williams_crossover.mjs",
    "tools/perf/williams_crossover_windows_runtime.mjs",
    "tools/perf/williams_crossover_windows_job_runner.cs",
    "tools/process_containment/windows_job_runner_core.cs",
    "tools/process_containment/ordered_source_set_identity.mjs",
    "tools/perf/williams_crossover_power_scheme.ps1",
    "tools/perf/run_baseline.mjs",
    "tools/perf/render_sample_role_policy.mjs",
    "package-lock.json",
    "package.json",
  ].sort());
  assert.deepEqual(liveTelemetryEntry, {
    ...liveTelemetryEntry,
    commandRef: "test:node:williams-crossover-telemetry-live",
    domain: "perf",
    ownerHint: "perf-runtime",
    layer: "regression",
    cost: "contract",
    resourceLocks: ["perf-dev-server"],
    executionOwner: "main-thread",
    ciProfile: "perf-pr-gate",
    supervisorDomain: "perf",
    routeRegistry: true,
  });
  assert.equal(liveTelemetryEntry.verifyCoreDefaultGroup, undefined);
  assert.deepEqual(liveTelemetryEntry.platforms, ["win32"]);

  const runtimeReport = buildRecommendation([
    "tools/perf/williams_crossover_policy.mjs",
    "tools/perf/run_williams_crossover.mjs",
    "tools/perf/williams_crossover_windows_runtime.mjs",
  ], undefined, { platform: "win32" });
  assert.deepEqual(runtimeReport.unmatchedChangedFiles, []);
  assert.ok(runtimeReport.coveredDomains.includes("perf"));
  assert.ok(runtimeReport.recommendedCommands.some((command) => command.commandRef === "test:node:williams-crossover-governance"));
  assert.ok(runtimeReport.recommendedCommands.some((command) => command.commandRef === "test:node:williams-crossover-job-runner"));
  assert.ok(runtimeReport.mainThreadSerialVerification.some((command) => command.commandRef === "perf:williams-crossover:run"));
  assert.ok(runtimeReport.mainThreadSerialVerification.some((command) => command.commandRef === "test:node:williams-crossover-telemetry-live"));

  const sharedCoreReport = buildRecommendation(
    ["tools/process_containment/windows_job_runner_core.cs"],
    undefined,
    { platform: "win32" },
  );
  assert.deepEqual(sharedCoreReport.unmatchedChangedFiles, []);
  assert.ok(sharedCoreReport.recommendedCommands.some((command) => command.commandRef === "test:node:williams-crossover-governance"));
  assert.ok(sharedCoreReport.recommendedCommands.some((command) => command.commandRef === "test:node:williams-crossover-job-runner"));
  assert.ok(sharedCoreReport.mainThreadSerialVerification.some((command) => command.commandRef === "perf:williams-crossover:run"));

  const sourceIdentityReport = buildRecommendation(
    ["tools/process_containment/ordered_source_set_identity.mjs"],
    undefined,
    { platform: "win32" },
  );
  assert.deepEqual(sourceIdentityReport.unmatchedChangedFiles, []);
  assert.ok(sourceIdentityReport.recommendedCommands.some((command) => command.commandRef === "test:node:williams-crossover-governance"));
  assert.ok(sourceIdentityReport.recommendedCommands.some((command) => command.commandRef === "test:node:williams-crossover-job-runner"));
  assert.ok(sourceIdentityReport.mainThreadSerialVerification.some((command) => command.commandRef === "perf:williams-crossover:run"));

  const staticReport = buildRecommendation([
    "tests/williams_crossover_governance_behavior.test.mjs",
    "docs/archive/renderer-frame-orchestration-p2-20260710/plan.md",
    "docs/archive/renderer-frame-orchestration-p2-20260710/rerun07-final-repeat-governance.md",
    "docs/active/_worktree_registry.md",
  ], undefined, { platform: "win32" });
  assert.deepEqual(staticReport.unmatchedChangedFiles, []);
  assert.ok(staticReport.recommendedCommands.some((command) => command.commandRef === "test:node:williams-crossover-governance"));
  assert.equal(staticReport.mainThreadSerialVerification.some((command) => command.commandRef === "perf:williams-crossover:run"), false);

  const jobTestReport = buildRecommendation([
    "tests/williams_crossover_windows_job_runner_behavior.test.mjs",
    "tests/williams_crossover_windows_job_runner_integration.test.mjs",
  ], undefined, { platform: "win32" });
  assert.deepEqual(jobTestReport.unmatchedChangedFiles, []);
  assert.ok(jobTestReport.recommendedCommands.some((command) => command.commandRef === "test:node:williams-crossover-job-runner"));
  assert.equal(jobTestReport.mainThreadSerialVerification.some((command) => command.commandRef === "perf:williams-crossover:run"), false);
  assert.ok(jobTestReport.mainThreadSerialVerification.some((command) => command.commandRef === "test:node:williams-crossover-telemetry-live"));

  const defaultCoreCommands = buildVerifyCoreDefaultGroups()
    .flatMap((group) => group.commands.map((command) => command.commandRef));
  assert.equal(defaultCoreCommands.includes("test:node:williams-crossover-telemetry-live"), false);

  const identityInputs = ["tools/perf/run_baseline.mjs", "tools/perf/render_sample_role_policy.mjs", "package-lock.json"];
  const identityInputReport = buildRecommendation(identityInputs, undefined, { platform: "win32" });
  for (const sourceRef of identityInputs) {
    assert.ok(commandsForChangedFile(identityInputReport, sourceRef).some((command) => command.commandRef === "perf:williams-crossover:run"), sourceRef);
  }

  const linuxReport = buildRecommendation(
    ["tools/verification/verification_catalog_source.mjs"],
    undefined,
    { platform: "linux" },
  );
  assert.equal(linuxReport.selectionPlatform, "linux");
  for (const commandRef of [
    "test:node:williams-crossover-governance",
    "test:node:williams-crossover-job-runner",
    "test:node:williams-crossover-telemetry-live",
    "test:node:windows-job-runtime",
    "test:node:windows-job-runtime:integration",
    "perf:williams-crossover:run",
  ]) {
    assert.equal(
      linuxReport.recommendedCommands.some((command) => command.commandRef === commandRef),
      false,
      commandRef,
    );
  }
});

test("selector and catalog authority share contributor owner, lock, and CI reconciliation", () => {
  const authority = reconcileVerificationRouteAuthority(buildRouteIndex());
  const byCommand = new Map(authority.map((entry) => [entry.commandRef, entry]));
  const telemetry = byCommand.get("test:node:williams-crossover-telemetry-live");
  assert.ok(telemetry);
  assert.equal(telemetry.executionOwner, "main-thread");
  assert.deepEqual(telemetry.executionOwners, ["child-safe", "main-thread"]);
  assert.deepEqual(telemetry.resourceLocks, ["perf-dev-server"]);
  assert.deepEqual(telemetry.ciProfiles, ["perf-pr-gate", "pr-fast"]);
  assert.deepEqual(telemetry.platforms, ["win32"]);
  assert.ok(telemetry.safetyContributorRouteIds.includes("perf:williams-crossover-telemetry-live"));
  assert.ok(telemetry.safetyContributorRouteIds.includes("node:test:node:williams-crossover-telemetry-live"));

  const directPython = byCommand.get("python -m unittest tests.test_e2e_structural_tooling -q");
  assert.ok(directPython);
  assert.equal(directPython.executionOwner, "child-safe");
  assert.deepEqual(directPython.resourceLocks, []);
  assert.deepEqual(directPython.ciProfiles, ["pr-fast"]);

  const report = buildRecommendation(
    ["tests/williams_crossover_windows_job_runner_integration.test.mjs"],
    undefined,
    { platform: "win32" },
  );
  assert.deepEqual(report.routeAuthority, authority);
  const selectedTelemetry = report.recommendedCommands
    .find((entry) => entry.commandRef === telemetry.commandRef);
  assert.ok(selectedTelemetry);
  assert.deepEqual(selectedTelemetry.executionOwners, telemetry.executionOwners);
  assert.deepEqual(selectedTelemetry.resourceLocks, telemetry.resourceLocks);
  assert.deepEqual(selectedTelemetry.ciProfiles, telemetry.ciProfiles);
  assert.deepEqual(selectedTelemetry.safetyContributorRouteIds, telemetry.safetyContributorRouteIds);
});

test("dated schema-2 baseline artifacts route to the perf contract", () => {
  const entry = VERIFICATION_DOMAINS.find((candidate) => candidate.id === "infra:render-sample-role-policy");
  assert.ok(entry);
  const baselineSourceRefs = [
    "docs/perf/baseline_2026-07-14.json",
    "docs/perf/baseline_2026-07-14.md",
    "docs/perf/baseline_2026-07-30.json",
    "docs/perf/baseline_2026-07-30.md",
    "docs/perf/baseline_2026-07-30-ratification.json",
  ];
  const baselineReport = buildRecommendation(baselineSourceRefs);
  assert.deepEqual(baselineReport.unmatchedChangedFiles, []);
  for (const sourceRef of baselineSourceRefs) {
    assert.ok(entry.sourceRefs.includes(sourceRef), `${sourceRef} must be declared by the perf contract`);
    assert.ok(
      commandsForChangedFile(baselineReport, sourceRef).some((command) => command.commandRef === entry.commandRef),
      `${sourceRef} must select ${entry.commandRef}`,
    );
  }
});

test("baseline ratification receipt routes to both governed report contracts", () => {
  const sourceRef = "docs/perf/baseline_2026-07-30-ratification.json";
  const report = buildRecommendation([sourceRef]);
  const commands = commandsForChangedFile(report, sourceRef).map((command) => command.commandRef);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(commands.includes("test:node:render-sample-role-policy"));
  assert.ok(commands.includes("verify:perf-gate-contract"));
});

test("standard perf admission routes directly to the render sample role policy", () => {
  const sourceRef = "tools/perf/standard_perf_admission.mjs";
  const entry = VERIFICATION_DOMAINS.find(
    (candidate) => candidate.id === "infra:render-sample-role-policy",
  );
  assert.ok(entry?.sourceRefs.includes(sourceRef));
  const report = buildRecommendation([sourceRef]);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(
    report.recommendedCommands.some(
      (command) => command.commandRef === "test:node:render-sample-role-policy",
    ),
  );
});

test("city policy and live power preflight have named verification ownership", () => {
  const cityPolicyEntry = VERIFICATION_DOMAINS.find((entry) => entry.id === "verify-core:test:node:city-points-render-owner");
  assert.ok(cityPolicyEntry);
  assert.equal(cityPolicyEntry.commandRef, "test:node:city-points-render-owner");
  assert.equal(cityPolicyEntry.executionOwner, "child-safe");
  assert.equal(cityPolicyEntry.verifyCoreDefaultGroup, "renderer-owner");
  assert.ok(cityPolicyEntry.sourceRefs.includes("tests/urban_city_policy_strategic_values_behavior.test.mjs"));

  const cityBoundaryEntry = VERIFICATION_DOMAINS.find((entry) => entry.id === "verify-core:test:python:map-renderer-city-points-boundary");
  assert.ok(cityBoundaryEntry);
  assert.equal(cityBoundaryEntry.commandRef, "test:python:map-renderer-city-points-boundary");
  assert.equal(cityBoundaryEntry.executionOwner, "child-safe");

  const powerPreflightEntry = VERIFICATION_DOMAINS.find((entry) => entry.id === "perf:williams-power-scheme-live-preflight");
  assert.ok(powerPreflightEntry);
  assert.equal(powerPreflightEntry.commandRef, "perf:williams-power-scheme:live-preflight");
  assert.equal(powerPreflightEntry.executionOwner, "main-thread");
  assert.equal(powerPreflightEntry.optionalMainThread, true);
  assert.deepEqual(powerPreflightEntry.resourceLocks, ["system-power-scheme"]);
  assert.ok(powerPreflightEntry.sourceRefs.includes("tools/perf/williams_crossover_power_scheme.ps1"));

  const report = buildRecommendation([
    "js/core/renderer/urban_city_policy.js",
    "tests/urban_city_policy_strategic_values_behavior.test.mjs",
    "tools/perf/williams_crossover_power_scheme.ps1",
  ]);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(report.recommendedCommands.some((command) => command.commandRef === "test:node:city-points-render-owner"));
  assert.ok(report.recommendedCommands.some((command) => command.commandRef === "test:python:map-renderer-city-points-boundary"));
  assert.ok(report.mainThreadSerialVerification.some((command) => (
    command.commandRef === "perf:williams-power-scheme:live-preflight"
  )));
});


test("M4 overlay lifecycle edits select one shared behavior command within the edit budget", () => {
  const changedFiles = [
    "js/core/renderer/render_cache_owner.js",
    "js/core/renderer/scenario_region_overlay_render_owner.js",
    "js/core/renderer/scenario_relief_overlay_render_owner.js",
  ];
  const selection = constrainAdaptiveEntrypointSelection(
    buildAdaptiveEntrypointRecommendation(changedFiles, undefined, { entrypoint: "edit" }),
    "edit", { preparedCatalog: prepareRepositoryVerificationCatalog() },
  );
  assert.deepEqual(selection.unmatchedChangedFiles, []);
  assert.deepEqual(selection.localEntrypointRouteGaps, []);
  const sharedCommands = selection.recommendedCommands.filter(({ commandRef }) => commandRef.includes("scenario_region_overlay_render_owner_behavior"));
  assert.equal(sharedCommands.length, 1);
  for (const file of ["scenario_relief_overlay_render_owner_behavior", "render_cache_owner_invalidation_behavior"]) {
    assert.ok(sharedCommands[0].commandRef.includes(file));
  }
  for (const name of ["plan", "context", "task"]) {
    const report = buildRecommendation([`docs/active/development-recovery-m4-20260908/${name}.md`]);
    assert.deepEqual(report.unmatchedChangedFiles, []);
  }
});


test("editor checkout instructions retain a canonical verification route", () => {
  const report = buildRecommendation(["README.md"]);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(report.recommendedCommands.some(({ commandRef }) => commandRef === "python -m unittest tests.test_editor_checkout_profile -q"));
});
