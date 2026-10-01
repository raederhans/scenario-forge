# Wave 2 admission preflight

Prepared against main e25b89ca. PR #192 passed all checks and merged as
`81532208179109bd81a797cd9d6e34088cf63ab6` at 2026-10-01 10:13:34 UTC.
The independent worktree fast-forwarded to that main commit, then started
`codex/river-wave2-admission`. Production still uses the original six-parent /
31-cell pack. Primary checkout WIP remains untouched.

## Candidate scope

| River | Source parents partitioned | Cells in broad audit | Selected next sites |
| --- | ---: | ---: | --- |
| Oder | 36 | 132 | Opole (PL_POW_1661), Wroclaw (PL_POW_0264) |
| Yangtze | 76 | 220 | Luzhou (CN_CITY_17275852B1441354643708), Yichang (CN_CITY_17275852B17052950603257) |
| Huang / Yellow | 115 | 405 | Lanzhou (CN_CITY_17275852B84192730453130), Wuhai (CN_CITY_17275852B72607841305823) |

Each chosen new parent produces exactly two cells. Their smaller planar face share ranges from 34% to 46%; this is a source-plane ranking measure, not a geodesic area claim. All original positive-area fragments remain.

The combined candidate contains 12 parents, 43 cells and 18 contour-support neighbors, 142150 bytes. All six original parent records compare equal, including their geometry and cell IDs. Python partition audits, frontend geometry fingerprints and finite D3 cell previews passed. The production loader correctly rejects this candidate because it is not yet admitted.

Generated evidence remains under `.runtime/reports/generated/river-next/`: the three broad packs and audits; `modern_world_wave2.candidate.json`; `modern_world_wave2.candidate.audit.json`; `frontend-validation.json`. These are offline candidates, not production assets.

## Implementation boundary

1. Preserve the original approved manifest/hash and self-contained old-project import. Add a separately authenticated wave-2 pack; never relax integrity checks to accept arbitrary self-reported hashes.
2. New projects may load wave 2 after admission. Existing saved projects retain their original pack and paint; do not silently replace their pack in runtime.enable, which currently returns the saved active pack unchanged.
3. Register the new runtime asset and build/catalog inputs, extend the bilingual location list, and refresh exact source-policy evidence only for intentionally changed modules.
4. Verify old-pack offline import, new-pack import, tamper rejection, all 43 selectable cells, Undo/Redo, map/export colors and outline seams for the six added locations. Offline area/overlap checks alone do not establish geographic fidelity or visual seam quality.
5. Keep broad candidates disabled; require final-head CI before delivery.

## Reproduce the bounded candidate

```sh
python tools/build_river_partitions.py \
  --land data/scenarios/modern_world/runtime_topology.topo.json \
  --river Seine --river Elbe --river Volga --river Oder --river Yangtze --river Huang \
  --include-lake-centerlines --scene-id modern_world \
  --parent FR_ARR_75001 --parent FR_ARR_76003 --parent DEE0D --parent DEE06 \
  --parent RU_RAY_50074027B53551011789267 --parent RU_RAY_50074027B57358126207690 \
  --parent PL_POW_1661 --parent PL_POW_0264 \
  --parent CN_CITY_17275852B1441354643708 --parent CN_CITY_17275852B17052950603257 \
  --parent CN_CITY_17275852B84192730453130 --parent CN_CITY_17275852B72607841305823 \
  --base-commit e25b89caa2c4d1e4c4d8f827e0c22b7f52c55ca5 \
  --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 \
  --max-parents 12 \
  --output .runtime/reports/generated/river-next/modern_world_wave2.candidate.json
```

Visual inspection of `candidate-six.png` shows the two retained faces meeting
along the selected source river line at each of the six sites. This proves
alignment to the supplied dataset, not independent real-world river accuracy.
