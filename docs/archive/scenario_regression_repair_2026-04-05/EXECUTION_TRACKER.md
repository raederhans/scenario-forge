# Execution Tracker

## Completed

- [x] Freeze 1939 historical reference and current repo baseline
- [x] Restore `hoi4_1939` builder default owner rules to `hoi4_1936 + hoi4_1939`
- [x] Revert `hoi4_1939.expectation.json` away from the bad `CHI = 1783` baseline
- [x] Fix startup partial-cache worker trigger for topology/locales/geoAliases misses
- [x] Preserve cached topology when the startup worker only backfills localization
- [x] Make full bundle prefer runtime topology over startup topology
- [x] Restore chunked scenario apply completion so default flush waits for the first coarse chunk frame
- [x] Remove scenario country-name fallback to global modern names
- [x] Add regression tests for builder defaults, startup worker contract, runtime topology contract, and scenario naming contract
- [x] Add review follow-up regression coverage for startup partial-cache hits and chunked first-frame readiness
- [x] Rebuild `hoi4_1939`
- [x] Rebuild `hoi4_1939` chunk assets
- [x] Run strict contract check for `hoi4_1939`
- [x] Run HOI4 domain checker for `hoi4_1939`
- [x] Run light cross-scenario strict checks for `blank_base`, `modern_world`, `tno_1962`, `hoi4_1936`, `hoi4_1939`
- [x] Archive this repair log under `docs/archive/scenario_regression_repair_2026-04-05/`

## Open Follow-up

- [ ] Decide whether `blank_base` and `modern_world` should eventually gain `runtime_topology.topo.json`, or whether strict contract should treat them as an intentional special case in a separate cleanup task.
