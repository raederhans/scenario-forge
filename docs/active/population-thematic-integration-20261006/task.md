# Integration status

- [x] Inspect mixed primary WIP and select a clean managed worktree.
- [x] Refresh origin/main using the existing Windows proxy, without changing Git configuration.
- [x] Complete feature-only source integration and current-topology data rebuild.
- [x] Complete local validation and commit.
- [ ] Push branch, create PR, complete required checks and merge.

Remote and CI receipts will be recorded after they exist.

PR: https://github.com/raederhans/scenario-forge/pull/213. Feature commit `ec0bd9d7` and current-main integration `8c471730` are pushed. Final-head required CI and merge are still pending.

## Local evidence

- Population Node behavior: 37/37; renderer family checks: 152/152.
- Final export behavior, including hidden-river and loading-order regressions: 357/357.
- Thematic suite: 117/118 initially; the remaining HDI compressed-topology fixture was corrected and its 4-test file passed.
- Population/thematic Python: 63 passed across the main run and official-source cache checks. Catalog contracts: 22/22. i18n: 22/22.
- Data health: zero errors; all 682 population runtime assets passed schema validation. Catalog contains 1,370 entries.
- Four-scene source geometry identity, complete membership and allocated population conservation passed. All 676 heatmap tiles and overview re-summed to source within 0.000003 people.
- Architecture boundary and Pages source-graph checks passed; final Pages artifact check remains separate.
- Localhost TNO density and heatmap loaded successfully, with 2020-reference labeling and no captured console errors. Screenshot: `.runtime/browser/population-integration/tno-heatmap.png`.
- Source integration preserves main's country-label, river contour/hit/navigation and physical-layer behavior. Primary mixed WIP was not modified.
- Final local Pages/landing run passed 85 of 86 cases; its only stale Mediterranean card was regenerated and the complete work-card parity case passed on retry. Latest-main surface integration added 93 passing renderer checks.
- CI found tooltip tests mutating the application singleton and a missing export-VM dependency. Isolated tooltip fixtures now pass 44 cases, exact-composite export passes 9, additional interaction/chunk contracts pass 103, and state-write/import-graph checks pass without changing policy.
- First CI performance attempt was rejected by hosted-runner CPU admission before measurement. No thresholds or required checks were relaxed.
