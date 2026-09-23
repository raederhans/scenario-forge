# Coordination

2026-09-23: parent owns UI/index/styles/state integration and final checks. Native city_policy worker owns city_reveal_policy.js, urban_city_policy.js and policy tests. Antigravity Gemini 3.8 Flash High, workspace_write, router task 72b3e21e619546d794c6f0f2fc931756 owns city_points_render_owner.js, city_paint_style_model.js and their tests. Zhipu GLM-4.5-Air read_only, task 7bb31917dcfd496a9409d48de9141247 extracts TNO source facts. All preserve others' work.

Shared contract: entry.settlementRank = metropolis/large/medium/small/town; isCapital independent. Parent adds densityPreset compact/balanced/detailed and minSettlementRank (default town) to city style normalization and UI. Historical unknown rank falls back to legacy tier; no invented historical population.

Live browser/server/test ownership: parent only; runtime outputs under .runtime/. Current source budget differs from old memory: density .95 at scale >=12 gives 114 marker and 72 balanced label budget.

Parent starting `python -u tools/dev_server.py --port 8000 /app/` in repo root with browser auto-open disabled. Port 8000 checked free. Logs .runtime/browser/city-strategic/server.log and server.err.log. Success: source editor loads; stop when focused UI verification done. No other agent starts browser/server. Native worker policy + roundtrip tests 25 passed; initial parent integration set 107 passed / 2 expected old-theme assertions pending update.

Integration completed: old theme-reset assertions updated; city theme changes now preserve scale/density/opacity. Strategic controls moved into Map Content / Thematic; async completion and metric changes refresh resolved political colors. Resource filter participates in render identity, and palette/opacity survive project export/import. Source-region search uses a native select to avoid hundreds of custom option buttons. Labels use settlement rank and capital identity.

TNO evidence: original Workshop source exists at `C:/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901/history/states`. Parent read 1-Corsica.txt and 10-Warschau-Stadt.txt; TNO has custom buildings including prisons, thermoelectric_plant, offices, barracks and hospitals. Current TNO manifest has no strategic_values_url. Do not accept the CLI's earlier unsupported claim that original source is absent. No speculative TNO mapping or dataset changes were made.

Final browser uses in-app tab cityFinalTab (earlier owned tabs closed), server PID 42528. Evidence: `.runtime/browser/city-strategic/strategic-1939.png`; test logs city-tests.log and final-integration.log in same folder. Final status-count correction assigned back to city_policy worker; CDP shows drawLabelsPass visibleFeatureCount=83, while drawCityPointsLayer is missing and UI says zero.

Concurrent unrelated modifications expanded to map_builder, Python scenario tests, scenario-rules and generated files in all three scenario directories. They belong to other work and must be preserved and excluded from this task's claims.

Final status fix completed: use newest measured city visibility from settled drawLabelsPass or interactive drawCityPointsLayer; absent measurements are not zero. Refreshed browser confirms a positive visible count. All native and CLI delegates finished. Owned browser tabs closed; parent stopping only owned server PID 42528. No commit or deployment. Task record may now be archived.

Follow-up authorization 2026-09-23: user requested pushing and merging this work together with the separate country-color task. Integration branch `codex/city-strategic-colors-20260923` starts from origin/main after PR #149. Color changes are 56 TNO, eight 1936 and seven 1939 entries, with persistent source rules and bilingual startup bundles. Source commits: 4ea5af4f (colors), 8815b85f (city/strategic); ef253e4d updates the canonical Pages mirror. PR #150 owns integration; do not infer remote merge/deploy completion from this record.

Integration checks: 121 Node behavior tests and six color regressions passed. Pages startup-shell suite passed 63/64 initially; its single failure identified a stale TNO landing hero. Canonical regeneration changed only fills, and the previously failing hero-assets regression then passed. 6ca60655 includes the hero and its distribution mirror. Parent owns all builds/checks; integration logs are under `.runtime/reports/generated/city-colors-integration/`. First remote fast check rejected an unmatched 1936 manual-rule source; a bounded routing correction is required, without relaxing the unmatched-file gate. Remaining remote checks/merge/deployment are tracked through PR #150.

Routing correction complete: manual-rule changes now select the existing HOI4 builder and bundle suites. Focused planner regression and verify:edit passed (614 routes validated, 17 Python tests, no deferred work). First PR revision passed all other checks including perf; the final revision must be checked independently before merge.
