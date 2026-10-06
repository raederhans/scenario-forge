# Integration status

- [x] Inspect mixed primary WIP and select a clean managed worktree.
- [x] Refresh origin/main using the existing Windows proxy, without changing Git configuration.
- [x] Complete feature-only source integration and current-topology data rebuild.
- [x] Complete local validation and commit.
- [x] Push branch and create PR.
- [ ] Complete final-head required checks and merge; the live receipt is the PR state below.

PR: https://github.com/raederhans/scenario-forge/pull/213. Feature commit `ec0bd9d7`, current-main integration `8c471730`, and test isolation `c1876bc7` are pushed. This source record precedes the final CI-fix commit; final required-check and merge receipts are recorded by the PR.

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
- At `c1876bc7`, all six scenario contracts, transport, Quick Fill, browser smoke, Pages build/contracts, and the performance gate passed. The fast job stopped at the export bake-pass fixture, which now includes population heatmap and passes 26 cases.
- Resumed the 164 remaining Node command groups: 158 passed initially. Five failures used old tracked dist; all 46 cases passed against the fresh isolated `.runtime/p2` artifact. The sixth exposed missing population invalidation-resource registration; the dedicated buffer and its loading/completion/stale-request regressions now pass 11 cases.
- Final isolated Pages build succeeded at 937.80 MiB. Remaining Python boundaries/performance contracts passed 102 cases across 17 modules. Six remaining policy/tooling checks and the updated test import graph passed.
- Final P4 quick passed 533/533, including both new action modules, their exact read receipts and shared-result boundaries. Four focused assertions also passed. Population and thematic status validation now uses equivalent explicit enum comparisons; invalid statuses leave targets unchanged. Final-head CI will rebuild the artifact with those two final guard changes.
