// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:b0fbe99dc74b16ffa4595f10f4db2c034c65fda9313a6f18dccd57dcf9ccae26",
  "canonicalSha256": "5fcabf88872745c7f09534172ea678017b066f53ad9b645ee336ffe9c88953f6",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:47042c3ec3aaee67d6a0f6f6e8d330eba401f55b50e91a9fab43354cae8d2bcb',
  canonicalSha256: '732b7f511ef6d184dcbdfd230fd4403aa97a9d7c4dc8de463f82d7bba544dd66',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:7bfbf2577882ef6410da1b0969c12b29722eac74c11a6d1846663b993b31cfae',
  canonicalSha256: 'a31bcf34b0105111f4adae4ee4817e5313d63a355d164e8b542bf8b22a262246',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:d0b4c18ee29b25349c4a23e3bfefb2247c649184b8bc0d1e30f6efb43ffb09b9",
  "canonicalSha256": "ce999ce84d4731aab4af6f71cd8a84d8ae87534931877b14bee2d897e641d083",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:763b1cfda6e91d92f311243235b994be49932937d324c794a26fef9c95db25c8',
  canonicalSha256: '0792701e46c5fb76df5da452a873f2a7e446567b49a7dcfc44e353e8de2a1abd',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:2ff047b4893ce9dba92ea6f7e57eafbd5b37830abe11d766b57562181e7a00ed',
  canonicalSha256: 'c324060b6bd543a75261bad44b795439b1768720032eab1cb3a051d294cca785',
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
