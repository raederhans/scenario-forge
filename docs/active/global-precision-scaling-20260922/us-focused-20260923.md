# US migration focused continuation

User authorized concentrating on the United States after the global migration
candidate PR reached 18 green checks at `fe224baf`. PR #146 was subsequently
merged as `c1ec0bcd`; its tree equals `fe224baf`. This continuation uses branch
`codex/us-county-acceptance-20260923` based on that merge. Production publication
is not part of this continuation. Preserve canonical data and unrelated WIP.

Root owns runtime/performance verification, integration, full builds and CI.
The historical agent owns the bounded partition fix and tests; the project
agent owns reviewed modern lineage and tests. The UI agent owns the Quick Fill
popup refresh regression. Root integrates their changes and reviews evidence.

Root's read-only preview command (repository cwd):
`python -u .runtime/tmp/global-migration-20260923/preview_server.py 8015 modern_world=.runtime/reports/generated/us-focused-20260923/modern/modern_world`.
Port 8015 and `.runtime/tmp/us-focused-20260923/preview.{log,err.log,pid}` are
root-owned. Missing candidate assets fail instead of falling back to canonical.
Stop the owned process at completion; preserve the user's other servers.

Root's Playwright probes are `probe.mjs` and `interactions.mjs` under that temp
directory. Their corresponding logs and reports under
`.runtime/reports/generated/us-focused-20260923/` are readable by other agents,
but no other agent may launch or poll these processes. Success requires the
candidate's 3,144 US counties, 718 retained Indian features, correct 93-county
Nebraska fill/undo/redo state, fresh render sequences and no browser errors.
The repeated interaction probe uses two warmups and five measured cycles;
settlement wall time includes the quiet window and is not input latency.
Any failure stops the probe and retains raw evidence before a new hypothesis.

## Measured runtime and fixes

The initial runtime probe confirms 3,144 US counties and 718 retained Indian
features. No script or HTTP error occurred. A UI defect was reproduced: the
Quick Fill model contained State after US selection, but opening the popup
kept stale options. Opening now refreshes the current country and policy;
forbidden Quick Fill closes its own popup without closing unrelated surfaces.
The regression fails on the previous controller and passes after the fix.

The pointer fixture initially used the bordered container's outer origin,
selecting an adjacent county at world zoom. It now uses the actual map SVG
origin. This was a probe error, not a county geometry defect. The corrected
probe selects McPherson County, paints exactly 93 Nebraska county IDs, and
checks both state and actual rendered pixels on undo/redo/restoration.

All seven cycles pass with no browser errors. After two warmups, the five
fresh political-frame durations are:

| Action | Samples (ms) | Median (ms) |
| --- | --- | --- |
| Fill | 342.4, 332.9, 353.2, 317.8, 317.1 | 332.9 |
| Undo | 337.9, 338.2, 253.7, 294.6, 282.6 | 294.6 |
| Redo | 355.1, 344.5, 318.8, 298.0, 336.8 | 336.8 |

Viewport is 1440x960 with DPR 1.5. Each operation has newly published render
sequences; these frame durations are not end-to-end input latency or a
controlled comparison to earlier observations with different viewports.
Source evidence is `interactions.json` in the report directory.

An additional read-only analysis distinguishes the asynchronous wait from the
complete frame. All twenty measured actions, including restoration, have unique
worker and first-pixel metric sequences. Their timestamps lie between each
action's two fresh frames, with the expected fill/undo/redo labels and
`political-pass` paint source. These are current-action samples:

| Action | Worker round trip median (ms) | Renderer first-pixel submission median (ms) |
| --- | --- | --- |
| Fill | 622.0 | 965.3 |
| Undo | 636.1 | 951.5 |
| Redo | 628.2 | 965.5 |

These columns overlap other timings and must not be added together. First-pixel
submission is the renderer's recorded paint milestone, not proof of final
screen presentation. Every action uploads zero new geometries but renders
13,486 entries and rebuilds 1,346 worker paths. The worker retains 12,140 paths
at an estimated 33,554,400 bytes against its 32 MiB budget. Internal worker time
mixes projection, rasterization, cooperative yields and bitmap export; the data
does not attribute all of it to cache misses. Old cumulative main-thread cache
eviction and deferred startup-build records are excluded from these findings.

The next profiling step is to separate those worker stages and main-thread
identity preparation before choosing a change. A smaller candidate is reusing
political background entry metadata within one cache build; it does not address
the dominant worker wait by itself. The 93-county action legitimately exceeds
the existing 48-feature partial-repaint limit. Neither that limit nor cache
budgets should be raised simply to make this sample pass. Current evidence does
not support performance release approval or a regression/speedup claim.

A subsequent diagnostic used temporary HTTP overlays of the worker kernel and
client, adding only cumulative timing calls. Tracked renderer files, budgets,
draw order and cancellation behavior were unchanged. The same viewport, county
selection, two warmups and five measured cycles again pass state/pixel checks.
`interactions.profile.json` records the instrumented run; the original receipt
is retained separately. Median worker phases are:

| Action | Worker total (ms) | Path build (ms) | Draw API calls (ms) | Yield wait (ms) | Bitmap export (ms) |
| --- | --- | --- | --- | --- | --- |
| Fill | 482.0 | 50.2 | 201.9 | 0.2 | 219.3 |
| Undo | 478.2 | 48.5 | 203.1 | 0.2 | 218.5 |
| Redo | 483.8 | 49.6 | 203.5 | 0.2 | 220.3 |

All twenty measured actions have distinct worker sequences within their fresh
frame windows and no browser errors. Canvas may defer actual raster work until
bitmap export. These measurements identify the combined drawing/submission
path as dominant, rather than proving a serialization bottleneck. Additional
clock calls and a separate run preclude interpreting the lower total as an
optimization. Enlarging the path cache cannot remove the roughly 420 ms
drawing/submission cost. The next optimization needs a measured design for
reducing full-surface work while preserving painter order, overlap and
asynchronous identity checks.

## Historical geometry

Very thin polygonized faces may have a representative point outside the face.
The adapter now requires whole-face original-domain and county evidence in
that case. Illinois `US_ZN_17_004__R` partitions into 20 valid children with
zero domain area difference and inherited assignments. The focused Python
suite passes 20 tests, including ambiguous and external-point regressions.

The full three-scenario adaptation reveals another previously accepted face in
Pennsylvania `US_ZN_42_017`: its representative point selected a county which
does not cover the face. Removing it passes area comparison but violates the
existing Hausdorff limit. The whole parent therefore remains unchanged. Iowa
`US_ZN_19_007__R` also has insufficient whole-face membership evidence, and
HOI4's Michigan `US_ZN_26_014__R` has an invalid source polygon. No threshold,
geometry repair or proximity-based ownership was introduced. Older historical
US candidates need this revised acceptance before release; their former
county membership acceptance is not reused as proof.

Root runs `build-bundles.ps1` under the task temp directory, sequentially staging
HOI4 1936, HOI4 1939 and TNO from the new `adaptation/` and `sidecars/` outputs.
Each full bundle uses the original verified county source in the retained
precision-expansion worktree and canonical scenario baseline, writes only to
the task `bundles/` report subdirectory, and must pass a strict contract check.
Per-scenario build/strict logs are task-owned. First failure stops the pipeline.
All three sidecar plans pass with zero unresolved supported references.

The first HOI4 1936 bundle attempt failed at the final directory rename with
Windows `PermissionError [WinError 5]`; the temporary directory was cleaned and
no partial published candidate remained. A single new build attempt succeeded.
The cause of that filesystem denial is not established. It is not a geometry
validation failure and no retry policy or acceptance limit was changed.

HOI4 1936 and 1939 both pass complete bundle generation, strict contracts and
focused browser startup. Each runtime exposes 32,578 features, including all
twenty Illinois children with expected owners and the three unchanged retained
IDs. Browser checks report no script or HTTP errors. Build times are 338.609 and
349.25 seconds respectively; these overlapping workload observations are not
controlled performance benchmarks. TNO's first run was interrupted before
publication, leaving an unaccepted temporary directory. Its isolated restart
completed and passed strict contracts with 21,889 assignment entries, 948 replaced
old IDs and the two retained IDs (Iowa and Pennsylvania). It took 368.609 seconds
with a recorded peak working set of 4,052,144,128 bytes. Logs are
`tno-rebuild.{log,err.log,pid}` under the task temp directory. This material build
cost remains visible; no build-resource release acceptance is claimed.

The initial TNO browser probe incorrectly compared the land collection with the
entire assignment count. The 493-item difference is exactly the Atlantropa water
layer. The runtime retains the full owner map; all 10,143 US historical partition
IDs match the candidate topology. The corrected probe compares land IDs with
the assignment set excluding independently loaded water-layer IDs, checks the
water IDs against the staged Atlantropa topology, and compares the entire owner
map. Runtime-only Arctic shell helpers retain their existing exclusion behavior.
No application behavior or acceptance tolerance was changed for this probe fix.
The corrected TNO browser run passes with 21,396 land features, 493 water
features, all 21,889 owners, twenty Illinois children and both retained parent
IDs. It reports no script or HTTP errors. All three current historical bundles
now pass their strict and focused runtime checks; per-scenario receipts are
`historical-runtime-<scenario>.json` in the task report directory.

## Modern legacy project compatibility

The old zone builder and ID reconciler at historical commit `78224eb2` were
replayed against their original county/state/population blobs and archived
previous topology. The replay reproduces 914 generated features, 900 previous
features, eight reused IDs, zero split IDs and 383 renamed recomposed IDs.
Membership is recorded from builder input groups before dissolving geometry;
spatial overlap and proximity do not establish these assignments.

`tools/us_county_legacy_lineage.json` records eight reviewed zones and eleven
county targets. The record is bound to the exact baseline runtime and reviewed
county-source bytes. Mismatched inputs leave the mapping unapplied; duplicates,
missing targets, non-US ownership and stable-identity conflicts fail validation.
Invalid original polygons cannot be rescued by the record.

The rebuilt candidate has 481 stable identity mappings plus eight reviewed
legacy mappings. Unresolved modern identities fall from nine to one:
`US_CNTY_09120`, whose original polygon self-intersects. This is project
compatibility work; the new runtime geometry and owners are byte-identical to
the earlier 3,144-county candidate. It does not imply every old zone in every
historical scenario has been migrated.

Independent comparison also confirms all 197 chunk JSON files, cores, countries,
bootstrap, runtime metadata and context LOD manifest are byte-identical. All
10,804 non-US political features remain unchanged. The detail chunk manifest
adds only coarse coverage diagnostic counts (3,144 eligible, zero retained);
payload hashes, sizes and coordinate counts are unchanged. The new manifest's
source binding and snapshot follow that diagnostic metadata update.

The rebuilt modern candidate passes strict scenario contracts and all twenty
whole-detail-shard LOD checks, covering 3,144 counties. Reports are
`modern.strict.json`, `modern-lod.json` and the candidate's migration report
under `.runtime/reports/generated/us-focused-20260923/`.

The actual browser file input imports a legacy project editing all eight zones
with distinct colors and one stable county. Two Virginia zones also carry
sovereignty edits, expanding into two and three counties respectively. Every
expected target color and sovereignty edit is checked, and no old zone key
survives. The actual browser download is 503,574
bytes and carries target baseline `ed5ac601...`; importing that download again
preserves all edits without another mismatch confirmation. Importing an edited
`US_CNTY_09120` is rejected with `ambiguous_or_unresolved_entries`, leaving visual
overrides, sovereignty, scenario and both history stacks unchanged. No browser
script errors occurred. `project-roundtrip.json` is the complete passing receipt;
`migrated-download.project.json` is the downloaded project, both in the task
report directory. Baseline mismatch confirmation remains part of initial import.

## Source verification and limits

The two Python suites pass 38 tests and eight subtests. The targeted UI routing
check selects the support-surface behavioral suite and passes twelve tests.
The Pages distribution was rebuilt at 570.20 MiB to synchronize the controller.
Canonical `data/` remains unchanged; local candidates are not deployed assets.
CI for committed canonical data must not be presented as validation of these
untracked candidate bytes.

The first PR #149 fast CI run correctly stopped because the new lineage JSON
had no adaptive test route. It is now an explicit source of the existing US
county scenario regression route; the unmatched-file gate remains unchanged.
Eleven routing tests pass, including a JSON-only edit regression and catalog
authority reconciliation. Actual `verify:edit` execution for just that JSON
passes the 613-route schema check and eighteen migration tests, selecting one
command with no deferred main-thread work.

The five measured interaction samples above still show roughly 300 ms political
frames. They establish functional fill/undo/redo behavior and expose remaining
render cost; they do not provide release performance acceptance. Full visual
acceptance and a controlled runtime performance comparison remain open. Earlier
historical candidates, including the combined European variants, must adopt
the revised historical US partition acceptance before publication.
