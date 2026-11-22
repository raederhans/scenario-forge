// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:29f346d7a458f06b45f929c9b61c3d5f76440dd541cc62e3b42e7cd0b1c449fe",
  "canonicalSha256": "6e6fcbca1390cc33dbc70eed608cbd90b688faa6b8adf318e2a97f7c07f62336",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:849f0976c6d8ec12bf0d5fc2946648bc049fe4662ff41f26ae8ae48ee82cb8b3',
  canonicalSha256: 'e284d4d49d322c02e490496b5f920ba95c845bd4be666a45d8c3fa3469911bd1',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:b0afe99d943d8802dfa80febb0fa388251433118348934a9bc90aea1bf3f0069',
  canonicalSha256: 'b32275fc07acb5908de580d2a11cc04fa8ec96df3bd2ea4ffb97f51fc6d224a0',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:4376cb771d3e371f9aa15273360638abc2a864e143f9d27b89634bf4c17e50e2",
  "canonicalSha256": "067a8132d31bbb1e0d81596df3c676c0dbaf050b937d40630ab4241b0e93955e",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:ca68fece5c10d0f507a31d93cec49a3c074c39cd0c14a3f1b4305996ad86563c',
  canonicalSha256: '4dc02630cd8e4bf872b07ead45ac3f1ce7effb32609b6076285b05d2b03b6631',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:a2e4d870cb51f59c65450e748698fc1644af84627a19d038e9d9862784cca326',
  canonicalSha256: '55292f6dc34a7c10c540226fe2dfb71ae125ae88e859d1ce5d3d2ae0a239054f',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 389,
  cellCount: 1276,
});
export const APPROVED_RIVER_PACKS = Object.freeze([RIVER_PAINT_PILOT, RIVER_PAINT_WAVE2, RIVER_PAINT_WAVE3, RIVER_PAINT_WAVE5, RIVER_PAINT_WAVE6, RIVER_PAINT_WAVE7]);

// baseline_hash is an ownership digest, not a geometry digest. The reviewed
// production pack is also tied to the generated scenario build. Synthetic
// packs are used only by isolated tests; the loader/import boundary accepts
// only approved production packs.
export function isRiverPaintSourceCompatible(pack, manifest) {
  const approved = APPROVED_RIVER_PACKS.find(entry => entry.packId === pack?.packId);
  if (!approved) return true;
  return manifest?.version === approved.scenarioVersion
    && manifest?.generated_at === approved.scenarioGeneratedAt;
}
