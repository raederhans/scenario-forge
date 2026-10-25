// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:e8e418ccafee13328b57a271f9815748d1107073c7b8eef27706b59768da4a36",
  "canonicalSha256": "c4f2f35554dabb6cb1b9fd580a64e0084e08c8ef32f545fc22cc47f65a8f57a4",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:cf263d57e14c13210ed5d95598540647361e35493d7f8ec1ddb700b26228e517',
  canonicalSha256: 'b24c3e016c7cf9961ae588762412358f6d3893a69a0e8b6b964e3b7b9a7a3008',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:bb67d4b34a6d7798916268929be5a058964bceb0df29bef5bd332b5c0bd895d2',
  canonicalSha256: 'd11e26f340f1ff69550a622e522a9cf737f4fe8d5bbae5299b18f474f9e6123c',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:9d57d8ab5449dea2d7b40795f9702bb8f3dcb80fe4954d23f1dd76934e04707a",
  "canonicalSha256": "37e6da3c739f06f4d45a30da1ec02418d08af13374746aec4a6e0012b3a014f8",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:49a43337ec6644170d8aaa5bcdb81bb6102f98bf9d5747a9f06df0a85168fc65',
  canonicalSha256: 'cbfc3bd489faa1c56c596e302c9dec5b61bbd2094304324ee7f615f09f47c041',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:7cad92888b03e07add6b8b978528ffc5ba9dd75a90d3a7f6b2b14a8e252d13e0',
  canonicalSha256: '8ba23e70fa36cc906d52f6c74e5c6401f7d7e2d3fbcca2fde3d3199565ad4188',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
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
