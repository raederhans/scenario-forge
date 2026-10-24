// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:214f26bfb88d54be22e7b826946716a14de56b4add2d503000d281a828867a1d",
  "canonicalSha256": "d03338ce7bdf695cc754994317468afc7b3d50d4b44d6dea0a58950df392c41e",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:a6168db3f8bcdaecb80f474800afdce0c9cf8a80c1bbb9260e04c04528068a89',
  canonicalSha256: '3c99580365a898a66fa59493169b08f10872d826913a77fbe71880dcc5a2152e',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:fd5cc762a3e62991bc2cfee11e2911ce237d5fec3a083f4862bdb8cd11f4a2be',
  canonicalSha256: '5f6b9249b7d957186ee5612745117de2ab9263389cbba90172491ea04b21b631',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:204a3216cddd90397edb77ed5ab5fc9a16ba8af2233a8dbb13e320bf5b3a804f",
  "canonicalSha256": "620fb8c0f02517add0156f63e890016649ccce4b05a8a27d1980baec0c5de32b",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:9dcf7ac49ba4a257618211acd50f6b0b5d8a185c436d4aa59377da0377bf43d0',
  canonicalSha256: '94c81ed0e5a4ae205568f40e68088b3456b073638b3a8092442b2d15a2d0014b',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:61533a71b642d6c367ab7141d98b7ad730cafcfdd6547977f4c8f729ff816b32',
  canonicalSha256: 'c2ea016a8d157a8737e18f2c593eab70a56e6c2bb3577d162cd6f79b5574f703',
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
