// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:51c7cddd7106ba7f1afea832cb580116d71c2fb38998e38dde291702d0701d94",
  "canonicalSha256": "626cd4a2b42ab25dfbe04dfbb55f18e0b44d68b4754845bf479a3b8eb76d7173",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:130d16992947eed96c7e3b46c0f02827f4bdb15a25ed40e5aaf06172e6a23131',
  canonicalSha256: 'bf3af437f2fecbf0d5479fdfdbfe0dd4de0f060931cfc17ca44f7962a6f06487',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:bd4cad61af163475d55f4ce5a26d308950b55e280ca817e2e3d48d6fb0cad121',
  canonicalSha256: 'd889ec8af874df12fd12b23d08518ee8d31adeefda2e9b20236d75768fa0ac1c',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:7d3ce90221705da161d874beea02ded7ba90caceace65e032924f41a3eab4936",
  "canonicalSha256": "c8f9d19884b3ed82bcc5617e862b0f7541aa6e3345caa64b7445a64c79535e56",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:24ee6910373d069c9ab1e395d0d6c0265a4dad6ae607a4f945eece0bec425ba2',
  canonicalSha256: 'c6016d6d7c3c19a5e21b74cb7bf30b39a8b9562acd6c00e68ab5d264fcf68e97',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:8385df548e78acb00616efe0105dd04daed430e0d6787ba3fb15d473b86efdd9',
  canonicalSha256: '94cb6215fa2dbda54059772a8b176bbf6623874389e029392d954a880b20882a',
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
