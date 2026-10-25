// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:b7c4124888d4e0ae25438ea7f5345f78e70394f039d9c96a3ef2120fdd1b6649",
  "canonicalSha256": "15b68edb9a43529625d5d86aadbd724ebfb7a023976bc9ab7518befebe86391e",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:24c37577dc9a9ba7fe07d559806ae368b60890437e18eefc7ea27638feb60662',
  canonicalSha256: '74f3636296480ffd4814e69848cfdf6684f2e1bcbd03198eeadad706acec4586',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:2b307afa4e415a67295bacc71466cf15392e6f87b397e9a2b9362d04a619e062',
  canonicalSha256: 'b4e6babe6ac5199ee65d9d3884b2feba715f9226dc6489219ec0c10dfd0a0fbe',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:81c16c6594fe72ce203fca6b4bf83e53fe0e743e6d781a893d9ac79abc725c3c",
  "canonicalSha256": "3f583f86968cb1ee7cb80b9e6f3652f595f78c25347aa925e4314cafe2d39105",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:8fd117c6ba6809cd3d2489653c475affed0145577782b3fb425f32e3e7dcd63a',
  canonicalSha256: '30e51fecc66f6e293659c419c34da8153a0d49d0be6d4c982da6301806e7a268',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:d511180a1dc5eda2246bbc360c5ca2c844d2d3a9f11fffa19d8c7db4d03701db',
  canonicalSha256: 'b6c3d7128d89de7e39b1f69865b1980b267b1c015eb5aa592f03fd3392ad89c5',
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
