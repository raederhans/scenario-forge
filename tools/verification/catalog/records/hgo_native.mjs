// The native editor owns its checks. Its changes do not select common-base
// geometry/scenario contracts or initialize the main application's renderer.
export function createHgoNativeRecords(existingRecords) {
  const start = Math.max(...existingRecords.map(r => r.selectorOrder || 0)) + 1;
  return [
    ["retirement", "python -B -m unittest tests.test_hgo_independence -q", ["data/hgo_runtime", "tools/build_hgo_runtime_assets.py", "tools/build_hgo_runtime_seed.py", "tools/build_hgo_scenario.py", "tools/spike_hgo_runtime_lod_assets.mjs", "tests/test_hgo_independence.py"]],
    ["app", "test:node:hgo-native", ["apps/hgo/src", "apps/hgo/index.html", "apps/hgo/styles.css", "apps/hgo/package.json", "apps/hgo/tests", "apps/hgo/tools/check_boundary.mjs", "apps/hgo/README.md", "apps/hgo/README.zh-CN.md", "apps/hgo/.gitattributes", ".github/workflows/hgo-native.yml"]],
    ["data", "test:py:hgo-native", ["apps/hgo/tools", "apps/hgo/assets", "apps/hgo/requirements.txt", "apps/hgo/tests/test_dataset.py", "apps/hgo/tests/test_build_app.py"]],
    ["routing", "test:node:hgo-project-routing", ["js/core/hgo_project_routing.js", "js/core/file_manager.js", "apps/hgo/src/integration/handoff.js", "tests/hgo_project_routing_behavior.test.mjs", "tools/verification/catalog/records/hgo_native.mjs"]],
  ].map(([id, commandRef, sourceRefs], index) => ({
    id: commandRef.startsWith("test:node:") ? `node:${commandRef}` : `local:hgo-native:${id}`, commandRef, sourceRefs,
    ownerHints: ["hgo-native"], domains: ["hgo-native"], tiers: ["contract"], cost: "fast",
    resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"], platforms: ["all"],
    entrypointPolicyIndex: 5, verificationOrder: null, selectorOrder: start + index,
    verification: null, selector: {},
  }));
}
