# Eastern Europe river wave 3: offline selection

Base: `main@2da4db61c3533f621afe2be0fe6ff494d567eb92` (PR #194).
Worktree: `C:/Users/raede/.codex/worktrees/f7ce/mapcreator`.
Branch: `codex/river-wave3-eastern-europe`. Prepared 2026-10-01.

60 new parents / 192 cells are qualified **offline integration candidates**, not
enabled runtime assets. The selection is in
`tools/river_partitions/selections/eastern-europe.json`; all packs, figures,
scripts and audits are in this worktree's ignored `.runtime/river-east/`.
No canonical IDs, ownership, scenario topology, shipped pack, loader, registry,
catalog, dist, package scripts or policy receipts were changed.

## Local source and complete crossing inventory

The immutable inputs are `data/scenarios/modern_world/runtime_topology.topo.json`
and `data/global_rivers.geojson`. The generator stores their byte identities,
baseline and commit in both candidate packs. Shapely 2.1.2 / GEOS 3.13.1 is used.
The local river aliases are exact: Volga (`river_1315` River, `river_1319` Lake
Centerline), Don (`river_1282` River, `river_1279` Lake Centerline), and Dnieper
(`river_1299` Dnipro River, `river_1303` Dnepre River, `river_1298` Dnipro Lake
Centerline). Donets and Volga-Don Canal are not selected. No display LOD is used.

| River | Intersecting active parents | Partitioned | Uncut | Offline candidates | Candidate cells | Held | Excluded | Already approved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Volga | 106 | 104 | 2 | 30 | 98 | 8 | 66 | 2 |
| Don | 51 | 50 | 1 | 16 | 51 | 4 | 31 | 0 |
| Dnieper | 49 | 48 | 1 | 14 | 43 | 7 | 28 | 0 |
| Total | 206 | 202 | 4 | 60 | 192 | 19 | 125 | 2 |

The broad pack retains all 202 partitioned parents / 843 cells (1,169,372 bytes,
27,619 coordinate points). The generator's additional 10,965
`excluded_auxiliary` records count all auxiliary source entries visited, not
10,965 intersecting river parents. They are outside the active-parent inventory.

The shortlist prioritizes substantial source cuts: for each **actually cut**
original polygon component, sum the area of its faces other than its largest
face, then divide by total planar parent area. This `secondaryCutFaceShare`
must be at least 10%. It does not count an unrelated pre-existing island as a
bank, and does not claim geodesic area or a fixed left/right-bank classification.
Every positive-area fragment is retained, including very small ones.

The six-cell shortlist limit is review triage, not a validity limit or permission
to delete faces. Real interior dangling linework (>1e-9 source degrees, as
distinct from numerical roundoff) is held intact. No generator tolerance was
changed. Two otherwise passing Don bridges are deferred to keep the first
scope at 60 parents; this is a priority choice, not a failed geometry check.

## Corridor organization and source overlay review

Volga upper: Selizharovsky/Rzhev/Staritsky to Tver, Kimry, Uglich, Rybinsk city,
Yaroslavsky, Kostroma and Kineshemsky/Yuryevetsky. Dubna and Yaroslavl remain the
two approved anchors. Middle: Lyskovsky/Vorotynsky, Cheboksary/Gornomariysky,
Zelenodolsky, Ulyanovsk and Samara. Lower: Kamyshin, Astrakhan and Ikryaninsky.
The large reservoir and Volgograd gaps remain visible in the held/excluded list.

Don upper: Donskoy/Kimovsky to Dankovsky, Lebedyansky, Zadonsky, Khokholsky and
Liskinsky. Middle: Verkhnemamonsky/Verkhnedonskoy, Sholokhovsky, Serafimovichsky,
Ilovlinsky and Kalachyovsky. Lower: Aksaysky, Rostov-on-Don and Azov. Broad
Tsimlyansky and Azovsky District cuts are too marginal for this first scope.

Dnieper upper: Novoduginsky/Kholm-Zhirkovsky/Safonovsky, Dorogobuzhsky,
Smolensk, Krasninsky and Dubrowna. Middle: Vyshhorod/Kyiv, Chyhyryn/Kremenchuk,
Petrykivka and Dnipro. Lower: Novovorontsovka. Mogilev/Gomel Interior, Kaniv,
Zaporizhia and the estuary are explicit gaps, not implied continuous activation.

These are continuous **survey corridors** with admission gaps, not an assertion
that every successive parent is enabled. Upper/middle/lower labels organize
local source reaches, not a hydrological distance measurement.

All 62 shortlisted parents (60 selected plus the two deferred Don bridges) were
visually inspected in `candidate-1.png` through `candidate-6.png`; selection
records identify each panel. `risks-1.png` and `risks-2.png` inspect 16 additional
reservoir/complex/estuary examples. Blue is original river; cyan dashed is
original lake centerline. Figures show retained cell boundaries meeting those
sources, including multiple crossings and reservoirs; they are not browser
screenshots or independent evidence of present-day real-world river positions.
Historical lake centerlines, especially the lower Dnieper reservoir geometry,
need separate geographic recency review before a current geography claim.

## Actual verification and limits

- `broad.audit.json` and `independent.audit.json`: all 202 original parent domains
  and every cell are valid; full coverage, cell-to-cell overlap and Hausdorff
  displacement use the generator's original tolerances. Source parent and cell
  fingerprints match. All 202 cell-ID lists remain equal with reversed river
  line direction/order. No fragments are deleted, snapped or extended.
- Shared cell boundaries were independently sampled at 17 equally spaced points
  on **each shared line**. Maximum distance to supplied river union is
  `8.278426958690543e-15` source degrees. This samples line alignment; visual
  overlays provide separate source-shape evidence.
- For the 60 selected parents, maximum symmetric difference is
  `8.564519536277682e-16 deg²`, overlap is exactly zero, and maximum Hausdorff
  displacement is `7.105427357601002e-15°`.
- `reservoir.audit.json` independently compares 94 centerline-intersecting parents
  against 28 valid local polygons in `data/global_lakes.geojson`; `reservoirs.png`
  visually overlays nine representative reservoir parents. Of the 23 selected
  parents containing lake centerlines, 19 have their centerline entirely inside
  the lake source. Kyiv, Petrykivka, Uglichsky and Kineshemsky retain exact source
  shoreline mismatches: outside lengths are respectively `0.000036788`,
  `0.000078140`, `0.000337138` and `0.019014926` source degrees, with maximum
  sampled displacement from lake polygons `0.000288516°`. These are reported
  source inconsistencies; no buffering, snapping, deletion or new tolerance
  turns them into a shoreline PASS. Centerline fidelity to the original river
  dataset remains a separate proven claim.
- Actual frontend `normalizeRiverPartitionPack` and
  `verifyRiverPartitionFingerprints` pass for broad, candidate and frozen-wave2
  rehearsal packs. Vendored D3 Mercator paths, areas and bounds are finite for
  every cell, with positive projected area. The candidate has 30 support parents,
  10,848 coordinate points and 439,350 bytes, within unchanged frontend budgets.
- `adjacency.audit.json` uses the actual `buildPaintContourGraph` on 242 relevant
  canonical source surfaces (374 after candidate composition). Every original
  neighbor-pair seam length and every new internal seam is retained; no missing
  or extra existing neighbor pair. Baseline ambiguous segments remain 9 → 9;
  invalid rings remain 0 → 0. Internal standalone graph seam lengths match the
  independent geometry oracle within `6.67e-16°` over all 202 broad parents.
- **Existing source overlap is not zero.** 199/202 broad parents, including all
  60 selected parents, overlap another active original administrative surface.
  The worst single overlap among selected parents covers about 27.92% of its
  original parent. These original overlaps are fully listed and preserved; they
  do not represent newly created cell overlap or a global non-overlap PASS.
  Source drawing order / hit testing remains an integration risk.
- Volgograd's two source records overlap by `0.096509791500408 deg²`, about
  91.60% of `RU_CITY_VOLGOGRAD` and 94.02% of
  `RU_RAY_50074027B61241799946425`. Both remain held; neither was deleted or
  reassigned to force a clean geometry result.
- No browser picker/Undo/Redo/export test, all-wave3 composition, final-head CI,
  loader authentication or production publishing is claimed here. This task
  owns offline data selection only; actual combined runtime admission is the
  main conversation's responsibility.

## Integrator: preserve approved packs and regenerate support

The 60 candidate parent IDs do not collide with any of the approved 12. Parent
records in the existing 6-parent pilot and 12-parent wave2 remain untouched.
Use `candidateParentIds` in the JSON as the explicit additive selection.

Do **not** concatenate the two packs' support arrays:

- Candidate supports include approved Dubna and Yaroslavl parent IDs.
- Approved supports include new Kimrsky and Yaroslavsky parent IDs.
- Reuse all approved parent/cell records verbatim, add selected candidate records,
  then run existing `node_contour_neighbors` once against the complete frozen
  union and original land. It skips all split parents and regenerates eligible
  support surfaces with proven inserted boundary vertices only.

The offline `with-wave2.json` rehearsal does exactly this: 72 parents / 235 cells,
44 supports, 13,951 coordinate points, 565,704 bytes. All original 12 approved
parent records compare equal. `with-wave2.frontend.json` passes actual frontend
normalization/fingerprints and all 235 D3 previews.
`with-wave2.adjacency.audit.json` compares approved-wave2 versus combined surfaces
in the same 242-source region: all pre-existing neighbor pairs and internal
seams remain; Dubna and Yaroslavl internal lengths are exactly unchanged; 9
ambiguous baseline segments remain 9. Other regions' approved records are
preserved but were not subjected to this Eastern Europe adjacency rerun.

When combining with other wave3 regions, recompute support again for that final
union; repeat relevant parent/cell identity, budgets, neighbor and picker checks.
Only the main integrator may authenticate/register a new pack, extend location
UI, run final combined browser/CI checks or admit it for new projects. Existing
saved projects must retain their original embedded pack and paint.

## Reproduction from this worktree

Run from the worktree root. Keep temporary paths short and caches local:

```powershell
$env:PYTHONPYCACHEPREFIX = (Join-Path (Get-Location) '.runtime/river-east/pycache')
python tools/build_river_partitions.py --land data/scenarios/modern_world/runtime_topology.topo.json --river Volga --river Don --river Dnieper --include-lake-centerlines --scene-id modern_world --base-commit 2da4db61c3533f621afe2be0fe6ff494d567eb92 --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 --output .runtime/river-east/broad.json
```

The following command uses the tracked explicit ID list and unchanged CLI to
reproduce the candidate in a fresh checkout without the local survey scripts:

```powershell
@'
import json, subprocess, sys
s = json.load(open('tools/river_partitions/selections/eastern-europe.json', encoding='utf-8'))
args = [sys.executable, 'tools/build_river_partitions.py', '--land', s['source']['landPath'], '--rivers', s['source']['riverPath'], '--scene-id', s['sceneId'], '--include-lake-centerlines', '--base-commit', s['baseCommit'], '--baseline-hash', s['source']['baselineHash'], '--max-parents', '60', '--output', '.runtime/river-east/candidate.json']
for name in s['source']['riverNames']: args += ['--river', name]
for parent in s['candidateParentIds']: args += ['--parent', parent]
subprocess.run(args, check=True)
'@ | python -
```

Expected candidate pack ID:
`sha256:4c92a453d6d2c26bbeeb640f23c3f7819fe609cc0b292fbfff5c38264ef9674a`.
Survey/audit scripts retained in this local runtime directory are reproducible:

```powershell
python .runtime/river-east/inventory.py
python .runtime/river-east/audit.py
python .runtime/river-east/plots.py
python .runtime/river-east/reservoirs.py
node .runtime/river-east/frontend.mjs broad candidate
node .runtime/river-east/adjacency.mjs
python .runtime/river-east/rehearsal.py
node .runtime/river-east/frontend.mjs with-wave2
node .runtime/river-east/adjacency.mjs with-wave2 approved
```

`choose.py`/`finalize.py` are local authoring helpers, not needed to regenerate
the pack from the committed selection. `.runtime/` is ignored by Git: before
archiving this worktree the integrator should copy the entire
`.runtime/river-east/` evidence directory or deliberately regenerate it. No
runtime pack/image/audit is silently committed as a production asset.

## Selected parent IDs

### Volga: 30 parents

| Corridor | Canonical parent ID | Source name | Cells | Secondary cut faces |
| --- | --- | --- | ---: | ---: |
| upper | `RU_RAY_50074027B65544968176864` | городской округ Рыбинск | 2 | 31.1% |
| upper | `RU_RAY_50074027B69119196585413` | Тутаевский район | 4 | 34.1% |
| upper | `RU_RAY_50074027B37288894870067` | Kostromskoy District | 4 | 21.7% |
| upper | `RU_RAY_50074027B10833307399195` | Kostroma | 2 | 36.6% |
| upper | `RU_RAY_50074027B69329543674217` | Мышкинский район | 4 | 14.1% |
| upper | `RU_RAY_50074027B42067007010763` | Nekrasovsky District | 5 | 37.1% |
| upper | `RU_RAY_50074027B50723374068736` | Yaroslavsky District | 2 | 33.2% |
| upper | `RU_RAY_50074027B39997532554417` | Uglichsky District | 2 | 30.4% |
| upper | `RU_RAY_50074027B55061952513406` | Kineshemsky District | 4 | 30.2% |
| upper | `RU_RAY_50074027B81093411628760` | Yuryevetsky District | 4 | 15.4% |
| upper | `RU_RAY_50074027B50111125626076` | Kimrsky District | 4 | 14.9% |
| upper | `RU_RAY_50074027B18879924091572` | Kimry | 2 | 37.3% |
| upper | `RU_RAY_50074027B77320350284147` | Tver | 4 | 31.1% |
| upper | `RU_RAY_50074027B34532862724666` | Selizharovsky District | 4 | 36.6% |
| upper | `RU_RAY_50074027B91802635760870` | Konakovsky District | 5 | 24.7% |
| upper | `RU_RAY_50074027B51076628931359` | Staritsky District | 4 | 35.5% |
| middle | `RU_RAY_50074027B40605874483535` | Rzhevsky District | 4 | 49.3% |
| middle | `RU_RAY_50074027B54726203316693` | Gornomariysky District | 4 | 50.1% |
| middle | `RU_RAY_50074027B40993243777694` | городской округ Ржев | 2 | 40.8% |
| middle | `RU_RAY_50074027B22241988675108` | Vorotynsky District | 3 | 46.1% |
| middle | `RU_RAY_50074027B99457892446306` | Lyskovsky District | 2 | 47.2% |
| middle | `RU_RAY_50074027B57067541625780` | городской округ Чебоксары | 2 | 31.8% |
| middle | `RU_RAY_50074027B16961904381699` | Cheboksarsky District | 5 | 30.0% |
| middle | `RU_RAY_50074027B41946531355256` | Kozlovsky District | 2 | 10.5% |
| middle | `RU_RAY_50074027B34722741360949` | Zelenodolsky District | 5 | 46.4% |
| middle | `RU_RAY_50074027B67860704242461` | городской округ Ульяновск | 2 | 23.2% |
| middle | `RU_RAY_50074027B12201890066789` | Samara | 4 | 27.8% |
| lower | `RU_RAY_50074027B37574948551047` | Kamyshin | 3 | 26.6% |
| lower | `RU_RAY_50074027B71829249339229` | Astrakhan | 2 | 26.2% |
| lower | `RU_RAY_50074027B22498534109926` | Ikryaninsky District | 2 | 38.0% |

### Don: 16 parents

| Corridor | Canonical parent ID | Source name | Cells | Secondary cut faces |
| --- | --- | --- | ---: | ---: |
| upper | `RU_RAY_50074027B70316841618042` | Donskoy | 3 | 16.6% |
| upper | `RU_RAY_50074027B80661595039357` | Kimovsky District | 2 | 13.0% |
| upper | `RU_RAY_50074027B93750651156452` | Dankovsky District | 5 | 20.8% |
| upper | `RU_RAY_50074027B86327538271047` | Lebedyansky District | 3 | 30.4% |
| upper | `RU_RAY_50074027B55232682824043` | Zadonsky District | 5 | 49.5% |
| upper | `RU_RAY_50074027B77063582616712` | Khokholsky District | 3 | 13.4% |
| upper | `RU_RAY_50074027B36141655472455` | Liskinsky District | 3 | 29.7% |
| middle | `RU_RAY_50074027B73384356253915` | Verkhnemamonsky District | 2 | 13.9% |
| middle | `RU_RAY_50074027B83204669366012` | Verkhnedonskoy District | 5 | 47.5% |
| middle | `RU_RAY_50074027B75950164154064` | Шолоховский район | 2 | 40.8% |
| middle | `RU_RAY_50074027B55465693339267` | Serafimovichsky District | 6 | 50.2% |
| middle | `RU_RAY_50074027B3691210145247` | Ilovlinsky District | 3 | 30.4% |
| middle | `RU_RAY_50074027B97827439207559` | Kalachyovsky District | 2 | 28.6% |
| lower | `RU_RAY_50074027B82541686322498` | Aksaysky District | 2 | 35.6% |
| lower | `RU_RAY_50074027B53939252162264` | Rostov-on-Don | 3 | 15.1% |
| lower | `RU_RAY_50074027B53231036069281` | Azov | 2 | 20.9% |

### Dnieper: 14 parents

| Corridor | Canonical parent ID | Source name | Cells | Secondary cut faces |
| --- | --- | --- | ---: | ---: |
| upper | `RU_RAY_50074027B48378771916611` | Novoduginsky District | 4 | 22.5% |
| upper | `RU_RAY_50074027B63773787473749` | Kholm-Zhirkovsky | 3 | 14.9% |
| upper | `RU_RAY_50074027B61282999994048` | Safonovsky District | 3 | 43.3% |
| upper | `RU_RAY_50074027B18113841305478` | Dorogobuzhsky District | 5 | 14.3% |
| upper | `RU_RAY_50074027B77582248025356` | Smolensk | 5 | 28.9% |
| upper | `BY_RAY_67162791B1773631612848` | Dubrowna | 3 | 35.7% |
| upper | `RU_RAY_50074027B11359862812061` | Krasninsky District | 3 | 11.7% |
| middle | `UA_RAY_74538382B47612746607547` | Vyshhorod | 2 | 30.7% |
| middle | `UA_RAY_74538382B60890943260132` | Kyiv | 3 | 22.1% |
| middle | `UA_RAY_74538382B23530210512837` | Chyhyryn | 2 | 18.8% |
| middle | `UA_RAY_74538382B89155529549277` | Kremenchuk | 3 | 18.3% |
| middle | `UA_RAY_74538382B42847215196778` | Petrykivka | 2 | 27.3% |
| middle | `UA_RAY_74538382B23045356862491` | Dnipro | 2 | 39.9% |
| lower | `UA_RAY_74538382B85739457006484` | Novovorontsovka | 3 | 11.3% |

## Held parents and reasons

| River | Parent ID | Source name | Hold reason |
| --- | --- | --- | --- |
| Dnieper | `RU_RAY_50074027B64424707524567` | Smolensky District | complex fragmented source / runtime review |
| Dnieper | `BY_INT_MOGILEV` | Mogilev Interior | complex fragmented source / runtime review |
| Dnieper | `BY_INT_GOMEL` | Gomel Interior | complex fragmented source / runtime review |
| Dnieper | `UA_RAY_74538382B83638043560631` | Kaniv | interior dangling source line |
| Dnieper | `UA_RAY_74538382B28718545705075` | Cherkasy | interior dangling source line |
| Dnieper | `UA_RAY_74538382B86672078093677` | Zaporizhia | interior dangling source line |
| Dnieper | `UA_RAY_74538382B72369548204787` | Bilozerka | interior dangling source line |
| Don | `RU_RAY_50074027B96946895822668` | Khlevensky District | interior dangling source line |
| Don | `RU_RAY_50074027B74756274305659` | Ramonsky District | interior dangling source line |
| Don | `RU_RAY_50074027B99360860809249` | Bogucharsky District | offline pass; second-priority Don bridge |
| Don | `RU_RAY_50074027B53245825740087` | Bagayevsky District | offline pass; second-priority Don bridge |
| Volga | `RU_RAY_50074027B91001506415746` | Рыбинский район | interior dangling source line |
| Volga | `RU_RAY_50074027B93968807426390` | Ostashkovsky District | interior dangling source line |
| Volga | `RU_RAY_50074027B51726500082089` | Kalininsky District | complex fragmented source / runtime review |
| Volga | `RU_RAY_50074027B18920333631541` | Stavropolsky District | complex fragmented source / runtime review |
| Volga | `RU_CITY_VOLGOGRAD` | Volgograd | complex fragmented source / runtime review |
| Volga | `RU_RAY_50074027B61241799946425` | Volgograd | complex fragmented source / runtime review |
| Volga | `RU_RAY_50074027B28279959544204` | Yenotayevsky District | complex fragmented source / runtime review |
| Volga | `RU_RAY_50074027B5810919802918` | Володарский район | interior dangling source line |

The 125 excluded IDs and exact reasons are in the JSON (121 weak secondary-face cuts and four uncut source intersections). Excluding a parent never deletes any source area or broad-pack fragment.
