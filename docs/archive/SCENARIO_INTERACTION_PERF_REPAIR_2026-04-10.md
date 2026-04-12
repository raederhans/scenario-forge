# Scenario Interaction Performance Repair 2026-04-10

## Goal
- 修掉 zoom/pan 结束后的长尾卡顿
- 缩短 startup readonly unlock 到真正可操作的时间
- 保住最新 urban external source / adaptive 契约，不拿正确性换性能

## Scope
- [x] 解耦 pending chunk promotion 与 exact-after-settle
- [x] 把 scenario chunk promotion 改成 staged apply（visual stage / infra stage）
- [x] 瘦身 unlock 前 blocking interaction infrastructure
- [x] 补充定向测试，覆盖 promotion 调度与 urban 契约保护
- [x] 定向验证、复核、归档

## Progress Notes
- 已确认最新 commit `18660bb` 只改变 urban source 选择与 startup urban 预载约束，不改变主瓶颈判断。
- 已重新跑本地 probe：`probe.json` / `zoom-check.json`，确认主瓶颈仍在 chunk promotion + unlock infra，而不是 overlay。
- 已实现：
  - `scheduleScenarioChunkRefresh()` 支持 idle fast-frame 立即放行 pending flush，不再硬等 exact-after-settle
  - `refreshMapDataForScenarioChunkPromotion()` 改成 visual stage + deferred infra stage
  - startup unlock 只 await basic interaction infra，full interaction infra 改成 idle 后后台补齐
  - `buildIndexChunked()` / `buildSpatialIndexChunked()` 从假 chunked 改成真切片
- 已补测试：
  - `tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js`
  - `tests/e2e/city_points_urban_runtime.spec.js`
- 已验证：
  - `node --check js/core/map_renderer.js`
  - `node --check js/core/scenario_resources.js`
  - `node --check js/main.js`
  - `node --check tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js`
  - `node --check tests/e2e/city_points_urban_runtime.spec.js`
  - `tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js` 通过
  - `tests/e2e/city_points_urban_runtime.spec.js` 通过
- 复测 `node .runtime/tmp/playwright_zoom_check.js`：
  - `scenarioChunkPromotionVisualStage ≈ 5ms`
  - `scenarioChunkPromotionInfraStage ≈ 15.6ms`
  - `settleExactRefresh ≈ 511.7ms`
  - `longAnimationFrameBlockingDuration ≈ 512.9ms`
  - `urban` 仍为 `external + adaptive`
