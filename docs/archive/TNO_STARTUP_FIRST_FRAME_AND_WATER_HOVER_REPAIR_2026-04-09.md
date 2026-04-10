# TNO Startup First Frame and Water Hover Repair 2026-04-09

## Goal

修复并继续优化这 4 件事：

1. 首屏直接显示 TNO，而不是先露出像 1939 / HOI4 的 base 预览
2. 继续压缩 pan / zoom 剩余卡顿
3. 开放水域禁 hover、保留 click，修海洋高亮迟滞
4. 顺手复核启动链里还能收的真实优化点

## Progress

- [x] 读取现有代码与运行状态
- [x] 静态确认默认场景仍是 `tno_1962`
- [x] 静态确认“像 1939”来自 first-visible-base 预览帧
- [x] 静态确认海洋高亮迟滞主线在 water hover 命中链
- [x] 实现首屏直接 TNO
- [x] 实现开放水域禁 hover、保留 click
- [x] 实现交互热点的进一步优化
- [x] 完成静态检查与浏览器复测
- [x] 修复 `scenario_resources` 重复 `const loadState` 导致的 0% 启动阻断
- [x] 复核 lessons learned 并归档

## Evidence before fix

- `data/scenarios/index.json` 默认场景仍是 `tno_1962`
- `index.html` meta 默认场景仍是 `tno_1962`
- `js/main.js` 在 scenario bundle/apply 前先做了：
  - `renderDispatcher.flush()`
  - `checkpointBootMetricOnce("first-visible")`
  - `checkpointBootMetricOnce("first-visible-base")`
  - `setBootPreviewVisible(true)`
- `js/core/map_renderer.js` 中：
  - `getWaterHitFromPointer()` 仍允许开放水域参与 hover
  - `getHitFromEvent()` 对 scenario water 命中优先级过强

## Validation after fix

- 静态检查通过：
  - `node --check js/main.js`
  - `node --check js/core/map_renderer.js`
  - `node --check js/core/scenario_resources.js`
  - `node --check js/core/state.js`
- 浏览器探针复测结论：
  - boot metrics 不再出现 `first-visible-base`
  - 首个 `first-visible` 已对齐到 scenario apply 后的 TNO frame
  - 开放水域 hover tooltip 为空，陆地 hover 仍可工作
  - `rebuildStaticMeshes` 继续下降到百毫秒量级
- 启动 0% 阻断复测：
  - 脚本入口 `/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1` 已恢复
  - boot overlay 能正常结束到 `100%`
  - `map-canvas` 创建成功
  - `scenarioStatus` 恢复为 `TNO 1962`
  - console 不再出现 `Identifier 'loadState' has already been declared`
- 已确认的继续优化线索：
  - exact refresh 里 `drawPhysicalBasePass`、`drawPhysicalContourLayer` 仍然是主要成本
  - startup bundle 的 `.json.gz` preload 仍有“已 preload 但晚使用”的告警，后续可单独继续收
