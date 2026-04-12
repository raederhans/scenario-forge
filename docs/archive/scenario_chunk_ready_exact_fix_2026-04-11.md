# scenario_chunk_ready_exact_fix_2026-04-11

## Plan
- [done] 确认三处回归的最小修复边界
- [done] 修复 basic-ready 前缺少 spatial index
- [done] 修复 chunk eviction 颜色回滚
- [done] 修复 exact-after-settle 被异步 chunk refresh 误短路
- [done] 补充 targeted regression tests
- [done] 定向验证、复核、归档

## Progress Log
- 2026-04-11 先完成代码与现有测试路径静态定位，确认三处问题都落在 map_renderer.js / scenario_resources.js，且可以用最小补丁修复。
- 2026-04-11 在 `buildBasicInteractionInfrastructureAfterStartup()` 里把 land spatial index 前移到 `basic-ready` 之前，但没有提前 full color rebuild、secondary spatial 或 hit canvas。
- 2026-04-11 把 chunk refresh 返回语义拆成 `promotion-committed` / `refresh-started`，并让 `render-phase-idle` 只在前者时跳过 exact-after-settle。
- 2026-04-11 `applyScenarioPoliticalChunkPayload()` 改成用旧/新 political feature id 并集刷新颜色，避免 eviction 后旧色残留。
- 2026-04-11 新增 `tests/test_scenario_chunk_refresh_contracts.py`，并扩展 `tests/e2e/tno_ready_state_contract.spec.js` 与 `tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js`。
- 2026-04-11 验证通过：`python -m unittest tests/test_scenario_chunk_refresh_contracts.py`；`node node_modules/@playwright/test/cli.js test tests/e2e/tno_ready_state_contract.spec.js tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js --reporter=list --workers=1 --retries=0`。
