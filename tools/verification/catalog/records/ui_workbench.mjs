// Internal catalog definitions. Consumers use verification_catalog_source.mjs.
export const UI_WORKBENCH_RECORDS = [
  {
    "id": "direct-e2e:test:e2e:dev:stage5-visual-acceptance",
    "commandRef": "test:e2e:dev:stage5-visual-acceptance",
    "sourceRefs": [
      "tests/e2e/dev/full_visual_acceptance.dev.spec.js"
    ],
    "ownerHints": [
      "dev-workspace"
    ],
    "domains": [
      "dev-workspace"
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
    "selectorOrder": 154,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/dev_workspace_i18n.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/dev_workspace_i18n.spec.js",
    "sourceRefs": [
      "tests/e2e/dev_workspace_i18n.spec.js"
    ],
    "ownerHints": [
      "dev-workspace"
    ],
    "domains": [
      "dev-workspace"
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
    "selectorOrder": 111,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/dev_workspace_render_boundary.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/dev_workspace_render_boundary.spec.js",
    "sourceRefs": [
      "tests/e2e/dev_workspace_render_boundary.spec.js"
    ],
    "ownerHints": [
      "dev-workspace"
    ],
    "domains": [
      "dev-workspace"
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
    "selectorOrder": 112,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/interaction_funnel_contract.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/interaction_funnel_contract.spec.js",
    "sourceRefs": [
      "tests/e2e/interaction_funnel_contract.spec.js"
    ],
    "ownerHints": [
      "ui-shell"
    ],
    "domains": [
      "shell-interaction"
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
    "selectorOrder": 115,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/main_shell_i18n.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/main_shell_i18n.spec.js",
    "sourceRefs": [
      "tests/e2e/main_shell_i18n.spec.js"
    ],
    "ownerHints": [
      "ui-shell"
    ],
    "domains": [
      "main-shell"
    ],
    "tiers": [
      "smoke"
    ],
    "cost": "fast",
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
    "entrypointPolicyIndex": 2,
    "verificationOrder": null,
    "selectorOrder": 116,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/physical_layer_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/physical_layer_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/physical_layer_regression.spec.js"
    ],
    "ownerHints": [
      "map-runtime"
    ],
    "domains": [
      "map-layer"
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
    "selectorOrder": 118,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/physical_layer_runtime_contract.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/physical_layer_runtime_contract.spec.js",
    "sourceRefs": [
      "tests/e2e/physical_layer_runtime_contract.spec.js"
    ],
    "ownerHints": [
      "map-runtime"
    ],
    "domains": [
      "map-layer"
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
    "selectorOrder": 119,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/project_save_load_roundtrip.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/project_save_load_roundtrip.spec.js",
    "sourceRefs": [
      "tests/e2e/project_save_load_roundtrip.spec.js"
    ],
    "ownerHints": [
      "project-persistence"
    ],
    "domains": [
      "project-io"
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
    "selectorOrder": 120,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/review_regressions.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/review_regressions.spec.js",
    "sourceRefs": [
      "tests/e2e/review_regressions.spec.js"
    ],
    "ownerHints": [
      "review-runtime"
    ],
    "domains": [
      "review-workspace"
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
    "selectorOrder": 121,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/river_layer_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/river_layer_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/river_layer_regression.spec.js"
    ],
    "ownerHints": [
      "map-runtime"
    ],
    "domains": [
      "map-layer"
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
    "selectorOrder": 122,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/shortcut_history_render_boundary.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/shortcut_history_render_boundary.spec.js",
    "sourceRefs": [
      "tests/e2e/shortcut_history_render_boundary.spec.js"
    ],
    "ownerHints": [
      "ui-shell"
    ],
    "domains": [
      "shortcut-history"
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
    "selectorOrder": 130,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/sidebar_default_collapse.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/sidebar_default_collapse.spec.js",
    "sourceRefs": [
      "tests/e2e/sidebar_default_collapse.spec.js"
    ],
    "ownerHints": [
      "ui-shell"
    ],
    "domains": [
      "sidebar-shell"
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
    "selectorOrder": 131,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/strategic_overlay_counter_canvas_smoke.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/strategic_overlay_counter_canvas_smoke.spec.js",
    "sourceRefs": [
      "tests/e2e/strategic_overlay_counter_canvas_smoke.spec.js"
    ],
    "ownerHints": [
      "overlay-runtime"
    ],
    "domains": [
      "strategic-overlay"
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
    "selectorOrder": 133,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/strategic_overlay_editing.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/strategic_overlay_editing.spec.js",
    "sourceRefs": [
      "tests/e2e/strategic_overlay_editing.spec.js"
    ],
    "ownerHints": [
      "overlay-runtime"
    ],
    "domains": [
      "strategic-overlay"
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
    "selectorOrder": 134,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/strategic_overlay_roundtrip.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/strategic_overlay_roundtrip.spec.js",
    "sourceRefs": [
      "tests/e2e/strategic_overlay_roundtrip.spec.js"
    ],
    "ownerHints": [
      "overlay-runtime"
    ],
    "domains": [
      "strategic-overlay"
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
    "selectorOrder": 135,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/strategic_overlay_sidebar_entry_smoke.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/strategic_overlay_sidebar_entry_smoke.spec.js",
    "sourceRefs": [
      "tests/e2e/strategic_overlay_sidebar_entry_smoke.spec.js"
    ],
    "ownerHints": [
      "overlay-runtime"
    ],
    "domains": [
      "strategic-overlay"
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
    "selectorOrder": 136,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/strategic_overlay_smoke.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/strategic_overlay_smoke.spec.js",
    "sourceRefs": [
      "tests/e2e/strategic_overlay_smoke.spec.js"
    ],
    "ownerHints": [
      "overlay-runtime"
    ],
    "domains": [
      "strategic-overlay"
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
    "selectorOrder": 137,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/texture_overlay_regression.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/texture_overlay_regression.spec.js",
    "sourceRefs": [
      "tests/e2e/texture_overlay_regression.spec.js"
    ],
    "ownerHints": [
      "overlay-runtime"
    ],
    "domains": [
      "texture-overlay"
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
    "selectorOrder": 138,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/transport_phase_b_main_map_smoke.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/transport_phase_b_main_map_smoke.spec.js",
    "sourceRefs": [
      "tests/e2e/transport_phase_b_main_map_smoke.spec.js"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 147,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/transport_workbench_country_pack_loading.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/transport_workbench_country_pack_loading.spec.js",
    "sourceRefs": [
      "tests/e2e/transport_workbench_country_pack_loading.spec.js"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 143,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/transport_workbench_industrial_variants.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/transport_workbench_industrial_variants.spec.js",
    "sourceRefs": [
      "tests/e2e/transport_workbench_industrial_variants.spec.js"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 144,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/transport_workbench_label_rotation.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/transport_workbench_label_rotation.spec.js",
    "sourceRefs": [
      "tests/e2e/transport_workbench_label_rotation.spec.js"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 145,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/transport_workbench_port_coverage_tiers.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/transport_workbench_port_coverage_tiers.spec.js",
    "sourceRefs": [
      "tests/e2e/transport_workbench_port_coverage_tiers.spec.js"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 146,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/ui_contract_foundation.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/ui_contract_foundation.spec.js",
    "sourceRefs": [
      "tests/e2e/ui_contract_foundation.spec.js"
    ],
    "ownerHints": [
      "ui-shell"
    ],
    "domains": [
      "ui-foundation"
    ],
    "tiers": [
      "smoke"
    ],
    "cost": "fast",
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
    "entrypointPolicyIndex": 2,
    "verificationOrder": null,
    "selectorOrder": 148,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/ui_rework_mainline_shell_sidebar.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/ui_rework_mainline_shell_sidebar.spec.js",
    "sourceRefs": [
      "tests/e2e/ui_rework_mainline_shell_sidebar.spec.js"
    ],
    "ownerHints": [
      "ui-shell"
    ],
    "domains": [
      "ui-rework"
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
    "selectorOrder": 149,
    "verification": null,
    "selector": {}
  },
  {
    "id": "e2e:tests/e2e/ui_rework_support_transport_hardening.spec.js",
    "commandRef": "node tools/e2e_layering.mjs run-spec tests/e2e/ui_rework_support_transport_hardening.spec.js",
    "sourceRefs": [
      "tests/e2e/ui_rework_support_transport_hardening.spec.js"
    ],
    "ownerHints": [
      "ui-shell"
    ],
    "domains": [
      "ui-rework"
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
    "selectorOrder": 150,
    "verification": null,
    "selector": {}
  },
  {
    "id": "infra:transport-manifest-contracts",
    "commandRef": "python tools/check_transport_workbench_manifests.py --root data/transport_layers --report-path .runtime/reports/generated/transport_workbench_manifest_report.json",
    "sourceRefs": [
      "tools/check_transport_workbench_manifests.py",
      "map_builder/transport_workbench_contracts.py",
      "data/transport_layers"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 104,
    "verification": null,
    "selector": {
      "guidance": {
        "taskEntry": [
          "Transport workbench manifest health gate"
        ],
        "ownerFiles": [
          "tools/check_transport_workbench_manifests.py",
          "map_builder/transport_workbench_contracts.py",
          "data/transport_layers"
        ],
        "commonChecks": [
          "python tools/check_transport_workbench_manifests.py --root data/transport_layers --report-path .runtime/reports/generated/transport_workbench_manifest_report.json"
        ],
        "riskSignals": [
          "transport family manifest drift",
          "coverage variant path drift",
          "runtime workbench contract drift"
        ],
        "diagnostics": [
          ".runtime/reports/generated/transport_workbench_manifest_report.json"
        ],
        "status": "active"
      }
    }
  },
  {
    "id": "node:test:node:appearance-physical-owner",
    "commandRef": "test:node:appearance-physical-owner",
    "sourceRefs": [
      "tests/appearance_physical_owner_behavior.test.mjs",
      "js/core/state.js",
      "js/ui/toolbar/appearance_physical_owner.js",
      "js/ui/toolbar/intensity_field_editor_section.js"
    ],
    "ownerHints": [
      "map-layer"
    ],
    "domains": [
      "map-layer"
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
    "selectorOrder": 169,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:appearance-transport-change-set",
    "commandRef": "test:node:appearance-transport-change-set",
    "sourceRefs": [
      "tests/appearance_transport_change_set_contract_behavior.test.mjs",
      "tests/appearance_transport_operation_behavior.test.mjs",
      "js/core/appearance_transport_change_set.js",
      "js/core/appearance_transport_change_set_contract.js",
      "tests/helpers/appearance_transport_change_set_fixtures.mjs",
      "js/core/appearance_transport_operation.js"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 171,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:physical-layer-contracts",
    "commandRef": "test:node:physical-layer-contracts",
    "sourceRefs": [
      "js/core/renderer/physical_intensity_interaction_owner.js",
      "tests/physical_layer_contracts.test.mjs"
    ],
    "ownerHints": [
      "map-layer"
    ],
    "domains": [
      "map-layer"
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
    "selectorOrder": 329,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:physical-layer-owner",
    "commandRef": "test:node:physical-layer-owner",
    "sourceRefs": [
      "tests/physical_layer_render_owner_behavior.test.mjs",
      "js/core/renderer/physical_layer_render_owner.js"
    ],
    "ownerHints": [
      "map-layer"
    ],
    "domains": [
      "map-layer"
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
    "selectorOrder": 330,
    "verification": null,
    "selector": {}
  },
  {
    "id": "node:test:node:transport-overview-line-contract",
    "commandRef": "test:node:transport-overview-line-contract",
    "sourceRefs": [
      "tests/transport_overview_line_strategy_scope_contract.node.test.mjs",
      "js/core/map_renderer.js",
      "js/core/renderer/transport_line_label_policy.js",
      "js/core/renderer/transport_overview_render_owner.js",
      "js/core/renderer/transport_overview_style_policy.js",
      "js/core/transport_capability_registry.js",
      "js/core/transport_country_overlay.js",
      "js/core/transport_overview_visibility_policy.js",
      "js/core/transport_pack_resolver.js",
      "js/ui/toolbar/appearance_city_points_descriptor.js",
      "js/ui/toolbar/appearance_transport_summary.js"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 242,
    "verification": null,
    "selector": {}
  },
  {
    "id": "direct:transport-capability-maturity-projection",
    "commandRef": "node --test tests/transport_capability_maturity_projection_behavior.test.mjs",
    "sourceRefs": [
      "data/transport_layers/japan_road/manifest.json",
      "js/core/transport_capability_registry.js",
      "js/ui/transport_workbench_family_registry.js",
      "tests/transport_capability_maturity_projection_behavior.test.mjs"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 394,
    "verification": null,
    "selector": {}
  },
  {
    "id": "p3:context-pass:physical-layer-contracts",
    "commandRef": "test:node:physical-layer-contracts",
    "sourceRefs": [
      "js/core/renderer/context_pass_orchestrator_owner.js",
      "tests/physical_layer_contracts.test.mjs"
    ],
    "ownerHints": [
      "map-layer"
    ],
    "domains": [
      "map-layer"
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
    "verificationOrder": 56,
    "selectorOrder": 43,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "map-layer",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:context-pass:physical-layer-runtime",
    "commandRef": "test:e2e:physical-layer-runtime-contract",
    "sourceRefs": [
      "js/core/renderer/context_pass_orchestrator_owner.js"
    ],
    "ownerHints": [
      "map-layer"
    ],
    "domains": [
      "map-layer"
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
    "verificationOrder": 61,
    "selectorOrder": 48,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "map-layer",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:context-pass:river-layer-contracts",
    "commandRef": "test:node:river-layer-contracts",
    "sourceRefs": [
      "js/core/renderer/context_pass_orchestrator_owner.js",
      "tests/river_layer_contracts.test.mjs"
    ],
    "ownerHints": [
      "map-layer"
    ],
    "domains": [
      "map-layer"
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
    "verificationOrder": 57,
    "selectorOrder": 44,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "map-layer",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "p3:political-pass:physical-layer-runtime",
    "commandRef": "test:e2e:physical-layer-runtime-contract",
    "sourceRefs": [
      "js/core/renderer/political_pass_orchestrator_owner.js",
      "js/core/renderer/political_background_render_owner.js",
      "js/core/renderer/political_partial_repaint_owner.js"
    ],
    "ownerHints": [
      "map-layer"
    ],
    "domains": [
      "map-layer"
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
    "verificationOrder": 53,
    "selectorOrder": 40,
    "verification": {
      "commandType": "package-script",
      "packageScriptRequired": true,
      "supervisorDomain": "map-layer",
      "routeRegistry": true
    },
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_global_transport_builder_contracts.py",
    "commandRef": "python -m unittest tests.test_global_transport_builder_contracts -q",
    "sourceRefs": [
      "map_builder/transport_country_pack_writer.py",
      "tests/test_global_transport_builder_contracts.py"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 369,
    "verification": null,
    "selector": {}
  },
  {
    "id": "python-heavy:geo_stack:tests/test_transport_country_source_contracts.py",
    "commandRef": "python -m unittest tests.test_transport_country_source_contracts -q",
    "sourceRefs": [
      "tests/test_transport_country_source_contracts.py"
    ],
    "ownerHints": [
      "transport-workbench"
    ],
    "domains": [
      "transport-workbench"
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
    "selectorOrder": 373,
    "verification": null,
    "selector": {}
  }
];
