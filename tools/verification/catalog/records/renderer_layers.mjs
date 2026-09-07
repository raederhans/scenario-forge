// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const RENDERER_LAYERS_RECORDS = [
  {
    "id": "node:test:node:political-partial-repaint-owner",
    "commandRef": "test:node:political-partial-repaint-owner",
    "sourceRefs": [
      "js/core/renderer/political_partial_repaint_owner.js",
      "tests/political_partial_repaint_owner_behavior.test.mjs"
    ],
    "ownerHints": ["renderer-runtime"],
    "domains": ["renderer-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": null,
    "selectorOrder": null,
    "verification": null,
    "selector": {}
  },
  {
    "id": "verify-core:test:node:political-partial-repaint-owner",
    "commandRef": "test:node:political-partial-repaint-owner",
    "sourceRefs": [
      "js/core/renderer/political_partial_repaint_owner.js",
      "package.json",
      "tests/political_partial_repaint_owner_behavior.test.mjs"
    ],
    "ownerHints": ["renderer-runtime"],
    "domains": ["renderer-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": null,
    "selectorOrder": null,
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
    "id": "verify-core:test:python:map-renderer-political-partial-repaint-owner-boundary",
    "commandRef": "test:python:map-renderer-political-partial-repaint-owner-boundary",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/political_partial_repaint_owner.js",
      "package.json",
      "tests/test_map_renderer_political_partial_repaint_owner_boundary_contract.py",
      "tools/check_architecture_boundaries.mjs",
      "tools/renderer_pass_family_inventory.mjs"
    ],
    "ownerHints": ["renderer-runtime"],
    "domains": ["renderer-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": null,
    "selectorOrder": null,
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
    "id": "node:test:node:political-background-render-owner",
    "commandRef": "test:node:political-background-render-owner",
    "sourceRefs": [
      "js/core/renderer/political_background_render_owner.js",
      "tests/political_background_render_owner_behavior.test.mjs"
    ],
    "ownerHints": ["renderer-runtime"],
    "domains": ["renderer-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": null,
    "selectorOrder": null,
    "verification": null,
    "selector": {}
  },
  {
    "id": "verify-core:test:node:political-background-render-owner",
    "commandRef": "test:node:political-background-render-owner",
    "sourceRefs": [
      "js/core/renderer/political_background_render_owner.js",
      "package.json",
      "tests/political_background_render_owner_behavior.test.mjs"
    ],
    "ownerHints": ["renderer-runtime"],
    "domains": ["renderer-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": null,
    "selectorOrder": null,
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
    "id": "verify-core:test:python:map-renderer-political-background-render-owner-boundary",
    "commandRef": "test:python:map-renderer-political-background-render-owner-boundary",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/political_background_render_owner.js",
      "package.json",
      "tests/test_map_renderer_political_background_render_owner_boundary_contract.py",
      "tools/check_architecture_boundaries.mjs",
      "tools/renderer_pass_family_inventory.mjs"
    ],
    "ownerHints": ["renderer-runtime"],
    "domains": ["renderer-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": null,
    "selectorOrder": null,
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
    "id": "node:test:node:appearance-border-owner",
    "commandRef": "test:node:appearance-border-owner",
    "sourceRefs": [
      "tests/appearance_border_owner_behavior.test.mjs",
      "js/ui/toolbar/appearance_border_owner.js"
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
    "selectorOrder": 167,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:appearance-parent-border-owner",
    "commandRef": "test:node:appearance-parent-border-owner",
    "sourceRefs": [
      "tests/appearance_parent_border_owner_behavior.test.mjs",
      "js/ui/toolbar/appearance_parent_border_owner.js"
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
    "selectorOrder": 168,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:appearance-rivers-owner",
    "commandRef": "test:node:appearance-rivers-owner",
    "sourceRefs": [
      "tests/appearance_rivers_owner_behavior.test.mjs",
      "js/ui/toolbar/appearance_rivers_owner.js"
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
    "selectorOrder": 173,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:border-draw-owner-behavior",
    "commandRef": "test:node:border-draw-owner-behavior",
    "sourceRefs": [
      "tests/border_draw_owner_behavior.test.mjs",
      "js/core/renderer/border_draw_owner.js"
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
    "selectorOrder": 323,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:border-mesh-owner-behavior",
    "commandRef": "test:node:border-mesh-owner-behavior",
    "sourceRefs": [
      "tests/border_mesh_owner_behavior.test.mjs",
      "js/core/renderer/border_mesh_owner.js"
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
    "selectorOrder": 324,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:hgo-identity-resolver",
    "commandRef": "test:node:hgo-identity-resolver",
    "sourceRefs": [
      "tests/hgo_identity_resolver.node.test.mjs",
      "js/core/hgo_identity_resolver.js"
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
    "selectorOrder": 232,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:hgo-projection-model",
    "commandRef": "test:node:hgo-projection-model",
    "sourceRefs": [
      "tests/hgo_projection_model.node.test.mjs",
      "js/core/hgo_projection_model.js"
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
    "selectorOrder": 234,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:hgo-raster-renderer",
    "commandRef": "test:node:hgo-raster-renderer",
    "sourceRefs": [
      "tests/hgo_raster_renderer.node.test.mjs",
      "js/core/hgo_raster_renderer.js",
      "js/core/hgo_runtime_asset_loader.js"
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
    "selectorOrder": 235,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:hgo-runtime-index",
    "commandRef": "test:node:hgo-runtime-index",
    "sourceRefs": [
      "tests/hgo_runtime_index.node.test.mjs",
      "js/core/hgo_runtime_index.js"
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
    "selectorOrder": 233,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:hgo-runtime-preview",
    "commandRef": "test:node:hgo-runtime-preview",
    "sourceRefs": [
      "tests/hgo_runtime_preview.node.test.mjs",
      "tests/hgo_runtime_preview_toolbar.node.test.mjs",
      "js/core/hgo_runtime_preview.js",
      "js/core/map_renderer/hgo_runtime_preview_frame_commit.js",
      "js/core/map_renderer/hgo_runtime_preview_render_owner.js",
      "js/ui/toolbar/hgo_runtime_preview_controller.js"
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
    "selectorOrder": 236,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:intensity-field",
    "commandRef": "test:node:intensity-field",
    "sourceRefs": [
      "tests/intensity_field.node.test.mjs",
      "js/core/intensity_field.js",
      "js/core/state/intensity_field_state.js"
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
    "selectorOrder": 161,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:intensity-field-mask",
    "commandRef": "test:node:intensity-field-mask",
    "sourceRefs": [
      "tests/intensity_field_mask_owner.node.test.mjs",
      "js/core/renderer/intensity_field_mask_owner.js",
      "js/core/state.js"
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
    "selectorOrder": 162,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:layer-panel-contracts",
    "commandRef": "test:node:layer-panel-contracts",
    "sourceRefs": [
      "tests/layer_panel_contracts_behavior.test.mjs",
      "data/thematic_layers/index.json",
      "js/core/state/content_state.js",
      "js/core/state/ui_state.js",
      "js/core/transport_capability_registry.js",
      "js/ui/toolbar/layer_panel_contracts.js",
      "js/ui/toolbar/layer_status_diagnostics.js"
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
    "selectorOrder": 175,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:layer-status-diagnostics",
    "commandRef": "test:node:layer-status-diagnostics",
    "sourceRefs": [
      "tests/layer_status_diagnostics_behavior.test.mjs",
      "js/core/state/content_state.js",
      "js/core/state/ui_state.js",
      "js/core/thematic_layer_catalog.js",
      "js/ui/toolbar/layer_status_diagnostics.js"
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
    "selectorOrder": 176,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:legend-generation",
    "commandRef": "test:node:legend-generation",
    "sourceRefs": [
      "tests/legend_manager_generation_behavior.test.mjs",
      "js/core/legend_manager.js",
      "js/core/state.js"
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
    "selectorOrder": 240,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:ocean-depth-layer-contracts",
    "commandRef": "test:node:ocean-depth-layer-contracts",
    "sourceRefs": [
      "tests/ocean_depth_layer_contracts.test.mjs",
      "js/core/renderer/political_background_render_owner.js"
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
    "selectorOrder": 163,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:ocean-render-owner",
    "commandRef": "test:node:ocean-render-owner",
    "sourceRefs": [
      "tests/ocean_render_owner_behavior.test.mjs",
      "js/core/renderer/ocean_render_owner.js"
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
    "selectorOrder": 164,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:political-collection-fragment-camouflage",
    "commandRef": "test:node:political-collection-fragment-camouflage",
    "sourceRefs": [
      "tests/political_collection_fragment_camouflage_behavior.test.mjs",
      "data/europe_topology.runtime_political_v1.political.geojson",
      "js/core/country_feature_policies.js",
      "js/core/renderer/political_collection_owner.js",
      "vendor/d3.v7.min.js"
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
    "selectorOrder": 241,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:political-pass-orchestrator-owner",
    "commandRef": "test:node:political-pass-orchestrator-owner",
    "sourceRefs": [
      "tests/political_pass_orchestrator_owner_behavior.test.mjs",
      "js/core/renderer/political_pass_orchestrator_owner.js"
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
    "selectorOrder": 345,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:political-pass-orchestrator-owner-suite",
    "commandRef": "test:node:political-pass-orchestrator-owner-suite",
    "sourceRefs": [
      "tests/political_pass_orchestrator_owner_behavior.test.mjs",
      "tests/renderer_political_pass_orchestration_preflight.test.mjs",
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "tools/renderer_pass_family_inventory.mjs"
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
    "selectorOrder": 346,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:political-raster-worker-packet",
    "commandRef": "test:node:political-raster-worker-packet",
    "sourceRefs": [
      "tests/political_raster_worker_packet_behavior.test.mjs",
      "js/core/map_renderer/political_raster_worker_packet.js",
      "js/workers/political_raster.worker.js"
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
    "selectorOrder": 326,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-political-pass-orchestration-preflight",
    "commandRef": "test:node:renderer-political-pass-orchestration-preflight",
    "sourceRefs": [
      "tests/renderer_political_pass_orchestration_preflight.test.mjs",
      "tools/renderer_pass_family_inventory.mjs"
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
    "selectorOrder": 344,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:river-layer-contracts",
    "commandRef": "test:node:river-layer-contracts",
    "sourceRefs": [
      "tests/river_layer_contracts.test.mjs"
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
    "selectorOrder": 332,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:river-layer-owner",
    "commandRef": "test:node:river-layer-owner",
    "sourceRefs": [
      "tests/river_layer_render_owner_behavior.test.mjs",
      "js/core/renderer/river_layer_render_owner.js"
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
    "selectorOrder": 333,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:strategic-overlay-runtime-owner",
    "commandRef": "test:node:strategic-overlay-runtime-owner",
    "sourceRefs": [
      "tests/strategic_overlay_runtime_owner_behavior.test.mjs",
      "js/core/renderer/strategic_overlay_runtime_owner.js"
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
    "selectorOrder": 314,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-facility-render-owner",
    "commandRef": "test:node:transport-facility-render-owner",
    "sourceRefs": [
      "tests/transport_facility_render_owner_behavior.test.mjs",
      "data/transport_layers/global_airport/airports.geojson",
      "data/transport_layers/global_port/ports.geojson",
      "js/core/renderer/transport_facility_display_policy.js",
      "js/core/renderer/transport_facility_icons.js",
      "js/core/renderer/transport_overview_render_owner.js"
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
    "selectorOrder": 191,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:visual-effects-pass-owner",
    "commandRef": "test:node:visual-effects-pass-owner",
    "sourceRefs": [
      "tests/visual_effects_pass_owner_behavior.test.mjs",
      "js/core/renderer/visual_effects_pass_owner.js"
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
    "selectorOrder": 342,
    "verification": null,
    "selector": {}
  },
  {
    "id": "p3:political-pass:collection-fragment-camouflage",
    "commandRef": "test:node:political-collection-fragment-camouflage",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_collection_owner.js",
      "js/core/country_feature_policies.js",
      "tests/political_collection_fragment_camouflage_behavior.test.mjs"
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
    "verificationOrder": 49,
    "selectorOrder": 36,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "renderer-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:political-pass:progressive-recovery",
    "commandRef": "test:e2e:dev:political-progressive-recovery",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 50,
    "selectorOrder": 37,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "renderer-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:political-pass:worker-packet",
    "commandRef": "test:node:political-raster-worker-packet",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js",
      "js/core/map_renderer/political_raster_worker_packet.js",
      "tests/political_raster_worker_packet_behavior.test.mjs"
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
    "verificationOrder": 48,
    "selectorOrder": 35,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "renderer-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:visual-effects:layer-regression",
    "commandRef": "test:e2e:layer:regression",
    "sourceRefs": [
      "js/core/renderer/visual_effects_pass_owner.js"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
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
    "verificationOrder": 59,
    "selectorOrder": 46,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "renderer-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "python:tests.test_map_renderer_interaction_border_snapshot_orchestration_contract",
    "commandRef": "python -m unittest tests.test_map_renderer_interaction_border_snapshot_orchestration_contract -q",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/map_renderer/transformed_frame_compositor_owner.js",
      "js/core/renderer/render_cache_owner.js",
      "js/core/renderer/zoom_interaction_lifecycle_owner.js",
      "tests/test_map_renderer_interaction_border_snapshot_orchestration_contract.py"
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
    "selectorOrder": 358,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python:tests.test_map_renderer_strategic_overlay_render_owner_boundary_contract",
    "commandRef": "python -m unittest tests.test_map_renderer_strategic_overlay_render_owner_boundary_contract -q",
    "sourceRefs": [
      "tests/test_map_renderer_strategic_overlay_render_owner_boundary_contract.py",
      "js/core/map_renderer.js",
      "js/core/renderer/strategic_overlay_render_owner.js",
      "js/core/renderer/strategic_overlay_runtime/unit_counter_runtime_domain.js"
    ],
    "ownerHints": [
      "strategic-overlay-render-owner"
    ],
    "domains": [
      "renderer-runtime"
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
    "selectorOrder": 355,
    "verification": null,
    "selector": {}
  },
  {
    "id": "verify-core:test:node:city-points-render-owner",
    "commandRef": "test:node:city-points-render-owner",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/city_points_render_owner.js",
      "js/core/renderer/urban_city_policy.js",
      "tests/city_points_render_owner_behavior.test.mjs",
      "tests/urban_city_policy_strategic_values_behavior.test.mjs",
      "package.json"
    ],
    "ownerHints": [
      "renderer-runtime"
    ],
    "domains": [
      "renderer-runtime"
    ],
    "tiers": [
      "regression"
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
    "verificationOrder": 92,
    "selectorOrder": 79,
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
    "id": "verify-core:test:node:political-pass-orchestrator-owner",
    "commandRef": "test:node:political-pass-orchestrator-owner",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js",
      "tests/political_pass_orchestrator_owner_behavior.test.mjs",
      "docs/active/renderer-political-pass-orchestrator-owner-p3-3b-20260714.md",
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
    "verificationOrder": 45,
    "selectorOrder": 32,
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
    "id": "verify-core:test:node:renderer-political-pass-orchestration-preflight",
    "commandRef": "test:node:renderer-political-pass-orchestration-preflight",
    "sourceRefs": [
      "js/core",
      "tests/renderer_political_pass_orchestration_preflight.test.mjs",
      "docs/active/renderer-political-pass-preflight-p3-3a-20260714.md",
      "tools/renderer_pass_family_inventory.mjs",
      "tests/renderer_pass_family_inventory_behavior.test.mjs",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "tests/test_map_renderer_render_pipeline_passes_boundary_contract.py",
      "tools/eslint-rules/state-writer-allowlist.json",
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
    "verificationOrder": 44,
    "selectorOrder": 31,
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
    "id": "verify-core:test:node:visual-effects-pass-owner",
    "commandRef": "test:node:visual-effects-pass-owner",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/visual_effects_pass_owner.js",
      "tests/visual_effects_pass_owner_behavior.test.mjs",
      "tools/renderer_pass_family_inventory.mjs",
      "tests/renderer_pass_family_inventory_behavior.test.mjs",
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
    "verificationOrder": 42,
    "selectorOrder": 29,
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
    "id": "verify-core:test:python:map-renderer-city-points-boundary",
    "commandRef": "test:python:map-renderer-city-points-boundary",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/city_points_render_owner.js",
      "js/core/renderer/city_label_owner.js",
      "js/core/renderer/city_paint_style_model.js",
      "js/core/renderer/urban_city_policy.js",
      "tests/test_map_renderer_urban_city_policy_boundary_contract.py",
      "tests/test_map_renderer_city_label_owner_boundary_contract.py",
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
    "verificationOrder": 93,
    "selectorOrder": 80,
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
    "id": "verify-core:test:python:map-renderer-political-pass-orchestrator-boundary",
    "commandRef": "test:python:map-renderer-political-pass-orchestrator-boundary",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/map_renderer/public.js",
      "tools/eslint-rules/state-writer-allowlist.json",
      "tools/check_architecture_boundaries.mjs",
      "tools/renderer_pass_family_inventory.mjs",
      "tests/test_map_renderer_political_pass_orchestrator_boundary_contract.py",
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
    "verificationOrder": 46,
    "selectorOrder": 33,
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
    "id": "node:test:node:day-night-runtime-owner",
    "commandRef": "test:node:day-night-runtime-owner",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/day_night_runtime_owner.js",
      "js/core/renderer/visual_effects_pass_owner.js",
      "js/core/state_defaults.js",
      "js/core/state/actions/renderer_phase_actions.js",
      "tests/day_night_runtime_owner_behavior.test.mjs",
      "tests/visual_effects_pass_owner_behavior.test.mjs",
      "package.json"
    ],
    "ownerHints": ["renderer-runtime"],
    "domains": ["renderer-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 129,
    "selectorOrder": 380,
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
    "id": "verify-core:test:python:day-night-runtime-owner-boundary",
    "commandRef": "test:python:day-night-runtime-owner-boundary",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/day_night_runtime_owner.js",
      "js/core/renderer/visual_effects_pass_owner.js",
      "js/core/state/actions/renderer_phase_actions.js",
      "tests/test_day_night_runtime_owner_boundary_contract.py",
      "tests/test_map_renderer_render_pipeline_passes_boundary_contract.py",
      "package.json"
    ],
    "ownerHints": ["renderer-runtime"],
    "domains": ["renderer-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 130,
    "selectorOrder": 381,
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
