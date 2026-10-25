// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:b7fa9730e5921d8ca0d24e2ac06ddfb477ab5e774615b2284558900759ed466a",
  "canonicalSha256": "13c3a81495a3214e97bca185151e886b674cc089c4b0e677b1bcdcdac60de13f",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:1b34380581525eb8cc9810e308de634c6a7497021c287b1a60d58b805ac3110a',
  canonicalSha256: 'a240d3ba57d831e1b5f50f5df54ba3be5db3040341d885491344d2fd5f9e875b',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:511f0be3a2c7f9d2cfa51e78d48890f3a62b559a3db824596609a84f16ad9fcf',
  canonicalSha256: '2db20573dd1fc5e0bcc868cf677488c9c99ee76836c32949a085e2284299da8d',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:dccb7eabb37ddb97aa7fd7b8b6ee0483cb599f4db17e3fd5e395782f3a9841ef",
  "canonicalSha256": "e4fb03c174643abdbac43bccfc7973386d93c58491ed0c816086fb003a6e04ec",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:408bd8bf14bd8de2b8ed77b87e379386f4a19538cc1685759b2be84af064383b',
  canonicalSha256: '272caf43dccb8c05427c90519371dc3be94b96ce4b6da795759944e1d08af54c',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:9eed924ef42710d576b66c2c6991a27c377ca9019c2146aa8010fd3d29c74cf3',
  canonicalSha256: '20ef760cec79318dce3724c6f2194d4a5f9830209ae702514af4e19e2a840d82',
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
