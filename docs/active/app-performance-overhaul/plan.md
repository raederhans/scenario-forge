# App Performance Overhaul Plan

## Current phase
Phase 2 v3.1 slice: metrics contract + hoi4_1939 startup bundle.

## Task list
- [x] Preserve Phase 0/1 completed context.
- [ ] Extend perf baseline summary with startup/chunk/context timing fields.
- [ ] Generate and wire hoi4_1939 startup support + startup bundle assets.
- [ ] Add static/contract coverage for new perf and startup bundle fields.
- [ ] Evaluate UI fanout row-refresh minimum slice.
- [ ] Run targeted verification and review pass.

## Acceptance for this slice
- hoi4_1939 startup bundle files exist for en/zh with .gz sidecars below 5,000,000 bytes.
- hoi4_1939 manifest advertises startup_bundle_url_en/zh, startup_bundle_version, startup_bootstrap_strategy.
- perf summary exposes planned timing/source fields while gate still uses tno_1962 + hoi4_1939.
- Parent thread owns all live test/baseline execution.
