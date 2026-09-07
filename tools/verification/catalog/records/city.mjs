// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const CITY_RECORDS = [
  {
    "id": "e2e:tests/e2e/city_label_i18n_redraw.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/city_label_i18n_redraw.spec.js",
    "sourceRefs": [
      "tests/e2e/city_label_i18n_redraw.spec.js"
    ],
    "ownerHints": [
      "map-city"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 105,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/city_lights_layer_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/city_lights_layer_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/city_lights_layer_regression.spec.js"
    ],
    "ownerHints": [
      "map-city"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 106,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/city_marker_visibility_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/city_marker_visibility_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/city_marker_visibility_regression.spec.js"
    ],
    "ownerHints": [
      "map-city"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 107,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/city_points_urban_runtime.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/city_points_urban_runtime.spec.js",
    "sourceRefs": [
      "tests/e2e/city_points_urban_runtime.spec.js"
    ],
    "ownerHints": [
      "map-city"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 108,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/city_reveal_plan_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/city_reveal_plan_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/city_reveal_plan_regression.spec.js"
    ],
    "ownerHints": [
      "map-city"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 109,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/city_urban_rendering_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/city_urban_rendering_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/city_urban_rendering_regression.spec.js"
    ],
    "ownerHints": [
      "map-city"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 110,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:appearance-city-points-owner",
    "commandRef": "test:node:appearance-city-points-owner",
    "sourceRefs": [
      "tests/appearance_city_points_owner_behavior.test.mjs",
      "js/ui/toolbar/appearance_city_points_owner.js"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 166,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:city-lights-assets",
    "commandRef": "test:node:city-lights-assets",
    "sourceRefs": [
      ".gitattributes",
      "tests/city_lights_asset_contract.test.mjs",
      "tests/test_data_manifest_contract.py",
      "tests/fixtures/city_lights/.gitattributes",
      "tests/fixtures/city_lights/modern_source_fixture.pgm",
      "tests/fixtures/city_lights/modern_source_fixture_descriptor.json",
      "tools/build_city_lights_modern_asset.py",
      "data/CATALOG.json",
      "data/CATALOG.md",
      "data/city_lights/.gitattributes",
      "data/city_lights/modern_source_descriptor.json",
      "data/city_lights/historical_1930_entries.json",
      "data/manifest.json",
      "data/runtime_asset_registry.json",
      "data/source_ledger.json",
      "js/core/city_lights_modern_asset.js",
      "js/core/city_lights_historical_1930_asset.js"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 157,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:city-lights-render-owner",
    "commandRef": "test:node:city-lights-render-owner",
    "sourceRefs": [
      "tests/city_lights_render_owner_behavior.test.mjs",
      "js/core/renderer/city_lights_render_owner.js",
      "js/core/state_defaults.js"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "verificationOrder": 128,
    "selectorOrder": 158,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "verifyCoreDefaultGroup": "renderer-owner",
      "supervisorDomain": "city-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "node:test:node:city-points-render-owner",
    "commandRef": "test:node:city-points-render-owner",
    "sourceRefs": [
      "tests/city_points_render_owner_behavior.test.mjs",
      "tests/urban_city_policy_strategic_values_behavior.test.mjs",
      "js/core/renderer/city_points_render_owner.js",
      "js/core/renderer/urban_city_policy.js",
      "js/core/renderer/city_reveal_policy.js"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 165,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:modern-city-lights-owner",
    "commandRef": "test:node:modern-city-lights-owner",
    "sourceRefs": [
      "tests/city_lights_render_owner_behavior.test.mjs",
      "js/core/renderer/city_lights_render_owner.js",
      "js/core/state_defaults.js"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 159,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:scenario-state-actions-atomicity",
    "commandRef": "test:node:scenario-state-actions-atomicity",
    "sourceRefs": [
      "tests/scenario_state_actions_atomicity_behavior.test.mjs",
      "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_apply_request_actions.js",
      "js/core/state/actions/scenario_palette_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js",
      "js/core/state/actions/scenario_readiness_actions.js"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 206,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:thematic-admin-metrics-loader",
    "commandRef": "test:node:thematic-admin-metrics-loader",
    "sourceRefs": [
      "tests/thematic_admin_metrics_loader_behavior.test.mjs",
      "data/thematic_layers/political/state_capacity_demo/manifest.json",
      "data/thematic_layers/political/state_capacity_demo/metrics.admin0.json",
      "data/thematic_layers/political/wgi_state_capacity_v1/manifest.json",
      "data/thematic_layers/political/wgi_state_capacity_v1/metrics.admin0.json",
      "data/thematic_layers/population/population_density_demo/manifest.json",
      "js/core/data_service.js",
      "js/core/thematic_admin_metrics_loader.js"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 178,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:thematic-layer-catalog",
    "commandRef": "test:node:thematic-layer-catalog",
    "sourceRefs": [
      "tests/thematic_layer_catalog_behavior.test.mjs",
      "tests/thematic_layer_preview_controller_behavior.test.mjs",
      "data/thematic_layers/index.json",
      "data/thematic_layers/political/state_capacity_demo/manifest.json",
      "data/thematic_layers/political/wgi_state_capacity_v1/manifest.json",
      "data/thematic_layers/population/population_density_demo/manifest.json",
      "data/thematic_layers/social/human_development_demo/manifest.json",
      "js/core/runtime_asset_registry.js",
      "js/core/thematic_layer_catalog.js",
      "js/ui/toolbar/thematic_layer_preview_controller.js"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 177,
    "verification": null,
    "selector": {}
  },
  {
    "id": "p3:pass-family:city-rendering",
    "commandRef": "test:e2e:city-rendering",
    "sourceRefs": [
      "js/core/renderer/visual_effects_pass_owner.js",
      "js/core/renderer/context_pass_orchestrator_owner.js"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "verificationOrder": 60,
    "selectorOrder": 47,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "city-runtime",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_city_assets.py",
    "commandRef": "python -m unittest tests.test_city_assets -q",
    "sourceRefs": [
      "tests/test_city_assets.py"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 368,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_patch_checked_in_urban_artifacts.py",
    "commandRef": "python -m unittest tests.test_patch_checked_in_urban_artifacts -q",
    "sourceRefs": [
      "tests/test_patch_checked_in_urban_artifacts.py"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 367,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_urban_topology_contract.py",
    "commandRef": "python -m pytest tests/test_urban_topology_contract.py -q",
    "sourceRefs": [
      "tests/test_urban_topology_contract.py"
    ],
    "ownerHints": [
      "city-runtime"
    ],
    "domains": [
      "city-runtime"
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
    "selectorOrder": 361,
    "verification": null,
    "selector": {}
  }
];
