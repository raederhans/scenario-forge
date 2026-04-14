## Localization Automation 2026-04-12 Run 2

### Plan
- Audit current localization status first, with focus on UI and runtime local-state related code paths.
- Run non-destructive localization checks and write any generated verification artifacts only under `.runtime/tmp/`.
- Only run full translation regeneration if the audit exposes a real unlocalized gap.
- Re-run validation, then archive this note after the run completes.

### Progress
- Confirmed the repo has unrelated in-flight `tno_1962` scenario artifact changes, so this run must avoid writing scenario outputs in place.
