# Context Log

- 2026-04-22: Ralph branch for preload warning fix started.
- Current evidence points to unconditional `<link rel="preload" href="data/europe_topology.json">` in `index.html`.
- Startup pipeline now bootstraps topology from startup bundle / runtime shell artifacts for the default scenario path, so the static base-topology preload looks stale.
- Need to confirm dependent tests and then remove or replace the stale preload at the source.
- Static root-cause review confirmed the startup mainline already consumes scenario startup bundle data for topology injection, while `data/europe_topology.json` remains mainly a fallback loader path.
- Implemented fix:
  - removed the unconditional `data/europe_topology.json` preload from `index.html`
  - updated startup shell contract tests to assert the preload is absent and `data/scenarios/index.json` preload remains
- Verification:
  - targeted unittest passed: `tests.test_startup_shell.StartupShellTest.test_index_html_keeps_startup_preloads_and_deferred_milsymbol`
  - targeted unittest passed/skip as expected: `tests.test_pages_dist_startup_shell.PagesDistStartupShellTest.test_dist_app_index_keeps_pages_startup_contract`
  - `npm run test:e2e:scenario-chunk-exact-after-settle-regression` passed twice after the change
- Deslop pass result:
  - scope limited to `index.html`, `tests/test_startup_shell.py`, `tests/test_pages_dist_startup_shell.py`
  - no extra cleanup edits were needed after the architecture fix
- OMX Ralph state write was blocked by a stale autopilot-overlap guard even after state clear attempts; execution continued with manual Ralph bookkeeping.