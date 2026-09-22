# East Europe coverage investigation — 2026-09-22

Implemented `tools/audit_tno_east_europe_gaps.py` with JSON findings, IDs, adjacent source countries, local equal-area measurements, maximum inscribed diameter, window-edge censoring, contact type and suggested next action. It reads the published topology and subtracts political coverage from `land_mask - scenario_water - scenario_atlantropa`. It does not change canonical geometry, ownership or coverage validation. Invalid geometry raises; it is never repaired or discarded silently.

## Measured runtime evidence

All windows below use the canonical TNO topology and a reporting threshold of 0.1 km². Counts are scoped samples, not an inventory of all Russia or Ukraine. Areas include window-edge components whose full extent is unknown.

| Window (west, south, east, north) | Features | Uncovered components | Same-country, multiple-feature contacts | Single-feature contacts | Gap area km² | Mismatched adjacent pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Central Russia (35, 54, 42, 58) | 215 | 607 | 576 | 31 | 4553.806 | 9 |
| Ukraine and neighbors (29, 47, 36, 51) | 242 | 23 | 8 | 1 | 299.640 | 18 |
| Ukraine/Belarus (24, 50.5, 29, 52.5) | 50 | 6 | 0 | 0 | 250.677 | 9 |

The eight same-country components in the Ukraine-and-neighbors window belong to neighbors, not to Ukraine. Its one UA-only component contacts only `UA_RAY_74538382B7822777781560`, has area 0.104 km² and approximate width 80 m. This sample therefore does **not** establish widespread internal Ukrainian administrative seams.

The largest central-Russia component is enclosed and touches `RU_CITY_MOSCOW` and `RU_RAY_50074027B20152914209721`. Area is 123.992 km², maximum inscribed diameter approximately 6955 m, bounds `[36.801368,55.295116,37.013770,55.512306]`. This is uncovered runtime land, not an anti-alias-only observation.

A read-only comparison to the main checkout's cached `data/geoBoundaries-RUS-ADM2.geojson` found two source features at that component (`50074027B76004087301964`, `50074027B20152914209721`). Their union covers only 0.089520366 of the gap's planar area. Most of this example is already absent from that source. This establishes a source limitation, but does not establish historical ownership or rule out unmodeled water. The ignored source cache is absent from the isolated worktree; the comparison used its explicit absolute path in the main checkout.

The UA/BY sample includes an enclosed 37.229 km² component touching `BY_INT_BREST`, `BY_INT_GOMEL`, `UA_RAY_74538382B57991939893011`, with approximate width 3531 m. The largest UA/BY component is window-truncated and must not be treated as an enclosed repair candidate.

## Interpretation and next action

- `real_polygon_coverage_gap` means positive uncovered area in the runtime's declared allowed land. It is a repair-review candidate, not proof that its entire area should be assigned to a political feature.
- `adjacent_edge_mismatch` means overlapping interiors or unmatched input boundary segments/vertices within the window. Pair checks use the existing exact coverage helper; its strict semantics are unchanged.
- `lod_or_simplification_difference` requires a same-ID reference topology to cover essentially the whole reported component. Partial coverage is reported separately as `partially_reference_covered_gap`, preserving the remaining real-gap evidence. The report includes the covered fraction and does not infer which runtime mixed-owner combination was displayed.
- Renderer hairlines remain `unconfirmed_requires_same_extent_browser_capture`. No screenshot or frame timing was claimed by this geometry-only task.

The existing Russian precision pilot freezes the accepted owner domain and explicitly preserves inherited holes. Raising source precision alone therefore cannot solve all observed gaps. The next repair should choose a bounded, reviewed component; establish land/water intent and recipient IDs; anchor opposite boundaries; partition only that component; then verify no overlap, no original-territory loss, owner/controller/core stability, mixed-LOD behavior and click/undo. Existing `partition_reviewed_seam` provides the narrow interpolation primitive once those inputs are established. No generic buffer, nearest-feature filling or opt-in automatic repair was added because source evidence cannot uniquely determine the missing territory's recipients.

## Reproduction and verification

```powershell
python tools/audit_tno_east_europe_gaps.py --bounds 35 54 42 58 --min-area-km2 0.1 --include-geometry --output .runtime/reports/generated/east-europe-ru-central-v2.json
python tools/audit_tno_east_europe_gaps.py --bounds 29 47 36 51 --min-area-km2 0.1 --output .runtime/reports/generated/east-europe-ua-interior-v2.json
python tools/audit_tno_east_europe_gaps.py --bounds 24 50.5 29 52.5 --min-area-km2 0.1 --output .runtime/reports/generated/east-europe-ua-by-v2.json
python -m pytest tests/test_tno_east_europe_gaps.py -q
```

The CLI accepts only a fresh output path under repository `.runtime`; use a fresh filename for another run. Optional `--reference-topology` accepts an explicitly assembled detail/coarse/mixed frame with matching window IDs. `--include-geometry` emits gap GeoJSON for source comparisons and visual review. Width is an approximate maximum inscribed diameter (1 m solver tolerance), not maximum separation along every point of the border.

Tests cover a real UA/BY canonical sample, an enclosed synthetic hole that passes coverage validation, protected water, detail/reference geometry loss, overlap, unmatched shared vertices, invalid geometry, comparison ID drift, and mismatches outside the audited window. The canonical sample intentionally detects the presently unreviewed UA/BY gaps; update its expectation only with evidence when that baseline is repaired.

Result: the final East-Europe suite contributes **9 passing tests** to the combined 19-test precision-tools run on 2026-09-22. The three CLI audit runs completed and produced the `v2` JSON files listed above. No canonical data was modified.

## Continuation source check

The continuation task intersected the exact largest Moscow-area gap from `east-europe-ru-central-v2.json` with the main checkout's cached Natural Earth ADM1 shapefile and `ne_10m_lakes.zip` (read-only bbox query, EPSG:4326). Moskovskaya covers 0.9999654818311507 of its planar area; Moskva covers 0.000034518168846707446. No cached lake feature intersects it. These are source-resolution observations, not proof that no smaller water feature exists. ADM1 supports an oblast-level classification but does not identify the unique ADM2/runtime recipient. The gap therefore remains unfilled; no ownership was invented from nearest distance.
