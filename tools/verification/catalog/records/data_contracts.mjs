// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const DATA_CONTRACTS_RECORDS = [
  {
    "id": "python:contour-lod-assets",
    "commandRef": "python -m unittest tests.test_build_contour_lod_assets -q",
    "sourceRefs": [
      "tests/test_build_contour_lod_assets.py",
      "map_builder/processors/physical_context.py",
      "map_builder/processors/contour_lod.py",
      "tools/build_contour_lod_assets.py",
      "data/global_contours.lod.provenance.json",
      "data/global_contours.low.major.topo.json",
      "data/global_contours.mid.major.topo.json",
      "data/global_contours.mid.minor.topo.json"
    ],
    "ownerHints": ["geo-contract"],
    "domains": ["geo-contract"],
    "tiers": ["heavy"],
    "cost": "heavy",
    "resourceLocks": ["heavy-geo", ".runtime-output"],
    "executionOwners": ["main-thread"],
    "profiles": ["full"],
    "platforms": ["all"],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": null,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/tno_named_water_rendering.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/tno_named_water_rendering.spec.js",
    "sourceRefs": [
      "tests/e2e/tno_named_water_rendering.spec.js"
    ],
    "ownerHints": [
      "scenario-tno"
    ],
    "domains": [
      "tno-water"
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
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 140,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/tno_open_ocean_rendering.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/tno_open_ocean_rendering.spec.js",
    "sourceRefs": [
      "tests/e2e/tno_open_ocean_rendering.spec.js"
    ],
    "ownerHints": [
      "scenario-tno"
    ],
    "domains": [
      "tno-water"
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
      "full"
    ],
    "platforms": [
      "all"
    ],
    "entrypointPolicyIndex": 0,
    "verificationOrder": null,
    "selectorOrder": 141,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/water_cache_strategy_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/water_cache_strategy_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/water_cache_strategy_regression.spec.js"
    ],
    "ownerHints": [
      "water-runtime"
    ],
    "domains": [
      "water-runtime"
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
    "verificationOrder": null,
    "selectorOrder": 151,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:data-health",
    "commandRef": "python tools/data_health.py --json",
    "sourceRefs": [
      "tools/data_health.py",
      "tools/build_data_catalog.py",
      "data/CATALOG.json",
      "data/runtime_asset_registry.json",
      "data/scenarios/index.json"
    ],
    "ownerHints": [
      "data-governance"
    ],
    "domains": [
      "data-governance"
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
    "selectorOrder": 103,
    "verification": null,
    "selector": {
      "guidance": {
        "taskEntry": [
          "Data catalog governance health gate"
        ],
        "ownerFiles": [
          "tools/data_health.py",
          "data/CATALOG.json",
          "data/runtime_asset_registry.json"
        ],
        "commonChecks": [
          "python tools/data_health.py --json"
        ],
        "riskSignals": [
          "catalog/runtime asset drift",
          "scenario registry coverage drift",
          "transport manifest path drift"
        ],
        "diagnostics": [
          "stdout JSON health report"
        ],
        "status": "active"
      }
    }
  },
  {
    "id": "infra:tno-polar-coverage",
    "commandRef": "verify:tno-polar-coverage",
    "sourceRefs": [
      "tools/validate_tno_water_geometries.py",
      "data/scenarios/tno_1962/runtime_topology.topo.json",
      "data/scenarios/tno_1962/water_regions.geojson"
    ],
    "ownerHints": [
      "tno-water"
    ],
    "domains": [
      "tno-water"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
      "scenario-data",
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
    "selectorOrder": 99,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:tno-water-validator",
    "commandRef": "python tools/validate_tno_water_geometries.py --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/tno_1962.polar_coverage_report.json",
    "sourceRefs": [
      "tools/validate_tno_water_geometries.py",
      "data/scenarios/tno_1962/water_regions.geojson",
      "data/scenarios/tno_1962/runtime_topology.topo.json",
      "data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json",
      "data/scenarios/tno_1962/detail_chunks.manifest.json",
      "data/scenarios/tno_1962/chunks/water"
    ],
    "ownerHints": [
      "tno-water"
    ],
    "domains": [
      "tno-water"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
      "scenario-data",
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
    "selectorOrder": 102,
    "verification": null,
    "selector": {
      "guidance": {
        "taskEntry": [
          "TNO water geometry health gate"
        ],
        "ownerFiles": [
          "tools/validate_tno_water_geometries.py",
          "data/scenarios/tno_1962/water_regions.geojson",
          "data/scenarios/tno_1962/detail_chunks.manifest.json"
        ],
        "commonChecks": [
          "python tools/validate_tno_water_geometries.py --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/tno_1962.polar_coverage_report.json"
        ],
        "riskSignals": [
          "water geometry source/runtime drift",
          "chunk manifest coverage drift",
          "D3 spherical safety regression"
        ],
        "diagnostics": [
          ".runtime/reports/generated/tno_1962.polar_coverage_report.json"
        ],
        "status": "active"
      }
    }
  },
  {
    "id": "python-heavy:geo_stack:tests/test_landing_map_asset_contracts.py",
    "commandRef": "python -m unittest tests.test_landing_map_asset_contracts -q",
    "sourceRefs": [
      "tests/test_landing_map_asset_contracts.py"
    ],
    "ownerHints": [
      "geo-contract"
    ],
    "domains": [
      "geo-contract"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 383,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_local_canonicalization.py",
    "commandRef": "python -m unittest tests.test_local_canonicalization -q",
    "sourceRefs": [
      "tests/test_local_canonicalization.py"
    ],
    "ownerHints": [
      "geo-contract"
    ],
    "domains": [
      "geo-contract"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 370,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_pages_dist_startup_shell_heavy.py",
    "commandRef": "python -m unittest tests.test_pages_dist_startup_shell_heavy -q",
    "sourceRefs": [
      "tests/test_pages_dist_startup_shell_heavy.py"
    ],
    "ownerHints": [
      "geo-contract"
    ],
    "domains": [
      "geo-contract"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 371,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_physical_context_contours.py",
    "commandRef": "python -m unittest tests.test_physical_context_contours -q",
    "sourceRefs": [
      "tests/test_physical_context_contours.py",
      "map_builder/processors/physical_context.py"
    ],
    "ownerHints": [
      "geo-contract"
    ],
    "domains": [
      "geo-contract"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 366,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_political_topology_gap_contract.py",
    "commandRef": "python -m unittest tests.test_political_topology_gap_contract -q",
    "sourceRefs": [
      "tests/test_political_topology_gap_contract.py"
    ],
    "ownerHints": [
      "geo-contract"
    ],
    "domains": [
      "geo-contract"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 372,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_scenario_chunk_assets.py",
    "commandRef": "python -m unittest tests.test_scenario_chunk_assets -q",
    "sourceRefs": [
      "tests/test_scenario_chunk_assets.py"
    ],
    "ownerHints": [
      "geo-contract"
    ],
    "domains": [
      "geo-contract"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 363,
    "verification": null,
    "selector": {}
  },
  {
    "id": "direct:tno-startup-support-output-identity",
    "commandRef": "python -m unittest tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_build_startup_support_stage_admits_and_records_content_addressed_identity tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_startup_support_stage_restores_matching_content_addressed_artifact tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_startup_support_rollback_failure_preserves_backup_and_raises_fatal_error -q",
    "sourceRefs": [
      "map_builder/content_addressed_artifact_cache.py",
      "tests/test_tno_bundle_builder.py",
      "tools/patch_tno_1962_bundle.py"
    ],
    "ownerHints": [
      "geo-contract"
    ],
    "domains": [
      "geo-contract"
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
    "selectorOrder": 392,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_tno_bundle_builder.py",
    "commandRef": "python -m unittest tests.test_tno_bundle_builder -q",
    "sourceRefs": [
      "tests/test_tno_bundle_builder.py",
      "tools/patch_tno_1962_bundle.py"
    ],
    "ownerHints": [
      "geo-contract"
    ],
    "domains": [
      "geo-contract"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 362,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_tno_named_marginal_water_contract.py",
    "commandRef": "python -m pytest tests/test_tno_named_marginal_water_contract.py -q",
    "sourceRefs": [
      "tests/test_tno_named_marginal_water_contract.py"
    ],
    "ownerHints": [
      "tno-water"
    ],
    "domains": [
      "tno-water"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 365,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_tno_water_geometries.py",
    "commandRef": "python -m pytest tests/test_tno_water_geometries.py -q",
    "sourceRefs": [
      "tests/test_tno_water_geometries.py",
      "tools/patch_tno_1962_bundle.py"
    ],
    "ownerHints": [
      "tno-water"
    ],
    "domains": [
      "tno-water"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 364,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_polar_water_spherical_safety.py",
    "commandRef": "python -m pytest tests/test_polar_water_spherical_safety.py -q",
    "sourceRefs": [
      "tests/test_polar_water_spherical_safety.py"
    ],
    "ownerHints": [
      "tno-water"
    ],
    "domains": [
      "tno-water"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 378,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python:polar-water-spherical-safety",
    "commandRef": "python -m pytest tests/test_polar_water_spherical_safety.py -q",
    "sourceRefs": [
      "init_map_data.py",
      "map_builder/geo/topology.py",
      "map_builder/geo/spherical_safety.py",
      "data/europe_topology.json",
      "data/water_regions.geojson",
      "tests/test_polar_water_spherical_safety.py"
    ],
    "ownerHints": [
      "polar-water-spherical-safety"
    ],
    "domains": [
      "geo-contract"
    ],
    "tiers": [
      "heavy"
    ],
    "cost": "heavy",
    "resourceLocks": [
      "heavy-geo",
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
    "selectorOrder": 351,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python:tests.test_i18n_audit",
    "commandRef": "python -m unittest tests.test_i18n_audit -q",
    "sourceRefs": [
      "tests/test_i18n_audit.py",
      "tools/i18n_audit.py",
      "tools/translate_manager.py",
      "data/locales.json",
      "data/i18n/locales_baseline.json",
      "data/city_aliases.json",
      "data/geo_aliases.json",
      "data/hgo_catalogs/hgo_place_names.json",
      "data/hgo_catalogs/hgo_identity_aliases.json"
    ],
    "ownerHints": [
      "i18n-runtime"
    ],
    "domains": [
      "i18n-data"
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
    "selectorOrder": 356,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python:thematic-layer-contracts",
    "commandRef": "test:py:thematic-layer-contracts",
    "sourceRefs": [
      "tools/build_thematic_layers.py",
      "map_builder/thematic_layer_contracts.py",
      "map_builder/thematic_wgi_ingest.py",
      "map_builder/contracts.py",
      "map_builder/runtime_asset_registry.py",
      "data/thematic_layers",
      "data/manifest.json",
      "data/runtime_asset_registry.json",
      "tests/test_thematic_layer_contracts.py",
      "tests/test_thematic_wgi_source_ingest.py",
      "tests/fixtures/thematic_wgi_2024_minimal.csv"
    ],
    "ownerHints": [
      "thematic-layer-contracts"
    ],
    "domains": [
      "data-governance"
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
    "selectorOrder": 353,
    "verification": null,
    "selector": {}
  }
];
