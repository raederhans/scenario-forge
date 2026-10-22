// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:6016f62238b0b9c15ab7d110344c6609dd8d3ca081f1198b1a7ad990a90ab393",
  "canonicalSha256": "e4c053b9b61bf7742545a4e13e5a85079d7ba94f68d0dac3f3028c78352d0837",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:4abc38e0553081ee3574e574c2efe181676fc9ff7d5353c418421d0555445b5d',
  canonicalSha256: '057a64be5313aa69ced3f5d501fe0419d62a2bd634cbe654b20b022dc38d8037',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:eb7af5577a99c7f00acfe9338bc91dc7b1623c82d4ca8becf6cbf0d5957c535d',
  canonicalSha256: '5012d6c339988df35da554676a93f3ac96e98edb8cf8c491744128726218c6bd',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:cd6840eda23969a06e30c52a809396f08b11fffe700ec8ecf9450e9325753251",
  "canonicalSha256": "4bf13ad2d3c6598576f382386bdd242121a88e154c86256e6c16248f9c94336d",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:07c1a12aa838824c828e75837891bfc050bb4cf99cf09f5d6ac895f91f5c01ac',
  canonicalSha256: 'aa33c6a46f4840550e5b6c355c713e7f7e251c7903169a65d09e0b9c8d0f43b3',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:d369b3f662d96e00105dfd9d99ec6c74f237fdc0ed316a3b5c2d81733f478e72',
  canonicalSha256: '469077a850468b72ab3b8d1a4754ea41db0e3780322e07d3ab5693d4cdcc645e',
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
