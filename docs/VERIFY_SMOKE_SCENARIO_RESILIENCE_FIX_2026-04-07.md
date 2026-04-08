# Verify smoke fix - scenario apply resilience - 2026-04-07

## Plan

- [x] Confirm root cause from code and local startup diagnostics.
- [ ] Add startup query override for default scenario so preload and bootstrap share the same scenario source.
- [ ] Switch `scenario_apply_resilience.spec.js` to a lighter startup baseline and remove redundant baseline apply.
- [ ] Improve `waitForAppInteractive()` timeout diagnostics with boot state snapshot.
- [ ] Run targeted Playwright validation serially.
- [ ] Run smoke validation serially.
- [ ] Do final review, record result here, then archive this file.

## Progress

- Root cause confirmed: smoke failure is blocked in startup readiness before rollback assertions. The heavy default `tno_1962` startup plus `bootOverlay` wait is the unstable precondition.
