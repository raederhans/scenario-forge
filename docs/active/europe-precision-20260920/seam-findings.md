# RKP / RKU seam diagnosis — 2026-09-20

The user's visible seam was a real gap between source geometries, already present before the expansion. Following explicit repair authorization, five reviewed PL/UA corridors were repaired and integrated locally on 2026-09-20. Focused geometry and browser acceptance passed for this border; other mixed-source borders are not certified by this result.

Invariants, individual country coverage and mixed LOD consistency do not prove that adjacent countries cover the intervening land. Shapely coverage validity allows holes. The repair therefore also rejects remaining unassigned land corridors touching both PL and UA within the reviewed window.

## Completed repair

`tools/repair_tno_poland_ukraine_seams.py` selects five explicit enclosed components using reviewed seeds, bounding boxes and area limits. Each whole component is checked against land_mask, scenario_water, scenario_atlantropa and existing political coverage. PL/BY/SK geometry stays fixed. Shared UA administrative junctions connect to existing opposite-border vertices, with a visibility path around concavities. Crossed bridges and faces without exactly one UA receiver are rejected. No global buffer or renderer change is involved. This is a documented interpolation of missing source geometry, not a newly acquired historical boundary source.

| Reviewed corridor | Missing land before (km², EPSG:3035) | After |
| --- | ---: | ---: |
| Volhynia | 788.0475 | 0 |
| West Lviv | 468.8705 | 0 |
| Southern tripoint | 90.3519 | 0 |
| Southern border | 34.8014 | 0 |
| Southern sliver | 2.4381 | 0 |

Total filled area: 1384.5095 km²; 11 existing UA IDs expanded, 191 coordinates added. All original territories are retained. The other 12008 political geometries and six auxiliary objects remain unchanged; owners/cores/countries are byte-identical. Additions retain RKP/RKU/HUN ownership from their receiving IDs, including the southern UA-source feature already owned by HUN. Numeric overlay tolerance is 1e-12 square degrees; it does not move vertices.

Runtime hash: `fb1157c4ce6afe7670cd35cbcab26abbe1e33637c70686f34cedc2467db1d5a7`. The regional build regenerated affected RKP/RKU/HUN detail assets and the coarse layer; chunk count remains 198. Twelve mixed-owner LOD combinations pass. Strict contracts pass in stage and after integration. Targeted tests: 35 passed plus 4 subtests. Browser verified this runtime hash, loaded the three affected detail owners and clicked/filled/undid all five former gaps with the expected feature IDs. No chunk load errors were recorded.

Runtime raw size grows 14370 bytes; equal gzip level 6 grows 5703 bytes. English startup gzip grows 45 bytes. These are payload deltas, not a new FPS benchmark.

Evidence root: `.runtime/tmp/tno-seam-20260920/` contains `final-candidate.topo.report.json`, `validation.json`, `contract-integrated.json`, `size-delta.json`, `integration.json`, and `seam-before-after.png`. The plot uses decoded final candidate geometry, not an earlier trial. Browser evidence is `.runtime/browser/tno-seam-20260920/{runtime.json,click-undo.json,final-detail.png}`. Sixteen files were copied after checking current files against the preserved pre-repair backup at `.runtime/tmp/tno-seam-20260920/baseline/`.

Rebuild order: run the repair tool after the precision expansion against an unrepaired baseline, then `tools/regional_scenario_assets.py`, safe scenario finalization without rebuilding chunks, gzip synchronization, and finally snapshot/audit binding. Do not rerun bundle generation after that final binding: its compact gzip serialization differs from the synchronized raw JSON bytes. Validate the resulting strict contract. No remote publication or commit was performed.

The older gaps on UA/SK and UA/BY away from this PL/UA corridor remain outside this patch. Whole-Europe visual acceptance still requires separate border review.

## Measured evidence

In the fixed window 21.5–26°E, 48.5–52.5°N, uncovered political area decreased from approximately2524.44km² to1724.24km². Areas were measured in EPSG:3035; this window is a diagnostic extent, not a territorial claim.

- Volhynia corridor: approximately882.18km² before,788.05km² after; candidate bounds23.6214–24.1868°E,50.4347–51.6347°N.
- West of Lviv: approximately579.05km² before,468.87km² after; candidate bounds22.6408–23.7782°E,49.4961–50.3978°N.
- The two candidate gaps have effectively zero overlap with the union of cached PL/UA/BY source polygons. Their representative points are inside published land_mask and outside scenario_water. The source geometry already lacks these strips; increasing internal detail cannot fill them.

Evidence: `.runtime/tmp/europe-precision-20260920/poland-ukraine-seams.png` (same-extent before/after atlas), `seam-measurements.json` (areas, bounds, representative points, source intersection), `.runtime/browser/europe-precision-20260920/poland-ukraine-seam.png` (application view).

## Repair direction

Reconcile a shared PL/UA outer border, then assign the missing land strips to the existing adjacent administrative IDs while retaining each ID's TNO ownership/core metadata. A high resolution PL border can anchor this seam, but the Ukrainian administrative partitions need an explicit continuation rule and review where RKP/RKU ownership changes. Preserve water, foreign enclaves and unrelated land; do not globally buffer polygons or hide the gap with a wider stroke.

Add an acceptance check for unassigned land corridors touching two source countries, in addition to overlap/coverage/LOD checks. Compare candidate versus baseline corridor area, maximum width, adjacent owners and rendered close-ups. Similar inherited seams may remain at Luxembourg and other mixed-source borders; the earlier whole-Europe visual assessment was insufficient.

The CLI renderer review suggested possible underlay/winding mechanisms but supplied no runtime reproduction. They are not established causes here: the missing areas are directly measurable in the source and runtime polygons without rendering. No renderer WIP was changed.
