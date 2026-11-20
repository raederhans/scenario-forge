// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:73b9ae50d7eaf4c473ed1468401b4c3ce25962546a71e7bdbf2c157d8477bd86",
  "canonicalSha256": "97226cee928f404d9e8e709957e11d2b8b356b735de9793cdaaf7dd11e42fb61",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:ed0fcf3420ebbb19e3705b96eca720d53c85b91e2c074e3c3ec4ee0b071552f2',
  canonicalSha256: 'f578f6ba75fba92f81247bedddccbe7bbc0765474920c9946307e20f4e204b9c',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:69c43c553f1de820aab0f062425aeb5114fea9130b047732a69f36e968145ea9',
  canonicalSha256: 'fb30bf77074f30b7cc791ed794d5e97d499156a0b4d2fbf3d3e5beda32aefae0',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:ae7432cb5254552ddd96fb6d85ab934dbda9067062917b694f914e8ac2d31210",
  "canonicalSha256": "ab70d14bb65caca3e97a625ec6ebb6c69a85103a5bd586abea98635cc935d58c",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:9ba03a085ede6307c735e953443b98b0d0b5bf215e98c57f79ec142f6e54267f',
  canonicalSha256: 'bbdc5e23e995f44bdb321535dbf0f90cff299d79a05bf05cd96e5c3824d74ac7',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:4787e24ab1df1b08b4dbb9b6f80d7fec192ca5297e59f2a448df51e3720da165',
  canonicalSha256: '3f00a0d75c2e6dc484992a140cbc9a6a7b555a3e212b3ce45417826759992cf2',
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
