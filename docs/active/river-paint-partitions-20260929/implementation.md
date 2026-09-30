# River paint partitions: P0–P2 pilot

Base: `bfedc6b8eb75ae6caf15fee4711f2499efe1d4d1`.

## Product contract

An opt-in, reviewed Modern World pilot adds paint cells without adding canonical
land IDs, altering reference assignments, or replacing the source topology.
The toolbar's **River cells / 沿河填色** toggle loads the sidecar. The initial
coverage is intentionally limited:

| Parent | Name | Cells |
| --- | --- | ---: |
| FR_ARR_75001 | Paris | 3 |
| FR_ARR_76003 | Rouen | 6 |
| DEE0D | Stendal | 9 |
| DEE06 | Jerichower Land | 7 |
| RU_RAY_50074027B53551011789267 | Dubna | 4 |
| RU_RAY_50074027B57358126207690 | Yaroslavl | 2 |

There are 11 unchanged neighboring support polygons with intersection nodes
inserted on their existing edges. These are not extra editable units. All
positive-area pieces remain; small pieces have not been merged across the river.
The broad regular-river Seine/Elbe/Volga trial found 113 split parents and 440
cells. Those candidates are **not** the shipped edit scope. Lake centerlines are
included explicitly for the small reviewed pilot, not taken from display LOD.

Cell color inherits the parent until overridden. A whole-parent or geographic
batch fill/erase clears its cell overrides in the same history operation,
including when the parent already has the requested color. Turning the tool or
river display off preserves geometry and paint. Eyedropper reads persistent
cell color. Preset and administrative selection retain parent semantics.
Loading, stale scene/baseline, incomplete geometry and ambiguous hits cannot
fall through to a whole-parent edit.

## P0: immutable data and geometry

`tools/build_river_partitions.py` jointly nodes original boundaries and original
river lines before polygonization. Pre-clipping river lines was found to lose
exact intersections and is guarded by the real Stendal regression. The builder
checks validity, coverage, overlap and Hausdorff displacement without repairing
or deleting source area. It reports unsupported or incomplete cuts. Coordinates
are not snapped for display; a normalized 1e-7 grid is used only for identities.
The frontend receives clockwise exterior rings for d3.

Reproduce the shipped pack with the locked Shapely 2.1.2 / GEOS 3.13.1 inputs:

```sh
python tools/build_river_partitions.py \
  --land data/scenarios/modern_world/runtime_topology.topo.json \
  --river Seine --river Elbe --river Volga --include-lake-centerlines \
  --scene-id modern_world \
  --parent FR_ARR_75001 --parent FR_ARR_76003 --parent DEE0D --parent DEE06 \
  --parent RU_RAY_50074027B53551011789267 --parent RU_RAY_50074027B57358126207690 \
  --base-commit bfedc6b8eb75ae6caf15fee4711f2499efe1d4d1 \
  --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 \
  --output .runtime/reports/generated/river-paint/modern_world_pilot.json
```

The production sidecar is registered as `river_partitions:modern_world_pilot`.
Its complete normalized payload is authenticated by `pilot_manifest.js`.
A self-reported geometry hash is not accepted as a coverage proof on import.
Because the scenario baseline hash covers ownership, activation and import also
check the approved scenario version and generated-at build stamp. A regenerated
geometry dataset is rejected even if ownership did not change.
The pack carries baseline, source-file hashes, generator version and stable
parent/cell identities. Source changes require re-audit and an explicitly new
approved pack, not silent re-splitting of saved paint.

## P1: single model, existing rendering and transaction authorities

`js/core/river_paint/` owns the derived model, approved loader, runtime cache,
commands and sparse rendering. Parent data stays in `landIndex`; derived cell
features replace parent surfaces only for contour adjacency and bank painting.
Reference metadata comes from the parent through `map_data_boundary.js`.

The existing political pass receives sparse cell drawing on full, raster-worker
and dirty-rectangle/patch paths, with the existing parent clip. Hover highlights
the actual cell. Both bank-to-bank and bank-to-neighbor arcs use the existing
contour graph; parents and cells are never overlapping peers in that graph.

History stores touched color keys, not geometry snapshots. A project containing
cells uses schema 23 and embeds the approved pack and overrides; ordinary
projects retain schema 22. Import verifies the entire pack and current baseline
before committing. Scenario commit, rollback, reset and exit own the new field
through the existing authority catalogs.

## P2: bounded integration and lifecycle

The brush visits `(parent, cell)` targets, snapshots first touch once and commits
one stroke. Whole-parent, country, developer macro and clear/auto-fill paths
remove affected cell overrides through the canonical paint action. Unique
legend colors include cell colors without turning cells into countries.

Only the six reviewed parents and their 11 contour neighbors are pinned to the
pack geometry for this exact Modern World baseline. Published geometry caches
are keyed by source/pack and projection identity. A color change must not trigger
partitioning or contour graph rebuilds. Scene changes abort pending loads;
missing chunks retain saved paint but block incomplete image export.

## Verification and release scope

Focused commands:

```sh
npm run test:node:river-paint
python -m unittest tests.test_river_partitions -q
npx playwright test --config=playwright.config.cjs tests/e2e/river_paint.spec.js --workers=1
python tools/build_data_catalog.py
python tools/data_health.py
python -m unittest tests.test_data_catalog_contract -q
```

The native browser cases exercise the real toolbar, real-map click transactions,
undo, project import/export and exact canvas pixels using Paris geometry. Browser
success must be reported from an actual run, not inferred from node tests.

Out of scope: global activation, arbitrary river or freehand cuts, TNO/HGO/HOI4
packs, automatic sliver merging, migration across changed geometry baselines,
and changing administrative or scenario ownership. The pilot is not a survey-
grade river boundary dataset. No source geography is overwritten.

## Integration verification (2026-09-30)

The Pages runtime allowlist includes the approved pilot sidecar. The river
browser spec is registered in the regression layer and import graph, its
verification route uses the standard layer runner, and the geometry tests are
registered with the geospatial dependency group. The temporary development
workflow has been removed; maintained repository verification owns the checks.

Fresh local results: 31 river node tests, 16 geometry tests, 64 Pages packaging
tests, 71 E2E structural-tooling tests and both river browser cases passed.
The Pages build and layer, import-graph and verification-route checks passed.
These results do not substitute for required checks on the final PR head.

The subsequent affected-contract run exposed legacy test harnesses missing the
new river imports and static assertions still extracting the pre-wrapper
political pass. Those checks now use the actual runtime and base pass, retaining
their existing ordering assertions. Export additionally verifies that loading
river partitions block political/border output before canvas allocation.
Previously omitted Arctic/water tests now have geospatial dependency and route
registration. The river aggregate is a PR-level check, preserving bounded local
owner feedback. Fresh repaired suites passed 175 Node contracts, 105 runner
contracts, 9 Python renderer boundaries and 26 source-built Pages contracts.

Merge remains gated by state-policy validation. On 2026-09-30 the 500-test quick
policy suite passed 463 and failed 37. A controlled comparison replacing the 22
modified existing JavaScript files with `origin/main@bfedc6b8` sources, keeping
the test environment unchanged, passed 470 and failed 30. This is a source
comparison, not a claim that every file was a clean main checkout. The seven
additional failing cases concern click-selection ownership, quick-fill reader
dependencies, chunk publication, activation/paint projection and reference
assignment copying. No policy fingerprints or acceptance rules were relaxed.
Before merging, audit and repair the current source-bound contracts, rerun
their negative-mutation tests, and require all protected checks on the final head.

## Historical policy proof limitation

Earlier development evidence reported six diagnostics from the separate full
`check_state_writer_policy.mjs` historical proof, including archived effects for
`political_path_cache_owner.js` and `render_cache_owner.js`. That report is not a
passing quick-policy suite or final-head CI result; the current integration
comparison above establishes the broader remaining validation gap. Architecture
boundaries and the state-write allowlist remain required independently.
