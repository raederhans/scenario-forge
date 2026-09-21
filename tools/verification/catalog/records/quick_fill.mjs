// Additive semantic-fill contracts. Never change existing selector order or policies.
export function createQuickFillRecords(existingRecords) {
  const start = Math.max(0, ...existingRecords.map((record) => record.selectorOrder || 0)) + 1;
  const routes = [
    ["policy", "renderer-runtime", "test:node:quick-fill", [
      "js/core/quick_fill_hierarchy.js", "js/core/renderer/fill_target_policy.js", "js/core/renderer/parent_border_grouping_policy.js", "js/core/scenario_districts.js",
      "tests/quick_fill_hierarchy.test.mjs", "tests/fill_target_policy_behavior.test.mjs", "tests/parent_border_grouping_policy_behavior.test.mjs",
      "js/core/file_manager.js", "tests/quick_fill_project_roundtrip.test.mjs",
      "docs/active/quick-fill-hierarchy-phases-1-3-20260921.md",
    ]],
    ["history", "renderer-runtime", "node --test tests/quick_fill_history.test.mjs tests/history_feature_color_refresh_behavior.test.mjs", [
      "js/core/history_manager.js", "js/core/history_quick_fill_gesture.js", "js/core/map_renderer.js", "js/core/map_renderer/click_selection_transaction_owner.js",
      "tests/quick_fill_history.test.mjs", "tests/history_feature_color_refresh_behavior.test.mjs",
    ]],
    ["controls", "dev-workspace", "node --test tests/quick_fill_level_controls.test.mjs tests/workspace_chrome_support_surface_controller_behavior.test.mjs", [
      "js/ui/toolbar/quick_fill_level_controls.js", "js/ui/toolbar/workspace_chrome_support_surface_controller.js", "js/core/state/actions/scenario_presentation_actions.js", "js/core/scenario/lifecycle_runtime.js",
      "tests/quick_fill_level_controls.test.mjs", "tests/workspace_chrome_support_surface_controller_behavior.test.mjs",
    ]],
    ["data", "geo-contract", "test:python:quick-fill", [
      "map_builder/quick_fill_hierarchy.py", "tools/build_quick_fill_hierarchy.py", "tools/build_china_prefecture_crosswalk.py", "tools/register_quick_fill_assets.py", "tools/generate_hierarchy.py",
      "data/hierarchy.json", "data/quick_fill/china_prefecture_crosswalk.v1.json", "data/quick_fill/reference/china-pca-2017.json",
      "data/quick_fill/reference/LICENSE.china-pca.txt",
      "map_builder/schemas/quick_fill_china_reference_v1.schema.json", "map_builder/schemas/quick_fill_crosswalk_v1.schema.json", "tests/test_quick_fill_hierarchy.py",
    ]],
    ["routes", "test-routing", "node --test tests/quick_fill_verification.test.mjs", [
      ".github/workflows/quick-fill-contract.yml", "tools/verification/catalog/records/quick_fill.mjs", "tests/quick_fill_verification.test.mjs",
    ]],
  ];
  const records = routes.map(([id, domain, commandRef, sourceRefs], index) => ({
    id: "local:quick-fill:" + id, commandRef, sourceRefs,
    ownerHints: [domain], domains: [domain], tiers: ["contract"], cost: "fast",
    resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"], platforms: ["all"],
    entrypointPolicyIndex: 5, verificationOrder: null, selectorOrder: start + index,
    verification: null, selector: {},
  }));
  for (const [id, commandRef, sourceRefs, resourceLocks] of [
    ["audit", "audit:quick-fill", ["tools/audit_quick_fill.mjs"], [".runtime-output"]],
    ["browser", "node tools/check_quick_fill_browser.mjs", ["tools/check_quick_fill_browser.mjs"], ["browser-dev-server", "playwright-browser", ".runtime-output"]],
  ]) records.push({
    ...records[0], id: "local:quick-fill:" + id, commandRef, sourceRefs,
    tiers: ["heavy"], cost: "heavy", resourceLocks, executionOwners: ["main-thread"],
    profiles: ["full"], entrypointPolicyIndex: 0, selectorOrder: start + records.length,
  });
  return records;
}
