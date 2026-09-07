// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const SCENARIO_RECORDS = [
  {
    "id": "direct-e2e:test:e2e:dev:political-progressive-recovery",
    "commandRef": "test:e2e:dev:political-progressive-recovery",
    "sourceRefs": [
      "tests/e2e/dev/scenario_chunk_exact_after_settle_regression.dev.spec.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 155,
    "verification": null,
    "selector": {}
  },
  {
    "id": "direct-e2e:test:e2e:dev:scenario-chunk-runtime",
    "commandRef": "test:e2e:dev:scenario-chunk-runtime",
    "sourceRefs": [
      "tests/e2e/dev/scenario_chunk_exact_after_settle_regression.dev.spec.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 153,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/hoi4_1939_ui_smoke.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/hoi4_1939_ui_smoke.spec.js",
    "sourceRefs": [
      "tests/e2e/hoi4_1939_ui_smoke.spec.js"
    ],
    "ownerHints": [
      "scenario-hoi4"
    ],
    "domains": [
      "hoi4-scenario"
    ],
    "tiers": [
      "smoke"
    ],
    "cost": "fast",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "pr-smoke"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 2,
    "verificationOrder": null,
    "selectorOrder": 113,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/hoi4_rk_russia_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/hoi4_rk_russia_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/hoi4_rk_russia_regression.spec.js"
    ],
    "ownerHints": [
      "scenario-hoi4"
    ],
    "domains": [
      "hoi4-scenario"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 114,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/non_1962_runtime_matrix.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/non_1962_runtime_matrix.spec.js",
    "sourceRefs": [
      "tests/e2e/non_1962_runtime_matrix.spec.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 117,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/scenario_apply_concurrency.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/scenario_apply_concurrency.spec.js",
    "sourceRefs": [
      "tests/e2e/scenario_apply_concurrency.spec.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "feature"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 124,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/scenario_apply_resilience.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/scenario_apply_resilience.spec.js",
    "sourceRefs": [
      "tests/e2e/scenario_apply_resilience.spec.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "feature"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 125,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/scenario_blank_exit.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/scenario_blank_exit.spec.js",
    "sourceRefs": [
      "tests/e2e/scenario_blank_exit.spec.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "feature"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 126,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/scenario_boundary_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/scenario_boundary_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/scenario_boundary_regression.spec.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 127,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/scenario_controls_dispatcher_contract.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/scenario_controls_dispatcher_contract.spec.js",
    "sourceRefs": [
      "tests/e2e/scenario_controls_dispatcher_contract.spec.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 128,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/scenario_shell_overlay_contract.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/scenario_shell_overlay_contract.spec.js",
    "sourceRefs": [
      "tests/e2e/scenario_shell_overlay_contract.spec.js"
    ],
    "ownerHints": [
      "scenario-shell"
    ],
    "domains": [
      "scenario-shell"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "selectorOrder": 129,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/tno_1962_ui_smoke.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/tno_1962_ui_smoke.spec.js",
    "sourceRefs": [
      "tests/e2e/tno_1962_ui_smoke.spec.js"
    ],
    "ownerHints": [
      "scenario-tno"
    ],
    "domains": [
      "tno-scenario"
    ],
    "tiers": [
      "smoke"
    ],
    "cost": "fast",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "pr-smoke"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 2,
    "verificationOrder": null,
    "selectorOrder": 139,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:scenario-builder",
    "commandRef": "python tools/build_hoi4_scenario.py",
    "sourceRefs": [
      "tools/build_hoi4_scenario.py",
      "tools/build_startup_bundle.py",
      "scenario_builder"
    ],
    "ownerHints": [
      "scenario-builder"
    ],
    "domains": [
      "scenario-build"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "scenario-data",
      "checkpoint-builder",
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
    "selectorOrder": 101,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:scenario-contracts-strict",
    "commandRef": "verify:scenario-contracts:strict",
    "sourceRefs": [
      "tools/check_scenario_contracts.py",
      "data/scenarios/tno_1962",
      ".github/workflows/scenario-contract-matrix.yml"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-contracts"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
    "resourceLocks": [
      "scenario-data",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "scenario-contract-matrix"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 94,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:scenario-contracts-strict-full",
    "commandRef": "verify:scenario-contracts:strict",
    "sourceRefs": [
      "tools/check_scenario_contracts.py",
      "data/scenarios/tno_1962",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-contracts"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
    "resourceLocks": [
      "scenario-data",
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
    "selectorOrder": 96,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:scenario-contracts-strict-pr-fast",
    "commandRef": "verify:scenario-contracts:strict",
    "sourceRefs": [
      "tools/check_scenario_contracts.py",
      "data/scenarios/tno_1962",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-contracts"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
    "resourceLocks": [
      "scenario-data",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "pr-fast"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 95,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:tno-atlantropa-coverage",
    "commandRef": "verify:tno-atlantropa-coverage",
    "sourceRefs": [
      "tools/check_scenario_contracts.py",
      "data/scenarios/tno_1962/scenario_atlantropa_metadata.json",
      "data/scenarios/tno_1962/chunks"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "tno-coverage-chain"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
    "resourceLocks": [
      "scenario-data",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "scenario-contract-matrix"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 98,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:tno-coverage-chain",
    "commandRef": "verify:tno-coverage-chain",
    "sourceRefs": [
      "tools/check_scenario_contracts.py",
      "tools/validate_tno_water_geometries.py",
      "tools/patch_tno_1962_bundle.py",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "data/scenarios/tno_1962"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "tno-coverage-chain"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
      "scenario-data",
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
    "selectorOrder": 100,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:tno-coverage-ledger",
    "commandRef": "verify:tno-coverage-ledger",
    "sourceRefs": [
      "tools/check_scenario_contracts.py",
      "data/scenarios/tno_1962/derived/atlantropa_donor_ledger.json",
      "data/scenarios/tno_1962/derived/geometry_drop_audit.json"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "tno-coverage-chain"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
    "resourceLocks": [
      "scenario-data",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "scenario-contract-matrix"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 97,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-splits",
    "commandRef": "test:node:renderer-splits",
    "sourceRefs": [
      "js/core/renderer/transient_overlay_render_owner.js",
      "tests/transient_overlay_render_owner_behavior.test.mjs",
      "js/core/renderer/unit_counter_display_model.js",
      "js/core/renderer/operation_graphic_geometry.js",
      "tests/unit_counter_display_model_behavior.test.mjs",
      "tests/operation_graphic_geometry_behavior.test.mjs",
      "js/core/state/actions/special_zone_actions.js",
      "tests/strategic_overlay_runtime_owner_behavior.test.mjs",
      "tests/strategic_overlay_render_owner_behavior.test.mjs",
      "tests/retired_frontline_behavior.test.mjs",
      "tests/strategic_overlay_state_behavior.test.mjs",
      "tests/special_zone_layers_state_behavior.test.mjs",
      "tests/special_zones_workbench_controller_behavior.test.mjs",
      "tests/scenario_optional_layers_behavior.test.mjs",
      "js/core/renderer/strategic_overlay_runtime_owner.js",
      "js/core/renderer/strategic_overlay_render_owner.js",
      "js/core/state/strategic_overlay_state.js",
      "js/core/special_zone_layers.js",
      "js/core/state/index.js",
      "js/ui/toolbar/special_zones_workbench_controller.js",
      "js/core/scenario/bundle_loader.js",
      "js/core/scenario_resources.js",
      "js/core/state.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 217,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-apply-transaction-ownership",
    "commandRef": "test:node:scenario-apply-transaction-ownership",
    "sourceRefs": [
      "tests/scenario_apply_transaction_ownership.test.mjs"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 221,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-chunk-contracts:quick",
    "commandRef": "test:node:scenario-chunk-contracts:quick",
    "sourceRefs": [
      "package.json",
      "tests/scenario_chunk_contracts.quick.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/helpers/scenario_chunk_contract_support.mjs",
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
      "js/core/state/actions/scenario_presentation_actions.js"
    ],
    "ownerHints": ["scenario-runtime"],
    "domains": ["scenario-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 5,
    "verificationOrder": null,
    "selectorOrder": 374,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-chunk-contracts:heavy",
    "commandRef": "test:node:scenario-chunk-contracts:heavy",
    "sourceRefs": [
      "tests/scenario_chunk_contracts.heavy.test.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/helpers/scenario_chunk_contract_support.mjs",
      "data/scenarios/tno_1962",
      "vendor/d3.v7.min.js",
      "js/bootstrap/deferred_ui_bootstrap.js",
      "js/bootstrap/startup_bootstrap_support.js",
      "js/bootstrap/startup_data_pipeline.js",
      "js/bootstrap/startup_scenario_boot.js",
      "js/core/frame_scheduler.js",
      "js/core/map_renderer.js",
      "js/core/map_renderer/canvas_layer_manager.js",
      "js/core/map_renderer/draw_canvas_orchestration_owner.js",
      "js/core/map_renderer/exact_after_settle_refresh_plans.js",
      "js/core/map_renderer/exact_after_settle_scheduler.js",
      "js/core/map_renderer/interaction_hit_candidates.js",
      "js/core/map_renderer/political_raster_worker_packet.js",
      "js/core/map_renderer/render_invalidation_catalog.js",
      "js/core/map_renderer/render_pass_catalog.js",
      "js/core/map_renderer/render_pass_commit_accounting_owner.js",
      "js/core/map_renderer/render_phase_lifecycle_owner.js",
      "js/core/map_renderer/render_request_boundary_owner.js",
      "js/core/map_renderer/scenario_refresh_plans.js",
      "js/core/map_renderer/scenario_refresh_runtime.js",
      "js/core/map_renderer/scenario_visual_invalidation_executor.js",
      "js/core/map_renderer/set_map_data_transaction_owner.js",
      "js/core/map_renderer/transformed_frame_compositor_owner.js",
      "js/core/political_raster_worker_client.js",
      "js/core/renderer/cached_pass_compositor_owner.js",
      "js/core/renderer/city_points_render_owner.js",
      "js/core/renderer/context_pass_orchestrator_owner.js",
      "js/core/renderer/exact_after_settle_pass_catalog.js",
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/projected_geometry_bounds_owner.js",
      "js/core/renderer/render_cache_owner.js",
      "js/core/renderer/render_pipeline_passes.js",
      "js/core/renderer/render_transform_reuse_policy_owner.js",
      "js/core/renderer/scenario_chunk_promotion_helpers.js",
      "js/core/renderer/scenario_water_cache_policy_owner.js",
      "js/core/renderer/spatial_index_runtime_builders.js",
      "js/core/renderer/spatial_index_runtime_owner.js",
      "js/core/renderer/spatial_query_index.js",
      "js/core/renderer/urban_city_policy.js",
      "js/core/renderer/visible_frame_diagnostics_owner.js",
      "js/core/renderer/zoom_interaction_lifecycle_owner.js",
      "js/core/scenario_apply_pipeline.js",
      "js/core/scenario_chunk_manager.js",
      "js/core/scenario_manager.js",
      "js/core/scenario_ownership_editor.js",
      "js/core/scenario_post_apply_effects.js",
      "js/core/scenario/bundle_loader.js",
      "js/core/scenario/bundle_runtime.js",
      "js/core/scenario/chunk_runtime.js",
      "js/core/scenario/scenario_renderer_bridge.js",
      "js/core/scenario/startup_hydration.js",
      "js/core/state/renderer_runtime_state.js",
      "js/main.js",
      "js/workers/political_raster.worker.js",
      "ops/browser-mcp/editor-performance-benchmark.py",
      "tests/e2e/dev/scenario_chunk_exact_after_settle_regression.dev.spec.js",
      "tests/e2e/support/playwright-app-paths.js",
      "tests/e2e/support/political-pixel-probe.js",
      "tools/check_scenario_contracts.py",
      "tools/scenario_chunk_assets.py"
    ],
    "ownerHints": ["scenario-runtime"],
    "domains": ["scenario-runtime"],
    "tiers": ["heavy"],
    "cost": "heavy",
    "resourceLocks": ["scenario-data"],
    "executionOwners": ["main-thread"],
    "profiles": ["full"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 375,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-chunk-contracts:split",
    "commandRef": "test:node:scenario-chunk-contracts:split",
    "sourceRefs": [
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/scenario_chunk_contracts.quick.test.mjs",
      "tests/scenario_chunk_contracts.heavy.test.mjs"
    ],
    "ownerHints": ["scenario-runtime"],
    "domains": ["scenario-runtime"],
    "tiers": ["heavy"],
    "cost": "heavy",
    "resourceLocks": ["scenario-data"],
    "executionOwners": ["main-thread"],
    "profiles": ["full"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 376,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-chunk-contracts:shadow",
    "commandRef": "test:node:scenario-chunk-contracts:shadow",
    "sourceRefs": [
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/scenario_chunk_contract_shadow_behavior.test.mjs",
      "tools/verification/test_shadow_equivalence.mjs"
    ],
    "ownerHints": ["scenario-runtime"],
    "domains": ["scenario-runtime"],
    "tiers": ["heavy"],
    "cost": "heavy",
    "resourceLocks": [".runtime-output", "scenario-data"],
    "executionOwners": ["main-thread"],
    "profiles": ["full"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 377,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-chunk-contracts",
    "commandRef": "test:node:scenario-chunk-contracts",
    "sourceRefs": [
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/helpers/scenario_chunk_contract_support.mjs",
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
      "js/core/state/actions/scenario_presentation_actions.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 328,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-chunk-promotion-helpers",
    "commandRef": "test:node:scenario-chunk-promotion-helpers",
    "sourceRefs": [
      "tests/scenario_chunk_promotion_helpers_behavior.test.mjs",
      "js/core/renderer/scenario_chunk_promotion_helpers.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 225,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-context-bar-controller",
    "commandRef": "test:node:scenario-context-bar-controller",
    "sourceRefs": [
      "tests/scenario_context_bar_controller_behavior.test.mjs",
      "js/ui/toolbar/scenario_context_bar_controller.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 222,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-lifecycle-runtime-behavior",
    "commandRef": "test:node:scenario-lifecycle-runtime-behavior",
    "sourceRefs": [
      "tests/scenario_lifecycle_runtime_behavior.test.mjs",
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
      "js/core/state/scenario_runtime_state.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 219,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-refresh-plans",
    "commandRef": "test:node:scenario-refresh-plans",
    "sourceRefs": [
      "tests/scenario_refresh_plans_behavior.test.mjs",
      "tests/scenario_visual_invalidation_executor_behavior.test.mjs",
      "js/core/map_renderer/scenario_refresh_plans.js",
      "js/core/map_renderer/scenario_refresh_runtime.js",
      "js/core/renderer/context_layer_resolver.js",
      "js/core/map_renderer/scenario_visual_invalidation_executor.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 226,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-relief-overlay-owner",
    "commandRef": "test:node:scenario-relief-overlay-owner",
    "sourceRefs": [
      "tests/scenario_relief_overlay_render_owner_behavior.test.mjs",
      "js/core/renderer/scenario_relief_overlay_render_owner.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 331,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-runtime-state-behavior",
    "commandRef": "test:node:scenario-runtime-state-behavior",
    "sourceRefs": [
      "tests/scenario_runtime_state_behavior.test.mjs",
      "js/core/scenario/chunk_runtime.js",
      "js/core/state/scenario_runtime_state.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 220,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-water-cache-policy-owner",
    "commandRef": "test:node:scenario-water-cache-policy-owner",
    "sourceRefs": [
      "tests/scenario_water_cache_policy_owner_behavior.test.mjs",
      "js/core/renderer/scenario_water_cache_policy_owner.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "selectorOrder": 316,
    "verification": null,
    "selector": {}
  },
  {
    "id": "p3:context-pass:scenario-chunk-contracts",
    "commandRef": "test:node:scenario-chunk-contracts",
    "sourceRefs": [
      "js/core/renderer/context_pass_orchestrator_owner.js",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "verificationOrder": 58,
    "selectorOrder": 45,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "scenario-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:context-pass:scenario-resilience",
    "commandRef": "test:e2e:scenario-resilience",
    "sourceRefs": [
      "js/core/renderer/context_pass_orchestrator_owner.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "verificationOrder": 63,
    "selectorOrder": 50,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "scenario-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:context-pass:water-rendering",
    "commandRef": "test:e2e:water-rendering",
    "sourceRefs": [
      "js/core/renderer/context_pass_orchestrator_owner.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "verificationOrder": 62,
    "selectorOrder": 49,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "scenario-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:political-pass:scenario-chunk-contracts",
    "commandRef": "test:node:scenario-chunk-contracts",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
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
    "verificationOrder": 47,
    "selectorOrder": 34,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "scenario-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:political-pass:scenario-chunk-runtime",
    "commandRef": "test:e2e:dev:scenario-chunk-runtime",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "verificationOrder": 51,
    "selectorOrder": 38,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "scenario-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:political-pass:scenario-resilience",
    "commandRef": "test:e2e:scenario-resilience",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "verificationOrder": 52,
    "selectorOrder": 39,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "scenario-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:political-pass:water-rendering",
    "commandRef": "test:e2e:water-rendering",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "browser-dev-server",
      "playwright-browser",
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
    "verificationOrder": 54,
    "selectorOrder": 41,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "scenario-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "direct:content-addressed-artifact-cache",
    "commandRef": "python -m unittest tests.test_content_addressed_artifact_cache tests.test_scenario_build_session -q",
    "sourceRefs": [
      "map_builder/content_addressed_artifact_cache.py",
      "map_builder/scenario_build_session.py",
      "tests/test_content_addressed_artifact_cache.py",
      "tests/test_scenario_build_session.py"
    ],
    "ownerHints": [
      "scenario-builder"
    ],
    "domains": [
      "scenario-build"
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
    "entrypointPolicyIndex": 5,
    "verificationOrder": null,
    "selectorOrder": 393,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python:tests.deferred_detail_promotion_contracts",
    "commandRef": "python -m unittest tests.test_main_deferred_detail_promotion_boundary_contract tests.test_scenario_chunk_refresh_contracts tests.test_scenario_renderer_bridge_boundary_contract -q",
    "sourceRefs": [
      "js/bootstrap/deferred_detail_promotion.js",
      "tests/test_main_deferred_detail_promotion_boundary_contract.py",
      "tests/test_scenario_chunk_refresh_contracts.py",
      "tests/test_scenario_renderer_bridge_boundary_contract.py"
    ],
    "ownerHints": [
      "deferred-detail-promotion"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
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
    "selectorOrder": 357,
    "verification": null,
    "selector": {}
  },
  {
    "id": "verify-core:test:node:annotation-productization",
    "commandRef": "test:node:annotation-productization",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
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
    "verificationOrder": 119,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "scenario-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:scenario-apply-transaction-ownership",
    "commandRef": "test:node:scenario-apply-transaction-ownership",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
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
    "verificationOrder": 116,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "scenario-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:scenario-chunk-contracts",
    "commandRef": "test:node:scenario-chunk-contracts",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
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
    "verificationOrder": 115,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "scenario-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:scenario-lifecycle-runtime-behavior",
    "commandRef": "test:node:scenario-lifecycle-runtime-behavior",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
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
    "verificationOrder": 117,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "scenario-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:scenario-runtime-state-behavior",
    "commandRef": "test:node:scenario-runtime-state-behavior",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
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
    "verificationOrder": 118,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "scenario-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:verify:scenario-contracts:strict",
    "commandRef": "verify:scenario-contracts:strict",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "scenario-runtime"
    ],
    "domains": [
      "scenario-runtime"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "contract",
    "resourceLocks": [
      "scenario-data",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "scenario-contract-matrix"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 114,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "scenario-project-chunk",
      "supervisorDomain": "scenario-runtime"
    },
    "selector": null
  }
];
