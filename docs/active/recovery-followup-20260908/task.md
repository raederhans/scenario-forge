# Recovery follow-up status

- [x] R0: source/artifact closure merged in PR #124 as fbf89bee; automatic deployment 34207190613 succeeded.
- [x] T1: real history fixture actions and hook/state restoration merged in PR #124 (7508660a integrated as 52c08e51); 4 behavior tests and direct-writer scan passed.
- [x] U1: import outcome feedback merged in PR #125 as 84efc954 after all six required checks passed.
- [x] P1: bounded water optimization and corrected measurement accepted locally. Remote admission and deployment are determined by the pull request containing this record, not these local checkboxes.

## R0 and U1 evidence

R0 rebuilt eight stale mirrors and fixed the reproduced Modern World topology publication exclusion. Canonical product: 922.02 MiB under the unchanged budget. Independent full checkout at 10edc8f7 rebuilt twice with zero tracked drift. Generated-dist editing/save/reload/Modern World and TNO cache reuse passed. Shell qualification ran 63 tests; the sole obsolete exclusion-count assertion was corrected and its focused rerun passed. Metadata 51/51 and relevant PR mirror routing passed.

U1 reports the target scenario and restored/ignored/migrated color and ownership records only after import success. Cancellation and failure preserve a real dirty edit. The project format and valid unloaded feature rules are unchanged. Behavior 68/68, boundary 10/10, data contract 18/18, data health, import graph and canonical build passed. Browser flow passed in 1.2m (.runtime/tmp/u1-roundtrip-fresh-edit.log). Three stale data-contract assertions were reconciled with the existing City Lights schema and current landing data binding; catalog regeneration had zero diff.

## P1 measured acceptance

Only one hotspot changed: the water part projected bounds cache is shared by coverage, fill and highlight through one lazy map_renderer connection. Existing projection/resize/reset lifecycle clears it; failed bounds are not cached. No chunk scheduling change.

Final measurement v2 uses real mouse input concurrent with real renderer work, native EventTiming, separate capture/visible/stable boundaries, and separate wheel timing. Trace is off only in this dev diagnostic because before-action snapshots were delaying input. Stable timing includes a 250 ms hold and visible means canvas/SVG sampled at rAF, not display presentation.

Twelve fixed-machine interleaved runs passed: stable A2/B2 and busy A4/B4, 60 operations, 32/32 busy discrete inputs with actual task/queue overlap. Primary independently recomputed the raw metadata, overlaps and redo medians. All four neighboring busy redo pairs improved. Water draw run medians: stable 522.6 -> 355.4 ms; busy 544.05 -> 403.6 ms.

Native input-to-visible medians (ms):

| Operation | Stable A -> B (n=2 each) | Busy A -> B (n=4 each) |
| --- | --- | --- |
| Selection | 79.7 -> 447.9 | 719.0 -> 414.4 |
| Fill | 62.9 -> 81.4 | 705.1 -> 491.2 |
| Undo | 228.5 -> 220.9 | 1507.2 -> 1215.3 |
| Redo | 315.5 -> 328.0 | 2110.4 -> 1819.6 |

Stable selection includes one B sample at 818.5 ms; stable results are not uniform improvements. Busy redo mouse-call total also improved 2110.8 -> 1819.7 ms. Wheel remains separate: busy capture-to-visible 28.5 -> 30.4 ms, capture-to-stable 1609.9 -> 1683.0 ms, with a B tail sample retained. No broad latency, percentile or production performance claim is made. The earlier exploratory pendingInfraPromotion startup timeout remains an unresolved limitation.

Unchanged B runtime qualification: overlay/cache-policy 30/30; projected bounds/fit/history/cancellation 40/40; HOI4 input and TNO/HOI4/TNO 2/2. All twelve v2 runs retain immediate undo and exact zoom assertions. Final integrated generated-dist cache check is recorded in .runtime/tmp/p1-dist-water.log.

Authoritative report in collaborator worktree 5d0c: .runtime/reports/generated/p1-water-bounds-evidence-v2.md; full distributions and raw index: .runtime/tmp/p1/v2-summary.json and v2-raw-files.json. Old v1 data is retained as exploration only because it lacked actual busy overlap and mixed trace/actionability waiting. It is not acceptance evidence.
