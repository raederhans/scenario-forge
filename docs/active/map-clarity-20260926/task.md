# Map clarity task

## Current status
Implementation and focused validation complete on codex/map-clarity-20260926. Delivery: [PR #174](https://github.com/raederhans/scenario-forge/pull/174). The PR receipt is authoritative for the merged SHA, required checks and automatic deployment. Original main checkout WIP remains untouched.

## Checklist
- [x] Baseline captured at 1440x1000, device DPR2, TNO100%/250%; old effective DPR1.5, new DPR2.
- [x] Density/profile core and targeted tests
- [x] Quality UI/persistence integration
- [x] Semantic political borders and regression tests
- [x] Border/river visual hierarchy
- [x] Corrected LOD evidence: earlier 841-feature sample withdrawn because it used legacy, unreferenced detail files. Current-manifest Swiss regression demonstrates missing composed-graph seams; the full-source political mesh preserves all8 target segments.
- [x] Browser/roundtrip/export/recovery verification
- [x] Final scope/limitations review

## Validation
- Display policy, pixel-ratio policy, scenario profile and existing scenario health: 19 passed (native worker).
- Paint contour graph/runtime and political border policy: 35 passed (native worker).
- River render owner: 16 passed (native worker).
- Appearance action/border owner and project roundtrip: 52 passed, then the added display/political preference roundtrip case passed separately (parent).
- Border draw owner and appearance preset owner: 8 passed (parent).
- Focused Playwright initially passed density/camera, political arc toggle/no graph rebuild, and DPR3 export restoring visible cache. Expanded assertion exposed that input idle precedes asynchronous raster completion; final test now waits for the actual political/border reference transforms, not only input flags.
- Read-only reviewer found no material correctness findings. git diff --check passed.
- Final expanded Playwright run passed in59.2s: actual political/border cache transforms match the camera after all three quality changes; initial DPR2 canvas size is verified; toggling political edges changes active arcs without graph rebuild; DPR3 export has painted pixels and restores screen DPR2 and the same cache object. No page errors. Command: PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:8001 npx playwright test tests/e2e/map_clarity.spec.js --workers=1.

## Limits
- Browser coverage is one controlled Chromium DPR2/1440x1000 TNO scene. DPR1/1.25/1.5/2/3 and large viewport budget behavior are policy-unit coverage, not a hardware matrix.
- Higher density increases pixel memory. The 6M budget caps a main surface, not aggregate pass memory, and DPR1 is a soft floor for >6M CSS viewports. No FPS/p95/GPU-memory benchmark claim.
- Before/after screenshots are illustrative snapshots; the focused runtime test is the proof of density, camera, political edge and export behavior.
- Earlier display-only rounds did not rebuild data. The continuity repair below now updates the local TNO derived assets; no production deployment.

## Political border follow-up
- Political borders are now separate from paint contours. Scenario country strokes use the existing full-source opening mesh pack; mixed coarse/detail geometry no longer determines their completeness.
- Both same-color and different-color political borders obey the switch. Blank drawing retains color fusion, and same-owner paint contours remain separate and subdued.
- World political strokes use base width*0.6 and opacity*0.68 (defaults0.72CSS px/.612), smoothly reaching full strength at3.2x; interactive/settled political styles match.
- Publish a matching late mesh pack through the existing optional-layer state writer, with one render request even when chunk selection is unchanged. Foreign-scene packs are rejected.
- Follow-up Node verification: paint graph/runtime33, draw owner8, political policy/runtime/pass signatures43, chunk reuse/continuation/cancellation73, and current-manifest Swiss asset regression1 passed.
- External Air extraction task d7cc43e1076e4269b4cc8fe20f52dcf0 stalled without creating its owned fixture and was cancelled; the parent implemented direct current-manifest asset verification instead. No quota-depletion claim.
- Startup trace also proved two concurrent mesh-pack requests; the resource-group loader now shares in-flight requests across same-scenario/version/URL bundle objects. Its3 focused tests passed; per-caller continuation generations and retry-after-failure remain intact.
- Final follow-up Playwright passed (1 test, 59.7s total): the real TNO startup requests its mesh pack exactly once; world and250% views retain the same political source object and line count without geometry builds; switching political borders off changes exported border pixels and retains same-owner paint contours; all quality modes preserve camera/cache transforms; DPR3 export restores the screen cache. No page errors. Final world/zoomed screenshots were visually inspected. Log: .runtime/tmp/map-clarity/political-browser.log.
- After the loader change, the affected quick-contract/cancellation checks were rerun (66 passed). All browser test processes completed; the parent preview server remains available at http://127.0.0.1:8001/app/.


## Source continuity repair (completed 2026-09-26)
- Repaired the existing TNO DZA shared coverage from same-ID Natural Earth source boundaries: 48 IDs retained, 119 source-backed enclosed gaps filled, no old domain removed, valid nonoverlapping coverage. New land remains within land_mask and outside protected foreign/water/Atlantropa surfaces. All political feature properties and assignment inputs remain unchanged.
- Added map_builder/geo/source_coverage_repair.py and tools/repair_scenario_source_seams.py. Ambiguous source assignments fail explicitly; the one tiny baseline-only overlap is assigned to its uniquely nearest existing source parent and recorded in the candidate report.
- Changed extension admin1 simplification to country-wide coverage_simplify with simplify_boundary=False. Actual configured input checked: 49 country groups, 1140 features, valid coverages and unchanged country outlines. This prevents recurrence in future builds; it does not retroactively migrate every scenario.
- Rebuilt local runtime topology, political mesh, affected detail chunks, coarse DZA features, startup support/bundles, source hashes, coverage ledger, snapshot and audit. Kept all non-DZA coarse features and unrelated detail chunks from baseline to avoid unrelated repartitioning/LOD changes. Manifest.version remains schema version2; refreshed source hashes drive startup cache invalidation.
- Important correction: the earlier CHI/JAP, PAK/RAJ and BRM/LAO extra boundary-intersection lines are same-side overlap outlines, not missing political boundaries. Retained the original mesh algorithm, added semantic regression cases and corrected the generated audit report. The 214 owner overlap pairs remain candidates requiring source/scenario interpretation.

### Repair validation
- Source repair, admin1 and mesh semantic/write tests: 9 passed, 6 subtests passed.
- Current-manifest TNO regression: 1 passed. Verifies all48 DZA coverage, former28N/29N breaks, ALC/IAL overlap removal, full shared-line mesh coverage, and coarse coverage. Initially failed on old data; the unrelated29.5N province sample was removed from the specific Adrar/Tamanghasset pair assertion.
- Existing current-manifest Swiss border regression: 1 passed after data replacement.
- Strict TNO scenario contracts: PASS. Staging directory basename had suppressed coverage-ledger generation; final ledgers and snapshot were regenerated under actual tno_1962 and the strict gate passed.
- Data catalog regenerated; data_health passed with existing report-only large-file warnings; catalog contract19 tests passed. Catalog contents did not semantically change.
- Focused Playwright: 1 passed,58.2s total. Three former Algerian seam pixels respond to the political-border toggle; world/250% views, all three display qualities, one mesh request, DPR3 export and cache restoration pass; no page errors. Screenshot .runtime/browser/algeria-border-repaired.png inspected. Log .runtime/tmp/map-clarity/continuity-browser.log.
- git diff --check passed. No commit/push/deploy. Parent preview retained at http://127.0.0.1:8001/app/; reload an already-open page to discard its in-memory old geometry.

### Scope
Actual scenario data repair is the confirmed Algerian group. The shared-source simplification fix applies upstream to extension countries, but other overlap candidates and other scenarios have not all been migrated or visually accepted. The corrected report is .runtime/reports/generated/political-border-continuity-audit.md.


## Authorized integration and delivery
- Product commit0511b624, main integration05d54e28, verification registration79d7fa09. Remote main cc76f209 merged without file conflicts.
- Rechecked changed Node tests:167 passed across15 files. Post-integration architecture check passed; focused browser passed in56.6s; Pages artifact-only build passed at573.64MiB (integration-dist under.runtime).
- Added10 standalone verification routes,3 geospatial dependency classifications and focused E2E regression registration. Metadata59, classification75, schema651, E2E layering/timeout and script portfolio checks passed.
- PR #174 is the protected-main delivery record. Retain this worktree for active localhost8001 and repair recovery artifacts. Do not synchronize/reset the dirty original main checkout; other tasks own those files.
- Refreshed the generated E2E import graph and TNO landing hero after integration. Final artifact-only Pages build passed at573.65MiB; all65 Pages startup-shell tests passed against that exact artifact. Startup resource-graph contracts also passed4/4 with the same artifact root.
- Integration checks exposed stale state-policy receipts already present on main as well as the changed chunk-runtime fingerprint. Reconciled exact proof records, retired a removed city-light operation receipt and repaired stale mutation fixtures. Added source-bound read-only sibling arguments for the existing effectful paint helper and a copy-before-freeze reader receipt. Selector policy is unchanged. Targeted scanner/delegation114 and P4quick490 tests passed, including illegal-write rejection. Full historical P4 proof was not rerun; an additional preexisting scenario-region pure-reader callback limitation remains fail-closed.
- Added the source-repair tool to existing verification routes and updated the exact Nightly geospatial route count from15 to18. Core/commit runner105 tests passed. Export readiness fixture and pending/error regressions passed12 tests. PR-file selection has no unmatched files; the PR checks remain authoritative for final acceptance.
