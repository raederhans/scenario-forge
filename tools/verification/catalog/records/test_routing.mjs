import { VERIFICATION_CATALOG_SOURCE_FILES } from "../source_files.mjs";

// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const TEST_ROUTING_RECORDS = [
  {
    "id": "infra:adaptive-recursion-policy",
    "commandRef": "node tools/run_adaptive_tests.mjs --entrypoint impact --execute --defer-main-thread",
    "sourceRefs": [
      "tools/run_adaptive_tests.mjs",
      "tests/fixtures/adaptive_local_cli_recursive.json",
      "tests/verify_core_runner_behavior.test.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "entrypointPolicyIndex": 3,
    "verificationOrder": 4,
    "selectorOrder": null,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "supervisorDomain": "test-routing",
      "routeRegistry": false
    },
    "selector": null
  },
  {
    "id": "infra:core-verification-runner",
    "commandRef": "test:node:verify-core-runner",
    "sourceRefs": [
      "tools/run_core_verification.mjs",
      "tools/verification/resumable_verification.mjs",
      "tools/verification/command_supersession.mjs",
      "tests/fixtures/adaptive_local_cli_source_mismatch.json",
      "tests/fixtures/adaptive_local_cli_missing_selector.json",
      "tests/fixtures/adaptive_local_cli_renamed_selector.json",
      "tests/fixtures/adaptive_local_cli_valid.json",
      "tests/fixtures/adaptive_local_cli_recursive.json",
      "tests/verify_core_runner_behavior.test.mjs",
      "docs/testing/verify-core.md",
      "docs/active/test-verification-reform-20260813",
      "docs/active/mapcreator-recovery-gates-20260814",
      "package.json"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 6,
    "selectorOrder": 5,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:deploy-minimal-dependency-guard",
    "commandRef": "python tools/check_min_ci_requirements.py",
    "sourceRefs": [
      "requirements-ci-min.lock.txt",
      "tools/check_min_ci_requirements.py",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "deploy-runtime"
    ],
    "domains": [
      "test-routing"
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
      "deploy-minimal"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 1,
    "verificationOrder": null,
    "selectorOrder": 384,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:e2e-layer-manifest",
    "commandRef": "verify:test:e2e-layers",
    "sourceRefs": [
      "tools/e2e_layering.mjs",
      "tests/e2e/test-layer-manifest.json",
      "tests/e2e/test-lists",
      ".github/workflows/pr-verify.yml",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 2,
    "selectorOrder": 2,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:heavy-test-classification",
    "commandRef": "python tools/check_heavy_test_classification.py",
    "sourceRefs": [
      "tools/check_heavy_test_classification.py",
      "tests/heavy_dependency_groups.json",
      ".github/workflows/nightly-verification.yml",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "selectorOrder": 382,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:local-verification-closure",
    "commandRef": "verify:local-infra",
    "sourceRefs": [
      "tools/verification/workspace_changes.mjs",
      ".github/workflows/nightly-verification.yml",
      ".github/workflows/release-verification.yml",
      "package.json",
      "tests/test_e2e_structural_tooling.py",
      "tests/verification_metadata_behavior.test.mjs",
      "tests/verification_script_portfolio_behavior.test.mjs",
      "tests/verify_core_runner_behavior.test.mjs",
      "tools/ai_test_supervisor/domain_registry.json",
      "tools/run_adaptive_tests.mjs",
      "tools/select_verification_targets.mjs",
      "tools/test_route_registry.mjs",
      "tools/verification/script_portfolio.mjs",
      "tools/verification/verification_domains.mjs",
      "tests/verification_profile_behavior.test.mjs",
      "tools/verification/verification_profile.mjs",
      "docs/active/test-verification-reform-20260813/task.md",
      "tools/run_core_verification.mjs",
      "tools/verification/command_supersession.mjs",
      "tools/verification/verification_catalog_projection.mjs",
      ...VERIFICATION_CATALOG_SOURCE_FILES
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 0,
    "selectorOrder": 0,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:sf-ats-contracts",
    "commandRef": "verify:supervisor-contracts",
    "sourceRefs": [
      "AGENTS.md",
      "lessons learned.md",
      "docs/testing/sf-ats-overview.md",
      "docs/active/_worktree_registry.md",
      "docs/archive/sf-ats-wp2-supervisor-plan-20260702",
      "tools/ai_test_supervisor",
      "tests/supervisor_domain_registry_behavior.test.mjs",
      "tests/supervisor_schema_contracts.test.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 5,
    "selectorOrder": 4,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {
      "guidance": {
        "taskEntry": [
          "SF-ATS contract and schema health gate"
        ],
        "ownerFiles": [
          "AGENTS.md",
          "lessons learned.md",
          "docs/active/_worktree_registry.md",
          "docs/testing/sf-ats-overview.md",
          "tools/ai_test_supervisor",
          "tests/supervisor_domain_registry_behavior.test.mjs",
          "tests/supervisor_schema_contracts.test.mjs"
        ],
        "commonChecks": [
          "npm run verify:supervisor-contracts"
        ],
        "riskSignals": [
          "SF-ATS contract drift",
          "supervisor schema drift",
          "domain registry drift",
          "agent verification contract drift"
        ],
        "diagnostics": [
          ".runtime/reports/generated/test-adaptive-selection.json",
          ".runtime/reports/generated/test-adaptive-selection.md"
        ],
        "status": "active"
      }
    }
  },
  {
    "id": "infra:test-import-graph",
    "commandRef": "verify:test-import-graph",
    "sourceRefs": [
      "tools/build_test_import_graph.mjs",
      "tools/check_test_import_graph.mjs",
      "tests/e2e/test-import-graph.json",
      ".github/workflows/pr-verify.yml",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 10,
    "selectorOrder": 9,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:verification-metadata",
    "commandRef": "test:node:verification-metadata",
    "sourceRefs": [
      "tools/verification/verification_domains.mjs",
      "tools/verification/verification_metadata_helpers.mjs",
      "tests/verification_metadata_behavior.test.mjs",
      "docs/testing/verification-metadata.md",
      "docs/active/development-loop-simplification-20260905",
      "docs/archive/worktree-registry-history-through-20260831.md",
      "package.json"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 7,
    "selectorOrder": 6,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:verification-profile",
    "commandRef": "test:node:verification-profile",
    "sourceRefs": [
      ".github/workflows/nightly-verification.yml",
      ".github/workflows/release-verification.yml",
      "package.json",
      "tests/test_e2e_structural_tooling.py",
      "tests/verification_metadata_behavior.test.mjs",
      "tests/verification_script_portfolio_behavior.test.mjs",
      "tests/verify_core_runner_behavior.test.mjs",
      "tools/ai_test_supervisor/domain_registry.json",
      "tools/run_adaptive_tests.mjs",
      "tools/select_verification_targets.mjs",
      "tools/test_route_registry.mjs",
      "tools/verification/script_portfolio.mjs",
      ...VERIFICATION_CATALOG_SOURCE_FILES,
      "tools/verification/verification_domains.mjs",
      "tests/verification_profile_behavior.test.mjs",
      "tools/verification/verification_profile.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "entrypointPolicyIndex": 6,
    "verificationOrder": 1,
    "selectorOrder": 1,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:verification-script-portfolio",
    "commandRef": "verify:script-portfolio",
    "sourceRefs": [
      "package.json",
      "tools/verification/script_portfolio.mjs",
      "tools/verification/command_supersession.mjs",
      "tests/verification_script_portfolio_behavior.test.mjs",
      ".github/workflows/pr-verify.yml",
      ".github/workflows/verify-shared.yml",
      ".github/workflows/nightly-verification.yml",
      ".github/workflows/release-verification.yml"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 8,
    "selectorOrder": 7,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:verification-selector",
    "commandRef": "node tools/select_verification_targets.mjs --check",
    "sourceRefs": [
      ".github/workflows/nightly-verification.yml",
      ".github/workflows/release-verification.yml",
      "package.json",
      "tests/test_e2e_structural_tooling.py",
      "tests/verification_metadata_behavior.test.mjs",
      "tests/verification_script_portfolio_behavior.test.mjs",
      "tests/verify_core_runner_behavior.test.mjs",
      "tools/ai_test_supervisor/domain_registry.json",
      "tools/run_adaptive_tests.mjs",
      "tools/select_verification_targets.mjs",
      "tools/test_route_registry.mjs",
      "tools/verification/script_portfolio.mjs",
      ...VERIFICATION_CATALOG_SOURCE_FILES,
      "tools/verification/verification_domains.mjs",
      "tests/verification_profile_behavior.test.mjs",
      "tools/verification/verification_profile.mjs",
      ".gitignore",
      "tools/verification/command_supersession.mjs",
      ".github/workflows/pr-verify.yml",
      ".github/workflows/verify-shared.yml"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    // Local metadata tests run schema and discovered-coverage checks in-process.
    // The standalone selector remains an explicit commit/core/PR obligation.
    "entrypointPolicyIndex": 4,
    "verificationOrder": 3,
    "selectorOrder": 3,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:repository-footprint-report",
    "commandRef": "node --test tests/repository_footprint_behavior.test.mjs",
    "sourceRefs": [
      ".github/workflows/repository-footprint-report.yml",
      "tests/repository_footprint_behavior.test.mjs",
      "tools/repository_footprint",
      "tools/repository_footprint.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 131,
    "selectorOrder": 382,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:windows-job-runtime-contract",
    "commandRef": "test:node:windows-job-runtime",
    "sourceRefs": [
      "tools/process_containment/windows_job_runtime.mjs",
      "tools/process_containment/windows_job_runner_v2.cs",
      "tools/process_containment/windows_job_runner_core.cs",
      "tests/windows_job_runner_v2_native_contract.test.mjs",
      "tests/windows_job_runtime_behavior.test.mjs",
      "package.json"
    ],
    "ownerHints": [
      "process-containment"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 85,
    "selectorOrder": 72,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:windows-job-runtime-integration",
    "commandRef": "test:node:windows-job-runtime:integration",
    "sourceRefs": [
      "tools/process_containment/windows_job_runtime.mjs",
      "tools/process_containment/windows_job_runner_v2.cs",
      "tools/process_containment/windows_job_runner_core.cs",
      "tests/windows_job_runtime_integration.test.mjs",
      "package.json"
    ],
    "ownerHints": [
      "process-containment"
    ],
    "domains": [
      "test-routing"
    ],
    "tiers": [
      "regression"
    ],
    "cost": "contract",
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
      "win32"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 86,
    "selectorOrder": 73,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "test-routing",
      "routeRegistry": true,
      "optionalMainThread": true
    },
    "selector": {}
  },
  {
    "id": "node:test:node:supervisor-contracts",
    "commandRef": "test:node:supervisor-contracts",
    "sourceRefs": [
      "tests/supervisor_domain_registry_behavior.test.mjs",
      "tests/supervisor_schema_contracts.test.mjs",
      "tools/ai_test_supervisor/check_supervisor_schemas.mjs",
      "tools/test_route_registry.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "selectorOrder": 334,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:supervisor-plan",
    "commandRef": "test:node:supervisor-plan",
    "sourceRefs": [
      "tests/supervisor_change_dossier_behavior.test.mjs",
      "tests/supervisor_plan_behavior.test.mjs",
      "tools/ai_test_supervisor/build_change_dossier.mjs",
      "tools/ai_test_supervisor/command_lanes.mjs",
      "tools/ai_test_supervisor/render_supervisor_markdown.mjs",
      "tools/ai_test_supervisor/supervise_adaptive_verification.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "selectorOrder": 336,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:supervisor-routing",
    "commandRef": "test:node:supervisor-routing",
    "sourceRefs": [
      "tests/supervisor_adaptive_route_behavior.test.mjs",
      "tools/run_adaptive_tests.mjs",
      "tools/select_verification_targets.mjs",
      "tools/test_route_registry.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "selectorOrder": 335,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:verification-metadata",
    "commandRef": "test:node:verification-metadata",
    "sourceRefs": [
      "tests/verification_metadata_behavior.test.mjs",
      "tools/run_core_verification.mjs",
      "tools/select_verification_targets.mjs",
      "tools/test_route_registry.mjs",
      "tools/verification/verification_catalog_projection.mjs",
      ...VERIFICATION_CATALOG_SOURCE_FILES,
      "tools/verification/verification_domains.mjs",
      "tools/verification/verification_metadata_helpers.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "selectorOrder": 339,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:verification-profile",
    "commandRef": "test:node:verification-profile",
    "sourceRefs": [
      "tests/verification_profile_behavior.test.mjs",
      "tools/verification/verification_catalog_projection.mjs",
      "tools/verification/verification_profile.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "entrypointPolicyIndex": 6,
    "verificationOrder": null,
    "selectorOrder": 338,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:verify-core-runner",
    "commandRef": "test:node:verify-core-runner",
    "sourceRefs": [
      "tests/verify_core_runner_behavior.test.mjs",
      "tools/run_adaptive_tests.mjs",
      "tools/run_core_verification.mjs",
      "tools/select_verification_targets.mjs",
      "tools/test_route_registry.mjs",
      "tools/verification/command_supersession.mjs",
      "tools/verification/resumable_verification.mjs",
      "tools/verification/script_portfolio.mjs",
      "tools/verification/verification_catalog_projection.mjs",
      "tools/verification/verification_domains.mjs",
      "tools/verification/verification_profile.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "selectorOrder": 337,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:williams-crossover-governance",
    "commandRef": "test:node:williams-crossover-governance",
    "sourceRefs": [
      "tests/williams_crossover_governance_behavior.test.mjs",
      "docs/archive/renderer-frame-orchestration-p2-20260710/rerun08-harness-recovery-governance.md",
      "tools/perf/render_sample_role_policy.mjs",
      "tools/perf/run_williams_crossover.mjs",
      "tools/perf/standard_perf_admission.mjs",
      "tools/perf/williams_crossover_policy.mjs",
      "tools/perf/williams_crossover_power_scheme.ps1",
      "tools/perf/williams_crossover_windows_runtime.mjs",
      "tools/process_containment/ordered_source_set_identity.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": null,
    "selectorOrder": 212,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:williams-crossover-job-runner",
    "commandRef": "test:node:williams-crossover-job-runner",
    "sourceRefs": [
      "tests/williams_crossover_windows_job_runner_behavior.test.mjs",
      "tests/williams_crossover_windows_job_runner_integration.test.mjs",
      "tools/perf/run_williams_crossover.mjs",
      "tools/perf/williams_crossover_windows_job_runner.cs",
      "tools/perf/williams_crossover_windows_runtime.mjs",
      "tools/process_containment/windows_job_runner_core.cs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": null,
    "selectorOrder": 213,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:williams-crossover-telemetry-live",
    "commandRef": "test:node:williams-crossover-telemetry-live",
    "sourceRefs": [
      "tests/williams_crossover_windows_job_runner_integration.test.mjs",
      "tools/perf/williams_crossover_windows_runtime.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "entrypointPolicyIndex": 2,
    "verificationOrder": null,
    "selectorOrder": 216,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:windows-job-runtime",
    "commandRef": "test:node:windows-job-runtime",
    "sourceRefs": [
      "tests/windows_job_runner_v2_native_contract.test.mjs",
      "tests/windows_job_runtime_behavior.test.mjs",
      "tools/process_containment/windows_job_runtime.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": null,
    "selectorOrder": 214,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:windows-job-runtime:integration",
    "commandRef": "test:node:windows-job-runtime:integration",
    "sourceRefs": [
      "tests/windows_job_runtime_integration.test.mjs",
      "tools/process_containment/windows_job_runtime.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 215,
    "verification": null,
    "selector": {}
  },
  {
    "id": "verify-core-main-thread:test:e2e:interaction-funnel",
    "commandRef": "test:e2e:interaction-funnel",
    "sourceRefs": [
      "package.json",
      "tests/e2e"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
    ],
    "tiers": [
      "smoke"
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
    "verificationOrder": 125,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreMainThread": true,
      "supervisorDomain": "test-routing"
    },
    "selector": null
  },
  {
    "id": "verify-core-main-thread:test:e2e:project-save-load",
    "commandRef": "test:e2e:project-save-load",
    "sourceRefs": [
      "package.json",
      "tests/e2e"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
    ],
    "tiers": [
      "smoke"
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
    "verificationOrder": 124,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreMainThread": true,
      "supervisorDomain": "test-routing"
    },
    "selector": null
  },
  {
    "id": "verify-core-main-thread:test:e2e:scenario-apply-concurrency",
    "commandRef": "test:e2e:scenario-apply-concurrency",
    "sourceRefs": [
      "package.json",
      "tests/e2e"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
    ],
    "tiers": [
      "smoke"
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
    "verificationOrder": 123,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreMainThread": true,
      "supervisorDomain": "test-routing"
    },
    "selector": null
  },
  {
    "id": "verify-core-main-thread:test:e2e:smoke",
    "commandRef": "test:e2e:smoke",
    "sourceRefs": [
      "package.json",
      "tests/e2e"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
    ],
    "tiers": [
      "smoke"
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
    "verificationOrder": 122,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreMainThread": true,
      "supervisorDomain": "test-routing"
    },
    "selector": null
  },
  {
    "id": "verify-core-optional:test:e2e:city-rendering",
    "commandRef": "test:e2e:city-rendering",
    "sourceRefs": [
      "package.json",
      "tests/e2e"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 128,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "optionalMainThread": true,
      "supervisorDomain": "test-routing"
    },
    "selector": null
  },
  {
    "id": "verify-core-optional:test:e2e:tno-contracts",
    "commandRef": "test:e2e:tno-contracts",
    "sourceRefs": [
      "package.json",
      "tests/e2e"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 126,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "optionalMainThread": true,
      "supervisorDomain": "test-routing"
    },
    "selector": null
  },
  {
    "id": "verify-core-optional:test:e2e:water-rendering",
    "commandRef": "test:e2e:water-rendering",
    "sourceRefs": [
      "package.json",
      "tests/e2e"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 127,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "optionalMainThread": true,
      "supervisorDomain": "test-routing"
    },
    "selector": null
  },
  {
    "id": "verify-core:python-quick",
    "commandRef": "npm run python -- -m unittest tests.test_app_entry_resolver tests.test_main_deferred_detail_promotion_boundary_contract tests.test_scenario_chunk_refresh_contracts tests.test_scenario_renderer_bridge_boundary_contract tests.test_map_renderer_interaction_border_snapshot_orchestration_contract tests.test_perf_gate_contract tests.test_startup_shell -q",
    "sourceRefs": [
      "tests/test_app_entry_resolver.py",
      "tests/test_main_deferred_detail_promotion_boundary_contract.py",
      "tests/test_scenario_chunk_refresh_contracts.py",
      "tests/test_scenario_renderer_bridge_boundary_contract.py",
      "tests/test_map_renderer_interaction_border_snapshot_orchestration_contract.py",
      "tests/test_perf_gate_contract.py",
      "tests/test_startup_shell.py"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 33,
    "selectorOrder": null,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "verifyCoreDefaultGroup": "python-quick",
      "supervisorDomain": "test-routing"
    },
    "selector": null
  },
  {
    "id": "verify-core:supervisor-plan",
    "commandRef": "verify:supervisor-plan",
    "sourceRefs": [
      "tools/ai_test_supervisor/supervise_adaptive_verification.mjs",
      "tests/supervisor_plan_behavior.test.mjs"
    ],
    "ownerHints": [
      "test-infra"
    ],
    "domains": [
      "test-routing"
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
    "verificationOrder": 32,
    "selectorOrder": null,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "infra",
      "supervisorDomain": "test-routing"
    },
    "selector": null
  },
  {
    "id": "infra:p4-nightly-parallel-authorities",
    "commandRef": "node --test tests/p4_nightly_parallel_authorities_behavior.test.mjs tests/p4_nightly_exact_repair_behavior.test.mjs",
    "sourceRefs": [
      ".github/workflows/nightly-verification.yml",
      ".github/workflows/p4-nightly-selective-repair.yml",
      "tests/p4_nightly_exact_repair_behavior.test.mjs",
      "tests/p4_nightly_parallel_authorities_behavior.test.mjs",
      "tests/test_e2e_structural_tooling.py",
      "tools/verification/p4_nightly_authority.mjs",
      "tools/verification/p4_nightly_closeout.mjs",
      "tools/verification/p4_nightly_receipt_resolver.mjs",
      "tools/verification/p4_nightly_repair.mjs",
      "tools/verification/state_writer_policy_evidence.mjs",
      "tools/verification/p4_state_writer_policy_test_lifecycle.mjs",
      "tools/run_p4_state_writer_policy_tests.mjs"
    ],
    "ownerHints": ["test-infra"],
    "domains": ["test-routing"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 132,
    "selectorOrder": 383,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:p4-repository-analysis-bundle",
    "commandRef": "node --test tests/p4_repository_analysis_bundle_behavior.test.mjs",
    "sourceRefs": [
      "tests/fixtures/p4_repository_analysis_bundle_source.json",
      "tests/p4_repository_analysis_bundle_behavior.test.mjs",
      "tools/build_state_writer_policy.mjs",
      "tools/verification/p4_repository_analysis_bundle.mjs",
      "tools/verification/p4_repository_analysis_bundle.schema.json",
      "tools/verification/p4_repository_analysis_bundle_adapters.mjs",
      "tools/verification/p4_repository_analysis_bundle_git.mjs",
      "tools/verification/p4_repository_analysis_bundle_receipt.mjs",
      "tools/verification/p4_repository_analysis_bundle_receipt.schema.json"
    ],
    "ownerHints": ["test-infra"],
    "domains": ["test-routing"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 133,
    "selectorOrder": 384,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:p4-repository-analysis-bundle-live-shadow",
    "commandRef": "node --input-type=module -e \"process.env.M9_LIVE_REPOSITORY_SHADOW='1'; await import('./tests/p4_repository_analysis_bundle_live_shadow.test.mjs')\"",
    "sourceRefs": [
      "tests/p4_repository_analysis_bundle_live_shadow.test.mjs",
      "tools/build_state_writer_policy.mjs",
      "tools/check_state_writer_policy.mjs",
      "tools/verification/p4_repository_analysis_bundle.mjs",
      "tools/verification/p4_repository_analysis_bundle.schema.json",
      "tools/verification/p4_repository_analysis_bundle_adapters.mjs",
      "tools/verification/p4_repository_analysis_bundle_git.mjs",
      "tools/verification/p4_repository_analysis_bundle_receipt.mjs",
      "tools/verification/p4_repository_analysis_bundle_receipt.schema.json"
    ],
    "ownerHints": ["test-infra"],
    "domains": ["test-routing"],
    "tiers": ["heavy"],
    "cost": "heavy",
    "resourceLocks": [".runtime-output"],
    "executionOwners": ["main-thread"],
    "profiles": ["full"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 0,
    "verificationOrder": 134,
    "selectorOrder": 385,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "supervisorDomain": "test-routing",
      "routeRegistry": true,
      "optionalMainThread": true
    },
    "selector": {}
  },
  {
    "id": "infra:dependency-checkout-artifacts",
    "commandRef": "node --test tests/dependency_checkout_artifacts_behavior.test.mjs tests/dependency_checkout_profiles_behavior.test.mjs",
    "sourceRefs": [
      "tests/dependency_checkout_artifacts_behavior.test.mjs",
      "tests/dependency_checkout_profiles_behavior.test.mjs",
      "tools/verification/dependency_checkout_artifacts.mjs",
      "tools/verification/dependency_checkout_profile.schema.json",
      "tools/verification/dependency_checkout_profiles.mjs"
    ],
    "ownerHints": ["test-infra"],
    "domains": ["test-routing"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 135,
    "selectorOrder": 386,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:python-import-closure",
    "commandRef": "python -m unittest tests.test_python_import_closure -q",
    "sourceRefs": [
      "tests/test_python_import_closure.py",
      "tools/verification/python_import_closure.py"
    ],
    "ownerHints": ["test-infra"],
    "domains": ["test-routing"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 136,
    "selectorOrder": 387,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "infra:migration-ledger",
    "commandRef": "node --test tests/migration_ledger_behavior.test.mjs",
    "sourceRefs": [
      "tests/migration_ledger_behavior.test.mjs",
      "tools/verification/migration_ledger.json",
      "tools/verification/migration_ledger.schema.json",
      "tools/verification/migration_ledger_validator.mjs"
    ],
    "ownerHints": ["test-infra"],
    "domains": ["test-routing"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": 137,
    "selectorOrder": 388,
    "verification": {
      "commandType": "direct",
      "packageScriptRequired": false,
      "supervisorDomain": "test-routing",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "node:test:node:catalog-projection-history",
    "commandRef": "test:node:catalog-projection-history",
    "sourceRefs": [
      "tools/verification/catalog_projection_shadow.mjs",
      "tools/verification/catalog_projection_legacy.mjs",
      "tools/verification/catalog_projection_historical_baseline.json",
      "tools/verification/catalog_projection_shadow_cli.mjs",
      "tests/catalog_projection_shadow_behavior.test.mjs"
    ],
    "ownerHints": ["test-infra"],
    "domains": ["test-routing"],
    "tiers": ["contract"],
    "cost": "fast",
    "resourceLocks": [],
    "executionOwners": ["child-safe"],
    "profiles": ["pr-fast"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 4,
    "verificationOrder": null,
    "selectorOrder": 399,
    "verification": null,
    "selector": {}
  }
];
