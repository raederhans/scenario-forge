// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const DELIVERY_RUNTIME_RECORDS = [
  {
    id: "pages:artifact-admission-contract",
    commandRef: "python -m unittest tests.test_pages_artifact_admission -q",
    sourceRefs: [
      "tools/pages_artifact_admission.py", "tests/test_pages_artifact_admission.py",
      ".github/workflows/deploy.yml", ".github/workflows/verify-shared.yml",
    ],
    ownerHints: ["deploy-runtime"], domains: ["pages-dist"], tiers: ["contract"],
    cost: "fast", resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"],
    platforms: ["all"], entrypointPolicyIndex: 4, verificationOrder: null, selectorOrder: 403,
    verification: null, selector: {},
  },
  {
    "id": "direct-e2e:test:e2e:pages-public-release-gate",
    "commandRef": "test:e2e:pages-public-release-gate",
    "sourceRefs": [
      "tests/e2e/release/pages_public_release_gate.spec.js"
    ],
    "ownerHints": [
      "deploy-runtime"
    ],
    "domains": [
      "release-smoke"
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
      "deploy-minimal"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 1,
    "verificationOrder": null,
    "selectorOrder": 156,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/sample_guide_deeplink.spec.js",
    "commandRef": "verify:demo",
    "sourceRefs": [
      "tests/e2e/sample_guide_deeplink.spec.js"
    ],
    "ownerHints": [
      "sample-guide"
    ],
    "domains": [
      "public-sample"
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
      "demo"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 2,
    "verificationOrder": null,
    "selectorOrder": 123,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:architecture-boundaries",
    "commandRef": "verify:architecture-boundaries",
    "sourceRefs": [
      "tools/check_architecture_boundaries.mjs",
      "js/core/map_renderer.js",
      "js/core/map_renderer/draw_canvas_orchestration_owner.js",
      "js/core/renderer/cached_pass_compositor_owner.js",
      "js/core/map_renderer/transformed_frame_compositor_owner.js",
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "tests/cached_pass_compositor_owner_behavior.test.mjs",
      "tests/transformed_frame_compositor_owner_behavior.test.mjs",
      "tests/test_map_renderer_frame_compositor_owner_boundary_contract.py",
      "tests/test_map_renderer_political_pass_orchestrator_boundary_contract.py",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-cached-pass-compositor-owner-p2-2a-20260711.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-transformed-frame-compositor-owner-p2-2b-20260712.md",
      "js/core/map_renderer/click_selection_transaction_owner.js",
      "tests/click_selection_transaction_owner_behavior.test.mjs",
      "docs/active/renderer-click-selection-pure-decision-owner-p1-8-20260709.md",
      "js/core/renderer/render_pipeline_passes.js",
      "js/core/renderer/viewport_resize_lifecycle_owner.js",
      "js/core/map_renderer/scenario_refresh_runtime.js",
      "js/core/map_renderer/exact_after_settle_scheduler.js",
      "js/core/map_renderer/hgo_runtime_preview_render_owner.js",
      ".github/workflows/pr-verify.yml",
      ".github/workflows/verify-shared.yml",
      "package.json"
    ],
    "ownerHints": [
      "architecture"
    ],
    "domains": [
      "architecture-boundaries"
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
    "verificationOrder": 11,
    "selectorOrder": 10,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "architecture-boundaries",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:browser-smoke-static-contract",
    "commandRef": "python -m unittest tests.test_playwright_app_ready_gate_contract -q",
    "sourceRefs": [
      "ops/browser-mcp/run-smoke-browser-inspection.sh",
      "ops/browser-mcp/inspection-profile.toml",
      "ops/browser-mcp/inspection-profile.schema.md",
      "tests/test_playwright_app_ready_gate_contract.py",
      "tools/browser_smoke_profile_contract.py"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "browser-smoke"
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
    "selectorOrder": 89,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:pages-dist",
    "commandRef": "verify:pages-dist-and-drift",
    "sourceRefs": [
      "docs/active/recovery-followup-20260908/plan.md",
      "docs/active/recovery-followup-20260908/context.md",
      "docs/active/recovery-followup-20260908/task.md",
      "tools/build_pages_dist.py",
      "tools/pages_artifact_admission.py",
      "tools/pages_artifact_root.py",
      "tools/pages_artifact_shadow.py",
      "tests/test_pages_artifact_admission.py",
      "tests/test_pages_dist_startup_shell.py",
      "tests/test_pages_artifact_shadow.py",
      "dist/pages-dist-manifest.json",
      "dist/app",
      "js/core/map_renderer.js",
      "js/core/map_renderer",
      "js/core/renderer",
      "js/core/renderer/cached_pass_compositor_owner.js",
      ".github/workflows/verify-shared.yml",
      ".github/workflows/nightly-verification.yml"
    ],
    "ownerHints": [
      "deploy-runtime"
    ],
    "domains": [
      "pages-dist"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "dist",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "deploy-minimal"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 1,
    "verificationOrder": 120,
    "selectorOrder": 86,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "pages",
      "supervisorDomain": "pages-dist",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:perf-gate",
    "commandRef": "perf:gate",
    "sourceRefs": [
      "tools/perf/run_baseline.mjs",
      "ops/browser-mcp/editor-performance-benchmark.py",
      "js/core/renderer/cached_pass_compositor_owner.js",
      "js/core/map_renderer/transformed_frame_compositor_owner.js",
      "js/core/renderer/visual_effects_pass_owner.js",
      "js/core/renderer/context_pass_orchestrator_owner.js",
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js"
    ],
    "ownerHints": [
      "perf-runtime"
    ],
    "domains": [
      "perf"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "perf-dev-server",
      "playwright-browser",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "perf-pr-gate"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 2,
    "verificationOrder": null,
    "selectorOrder": 93,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:perf-gate-contract",
    "commandRef": "verify:perf-gate-contract",
    "sourceRefs": [
      ".github/workflows/perf-pr-gate.yml",
      "docs/perf/baseline_2026-07-30-ratification.json",
      "ops/browser-mcp/editor-performance-benchmark.py",
      "tools/perf/run_baseline.mjs"
    ],
    "ownerHints": [
      "perf-runtime"
    ],
    "domains": [
      "perf"
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
    "selectorOrder": 88,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:playwright-observability",
    "commandRef": "python -m unittest tests.test_e2e_structural_tooling -q",
    "sourceRefs": [
      ".gitignore",
      "playwright.config.cjs",
      "tests/e2e/support/fixtures.js",
      "tests/e2e/support/playwright-app.js",
      "tests/e2e/support/reporters",
      "tests/e2e/support/playwright-selectors.js",
      "tests/e2e/support/expectations/console-allowlist.js",
      "tests/e2e/test-flake-budget.json",
      "tests/test_e2e_structural_tooling.py",
      "tools/run_adaptive_tests.mjs",
      "tools/select_verification_targets.mjs",
      "tools/test_route_registry.mjs",
      "tools/test_timeout_inventory.mjs",
      "tools/check_console_allowlist_decay.mjs",
      "tools/check_test_timeout_guardrails.mjs",
      "tools/test_timing_summary.mjs",
      ".github/workflows/pr-verify.yml",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "playwright-observability"
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
    "selectorOrder": 87,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:render-sample-role-policy",
    "commandRef": "test:node:render-sample-role-policy",
    "sourceRefs": [
      "tools/perf/render_sample_role_policy.mjs",
      "tools/perf/analyze_render_sample_roles.mjs",
      "tools/perf/run_baseline.mjs",
      "tools/perf/standard_perf_admission.mjs",
      "tests/render_sample_role_policy_behavior.test.mjs",
      "tests/standard_perf_settlement_role_behavior.test.mjs",
      "tests/perf_role_governed_report_behavior.test.mjs",
      "tests/test_perf_gate_contract.py",
      "docs/perf/baseline_2026-07-14.json",
      "docs/perf/baseline_2026-07-14.md",
      "docs/perf/baseline_2026-07-30.json",
      "docs/perf/baseline_2026-07-30.md",
      "docs/perf/baseline_2026-07-30-ratification.json",
      "docs/archive/renderer-frame-orchestration-p2-20260710/renderer-draw-canvas-orchestration-owner-p2-1-20260710.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/context.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/task.md",
      "package.json"
    ],
    "ownerHints": [
      "perf-runtime"
    ],
    "domains": [
      "perf"
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
    "verificationOrder": 9,
    "selectorOrder": 8,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "perf",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:test-console-allowlist",
    "commandRef": "verify:test-console-allowlist",
    "sourceRefs": [
      "tools/check_console_allowlist_decay.mjs",
      "tests/e2e/support/expectations/console-allowlist.js",
      "tests/e2e/test-flake-budget.json",
      ".github/workflows/pr-verify.yml",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "playwright-observability"
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
    "selectorOrder": 91,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:test-timeout-guardrails",
    "commandRef": "verify:test-timeout-guardrails",
    "sourceRefs": [
      "tools/check_test_timeout_guardrails.mjs",
      "tools/test-timeout-guardrail-allowlist.json",
      "tests/e2e/test-layer-manifest.json",
      ".github/workflows/pr-verify.yml",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "playwright-observability"
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
    "selectorOrder": 92,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:test-timeout-inventory",
    "commandRef": "verify:test-timeout-inventory",
    "sourceRefs": [
      "tools/test_timeout_inventory.mjs",
      "tests/e2e/test-layer-manifest.json",
      "tests/e2e/test-import-graph.json",
      ".github/workflows/pr-verify.yml",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "playwright-observability"
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
    "selectorOrder": 90,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:williams-crossover-governance",
    "commandRef": "test:node:williams-crossover-governance",
    "sourceRefs": [
      "tools/perf/williams_crossover_policy.mjs",
      "tools/perf/run_williams_crossover.mjs",
      "tools/perf/williams_crossover_windows_runtime.mjs",
      "tools/perf/williams_crossover_windows_job_runner.cs",
      "tools/process_containment/windows_job_runner_core.cs",
      "tools/process_containment/ordered_source_set_identity.mjs",
      "tools/perf/williams_crossover_power_scheme.ps1",
      "tools/perf/run_baseline.mjs",
      "tools/perf/render_sample_role_policy.mjs",
      "tests/williams_crossover_governance_behavior.test.mjs",
      "docs/archive/renderer-frame-orchestration-p2-20260710/plan.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/context.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/task.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/rerun07-final-repeat-governance.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/rerun08-harness-recovery-governance.md",
      "docs/active/_worktree_registry.md",
      "package.json"
    ],
    "ownerHints": [
      "perf-runtime"
    ],
    "domains": [
      "perf"
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
      "win32"
    ],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 87,
    "selectorOrder": 74,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "perf",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:williams-crossover-job-runner",
    "commandRef": "test:node:williams-crossover-job-runner",
    "sourceRefs": [
      "tools/perf/williams_crossover_windows_runtime.mjs",
      "tools/perf/williams_crossover_windows_job_runner.cs",
      "tools/process_containment/windows_job_runner_core.cs",
      "tools/process_containment/ordered_source_set_identity.mjs",
      "tools/perf/run_williams_crossover.mjs",
      "tools/perf/williams_crossover_policy.mjs",
      "tests/williams_crossover_windows_job_runner_behavior.test.mjs",
      "tests/williams_crossover_windows_job_runner_integration.test.mjs",
      "tests/williams_crossover_governance_behavior.test.mjs",
      "docs/archive/renderer-frame-orchestration-p2-20260710/plan.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/context.md",
      "docs/archive/renderer-frame-orchestration-p2-20260710/task.md",
      "docs/active/_worktree_registry.md",
      "package.json"
    ],
    "ownerHints": [
      "perf-runtime"
    ],
    "domains": [
      "perf"
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
      "win32"
    ],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 88,
    "selectorOrder": 75,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "perf",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "node:test:node:backend-cloud-support",
    "commandRef": "test:node:backend-cloud-support",
    "sourceRefs": [
      "tests/backend_client_behavior.test.mjs",
      "tests/project_support_diagnostics_controller_behavior.test.mjs",
      "tests/backend_console_helpers.test.mjs",
      "js/core/dirty_state.js",
      "js/core/state.js",
      "js/core/state/index.js",
      "js/ui/sidebar/project_support_diagnostics_controller.js",
      "vendor/fflate.browser.js",
      "backend/backend_console_helpers.js"
    ],
    "ownerHints": [
      "backend-cloud-support"
    ],
    "domains": [
      "backend-cloud-support"
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
    "selectorOrder": 188,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:backend-console-helpers",
    "commandRef": "test:node:backend-console-helpers",
    "sourceRefs": [
      "tests/backend_console_helpers.test.mjs",
      "backend/backend_console_helpers.js"
    ],
    "ownerHints": [
      "backend-cloud-support"
    ],
    "domains": [
      "backend-cloud-support"
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
    "selectorOrder": 189,
    "verification": null,
    "selector": {}
  },
  {
    "id": "landing:map-asset-contracts",
    "commandRef": "test:py:landing-map-asset-contracts",
    "sourceRefs": [
      "tests/test_landing_map_asset_contracts.py",
      "tools/build_landing_europe_1936_showcase.py",
      "tools/build_landing_japan_preview.py",
      "tools/build_landing_work_maps.py",
      "tools/rasterize_landing_assets.py",
      "landing/assets/europe-1936-showcase.json",
      "landing/assets/europe-1936-showcase.svg",
      "landing/assets/hero-blank.json",
      "landing/assets/hero-blank.svg",
      "landing/assets/hero-blank.webp",
      "landing/assets/hero-hoi4-1936.json",
      "landing/assets/hero-hoi4-1936.svg",
      "landing/assets/hero-hoi4-1936.webp",
      "landing/assets/hero-hoi4-1939.json",
      "landing/assets/hero-hoi4-1939.svg",
      "landing/assets/hero-hoi4-1939.webp",
      "landing/assets/hero-tno-1962.json",
      "landing/assets/hero-tno-1962.svg",
      "landing/assets/hero-tno-1962.webp",
      "landing/assets/japan-preview.json",
      "landing/assets/japan-preview-cities.svg",
      "landing/assets/japan-preview-night.svg",
      "landing/assets/japan-preview-terrain.svg",
      "landing/assets/japan-preview-transport.svg",
      "landing/assets/work-alt-history-med.json",
      "landing/assets/work-alt-history-med.svg",
      "landing/assets/work-atlas-japan-corridor.json",
      "landing/assets/work-atlas-japan-corridor.svg",
      "landing/assets/work-scenario-switch-europe.json",
      "landing/assets/work-scenario-switch-europe.svg"
    ],
    "ownerHints": [
      "public-demo"
    ],
    "domains": [
      "public-sample"
    ],
    "tiers": [
      "contract"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo"
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
    "selectorOrder": 379,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "public-sample",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "node:test:node:perf-probe-snapshot-behavior",
    "commandRef": "test:node:perf-probe-snapshot-behavior",
    "sourceRefs": [
      "tests/perf_probe_snapshot_behavior.test.mjs",
      "js/core/perf_probe.js"
    ],
    "ownerHints": [
      "perf"
    ],
    "domains": [
      "perf"
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
    "selectorOrder": 327,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:polyline-simplification-benchmark",
    "commandRef": "test:node:polyline-simplification-benchmark",
    "sourceRefs": [
      "tests/polyline_simplification_benchmark_contract.test.mjs",
      "package-lock.json",
      "package.json",
      "tests/fixtures/polyline_simplification_benchmark_fixtures.mjs",
      "tools/perf/polyline_simplification_benchmark.mjs"
    ],
    "ownerHints": [
      "perf"
    ],
    "domains": [
      "perf"
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
    "selectorOrder": 350,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:release-smoke-helper",
    "commandRef": "test:node:release-smoke-helper",
    "sourceRefs": [
      "tests/release_smoke_retry_behavior.node.test.mjs",
      "tests/e2e/support/release-smoke.js"
    ],
    "ownerHints": [
      "release-smoke"
    ],
    "domains": [
      "release-smoke"
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
    "selectorOrder": 349,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:render-sample-role-policy",
    "commandRef": "test:node:render-sample-role-policy",
    "sourceRefs": [
      "tests/render_sample_role_policy_behavior.test.mjs",
      "tests/standard_perf_settlement_role_behavior.test.mjs",
      "tests/perf_role_governed_report_behavior.test.mjs",
      "tools/perf/render_sample_role_policy.mjs",
      "tools/perf/analyze_render_sample_roles.mjs",
      "tools/perf/run_baseline.mjs",
      "tools/perf/run_williams_crossover.mjs",
      "tools/perf/standard_perf_admission.mjs"
    ],
    "ownerHints": [
      "perf"
    ],
    "domains": [
      "perf"
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
    "selectorOrder": 211,
    "verification": null,
    "selector": {}
  },
  {
    "id": "perf:williams-crossover-live",
    "commandRef": "perf:williams-crossover:run",
    "sourceRefs": [
      "tools/perf/williams_crossover_policy.mjs",
      "tools/perf/run_williams_crossover.mjs",
      "tools/perf/williams_crossover_windows_runtime.mjs",
      "tools/perf/williams_crossover_windows_job_runner.cs",
      "tools/process_containment/windows_job_runner_core.cs",
      "tools/process_containment/ordered_source_set_identity.mjs",
      "tools/perf/williams_crossover_power_scheme.ps1",
      "tools/perf/run_baseline.mjs",
      "tools/perf/render_sample_role_policy.mjs",
      "package-lock.json",
      "package.json"
    ],
    "ownerHints": [
      "perf-runtime"
    ],
    "domains": [
      "perf"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "perf-dev-server",
      "browser-dev-server",
      "playwright-browser",
      ".runtime-output",
      "system-power-scheme"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "perf-pr-gate"
    ],
    "platforms": [
      "win32"
    ],
    "entrypointPolicyIndex": 2,
    "verificationOrder": 89,
    "selectorOrder": 76,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "perf",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "perf:williams-crossover-telemetry-live",
    "commandRef": "test:node:williams-crossover-telemetry-live",
    "sourceRefs": [
      "tools/perf/williams_crossover_policy.mjs",
      "tools/perf/williams_crossover_windows_runtime.mjs",
      "tests/williams_crossover_windows_job_runner_integration.test.mjs",
      "package.json"
    ],
    "ownerHints": [
      "perf-runtime"
    ],
    "domains": [
      "perf"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "contract",
    "resourceLocks": [
      "perf-dev-server"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "perf-pr-gate"
    ],
    "platforms": [
      "win32"
    ],
    "entrypointPolicyIndex": 2,
    "verificationOrder": 91,
    "selectorOrder": 78,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "perf",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "perf:williams-power-scheme-live-preflight",
    "commandRef": "perf:williams-power-scheme:live-preflight",
    "sourceRefs": [
      "tools/perf/williams_crossover_power_scheme.ps1",
      "tools/perf/run_williams_crossover.mjs",
      "tools/perf/williams_crossover_policy.mjs",
      "tests/williams_crossover_governance_behavior.test.mjs",
      "package.json"
    ],
    "ownerHints": [
      "perf-runtime"
    ],
    "domains": [
      "perf"
    ],
    "tiers": [
      "smoke"
    ],
    "cost": "contract",
    "resourceLocks": [
      "system-power-scheme"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "perf-pr-gate"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 2,
    "verificationOrder": 90,
    "selectorOrder": 77,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "perf",
      "routeRegistry": true,
      "optionalMainThread": true
    },
    "selector": {}
  },
  {
    "id": "python:backend-cloud-support",
    "commandRef": "test:py:backend-cloud-support",
    "sourceRefs": [
      "map_backend",
      "tools/dev_server.py",
      "tests/test_backend_service.py",
      "tests/test_backend_routes.py",
      "tests/test_dev_server.py"
    ],
    "ownerHints": [
      "backend-cloud-support"
    ],
    "domains": [
      "backend-cloud-support"
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
    "selectorOrder": 352,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python:tests.test_perf_gate_contract",
    "commandRef": "python -m unittest tests.test_perf_gate_contract -q",
    "sourceRefs": [
      "tests/test_perf_gate_contract.py"
    ],
    "ownerHints": [
      "perf-runtime"
    ],
    "domains": [
      "perf"
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
    "selectorOrder": 359,
    "verification": null,
    "selector": {}
  },
  {
    "id": "verify-core:dist-drift",
    "commandRef": "verify:dist-drift",
    "sourceRefs": [
      "tools/build_pages_dist.py",
      "dist/pages-dist-manifest.json",
      "dist/app"
    ],
    "ownerHints": [
      "deploy-runtime"
    ],
    "domains": [
      "pages-dist"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "dist",
      ".runtime-output"
    ],
    "executionOwners": [
      "main-thread"
    ],
    "profiles": [
      "deploy-minimal"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 1,
    "verificationOrder": 121,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "pages-dist"
    },
    "selector": null
  },
  {
    "id": "verify-core:state-write-allowlist",
    "commandRef": "verify:state-write-allowlist",
    "sourceRefs": [
      "tools/check_state_write_allowlist.mjs",
      "tools/eslint-rules/state-writer-allowlist.json",
      "tools/state_writer_policy.json"
    ],
    "ownerHints": [
      "architecture"
    ],
    "domains": [
      "architecture-boundaries"
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
    "verificationOrder": 12,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "architecture-boundaries"
    },
    "selector": null
  },
  {
    "id": "verify-core:test-console-allowlist",
    "commandRef": "verify:test-console-allowlist",
    "sourceRefs": [
      "tools/check_console_allowlist_decay.mjs",
      "tests/e2e/support/expectations/console-allowlist.js"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "playwright-observability"
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
    "verificationOrder": 30,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "playwright-observability"
    },
    "selector": null
  },
  {
    "id": "verify-core:test-timeout-guardrails",
    "commandRef": "verify:test-timeout-guardrails",
    "sourceRefs": [
      "tools/check_test_timeout_guardrails.mjs",
      "tools/test-timeout-guardrail-allowlist.json",
      "tests/e2e/test-layer-manifest.json"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "playwright-observability"
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
    "verificationOrder": 31,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "playwright-observability"
    },
    "selector": null
  }
];
