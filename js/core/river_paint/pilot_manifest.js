// Reviewed, offline-validated pilot. Imports authenticate this canonical normalized pack.
export const RIVER_PAINT_PILOT = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_pilot",
  "packId": "sha256:82c58bf7652b3019ae6f7c2177028be628413fa19a36d72bd980bc2e07621389",
  "canonicalSha256": "5c0995925b1da3db0776904aee8a752ed26dced6b753cffc6cee3cf6381ea4f3",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 6,
  "cellCount": 31
});

// Keep the original authentication record for self-contained saved projects.
export const RIVER_PAINT_WAVE2 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave2',
  packId: 'sha256:a8a3b7fbc6b9e06c7c2a01f439690c0655552fdafa00cc887e99af2e5642d4e3',
  canonicalSha256: '3b92f6f0f2434a4e58e1ad260edb9d74d8c91447e6a9501149cdc15a797ef5c4',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 12,
  cellCount: 43,
});
export const RIVER_PAINT_WAVE3 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave3',
  packId: 'sha256:bfe295081caedd117c59c0dfbfb6506cc3f508d000fa28f37c4dcd7d36312e68',
  canonicalSha256: '91e8ed9eab6a457c840dea1172ef7a98690f41aa883265652e3d21f9126714df',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 302,
  cellCount: 905,
});
export const RIVER_PAINT_WAVE5 = Object.freeze({
  "sceneId": "modern_world",
  "assetKey": "river_partitions:modern_world_wave5",
  "packId": "sha256:793d3b1573669787c6454a1eddda2f5561499921d17394f6f38f0720f2ab3ee8",
  "canonicalSha256": "753d62da8eb767582d44adaaaeed0883f51d9cdffb0d8617b055d91311fa1e62",
  "scenarioVersion": 2,
  "scenarioGeneratedAt": "2026-09-27T13:55:57.885587+00:00",
  "parentCount": 376,
  "cellCount": 1164
});
export const RIVER_PAINT_WAVE6 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave6',
  packId: 'sha256:2708fe45752a092ddbd642560431efc08b1246c9a4997a58d64b4441156b7c70',
  canonicalSha256: '0f9e7972ee04577cc98452cefd2ded5b545a75c73e72e2ebb7eeb018db070ba4',
  scenarioVersion: 2,
  scenarioGeneratedAt: "2026-09-27T13:55:57.885587+00:00",
  parentCount: 382,
  cellCount: 1199,
});
export const RIVER_PAINT_WAVE7 = Object.freeze({
  sceneId: 'modern_world',
  assetKey: 'river_partitions:modern_world_wave7',
  packId: 'sha256:f3e252fd892b260f92a3cdc0fee99e20c45efc5e03162dbfcde58f68faaa7c53',
  canonicalSha256: 'cb83aaf78a1869227253cbb04176d8bc2435c7a8f20c3ba1b3581fa6179f4236',
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
