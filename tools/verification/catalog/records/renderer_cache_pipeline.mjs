// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
const politicalIdRasterRoute = {
  ownerHints: ["renderer-runtime"], domains: ["renderer-runtime"], tiers: ["contract"],
  cost: "fast", resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"],
  platforms: ["all"], entrypointPolicyIndex: 5,
  verificationOrder: null, verification: null, selector: {},
};

export const RENDERER_CACHE_PIPELINE_RECORDS = [
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:physical-world-surface", selectorOrder: 5025,
    commandRef: "node --test tests/physical_raster_surface_behavior.test.mjs tests/physical_canvas_residency_behavior.test.mjs tests/physical_layer_render_owner_behavior.test.mjs",
    sourceRefs: ["js/core/renderer/physical_raster_surface.js", "tests/physical_raster_surface_behavior.test.mjs", "tests/physical_canvas_residency_behavior.test.mjs"],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:canvas-draw-batches", selectorOrder: 5024,
    commandRef: "node --test tests/canvas_draw_batch_behavior.test.mjs tests/canvas_gpu_submission_client_behavior.test.mjs tests/canvas_gpu_submission_worker_behavior.test.mjs",
    sourceRefs: ["js/core/renderer/canvas_draw_batch.js", "js/core/canvas_gpu_submission_client.js", "js/core/renderer/canvas_gpu_submission_kernel.js", "js/workers/canvas_gpu_submission.worker.js", "tests/canvas_draw_batch_behavior.test.mjs", "tests/canvas_gpu_submission_client_behavior.test.mjs", "tests/canvas_gpu_submission_worker_behavior.test.mjs"],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:index-ui-refresh", selectorOrder: 5023,
    commandRef: "node --test tests/index_ui_refresh_scheduler_behavior.test.mjs",
    sourceRefs: ["js/core/map_renderer.js", "tests/index_ui_refresh_scheduler_behavior.test.mjs"],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:water-resident-producer", selectorOrder: 5022,
    commandRef: "node --test tests/water_geometry_transport_behavior.test.mjs tests/water_raster_worker_client_behavior.test.mjs tests/water_raster_worker_kernel_behavior.test.mjs tests/scenario_region_overlay_render_owner_behavior.test.mjs",
    sourceRefs: [
      "js/core/map_renderer.js",
      "js/core/water_raster_worker_client.js",
      "js/workers/water_raster.worker.js",
      "js/core/renderer/water_geometry_transport.js",
      "js/core/renderer/water_raster_worker_kernel.js",
      "js/core/renderer/scenario_region_overlay_render_owner.js",
      "tests/water_geometry_transport_behavior.test.mjs",
      "tests/water_raster_worker_client_behavior.test.mjs",
      "tests/water_raster_worker_kernel_behavior.test.mjs",
      "tests/scenario_region_overlay_render_owner_behavior.test.mjs",
      "tools/verify_water_raster_pixels.mjs",
    ],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:tno-scene-paint-bounds", selectorOrder: 5008,
    commandRef: "node --test tests/country_label_render_owner_behavior.test.mjs tests/city_label_owner_behavior.test.mjs tests/static_border_mesh_lifecycle_behavior.test.mjs tests/render_cache_owner_invalidation_behavior.test.mjs tests/urban_city_policy_strategic_values_behavior.test.mjs tests/marine_label_owner_behavior.test.mjs",
    sourceRefs: [
      "js/core/map_renderer.js",
      "js/core/renderer/country_label_render_owner.js",
      "js/core/renderer/city_label_owner.js",
      "js/core/renderer/static_border_mesh_lifecycle.js",
      "js/core/renderer/render_cache_owner.js",
      "js/core/renderer/urban_city_policy.js",
      "js/core/renderer/marine_label_owner.js",
      "tests/country_label_render_owner_behavior.test.mjs",
      "tests/city_label_owner_behavior.test.mjs",
      "tests/static_border_mesh_lifecycle_behavior.test.mjs",
      "tests/render_cache_owner_invalidation_behavior.test.mjs",
      "tests/urban_city_policy_strategic_values_behavior.test.mjs",
      "tests/marine_label_owner_behavior.test.mjs"
],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:gpu-scene-compositor", selectorOrder: 5004,
    commandRef: "node --test tests/gpu_scene_compositor_behavior.test.mjs tests/political_id_raster_gpu_residency_behavior.test.mjs tests/political_id_raster_overview_behavior.test.mjs",
    sourceRefs: [
      "js/core/renderer/gpu_scene_compositor.js",
      "js/core/renderer/political_id_raster_gpu.js",
      "js/core/renderer/political_id_raster_overview.js",
      "tests/gpu_scene_compositor_behavior.test.mjs",
      "tests/political_id_raster_gpu_residency_behavior.test.mjs",
      "tests/political_id_raster_overview_behavior.test.mjs",
      "tools/verify_tno_gpu_pixels.mjs",
    ],
    // This child-safe route verifies the shared GL lifecycle and upload contracts.
    // The localhost pixel harness remains a separately run real-GPU validation.
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:political-id-resident-geometry", selectorOrder: 5005,
    commandRef: "node --test tests/political_id_resident_geometry_behavior.test.mjs",
    sourceRefs: [
      "js/core/renderer/political_id_resident_geometry.js",
      "js/core/political_id_raster_worker_client.js",
      "js/workers/political_id_raster.worker.js",
      "tests/political_id_resident_geometry_behavior.test.mjs",
    ],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:tno-raster-scene-owner", selectorOrder: 5006,
    commandRef: "node --test tests/tno_raster_scene_owner_behavior.test.mjs",
    sourceRefs: [
      "js/core/map_renderer.js",
      "js/core/renderer/tno_raster_scene_owner.js",
      "js/core/renderer/gpu_scene_compositor.js",
      "tests/tno_raster_scene_owner_behavior.test.mjs",
    ],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:tno-raster-scene-profile", selectorOrder: 5007,
    commandRef: "node --test tests/tno_raster_scene_profile_contract.test.mjs tests/tno_native_breadcrumbs.test.mjs",
    sourceRefs: [
      "tools/profile_tno_raster_scene.mjs",
      "tests/tno_raster_scene_profile_contract.test.mjs",
      "tools/tno_native_breadcrumbs.mjs",
      "tests/tno_native_breadcrumbs.test.mjs",
    ],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:political-id-raster-trial", selectorOrder: 5003,
    commandRef: "node --test tests/political_id_raster_trial_behavior.test.mjs",
    sourceRefs: [
      "js/core/renderer/political_id_raster_trial.js",
      "js/ui/toolbar/political_raster_trial_control.js",
      "tests/political_id_raster_trial_behavior.test.mjs",
      "tools/build_political_id_raster_assets.mjs",
      "tools/refresh_political_id_raster_snapshot.py",
      "tools/political_id_raster_app_session.mjs",
      "tools/verify_political_id_raster_integration.mjs",
      "tools/verify_political_raster_resident.mjs",
      "tools/profile_political_raster.mjs",
    ],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:political-id-raster-data", selectorOrder: 5000,
    commandRef: "node --test tests/political_id_raster_source_behavior.test.mjs tests/political_id_raster_cache_behavior.test.mjs tests/political_id_raster_coordinates_behavior.test.mjs tests/political_id_raster_identity_behavior.test.mjs tests/political_id_raster_pick_behavior.test.mjs",
    sourceRefs: [
      "js/core/renderer/political_id_raster_source.js",
      "js/core/renderer/political_id_raster_cache.js",
      "js/core/renderer/political_id_raster_coordinates.js",
      "js/core/renderer/political_id_raster_identity.js",
      "js/core/renderer/political_id_raster_pick.js",
      "tests/political_id_raster_source_behavior.test.mjs",
      "tests/political_id_raster_cache_behavior.test.mjs",
      "tests/political_id_raster_coordinates_behavior.test.mjs",
      "tests/political_id_raster_identity_behavior.test.mjs",
      "tests/political_id_raster_pick_behavior.test.mjs",
    ],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:political-id-raster-build", selectorOrder: 5001,
    commandRef: "node --test tests/political_id_raster_tile_behavior.test.mjs tests/political_id_raster_worker_client_behavior.test.mjs",
    sourceRefs: [
      "js/core/renderer/political_id_raster_tile.js",
      "js/core/political_id_raster_worker_client.js",
      "js/workers/political_id_raster.worker.js",
      "tests/political_id_raster_tile_behavior.test.mjs",
      "tests/political_id_raster_worker_client_behavior.test.mjs",
    ],
  },
  {
    ...politicalIdRasterRoute,
    id: "local:renderer:political-id-raster-runtime", selectorOrder: 5002,
    commandRef: "node --test tests/political_id_raster_display_cache_behavior.test.mjs tests/political_id_raster_runtime_owner_behavior.test.mjs tests/political_id_raster_runtime_assets_behavior.test.mjs tests/political_id_raster_assets_behavior.test.mjs tests/political_id_raster_pilot_behavior.test.mjs tests/political_partial_repaint_owner_behavior.test.mjs tests/political_pass_orchestrator_owner_behavior.test.mjs tests/renderer_political_pass_orchestration_preflight.test.mjs",
    sourceRefs: [
      "js/core/map_renderer.js",
      "js/core/renderer/political_partial_repaint_owner.js",
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_id_raster_runtime_owner.js",
      "js/core/renderer/political_id_raster_display_cache.js",
      "tests/political_id_raster_display_cache_behavior.test.mjs",
      "js/core/renderer/political_id_raster_assets.js",
      "js/core/renderer/political_id_raster_gpu.js",
      "tests/political_id_raster_runtime_owner_behavior.test.mjs",
      "tests/political_id_raster_runtime_assets_behavior.test.mjs",
      "tests/political_id_raster_assets_behavior.test.mjs",
      "tests/political_id_raster_pilot_behavior.test.mjs",
      "tests/political_partial_repaint_owner_behavior.test.mjs",
      "tests/political_pass_orchestrator_owner_behavior.test.mjs",
      "tests/renderer_political_pass_orchestration_preflight.test.mjs",
      "tools/prototypes/political-id-raster",
    ],
    // These routes cover source/coverage and main-app producer gating. Real Canvas/WebGL pixels and
    // timing still require the standalone browser harness described in README.
  },
  {
    "id": "node:test:node:exact-after-settle-pass-catalog",
    "commandRef": "test:node:exact-after-settle-pass-catalog",
    "sourceRefs": [
      "tests/exact_after_settle_pass_catalog_behavior.test.mjs",
      "js/core/map_renderer/exact_after_settle_refresh_plans.js",
      "js/core/map_renderer/render_pass_catalog.js",
      "js/core/renderer/exact_after_settle_pass_catalog.js",
      "js/core/renderer/render_pipeline_catalog.js",
      "js/core/renderer/render_pipeline_passes.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 228,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:exact-after-settle-refresh-plans",
    "commandRef": "test:node:exact-after-settle-refresh-plans",
    "sourceRefs": [
      "tests/exact_after_settle_refresh_plans_behavior.test.mjs",
      "js/core/map_renderer/exact_after_settle_refresh_plans.js",
      "js/core/renderer/exact_after_settle_pass_catalog.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 227,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-cache-owner",
    "commandRef": "test:node:render-cache-owner",
    "sourceRefs": [
      "tests/render_cache_owner_invalidation_behavior.test.mjs",
      "js/core/map_renderer/render_pass_catalog.js",
      "js/core/renderer/render_cache_owner.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 307,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-invalidation-catalog",
    "commandRef": "test:node:render-invalidation-catalog",
    "sourceRefs": [
      "tests/render_invalidation_catalog_behavior.test.mjs",
      "js/core/map_renderer/render_invalidation_catalog.js",
      "js/core/map_renderer/render_pass_catalog.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 319,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-pass-cache-host-owner",
    "commandRef": "test:node:render-pass-cache-host-owner",
    "sourceRefs": [
      "tests/render_pass_cache_host_owner_behavior.test.mjs",
      "js/core/map_renderer/render_pass_cache_host_owner.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 270,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-pass-cache-host-owner-inventory",
    "commandRef": "test:node:render-pass-cache-host-owner-inventory",
    "sourceRefs": [
      "tests/render_pass_cache_host_owner_inventory.test.mjs"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 271,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-pass-cache-host-owner-suite",
    "commandRef": "test:node:render-pass-cache-host-owner-suite",
    "sourceRefs": [
      "tests/render_pass_cache_host_owner_behavior.test.mjs",
      "tests/render_pass_cache_host_owner_inventory.test.mjs",
      "tests/renderer_render_pass_cache_host_inventory_boundary.test.mjs",
      "js/core/map_renderer/render_pass_cache_host_owner.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 272,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-pass-catalog",
    "commandRef": "test:node:render-pass-catalog",
    "sourceRefs": [
      "tests/render_pass_catalog_behavior.test.mjs",
      "js/core/map_renderer/render_pass_catalog.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 317,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-pass-commit-accounting-inventory",
    "commandRef": "test:node:render-pass-commit-accounting-inventory",
    "sourceRefs": [
      "tests/render_pass_commit_accounting_owner_inventory.test.mjs"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 274,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-pass-commit-accounting-owner",
    "commandRef": "test:node:render-pass-commit-accounting-owner",
    "sourceRefs": [
      "tests/render_pass_commit_accounting_owner_behavior.test.mjs",
      "js/core/map_renderer/render_pass_commit_accounting_owner.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 273,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-pass-commit-accounting-owner-suite",
    "commandRef": "test:node:render-pass-commit-accounting-owner-suite",
    "sourceRefs": [
      "tests/render_pass_commit_accounting_owner_behavior.test.mjs",
      "tests/render_pass_commit_accounting_owner_inventory.test.mjs",
      "js/core/map_renderer/render_pass_commit_accounting_owner.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 275,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-pipeline-catalog",
    "commandRef": "test:node:render-pipeline-catalog",
    "sourceRefs": [
      "tests/render_pipeline_catalog_behavior.test.mjs",
      "js/core/map_renderer/render_pass_catalog.js",
      "js/core/renderer/render_pipeline_catalog.js",
      "js/core/renderer/render_pipeline_passes.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 318,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-transform-reuse-policy-owner",
    "commandRef": "test:node:render-transform-reuse-policy-owner",
    "sourceRefs": [
      "tests/render_transform_reuse_policy_owner_behavior.test.mjs",
      "js/core/renderer/render_transform_reuse_policy_owner.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 308,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-render-pass-cache-host-inventory",
    "commandRef": "test:node:renderer-render-pass-cache-host-inventory",
    "sourceRefs": [
      "tests/renderer_render_pass_cache_host_inventory_boundary.test.mjs"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 269,
    "verification": null,
    "selector": {}
  },
  {
    "id": "verify-core:test:node:render-cache-owner",
    "commandRef": "test:node:render-cache-owner",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 110,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "renderer-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:render-pass-cache-host-owner-suite",
    "commandRef": "test:node:render-pass-cache-host-owner-suite",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 104,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "renderer-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:render-pass-catalog",
    "commandRef": "test:node:render-pass-catalog",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 99,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "renderer-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:render-pass-commit-accounting-owner-suite",
    "commandRef": "test:node:render-pass-commit-accounting-owner-suite",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 105,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "renderer-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:render-pipeline-catalog",
    "commandRef": "test:node:render-pipeline-catalog",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 100,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "renderer-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:render-transform-reuse-policy-owner",
    "commandRef": "test:node:render-transform-reuse-policy-owner",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 111,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "renderer-runtime"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:python:map-renderer-render-cache-owner-boundary",
    "commandRef": "test:python:map-renderer-render-cache-owner-boundary",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/render_cache_owner.js",
      "js/core/renderer/render_cache_surface_resources.js",
      "tests/test_map_renderer_render_cache_owner_boundary_contract.py",
      "docs/active/renderer-runtime-context-render-cache-read-model-p1-2-20260709.md",
      "package.json"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 69,
    "selectorOrder": 56,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "renderer-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:test:python:map-renderer-render-pipeline-passes-boundary",
    "commandRef": "test:python:map-renderer-render-pipeline-passes-boundary",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/visual_effects_pass_owner.js",
      "js/core/renderer/context_pass_orchestrator_owner.js",
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "tests/test_map_renderer_render_pipeline_passes_boundary_contract.py",
      "tests/test_map_renderer_strategic_values_render_contract.py",
      "tools/check_architecture_boundaries.mjs",
      "package.json"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 65,
    "selectorOrder": 52,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "renderer-runtime",
      "routeRegistry": true
    },
    "selector": {}
  }
];
