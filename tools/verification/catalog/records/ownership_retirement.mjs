// Add only the new product contracts; retain all prior route order and budgets.
export function createOwnershipRetirementRecords(existingRecords) {
  const start = Math.max(0, ...existingRecords.map(record => record.selectorOrder || 0)) + 1;
  return [{
    id: "node:test:node:ownership-retirement", commandRef: "test:node:ownership-retirement",
    sourceRefs: [
      "js/core/map_editing_policy.js", "js/core/map_data_boundary.js", "js/core/state/color_state.js",
      "js/core/color_resolver.js", "js/core/sovereignty_manager.js", "js/core/scenario_ownership_editor.js",
      "js/core/interaction_funnel/import_trust_projection.js", "js/core/state/actions/scenario_activation_actions.js",
      "js/core/state/actions/scenario_presentation_actions.js", "js/core/history_manager.js",
      "js/core/scenario/lifecycle_runtime.js", "js/core/interaction_funnel.js", "js/core/file_manager.js",
      "js/ui/sidebar.js", "js/ui/toolbar.js", "js/ui/dev_workspace/selection_ownership_controller.js",
      "js/ui/dev_workspace/scenario_tag_creator_controller.js", "js/ui/dev_workspace/dev_workspace_shell_builder.js",
      "js/ui/sidebar/scenario_inspector_controller.js", "js/ui/sidebar/country_inspector_controller.js",
      "tests/map_data_boundary_behavior.test.mjs", "tests/ownership_retirement_behavior.test.mjs",
      "tests/dev_workspace_selection_ownership_behavior.test.mjs",
      "tools/verification/catalog/records/ownership_retirement.mjs",
    ],
    ownerHints: ["scenario-runtime"], domains: ["scenario-runtime"], tiers: ["contract"], cost: "fast",
    resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"], platforms: ["all"],
    entrypointPolicyIndex: 5, verificationOrder: null, selectorOrder: start, verification: null, selector: {},
  }, {
    id: "e2e:tests/e2e/ownership_retirement.spec.js",
    commandRef: "node tools/e2e_layering.mjs run-spec tests/e2e/ownership_retirement.spec.js",
    sourceRefs: ["tests/e2e/ownership_retirement.spec.js"],
    ownerHints: ["scenario-runtime"], domains: ["scenario-runtime"], tiers: ["regression"], cost: "heavy",
    resourceLocks: ["browser-dev-server", "playwright-browser", ".runtime-output"],
    executionOwners: ["main-thread"], profiles: ["full"], platforms: ["all"],
    entrypointPolicyIndex: 0, verificationOrder: null, selectorOrder: start + 1, verification: null, selector: {},
  }];
}
