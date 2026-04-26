# City lights preset balance context

2026-04-26 execution start.

Approved choices:
- Visual target: realistic balance.
- 1930 corridor flavor: built-in micro channel, no new UI slider.

Known code paths:
- Defaults: js/core/state_defaults.js, index.html, js/ui/toolbar/appearance_controls_controller.js, tests/e2e/city_lights_layer_regression.spec.js.
- Rendering: js/core/map_renderer.js.
- Historical builder/asset: tools/build_city_lights_historical_1930_asset.py, js/core/city_lights_historical_1930_asset.js.
- Tests: tests/e2e/city_lights_layer_regression.spec.js plus tests/city_lights_asset_contract.test.mjs.

Execution notes:
- Parent owns live tests; subagents stayed static-analysis only.
- Modern defaults settled at texture 0.32, corridor 0.18, population boost 0.90.
- Modern runtime texture/corridor alpha and spread were reduced; population boost was strengthened through existing urban/city data.
- Historical asset now uses hierarchy country metadata for Europe/Japan/US/Asia calibration and reports calibrationVersion=balanced-2026-04.
- Historical render now adds a capped derived glow layer from high-weight historical entries.
- E2E was expanded to cover Europe, China, India, Japan, and US samples. The test timeout is 240s because the visual regression covers multiple time zones and screenshots.
- A transient mistake briefly allowed overlapping e2e process ownership; related processes were stopped and later validation was serialized with parent ownership only.

Fresh verification captured:
- npm run test:node:city-lights-assets: PASS.
- city_lights_layer_regression e2e: PASS, 1 passed in 3.2m.
- python/js syntax checks: PASS.

Closeout notes:
- AI slop cleanup pass was scoped to changed files. One small cleanup replaced a forEach early-return pattern with a breakable for...of loop in historical derived glow cache generation.
- Static reviewer subagent did not finish within the review window and was closed. Main-thread first-principles review found no simpler implementation beyond the capped historical glow loop and existing named tests.
- lessons learned.md was checked at start; no new durable lesson was added because the main issue was local test ownership hygiene already covered by existing project discipline.
