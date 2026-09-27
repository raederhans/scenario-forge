// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const RENDERER_UI_BOOTSTRAP_RECORDS = [
  {
    "id": "node:test:node:annotation-productization",
    "commandRef": "test:node:annotation-productization",
    "sourceRefs": [
      "tests/file_manager_project_roundtrip_behavior.test.mjs",
      "tests/export_workbench_state_behavior.test.mjs",
      "tests/strategic_overlay_runtime_owner_behavior.test.mjs",
      "js/core/file_manager.js",
      "js/core/intensity_field.js",
      "js/core/interaction_funnel.js",
      "js/core/project_package_io.js",
      "js/core/state.js",
      "js/core/state/appearance_preset_state.js",
      "js/core/state/index.js",
      "js/core/state/intensity_field_state.js",
      "js/core/transport_capability_registry.js",
      "vendor/fflate.browser.js",
      "js/core/export_artifact_package.js",
      "js/core/state/ui_state.js",
      "js/core/state_defaults.js",
      "js/ui/toolbar/export_artifact_model.js",
      "js/ui/toolbar/export_failure_handler.js",
      "js/ui/toolbar/export_workbench_controller.js",
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
    "selectorOrder": 218,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:appearance-presets",
    "commandRef": "test:node:appearance-presets",
    "sourceRefs": [
      "tests/appearance_preset_state.node.test.mjs",
      "tests/appearance_presets_owner_behavior.test.mjs",
      "tests/appearance_preset_history.node.test.mjs",
      "js/core/state.js",
      "js/core/state/actions/appearance_preset_actions.js",
      "js/ui/toolbar/appearance_presets_owner.js",
      "js/core/history_manager.js",
      "js/core/special_zone_layers.js",
      "js/core/state/ui_state.js"
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
    "selectorOrder": 170,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:appearance-reference-owner",
    "commandRef": "test:node:appearance-reference-owner",
    "sourceRefs": [
      "tests/appearance_reference_owner_behavior.test.mjs",
      "js/ui/toolbar/appearance_reference_owner.js"
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
    "selectorOrder": 172,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:appearance-texture-owner",
    "commandRef": "test:node:appearance-texture-owner",
    "sourceRefs": [
      "tests/appearance_texture_owner_behavior.test.mjs",
      "js/core/state.js",
      "js/ui/toolbar/appearance_texture_owner.js"
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
    "selectorOrder": 174,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:country-inspector-controller",
    "commandRef": "test:node:country-inspector-controller",
    "sourceRefs": [
      "tests/country_inspector_controller_behavior.test.mjs",
      "js/core/i18n_catalog.js",
      "js/ui/sidebar/country_inspector_controller.js"
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
    "selectorOrder": 237,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:data-service-runtime",
    "commandRef": "test:node:data-service-runtime",
    "sourceRefs": [
      "tests/data_service_runtime_behavior.test.mjs",
      "js/core/data_service.js"
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
    "selectorOrder": 160,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:deferred-bootstrap",
    "commandRef": "test:node:deferred-bootstrap",
    "sourceRefs": [
      "tests/deferred_vendor_loader_behavior.test.mjs",
      "tests/deferred_ui_bootstrap_behavior.test.mjs",
      "tests/main_deferred_bootstrap_boundary.test.mjs",
      "js/bootstrap/deferred_vendor_loader.js",
      "js/bootstrap/deferred_ui_bootstrap.js"
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
    "selectorOrder": 185,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:dev-workspace-selection-ownership",
    "commandRef": "test:node:dev-workspace-selection-ownership",
    "sourceRefs": [
      "tests/dev_workspace_selection_ownership_behavior.test.mjs",
      "js/core/sovereignty_manager.js",
      "js/core/state.js",
      "js/ui/dev_workspace/selection_ownership_controller.js"
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
    "selectorOrder": 231,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:landing-showcase-view",
    "commandRef": "test:node:landing-showcase-view",
    "sourceRefs": [
      "tests/landing_showcase_view_behavior.test.mjs",
      "landing/app.js",
      "landing/assets/europe-1936-showcase.svg",
      "landing/index.html"
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
    "selectorOrder": 347,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:main-bootstrap-wiring",
    "commandRef": "test:node:main-bootstrap-wiring",
    "sourceRefs": [
      "tests/main_bootstrap_wiring_boundary.test.mjs",
      "js/core/state/content_state.js"
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
    "selectorOrder": 186,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:p4:phase-verification-runner",
    "commandRef": "test:node:p4:phase-verification-runner",
    "sourceRefs": [
      "tests/p4_phase_verification_runner_behavior.test.mjs",
      "tools/run_p4_phase_verification.mjs"
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
    "selectorOrder": 204,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:post-ready-scheduler",
    "commandRef": "test:node:post-ready-scheduler",
    "sourceRefs": [
      "tests/post_ready_scheduler_behavior.test.mjs",
      "tests/main_post_ready_scheduler_boundary.test.mjs",
      "js/bootstrap/post_ready_scheduler.js"
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
    "selectorOrder": 180,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-runtime-binding",
    "commandRef": "test:node:render-runtime-binding",
    "sourceRefs": [
      "tests/render_runtime_binding_behavior.test.mjs",
      "tests/main_render_runtime_binding_boundary.test.mjs",
      "js/bootstrap/render_runtime_binding.js"
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
    "selectorOrder": 182,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:toolbar-render-scheduler",
    "commandRef": "test:node:toolbar-render-scheduler",
    "sourceRefs": [
      "tests/toolbar_render_scheduler_behavior.test.mjs",
      "js/ui/toolbar/toolbar_render_scheduler.js"
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
    "selectorOrder": 179,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-appearance-controller",
    "commandRef": "test:node:transport-appearance-controller",
    "sourceRefs": [
      "tests/transport_appearance_controller_behavior.test.mjs",
      "js/core/transport_capability_registry.js",
      "js/ui/toolbar/transport_appearance_controller.js"
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
    "selectorOrder": 190,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-controller",
    "commandRef": "test:node:transport-workbench-controller",
    "sourceRefs": [
      "tests/transport_workbench_event_owner_behavior.test.mjs",
      "tests/transport_workbench_shell_owner_behavior.test.mjs",
      "js/ui/toolbar/transport_workbench_event_owner.js",
      "js/ui/toolbar/transport_workbench_shell_owner.js"
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
    "selectorOrder": 192,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-event-owner",
    "commandRef": "test:node:transport-workbench-event-owner",
    "sourceRefs": [
      "tests/transport_workbench_event_owner_behavior.test.mjs",
      "js/ui/toolbar/transport_workbench_event_owner.js"
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
    "selectorOrder": 193,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-inspector-owner",
    "commandRef": "test:node:transport-workbench-inspector-owner",
    "sourceRefs": [
      "tests/transport_workbench_inspector_owner_behavior.test.mjs",
      "js/ui/toolbar/transport_workbench_inspector_owner.js"
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
    "selectorOrder": 195,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-layer-order-owner",
    "commandRef": "test:node:transport-workbench-layer-order-owner",
    "sourceRefs": [
      "tests/transport_workbench_layer_order_owner_behavior.test.mjs",
      "js/ui/toolbar/transport_workbench_layer_order_owner.js"
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
    "selectorOrder": 196,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-lens-owner",
    "commandRef": "test:node:transport-workbench-lens-owner",
    "sourceRefs": [
      "tests/transport_workbench_lens_owner_behavior.test.mjs",
      "js/ui/toolbar/transport_workbench_lens_owner.js"
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
    "selectorOrder": 197,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-popover-owner",
    "commandRef": "test:node:transport-workbench-popover-owner",
    "sourceRefs": [
      "tests/transport_workbench_popover_owner_behavior.test.mjs",
      "js/ui/toolbar/transport_workbench_popover_owner.js"
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
    "selectorOrder": 198,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-preview-lifecycle-owner",
    "commandRef": "test:node:transport-workbench-preview-lifecycle-owner",
    "sourceRefs": [
      "tests/transport_workbench_preview_lifecycle_owner_behavior.test.mjs",
      "tests/transport_workbench_line_runtime_shared_behavior.test.mjs",
      "tests/transport_workbench_road_preview_runtime_behavior.test.mjs",
      "tests/transport_workbench_rail_preview_runtime_behavior.test.mjs",
      "js/ui/toolbar/transport_workbench_preview_lifecycle_owner.js",
      "js/ui/transport_workbench_line_runtime_shared.js",
      "js/ui/transport_workbench_point_preview_runtime.js",
      "js/ui/transport_workbench_point_preview_shared.js",
      "js/ui/transport_workbench_road_preview_runtime.js",
      "js/ui/transport_workbench_rail_preview_runtime.js"
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
    "selectorOrder": 199,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-right-deck-owner",
    "commandRef": "test:node:transport-workbench-right-deck-owner",
    "sourceRefs": [
      "tests/transport_workbench_right_deck_owner_behavior.test.mjs",
      "js/ui/toolbar/transport_workbench_right_deck_owner.js"
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
    "selectorOrder": 200,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-shell-owner",
    "commandRef": "test:node:transport-workbench-shell-owner",
    "sourceRefs": [
      "tests/transport_workbench_shell_owner_behavior.test.mjs",
      "js/ui/toolbar/transport_workbench_shell_owner.js"
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
    "selectorOrder": 194,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-workbench-state-owner",
    "commandRef": "test:node:transport-workbench-state-owner",
    "sourceRefs": [
      "tests/transport_workbench_state_owner_behavior.test.mjs",
      "js/core/transport_pack_resolver.js",
      "js/ui/toolbar/transport_workbench_state_owner.js"
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
    "selectorOrder": 201,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:ui-shell-boot",
    "commandRef": "test:node:ui-shell-boot",
    "sourceRefs": [
      "tests/ui_shell_boot_behavior.test.mjs",
      "tests/main_ui_shell_boot_boundary.test.mjs",
      "js/bootstrap/ui_shell_boot.js"
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
    "selectorOrder": 184,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:verification-script-portfolio",
    "commandRef": "test:node:verification-script-portfolio",
    "sourceRefs": [
      "tests/verification_script_portfolio_behavior.test.mjs",
      "tools/test_route_registry.mjs",
      "tools/verification/command_supersession.mjs",
      "tools/verification/script_portfolio.mjs",
      "tools/verification/verification_domains.mjs"
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
    "selectorOrder": 340,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:worker-task-client",
    "commandRef": "test:node:worker-task-client",
    "sourceRefs": [
      "tests/worker_task_client_behavior.test.mjs",
      "js/core/worker_task_client.js"
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
    "selectorOrder": 223,
    "verification": null,
    "selector": {}
  }
];
