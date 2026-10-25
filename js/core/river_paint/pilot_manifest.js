// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:7308aa0a1f8738941a1bfd607c2b5cfa19e09797b3d35a555ea242fd26c77197",
  "canonicalSha256": "0ffeb3a979afcf503b3dc235798b15dc23f9663b8224edce6e5740a81c58bfc5",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:2c6dc0459b689a98473a26fc641b1f268a46f52681909f8d07340feed00e4f70',
  canonicalSha256: 'd76578089620bb10efd4999230e5c687c91bb8a12bfb33c2f5d2c602935fceaf',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:4c88b565bae8fad8416c276c7ba3c5fa4068a31d5fe8f2a71a803d66073429c1',
  canonicalSha256: '3604429080422a6ef5f828a404e25a27595f00ed421004b91bffafd497584160',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:2f530baeb37c288bff5f3fbc46d6b4ffe0323eb3adbe5560a506a8c07842bbbb",
  "canonicalSha256": "338c953489b9f37c8686b5c1f4b6e7f5752829df4465a44f237c5a0cd48571cf",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:a8e9dd00174f2af8dcb4f130792c96e5560d28fdad803b3afc12569c230d0b18',
  canonicalSha256: '07bec39ef5bb621505425ece30f2dce1f56b3f986489cd97f76ff081dccffe58',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:b3b9a64ef8815ea477dd762af3d67f5e72a4a0f74d90fe7306dcf53422fbf53d',
  canonicalSha256: 'a3a101d63bda2d353fccf547ba15dfbb007c260d3dd100642ac071230cfaba3f',
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
