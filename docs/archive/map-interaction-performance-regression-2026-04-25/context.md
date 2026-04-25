# Context

2026-04-25 开始执行，已完成。

关键修复：
- 删除 `zoom-end` 对 political required chunks 只保留 1 个的降级逻辑，保留 non-political detail 的降级。
- `political/contextBase/contextScenario/effects` dirty 时失效整帧 `lastGoodFrame`，并阻止 fallback 旧帧重新写回 last-good。
- transformed-frame 先检查 pass 完整性，再清主 canvas，避免缺 pass 时出现黑帧或旧帧污染。
- overscan ratio 恢复到 0.15，减少缓存 pass 面积。
- post-ready 重任务改为带 quiet window 的串行 idle task，context/city/contour warmup 合并为少量 render。
- benchmark schema 升到 3，新增 `firstInteraction` / `fullySettled` 分层和 wheel/pan/fill 指标。
- 新增 Great Lakes Congo zoom-end e2e 回归，强制 Congo bbox 后验证 CD/GCO detail chunks 被加载且 probe 仍有颜色。
- 更新 `tests/test_scenario_chunk_refresh_contracts.py`，让合同匹配新的 `isInteractionRecoverySettled({ quietMs: 600 })` 门控。

验证结果：
- `node --check js/main.js js/core/map_renderer.js js/core/scenario/chunk_runtime.js tests/e2e/dev/scenario_chunk_exact_after_settle_regression.dev.spec.js` 通过。
- `python -m py_compile ops/browser-mcp/editor-performance-benchmark.py` 通过。
- `python -m unittest tests/test_scenario_chunk_refresh_contracts.py` 通过，18 tests。
- `npm run test:node:scenario-chunk-contracts` 通过，4 tests。
- `npm run test:node:perf-probe-snapshot-behavior` 通过，3 tests；保留既有 MODULE_TYPELESS_PACKAGE_JSON warning。
- `npm run test:e2e:dev:scenario-chunk-runtime` 通过，4 tests，日志 `.runtime/tests/scenario-chunk-runtime-20260425-final/stdout.log`。
- `npm run test:e2e:dev:tno-ready-state` 通过，5 tests，日志 `.runtime/tests/tno-ready-state-20260425/stdout.log`。
- `node tools/perf/run_baseline.mjs --mode gate --scenarios tno_1962 --runs 3 --warmups 1 --threshold 1.15 --write-markdown false` 通过。
- 全量 `npm run perf:gate` 的 TNO 指标通过，但 `hoi4_1939.renderSampleMedianMs` 单项失败：current 537.5ms，baseline 420.5ms，limit 525.6ms，ratio 1.25；同次 HOI4 renderSampleTotalMs 更低，537.5ms vs 1102.0ms。该失败与本次 Congo/TNO zoom 修复主路径分离，已在最终汇报中暴露。

TNO perf gate 关键量化：
- totalStartupMs 7036.7ms vs 10558.4ms，ratio 0.666。
- firstInteractiveMs 7036.6ms vs 10558.4ms，ratio 0.666。
- scenarioAppliedMs 5683.5ms vs 8174.6ms，ratio 0.695。
- applyScenarioBundleMs 2825.3ms vs 5196.2ms，ratio 0.544。
- refreshScenarioApplyMs 312.1ms vs 3932.4ms，ratio 0.079。
- renderSampleMedianMs 948.8ms vs 2101.3ms，ratio 0.452。
- renderSampleTotalMs 1886.5ms vs 4897.3ms，ratio 0.385。

复核记录：
- 子代理静态 review 建议已吸收：保留 political required chunks、加入 contextBase last-good invalidation、保留 fallback capture guard、更新 interaction recovery contract。
- 第一性原理复核后清理了未使用的 `POST_READY_HEAVY_IDLE_QUIET_MS`、`waitForInteractionRecoverySettled()` 和临时 pan helper，保持实现更短。
- `lessons learned.md` 已有 post-ready quiet window、last-good fallback、callback 生命周期相关教训，本次未追加重复条目。
