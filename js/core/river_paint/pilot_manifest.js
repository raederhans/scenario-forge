// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:846ebad4b5df52ebff4d761e4264add6c617be2b702bc80cf23cdd438d0391cf",
  "canonicalSha256": "0a716ced268d236ba8bdf7ae29fbf2881e3935d53b3a1a023ac1f57468669ebb",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:7124356748984249269210f269b3b4fc7b1f39c73c49140e8f0665cfc1468d0d',
  canonicalSha256: 'c3fef8cfe0fb4e76de2c4a06c9941569c23bda68ea345bb3307f00f7b007e39c',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:9730ce4a48cab22b0204a65a40b4716c13de941d38185250b9296fc114c628b4',
  canonicalSha256: 'd0b5d0adf04e076086f2ccc048886dab434ed98152dfc660ea3a4f7a3be7d383',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:2b8f30c7e5b9ab1d59c19b206a538a125eb78abc1d771ba2ca5ec040f68f8955",
  "canonicalSha256": "0ba22afeab09da697c0c1f73ae1a2094d8bcd933dab813e99c2a4ac0a20b3bf6",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:ab75092872b473729e938c61847190b8c814ebc09c91f6f404a6dc935708cbd0',
  canonicalSha256: '9df5a87669e338956bb9c5794142622423c6e5a96f573c96d53746d4b172e854',
  scenarioVersion: 2,
  scenarioGeneratedAt: '2026-09-27T13:55:57.885587+00:00',
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:7ab1c5edbba99228bc8150d8f834bd0d848e820ca605e24da7992be349c9e506',
  canonicalSha256: 'b055f36e8d0a8db4072332f23483d66aec4d62f9316e0e1f05563d9fff295614',
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
