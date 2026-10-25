// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:1297cbe84523b87534f0b8e9c2427913e27c1276671168cd1091395ab1744a4a",
  "canonicalSha256": "e755ded46c907eae451d4e0dfb1316855f1030a1b0a3f915d2d2f17f45b23c27",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:7a8a02e2033d53e6e23bb1e0ca8728c80a521b6f78a68937692bbf842aac06ba',
  canonicalSha256: '25d23a34c0fd0764da9e4275ed7fcd56e80263533b21257960b8c4dee211a8d0',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:a441426d2f25bbfe80726f40dbadbfaa4ef618b224543816725f3881f8ba4a04',
  canonicalSha256: 'cb99d91d6cda6d8d104607687e786f79dbb7595c90ab4332df7f46b394c93c93',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:ed27a137a7e6b1da9f6774604f54da3b2c83f604942573d976d5e1d4a87f2755",
  "canonicalSha256": "7bb26bad270e792cddc3d0f2948fbaab3691073b6015097a45498f0d190678d9",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:b0bbe10258e8e640e8e068fe4e1a041cba9c20ac8f05ead118e072e34ace4f66',
  canonicalSha256: '3255e3c115db45346b83bacad00808a273bf150236d9d120598eb91b1d174e98',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:7099ecfef2ea4136dd60bf5b38ff0b1ff4bbe51e28d76bab9c169a43a365cda8',
  canonicalSha256: '1ddf92402f0c0acc895a1f6d1c32b9cb325f6c21b5fad62fbd2c77ed7dbf3136',
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
