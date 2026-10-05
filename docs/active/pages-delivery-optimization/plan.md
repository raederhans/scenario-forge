# Pages delivery optimization

Authorized 2026-10-05: optimize Pages after the PR delivery system rollout.

Target: reduce explicit sample-link startup queue delay and avoid redundant release preparation while retaining existing product behavior and release checks.

Baseline: main `06d09474`; deployment `37269018822` failed once while the sample import had not started behind `post-ready-full-interaction-infra`, then passed on one diagnostic rerun. Failure artifacts were not uploaded. The final deployment receipt records step timings.

1. Correct the sample startup/full-interaction ordering using existing lifecycle and scheduler contracts. Preserve single-owner execution, stale cancellation, ordinary startup and error recovery.
2. Reduce measured release preparation overhead where the workflow does not need the full repository; retain artifact source/byte admission, prepublication sample and save/reload checks, and actual deployed URL smoke. Upload bounded failure diagnostics.
3. Validate changed behavior with relevant Node/workflow contracts and a source-built Pages artifact. Report measured results separately from expected hosted savings.

Do not increase test timeouts, introduce automatic test retries, weaken assertions, remove release checks, modify repository permissions, or overwrite the primary checkout's unrelated WIP.
