# Development and delivery

[中文](development-and-delivery.zh-CN.md)

## Local checks

```sh
npm test                 # every Node and Python unit test
npm run test:node        # Node only (tests/*.test.mjs)
npm run test:python      # Python only (pytest -n auto)
node --test tests/<file>.test.mjs   # one file
npm run test:e2e:golden  # golden user flows (about 20 minutes)
```

Browser test entry points:

| Entry | Scope |
| --- | --- |
| `npm run test:e2e:golden` | `tests/e2e/golden/`: golden user flows that reach the app only through the DOM and `js/core/app_test_api.js`. |
| `npm run test:e2e` | Playwright's default scope: everything under `tests/e2e/` except `release/`, that is the golden flows, the sample guide, map drag release and the control gallery (gallery baselines exist for win32 only). |
| `npm run test:e2e:pages-public-release-gate` | `tests/e2e/release/` against the published site in `SCENARIO_FORGE_PAGES_URL`; the `:deployed` variant defaults to the live Pages URL. |

`npm run verify:tno-strict-contracts` runs the strict TNO data contracts and writes the strict, coverage-ledger and Atlantropa reports in one pass; `npm run verify:tno-coverage-chain` adds the polar coverage check and the chunk contract tests.

`dist/` is not tracked. CI builds the Pages artifact from source with `tools/build_pages_dist.py`, which bundles the editor's JavaScript into `app/js/bundle/` with `tools/build_editor_bundle.mjs` (esbuild). Run `npm run verify:pages-dist` for a local build.

`tests/quarantine.json` is the only skip list on PRs. Every entry needs a reason and leaves as soon as the test is fixed or deleted. The weekly run (`weekly.yml`) adds the slow lists with `--with-slow` but still skips the quarantine, so it only goes red on new breakage; run `--all` by hand for a full audit including the quarantine.

| Stage | Action |
| --- | --- |
| Edit | Run the test files closest to the change; exercise affected UI with one focused browser check. |
| Before a commit | `npm test`. Add `npm run verify:pages-dist` when data, packaging or Pages entries change. |
| Push a feature branch | Push within existing authorization; no extra verification bundle is required. |
| Merge a PR | Wait for `PR Verify Required` on the final commit. |
| Release | Merging to `main` triggers deployment: the artifact is built once, the save/reopen and PNG export golden flows run against that artifact, then it is uploaded and published and the live URLs are checked. Confirm CI, merge and live deployment separately. |

## PR checks

Every PR runs the same required jobs; there is no path-based routing. The job count is kept small on purpose: each job spends about two minutes checking out this repository.

| Job | Contents |
| --- | --- |
| `checks` | Builds the Pages artifact once and checks its startup shell; Quick Fill hierarchy data and audit, data catalog health, Pages source references; every Node and Python unit test. |
| `golden` | Golden user flows (three groups by content: scenarios, editing and panels, one worker each): startup, switching and filling in all five scenarios, undo/redo, save and reopen, PNG export, performance budgets, the panels (`golden_ui_flows.spec.js`: appearance tabs, transport workbench, special zones, export workbench layers, language switch, inspector colors, command palette) and the landing flows. They reach the app only through the DOM and `js/core/app_test_api.js`. |
| `PR Verify Required` | Fails when any job above fails; the only required check. |

Three workflows are not required checks: `data-verify.yml` (strict data contracts for all five scenarios, the transport manifest validator and the TNO raster release stages) runs only when `data/`, the builders or the political raster renderer change; `hgo-native.yml` runs only when `apps/hgo/` changes; `weekly.yml` runs the slow tests, the remaining browser specs and the full `data-verify` once a week. All three can be dispatched from Actions. CI does not measure performance.

Saving work to a feature branch does not require updating from `main` first. Fetch the target when preparing to merge and check the final commit's required check; Pages release admission stays separate after merge.
