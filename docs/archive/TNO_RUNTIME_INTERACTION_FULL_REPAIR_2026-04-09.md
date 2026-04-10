# TNO Runtime Interaction Full Repair 2026-04-09

## Goal

一次性修复这 4 个串联问题：

1. 场景打开后真正可交互时间过长
2. 地图直接拖拽 / 缩放 / 命中交互严重卡顿
3. 拖动后视觉地图与判定地图错位
4. 缩放后清晰度不能恢复到 exact detail

## Fixed implementation scope

- 修复 post-ready / detail promotion / chunk promotion 的错误与重复重建
- 修复 mesh 生命周期与重建时机
- 修复视觉层 / spatial / hit canvas 世代同步
- 修复 pan / zoom 热路径
- 修复 zoom settle 后 exact frame 恢复

## Progress

- [x] 读取 lessons learned 并复核现有 startup/perf 文档
- [x] 静态定位主因并做浏览器探针复现
- [x] 实现 startup/detail/chunk 调度修复
- [x] 实现 map_renderer 的 mesh / hit / exact-frame 修复
- [x] 集成并完成静态检查
- [x] 完成浏览器复测
- [x] 执行 review-查bug-第一性原理复核
- [x] 更新 lessons learned（如有必要）
- [ ] 归档本文档

## Key evidence before fix

- 本地探针 `.runtime/browser/manual-probe/probe.json`
- 截图：
  - `.runtime/browser/manual-probe/ready.png`
  - `.runtime/browser/manual-probe/after-pan.png`
  - `.runtime/browser/manual-probe/after-zoom.png`
- 已确认：
  - `setMapData` 在 detail promotion 后出现约 56s 阻塞
  - `rebuildStaticMeshes` 单次约 54s
  - `contourHostFillColorCache` 未定义导致 post-ready hydration 报错

## Validation after fix

- 静态检查通过：
  - `node --check js/main.js`
  - `node --check js/core/map_renderer.js`
  - `node --check js/core/scenario_resources.js`
  - `node --check js/core/scenario_post_apply_effects.js`
  - `node --check js/core/state.js`
- 浏览器探针复测：
  - `readyAt`: 约 `13.4s -> 5.3s`
  - `setMapData`: 约 `56.3s -> 3.6s`
  - `rebuildStaticMeshes`: 约 `53.9s -> 0.29s`
  - `dragVisibleStaleFrameMs`: 约 `298ms -> 106ms`
  - `settleExactRefresh` 已恢复记录，不再被 contour cache 报错打断
- console 复测结果：
  - 不再出现 `contourHostFillColorCache is not defined`
  - detail promotion 仍按原链完成
