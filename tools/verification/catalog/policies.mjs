// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
// entrypointPolicies positions are persisted record indices; preserve their order.
export const CATALOG_POLICIES = {
  "schemaVersion": 1,
  "kind": "verification-metadata-source",
  "enums": {
    "resourceLocks": [
      "browser-dev-server",
      "perf-dev-server",
      "playwright-browser",
      "dist",
      ".runtime-output",
      "scenario-data",
      "heavy-geo",
      "checkpoint-builder",
      "system-power-scheme"
    ],
    "executionOwners": [
      "child-safe",
      "main-thread",
      "ci-only"
    ],
    "costs": [
      "fast",
      "contract",
      "heavy"
    ],
    "layers": [
      "smoke",
      "contract",
      "regression",
      "feature",
      "heavy"
    ],
    "ciProfiles": [
      "pr-fast",
      "pr-smoke",
      "demo",
      "full",
      "deploy-minimal",
      "perf-pr-gate",
      "scenario-contract-matrix"
    ],
    "platforms": [
      "all",
      "win32",
      "linux",
      "darwin"
    ],
    "entrypointDepths": [
      "local",
      "pr",
      "nightly",
      "release"
    ],
    "entrypointIds": [
      "edit",
      "impact",
      "pr",
      "nightly",
      "release"
    ]
  },
  "projectionAuthority": {
    "schemaVersion": 1,
    "kind": "verification-catalog-projection-authority",
    "heavyDependencyGroups": [
      {
        "id": "geo_stack",
        "description": "Tests that import geospatial/scientific packages (geopandas/shapely/rasterio/numpy family).",
        "patterns": [
          "tests/test_urban_topology_contract.py",
          "tests/test_tno_bundle_builder.py",
          "tests/test_scenario_chunk_assets.py",
          "tests/test_tno_water_geometries.py",
          "tests/test_tno_named_marginal_water_contract.py",
          "tests/test_physical_context_contours.py",
          "tests/test_patch_checked_in_urban_artifacts.py",
          "tests/test_city_assets.py",
          "tests/test_city_data_contract.py",
          "tests/test_reviewed_place_names.py",
          "tests/test_global_transport_builder_contracts.py",
          "tests/test_landing_map_asset_contracts.py",
          "tests/test_local_canonicalization.py",
          "tests/test_pages_dist_startup_shell_heavy.py",
          "tests/test_political_topology_gap_contract.py",
          "tests/test_polar_water_spherical_safety.py",
          "tests/test_transport_country_source_contracts.py"
        ]
      }
    ],
    "prProfiles": [
      "demo",
      "perf-pr-gate",
      "pr-fast",
      "pr-smoke"
    ],
    "nightlyRoles": [
      { "id": "browser", "shards": ["browser"] },
      { "id": "final", "shards": ["final"] },
      { "id": "linux-core", "shards": ["1", "2", "3"] },
      { "id": "metadata", "shards": ["metadata"] },
      { "id": "p4-checker-boundaries", "shards": ["p4-checker-boundaries"] },
      { "id": "p4-closeout", "shards": ["p4-closeout"] },
      { "id": "p4-fast", "shards": ["p4-fast"] },
      { "id": "p4-full-policy", "shards": ["p4-full-policy"] },
      { "id": "pages", "shards": ["pages"] },
      { "id": "pages-artifact-shadow", "shards": ["pages-artifact-shadow"] },
      { "id": "scenario-heavy", "shards": ["scenario-heavy"] },
      { "id": "windows-governance", "shards": ["windows-governance"] }
    ],
    "nightlyFinalDependencies": ["metadata", "linux-core", "pages", "pages-artifact-shadow", "browser", "scenario-heavy", "p4-closeout", "windows-governance"],
    "documentation": {
      "sourceRefPrefixes": ["docs/"]
    }
  },
  "commandRefs": {
    "selectorSanity": "node tools/select_verification_targets.mjs --check",
    "adaptiveRecursive": "node tools/run_adaptive_tests.mjs --entrypoint impact --execute --defer-main-thread",
    "exactDirect": [
      "node tools/select_verification_targets.mjs --check",
      "node tools/run_adaptive_tests.mjs --entrypoint impact --execute --defer-main-thread"
    ]
  },
  "verifyCoreGroups": [
    {
      "id": "infra",
      "title": "Infrastructure contracts"
    },
    {
      "id": "python-quick",
      "title": "Quick Python contracts"
    },
    {
      "id": "startup-node",
      "title": "Startup Node contracts"
    },
    {
      "id": "renderer-owner",
      "title": "Renderer owner contracts"
    },
    {
      "id": "scenario-project-chunk",
      "title": "Scenario, project, and chunk contracts"
    },
    {
      "id": "pages",
      "title": "Pages contract checks"
    }
  ],
  "verifyCoreMainThreadGroup": {
    "id": "main-thread-e2e",
    "title": "Main-thread E2E checks"
  },
  "estimatePolicy": {
    "schemaVersion": 1,
    "kind": "verification-estimate-policy",
    "aggregation": "sum-process-group-base-plus-leaf-scale",
    // Windows local measurements, 2026-09-06: each of these five leaves ran
    // in a 0.3s process group. Keep headroom; unmeasured leaves retain defaults.
    "localRuntimeCalibration": {
      "platform": "win32",
      "cost": "fast",
      "groupBaseRuntimeSeconds": 1,
      "perLeafRuntimeSeconds": 1,
      "leafIds": [
        "node-test:tests/border_mesh_owner_behavior.test.mjs",
        "node-test:tests/border_draw_owner_behavior.test.mjs",
        "node-test:tests/country_inspector_model_behavior.test.mjs",
        "node-test:tests/country_inspector_controller_behavior.test.mjs",
        "node-test:tests/workspace_chrome_support_surface_controller_behavior.test.mjs"
      ]
    },
    "costClasses": {
      "fast": {
        "groupBaseRuntimeSeconds": 20,
        "perLeafRuntimeSeconds": 5,
        "groupBaseCostUnits": 0.5,
        "perLeafCostUnits": 0.25
      },
      "contract": {
        "groupBaseRuntimeSeconds": 30,
        "perLeafRuntimeSeconds": 10,
        "groupBaseCostUnits": 1,
        "perLeafCostUnits": 0.5
      },
      "heavy": {
        "groupBaseRuntimeSeconds": 120,
        "perLeafRuntimeSeconds": 30,
        "groupBaseCostUnits": 4,
        "perLeafCostUnits": 1
      }
    }
  },
  "gatePolicy": {
    "schemaVersion": 1,
    "kind": "verification-gate-policy-authority",
    "phase": "stabilization-cost-collapse-v2-pr-phase-1a",
    "mode": "observation-only",
    "requiredExecutionSetEffect": "unchanged",
    "sharedRisks": [
      {
        "id": "canonical-selection-closure",
        "description": "Canonical matched command authority is complete and contains no signal match."
      },
      {
        "id": "selection-authority-gap",
        "description": "Changed-file selection lacks complete canonical authority and must remain unknown."
      }
    ],
    "signals": {
      "requiresStrictTno": {
        "matchAny": {
          "domains": ["scenario-contracts", "tno-coverage-chain", "tno-scenario", "tno-startup", "tno-water"],
          "sourceRefs": ["data/scenarios/tno_1962"],
          "entrypoints": [],
          "sharedRisks": []
        }
      },
      "requiresDemo": {
        "matchAny": {
          "domains": ["public-sample"],
          "sourceRefs": [".github/workflows/pr-verify.yml", ".github/workflows/verify-shared.yml"],
          "entrypoints": [],
          "sharedRisks": []
        }
      },
      "requiresTestInfra": {
        "matchAny": {
          "domains": ["playwright-observability", "test-routing"],
          "sourceRefs": [],
          "entrypoints": [],
          "sharedRisks": []
        }
      },
      "requiresDeployPreflight": {
        "matchAny": {
          "domains": ["pages-dist", "release-smoke"],
          "sourceRefs": [],
          "entrypoints": ["release"],
          "sharedRisks": []
        }
      }
    }
  },
  "entrypointPolicies": [
    {
      "schemaVersion": 1,
      "eligibleEntrypoints": [
        "nightly"
      ],
      "minimumDepth": "nightly",
      "executionTarget": "main-thread",
      "deferredReason": "requires-nightly-verification",
      "plannerDisposition": "planned",
      "blockedReason": null,
      "localProjection": null
    },
    {
      "schemaVersion": 1,
      "eligibleEntrypoints": [
        "release"
      ],
      "minimumDepth": "release",
      "executionTarget": "deployed-target",
      "deferredReason": "requires-release-verification",
      "plannerDisposition": "planned",
      "blockedReason": null,
      "localProjection": null
    },
    {
      "schemaVersion": 1,
      "eligibleEntrypoints": [
        "pr"
      ],
      "minimumDepth": "pr",
      "executionTarget": "main-thread",
      "deferredReason": "requires-pr-verification",
      "plannerDisposition": "planned",
      "blockedReason": null,
      "localProjection": null
    },
    {
      "schemaVersion": 1,
      "eligibleEntrypoints": [
        "edit",
        "impact",
        "pr"
      ],
      "minimumDepth": "local",
      "executionTarget": "child-safe",
      "deferredReason": null,
      "plannerDisposition": "blocked",
      "blockedReason": "adaptive-recursion-forbidden",
      "localProjection": null
    },
    {
      "schemaVersion": 1,
      "eligibleEntrypoints": [
        "pr"
      ],
      "minimumDepth": "pr",
      "executionTarget": "child-safe",
      "deferredReason": "requires-pr-verification",
      "plannerDisposition": "planned",
      "blockedReason": null,
      "localProjection": null
    },
    {
      "schemaVersion": 1,
      "eligibleEntrypoints": [
        "edit",
        "impact",
        "pr"
      ],
      "minimumDepth": "local",
      "executionTarget": "child-safe",
      "deferredReason": null,
      "plannerDisposition": "planned",
      "blockedReason": null,
      "localProjection": {
        "mode": "indivisible",
        "proof": "canonical-local-leaf-equivalence"
      }
    },
    {
      "schemaVersion": 1,
      "eligibleEntrypoints": [
        "edit",
        "impact",
        "pr"
      ],
      "minimumDepth": "local",
      "executionTarget": "child-safe",
      "deferredReason": null,
      "plannerDisposition": "planned",
      "blockedReason": null,
      "localProjection": null
    }
  ],
  "canonicalEntrypoints": {
    "tier": [
      {
        "tier": 0,
        "id": "commit",
        "commandRef": "verify:commit",
        "executionScope": "child-safe",
        "commitProjection": {
          "controlPlaneRecordIds": ["infra:local-verification-closure", "local:owner:commit-runner"],
          "controlPlaneCommandRefs": [
            "test:node:verification-metadata",
            "test:node:verification-script-portfolio",
            "test:node:verify-core-runner"
          ]
        }
      },
      {
        "tier": 1,
        "id": "impact",
        "commandRef": "verify:impact",
        "executionScope": "child-safe"
      },
      {
        "tier": 2,
        "id": "pr",
        "commandRef": "verify:pr",
        "executionScope": "pr"
      },
      {
        "tier": 3,
        "id": "main",
        "commandRef": "verify:core",
        "executionScope": "main"
      },
      {
        "tier": 4,
        "id": "nightly",
        "commandRef": "verify:nightly",
        "executionScope": "nightly"
      },
      {
        "tier": 5,
        "id": "release",
        "commandRef": "verify:release",
        "executionScope": "release"
      }
    ],
    "productJourney": [
      {
        "id": "demo",
        "commandRef": "verify:demo",
        "consumer": "pr-verify-demo"
      }
    ]
  },
  "supersession": {
    "verify:supervisor-contracts": [
      "test:node:supervisor-contracts",
      "test:node:supervisor-routing"
    ],
    "verify:supervisor-plan": [
      "test:node:supervisor-plan"
    ],
    "verify:p4:p4-1": [
      "test:node:p4:p4-1",
      "test:python:p4:p4-1-boundary"
    ],
    "verify:p4:p4-2a": [
      "test:node:p4:p4-2a",
      "test:python:p4:p4-2a-boundary"
    ],
    "verify:p4:p4-2b": [
      "test:node:p4:p4-2b",
      "test:python:p4:p4-2b-boundary",
      "test:node:p4:state-writer-policy",
      "test:node:p4:state-writer-policy:quick"
    ],
    "verify:p4:p4-2c": [
      "test:node:p4:p4-2c",
      "test:python:p4:p4-2c-boundary",
      "test:node:p4:state-writer-policy",
      "test:node:p4:state-writer-policy:quick"
    ],
    "verify:p4:p4-3": [
      "test:node:p4:p4-3",
      "test:python:p4:p4-3-boundary",
      "verify:p4:state-writer-policy",
      "test:node:p4:state-writer-policy",
      "test:node:p4:state-writer-policy:quick"
    ],
    "verify:p4:p4-4": [
      "test:node:p4:p4-4",
      "test:python:p4:p4-4-boundary",
      "verify:p4:state-writer-policy",
      "test:node:p4:state-writer-policy",
      "test:node:p4:state-writer-policy:quick"
    ],
    "verify:p4:state-writer-policy": [
      "test:node:p4:state-writer-policy",
      "test:node:p4:state-writer-policy:quick"
    ],
    "test:node:p4:state-writer-policy": [
      "test:node:p4:state-writer-policy:quick"
    ],
    "test:node:p4:p4-2a": [
      "test:node:scenario-apply-transaction-ownership",
      "test:node:scenario-lifecycle-runtime-behavior",
      "test:node:scenario-runtime-state-behavior"
    ],
    "test:node:p4:p4-2b": [
      "test:node:scenario-chunk-contracts"
    ],
    "test:node:p4:p4-3": [
      "test:node:renderer-render-phase-lifecycle",
      "test:node:zoom-interaction-lifecycle-owner"
    ],
    "test:e2e:water-rendering": [
      "node tools/e2e_layering.mjs run-spec tests/e2e/river_layer_regression.spec.js",
      "node tools/e2e_layering.mjs run-spec tests/e2e/tno_named_water_rendering.spec.js",
      "node tools/e2e_layering.mjs run-spec tests/e2e/tno_open_ocean_rendering.spec.js",
      "node tools/e2e_layering.mjs run-spec tests/e2e/water_cache_strategy_regression.spec.js"
    ],
    "verify:tno-coverage-chain": [
      "verify:scenario-contracts:strict",
      "verify:tno-coverage-ledger",
      "verify:tno-atlantropa-coverage",
      "verify:tno-polar-coverage",
      "test:node:scenario-chunk-contracts"
    ],
    "verify:pages-dist-and-drift": [
      "test:py:landing-map-asset-contracts",
      "verify:pages-dist",
      "verify:dist-drift"
    ]
  }
};
