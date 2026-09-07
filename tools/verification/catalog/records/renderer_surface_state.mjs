// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const RENDERER_SURFACE_STATE_RECORDS = [
  {
    "id": "node:test:node:canvas-layer-manager",
    "commandRef": "test:node:canvas-layer-manager",
    "sourceRefs": [
      "tests/canvas_layer_manager_behavior.test.mjs",
      "js/core/map_renderer/canvas_layer_manager.js"
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
    "selectorOrder": 325,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:main-runtime-diagnostics",
    "commandRef": "test:node:main-runtime-diagnostics",
    "sourceRefs": [
      "tests/main_runtime_diagnostics_behavior.test.mjs",
      "tests/main_runtime_diagnostics_boundary.test.mjs",
      "js/bootstrap/main_runtime_diagnostics.js"
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
    "selectorOrder": 181,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-transaction-diagnostics",
    "commandRef": "test:node:render-transaction-diagnostics",
    "sourceRefs": [
      "tests/render_transaction_diagnostics_behavior.test.mjs",
      "js/core/renderer/render_transaction_diagnostics.js"
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
    "selectorOrder": 322,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-host-inventory",
    "commandRef": "test:node:renderer-host-inventory",
    "sourceRefs": [
      "tests/renderer_host_inventory_boundary.test.mjs"
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
    "selectorOrder": 243,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-render-lifecycle-inventory",
    "commandRef": "test:node:renderer-render-lifecycle-inventory",
    "sourceRefs": [
      "tests/renderer_render_lifecycle_inventory_boundary.test.mjs"
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
    "selectorOrder": 268,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-render-phase-lifecycle",
    "commandRef": "test:node:renderer-render-phase-lifecycle",
    "sourceRefs": [
      "tests/renderer_render_phase_lifecycle_owner_behavior.test.mjs",
      "tests/renderer_render_phase_lifecycle_inventory.test.mjs",
      "js/core/map_renderer/render_phase_lifecycle_owner.js"
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
    "selectorOrder": 296,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-render-phase-lifecycle-inventory",
    "commandRef": "test:node:renderer-render-phase-lifecycle-inventory",
    "sourceRefs": [
      "tests/renderer_render_phase_lifecycle_inventory.test.mjs"
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
    "selectorOrder": 295,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-render-phase-lifecycle-owner",
    "commandRef": "test:node:renderer-render-phase-lifecycle-owner",
    "sourceRefs": [
      "tests/renderer_render_phase_lifecycle_owner_behavior.test.mjs",
      "js/core/map_renderer/render_phase_lifecycle_owner.js"
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
    "selectorOrder": 294,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-render-request-boundary",
    "commandRef": "test:node:renderer-render-request-boundary",
    "sourceRefs": [
      "tests/renderer_render_request_boundary_owner_behavior.test.mjs",
      "tests/renderer_render_request_boundary_inventory.test.mjs",
      "js/core/map_renderer/render_request_boundary_owner.js"
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
    "selectorOrder": 293,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-render-request-boundary-inventory",
    "commandRef": "test:node:renderer-render-request-boundary-inventory",
    "sourceRefs": [
      "tests/renderer_render_request_boundary_inventory.test.mjs"
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
    "selectorOrder": 292,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-render-request-boundary-owner",
    "commandRef": "test:node:renderer-render-request-boundary-owner",
    "sourceRefs": [
      "tests/renderer_render_request_boundary_owner_behavior.test.mjs",
      "js/core/map_renderer/render_request_boundary_owner.js"
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
    "selectorOrder": 291,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-runtime-state-behavior",
    "commandRef": "test:node:renderer-runtime-state-behavior",
    "sourceRefs": [
      "tests/renderer_runtime_state_behavior.test.mjs",
      "js/core/renderer/spatial_index_runtime_builders.js",
      "js/core/renderer/spatial_index_runtime_derivation.js",
      "js/core/renderer/spatial_index_runtime_state_ops.js",
      "js/core/state/actions/renderer_exact_refresh_actions.js",
      "js/core/state/border_cache_state.js",
      "js/core/state/renderer_runtime_state.js",
      "js/core/state/spatial_index_state.js",
      "js/core/state/ui_state.js",
      "js/core/transport_capability_registry.js"
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
    "selectorOrder": 321,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-set-map-data-transaction",
    "commandRef": "test:node:renderer-set-map-data-transaction",
    "sourceRefs": [
      "tests/renderer_set_map_data_transaction_owner_behavior.test.mjs",
      "tests/renderer_set_map_data_transaction_inventory_boundary.test.mjs",
      "js/core/map_renderer/set_map_data_transaction_owner.js"
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
    "selectorOrder": 264,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-set-map-data-transaction-inventory",
    "commandRef": "test:node:renderer-set-map-data-transaction-inventory",
    "sourceRefs": [
      "tests/renderer_set_map_data_transaction_inventory_boundary.test.mjs"
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
    "selectorOrder": 263,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-set-map-data-transaction-owner",
    "commandRef": "test:node:renderer-set-map-data-transaction-owner",
    "sourceRefs": [
      "tests/renderer_set_map_data_transaction_owner_behavior.test.mjs",
      "js/core/map_renderer/set_map_data_transaction_owner.js"
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
    "selectorOrder": 262,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-surface-host",
    "commandRef": "test:node:renderer-surface-host",
    "sourceRefs": [
      "docs/active/renderer-cohesive-splits-20260907/context.md",
      "docs/active/renderer-cohesive-splits-20260907/plan.md",
      "docs/active/renderer-cohesive-splits-20260907/task.md",
      "js/core/map_renderer.js",
      "js/core/renderer/city_paint_style_model.js",
      "js/core/renderer/city_label_owner.js",
      "tests/renderer_surface_host_behavior.test.mjs",
      "tests/renderer_surface_host_inventory_boundary.test.mjs",
      "js/core/renderer/renderer_surface_host.js"
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
    "selectorOrder": 244,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-surface-host-inventory",
    "commandRef": "test:node:renderer-surface-host-inventory",
    "sourceRefs": [
      "tests/renderer_surface_host_inventory_boundary.test.mjs",
      "js/core/renderer/renderer_surface_host.js"
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
    "selectorOrder": 245,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-surface-lifecycle",
    "commandRef": "test:node:renderer-surface-lifecycle",
    "sourceRefs": [
      "tests/renderer_surface_lifecycle_owner_behavior.test.mjs",
      "tests/renderer_surface_lifecycle_inventory_boundary.test.mjs",
      "js/core/map_renderer/canvas_layer_manager.js",
      "js/core/renderer/renderer_surface_lifecycle_owner.js"
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
    "selectorOrder": 249,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-surface-lifecycle-inventory",
    "commandRef": "test:node:renderer-surface-lifecycle-inventory",
    "sourceRefs": [
      "tests/renderer_surface_lifecycle_inventory_boundary.test.mjs"
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
    "selectorOrder": 247,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-surface-lifecycle-owner",
    "commandRef": "test:node:renderer-surface-lifecycle-owner",
    "sourceRefs": [
      "tests/renderer_surface_lifecycle_owner_behavior.test.mjs",
      "js/core/map_renderer/canvas_layer_manager.js",
      "js/core/renderer/renderer_surface_lifecycle_owner.js"
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
    "selectorOrder": 248,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-surface-runtime-bridge-state",
    "commandRef": "test:node:renderer-surface-runtime-bridge-state",
    "sourceRefs": [
      "tests/renderer_surface_runtime_bridge_state_behavior.test.mjs",
      "js/core/state/renderer_runtime_state.js"
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
    "selectorOrder": 246,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-svg-surface-lifecycle",
    "commandRef": "test:node:renderer-svg-surface-lifecycle",
    "sourceRefs": [
      "tests/renderer_svg_surface_lifecycle_owner_behavior.test.mjs",
      "tests/renderer_svg_surface_lifecycle_inventory_boundary.test.mjs",
      "js/core/renderer/renderer_svg_surface_lifecycle_owner.js"
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
    "selectorOrder": 255,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-svg-surface-lifecycle-inventory",
    "commandRef": "test:node:renderer-svg-surface-lifecycle-inventory",
    "sourceRefs": [
      "tests/renderer_svg_surface_lifecycle_inventory_boundary.test.mjs"
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
    "selectorOrder": 254,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-svg-surface-lifecycle-owner",
    "commandRef": "test:node:renderer-svg-surface-lifecycle-owner",
    "sourceRefs": [
      "tests/renderer_svg_surface_lifecycle_owner_behavior.test.mjs",
      "js/core/renderer/renderer_svg_surface_lifecycle_owner.js"
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
    "selectorOrder": 253,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-transaction-reset",
    "commandRef": "test:node:renderer-transaction-reset",
    "sourceRefs": [
      "tests/renderer_transaction_reset_owner_behavior.test.mjs",
      "tests/renderer_transaction_reset_hardening_inventory_boundary.test.mjs",
      "js/core/map_renderer/renderer_transaction_reset_owner.js"
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
    "selectorOrder": 267,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-transaction-reset-hardening-inventory",
    "commandRef": "test:node:renderer-transaction-reset-hardening-inventory",
    "sourceRefs": [
      "tests/renderer_transaction_reset_hardening_inventory_boundary.test.mjs"
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
    "selectorOrder": 266,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-transaction-reset-owner",
    "commandRef": "test:node:renderer-transaction-reset-owner",
    "sourceRefs": [
      "tests/renderer_transaction_reset_owner_behavior.test.mjs",
      "js/core/map_renderer/renderer_transaction_reset_owner.js"
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
    "selectorOrder": 265,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:visible-frame-diagnostics",
    "commandRef": "test:node:visible-frame-diagnostics",
    "sourceRefs": [
      "tests/visible_frame_diagnostics_owner_behavior.test.mjs",
      "tests/visible_frame_diagnostics_owner_inventory.test.mjs",
      "js/core/renderer/visible_frame_diagnostics_owner.js"
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
    "selectorOrder": 306,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:visible-frame-diagnostics-inventory",
    "commandRef": "test:node:visible-frame-diagnostics-inventory",
    "sourceRefs": [
      "tests/visible_frame_diagnostics_owner_inventory.test.mjs"
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
    "selectorOrder": 305,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:visible-frame-diagnostics-owner",
    "commandRef": "test:node:visible-frame-diagnostics-owner",
    "sourceRefs": [
      "tests/visible_frame_diagnostics_owner_behavior.test.mjs",
      "js/core/renderer/visible_frame_diagnostics_owner.js"
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
    "selectorOrder": 304,
    "verification": null,
    "selector": {}
  },
  {
    "id": "verify-core:test:node:renderer-render-phase-lifecycle",
    "commandRef": "test:node:renderer-render-phase-lifecycle",
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
    "verificationOrder": 102,
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
    "id": "verify-core:test:node:renderer-render-request-boundary",
    "commandRef": "test:node:renderer-render-request-boundary",
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
    "verificationOrder": 101,
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
    "id": "verify-core:test:node:visible-frame-diagnostics",
    "commandRef": "test:node:visible-frame-diagnostics",
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
    "verificationOrder": 109,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "renderer-runtime"
    },
    "selector": null
  }
];
