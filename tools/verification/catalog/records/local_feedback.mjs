// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
// Local feedback records follow the authored domain records. The three Python
// coverage records retain their heavy/main-thread policy.
export function createLocalFeedbackRecords(baseRecords) {
  // Local action feedback reuses the existing behavior suites. Historical policy
  // and phase receipts remain explicit deeper-tier checks, not edit prerequisites.
  const localActionTests = [
    "appearance_actions", "appearance_preset_actions", "appearance_reference_actions",
    "appearance_selection_actions", "appearance_visibility_actions", "export_workbench_actions",
    "intensity_field_actions", "special_zone_actions", "strategic_overlay_actions",
    "transport_actions", "ui_chrome_actions", "ui_dirty_actions", "ui_visibility_actions",
  ];

  const localActionOrder = Math.max(...baseRecords.map((record) => record.selectorOrder || 0)) + 1;

  const actionRecords = localActionTests.map((name, index) => ({
    id: "local:p4-action:" + name,
    commandRef: "node --test tests/" + name + "_behavior.test.mjs",
    sourceRefs: [
      "js/core/state/actions/" + name + ".js", "tests/" + name + "_behavior.test.mjs",
      ...(name === "special_zone_actions" ? ["js/core/special_zone_layers.js"] : []),
    ],
    ownerHints: ["state-ownership"], domains: ["state-ownership"], tiers: ["contract"],
    cost: "fast", resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"],
    platforms: ["all"], entrypointPolicyIndex: 5,
    verificationOrder: null, selectorOrder: localActionOrder + index,
    verification: null, selector: {},
  }));

  const borderRecords = ["border_mesh_owner", "border_draw_owner"].map((name, index) => ({
    id: "local:renderer:" + name,
    commandRef: "node --test tests/" + name + "_behavior.test.mjs",
    sourceRefs: ["js/core/renderer/" + name + ".js", "tests/" + name + "_behavior.test.mjs"],
    ownerHints: ["renderer-runtime"], domains: ["renderer-runtime"], tiers: ["contract"],
    cost: "fast", resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"],
    platforms: ["all"], entrypointPolicyIndex: 5,
    verificationOrder: null, selectorOrder: localActionOrder + localActionTests.length + index,
    verification: null, selector: {},
  }));

  // Sidebar model and controller changes execute their existing behavior coverage.
  const countryInspectorRecord = {
    id: "local:sidebar:country-inspector",
    commandRef: "node --test tests/country_inspector_model_behavior.test.mjs tests/country_inspector_controller_behavior.test.mjs",
    sourceRefs: ["js/ui/sidebar/country_inspector_model.js", "js/ui/sidebar/country_inspector_controller.js",
      "tests/country_inspector_model_behavior.test.mjs", "tests/country_inspector_controller_behavior.test.mjs"],
    ownerHints: ["sidebar-shell"], domains: ["sidebar-shell"], tiers: ["contract"],
    cost: "fast", resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"],
    platforms: ["all"], entrypointPolicyIndex: 5,
    verificationOrder: null, selectorOrder: localActionOrder + localActionTests.length + 2,
    verification: null, selector: {},
  };

  // Previously unregistered Python package entrypoints discovered independently.
  const pythonCoverageRoutes = [
    ["test:py:tno-water-repair-contracts", ["tests/test_tno_water_owners_consistency.py", "tests/test_tno_bundle_builder.py"]],
    ["test:py:hgo-runtime-seed", ["tests/test_hgo_runtime_seed_builder.py"]],
    ["test:py:hgo-runtime-assets-contract", ["tests/test_data_manifest_contract.py", "tests/test_data_catalog_contract.py"]],
  ];

  const pythonCoverageOrder = localActionOrder + actionRecords.length + borderRecords.length + 1;

  const pythonRecords = pythonCoverageRoutes.map(([commandRef, sourceRefs], index) => ({
    id: "python-package:" + commandRef, commandRef, sourceRefs,
    ownerHints: ["geo-contract"], domains: ["geo-contract"], tiers: ["heavy"],
    cost: "heavy", resourceLocks: ["heavy-geo", ".runtime-output"], executionOwners: ["main-thread"], profiles: ["full"],
    platforms: ["all"], entrypointPolicyIndex: 0,
    verificationOrder: null, selectorOrder: pythonCoverageOrder + index,
    verification: null, selector: {},
  }));

  // Each local leaf covers this owner only; broader roots and data retain their
  // existing PR/nightly/release requirements.
  const localOwnerCoverage = [
    ["city-label", "renderer-runtime", "js/core/renderer/city_label_owner.js", "tests/city_label_owner_behavior.test.mjs"],
    ["city-paint-style", "renderer-runtime", "js/core/renderer/city_paint_style_model.js", "tests/city_paint_style_model_behavior.test.mjs"],
    ["scenario-chunk-payload-loader", "scenario-runtime", "js/core/scenario/chunk_payload_loader.js", "tests/scenario_chunk_payload_loader_behavior.test.mjs"],
    ["scenario-chunk-layer-payloads", "scenario-runtime", "js/core/scenario/chunk_layer_payloads.js", "tests/scenario_chunk_layer_payloads_behavior.test.mjs"],
    ["scenario-optional-layer-runtime", "scenario-runtime", "js/core/scenario/optional_layer_runtime.js", "tests/scenario_optional_layers_behavior.test.mjs", ["js/core/scenario_resources.js"]],
    ["state-write-allowlist", "state-ownership", "tools/check_state_write_allowlist.mjs", "tests/state_write_allowlist_behavior.test.mjs"],
    ["viewport-read-model", "renderer-runtime", "js/core/renderer/viewport_read_model_owner.js", "tests/viewport_read_model_owner_behavior.test.mjs"],
    ["selection-overlay", "renderer-runtime", "js/core/renderer/selection_overlay_owner.js", "tests/selection_overlay_owner_behavior.test.mjs"],
    ["projected-geometry-bounds", "renderer-runtime", "js/core/renderer/projected_geometry_bounds_owner.js", "tests/projected_geometry_bounds_owner_behavior.test.mjs"],
    ["pixel-ratio-policy", "renderer-runtime", "js/core/renderer/pixel_ratio_policy.js", "tests/pixel_ratio_policy_behavior.test.mjs"],
    ["bathymetry-style-policy", "renderer-runtime", "js/core/renderer/bathymetry_style_policy.js", "tests/bathymetry_style_policy_behavior.test.mjs"],
    ["bathymetry-geometry", "renderer-runtime", "js/core/renderer/bathymetry_geometry.js", "tests/bathymetry_geometry_behavior.test.mjs"],
    ["projected-geographic-path-cache", "renderer-runtime", "js/core/renderer/projected_geographic_path_cache.js", "tests/projected_geographic_path_cache_behavior.test.mjs"],
    ["physical-contour-lod", "renderer-runtime", "js/core/renderer/physical_contour_lod_policy.js", "tests/physical_contour_lod_policy_behavior.test.mjs"],
    ["fill-target-policy", "renderer-runtime", "js/core/renderer/fill_target_policy.js", "tests/fill_target_policy_behavior.test.mjs"],
    ["visible-frame-identity-policy", "renderer-runtime", "js/core/renderer/visible_frame_identity_policy.js", "tests/visible_frame_identity_policy_behavior.test.mjs"],
    ["parent-border-grouping-policy", "renderer-runtime", "js/core/renderer/parent_border_grouping_policy.js", "tests/parent_border_grouping_policy_behavior.test.mjs"],
    ["render-pass-signature-policy", "renderer-runtime", "js/core/renderer/render_pass_signature_policy.js", "tests/render_pass_signature_policy_behavior.test.mjs", ["js/core/map_renderer.js"]],
    ["projected-bounds-diagnostics", "renderer-runtime", "js/core/renderer/projected_bounds_diagnostics_owner.js", "tests/projected_bounds_diagnostics_owner_behavior.test.mjs"],
    ["spatial-index-runtime", "renderer-runtime", "js/core/renderer/spatial_index_runtime_owner.js", "tests/spatial_index_runtime_owner_behavior.test.mjs", ["js/core/renderer/spatial_index_runtime_derivation.js"]],
    ["spatial-index-builders", "renderer-runtime", "js/core/renderer/spatial_index_runtime_builders.js", "tests/spatial_index_runtime_builders_behavior.test.mjs"],
    ["legend-control", "renderer-runtime", "js/core/renderer/legend_control_owner.js", "tests/legend_control_owner_behavior.test.mjs"],
    ["ocean-render", "renderer-runtime", "js/core/renderer/ocean_render_owner.js", "tests/ocean_render_owner_behavior.test.mjs"],
    ["viewport-update", "renderer-runtime", "js/core/renderer/renderer_viewport_update_owner.js", "tests/renderer_viewport_update_owner_behavior.test.mjs"],
    ["map-hover", "renderer-runtime", "js/core/map_renderer/map_hover_interaction_owner.js", "tests/map_hover_interaction_owner_behavior.test.mjs"],
    ["city-lights-render", "renderer-runtime", "js/core/renderer/city_lights_render_owner.js", "tests/city_lights_render_owner_behavior.test.mjs"],
    ["project-support-diagnostics", "sidebar-shell", "js/ui/sidebar/project_support_diagnostics_controller.js", "tests/project_support_diagnostics_controller_behavior.test.mjs"],
    ["commit-runner", "test-routing", "tools/run_commit_verification.mjs", "tests/verify_commit_runner_behavior.test.mjs"],
    ["unit-counter-catalog", "sidebar-shell", "js/ui/sidebar/strategic_overlay/unit_counter_catalog_helper.js", "tests/unit_counter_catalog_behavior.test.mjs"],
    ["workspace-chrome-support", "ui-shell", "js/ui/toolbar/workspace_chrome_support_surface_controller.js", "tests/workspace_chrome_support_surface_controller_behavior.test.mjs"],
    ["command-supersession-contracts", "test-routing", "tests/contracts/command_supersession_contracts.mjs", "tests/command_supersession_contracts.test.mjs"],
    ["state-action-source-contracts", "state-ownership", "tests/contracts/state_action_source_boundary_contracts.mjs", "tests/state_action_source_boundary_contracts.test.mjs"],
    ["worker-task-client", "renderer-runtime", "js/core/worker_task_client.js", "tests/worker_task_client_behavior.test.mjs"],
    ["regional-presets", "sidebar-shell", "js/ui/sidebar/regional_preset_controller.js", "tests/regional_preset_controller_behavior.test.mjs"],
    ["scenario-transfers", "sidebar-shell", "js/ui/sidebar/scenario_transfer_controller.js", "tests/scenario_transfer_controller_behavior.test.mjs"],
    ["scenario-territory", "sidebar-shell", "js/ui/sidebar/scenario_territory_controller.js", "tests/scenario_territory_controller_behavior.test.mjs"],
    ["scenario-inspector", "sidebar-shell", "js/ui/sidebar/scenario_inspector_controller.js", "tests/scenario_inspector_controller_behavior.test.mjs"],
    ["brush-interaction-session", "renderer-runtime", "js/core/renderer/brush_interaction_session_owner.js", "tests/brush_interaction_session_owner_behavior.test.mjs"],
    ["city-label-text", "renderer-runtime", "js/core/renderer/city_label_text_model.js", "tests/city_label_text_model_behavior.test.mjs"],
    ["operation-graphics-editor-render", "renderer-runtime", "js/core/renderer/operation_graphics_editor_render_owner.js", "tests/operation_graphics_editor_render_owner_behavior.test.mjs"],
    ["physical-intensity-interaction", "renderer-runtime", "js/core/renderer/physical_intensity_interaction_owner.js", "tests/physical_intensity_interaction_owner_behavior.test.mjs"],
    ["physical-intensity-preview", "renderer-runtime", "js/core/renderer/physical_intensity_preview_owner.js", "tests/physical_intensity_preview_owner_behavior.test.mjs"],
    ["political-feature-policy", "renderer-runtime", "js/core/renderer/political_feature_policy.js", "tests/political_feature_policy_behavior.test.mjs"],
    ["political-path-cache", "renderer-runtime", "js/core/renderer/political_path_cache_owner.js", "tests/political_path_cache_owner_behavior.test.mjs"],
    // Shared-cache changes run the actual region/relief/cache assembly suite.
    ["scenario-region-overlay-render", "renderer-runtime", "js/core/renderer/scenario_region_overlay_render_owner.js", "tests/scenario_region_overlay_render_owner_behavior.test.mjs", [
      "js/core/renderer/render_cache_owner.js", "js/core/renderer/scenario_relief_overlay_render_owner.js",
      "tests/scenario_relief_overlay_render_owner_behavior.test.mjs", "tests/render_cache_owner_invalidation_behavior.test.mjs",
      "docs/active/development-recovery-m4-20260908/plan.md",
      "docs/active/development-recovery-m4-20260908/context.md",
      "docs/active/development-recovery-m4-20260908/task.md",
    ]],
    ["static-border-mesh-lifecycle", "renderer-runtime", "js/core/renderer/static_border_mesh_lifecycle.js", "tests/static_border_mesh_lifecycle_behavior.test.mjs"],
    ["transient-overlay-render", "renderer-runtime", "js/core/renderer/transient_overlay_render_owner.js", "tests/transient_overlay_render_owner_behavior.test.mjs"],
    ["unit-counter-display", "renderer-runtime", "js/core/renderer/unit_counter_display_model.js", "tests/unit_counter_display_model_behavior.test.mjs"],
    ["urban-adaptive-paint", "renderer-runtime", "js/core/renderer/urban_adaptive_paint_model.js", "tests/urban_adaptive_paint_model_behavior.test.mjs"],
    ["visible-frame-diagnostics", "renderer-runtime", "js/core/renderer/visible_frame_diagnostics_owner.js", "tests/visible_frame_diagnostics_owner_behavior.test.mjs"],
  ];

  const localOwnerOrder = pythonCoverageOrder + pythonRecords.length;

  const ownerRecords = localOwnerCoverage.map(([id, domain, source, testFile, extraSources = []], index) => ({
    id: "local:owner:" + id, commandRef: "node --test " + testFile
      + (id === "regional-presets" ? " tests/scenario_core_plan_behavior.test.mjs" : "")
      + (id === "scenario-region-overlay-render" ? " tests/scenario_relief_overlay_render_owner_behavior.test.mjs tests/render_cache_owner_invalidation_behavior.test.mjs" : ""),
    sourceRefs: [source, testFile, ...extraSources, ...(id === "regional-presets" ? ["tests/scenario_core_plan_behavior.test.mjs"] : [])], ownerHints: [domain], domains: [domain], tiers: ["contract"],
    cost: "fast", resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"],
    platforms: ["all"], entrypointPolicyIndex: 5,
    verificationOrder: null, selectorOrder: localOwnerOrder + index,
    verification: null, selector: {},
  }));

  // These narrow regression suites do not claim whole loader/startup coverage.
  const localTestFiles = [
    ["scenario-water-fill", "renderer-runtime", "tests/scenario_water_fill_behavior.test.mjs"],
    ["scenario-water-signature", "renderer-runtime", "tests/scenario_water_signature_behavior.test.mjs"],
    ["retired-frontline", "renderer-runtime", "tests/retired_frontline_behavior.test.mjs"],
    ["scenario-chunk-cancellation", "scenario-runtime", "tests/scenario_chunk_cancellation_behavior.test.mjs", ["js/core/scenario/chunk_runtime.js", "js/core/scenario/chunk_payload_loader.js"]],
    ["scenario-deferred-infra-lifecycle", "scenario-runtime", "tests/scenario_deferred_infra_lifecycle_behavior.test.mjs", ["js/core/map_renderer/scenario_refresh_runtime.js"]],
    ["startup-boot-worker-cancellation", "scenario-runtime", "tests/startup_boot_worker_cancellation.test.mjs"],
    ["startup-cached-topology", "startup", "tests/startup_cached_topology_behavior.test.mjs", ["js/core/data_loader.js", "js/core/startup_worker_client.js", "js/workers/startup_boot.worker.js"]],
    ["startup-cache-metadata-gc", "startup", "tests/startup_cache_metadata_gc_behavior.test.mjs", ["js/core/startup_cache.js"]],
    ["scenario-cache-efficiency", "scenario-runtime", "tests/scenario_cache_efficiency_behavior.test.mjs", ["js/core/scenario/bundle_cache.js", "js/core/scenario/bundle_runtime.js", "js/core/scenario/rollback_clone.js", "js/core/scenario_rollback.js", "js/core/scenario/chunk_runtime.js", "js/core/scenario/chunk_payload_loader.js", "js/core/scenario_resources.js", "js/core/state/actions/scenario_chunk_runtime_actions.js"]],
    ["strategic-history-scope", "renderer-runtime", "tests/strategic_history_scope_behavior.test.mjs", ["js/core/history_manager.js", "js/core/renderer/strategic_overlay_runtime_owner.js"]],
    ["scenario-cache-byte-budget", "scenario-runtime", "tests/scenario_cache_byte_budget_behavior.test.mjs", ["js/core/scenario/bundle_cache.js", "js/core/scenario/bundle_cache_policy.js", "js/core/scenario/chunk_payload_loader.js"]],
    ["scenario-core-value-normalizer", "scenario-runtime", "tests/scenario_core_value_normalizer_behavior.test.mjs", ["js/core/scenario/shared.js", "js/core/scenario/core_value_normalizer.js"]],
    ["legend-actions", "renderer-runtime", "tests/legend_actions_behavior.test.mjs", ["js/core/state/actions/legend_actions.js", "js/core/legend_state_normalizers.js"]],
    ["legend-color-revision", "renderer-runtime", "tests/legend_color_revision_behavior.test.mjs", ["js/core/legend_manager.js", "js/core/legend_state_normalizers.js", "js/core/map_renderer.js"]],
    ["render-dispatcher", "startup", "tests/render_dispatcher_behavior.test.mjs", ["js/bootstrap/startup_bootstrap_support.js", "js/core/render_boundary.js", "js/bootstrap/render_runtime_binding.js"]],
    ["exact-composite-reuse", "renderer-runtime", "tests/exact_composite_reuse_behavior.test.mjs", ["js/core/renderer/exact_composite_reuse_owner.js", "js/core/map_renderer.js", "js/core/renderer/cached_pass_compositor_owner.js"]],
  ];
  const testRecords = localTestFiles.map(([id, domain, testFile, extraSources = []], index) => ({
    id: "local:test:" + id, commandRef: "node --test " + testFile,
    sourceRefs: [testFile, ...extraSources],
    ownerHints: [domain], domains: [domain], tiers: ["contract"],
    cost: "fast", resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"],
    platforms: ["all"], entrypointPolicyIndex: 5,
    verificationOrder: null, selectorOrder: localOwnerOrder + localOwnerCoverage.length + index,
    verification: null, selector: {},
  }));

  const editorCheckoutRecord = {
    id: "local:editor-checkout-profile",
    commandRef: "python -m unittest tests.test_editor_checkout_profile -q",
    sourceRefs: ["README.md", "tools/editor_checkout_profile.py", "tests/test_editor_checkout_profile.py"],
    ownerHints: ["test-infra"], domains: ["data-governance"], tiers: ["contract"],
    cost: "fast", resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"],
    platforms: ["all"], entrypointPolicyIndex: 5,
    verificationOrder: null,
    selectorOrder: localOwnerOrder + localOwnerCoverage.length + localTestFiles.length,
    verification: null, selector: {},
  };

  const historyColorRecord = {
    ...editorCheckoutRecord,
    id: "local:history-feature-color-refresh",
    commandRef: "node --test tests/history_feature_color_refresh_behavior.test.mjs",
    sourceRefs: ["tests/history_feature_color_refresh_behavior.test.mjs", "js/core/history_manager.js", "js/core/map_renderer.js"],
    ownerHints: ["renderer-runtime"], domains: ["renderer-runtime"],
    selectorOrder: editorCheckoutRecord.selectorOrder + 1,
  };
  const runtimeInputRecord = {
    ...editorCheckoutRecord,
    id: "e2e:runtime-input-latency",
    commandRef: "node node_modules/@playwright/test/cli.js test tests/e2e/dev/scenario_runtime_input_latency.dev.spec.js --workers=1 --retries=0",
    sourceRefs: ["tests/e2e/dev/scenario_runtime_input_latency.dev.spec.js", "tests/e2e/support/input-evidence.js"],
    ownerHints: ["scenario-runtime"], domains: ["scenario-runtime"], tiers: ["heavy"],
    cost: "heavy", resourceLocks: ["browser-dev-server", "playwright-browser", ".runtime-output"],
    executionOwners: ["main-thread"], profiles: ["full"], entrypointPolicyIndex: 0,
    selectorOrder: editorCheckoutRecord.selectorOrder + 2,
  };
  const inputEvidenceRecord = {
    ...editorCheckoutRecord,
    id: "local:input-evidence",
    commandRef: "node --test tests/input_evidence_behavior.test.mjs",
    sourceRefs: ["tests/input_evidence_behavior.test.mjs", "tests/e2e/support/input-evidence.js",
      "tests/e2e/dev/scenario_runtime_input_latency.dev.spec.js"],
    ownerHints: ["scenario-runtime"], domains: ["scenario-runtime"],
    selectorOrder: editorCheckoutRecord.selectorOrder + 3,
  };

  const startupLifecycleRecord = {
    ...editorCheckoutRecord,
    id: "node:test:node:startup-lifecycle",
    commandRef: "test:node:startup-lifecycle",
    sourceRefs: ["tests/startup_ready_handoff_behavior.test.mjs", "tests/startup_data_pipeline_lifecycle_behavior.test.mjs",
      "tests/startup_interaction_lifecycle_behavior.test.mjs", "js/bootstrap/startup_ready_handoff.js",
      "js/bootstrap/startup_data_pipeline.js", "js/bootstrap/post_ready_scheduler.js", "js/main.js",
      "js/core/state/actions/content_load_actions.js",
      "js/core/map_renderer.js", "js/core/renderer/spatial_index_runtime_owner.js"],
    ownerHints: ["startup"], domains: ["startup"],
    selectorOrder: editorCheckoutRecord.selectorOrder + 4,
  };
  const projectImportLifecycleRecord = {
    ...editorCheckoutRecord,
    id: "node:test:node:project-import-lifecycle",
    commandRef: "test:node:project-import-lifecycle",
    sourceRefs: ["tests/project_import_completion_behavior.test.mjs", "tests/project_package_stream_import_behavior.test.mjs",
      "tests/scenario_import_trust_projection_behavior.test.mjs", "tests/scenario_project_import_recovery_behavior.test.mjs",
      "js/core/interaction_funnel/import_apply_orchestration.js", "js/core/scenario_manager.js",
      "js/core/interaction_funnel/import_trust_projection.js",
      "js/core/interaction_funnel/import_completion.js", "js/core/interaction_funnel.js", "js/core/project_package_io.js",
      "js/core/file_manager.js"],
    ownerHints: ["scenario-runtime"], domains: ["scenario-runtime"],
    selectorOrder: editorCheckoutRecord.selectorOrder + 5,
  };
  const projectImportRecoveryRecord = {
    ...runtimeInputRecord,
    id: "e2e:project-import-recovery-round2",
    commandRef: "node node_modules/@playwright/test/cli.js test tests/e2e/dev/project_import_recovery_round2.dev.spec.js --workers=1 --retries=0",
    sourceRefs: ["tests/e2e/dev/project_import_recovery_round2.dev.spec.js", "js/core/interaction_funnel/import_completion.js",
      "js/core/interaction_funnel/import_apply_orchestration.js", "js/core/scenario_manager.js",
      "js/core/interaction_funnel/import_trust_projection.js",
      "js/core/interaction_funnel.js", "js/core/project_package_io.js", "js/core/file_manager.js"],
    selectorOrder: editorCheckoutRecord.selectorOrder + 6,
  };

  return [...actionRecords, ...borderRecords, countryInspectorRecord,
    ...pythonRecords, ...ownerRecords, ...testRecords, editorCheckoutRecord,
    historyColorRecord, runtimeInputRecord, inputEvidenceRecord,
    startupLifecycleRecord, projectImportLifecycleRecord, projectImportRecoveryRecord];
}
