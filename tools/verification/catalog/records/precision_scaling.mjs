// Additive routes: preserve the order and policy of every pre-existing record.
export function createPrecisionScalingRecords(existingRecords) {
  const start = Math.max(0, ...existingRecords.map((record) => record.selectorOrder || 0)) + 1;
  const routes = [
    ["scheduler", "scenario-runtime", "node --test tests/precision_scaling_scheduler_behavior.test.mjs", [
      "js/core/scenario/chunk_load_scheduler.js", "js/core/scenario/chunk_payload_loader.js", "tests/precision_scaling_scheduler_behavior.test.mjs",
    ]],
    ["store", "renderer-runtime", "node --test tests/precision_scaling_store_behavior.test.mjs", [
      "js/core/political_geometry_store.js", "js/core/scenario/chunk_layer_payloads.js", "tests/precision_scaling_store_behavior.test.mjs",
    ]],
    ["packed", "renderer-runtime", "node --test tests/precision_scaling_packed_geometry_behavior.test.mjs", [
      "js/core/renderer/packed_geometry.js", "js/core/renderer/geometry_raster_worker_kernel.js", "tests/precision_scaling_packed_geometry_behavior.test.mjs",
    ]],
    ["lod-selection", "scenario-runtime", "node --test tests/precision_scaling_lod_selection_behavior.test.mjs", [
      "js/core/scenario/political_lod_policy.js", "js/core/scenario_chunk_manager.js", "js/core/scenario/chunk_layer_payloads.js", "tests/precision_scaling_lod_selection_behavior.test.mjs",
    ]],
    ["lod-builder", "geo-contract", "python -m unittest tests.test_political_display_lods -q", [
      "tools/build_political_display_lods.py", "tests/test_political_display_lods.py",
    ]],
    ["routes", "test-routing", "node --test tests/precision_scaling_verification_records.test.mjs", [
      "tools/verification/catalog/records/precision_scaling.mjs", "tests/precision_scaling_verification_records.test.mjs",
      "docs/active/precision-scaling-implementation-20260920/results.md",
    ]],
  ];
  const records = routes.map(([id, domain, commandRef, sourceRefs], index) => ({
    id: "local:precision-scaling:" + id, commandRef, sourceRefs,
    ownerHints: [domain], domains: [domain], tiers: ["contract"], cost: "fast",
    resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"], platforms: ["all"],
    entrypointPolicyIndex: 5, verificationOrder: null, selectorOrder: start + index,
    verification: null, selector: {},
  }));
  records.push({
    ...records[0], id: "local:precision-scaling:native-browser",
    commandRef: "npx playwright test --config=playwright.config.cjs tests/e2e/dev/precision_scaling_packed.dev.spec.js --workers=1",
    sourceRefs: ["tests/e2e/dev/precision_scaling_packed.dev.spec.js", "tests/e2e/dev/support/precision_scaling_native_case.mjs"],
    ownerHints: ["renderer-runtime"], domains: ["renderer-runtime"], tiers: ["heavy"], cost: "heavy",
    resourceLocks: ["browser-dev-server", "playwright-browser", ".runtime-output"], executionOwners: ["main-thread"],
    profiles: ["full"], entrypointPolicyIndex: 0, selectorOrder: start + records.length,
  });
  // Latency follow-up targets append after all seven precision records, so
  // prior selectors, browser ownership and local-infrastructure budgets stay fixed.
  const latencyRoutes = [
    ["preview-layers", "node --test tests/latency_preview_and_layers_behavior.test.mjs", [
      "js/core/map_renderer.js", "js/core/renderer/political_patch_preview_budget.js",
      "js/core/renderer/context_layer_render_scheduler.js", "js/ui/toolbar/appearance_controls_controller.js",
      "tests/latency_preview_and_layers_behavior.test.mjs",
    ]],
    ["bulk-worker", "node --test tests/latency_bulk_worker_behavior.test.mjs", [
      "js/core/renderer/geometry_raster_runtime_owner.js", "tests/latency_bulk_worker_behavior.test.mjs",
    ]],
    ["refresh-scope", "node --test tests/latency_scoped_refresh_behavior.test.mjs", [
      "js/core/map_renderer/scenario_refresh_scope.js", "js/core/map_renderer/scenario_deferred_refresh_owner.js", "js/core/map_renderer/scenario_refresh_runtime.js",
      "js/core/scenario/scenario_renderer_bridge.js", "js/bootstrap/deferred_detail_promotion.js",
      "tests/latency_scoped_refresh_behavior.test.mjs",
    ]],
  ];
  for (const [id, commandRef, sourceRefs] of latencyRoutes) records.push({
    ...records[0], id: "local:latency-batches:" + id, commandRef, sourceRefs,
    ownerHints: ["renderer-runtime"], domains: ["renderer-runtime"], selectorOrder: start + records.length,
  });
  records.push({ ...records[6], id: "local:latency-batches:native-browser",
    commandRef: "npx playwright test --config=playwright.config.cjs tests/e2e/dev/latency_batches.dev.spec.js --workers=1",
    sourceRefs: ["tests/e2e/dev/latency_batches.dev.spec.js"], selectorOrder: start + records.length,
  });
  // New precision tools execute their focused regressions in PR checks as well.
  const expansionRoutes = [
    ["export-detail", "scenario-runtime", "node --test tests/precision_scaling_export_detail_behavior.test.mjs", [
      "js/core/scenario/chunk_runtime.js", "js/core/scenario_resources.js", "js/ui/toolbar.js",
      "tests/precision_scaling_export_detail_behavior.test.mjs",
    ]],
    ["project-migration", "scenario-runtime", "node --test tests/project_feature_migration_behavior.test.mjs", [
      "js/core/project_feature_migration.js", "js/core/sovereignty_manager.js",
      "js/core/interaction_funnel/import_apply_orchestration.js", "tests/project_feature_migration_behavior.test.mjs",
    ]],
    ["scenario-hierarchy", "scenario-runtime", "node --test tests/scenario_hierarchy_behavior.test.mjs", [
      "js/core/scenario_hierarchy.js", "js/core/quick_fill_hierarchy.js", "js/core/releasable_manager.js",
      "js/core/renderer/parent_border_grouping_policy.js", "js/ui/sidebar.js",
      "js/ui/toolbar/quick_fill_level_controls.js", "tests/scenario_hierarchy_behavior.test.mjs",
    ]],
    ...[
      ["precision_shard_lod", "tools/scenario_chunk_assets.py"],
      ["scenario_topology_decode", "tools/scenario_topology_decode.py", "tools/regional_scenario_assets.py", "tools/scenario_chunk_assets.py"],
      ["tno_east_europe_gaps", "tools/audit_tno_east_europe_gaps.py"],
      ["tno_major_country_precision", "tools/prepare_tno_major_country_precision.py"],
      ["us_county_source", "tools/prepare_us_county_source.py"],
      ["us_county_seams", "tools/prepare_us_county_seams.py"],
      ["us_county_scenario", "tools/stage_us_county_scenario.py"],
      ["us_county_lod", "tools/validate_us_county_lod.py", "tools/scenario_chunk_assets.py"],
      ["us_county_adaptation", "tools/adapt_us_county_scenarios.py", "tools/stage_us_county_scenario.py"],
      ["us_county_adaptation_sidecars", "tools/prepare_us_county_adaptation_sidecars.py"],
      ["us_county_adapted_bundle", "tools/stage_us_county_adapted_bundle.py"],
    ].map(([name, ...sources]) => [name, "geo-contract",
      ["precision_shard_lod", "tno_east_europe_gaps"].includes(name)
        ? `python -m pytest tests/test_${name}.py -q`
        : `python -m unittest tests.test_${name} -q`,
      [...sources, `tests/test_${name}.py`],
    ]),
  ];
  for (const [id, domain, commandRef, sourceRefs] of expansionRoutes) records.push({
    ...records[0], id: "local:precision-expansion:" + id, commandRef, sourceRefs,
    ownerHints: [domain], domains: [domain], selectorOrder: start + records.length,
  });
  return records;
}
