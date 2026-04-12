# PHYSICAL_RELIEF_OVERLAY_IMPLEMENTATION_2026-04-11

## Goal
- 让地貌 atlas 重新在国家填色上方提供可见的地形骨架
- 避免 semantic atlas 整片压住国家填色
- 只做最小实现，不改公开 state/schema/UI

## Plan
- [x] 调整 physical atlas 的 render pass 归属：semantic_overlay 留在 physicalBase，relief_base 提到 contextBase
- [x] 给上层 relief overlay 单独限制 opacity / blend 行为
- [x] 修复 staged warmup 下 relief overlay 首屏丢失的问题
- [x] 更新 physical layer 回归测试契约
- [x] 运行最小验证并记录结果

## Progress Log
- 2026-04-11: 建立执行文档，准备开始实现。
- 2026-04-11: 已在 `js/core/map_renderer.js` 中把 `relief_base` 提升到 `contextBase`，并给上层 relief overlay 增加单独的 alpha cap 与温和 blend 规则；`semantic_overlay` 继续留在 `physicalBase`。
- 2026-04-11: 发现 staged apply 时 `contextBase` 会整体 defer，导致首屏丢失 relief overlay；已在 defer 分支里保留 `drawPhysicalReliefOverlayLayer(...)`，只继续延后 contours / urban / rivers。
- 2026-04-11: 已更新 `tests/e2e/physical_layer_regression.spec.js`，同步新的 pass 归属断言，并补了最小像素差异回归检查与 defer 分支断言。
- 2026-04-11: 已运行 `node node_modules/@playwright/test/cli.js test tests/e2e/physical_layer_regression.spec.js --reporter=list --workers=1 --retries=0`，结果通过。
