import { VERIFICATION_CATALOG_SOURCE_FILES } from "../source_files.mjs";

// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
const P4_4_SOURCE_REFS = Object.freeze([
  "js/core/dirty_state.js",
  "js/core/file_manager.js",
  "js/core/history_manager.js",
  "js/core/renderer/strategic_overlay_render_owner.js",
  "js/core/renderer/strategic_overlay_runtime_owner.js",
  "js/core/renderer/strategic_overlay_runtime/operation_graphics_runtime_domain.js",
  "js/core/renderer/strategic_overlay_runtime/special_zones_runtime_domain.js",
  "js/core/renderer/strategic_overlay_runtime/unit_counter_runtime_domain.js",
  "js/core/scenario_resources.js",
  "js/core/special_zone_layers.js",
  "js/core/state/actions/appearance_actions.js",
  "js/core/state/actions/project_import_actions.js",
  "js/core/state/actions/appearance_preset_actions.js",
  "js/core/state/actions/appearance_reference_actions.js",
  "js/core/state/actions/appearance_selection_actions.js",
  "js/core/state/actions/palette_library_actions.js",
  "js/core/state/actions/appearance_visibility_actions.js",
  "js/core/state/actions/export_workbench_actions.js",
  "js/core/state/actions/intensity_field_actions.js",
  "js/core/state/actions/special_zone_actions.js",
  "js/core/state/actions/strategic_overlay_actions.js",
  "js/core/state/actions/transport_actions.js",
  "js/core/state/actions/ui_chrome_actions.js",
  "js/core/state/actions/ui_dirty_actions.js",
  "js/core/state/actions/ui_visibility_actions.js",
  "js/core/state/appearance_preset_state.js",
  "js/core/state/config.js",
  "js/core/state/index.js",
  "js/core/state/ui_state.js",
  "js/ui/shortcuts.js",
  "js/ui/sidebar/strategic_overlay_controller.js",
  "js/ui/sidebar/strategic_overlay/unit_counter_bind_events_helper.js",
  "js/ui/sidebar/strategic_overlay/unit_counter_catalog_helper.js",
  "js/ui/sidebar/strategic_overlay/unit_counter_modal_helper.js",
  "js/ui/toolbar/appearance_border_owner.js",
  "js/ui/toolbar/appearance_city_points_owner.js",
  "js/ui/toolbar/appearance_controls_controller.js",
  "js/ui/toolbar/appearance_parent_border_owner.js",
  "js/ui/toolbar/appearance_physical_owner.js",
  "js/ui/toolbar/appearance_presets_owner.js",
  "js/ui/toolbar/appearance_reference_owner.js",
  "js/ui/toolbar/appearance_rivers_owner.js",
  "js/ui/toolbar/appearance_texture_owner.js",
  "js/ui/toolbar/export_workbench_controller.js",
  "js/ui/toolbar/intensity_field_editor_section.js",
  "js/ui/toolbar/palette_library_panel.js",
  "js/ui/toolbar/scenario_context_bar_controller.js",
  "js/ui/toolbar/special_zone_editor.js",
  "js/ui/toolbar/special_zones_workbench_controller.js",
  "js/ui/toolbar/transport_appearance_controller.js",
  "js/ui/toolbar/transport_workbench_apply_bridge_owner.js",
  "js/ui/toolbar/transport_workbench_state_owner.js",
  "js/ui/toolbar/workspace_chrome_support_surface_controller.js",
  "tests/appearance_actions_behavior.test.mjs",
  "tests/appearance_preset_actions_behavior.test.mjs",
  "tests/appearance_preset_history.node.test.mjs",
  "tests/appearance_preset_state.node.test.mjs",
  "tests/appearance_reference_actions_behavior.test.mjs",
  "tests/appearance_selection_actions_behavior.test.mjs",
  "tests/appearance_state_action_callers_behavior.test.mjs",
  "tests/appearance_visibility_actions_behavior.test.mjs",
  "tests/export_workbench_actions_behavior.test.mjs",
  "tests/intensity_field_actions_behavior.test.mjs",
  "tests/p4_nightly_exact_repair_behavior.test.mjs",
  "tests/p4_nightly_parallel_authorities_behavior.test.mjs",
  "tests/special_zone_actions_behavior.test.mjs",
  "tests/special_zones_workbench_controller_behavior.test.mjs",
  "tests/strategic_overlay_actions_behavior.test.mjs",
  "tests/strategic_overlay_runtime_owner_behavior.test.mjs",
  "tests/transport_actions_behavior.test.mjs",
  "tests/transport_workbench_state_owner_behavior.test.mjs",
  "tests/ui_chrome_actions_behavior.test.mjs",
  "tests/ui_dirty_actions_behavior.test.mjs",
  "tests/ui_state_action_callers_behavior.test.mjs",
  "tests/ui_visibility_actions_behavior.test.mjs",
]);

const P4_4_NODE_ROUTE_SOURCE_REFS = Object.freeze([
  "tests/p4_phase_verification_runner_behavior.test.mjs",
  "tests/state_action_delegation_edges_behavior.test.mjs",
  "tests/state_writer_policy_batch_scan_behavior.test.mjs",
  "tests/appearance_actions_behavior.test.mjs",
  "tests/appearance_preset_actions_behavior.test.mjs",
  "tests/appearance_preset_history.node.test.mjs",
  "tests/appearance_preset_state.node.test.mjs",
  "tests/appearance_reference_actions_behavior.test.mjs",
  "tests/appearance_selection_actions_behavior.test.mjs",
  "tests/appearance_state_action_callers_behavior.test.mjs",
  "tests/appearance_visibility_actions_behavior.test.mjs",
  "tests/intensity_field_actions_behavior.test.mjs",
  "tests/export_workbench_actions_behavior.test.mjs",
  "tests/transport_actions_behavior.test.mjs",
  "tests/transport_workbench_state_owner_behavior.test.mjs",
  "tests/ui_chrome_actions_behavior.test.mjs",
  "tests/ui_dirty_actions_behavior.test.mjs",
  "tests/ui_visibility_actions_behavior.test.mjs",
  "tests/ui_state_action_callers_behavior.test.mjs",
  "tests/strategic_overlay_actions_behavior.test.mjs",
  "tests/special_zone_actions_behavior.test.mjs",
  "tests/special_zones_workbench_controller_behavior.test.mjs",
  "tests/strategic_overlay_runtime_owner_behavior.test.mjs",
  "tools/run_p4_phase_verification.mjs",
  "tools/build_state_writer_policy.mjs",
  "tools/state_action_delegation_contract.mjs",
  "tools/state_borrowed_effect_contract.mjs",
  "tools/state_writer_inventory.mjs",
  "js/core/map_renderer/exact_after_settle_scheduler.js",
  "js/core/state/actions/appearance_actions.js",
  "js/core/state.js",
  "js/core/state/actions/appearance_preset_actions.js",
  "js/core/history_manager.js",
  "js/core/special_zone_layers.js",
  "js/core/state/ui_state.js",
  "js/core/state/actions/appearance_reference_actions.js",
  "js/core/state/actions/appearance_selection_actions.js",
  "js/core/state/actions/appearance_visibility_actions.js",
  "js/core/intensity_field.js",
  "js/core/state/actions/intensity_field_actions.js",
  "js/core/state/actions/export_workbench_actions.js",
  "js/core/state/actions/transport_actions.js",
  "js/core/transport_pack_resolver.js",
  "js/ui/toolbar/transport_workbench_state_owner.js",
  "js/core/state/actions/ui_chrome_actions.js",
  "js/core/state/actions/ui_dirty_actions.js",
  "js/core/state/actions/ui_visibility_actions.js",
  "js/core/state/actions/strategic_overlay_actions.js",
  "tools/state_writer_policy.mjs",
  "js/core/state/actions/special_zone_actions.js",
  "js/core/state/index.js",
  "js/ui/toolbar/special_zones_workbench_controller.js",
  "js/core/renderer/strategic_overlay_runtime_owner.js",
]);

export const STATE_OWNERSHIP_RECORDS = [
  {
    id: "state:project-import-transaction",
    commandRef: "node --test tests/project_import_transaction_behavior.test.mjs",
    sourceRefs: [
      "js/core/state/actions/project_import_actions.js", "js/core/interaction_funnel.js",
      "js/core/interaction_funnel/import_apply_orchestration.js", "tests/project_import_transaction_behavior.test.mjs",
    ],
    ownerHints: ["state-ownership"], domains: ["state-ownership"], tiers: ["contract"],
    cost: "fast", resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"],
    platforms: ["all"], entrypointPolicyIndex: 4, verificationOrder: null, selectorOrder: 402,
    verification: null, selector: {},
  },
  {
    "id": "node:test:node:p4:p4-1",
    "commandRef": "test:node:p4:p4-1",
    "sourceRefs": [
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/boot_actions_behavior.test.mjs",
      "tests/startup_boot_overlay_behavior.test.mjs",
      "tests/startup_bootstrap_support_behavior.test.mjs",
      "tests/post_ready_scheduler_behavior.test.mjs",
      "tests/ui_shell_boot_behavior.test.mjs",
      "tests/startup_hydration_behavior.test.mjs",
      "tests/sample_project_contracts.test.mjs",
      "tests/state_writer_scanner_soundness_behavior.test.mjs",
      "tests/state_writer_callable_result_behavior.test.mjs",
      "tools/run_p4_phase_verification.mjs",
      "js/core/state/actions/boot_actions.js",
      "js/core/state/boot_state.js",
      "js/bootstrap/startup_boot_overlay.js",
      "js/core/state.js",
      "js/bootstrap/startup_bootstrap_support.js",
      "js/core/state/actions/renderer_diagnostics_actions.js",
      "js/bootstrap/post_ready_scheduler.js",
      "js/bootstrap/ui_shell_boot.js",
      "js/core/scenario/startup_hydration.js",
      "js/core/startup_cache.js",
      "js/bootstrap/startup_sample_project_deeplink.js",
      "js/core/file_manager.js",
      "js/core/sample_export_recommendation.js",
      "js/core/sample_project_import_workflow.js",
      "js/core/sample_project_registry.js",
      "js/core/state/index.js",
      "js/ui/toolbar/export_workbench_controller.js",
      "js/ui/toolbar/sample_project_banner_controller.js",
      "js/ui/ui_surface_url_state.js",
      "tools/build_state_writer_policy.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": [
      "child-safe"
    ],
    "profiles": [
      "pr-fast"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 205,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:p4:p4-2a",
    "commandRef": "test:node:p4:p4-2a",
    "sourceRefs": [
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
      "tests/scenario_apply_transaction_ownership.test.mjs",
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
      "tests/scenario_runtime_state_behavior.test.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/build_state_writer_policy.mjs",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "js/core/map_renderer/exact_after_settle_scheduler.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_apply_request_actions.js",
      "js/core/state/actions/scenario_palette_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/actions/scenario_readiness_actions.js",
      "js/core/scenario/shared.js",
      "js/core/state/actions/scenario_chunk_promotion_actions.js",
      "js/core/state/actions/scenario_chunk_runtime_actions.js",
      "js/core/state/actions/scenario_health_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "js/core/palette_manager.js",
      "js/core/political_raster_worker_client.js",
      "js/core/scenario/lifecycle_runtime.js",
      "js/core/scenario/presentation_ocean_fill_restore.js",
      "js/core/scenario_shell_overlay.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario_data_health.js",
      "js/core/scenario_manager.js",
      "js/core/scenario_post_apply_effects.js",
      "js/core/scenario_resources.js",
      "js/core/scenario_rollback.js",
      "js/core/state.js",
      "js/core/state/index.js",
      "js/core/state/scenario_runtime_state.js",
      "js/core/scenario/chunk_runtime.js"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": [
      "child-safe"
    ],
    "profiles": [
      "pr-fast"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 207,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:p4:p4-2b",
    "commandRef": "test:node:p4:p4-2b",
    "sourceRefs": [
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/scenario_chunk_state_actions_behavior.test.mjs",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/helpers/scenario_chunk_contract_support.mjs",
      "tests/scenario_chunk_promotion_helpers_behavior.test.mjs",
      "tests/scenario_refresh_plans_behavior.test.mjs",
      "tests/scenario_runtime_state_behavior.test.mjs",
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/build_state_writer_policy.mjs",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "js/core/map_renderer/exact_after_settle_scheduler.js",
      "js/core/state/scenario_runtime_state.js",
      "js/core/feature_identity.js",
      "js/core/frame_scheduler.js",
      "js/core/political_raster_worker_client.js",
      "js/core/renderer/color_resolution_strategy.js",
      "js/core/renderer/render_cache_owner.js",
      "js/core/renderer/spatial_index_runtime_builders.js",
      "js/core/scenario/bundle_loader.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/scenario_chunk_manager.js",
      "js/core/scenario_runtime_queries.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_apply_request_actions.js",
      "js/core/state/actions/scenario_chunk_promotion_actions.js",
      "js/core/state/actions/scenario_chunk_runtime_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/renderer/scenario_chunk_promotion_helpers.js",
      "js/core/map_renderer/scenario_refresh_plans.js",
      "js/core/map_renderer/scenario_refresh_runtime.js",
      "js/core/renderer/context_layer_resolver.js",
      "js/core/state/actions/scenario_palette_actions.js",
      "js/core/state/actions/scenario_readiness_actions.js",
      "js/core/scenario/shared.js",
      "js/core/state/actions/scenario_health_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "js/core/palette_manager.js",
      "js/core/scenario/lifecycle_runtime.js",
      "js/core/scenario/presentation_ocean_fill_restore.js",
      "js/core/scenario_shell_overlay.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario_data_health.js",
      "js/core/scenario_manager.js",
      "js/core/scenario_post_apply_effects.js",
      "js/core/scenario_resources.js",
      "js/core/scenario_rollback.js",
      "js/core/state.js",
      "js/core/state/index.js"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": [
      "child-safe"
    ],
    "profiles": [
      "pr-fast"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 208,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:p4:p4-2c",
    "commandRef": "test:node:p4:p4-2c",
    "sourceRefs": [
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/scenario_health_actions_behavior.test.mjs",
      "tests/startup_hydration_behavior.test.mjs",
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
      "tests/scenario_runtime_state_behavior.test.mjs",
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/build_state_writer_policy.mjs",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "js/core/map_renderer/exact_after_settle_scheduler.js",
      "js/core/scenario/presentation_display_restore.js",
      "js/core/state/actions/scenario_health_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/index.js",
      "js/core/state/scenario_runtime_state.js",
      "js/core/scenario/startup_hydration.js",
      "js/core/startup_cache.js",
      "js/core/palette_manager.js",
      "js/core/political_raster_worker_client.js",
      "js/core/scenario/lifecycle_runtime.js",
      "js/core/scenario/presentation_ocean_fill_restore.js",
      "js/core/scenario_shell_overlay.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario_data_health.js",
      "js/core/scenario_manager.js",
      "js/core/scenario_post_apply_effects.js",
      "js/core/scenario_resources.js",
      "js/core/scenario_rollback.js",
      "js/core/state.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_apply_request_actions.js",
      "js/core/state/actions/scenario_palette_actions.js",
      "js/core/state/actions/scenario_readiness_actions.js",
      "js/core/scenario/shared.js",
      "js/core/state/actions/scenario_chunk_promotion_actions.js",
      "js/core/state/actions/scenario_chunk_runtime_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": [
      "child-safe"
    ],
    "profiles": [
      "pr-fast"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 209,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:p4:p4-3",
    "commandRef": "test:node:p4:p4-3",
    "sourceRefs": [
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/renderer_phase_actions_behavior.test.mjs",
      "tests/renderer_interaction_actions_behavior.test.mjs",
      "tests/renderer_exact_refresh_actions_behavior.test.mjs",
      "tests/render_pass_cache_state_normalizer_behavior.test.mjs",
      "tests/renderer_cache_actions_behavior.test.mjs",
      "tests/renderer_diagnostics_actions_behavior.test.mjs",
      "tests/render_perf_metrics_runtime_owner_behavior.test.mjs",
      "tests/exact_after_settle_scheduler_state_actions_behavior.test.mjs",
      "tests/renderer_render_phase_lifecycle_inventory.test.mjs",
      "tests/renderer_render_phase_lifecycle_owner_behavior.test.mjs",
      "tests/zoom_interaction_lifecycle_owner_behavior.test.mjs",
      "tests/renderer_runtime_state_behavior.test.mjs",
      "tests/physical_layer_contracts.test.mjs",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/helpers/scenario_chunk_contract_support.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/build_state_writer_policy.mjs",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "js/core/map_renderer/exact_after_settle_scheduler.js",
      "js/core/renderer/render_pass_cache_state_normalizer.js",
      "js/core/state/actions/renderer_cache_actions.js",
      "js/core/state/renderer_runtime_state.js",
      "js/core/renderer/render_perf_metrics_runtime_owner.js",
      "js/core/state/actions/renderer_diagnostics_actions.js",
      "js/core/map_renderer/render_phase_lifecycle_owner.js",
      "js/core/renderer/zoom_interaction_lifecycle_owner.js",
      "js/core/renderer/spatial_index_runtime_builders.js",
      "js/core/renderer/spatial_index_runtime_derivation.js",
      "js/core/renderer/spatial_index_runtime_state_ops.js",
      "js/core/state/actions/renderer_exact_refresh_actions.js",
      "js/core/state/border_cache_state.js",
      "js/core/state/spatial_index_state.js",
      "js/core/state/ui_state.js",
      "js/core/transport_capability_registry.js",
      "js/core/feature_identity.js",
      "js/core/frame_scheduler.js",
      "js/core/political_raster_worker_client.js",
      "js/core/renderer/color_resolution_strategy.js",
      "js/core/renderer/render_cache_owner.js",
      "js/core/scenario/bundle_loader.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/scenario_chunk_manager.js",
      "js/core/scenario_runtime_queries.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_apply_request_actions.js",
      "js/core/state/actions/scenario_chunk_promotion_actions.js",
      "js/core/state/actions/scenario_chunk_runtime_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": [
      "child-safe"
    ],
    "profiles": [
      "pr-fast"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 210,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:p4:state-writer-policy",
    "commandRef": "test:node:p4:state-writer-policy",
    "sourceRefs": [
      "tools/run_p4_state_writer_policy_tests.mjs",
      "tools/process_containment/windows_job_runtime.mjs",
      "tools/verification/p4_state_writer_policy_test_lifecycle.mjs"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 202,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:p4:state-writer-policy:quick",
    "commandRef": "test:node:p4:state-writer-policy:quick",
    "sourceRefs": [
      "tools/run_p4_state_writer_policy_tests.mjs",
      "tools/process_containment/windows_job_runtime.mjs",
      "tools/verification/p4_state_writer_policy_test_lifecycle.mjs"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": [
      "child-safe"
    ],
    "profiles": [
      "pr-fast"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 4,
    "verificationOrder": null,
    "selectorOrder": 203,
    "verification": null,
    "selector": {}
  },
  {
    "id": "p4:p4-1-exact-phase",
    "commandRef": "verify:p4:p4-1",
    "sourceRefs": [
      "js/core/state/actions/boot_actions.js",
      "js/core/state/boot_state.js",
      "js/core/state/content_state.js",
      "js/main.js",
      "js/bootstrap/post_ready_scheduler.js",
      "js/bootstrap/startup_boot_overlay.js",
      "js/bootstrap/startup_bootstrap_support.js",
      "js/bootstrap/ui_shell_boot.js",
      "js/bootstrap/ui_shell_debug_seed.js",
      "js/core/sample_project_import_workflow.js",
      "js/core/scenario/bundle_runtime.js",
      "js/core/scenario/startup_hydration.js",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "tools/state_writer_policy.mjs",
      "tools/state_writer_policy.json",
      "tools/eslint-rules/state-writer-allowlist.json",
      "tools/build_state_writer_policy.mjs",
      "tools/check_state_writer_policy.mjs",
      "tools/check_p4_state_action_routes.mjs",
      "tools/select_verification_targets.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/verification/p4_state_writer_historical_proof_worker.mjs",
      "tests/state_writer_policy_behavior.test.mjs",
      "tests/state_writer_scanner_soundness_behavior.test.mjs",
      "tests/state_writer_policy_manifest_behavior.test.mjs",
      "tests/p4_state_action_routes_behavior.test.mjs",
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/boot_actions_behavior.test.mjs",
      "tests/test_boot_state_actions_boundary_contract.py",
      "tests/test_state_split_boundary_contract.py",
      "tests/test_state_write_guardrail_contract.py",
      "docs/active/state-action-ownership-p4-20260719",
      "docs/active/_worktree_registry.md",
      "tools/verification/verification_domains.mjs",
      "tools/ai_test_supervisor/domain_registry.json",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 17,
    "selectorOrder": 15,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p4:p4-2a-exact-phase",
    "commandRef": "verify:p4:p4-2a",
    "sourceRefs": [
      "js/core/state/actions/scenario_readiness_actions.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/actions/scenario_apply_request_actions.js",
      "js/core/state/actions/scenario_palette_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario_manager.js",
      "js/core/palette_manager.js",
      "js/core/scenario_resources.js",
      "js/core/scenario_rollback.js",
      "js/core/scenario_post_apply_effects.js",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "tools/state_writer_policy.mjs",
      "tools/state_writer_policy.json",
      "tools/build_state_writer_policy.mjs",
      "tools/check_state_writer_policy.mjs",
      "tools/check_p4_state_action_routes.mjs",
      "tools/select_verification_targets.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/run_p4_state_writer_policy_tests.mjs",
      "tools/verification/p4_state_writer_policy_test_lifecycle.mjs",
      "tools/verification/p4_state_writer_historical_proof_worker.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/state_writer_policy_behavior.test.mjs",
      "tests/state_writer_policy_manifest_behavior.test.mjs",
      "tests/state_writer_scanner_soundness_behavior.test.mjs",
      "tests/state_writer_policy_soundness_behavior.test.mjs",
      "tests/p4_state_writer_runner_reachability_behavior.test.mjs",
      "tests/p4_state_writer_streaming_runner_behavior.test.mjs",
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
      "tests/scenario_apply_transaction_ownership.test.mjs",
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
      "tests/scenario_runtime_state_behavior.test.mjs",
      "tests/test_scenario_state_actions_boundary_contract.py",
      "tests/test_scenario_manager_boundary_contract.py",
      "tests/test_scenario_resources_boundary_contract.py",
      "tests/test_scenario_rollback_boundary_contract.py",
      "tests/test_scenario_lifecycle_runtime_boundary_contract.py",
      "tests/test_state_write_guardrail_contract.py",
      "tests/verification_metadata_behavior.test.mjs",
      "docs/active/state-action-ownership-p4-20260719",
      "docs/active/appearance-transport-platformization-milestones-20260812",
      "docs/active/_worktree_registry.md",
      "tools/verification/verification_domains.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 20,
    "selectorOrder": 18,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p4:p4-2b-exact-phase",
    "commandRef": "verify:p4:p4-2b",
    "sourceRefs": [
      "js/core/state/actions/scenario_chunk_runtime_actions.js",
      "js/core/state/actions/scenario_chunk_promotion_actions.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/state/scenario_runtime_state.js",
      "js/bootstrap/deferred_detail_promotion.js",
      "js/bootstrap/startup_ready_handoff.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario/lifecycle_runtime.js",
      "js/core/map_renderer/scenario_refresh_runtime.js",
      "js/core/state/content_state.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "js/core/scenario_localization_state.js",
      "js/core/scenario/bundle_loader.js",
      "js/core/scenario_resources.js",
      "js/core/scenario_rollback.js",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "tools/state_writer_policy.mjs",
      "tools/state_writer_policy.json",
      "tools/build_state_writer_policy.mjs",
      "tools/check_state_writer_policy.mjs",
      "tools/check_p4_state_action_routes.mjs",
      "tools/select_verification_targets.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/run_p4_state_writer_policy_tests.mjs",
      "tools/verification/p4_state_writer_policy_test_lifecycle.mjs",
      "tools/verification/p4_state_writer_historical_proof_worker.mjs",
      "tests/scenario_chunk_state_actions_behavior.test.mjs",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/scenario_chunk_promotion_helpers_behavior.test.mjs",
      "tests/scenario_refresh_plans_behavior.test.mjs",
      "tests/scenario_runtime_state_behavior.test.mjs",
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/state_writer_policy_behavior.test.mjs",
      "tests/state_writer_policy_manifest_behavior.test.mjs",
      "tests/state_writer_scanner_soundness_behavior.test.mjs",
      "tests/state_writer_policy_soundness_behavior.test.mjs",
      "tests/p4_state_action_routes_behavior.test.mjs",
      "tests/p4_state_writer_runner_reachability_behavior.test.mjs",
      "tests/p4_state_writer_streaming_runner_behavior.test.mjs",
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/test_scenario_chunk_state_actions_boundary_contract.py",
      "tests/test_scenario_chunk_refresh_contracts.py",
      "tests/test_main_deferred_detail_promotion_boundary_contract.py",
      "tests/test_scenario_manager_boundary_contract.py",
      "tests/test_scenario_rollback_boundary_contract.py",
      "tests/test_scenario_state_actions_boundary_contract.py",
      "tests/test_state_write_guardrail_contract.py",
      "tests/verification_metadata_behavior.test.mjs",
      "docs/active/state-action-ownership-p4-20260719",
      "docs/active/_worktree_registry.md",
      "tools/verification/verification_domains.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 23,
    "selectorOrder": 21,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p4:p4-2c-exact-phase",
    "commandRef": "verify:p4:p4-2c",
    "sourceRefs": [
      "js/core/state/actions/scenario_health_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "js/core/state/scenario_runtime_state.js",
      "js/core/scenario/startup_hydration.js",
      "js/core/scenario_data_health.js",
      "js/core/scenario/presentation_display_restore.js",
      "js/core/scenario/lifecycle_runtime.js",
      "js/core/scenario_rollback.js",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "tools/state_writer_policy.mjs",
      "tools/state_writer_policy.json",
      "tools/build_state_writer_policy.mjs",
      "tools/check_state_writer_policy.mjs",
      "tools/check_p4_state_action_routes.mjs",
      "tools/select_verification_targets.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/run_p4_state_writer_policy_tests.mjs",
      "tools/verification/p4_state_writer_policy_test_lifecycle.mjs",
      "tools/verification/p4_state_writer_historical_proof_worker.mjs",
      "tests/scenario_health_actions_behavior.test.mjs",
      "tests/startup_hydration_behavior.test.mjs",
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
      "tests/scenario_runtime_state_behavior.test.mjs",
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/state_writer_policy_behavior.test.mjs",
      "tests/state_writer_policy_manifest_behavior.test.mjs",
      "tests/state_writer_scanner_soundness_behavior.test.mjs",
      "tests/state_writer_policy_soundness_behavior.test.mjs",
      "tests/p4_state_action_routes_behavior.test.mjs",
      "tests/p4_state_writer_runner_reachability_behavior.test.mjs",
      "tests/p4_state_writer_streaming_runner_behavior.test.mjs",
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/test_scenario_health_actions_boundary_contract.py",
      "tests/test_startup_hydration_boundary_contract.py",
      "tests/test_scenario_data_health_boundary_contract.py",
      "tests/test_scenario_presentation_runtime_boundary_contract.py",
      "tests/test_scenario_lifecycle_runtime_boundary_contract.py",
      "tests/test_scenario_rollback_boundary_contract.py",
      "tests/test_scenario_runtime_state_boundary_contract.py",
      "tests/test_scenario_state_actions_boundary_contract.py",
      "tests/test_state_write_guardrail_contract.py",
      "tests/verification_metadata_behavior.test.mjs",
      "docs/active/state-action-ownership-p4-20260719",
      "docs/active/_worktree_registry.md",
      "tools/verification/verification_domains.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 26,
    "selectorOrder": 24,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p4:p4-3-exact-phase",
    "commandRef": "verify:p4:p4-3",
    "sourceRefs": [
      "js/core/state/actions/renderer_phase_actions.js",
      "js/core/state/actions/renderer_interaction_actions.js",
      "js/core/state/actions/renderer_exact_refresh_actions.js",
      "js/core/state/actions/renderer_cache_actions.js",
      "js/core/renderer/render_pass_cache_state_normalizer.js",
      "js/core/state/actions/renderer_diagnostics_actions.js",
      "js/core/renderer/render_snapshot.js",
      "js/core/renderer/render_perf_metrics_runtime_owner.js",
      "js/core/renderer/day_night_runtime_owner.js",
      "js/core/renderer/visual_effects_pass_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js",
      "js/core/map_renderer/click_selection_transaction_owner.js",
      "js/core/map_renderer/exact_after_settle_scheduler.js",
      "js/bootstrap/startup_bootstrap_support.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/state/renderer_runtime_state.js",
      "js/core/map_renderer.js",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "tools/state_writer_policy.mjs",
      "tools/state_writer_policy.json",
      "tools/build_state_writer_policy.mjs",
      "tools/check_state_writer_policy.mjs",
      "tools/check_p4_state_action_routes.mjs",
      "tools/test_route_registry.mjs",
      "tools/select_verification_targets.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/verification/resumable_verification.mjs",
      "tools/verification/state_writer_policy_evidence.mjs",
      "tools/run_p4_state_writer_policy_tests.mjs",
      "tools/verification/p4_state_writer_policy_test_lifecycle.mjs",
      "tools/verification/p4_state_writer_historical_proof_worker.mjs",
      "tests/renderer_phase_actions_behavior.test.mjs",
      "tests/renderer_interaction_actions_behavior.test.mjs",
      "tests/renderer_exact_refresh_actions_behavior.test.mjs",
      "tests/render_pass_cache_state_normalizer_behavior.test.mjs",
      "tests/renderer_cache_actions_behavior.test.mjs",
      "tests/renderer_diagnostics_actions_behavior.test.mjs",
      "tests/render_snapshot_behavior.test.mjs",
      "tests/render_perf_metrics_runtime_owner_behavior.test.mjs",
      "tests/day_night_runtime_owner_behavior.test.mjs",
      "tests/visual_effects_pass_owner_behavior.test.mjs",
      "tests/political_background_render_owner_behavior.test.mjs",
      "tests/exact_after_settle_scheduler_state_actions_behavior.test.mjs",
      "tests/renderer_render_phase_lifecycle_inventory.test.mjs",
      "tests/renderer_render_phase_lifecycle_owner_behavior.test.mjs",
      "tests/zoom_interaction_lifecycle_owner_behavior.test.mjs",
      "tests/renderer_runtime_state_behavior.test.mjs",
      "tests/physical_layer_contracts.test.mjs",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/state_writer_policy_behavior.test.mjs",
      "tests/state_writer_policy_manifest_behavior.test.mjs",
      "tests/state_writer_scanner_soundness_behavior.test.mjs",
      "tests/state_writer_policy_soundness_behavior.test.mjs",
      "tests/p4_state_action_routes_behavior.test.mjs",
      "tests/p4_state_writer_runner_reachability_behavior.test.mjs",
      "tests/p4_state_writer_streaming_runner_behavior.test.mjs",
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/state_writer_policy_evidence_behavior.test.mjs",
      "tests/test_renderer_control_actions_boundary_contract.py",
      "tests/test_renderer_exact_refresh_actions_boundary_contract.py",
      "tests/test_renderer_cache_actions_boundary_contract.py",
      "tests/test_renderer_diagnostics_actions_boundary_contract.py",
      "tests/test_map_renderer_render_snapshot_boundary_contract.py",
      "tests/test_day_night_runtime_owner_boundary_contract.py",
      "tests/test_map_renderer_political_background_render_owner_boundary_contract.py",
      "tests/test_renderer_runtime_state_boundary_contract.py",
      "tests/test_scenario_chunk_refresh_contracts.py",
      "tests/test_state_write_guardrail_contract.py",
      "tests/verification_metadata_behavior.test.mjs",
      "docs/active/state-action-ownership-p4-20260719",
      "docs/active/_worktree_registry.md",
      "tools/verification/verification_domains.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 29,
    "selectorOrder": 27,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-1-boot-actions",
    "commandRef": "test:node:p4:p4-1",
    "sourceRefs": [
      "js/core/state/actions/boot_actions.js",
      "js/core/state/boot_state.js",
      "js/core/state/content_state.js",
      "js/main.js",
      "js/bootstrap/post_ready_scheduler.js",
      "js/bootstrap/startup_boot_overlay.js",
      "js/bootstrap/startup_bootstrap_support.js",
      "js/bootstrap/ui_shell_boot.js",
      "js/bootstrap/ui_shell_debug_seed.js",
      "js/core/sample_project_import_workflow.js",
      "js/core/scenario/bundle_runtime.js",
      "js/core/scenario/startup_hydration.js",
      "tests/boot_actions_behavior.test.mjs",
      "tests/startup_boot_overlay_behavior.test.mjs",
      "tests/startup_bootstrap_support_behavior.test.mjs",
      "tests/post_ready_scheduler_behavior.test.mjs",
      "tests/ui_shell_boot_behavior.test.mjs",
      "tests/startup_hydration_behavior.test.mjs",
      "tests/sample_project_contracts.test.mjs",
      "tests/main_bootstrap_wiring_boundary.test.mjs",
      "tests/main_post_ready_scheduler_boundary.test.mjs",
      "tests/main_ui_shell_boot_boundary.test.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output",
      "heavy-geo",
      "scenario-data"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 15,
    "selectorOrder": 13,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "startup-node",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-1-boot-boundary",
    "commandRef": "test:python:p4:p4-1-boundary",
    "sourceRefs": [
      "js/core/state/actions/boot_actions.js",
      "js/core/state/boot_state.js",
      "tests/test_boot_state_actions_boundary_contract.py",
      "tests/test_state_split_boundary_contract.py",
      "tests/test_state_write_guardrail_contract.py",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 16,
    "selectorOrder": 14,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "startup-node",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-2a-scenario-actions",
    "commandRef": "test:node:p4:p4-2a",
    "sourceRefs": [
      "js/core/state/actions/scenario_readiness_actions.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/actions/scenario_apply_request_actions.js",
      "js/core/state/actions/scenario_palette_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario_manager.js",
      "js/core/palette_manager.js",
      "js/core/scenario_resources.js",
      "js/core/scenario_rollback.js",
      "js/core/scenario_post_apply_effects.js",
      "tools/state_action_delegation_contract.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
      "tests/scenario_apply_transaction_ownership.test.mjs",
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
      "tests/scenario_runtime_state_behavior.test.mjs",
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output",
      "heavy-geo",
      "scenario-data"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 18,
    "selectorOrder": 16,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-2a-scenario-boundary",
    "commandRef": "test:python:p4:p4-2a-boundary",
    "sourceRefs": [
      "js/core/state/actions/scenario_readiness_actions.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/actions/scenario_apply_request_actions.js",
      "js/core/state/actions/scenario_palette_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario_manager.js",
      "js/core/palette_manager.js",
      "js/core/scenario_resources.js",
      "js/core/scenario_rollback.js",
      "js/core/scenario_post_apply_effects.js",
      "tests/test_scenario_state_actions_boundary_contract.py",
      "tests/test_scenario_manager_boundary_contract.py",
      "tests/test_scenario_resources_boundary_contract.py",
      "tests/test_scenario_rollback_boundary_contract.py",
      "tests/test_scenario_lifecycle_runtime_boundary_contract.py",
      "tests/test_state_write_guardrail_contract.py",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 19,
    "selectorOrder": 17,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-2b-scenario-chunk-actions",
    "commandRef": "test:node:p4:p4-2b",
    "sourceRefs": [
      "js/core/state/actions/scenario_chunk_runtime_actions.js",
      "js/core/state/actions/scenario_chunk_promotion_actions.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/state/scenario_runtime_state.js",
      "js/bootstrap/deferred_detail_promotion.js",
      "js/bootstrap/startup_ready_handoff.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario/lifecycle_runtime.js",
      "js/core/map_renderer/scenario_refresh_runtime.js",
      "js/core/state/content_state.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "tests/scenario_chunk_state_actions_behavior.test.mjs",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/scenario_chunk_promotion_helpers_behavior.test.mjs",
      "tests/scenario_refresh_plans_behavior.test.mjs",
      "tests/scenario_runtime_state_behavior.test.mjs",
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output",
      "heavy-geo",
      "scenario-data"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 21,
    "selectorOrder": 19,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-2b-scenario-chunk-boundary",
    "commandRef": "test:python:p4:p4-2b-boundary",
    "sourceRefs": [
      "js/core/state/actions/scenario_chunk_runtime_actions.js",
      "js/core/state/actions/scenario_chunk_promotion_actions.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/state/scenario_runtime_state.js",
      "js/bootstrap/deferred_detail_promotion.js",
      "js/bootstrap/startup_ready_handoff.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario/lifecycle_runtime.js",
      "js/core/map_renderer/scenario_refresh_runtime.js",
      "js/core/state/content_state.js",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "tests/test_scenario_chunk_state_actions_boundary_contract.py",
      "tests/test_scenario_chunk_refresh_contracts.py",
      "tests/test_main_deferred_detail_promotion_boundary_contract.py",
      "tests/test_scenario_manager_boundary_contract.py",
      "tests/test_scenario_rollback_boundary_contract.py",
      "tests/test_state_write_guardrail_contract.py",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 22,
    "selectorOrder": 20,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-2c-scenario-health-actions",
    "commandRef": "test:node:p4:p4-2c",
    "sourceRefs": [
      "js/core/state/actions/scenario_health_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "js/core/state/scenario_runtime_state.js",
      "js/core/scenario/startup_hydration.js",
      "js/core/scenario_data_health.js",
      "js/core/scenario/presentation_display_restore.js",
      "js/core/scenario/lifecycle_runtime.js",
      "js/core/scenario_rollback.js",
      "tests/scenario_health_actions_behavior.test.mjs",
      "tests/startup_hydration_behavior.test.mjs",
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
      "tests/scenario_runtime_state_behavior.test.mjs",
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output",
      "heavy-geo",
      "scenario-data"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 24,
    "selectorOrder": 22,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-2c-scenario-health-boundary",
    "commandRef": "test:python:p4:p4-2c-boundary",
    "sourceRefs": [
      "js/core/state/actions/scenario_health_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/actions/scenario_transaction_rollback_actions.js",
      "js/core/state/scenario_runtime_state.js",
      "js/core/scenario/startup_hydration.js",
      "js/core/scenario_data_health.js",
      "js/core/scenario/presentation_display_restore.js",
      "js/core/scenario/lifecycle_runtime.js",
      "js/core/scenario_rollback.js",
      "tests/test_scenario_health_actions_boundary_contract.py",
      "tests/test_startup_hydration_boundary_contract.py",
      "tests/test_scenario_data_health_boundary_contract.py",
      "tests/test_scenario_presentation_runtime_boundary_contract.py",
      "tests/test_scenario_lifecycle_runtime_boundary_contract.py",
      "tests/test_scenario_rollback_boundary_contract.py",
      "tests/test_scenario_runtime_state_boundary_contract.py",
      "tests/test_scenario_state_actions_boundary_contract.py",
      "tests/test_state_write_guardrail_contract.py",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 25,
    "selectorOrder": 23,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-3-renderer-actions",
    "commandRef": "test:node:p4:p4-3",
    "sourceRefs": [
      "js/core/state/actions/renderer_phase_actions.js",
      "js/core/state/actions/renderer_interaction_actions.js",
      "js/core/state/actions/renderer_exact_refresh_actions.js",
      "js/core/state/actions/renderer_cache_actions.js",
      "js/core/renderer/render_pass_cache_state_normalizer.js",
      "js/core/state/actions/renderer_diagnostics_actions.js",
      "js/core/renderer/render_snapshot.js",
      "js/core/renderer/render_perf_metrics_runtime_owner.js",
      "js/core/renderer/day_night_runtime_owner.js",
      "js/core/renderer/visual_effects_pass_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js",
      "js/core/state_defaults.js",
      "js/core/map_renderer/exact_after_settle_scheduler.js",
      "js/bootstrap/startup_bootstrap_support.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/state/renderer_runtime_state.js",
      "js/core/map_renderer.js",
      "tests/renderer_phase_actions_behavior.test.mjs",
      "tests/renderer_interaction_actions_behavior.test.mjs",
      "tests/renderer_exact_refresh_actions_behavior.test.mjs",
      "tests/render_pass_cache_state_normalizer_behavior.test.mjs",
      "tests/renderer_cache_actions_behavior.test.mjs",
      "tests/renderer_diagnostics_actions_behavior.test.mjs",
      "tests/render_snapshot_behavior.test.mjs",
      "tests/render_perf_metrics_runtime_owner_behavior.test.mjs",
      "tests/day_night_runtime_owner_behavior.test.mjs",
      "tests/visual_effects_pass_owner_behavior.test.mjs",
      "tests/political_background_render_owner_behavior.test.mjs",
      "tests/exact_after_settle_scheduler_state_actions_behavior.test.mjs",
      "tests/renderer_render_phase_lifecycle_inventory.test.mjs",
      "tests/renderer_render_phase_lifecycle_owner_behavior.test.mjs",
      "tests/zoom_interaction_lifecycle_owner_behavior.test.mjs",
      "tests/renderer_runtime_state_behavior.test.mjs",
      "tests/physical_layer_contracts.test.mjs",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output",
      "heavy-geo",
      "scenario-data"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 27,
    "selectorOrder": 25,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-3-renderer-boundary",
    "commandRef": "test:python:p4:p4-3-boundary",
    "sourceRefs": [
      "js/core/state/actions/renderer_phase_actions.js",
      "js/core/state/actions/renderer_interaction_actions.js",
      "js/core/state/actions/renderer_exact_refresh_actions.js",
      "js/core/state/actions/renderer_cache_actions.js",
      "js/core/renderer/render_pass_cache_state_normalizer.js",
      "js/core/state/actions/renderer_diagnostics_actions.js",
      "js/core/renderer/render_snapshot.js",
      "js/core/renderer/render_perf_metrics_runtime_owner.js",
      "js/core/renderer/day_night_runtime_owner.js",
      "js/core/renderer/visual_effects_pass_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js",
      "js/core/map_renderer/click_selection_transaction_owner.js",
      "js/core/map_renderer/exact_after_settle_scheduler.js",
      "js/bootstrap/startup_bootstrap_support.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/state/renderer_runtime_state.js",
      "js/core/map_renderer.js",
      "tests/test_renderer_control_actions_boundary_contract.py",
      "tests/test_renderer_exact_refresh_actions_boundary_contract.py",
      "tests/render_pass_cache_state_normalizer_behavior.test.mjs",
      "tests/test_renderer_cache_actions_boundary_contract.py",
      "tests/test_renderer_diagnostics_actions_boundary_contract.py",
      "tests/test_map_renderer_render_snapshot_boundary_contract.py",
      "tests/render_perf_metrics_runtime_owner_behavior.test.mjs",
      "tests/day_night_runtime_owner_behavior.test.mjs",
      "tests/visual_effects_pass_owner_behavior.test.mjs",
      "tests/test_day_night_runtime_owner_boundary_contract.py",
      "tests/test_map_renderer_political_background_render_owner_boundary_contract.py",
      "tests/test_renderer_runtime_state_boundary_contract.py",
      "tests/test_scenario_chunk_refresh_contracts.py",
      "tests/test_state_write_guardrail_contract.py",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 28,
    "selectorOrder": 26,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:state-write-boundary",
    "commandRef": "test:python:p4:state-write-boundary",
    "sourceRefs": [
      "tools/run_p4_state_write_boundary.mjs",
      "tests/test_state_write_guardrail_contract.py",
      "tools/state_writer_policy.mjs",
      "tools/state_writer_policy.json",
      "tools/check_state_writer_policy.mjs",
      "package.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 14,
    "selectorOrder": 12,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:state-writer-policy",
    "commandRef": "verify:p4:state-writer-policy",
    "sourceRefs": [
      "tools/state_borrowed_effect_contract.mjs",
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
      "package-lock.json"
    ],
    "ownerHints": [
      "state-ownership"
    ],
    "domains": [
      "state-ownership"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 13,
    "selectorOrder": 11,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-4-ui-actions",
    "commandRef": "test:node:p4:p4-4",
    "sourceRefs": [
      ...P4_4_SOURCE_REFS,
      "package.json"
    ],
    "ownerHints": ["state-ownership"],
    "domains": ["state-ownership"],
    "tiers": ["contract"],
    "cost": "heavy",
    "resourceLocks": [
      ".runtime-output",
      "heavy-geo",
      "scenario-data"
    ],
    "executionOwners": ["main-thread"],
    "profiles": ["full"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 139,
    "selectorOrder": 395,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:p4:p4-4-writer-guardrail",
    "commandRef": "test:python:p4:p4-4-boundary",
    "sourceRefs": [
      ...P4_4_SOURCE_REFS,
      "tests/test_state_write_guardrail_contract.py",
      "package.json"
    ],
    "ownerHints": ["state-ownership"],
    "domains": ["state-ownership"],
    "tiers": ["contract"],
    "cost": "heavy",
    "resourceLocks": [".runtime-output"],
    "executionOwners": ["main-thread"],
    "profiles": ["full"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 140,
    "selectorOrder": 396,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p4:p4-4-exact-phase",
    "commandRef": "verify:p4:p4-4",
    "sourceRefs": [
      ...P4_4_SOURCE_REFS,
      // Cumulative policy admission for the integrated startup, scenario and
      // renderer changes. Their existing owner behavior routes remain separate.
      "js/core/data_loader.js",
      "js/core/interaction_funnel.js",
      "js/core/interaction_funnel/import_apply_orchestration.js",
      "js/ui/sidebar/project_support_diagnostics_controller.js",
      "js/core/legend_manager.js",
      "js/core/project_package_io.js",
      "js/core/renderer/city_points_render_owner.js",
      "js/core/renderer/exact_composite_reuse_owner.js",
      "js/core/renderer/legend_control_owner.js",
      "js/core/renderer/river_layer_render_owner.js",
      "js/core/renderer/spatial_index_runtime_owner.js",
      "js/core/scenario/bundle_cache.js",
      "js/core/scenario/core_value_normalizer.js",
      "js/core/scenario/rollback_clone.js",
      "js/core/scenario/shared.js",
      "js/core/startup_cache.js",
      "js/core/startup_worker_client.js",
      "js/workers/startup_boot.worker.js",
      "js/core/renderer/bathymetry_style_policy.js",
      "js/core/renderer/brush_interaction_session_owner.js",
      "js/core/renderer/city_label_text_model.js",
      "js/core/renderer/city_paint_style_model.js",
      "js/core/renderer/fill_target_policy.js",
      "js/core/renderer/operation_graphics_editor_render_owner.js",
      "js/core/renderer/parent_border_grouping_policy.js",
      "js/core/renderer/physical_intensity_interaction_owner.js",
      "js/core/renderer/physical_intensity_preview_owner.js",
      "js/core/renderer/pixel_ratio_policy.js",
      "js/core/renderer/political_feature_policy.js",
      "js/core/renderer/political_path_cache_owner.js",
      "js/core/renderer/projected_bounds_diagnostics_owner.js",
      "js/core/renderer/render_pass_signature_policy.js",
      "js/core/renderer/scenario_region_overlay_render_owner.js",
      "js/core/renderer/static_border_mesh_lifecycle.js",
      "js/core/renderer/transient_overlay_render_owner.js",
      "js/core/renderer/unit_counter_display_model.js",
      "js/core/renderer/urban_adaptive_paint_model.js",
      "js/core/renderer/visible_frame_diagnostics_owner.js",
      "js/core/renderer/visible_frame_identity_policy.js",
      "js/core/scenario/chunk_layer_payloads.js",
      "js/core/scenario/chunk_payload_loader.js",
      "js/core/scenario/optional_layer_runtime.js",
      "tools/state_action_delegation_contract.mjs",
      "tools/state_borrowed_effect_contract.mjs",
      "tools/state_writer_inventory.mjs",
      "tools/state_writer_policy.mjs",
      "tools/state_writer_policy.json",
      "tools/build_state_writer_policy.mjs",
      "tools/check_state_writer_policy.mjs",
      "tools/check_p4_state_action_routes.mjs",
      "tools/test_route_registry.mjs",
      "tools/select_verification_targets.mjs",
      "tools/run_p4_phase_verification.mjs",
      "tools/verification/resumable_verification.mjs",
      "tools/verification/state_writer_policy_evidence.mjs",
      "tools/verification/command_supersession.mjs",
      ...VERIFICATION_CATALOG_SOURCE_FILES,
      "tools/run_p4_state_writer_policy_tests.mjs",
      "tools/verification/p4_state_writer_policy_test_lifecycle.mjs",
      "tools/verification/p4_state_writer_historical_proof_worker.mjs",
      "tests/state_action_delegation_edges_behavior.test.mjs",
      "tests/state_writer_policy_batch_scan_behavior.test.mjs",
      "tests/state_writer_policy_behavior.test.mjs",
      "tests/state_writer_policy_manifest_behavior.test.mjs",
      "tests/state_writer_scanner_soundness_behavior.test.mjs",
      "tests/state_writer_policy_soundness_behavior.test.mjs",
      "tests/p4_state_action_routes_behavior.test.mjs",
      "tests/p4_state_writer_runner_reachability_behavior.test.mjs",
      "tests/p4_state_writer_streaming_runner_behavior.test.mjs",
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tests/state_writer_policy_evidence_behavior.test.mjs",
      "tests/test_state_write_guardrail_contract.py",
      "tests/verification_metadata_behavior.test.mjs",
      "docs/active/state-action-ownership-p4-20260719",
      "docs/active/appearance-transport-platformization-milestones-20260812",
      "docs/active/_worktree_registry.md",
      "tools/verification/verification_domains.mjs",
      "package.json"
    ],
    "ownerHints": ["state-ownership"],
    "domains": ["state-ownership"],
    "tiers": ["contract"],
    "cost": "heavy",
    "resourceLocks": [".runtime-output"],
    "executionOwners": ["main-thread"],
    "profiles": ["full"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 141,
    "selectorOrder": 397,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "state-ownership",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "node:test:node:p4:p4-4",
    "commandRef": "test:node:p4:p4-4",
    "sourceRefs": [
      ...P4_4_NODE_ROUTE_SOURCE_REFS
    ],
    "ownerHints": ["state-ownership"],
    "domains": ["state-ownership"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 398,
    "verification": null,
    "selector": {}
  }
];
