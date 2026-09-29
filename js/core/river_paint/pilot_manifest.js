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

// baseline_hash is an ownership digest, not a geometry digest. The reviewed
// production pack is also tied to the generated scenario build. Synthetic
// packs are used only by isolated tests; the loader/import boundary accepts
// only the approved production pack.
export function isRiverPaintSourceCompatible(pack, manifest) {
  if (!pack || pack.packId !== RIVER_PAINT_PILOT.packId) return true;
  return manifest?.version === RIVER_PAINT_PILOT.scenarioVersion
    && manifest?.generated_at === RIVER_PAINT_PILOT.scenarioGeneratedAt;
}
