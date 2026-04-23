# Plan

- [x] Restore task docs from archive and reopen the review-fix lane.
- [x] Re-read review findings and inspect the exact root-cause code paths.
- [x] Fix `flushPending` semantics so idle settle only flushes real pending work.
- [x] Fix border-mesh/spatial border-country bucketing so `ATLISL_*` can keep `cntr_code=ATL` while owner-border grouping still follows displayed owner.
- [x] Update existing contract tests for chunk refresh, border mesh owner, border draw owner, and spatial runtime owner.
- [x] Run serial verification: `node --check`, `py -3 -m py_compile`, targeted `unittest`, and ATLISL published-artifact spot checks.
