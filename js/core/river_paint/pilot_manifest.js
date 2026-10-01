// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:97899abf2f653eb26204c5e4f4fec3bfe3779be4d66f676b7c389aec7d729e85",
  "canonicalSha256": "2c26aa4e7d17f977530c1df2f452d812869cb8170389f9e26e41dcd39e8ae9ef",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:78a34b257ab13c094cfd349d977bd4e9375970c707c3a91cb76d67c3d5a2ac44',
  canonicalSha256: 'c9a9176aa4de5ce676c9b6261cfeee3dc8ae2d155089827092e5bae7291c7fde',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const APPROVED_RIVER_PACKS = Object.freeze([RIVER_PAINT_PILOT, RIVER_PAINT_WAVE2]);

// baseline_hash is an ownership digest, not a geometry digest. The reviewed
// production pack is also tied to the generated scenario build. Synthetic
// packs are used only by isolated tests; the loader/import boundary accepts
// only the approved production pack.
export function isRiverPaintSourceCompatible(pack, manifest) {
  if (!pack || (pack.packId !== RIVER_PAINT_PILOT.packId && pack.packId !== RIVER_PAINT_WAVE2.packId)) return true;
  return manifest?.version === RIVER_PAINT_PILOT.scenarioVersion
    && manifest?.generated_at === RIVER_PAINT_PILOT.scenarioGeneratedAt;
}
