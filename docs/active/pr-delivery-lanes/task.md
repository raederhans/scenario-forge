# Progress

- [x] Step 1: read-only delivery plan, package/catalog registration and bilingual contributor entry point. Delivery CLI tests 16/16 and PR planner tests 12/12 passed. Local and hosted planning share manifest-content classification.
- [x] Step 2: bounded PR lanes and diagnostic performance separation. Six delivery-lane tests, six observation-gate tests and 39 performance contracts passed; the hosted manifest classifier was exercised again after extraction (seven input cases).
- [x] Step 3: Pages fast checks and full-build routing. Seven new fixtures and five existing parser/registry/missing-import checks passed. Current source graph passed for 9,734 inventory paths, 504 JS/MJS modules and four CSS files without building dist.
- [x] Integrated verification and bounded diff review. Four workflows passed actionlint; ten profile-validation Bash cases passed; 705 routes and 362 scripts passed catalog checks; nine route-registration tests passed. Independent bounded review found no blocking defect.

The new UI command resolves to five tests in two spec files (`--list` only). No full browser, performance measurement or complete Pages build was run locally. Targeted checks establish routing and source-graph behavior, not hosted timing or final release integrity.

## Step 4 and rollout

- [x] Remove duplicate Scenario/Transport full checks after main merges; retain manual full audit and required PR checks. Seven lane tests, eight scenario/transport planner contracts and six-workflow actionlint passed.
- [ ] Commit and push this system, then validate and merge its PR.
- [x] Install the system in the daily local checkout without disturbing unrelated WIP. Scoped merge preserved six overlapping files, including README, WGI/HDI script additions, asset declarations and the worktree registry. Local script/route checks and seven source-graph fixture tests passed.
- [ ] Confirm final required checks, protected merge and Pages deployment.

Remote rollout is tracked in PR #206. Initial hosted full Pages, smoke/Golden Demo, Scenario and Transport checks passed. The adaptive structural suite caught an outdated exact-command fixture; its expected set now includes the new delivery lane regression. Selector artifact upload now includes the explicitly listed hidden `.runtime` evidence files.

Temporary PR #207 (do not merge) probes the UI lane. Its hosted plan selected `smokeMode=ui`, `pagesMode=source`, `perfRequired=false`; `perf-gate` succeeded while observation was still running. Full probe completion and deployment are pending. Branch protection remains unchanged.

Hosted rollout exposed existing main-branch proof/fixture drift. The follow-up reviews the actual source before refreshing owner/borrowed bindings, adds input-write rejection cases for newly bound dependencies, and aligns the physical async-plan and 14-segment Swiss seam assertions with the current source/data. No product renderer behavior or effect permission is changed. The UI-only workspace tests now select `default_scenario=none` to avoid unrelated TNO loading; assertions and timeouts remain intact.

The 131 child-safe groups not reached by the failed hosted run were exercised locally: 128 passed initially, the two stale fixture groups passed after correction, and startup ownership passed all four tests against a newly built 769.80 MiB source artifact. Final source-proof group and hosted rerun results are tracked in the rollout evidence directory.

The corrected source-proof quick group passed 526/526 with no skips; the workspace UI file passed all four cases with zero retries. A bounded independent review found no blocking defect in the proof updates. The river raw-evidence receipt retains all nine findings, including the two new conservative findings from indexed parent lookup. Hosted validation remains required for the final candidate.

The next hosted UI probe passed four of five cases; the combined water workflow still exhausted its unchanged 60-second budget. Trace-guided splitting separates desktop filter/layout guidance from lake toggle/language/mobile guidance, preserving every assertion and producing six focused cases across the two spec files. Smoke failure artifacts now explicitly include hidden runtime paths and the existing trace, screenshot and page-context outputs.

All six required checks passed on `23abde42` (formal run `37264848965`); the final UI split and artifact-upload fix still require a new hosted candidate. The two split water cases passed locally in 27.9 and 27.2 seconds with zero retries. All original assertions remain, and uncheck now has an immediate unchecked-state assertion.

The six-case UI probe passed on `0dec0cc8` (`37265982600`), with a three-second source check and 3.9-minute browser execution; #207 is closed and its worktree archived. Formal fast, performance and contracts passed, but the full smoke twice hit a duplicate 20-second TNO state-read deadline. Trace shows the read returned the correct scenario after 21.74 seconds, while the strict scenario-id/apply-idle wait had already passed. A pure UI contract test also unnecessarily booted TNO. The final smoke repair preserves state/UI assertions while removing that duplicate poll and selecting a scenario-free UI setup.

The repaired full smoke passed locally: four cases, two workers, zero retries, 51.6 seconds. TNO retained scenario ID and shell-owner assertions with zero console or network issues. Only these two test preparation/waiting paths changed; the six-case UI lane and renderer code are unchanged.
