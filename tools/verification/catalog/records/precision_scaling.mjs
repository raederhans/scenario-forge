// Additive routes: preserve the order and policy of every pre-existing record.
export function createPrecisionScalingRecords(existingRecords) {
  const start = Math.max(0, ...existingRecords.map((record) => record.selectorOrder || 0)) + 1;
  const routes = [
    ["scheduler", "scenario-runtime", "node --test tests/precision_scaling_scheduler_behavior.test.mjs", [
      "js/core/scenario/chunk_load_scheduler.js", "js/core/scenario/chunk_payload_loader.js", "tests/precision_scaling_scheduler_behavior.test.mjs",
    ]],
    ["store", "renderer-runtime", "node --test tests/precision_scaling_store_behavior.test.mjs", [
      "js/core/political_geometry_store.js", "js/core/scenario/chunk_layer_payloads.js", "tests/precision_scaling_store_behavior.test.mjs",
    ]],
    ["packed", "renderer-runtime", "node --test tests/precision_scaling_packed_geometry_behavior.test.mjs", [
      "js/core/renderer/packed_geometry.js", "js/core/renderer/geometry_raster_worker_kernel.js", "tests/precision_scaling_packed_geometry_behavior.test.mjs",
    ]],
    ["lod-selection", "scenario-runtime", "node --test tests/precision_scaling_lod_selection_behavior.test.mjs", [
      "js/core/scenario/political_lod_policy.js", "js/core/scenario_chunk_manager.js", "js/core/scenario/chunk_layer_payloads.js", "tests/precision_scaling_lod_selection_behavior.test.mjs",
    ]],
    ["lod-builder", "geo-contract", "python -m unittest tests.test_political_display_lods -q", [
      "tools/build_political_display_lods.py", "tests/test_political_display_lods.py",
    ]],
    ["routes", "test-routing", "node --test tests/precision_scaling_verification_records.test.mjs", [
      "tools/verification/catalog/records/precision_scaling.mjs", "tools/verification/verification_catalog_source.mjs", "tests/precision_scaling_verification_records.test.mjs",
    ]],
  ];
  const records = routes.map(([id, domain, commandRef, sourceRefs], index) => ({
    id: "local:precision-scaling:" + id, commandRef, sourceRefs,
    ownerHints: [domain], domains: [domain], tiers: ["contract"], cost: "fast",
    resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"], platforms: ["all"],
    entrypointPolicyIndex: 5, verificationOrder: null, selectorOrder: start + index,
    verification: null, selector: {},
  }));
  records.push({
    ...records[0], id: "local:precision-scaling:native-browser",
    commandRef: "npx playwright test --config=playwright.config.cjs tests/e2e/dev/precision_scaling_packed.dev.spec.js --workers=1",
    sourceRefs: ["tests/e2e/dev/precision_scaling_packed.dev.spec.js", "tests/e2e/dev/support/precision_scaling_native_case.mjs"],
    ownerHints: ["renderer-runtime"], domains: ["renderer-runtime"], tiers: ["heavy"], cost: "heavy",
    resourceLocks: ["browser-dev-server", "playwright-browser", ".runtime-output"], executionOwners: ["main-thread"],
    profiles: ["full"], entrypointPolicyIndex: 0, selectorOrder: start + records.length,
  });
  return records;
}
