// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const RENDERER_FRAME_ORCHESTRATION_RECORDS = [
  {
    "id": "direct:country-label-contracts",
    "commandRef": "node --test tests/country_label_source_behavior.test.mjs tests/country_label_layout_behavior.test.mjs tests/country_label_render_owner_behavior.test.mjs tests/country_label_style_behavior.test.mjs",
    "sourceRefs": [
      "js/core/renderer/country_label_source.js",
      "js/core/renderer/country_label_geometry.js",
      "js/core/renderer/country_label_layout.js",
      "js/core/renderer/country_label_render_owner.js",
      "js/core/renderer/country_label_layout_worker.js",
      "js/workers/country_label_geometry.worker.js",
      "tests/country_label_source_behavior.test.mjs",
      "tests/country_label_layout_behavior.test.mjs",
      "tests/country_label_render_owner_behavior.test.mjs",
      "tests/country_label_style_behavior.test.mjs"
    ],
    "ownerHints": ["renderer-runtime"],
    "domains": ["renderer-runtime"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 5,
    "verificationOrder": null,
    "selectorOrder": 391,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:cached-pass-compositor-owner",
    "commandRef": "test:node:cached-pass-compositor-owner",
    "sourceRefs": [
      "tests/cached_pass_compositor_owner_behavior.test.mjs",
      "js/core/renderer/cached_pass_compositor_owner.js"
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
    "selectorOrder": 285,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:cached-pass-compositor-owner-suite",
    "commandRef": "test:node:cached-pass-compositor-owner-suite",
    "sourceRefs": [
      "tests/cached_pass_compositor_owner_behavior.test.mjs",
      "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
      "js/core/renderer/cached_pass_compositor_owner.js"
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
    "selectorOrder": 286,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:context-pass-orchestrator-owner",
    "commandRef": "test:node:context-pass-orchestrator-owner",
    "sourceRefs": [
      "tests/context_pass_orchestrator_owner_behavior.test.mjs",
      "js/core/renderer/context_pass_orchestrator_owner.js"
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
    "selectorOrder": 343,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:draw-canvas-orchestration-owner",
    "commandRef": "test:node:draw-canvas-orchestration-owner",
    "sourceRefs": [
      "tests/draw_canvas_orchestration_owner_behavior.test.mjs",
      "js/core/map_renderer/draw_canvas_orchestration_owner.js"
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
    "selectorOrder": 283,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:draw-canvas-orchestration-owner-suite",
    "commandRef": "test:node:draw-canvas-orchestration-owner-suite",
    "sourceRefs": [
      "tests/draw_canvas_orchestration_owner_behavior.test.mjs",
      "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
      "js/core/map_renderer/draw_canvas_orchestration_owner.js"
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
    "selectorOrder": 284,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-draw-canvas-orchestration-inventory",
    "commandRef": "test:node:renderer-draw-canvas-orchestration-inventory",
    "sourceRefs": [
      "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs"
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
    "selectorOrder": 282,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:renderer-pass-family-inventory",
    "commandRef": "test:node:renderer-pass-family-inventory",
    "sourceRefs": [
      "tests/renderer_pass_family_inventory_behavior.test.mjs",
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
    "selectorOrder": 341,
    "verification": null,
    "selector": {}
  },
  {
    "id": "direct:renderer-render-snapshot-contracts",
    "commandRef": "node --test tests/render_snapshot_behavior.test.mjs",
    "sourceRefs": [
      "js/core/renderer/render_snapshot.js",
      "tests/render_snapshot_behavior.test.mjs"
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
    "entrypointPolicyIndex": 5,
    "verificationOrder": null,
    "selectorOrder": 390,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transformed-frame-compositor-owner",
    "commandRef": "test:node:transformed-frame-compositor-owner",
    "sourceRefs": [
      "tests/transformed_frame_compositor_owner_behavior.test.mjs",
      "js/core/map_renderer/transformed_frame_compositor_owner.js"
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
    "selectorOrder": 287,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transformed-frame-compositor-owner-suite",
    "commandRef": "test:node:transformed-frame-compositor-owner-suite",
    "sourceRefs": [
      "tests/transformed_frame_compositor_owner_behavior.test.mjs",
      "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
      "js/core/map_renderer/transformed_frame_compositor_owner.js"
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
    "selectorOrder": 288,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python:tests.test_map_renderer_render_snapshot_boundary_contract",
    "commandRef": "python -m unittest tests.test_map_renderer_render_snapshot_boundary_contract -q",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/render_snapshot.js",
      "tests/test_map_renderer_render_snapshot_boundary_contract.py"
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
    "entrypointPolicyIndex": 5,
    "verificationOrder": null,
    "selectorOrder": 391,
    "verification": null,
    "selector": {}
  },
  {
    "id": "renderer:transformed-frame-compositor-runtime",
    "commandRef": "test:e2e:dev:scenario-chunk-runtime",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/map_renderer/transformed_frame_compositor_owner.js",
      "tests/e2e/dev/scenario_chunk_exact_after_settle_regression.dev.spec.js",
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
      "pr-smoke"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 96,
    "selectorOrder": 83,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "renderer-runtime",
      "routeRegistry": true,
      "optionalMainThread": true
    },
    "selector": {}
  },
  {
    "id": "verify-core:test:node:cached-pass-compositor-owner",
    "commandRef": "test:node:cached-pass-compositor-owner",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/cached_pass_compositor_owner.js",
      "tests/cached_pass_compositor_owner_behavior.test.mjs",
      "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-cached-pass-compositor-owner-p2-2a-20260711.md",
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
    "verificationOrder": 94,
    "selectorOrder": 81,
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
    "id": "verify-core:test:node:context-pass-orchestrator-owner",
    "commandRef": "test:node:context-pass-orchestrator-owner",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/context_pass_orchestrator_owner.js",
      "tests/context_pass_orchestrator_owner_behavior.test.mjs",
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
    "verificationOrder": 43,
    "selectorOrder": 30,
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
    "id": "verify-core:test:node:draw-canvas-orchestration-owner",
    "commandRef": "test:node:draw-canvas-orchestration-owner",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/map_renderer/draw_canvas_orchestration_owner.js",
      "tests/draw_canvas_orchestration_owner_behavior.test.mjs",
      "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-draw-canvas-orchestration-owner-p2-1-20260710.md",
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
    "verificationOrder": 83,
    "selectorOrder": 70,
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
    "id": "verify-core:test:node:renderer-draw-canvas-orchestration-inventory",
    "commandRef": "test:node:renderer-draw-canvas-orchestration-inventory",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/map_renderer/draw_canvas_orchestration_owner.js",
      "js/core/renderer/cached_pass_compositor_owner.js",
      "js/core/map_renderer/transformed_frame_compositor_owner.js",
      "tests/draw_canvas_orchestration_owner_behavior.test.mjs",
      "tests/cached_pass_compositor_owner_behavior.test.mjs",
      "tests/transformed_frame_compositor_owner_behavior.test.mjs",
      "tests/test_map_renderer_draw_canvas_orchestration_owner_boundary_contract.py",
      "tests/test_map_renderer_frame_compositor_owner_boundary_contract.py",
      "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-draw-canvas-orchestration-preflight-20260702.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-draw-canvas-orchestration-owner-p2-1-20260710.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-cached-pass-compositor-owner-p2-2a-20260711.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-transformed-frame-compositor-owner-p2-2b-20260712.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/plan.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/context.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/task.md",
      "tools/check_architecture_boundaries.mjs",
      "tools/verification/verification_domains.mjs",
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
    "verificationOrder": 82,
    "selectorOrder": 69,
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
    "id": "verify-core:test:node:renderer-pass-family-inventory",
    "commandRef": "test:node:renderer-pass-family-inventory",
    "sourceRefs": [
      "js",
      "dist",
      "tools/renderer_pass_family_inventory.mjs",
      "tests/renderer_pass_family_inventory_behavior.test.mjs",
      "js/core/renderer/render_pipeline_catalog.js",
      "js/core/map_renderer/render_pass_catalog.js",
      "js/core/map_renderer.js",
      "js/core/map_renderer/hgo_runtime_preview_render_owner.js",
      "js/core/renderer/transport_overview_render_owner.js",
      "js/core/state/ui_state.js",
      "docs/archive/renderer-pass-family-p3-20260713/plan.md",
      "docs/archive/renderer-pass-family-p3-20260713/context.md",
      "docs/archive/renderer-pass-family-p3-20260713/task.md",
      "docs/archive/renderer-pass-family-p3-20260713/closeout.md",
      "docs/archive/renderer-pass-family-p3-20260713/coupling-matrix-p3-0.md",
      "docs/active/renderer-pass-family-p3-20260713/plan.md",
      "docs/active/renderer-pass-family-p3-20260713/context.md",
      "docs/active/renderer-pass-family-p3-20260713/task.md",
      "docs/active/renderer-pass-family-p3-closeout-20260715.md",
      "docs/active/renderer-pass-family-coupling-matrix-p3-0-20260713.md",
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
    "verificationOrder": 41,
    "selectorOrder": 28,
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
    "id": "verify-core:test:node:transformed-frame-compositor-owner",
    "commandRef": "test:node:transformed-frame-compositor-owner",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/map_renderer/transformed_frame_compositor_owner.js",
      "tests/transformed_frame_compositor_owner_behavior.test.mjs",
      "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
      "tests/scenario_chunk_contracts.test.mjs",
      "tests/scenario_chunk_contracts.quick_cases.mjs",
      "tests/scenario_chunk_contracts.heavy_cases.mjs",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-transformed-frame-compositor-owner-p2-2b-20260712.md",
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
    "verificationOrder": 95,
    "selectorOrder": 82,
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
    "id": "verify-core:test:python:map-renderer-draw-canvas-orchestration-boundary",
    "commandRef": "test:python:map-renderer-draw-canvas-orchestration-boundary",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/map_renderer/draw_canvas_orchestration_owner.js",
      "js/core/map_renderer/public.js",
      "tools/eslint-rules/state-writer-allowlist.json",
      "tools/check_architecture_boundaries.mjs",
      "tests/draw_canvas_orchestration_owner_behavior.test.mjs",
      "tests/test_map_renderer_draw_canvas_orchestration_owner_boundary_contract.py",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-draw-canvas-orchestration-owner-p2-1-20260710.md",
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
    "verificationOrder": 84,
    "selectorOrder": 71,
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
    "id": "verify-core:test:python:map-renderer-frame-compositor-boundary",
    "commandRef": "test:python:map-renderer-frame-compositor-boundary",
    "sourceRefs": [
      "js/core/map_renderer.js",
      "js/core/renderer/cached_pass_compositor_owner.js",
      "js/core/map_renderer/transformed_frame_compositor_owner.js",
      "js/core/map_renderer/public.js",
      "tools/eslint-rules/state-writer-allowlist.json",
      "tools/check_architecture_boundaries.mjs",
      "tests/cached_pass_compositor_owner_behavior.test.mjs",
      "tests/transformed_frame_compositor_owner_behavior.test.mjs",
      "tests/test_map_renderer_frame_compositor_owner_boundary_contract.py",
      "tests/test_pages_dist_startup_shell.py",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-cached-pass-compositor-owner-p2-2a-20260711.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-transformed-frame-compositor-owner-p2-2b-20260712.md",
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
    "verificationOrder": 97,
    "selectorOrder": 84,
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
