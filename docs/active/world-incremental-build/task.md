# Task

## Current status
Infrastructure implemented and target tests passed. France and the joint Germany/Belgium/Netherlands pilot are promoted into local official TNO assets on 2026-09-13. Focused browser checks verified the 485 new DE/BE/NL geometries in a fresh page. Worldwide upgrades remain gated by source and scenario validation; no remote deployment.

## Checklist
- [x] Content cache and dependency signatures integrated.
- [x] Source processor registry independently checked (97 configured codes).
- [x] Generic local geometry assembler validated.
- [x] Impact planner handles malformed inputs and metadata changes.
- [x] Isolated candidate orchestration and chunk reuse.
- [x] Target tests and synthetic real-builder multi-owner/full-build equivalence.
- [x] Real TNO no-op acceptance and final scope check.
- [x] Documentation.

## Validation evidence
Main ran 91 related tests successfully, then 47 cache/France checks after cache integration correction. Scenario tests expanded to 6 and passed, including auxiliary owner records discovered in TNO. CLI help entrypoints run. Full baseline preflight report saved under .runtime/reports/generated/world-incremental-build/baseline-quality.json.

After broad-source batching, 25 processor/basic/planner tests passed. TNO no-op candidate reused 172 political detail and 16 context chunks. All 189 candidate chunks passed SHA256/byte_size/gzip checks; 188 matched baseline bytes, while global coarse was regenerated using current rules. Evidence: .runtime/reports/generated/world-incremental-build/tno-noop-acceptance.json. No rendering/FPS claim. All owned build processes have ended.

## Open risks and remaining work
Current master has 7 unreadable and 81 invalid geometries, so registered-source automatic processing stops before mutation. HGO/TNO runtime geometry passed the same preflight; other scenarios have blockers. Candidate chunk directory is explicitly not release-ready: historical semantics, startup/bootstrap/bundles, snapshot/audit, browser validation remain. Root rejected post-build signature replacement because it could conceal code changes during a build; first source download may cause one conservative extra miss.

## France reconciliation pilot, 2026-09-13
Implemented and exercised boundary alignment, special/coast/foreign surface constraints and exact shared-chain encoding. Actual candidate: .runtime/tmp/france-reconcile/scenario-assets. 49 target tests; 189 chunk integrity, 16 mixed LOD, D3 winding/old-gap probe; cross-country adjacency restored through geometry and recomputation. 5 changed chunks /184 unchanged; uniform chunk gzip +10.0723%. Explicit 1e-9deg coastline boundary-band numeric tolerance, preserving failed cumulative area metric and exact-coordinate nonzero-witness evidence. No production data/dist modifications. Startup/bootstrap/bundle/audit and real App performance validation still outstanding.

## France local rollout completed, 2026-09-13
The preceding isolated-candidate status is historical. User explicitly accepted visually insignificant geometry deviations, including special terrain. Promoted 315 France source features across existing TNO owner chunks; 18 official TNO files changed after rebuilding dependent assets. Owners, cores, countries, non-FR geometry and six auxiliary objects remain unchanged. Baseline backup: `.runtime/tmp/france-rollout/baseline`.

Validation: strict scenario contracts PASS; startup support and bundle audits PASS; data catalog rebuilt; data health exit 0 (report-only large-file warnings); 18 data catalog contract tests PASS. Antigravity supplied a special-geography checker, then its adapter failed while writing a checkpoint. Root inspected and reran the checker against official files. Its computed `checks` are useful, but its hardcoded summary/unresolved/next_steps still describe the former candidate and must not be treated as current rollout status.

Browser: Paris at 4000%, Riviera at 4000%, Congo lake at 2000%; France inland green pinholes seen before are absent at the inspected locations after replacement. Existing coastal bands/stepped special shores remain. Hover, fill and undo verified on FR_ARR_45001; reload cleared test history and disabled perf probe. No collected warning/error logs. Same four zoom changes produced 20 render samples each: median 6.05 -> 6.60 ms, maximum 25.2 -> 16.2 ms. This small local cached-render sample is not an FPS, cold-load, memory or global performance guarantee. Startup gzip changed by only +3 bytes EN / +1 byte ZH. Evidence and final verdict: `.runtime/tmp/france-rollout/rollout-verdict.json`; screenshots: `.runtime/browser/france-rollout/`.

## Germany / Belgium / Netherlands local rollout, 2026-09-13
Updated 485 same-ID features (DE 401, BE 44, NL 40) using official GISCO NUTS 2021 01M. All 315 France features and 11,219 other non-target features remain exact. Six auxiliary objects and owner/core/country files remain exact. Four changed chunks (coarse, BRG, GER, RKN), 185 unchanged; 16 official files changed after rebuilding startup resources and audits. Backup `.runtime/tmp/de-benelux/baseline` preserves the already-promoted France state.

Fixed a real protection-clipping bug: a GeometryCollection containing polygons and a tangent line has boundary=None; recursively collect polygon boundaries before shared noding. Original area gates remain. Added explicit precision source-country declaration and shared coarse simplification so rebuilding detail does not reintroduce coarse cracks. Existing detail loading budgets unchanged. Corrected the old test that incorrectly treated detail budget as a coarse-size ceiling, with an actual JS selection regression.

Acceptance: 189 chunk hashes/byte sizes/optional gzip passed; all 8 owner mixed-LOD combinations valid with exact same union. New shore residuals remain within 1e-9 degree diagnostic band. No cross-boundary adjacency lost, 16 gained (including point contacts under existing intersects semantics). Strict official contracts, both startup audits, data health and 36 final catalog/chunk tests passed. Earlier selected code batches: 28 LOD/chunk tests and 32 geometry tests; one JS budget behavior test passed. D3 checks passed for 485 detail and 485 coarse faces.

Fresh browser page proves 121,378 target coordinates loaded (baseline 8,314), DE111 123 vs 9 coordinates. Actual DE/BE/NL fill/undo passed; high-zoom tri-border, Berlin/eastern surroundings and North Sea inspected, no collected warning/error logs. Old-page `after.png` and `after-perf.json` in this trial are INVALID after evidence because navigation retained an older document. Use only `after-verified.png` and `after-verified-perf.json`. This discovery also limits the prior France browser reload/performance claims above; France geometry protection is currently verified by exact data checks, and the fresh DE/BE/NL page includes the promoted France assets.

Size: whole chunk gzip 30,974,039 -> 33,511,872 bytes (+8.19%); coarse coordinates 533,151 -> 564,260 (+5.83%); startup gzip +68 bytes EN / +70 ZH. Comparable four-zoom local samples: median 4.60 -> 4.50 ms; maximum heavy redraw 826.6 -> 892.8 ms; 18/19 samples. Not a controlled FPS or memory benchmark. Offline incremental builder was observed at ~11.2 GB working set; large-build memory is a remaining efficiency issue, not a browser-memory measurement.

Antigravity historical audit completed after one tool-schema correction. Parent rejected the first builtin acceptance script and replaced it with `.runtime/tmp/de-benelux/acceptance.py`; also corrected projected/serializer adjacency diagnostics using exact project decoding. Evidence: `.runtime/tmp/de-benelux/rollout-verdict.json`, `.runtime/browser/de-benelux/`. No remote push/deploy.

## Integration handoff, 2026-09-13

The user authorized merge and push of the promoted regional data and builder infrastructure together with renderer and packing improvements. See ../data-performance-integration-20260913/task.md for delivery; worldwide upgrades and source-geometry blockers remain outside this delivery claim.
