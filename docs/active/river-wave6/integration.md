# River contour repair and Wave 6 admission

The default reviewed pack grows from **376 parents / 1,164 cells** to **382 parents / 1,199 cells / 106 supports**. The six restored parents are Dalateqi, Baotou, Zungeerqi, Hequxian, Kleve (`DEA1B`) and Arnhem/Nijmegen (`NL226`). All prior parent records, cell IDs and coordinates remain exact. Canonical administrative geometry and ownership are unchanged.

## Contour correction

Independently rounding endpoints onto the existing 1e-7 identity grid can give subdivisions of one source line different integer directions. A river cut then changes whether its exterior boundary is recognized. The new bounded fallback finds candidates at existing identity endpoints and checks their complete original lines against a propagated floating representation error bound. It neither moves coordinates nor changes identity precision or the 1e-9 full-map acceptance tolerance.

All original source owners, including earlier ambiguous edges, participate in the interval sweep. Already drawn intervals block duplicate output. Complete pairwise checks reject approximate transitive line chains; a 4,096-comparison budget per bucket/group preserves existing unmatched behavior on excessive fallback work. One 5,000-edge-per-side review case improved from 8.3 seconds in the initial implementation to about 44 ms after this guard. Independent review accepted the corrected implementation.

This is a correction to the shared graph, not a claim that its old output is identical. On the same unpartitioned Modern World input and on the same Wave5 input, old/new comparisons each restore length on 254 parent pairs, including 46 previously absent pairs, with no disappeared or shortened pair. Local build measurements were about 1.1 seconds before and 1.8 seconds after; ordinary color updates still reuse the graph. Detailed coordinates and review evidence remain under `.runtime/rv6/` and `.runtime/rv6-lines/`.

## Pack and compatibility

- Canonical: `data/river_partitions/modern_world_wave6.json`.
- Download: `data/river_partitions/modern_world_wave6.transport.json`, 1,435,962 source bytes, below the unchanged 2,000,000-character budget.
- Pack ID: `sha256:c9fd0b6d42aa194868d52b2289f0b667080db54f191c660c933233e9583f9413`.
- Normalized canonical SHA-256: `cf6dd9ae9328e212dfd1864582389b4c61aa6310c2cf1c5d0011534460fb12b0`.
- Original 6/12/302/376-parent authentication records remain. Saved projects retain their own embedded canonical pack and navigation scope; there is no automatic scope migration.

## Verified local behavior

The final 382-parent full-map comparison covers 11,983 interactive source features and 24,247 neighbor pairs. It passes with no changed neighbor lengths, missing/extra internal seams, changed old records or old seams, or added ambiguity locations. Invalid rings remain 0 and inherited ambiguity remains 550. This baseline/candidate comparison uses the corrected graph on both sides; the separate old/new comparison above measures the algorithm change.

Graph/runtime/contour regressions pass 51 tests, including exact ambiguous-owner and occupied-interval controls, an interior third owner with no shared endpoint, a bounded long chain, and the unchanged rejection of seven real overlapping parents. The held exterior fixture also includes both sides of DEA1B/NL226 split. Four pack/runtime/history/navigation suites pass 66 tests. Data health and catalog checks pass after synchronizing the landing count to 676.

The standard geometry audit passes Modern World, HOI4 1936 and 1939, TNO, and TNO coarse/detail promotion. Focused source browser checks pass all four cases: real toolbar load/click/history/save/import/export, all six restored parents plus the smallest picker, native Canvas, and the old Wave5 saved-project scope. Their total runtime was 2.1 minutes; each retained its existing case budget. Publication and remote CI/deployment receipts are recorded separately by the integration owner.

The 824.06 MiB Pages artifact passes 65 publication checks and three static localhost browser cases (57.6 seconds): actual download/edit/save/export, native Canvas, and old Wave5 scope. Six tracked dist mirrors are copied from that verified artifact. Source and static servers were shut down after the tests.

Affected adaptive validation (`--base 433e5b33 --execute --defer-main-thread`) completed 40 commands successfully with no route gaps. It deferred 18 main-thread commands; those deferrals are not execution claims. The focused browser and publication checks above were run separately by the integration owner. Evidence: `.runtime/rv6/adaptive.json`, `adaptive.md` and `adaptive.log`.

Independent GEOS checks of the 323 newly matched raw-source segments found both owners, positive lengths, opposite ring interiors and original source endpoints for every segment. The maximum sampled distance to either source boundary was about 3.12e-14 degrees. These checks prove source-boundary alignment, not final overlap visibility: some segments lie inside a third source polygon even though that polygon does not share their boundary. The graph continues to model edge ownership; interior polygon occlusion remains part of the source-overlap limitation below.

## Remaining seven parents

`BY_INT_GOMEL`, `BY_INT_MOGILEV`, `RU_CITY_VOLGOGRAD`, `RU_RAY_50074027B24471111608761`, `RU_RAY_50074027B51726500082089`, `RU_RAY_50074027B61241799946425`, and `UA_RAY_74538382B4751802602524` remain excluded.

The complete 389-parent proposal now has zero exterior neighbor differences, but still fails nine internal seam checks, changes two old seams and adds 22 ambiguous locations. The real overlap fixture preserves those failures. Restoring each parent's seam independently would draw lines over a later overlapping fill. A future repair must reconcile source overlap, visible fill order, hit testing and contour visibility, including the difference between full and partial repaint order. It cannot be implemented by relaxing the admission gate.
