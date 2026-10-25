// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:2a88b9140e88adeabeb668c85fd5b6b9d96014a9d30b40afd3b1c1d64eabeda4",
  "canonicalSha256": "0145b85d8efa2c8257fb18d5fe39d05dbcbeb9611381530ba5ea6c95a383ab8e",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:3f439e605d77676c7217bd6eef7e8545e111f16c35ed544aad7c04db2053785c',
  canonicalSha256: '30db0e3c6240f0c817399fe82e0eb8b67ffbbdb291ca6386af9fcf2637471c97',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:7049a99a128a9260445851ea7678fd277eb434864b0dbc8a147d16b1a0ec8495',
  canonicalSha256: '16ac2089212f72dc715a4af1b7c61cad7052e6ed46a62b2d6f78d81ac13b5066',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:6ee8c0a2e2ce82697f5f6e1944a9efeb262bc88b4bdba77cf12765ed451e7370",
  "canonicalSha256": "836e39f00b8480ad76b28e87ad6121c675e6a4cc315974355ec184f67af6f8bb",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:530fbee9885eefca62736e80b72b45ed121022f7b2c9fc2f777c6982b64e07a4',
  canonicalSha256: '74c56866c09b0df0da70d64ca6549872d886a283af265187d2cd25b509981259',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:1d9909dcd7d4e13305adf28c09d97d23cebcf8cb4aa013d1667dce8b52abc3e1',
  canonicalSha256: '2e09359427f262cda5d578bf7b226c5f4bba58d459dfae3172f02c20ceeb394e',
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
