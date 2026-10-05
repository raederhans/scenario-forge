// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const STARTUP_RECORDS = [
  {
    "id": "direct-e2e:test:e2e:dev:tno-ready-state",
    "commandRef": "test:e2e:dev:tno-ready-state",
    "sourceRefs": [
      "tests/e2e/dev/tno_ready_state_contract.dev.spec.js"
    ],
    "ownerHints": [
      "tno-startup"
    ],
    "domains": [
      "tno-startup"
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
    "selectorOrder": 152,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/startup_bundle_recovery_contract.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/startup_bundle_recovery_contract.spec.js",
    "sourceRefs": [
      "tests/e2e/startup_bundle_recovery_contract.spec.js"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 132,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/tno_startup_visible_context_layers_contract.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/tno_startup_visible_context_layers_contract.spec.js",
    "sourceRefs": [
      "tests/e2e/tno_startup_visible_context_layers_contract.spec.js"
    ],
    "ownerHints": [
      "scenario-tno"
    ],
    "domains": [
      "tno-startup"
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
    "selectorOrder": 142,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:palette-runtime-bridge",
    "commandRef": "test:node:palette-runtime-bridge",
    "sourceRefs": [
      "tests/palette_runtime_bridge.node.test.mjs",
      "data/country_feature_policies.json",
      "js/core/color_hex_utils.js",
      "js/core/color_manager.js",
      "js/core/color_resolver.js",
      "js/core/country_code_aliases.js",
      "js/core/country_feature_policies.js",
      "js/core/feature_identity.js",
      "js/core/feature_identity_shared.js",
      "js/core/palette_runtime_bridge.js",
      "js/core/state/color_state.js",
      "js/core/state_defaults.js",
      "js/core/transport_capability_registry.js",
      "js/core/transport_pack_resolver.js",
      "js/workers/startup_boot.worker.js"
    ],
    "ownerHints": [
      "startup"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 239,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-startup-transaction-inventory",
    "commandRef": "test:node:renderer-startup-transaction-inventory",
    "sourceRefs": [
      "tests/renderer_startup_transaction_inventory_boundary.test.mjs"
    ],
    "ownerHints": [
      "startup"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 261,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-startup-transaction-owner",
    "commandRef": "test:node:renderer-startup-transaction-owner",
    "sourceRefs": [
      "tests/renderer_startup_transaction_owner_behavior.test.mjs",
      "js/core/renderer/renderer_startup_transaction_owner.js"
    ],
    "ownerHints": [
      "startup"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 260,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:sample-project-contracts",
    "commandRef": "test:node:sample-project-contracts",
    "sourceRefs": [
      "tests/sample_project_contracts.test.mjs",
      "js/bootstrap/startup_sample_project_deeplink.js",
      "js/core/file_manager.js",
      "js/core/sample_export_recommendation.js",
      "js/core/sample_project_import_workflow.js",
      "js/core/sample_project_registry.js",
      "js/core/sample_project_url.js",
      "js/core/state/index.js",
      "js/ui/toolbar/export_workbench_controller.js",
      "js/ui/toolbar/sample_project_banner_controller.js",
      "js/ui/ui_surface_url_state.js"
    ],
    "ownerHints": [
      "startup"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 348,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:sidebar-hgo-identity-startup",
    "commandRef": "test:node:sidebar-hgo-identity-startup",
    "sourceRefs": [
      "tests/sidebar_hgo_identity_startup_behavior.test.mjs",
      "js/ui/sidebar.js"
    ],
    "ownerHints": [
      "startup"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 238,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:startup-failure-recovery",
    "commandRef": "test:node:startup-failure-recovery",
    "sourceRefs": [
      "tests/startup_failure_recovery_behavior.test.mjs",
      "tests/main_startup_failure_recovery_boundary.test.mjs",
      "js/bootstrap/startup_failure_recovery.js",
      "js/bootstrap/startup_lazy_module_loader.js"
    ],
    "ownerHints": [
      "startup"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 183,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:startup-hydration-behavior",
    "commandRef": "test:node:startup-hydration-behavior",
    "sourceRefs": [
      "tests/startup_hydration_behavior.test.mjs",
      "js/core/scenario/startup_hydration.js",
      "js/core/startup_cache.js"
    ],
    "ownerHints": [
      "startup"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 230,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:startup-ready-handoff",
    "commandRef": "test:node:startup-ready-handoff",
    "sourceRefs": [
      "tests/startup_ready_handoff_behavior.test.mjs",
      "tests/main_startup_ready_handoff_boundary.test.mjs",
      "js/bootstrap/deferred_ui_bootstrap.js",
      "js/bootstrap/post_ready_scheduler.js",
      "js/bootstrap/startup_ready_handoff.js",
      "js/core/state/actions/boot_actions.js"
    ],
    "ownerHints": [
      "startup"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 187,
    "verification": null,
    "selector": {}
  },
  {
    "id": "p3:context-pass:tno-contracts",
    "commandRef": "test:e2e:tno-contracts",
    "sourceRefs": [
      "js/core/renderer/context_pass_orchestrator_owner.js"
    ],
    "ownerHints": [
      "tno-startup"
    ],
    "domains": [
      "tno-startup"
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
    "verificationOrder": 64,
    "selectorOrder": 51,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "tno-startup",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:political-pass:tno-contracts",
    "commandRef": "test:e2e:tno-contracts",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js"
    ],
    "ownerHints": [
      "tno-startup"
    ],
    "domains": [
      "tno-startup"
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
    "verificationOrder": 55,
    "selectorOrder": 42,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "tno-startup",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "python:tests.test_app_entry_resolver",
    "commandRef": "python -m unittest tests.test_app_entry_resolver -q",
    "sourceRefs": [
      "tests/test_app_entry_resolver.py"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 354,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python:tests.test_startup_shell",
    "commandRef": "python -m unittest tests.test_startup_shell -q",
    "sourceRefs": [
      "tests/test_startup_shell.py"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "selectorOrder": 360,
    "verification": null,
    "selector": {}
  },
  {
    "id": "verify-core:test:node:deferred-bootstrap",
    "commandRef": "test:node:deferred-bootstrap",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "verificationOrder": 39,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "startup-node",
      "supervisorDomain": "startup"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:main-bootstrap-wiring",
    "commandRef": "test:node:main-bootstrap-wiring",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "verificationOrder": 40,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "startup-node",
      "supervisorDomain": "startup"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:main-runtime-diagnostics",
    "commandRef": "test:node:main-runtime-diagnostics",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "verificationOrder": 35,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "startup-node",
      "supervisorDomain": "startup"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:post-ready-scheduler",
    "commandRef": "test:node:post-ready-scheduler",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "verificationOrder": 34,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "startup-node",
      "supervisorDomain": "startup"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:render-runtime-binding",
    "commandRef": "test:node:render-runtime-binding",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "verificationOrder": 36,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "startup-node",
      "supervisorDomain": "startup"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:startup-failure-recovery",
    "commandRef": "test:node:startup-failure-recovery",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "verificationOrder": 37,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "startup-node",
      "supervisorDomain": "startup"
    },
    "selector": null
  },
  {
    "id": "verify-core:test:node:startup-ready-handoff",
    "commandRef": "test:node:startup-ready-handoff",
    "sourceRefs": [
      "package.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "startup-runtime"
    ],
    "domains": [
      "startup"
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
    "verificationOrder": 38,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "startup-node",
      "supervisorDomain": "startup"
    },
    "selector": null
  },
  {
    "id": "node:test:node:startup-resource-graph",
    "commandRef": "test:node:startup-resource-graph",
    "sourceRefs": [
      "package.json",
      "tests/startup_resource_graph_contract.test.mjs",
      "tools/startup_resource_graph.mjs"
    ],
    "ownerHints": ["startup-runtime"],
    "domains": ["startup"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 138,
    "selectorOrder": 389,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "startup",
      "routeRegistry": true
    },
    "selector": {}
  }
];
