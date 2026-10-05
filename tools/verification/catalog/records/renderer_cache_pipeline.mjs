// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const RENDERER_CACHE_PIPELINE_RECORDS = [
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
