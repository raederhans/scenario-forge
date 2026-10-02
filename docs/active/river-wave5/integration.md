# River wave 5 integration

Base `bb510a54`; isolated branch `codex/river-wave5-expansion`. Primary checkout WIP and prior regional evidence worktrees are retained.

## Result and admission

The new Modern World default contains **376 parents / 1,164 cells / 111 support geometries**, adding 74 parents and 259 cells. All 302 Wave 3 parent records, cell IDs and coordinates remain exactly unchanged. Original pilot, Wave 2 and Wave 3 authentication records remain available for self-contained saved projects.

Regional review inspected 132 source-overlay panels and proposed 82 meaningful cross-bank parents. The first combined 384-parent candidate failed the full-map gate: one new neighbor pair, nine internal seam mismatches (including two old parents), and 22 new ambiguous segments. The following eight newly proposed parents are held in addition to the original five:

- `BY_INT_GOMEL`, `BY_INT_MOGILEV`, `DEA1B`, `RU_CITY_VOLGOGRAD`
- `RU_RAY_50074027B24471111608761`, `RU_RAY_50074027B51726500082089`
- `RU_RAY_50074027B61241799946425`, `UA_RAY_74538382B4751802602524`

`wave5-new.json`, `wave5-combined.json` and `wave5-review.json` record the regional review proposal. **`wave5-reviewed.json` is the authoritative final admission set.** The combined gate was rerun after exclusions; no cells were deleted from admitted parents and no source coordinates, tolerances, budgets or administrative identities were changed.

## Download and compatibility

Canonical schema-1 asset: `data/river_partitions/modern_world_wave5.json`, 2,357,372 UTF-8 bytes. It is retained for reproducible offline comparison.
Published runtime download: `data/river_partitions/modern_world_wave5.transport.json`, **1,423,165 bytes**, within the unchanged 2,000,000-character budget. Compared with the preceding 1,993,389-byte download, the larger reviewed scope downloads about 28.6% fewer bytes.

The download-only coordinate index is lossless. It is bounded before expansion, then the decoded schema-1 pack passes the existing full canonical authentication. Saves still embed full schema-1 geometry. No schema migration, geometry rounding, new dependencies or automatic old-project upgrade is introduced.

- Pack ID: `sha256:6efa7a62f51d0f534864603967d1250869c6b4dc1201aa878c9ac98cd33bde3c`
- Canonical SHA-256: `0d2e38a90fd93bef7203ead2e372558cdbc43c4b4954fdb4531b547498b49f97`
- Scenario version 2, generated at `2026-09-27T13:55:57.885587+00:00`.

Navigation retains all prior labels and adds only admitted records. Names/countries come from source properties; river associations come from reviewed interior river segments. Chinese labels use existing trusted manual dictionaries or source-name fallback. All navigation options still derive from the active saved pack.

## Verification

- Full-map source scope: 11,983 interactive surfaces, 24,201 neighbor pairs. PASS: no changed neighbors, no missing/extra internal seams, all original records and seams unchanged. Invalid rings remain 0; inherited ambiguity count remains 550 with no new locations.
- Transport implementation and final admission integration each received a bounded review with no material findings.
- Combined Node model/runtime/history/navigation/transport/held-seam tests: 69/69 PASS. Python transport/coverage/data catalog: 29/29 PASS. Held-seam fixture and the existing generator's 33 tests were separately verified by their owner.
- Real app compact loading, two-bank clicks, undo/redo, JSON save/import/export and native Canvas checks: 2/2 PASS (58.1 seconds total).
- Eight new river representatives plus the two retained Chinese representatives, search/filter/Go and the smallest cell picker with toolbar history: PASS (about 1.6 minutes).
- Legacy 6/12-parent browser roundtrip: PASS (52.0 seconds); previous 302-parent browser roundtrip: PASS (31.9 seconds). Each retains its original authenticated pack, navigation scope and colors.
- Pages build: 822.68 MiB. Publication contract tests: 65/65 PASS. Static localhost directly serving that artifact passes real compact loading/click/save/import/export, Canvas and historical Wave 3 preservation: 3/3 PASS (60.0 seconds).
- Affected child-safe adaptive verification completes successfully. Main-thread routes are deferred by that runner; the focused browser and publication checks above were run separately. Final merge/deployment receipt remains authoritative for online status.

Evidence: `.runtime/rv5/`, `.runtime/rv5-coverage/`, `.runtime/rv5-seams/`, and `.runtime/tests/playwright/rv5-*` in the integration worktree. Retain the older regional worktrees because the reviewed source atlas provenance references them.

## Remaining limits

The five earlier held parents remain excluded; exact identity-grid segmentation diagnosis and a real-source regression are in `seams.md`. This batch additionally holds eight parents with global contour interactions. Existing source administrative overlaps, reservoir centerlines, old geographic names and incomplete river branches remain. Source planar line-coverage metrics in `coverage.md` are neither real-world distance nor a claim of continuous complete river coverage.
