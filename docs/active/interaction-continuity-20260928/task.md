# Task

## Current status
All five implementation/verification stages and the cold-cache/derived-state continuations are complete from merged PR #181. Changes remain local and uncommitted on codex/interaction-continuity-20260928; no push or deployment. Broad smoothness guarantees remain limited by the residual cold-recovery work documented below.

## Checklist
- [x] Confirm reusable clean checkout and merged base; create codex/interaction-continuity-20260928.
- [x] Inspect CLI execution options and dispatch read-only water/labels analysis.
- [x] Stage 1: presentation, reliable navigation coverage and true metrics.
- [x] Stage 2: proactive coverage preparation.
- [x] Stage 3: water path reuse, stable label anchors, stale worker short-circuit and background yielding.
- [x] Stage 4: detail/camera transition stability.
- [x] Stage 5: fresh browser continuity validation and relevant checks.

## Validation evidence
Implementation checks: earlier 161 focused navigation/render/cache/worker/label checks and 53 lifecycle/chunk/worker/export checks passed. Final affected integration groups passed (81 and 67 checks). Three relevant Python contract modules passed (48 tests). Normal repository-configured git diff --check passed. An incidental check with core.autocrlf=false treated all CRLF endings as whitespace; no repository setting was changed and the normal check was rerun successfully.

Browser findings fixed: Enter followed by blur replayed the old zoom value and canceled its animation; unchanged chunk refresh could leave navigation pixels awaiting exact recovery; decoded coarse-payload eviction incorrectly invalidated already-complete navigation pixels. The latter now follows immutable chunk descriptors, while changed scene/projection/paint invalidates as before.

Final localhost TNO and HOI4 checks: 300px pan and reversal, TNO 100→200% and 200→80%, scene switch, and final exact restoration. All sampled interacting frames had zero target/presented camera mismatches. Navigation-only p95 canvas draws were 0.3–0.8ms (small samples, not FPS). HOI4 pan/reversal rAF gaps were about16.7ms; TNO traces still include larger gaps and recovery long tasks. Final reload had no console errors. Detailed view screenshots were inspected for geographic alignment and correct scenario content.

Navigation uses global coarse political, water and Atlantropa sources; its bitmap is 1024×498 (2,039,808 estimated bytes in the measured scenes), within an8MiB owner cap. It borrows validated projected paths and last-good detail without retaining another full-size detail canvas. It can also seed from a complete exact frame only when the entire projected world fits the source canvas. Preparation pauses during interaction/settling; no partial bitmap publication.

Critical A/B: the initially introduced direct Path2D streaming was slower in the actual browser. Same Bothnian Sea feature/projection:441–446ms streaming vs21–29ms SVG+Path2D (six-digit SVG25ms). Direct water streaming was removed; navigation cold construction uses batched parsing too. Final TNO200% visible-water warmup max slice22.5ms, final water draw15.3ms with zero path builds. Zoom-out warmup max slice22.3ms. These are current local samples, not controlled end-to-end comparisons against the old baseline.

Evidence: .runtime/browser/interaction-continuity/final-acceptance.json (raw rAF samples, filtered navigation-only metrics, scene invalidation, final exact camera, console errors), final-tno.json, hoi4-final.png. Intermediate files preserve regressions that were fixed and must not be mistaken for final results.

## Open risks
Cold chunk promotion/other exact recovery still produced roughly428–535ms long tasks in final TNO runs. Navigation preparation after a scene change can take several seconds of background wall time; until ready, existing guarded fallbacks remain. The6ms work budget is checked between parts/features, so a single large item may exceed it. Over-budget water warmup falls back to existing exact drawing rather than entering an endless warm/evict loop. No hardware-independent FPS guarantee; no full-scenario or all-browser matrix was run.

## Cold recovery and precision continuation — 2026-09-28

Completed all three authorized follow-up stages. Exact geometry remains authoritative for display, editing and export; no generated candidate was installed into data assets.

Changes:
- Border worker registration transfers Float64 arc values and Uint32 lengths; the source arrays remain intact. The smaller topology object graph still uses structured clone. Worker reconstruction happens off the main thread.
- Same-topology policy revisions reuse the registered source through UPDATE_POLICY. Scene lifetime is separate from the complete result identity; stale scene, topology, revision and cancellation guards still reject obsolete commits.
- Water combined paths reuse an ordered set of identical safe geometry parts across replaced feature wrappers. Projection generation remains checked; aliases are weak and native paths stay within the existing32MiB budget.
- tools/build_water_display_lods.py builds a diagnostic-only candidate and reports geometry, winding, coverage, footprint and projected-polyline checks. Candidate PASS cannot claim adoption: actual D3 clipping and end-to-end performance still require separate evidence.

Fresh localhost evidence, TNO balanced profile,1146.7×904 map area at DPR1.5:

| Measurement | Before | After |
| --- | --- | --- |
| Detail source main-thread registration |447.6ms synchronous send |78.4ms pack +44.5ms send =122.9ms |
| Primary source main-thread registration |387.0ms synchronous send |75.2ms pack +36.6ms send =111.8ms |
| Reenter detail after zooming200→80→200 |Full source registration |UPDATE_POLICY only;2.8ms and0.1ms sends |
| Max observed long task during first100→200 detail recovery |560ms |346ms |
| Visual chunk promotion |323.9ms |334.9ms |

These are local diagnostic samples, not statistical performance or FPS guarantees. Old registration measurements came from the instrumented repeated-zoom baseline; first-zoom traces separately establish the max-long-task comparison. Worker transfer timings include packing but exclude policy preparation and result processing. Policy-only figures are send costs, not total recovery latency. The visual-promotion cost has not improved; it is now the clearest remaining cold-path target. Water warmup wall time fell from1101.1ms to253.6ms in these traces, but scheduling and other work affect that duration, so it is not an isolated cache speedup claim.

Water candidate:166 features,776073→532524 points (-31.3822%). Part/hole counts and individual validity pass;65 features change ring orientation, aggregate water footprint differs, and both source and candidate fail the coverage validity check. The29.728px maximum is an **unclipped projected-polyline Hausdorff diagnostic**, not final visible pixel error. Source-invalid coverage also cannot establish new seam safety. Candidate/adoption verdict NO-GO; political LOD expansion therefore remains disabled. This rejects this independent-polygon simplification candidate, not all future topology-aware LOD work.

Validation:31 targeted water/worker behavior tests pass; the actual heavy-suite TNO water contract passes1/1; Python LOD tests pass6/6. git diff --check passes. Browser200% pan/reversal has10 interacting navigation samples,0 target/presented mismatches and0.2–0.4ms reported canvas draws (not FPS). TNO→HOI4→TNO reaches exact idle frames with zero pending work; screenshots show the appropriate scenario geometry, and final console error list is empty.

Raw evidence: .runtime/browser/cold-lod/{baseline-zoom.json,baseline-worker-sends.json,after-zoom.json,after-repeat-zoom.json,after-pan.json,final-state.json}; CPU profiles and final TNO/HOI4 screenshots are in the same directory. LOD output/report is under .runtime/reports/generated/water-display-lod/. Changes remain local and uncommitted; no push or deployment.

## Derived-state cache and navigation source continuation — 2026-09-28

Completed the next authorized optimization round without changing display precision.

- Added cache miss reasons, then reproduced `colors-reference` on the first 100→200% TNO detail promotion. Browser write stacks showed startup hydration and full interaction infrastructure rebuilding the complete color table after the derived-state baseline had been committed.
- A completed full color rebuild now advances only the matching color baseline. It requires the previous colors/revision, full collection, structural identity and geometry snapshot revision to match. Scene, projection, semantic, index and partial-edit invalidations still reject reuse. Empty and interactive-only fallback color sources cannot certify the baseline.
- Visual promotion reuses the immediately preceding interactive collection build as its expected coverage input. Actual full/interactive/color coverage is still checked; stale or missing snapshots fall back to the independent build. Deferred infra retains its independent check.
- A focused high-zoom TNO→HOI4→TNO test exposed a separate navigation failure: global coarse water and Atlantropa payloads had been evicted and were absent from the active detail selection. No new navigation bitmap was prepared even after a minute; 25 sampled interacting frames kept previous pixels with `presented:false`. The navigation owner now requests a complete coarse input set through the existing chunk loader. It changes neither selection nor promotion pins; caller-owned inputs survive cache eviction until the raster job captures them. Old scene/projection requests cannot publish, repeated requests are deduplicated, and a failed identity is not retried on every render.

Same local TNO/balanced first-zoom diagnostic setup (map1146.7×904, DPR1.5):

| Phase | Before this round | After color/coverage fix |
| --- | --- | --- |
| Derived cache | full fallback | incremental,854 changed features |
| Color resolution |56.1ms |2.1ms |
| Derived-state rebuild |310.4ms |126.6ms |
| Visual promotion |469.7ms |271.6ms |

These are single local wall-time samples, not an average, FPS claim or complete input-latency measurement. The prior round's visual sample was334.9ms; run-to-run variation is material. Residual work still produces long tasks.

Final source-recovery replay at200%: coarse water/Atlantropa were still absent from active and bundle caches, yet navigation completed using the returned input set. Source loading took1682ms and raster preparation7305.3ms wall time (background scheduling included). The bitmap remained1024×498, estimated2039808bytes. Once ready,20/20 sampled interacting frames used navigation, with0 unpresented frames and0 target/presented transform mismatches. Earlier settling/reversal test had28 navigation samples and0 mismatches. TNO→HOI4→TNO converged to exact idle frames; final pending geometry/border/exact work was zero and the console error list was empty. Screenshots were inspected for the appropriate scenario geography.

Remaining gap: this fixes indefinite navigation starvation, not immediate readiness after a new scene. The initial preparation window still permits frozen fallback frames, and a new-scene full promotion was observed at1153.2ms before the source-recovery patch. Coarse source reloading also has decode/network and temporary geometry retention costs. The next substantial target is earlier/off-main-thread whole-scene navigation preparation and independently prepared derived-state publication; retain current identity/coverage and precision gates.

Validation this round (unique checks):99 Node tests across cache, coverage/refresh, geometry, color revision, deferred infrastructure, navigation, source loader and runtime hooks;52 Python renderer/chunk boundary tests. The new regression cases include full color replacement, partial-edit invalidation, stale structures, incomplete coverage, evicted navigation sources, source-load failures and obsolete scene completion. Normal git diff --check passes. No data assets were modified.

Evidence: .runtime/browser/derived-recovery/{before-zoom.json,baseline-color-write-trace.json,after-zoom.json,reversal-during-settle.json,scene-recovery-drag.json,after-scene-return.json,final-pan.json,hoi4-state.json,tno-final.jpg,hoi4-final.jpg}. The scene-recovery-drag file records the reproduced pre-fix failure; final-pan is the post-fix ready-navigation check.

## First-window continuation
Implemented earlier source prefetch and isolated navigation worker with cooperative transport and software rasterization. See first-window.md for measured improvements and the remaining 4.23-second post-unlock gap. First-window continuity remains partial; no precision reduction or deployment.


## Authorized delivery - 2026-09-28
User accepted the current result and requested merge/push. Fresh combined final-state verification: 204 Node behavior tests and 65 Python contracts pass. Architecture boundaries, test import graph and 654-route schema checks pass. Existing browser evidence remains applicable: runtime code is unchanged since that verification. Residual initial-window delay remains documented. Remote main is 291b5aa2 and matches the task base. Root owns protected PR delivery; preserve primary checkout WIP and retain worktree evidence.
