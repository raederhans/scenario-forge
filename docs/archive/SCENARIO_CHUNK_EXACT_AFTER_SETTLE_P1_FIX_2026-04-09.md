# exact-after-settle chunk refresh P1 修复记录（2026-04-09）

## 目标
- 修复 chunked scenario 在 exact-after-settle 快路径下，挂起的 chunk refresh / pending promotion 不会在本轮 settle 结束后自动 flush 的问题。

## 执行计划
- [x] 复核 `map_renderer` 与 `scenario_resources` 的调度链路
- [x] 在 exact settle 结束点补一次 guarded flush
- [x] 新增 focused regression spec
- [x] 运行最小验证
- [x] 归档记录

## 进度记录
- 2026-04-09：确认根因不在 `scenario_resources` 的全局 defer 规则，而在 `scheduleExactAfterSettleRefresh()` 清掉 `deferExactAfterSettle` 之后没有再补一次 flush。
- 2026-04-09：新增 `flushPendingScenarioChunkRefreshAfterExact()`，只在确实存在 `pendingReason/pendingPromotion` 时才补调度，并把真正 flush 放到下一轮 `setTimeout(0)`，避免同一调用栈里的瞬时状态再次把它判成 deferred。
- 2026-04-09：新增 `tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js`，通过 probe `state.scheduleScenarioChunkRefreshFn` 的调用序列，验证 exact 前的 deferred flush 和 exact 后的第二次 flush 都发生，且后者发生在 `renderPhase === "idle"`、`deferExactAfterSettle === false` 时。

## 验证
- `node --check js/core/map_renderer.js`
- `node --check tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js`
- `node node_modules/@playwright/test/cli.js test tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js --reporter=list --workers=1 --retries=0`
