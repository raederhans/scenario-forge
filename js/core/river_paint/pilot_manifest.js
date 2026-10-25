// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:34ea96162de41ac48d299a8b05f0725c77469181a80b78438391b43d61faeb21",
  "canonicalSha256": "bcbbba650193ec261ede17b01a3660826126ebfd7ab192ecd38b577647d55449",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:a286193237b907d7ffed0a0095a0b7b6f866f3867fc7b767d5b5b32319a901a6',
  canonicalSha256: '72a38f8f2b271a587dfb484ba9f45f70427596ac71082c5d4da0a9a91137c42d',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:7546d8b904732e0ed64d69017db9d7f11a0360b01ddf69d156cffb44bf0b2c6a',
  canonicalSha256: 'ab96ceaf2ab1b3297f5e42d0ea346f5577d863f5bf42087096d7cfe12ff7c6f9',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:b8016ba862ab9ecd4a292e23c19fa4b611719e73a52b231d293f8391939deffc",
  "canonicalSha256": "332df7ee45c301f35b2fdad7e273c15f039c477b8e3e96a1054a071b203fc31e",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:e0d2721ed87f74e10345ecb27debd4e3a590eaa3d18013920e1a515a3e20c978',
  canonicalSha256: '79cd25e909720a987b586b895e0bd291e43586b6f2fae1a4c31682e282208dd1',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:103447bea24c7202f254f06a0754b80e53de30116247b50510bfa9625f93b78b',
  canonicalSha256: 'a16bca73a705bd036601f11dcc1ab0518f25c6aa20d006e5ab7ad5b9bf034a4b',
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
