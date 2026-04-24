# App Performance Overhaul Plan

## Current phase
Phase 0: fix rebuildStaticMeshes and TNO promotion infra regressions.

## Task list
- [ ] Identify root cause for blank_base rebuildStaticMeshes ~50s.
- [ ] Identify root cause for tno_1962 promotion infra ~7.95s.
- [ ] Patch minimal code path without changing TNO water correctness.
- [ ] Extend existing targeted tests.
- [ ] Run affected tests and focused baseline.
- [ ] Review/bug-check/first-principles pass.

## Acceptance for Phase 0
- blank_base rebuildStaticMeshes <= 800ms in focused baseline.
- tno_1962 scenarioChunkPromotionInfraStage <= 120ms in focused baseline.
- Existing TNO water contract remains green.
