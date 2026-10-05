# Development and delivery

[中文](development-and-delivery.zh-CN.md)

Start with the read-only delivery plan:

```sh
npm run pr:plan
npm run pr:plan -- --base origin/main --json
npm run pr:plan -- --changed-file js/ui/styled_selects.js
npm run pr:plan -- --labels ci:perf-strict
```

The command uses local Git refs without fetching, writing files or running tests. It separates committed branch changes from pending workspace changes and previews their combined verification requirements. Hosted CI only sees pushed commits. Refresh your target ref when appropriate and check the reported SHAs. Explicit files preview only that scope; labels describe intended PR labels and default to none, without querying or changing GitHub.

| Stage | Action |
| --- | --- |
| Edit | Run the selected behavior tests, or `verify:edit -- --changed-file <path>`. Exercise affected UI behavior with a focused browser check when needed. |
| Prepare a commit | Review ownership, diff and coverage. Use `verify:commit` when a combined check is needed; it executes tests and defaults to pending workspace changes, not the full committed branch diff. |
| Push a feature branch | Push the scoped commits within existing authorization; do not automatically repeat the broad `verify:pr` suite. |
| Merge a PR | CI uses the same PR planning policy. Wait for required checks on the final commit. |
| Release | Merging to `main` triggers the existing deployment workflow. Confirm CI, merge, artifact admission and live deployment separately. |

A plan is not a test result. Resolve unmatched files and route gaps; deferred checks remain unexecuted. `verify:pr` is an explicit broad verification entry point, not a local replica of hosted PR CI or a prerequisite for every push. See [verification maintenance](testing/verify-core.md) for core, nightly and release details. The repository has no commit or push hook that automatically runs these commands.

PR routing considers the entire change set; mixed changes retain the broader checks:

| Scope | PR checks |
| --- | --- |
| README / ordinary Markdown only | Classification and required aggregation remain; test setup, browser and Pages builds are skipped. `docs/testing` is excluded from this exemption. |
| Registered local UI | Affected contracts, five focused browser tests and Pages source references. Performance sampling remains visible as an observation that the merge gate does not wait for. |
| Other JS/CSS runtime | Affected contracts, existing smoke, source references and applicable required performance measurement. |
| Data, dependencies, entries, packaging or CI routing | Full Pages artifact checks and other checks required for the scope. `ci:full` forces full PR routing; `ci:perf-strict` forces strict performance measurement. |

The UI scope currently contains only `editor-workspace.css`, `editor-tool-guidance.css`, `styled_selects.js` and `toolbar/tool_guidance.js`; see the complete paths in the [shared policy](../tools/ci/perf_policy.mjs). Additional files cause the entire change set to be reclassified. Unknown paths cannot receive the UI exemption.

Run `npm run verify:pages-source-graph` to check current HTML, JS/MJS and CSS references without generating dist. This does not establish data-content, compression or release-artifact integrity; full build and release checks retain those responsibilities.

Saving work to a feature branch does not require first updating from `main` or repeating broad verification. Fetch the target when preparing to merge and check the final commit's required checks. If protection requires an updated branch, merge the latest `main` and wait for that update's CI without adding a local `verify:pr` run. Label changes replan checks. Pages release admission remains separate after merge; Scenario/Transport no longer repeat full audits automatically and retain manual Actions entry points.
