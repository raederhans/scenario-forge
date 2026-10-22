# Development and delivery

[中文](development-and-delivery.zh-CN.md)

## Local checks

```sh
npm test                 # every Node and Python unit test
npm run test:node        # Node only (tests/*.test.mjs)
npm run test:python      # Python only (pytest -n auto)
node --test tests/<file>.test.mjs   # one file
npm run test:e2e:smoke   # browser smoke
```

`tests/quarantine.json` is the only skip list on PRs. Every entry needs a reason and leaves as soon as the test is fixed or deleted. Nightly runs everything with `--all`, including the quarantine and the slow lists.

| Stage | Action |
| --- | --- |
| Edit | Run the test files closest to the change; exercise affected UI with one focused browser check. |
| Before a commit | `npm test`. Add `npm run verify:pages-dist` when data, packaging or Pages entries change. |
| Push a feature branch | Push within existing authorization; no extra verification bundle is required. |
| Merge a PR | Wait for `PR Verify Required` on the final commit. |
| Release | Merging to `main` triggers deployment. Confirm CI, merge, artifact admission and live deployment separately. |

## PR checks

Every PR runs the same jobs; there is no path-based routing:

| Job | Contents |
| --- | --- |
| `pr-tests` | All Node unit tests (two shards) and all Python unit tests. |
| `pr-verify-fast` | Public sample project validation, Quick Fill hierarchy data and audit, data catalog health, Pages source references, Pages artifact build and startup shell checks. |
| `pr-verify-smoke` | Browser smoke, the Golden Demo and the live Quick Fill toolbar smoke (`tools/check_quick_fill_browser.mjs`). |
| `pr-verify-hgo` | Checks, tests and data validation for the standalone HGO editor. |
| `PR Verify Required` | Fails when any job above fails; the only required check. |

Scenario Contract Matrix (strict data contracts for all five scenarios) and Transport Contract Required also run on every PR and can be rerun from Actions; they are not required checks. Performance gating lives in `perf-pr-gate.yml` and the [performance policy](../tools/ci/perf_policy.mjs).

Saving work to a feature branch does not require updating from `main` first. Fetch the target when preparing to merge and check the final commit's required check; Pages release admission stays separate after merge.
