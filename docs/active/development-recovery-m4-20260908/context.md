# Context

## Current truth

Baseline HEAD: 00d3465b. Existing unowned work: .codex/config.toml and docs/active/development-recovery-m0-m1-20260907/. Prior turn consolidated water strategy branches and added six characterization cases (14/14 tests passed).

## Decisions

The cache lifecycle was split between render_cache_owner.js (global reference reset), scenario_region_overlay_render_owner.js (canvas allocation/compositing), and map_renderer.js (relief cache publication/reuse). It is now implemented by the existing render cache owner through a frozen scenarioLayerCache API: getSnapshot/render/draw. Summaries contain no mutable canvas or transform. Both overlay owners use this API, and map_renderer delegates the relief pass to its owner.

The water reuse/adaptive/redraw implementation has one cache rebuild path. The renderer no longer proxies raw layer cache access between relief and region owners. Two inherited source-location assertions were corrected to the existing render-pass signature and visible-frame policy modules after targeted failures exposed them.

## Live process ownership

Primary agent owns all implementation and checks.

Browser verification owner: primary agent. Cwd: repository root. Command: `node node_modules/@playwright/test/cli.js test tests/e2e/water_cache_strategy_regression.spec.js --grep "mode reuse" --workers=1 --output .runtime/tests/playwright/m4-water-reuse`. Set `PLAYWRIGHT_TEST_SERVER_PORT=8008` and `MAPCREATOR_DEV_PORT=8008`; the existing Playwright configuration owns server startup/teardown. Log: `.runtime/tmp/m4-water-reuse.log`. One localhost test, 120-second test timeout, no retries or concurrent browser runs; success requires the existing interaction assertions, failure retains trace/screenshot and is diagnosed before retry.

The browser run completed successfully (exit 0); no test server remains owned by this task.

## Handoff

M4 implementation and local acceptance are complete; task.md records checks and the unrelated pre-existing global allowlist failure. No implementation steps remain within plan.md. Working-tree changes have not been committed or published.
