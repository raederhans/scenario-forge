# Context

Started on 2026-04-28. Repo: raederhans/scenario-forge, branch: main.


- Pushed local ahead commit e63e51f to origin/main for fresh cloud run.

- Root cause found: deploy-dist artifact download misses .nojekyll. Downloaded run 25083501538 artifact locally and verified index/app files exist while .nojekyll is absent. This matches actions/upload-artifact hidden-file omission.

- Applied minimal workflow fix in .github/workflows/verify-shared.yml: include-hidden-files: true for deploy-dist artifact upload.

- Local targeted verification passed: python -m unittest tests.test_pages_dist_startup_shell -q.

- Committed and pushed c513394: ci: preserve nojekyll in deploy artifact.

- Cloud verification complete: Build and Deploy Scenario Forge run 25083625001 succeeded; perf-pr-gate run 25083624991 succeeded; published URLs returned HTTP 200 for landing, app shell, main.js, scenario index, and tno_1962 startup bundle.
