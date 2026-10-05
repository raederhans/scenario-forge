# Context and ownership

Workspace: `C:/Users/raede/.codex/worktrees/pr-delivery-lanes/mapcreator`.
Branch: `codex/pages-delivery-optimization`, based on main `06d09474`.
The previous task's two local closeout notes are pre-existing owned changes; keep them separate from new implementation commits.

Root owns integration, Git and all live browser/build/test processes. Delegates may inspect code and completed evidence; live execution requires a specific ownership handoff.

Initial read-only delegation: `smoke_stability_fix` examines sample startup scheduling and cancellation boundaries; `pages_workflow_audit` examines release preparation timings and missing failure uploads. Neither may modify code or launch live processes in this phase.

Evidence: `.runtime/reports/generated/pr-delivery-rollout/final-deployment-jobs.json`, `deployment-verify-failure.log`, `deployment-verify-attempt2.log`, `deployment-public-url.log` and `final-rollout.json`.

All new temporary outputs use `.runtime/`; new logs/reports use `.runtime/reports/generated/pages-delivery-optimization/`. The primary checkout remains untouched during implementation. Live commands, ports and success/stop conditions will be added before execution.

## Local Pages baseline

Root owns a localhost-only Python server on port 4175 serving the previously source-built immutable `.runtime/pr-delivery-baseline/dist` (same product source as main `06d09474`). Command: `python -m http.server 4175 --bind 127.0.0.1 --directory .runtime/pr-delivery-baseline/dist`; log: `.runtime/reports/generated/pages-delivery-optimization/baseline-server.log`.

Root runs `npm run test:e2e:pages-public-release-gate` with `PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:4175/`, one worker and zero retries. Log: `.runtime/reports/generated/pages-delivery-optimization/baseline-pages.log`; Playwright output uses its existing `.runtime/tests/playwright` directory. No delegate may launch another browser/test server or inspect live execution. Success is the unchanged release gate passing; failure preserves context/trace before any candidate run. Stop the server after baseline evidence is captured. This is a bounded comparison, not a throughput benchmark.

Baseline passed: 31.7 seconds test / 34.4 seconds total, zero console/network issues. Its server was stopped after completion.

## Candidate artifact

Root alone builds `python -B tools/build_pages_dist.py --output-root .runtime/pages-delivery-candidate/dist`; log `.runtime/reports/generated/pages-delivery-optimization/candidate-build.log`. Success requires process exit 0 and its normal complete/size/reachability admission. The output root is independent of tracked dist and the retained baseline. No browser/performance measurement runs concurrently with this build.

The first candidate passed its build and 65 distribution startup-shell tests. After extracting the URL parser to avoid pulling the full sample registry into startup, root builds the final candidate at `.runtime/pages-delivery-final/dist`. The builder correctly refuses an occupied artifact root; the earlier candidate is retained unchanged. Final build log: `.runtime/reports/generated/pages-delivery-optimization/candidate-build-final.log`.

## Final candidate runtime ownership

After the final build finishes, root serves only `.runtime/pages-delivery-final/dist` on localhost port 4175. Root runs the unchanged public Pages release gate from `.runtime/tmp/pages-sparse-smoke`, populated only with the deploy job's actual sparse checkout patterns. Node dependencies are reused via `NODE_PATH`; no additional dev server may start. Log: `.runtime/reports/generated/pages-delivery-optimization/candidate-pages.log`; browser failure evidence remains below the sparse workspace's `.runtime/` directory. Success requires the existing one-worker, zero-Playwright-retry gate and no unexpected console/network issues.

Root then runs the existing two HOI4 1936 fast roundtrip-only cases against the same final artifact using the existing `/app/` URL resolver. Log: `.runtime/reports/generated/pages-delivery-optimization/candidate-roundtrip.log`. Stop on genuine assertion failure and preserve evidence; do not change timeouts or retry classification. Root stops the owned server after these checks. Delegates must not launch live tests, builds or servers during this phase.

The first final-candidate public gate passed (46.0 seconds / 48.3 total), with zero console/network issues and no retry. This exceeded the earlier baseline's 31.7 seconds, so it does not establish faster startup. Root performs one bounded reverse-order pair (candidate, then baseline) to distinguish variance from a consistent regression; both use the same sparse test workspace and unchanged assertions. Only the temporary copied test logs the already-observed release state for diagnosis. Logs: `candidate-pages-repeat.log` and `baseline-pages-repeat.log`. No claim of stable throughput improvement is justified by these small samples alone.

The reverse pair reproduced the slowdown (candidate 40.8s, baseline 27.9s). The candidate imported at 27.70s after old-scene hydration/localization; baseline imported at 15.93s and cancelled stale scene work. The revised candidate gates the two optional hydration tasks on pending sample intent as well. Startup locale data, UI bootstrap, direct language switches and required import completion do not depend on those scheduler tasks. Keep recovery hydration: sample success also includes committed-with-warnings results and is not sufficient evidence to skip recovery.

Root builds the revised candidate to `.runtime/pages-delivery-refined/dist`, log `candidate-build-refined.log`, after source-proof validation. The same localhost port 4175 and sparse test workspace are reused after build completion, with log `candidate-pages-refined.log`. Existing assertions and retry/timeout limits remain unchanged. Then run the two roundtrip cases against this revised artifact and stop the server. Earlier slower candidates remain diagnostic evidence only.

The refined run passed in 37.6s with sample completion at 18.88s. Read-only review then confirmed that added startup scene rearming duplicates the existing import recovery owner: ordinary import already loads the full scenario, rebuilds spatial data, recovers visible context and owns blocked/retry handling. The final implementation therefore retains existing stale-scene cancellation, locks initial sample settlement across later Guide selections, and gates optional context/contour warmup as well. Required detail and visual promotion remain independent. Root builds this accepted design into `.runtime/pages-delivery-accepted/dist`; logs use `candidate-build-accepted.log`, `candidate-pages-accepted.log` and `candidate-roundtrip.log`. This is the artifact for final runtime validation; all earlier candidates are excluded from delivery claims.
