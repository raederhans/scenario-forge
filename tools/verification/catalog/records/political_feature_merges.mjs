// Cross-scenario parcel merges are applied post-build to every runtime asset;
// their contract rejects any merged-away feature ID that an asset still carries.
export function createPoliticalFeatureMergeRecords(existingRecords) {
  const start = Math.max(...existingRecords.map(r => r.selectorOrder || 0)) + 1;
  return [
    ["contract", "node --test tests/political_feature_merges_contract.test.mjs", [
      "data/political_feature_merges", "tools/apply_political_feature_merges.py", "tools/build_political_feature_merge_plan.py",
      "tools/merge_political_topology_arcs.mjs", "tools/repin_river_partition_packs.py",
      "data/europe_urban.geojson", "data/releasables", "tests/political_feature_merges_contract.test.mjs",
      "tools/verification/catalog/records/political_feature_merges.mjs",
    ]],
  ].map(([id, commandRef, sourceRefs], index) => ({
    id: `local:political-feature-merges:${id}`, commandRef, sourceRefs,
    ownerHints: ["geo-contract"], domains: ["geo-contract"], tiers: ["contract"], cost: "fast",
    resourceLocks: [], executionOwners: ["child-safe"], profiles: ["pr-fast"], platforms: ["all"],
    entrypointPolicyIndex: 5, verificationOrder: null, selectorOrder: start + index,
    verification: null, selector: {},
  }));
}
