# Task

## Status
Implementation and delivery review are complete in the isolated `codex/layer-render-optimization` worktree. The latest `origin/main@a0476c9c` country/city label changes were merged and their snapshot integration reviewed. The user authorized push and PR merge. Final remote CI and merge are established by PR #209's receipt.

## Delivered scope
- Correct border angles and scale screen-space declutter thresholds; keep latest-main single-projection reuse.
- Keep transport labels at screen size, share collision occupancy, and smooth city spacing across the 3.05 threshold.
- Isolate contour invalidation from transport/labels; clip strategic graphics and place anchors correctly across the antimeridian.
- Account for retained canvases and shared projected paths, bound duplicate merged paths, release disabled passes, and restore/release export caches safely.
- Gate navigation reuse by coverage and magnification, retain a bounded base-only detail frame, and replay bounded text/sprite snapshots without rerunning layout.

## Delivery review repairs
- Subtract pass overscan from label anchors and account for its true coverage rectangle. The regression includes 800x600 CSS, DPR 2/3, 15% overscan, text/sprites, pan and zoom.
- Release obsolete merged-path accounting immediately during political regroup, including while the next slice waits for idle.
- Extract surface resource ownership and political accounting helpers without increasing architecture budgets.
- Register missing navigation, overview, label, coverage and city suites; route renderer mirror contracts to a fresh Pages build in CI.
- Preserve latest-main export contour disposal and political reuse counters. Exclude unrelated primary-workspace thematic and city-label work.

## Local verification
Evidence root: `.runtime/tmp/layer-render-delivery/` in the managed worktree.

- Layer behavior suite: 347 tests passed before the final resource extraction. After extraction, the affected cache/background/path/export combination passed 105 tests; label/catalog/orchestration/export integration passed 75 tests, including all 12 snapshot regressions.
- Changed owner boundaries: 23 tests passed; the two contracts affected by resource extraction were rerun, 12 passed.
- Verification catalog tests: 117 passed. PR planner/delivery tests: 29 passed. Portfolio, import graph and route schema checks passed.
- Architecture boundaries and final Pages source graph passed.
- Final isolated Pages build: 769.86 MiB at `.runtime/tmp/layer-render-delivery/pages-final`; all 9 mirror/inventory tests passed. Pages startup suite passed 64/65 initially; its remaining old wrapper-text assertion was updated to the visibility-filter wrapper, and the single affected case passed on rerun. No runtime source changed after the final build.
- `verify:commit` stopped at planning because several cross-module suites are not eligible for its local edit mode. It did not run tests. The corresponding direct behavior, architecture and artifact checks above were executed; remote required CI remains mandatory.
- Final `pr:plan` has no unmatched paths or route gaps; it requests full smoke, a fresh Pages artifact and required sampled performance.
- The first remote run passed smoke/Golden Demo and sampled performance, but fast verification exposed missing active-pass dependencies in the exact-composite VM fixture. The fixture was repaired; its exact-composite/export/transformed-frame combination passed all 54 tests.
- Latest-main label integration passed 171 of 172 tests initially. The upstream orchestration fixture was adapted to the extracted label-content function, retaining its capital/country/city ordering assertions; all 32 country-label render tests then passed. Architecture boundaries passed after the main merge. Final-head remote checks remain required.
- Subsequent CI exposed an obsolete static composite-pass assertion. It now checks active-pass filtering and injection while retaining continuity/order constraints; all 21 heavy scenario contract cases passed. Local continuation of the interrupted CI checks found one stale route expectation, which now includes all five newly registered layer suites; both affected route cases and the remaining contract groups passed.
- After a remote Golden Demo download wait hit its overall timeout, the unchanged demo passed locally in about 96 seconds, including the snapshot download. A separate remote performance attempt failed on localhost `ERR_CONNECTION_FAILED` and was rerun without changing code or thresholds. Neither failed attempt is counted as a pass; final-head remote outcomes remain authoritative.

## Browser evidence and limits
Final integrated source was reloaded in the in-app browser on localhost:8008. TNO 1962 was checked at 305%, 366% and 800%; CDP confirmed actual zoom and presented exact-frame transforms, city off/on worked, and no warning/error logs were captured. Screenshot and final transform evidence are under `.runtime/browser/layer-render-delivery/`. The temporary tab and root-owned server were closed.

A separate existing main-branch behavior was identified: opening sidebars refits the viewport to k=1 while the percentage control can retain its previous number. The resize/event/command files are unchanged by this delivery. Final zoom checks used a fixed sidebar layout and verified the actual state and pixels.

No FPS or native-memory improvement percentage is claimed. Cache byte figures are ownership estimates. Browser coverage is focused, not all-device/all-scenario acceptance. Primary-workspace WIP remains untouched; the managed checkout is retained for ignored evidence.
