// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:b54d2439d740394e332fe8e9eb2663a927b33c77159c5cdf6be905c87de6de89",
  "canonicalSha256": "4da1b34d5166270b362b4f25f58bd1e77c924bef8f2f0867de89290c7fe7c3e8",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:f2f18a7cb67c93266c1679711951128c4759f854c8dcdabae631195c9b52c380',
  canonicalSha256: '535a41b9d638fc0605134bede5b87a0d2321765853636521cab6773f5d959383',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:4d5b75e12c5ca02b20f99a13e128097062fa5d871b8b555970238d7c8984f56a',
  canonicalSha256: '83f95e6188d6c187fa01223a4a9d3bf8f6334a265dee083dab416b2e9804253e',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:e21c0102c602d71d8fbaf85153a189afad6df3ed74cb6d10148fb2eed1c5cee0",
  "canonicalSha256": "9f29825d7a2da23e80acaae5ae458fecceaf4a68d2c36ec5b60109d178bf149a",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:17dd9bee57818645fb985c4d50c96fad2e63f08ceaae6f9da27213fbca6bc71a',
  canonicalSha256: '5bfca0af0664ed813efd968ae896159e29093ba5722123ef9214f209f41c0be1',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:384341e7135968198d2af00380b423a0098a8424efa2b8a28c785be67b482f0d',
  canonicalSha256: '8e15b9ae26e0f3a2d49ec767ed89eeaaff9fca5a4838a79f68062c7675065572',
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
