# TNO Exact Refresh Optimization 2026-04-09

## Goal

继续推进这 3 个方向：

1. contour 可见集缓存
2. 继续收紧 physical exact 强刷条件
3. 把 `drawContextBasePass()` 拆成首个 exact 核心帧和后补帧

## Progress

- [x] 读取现有渲染热点与 probe 指标
- [x] 只读复核风险点
- [x] 实现 contour 可见集缓存
- [x] 实现 exact 强刷条件收紧
- [x] 实现 contextBase 核心帧/后补帧拆分
- [x] 静态检查与浏览器复测
- [x] 更新 lessons learned 并归档

## Baseline

- `drawPhysicalBasePass` 约 120ms+
- `drawPhysicalContourLayer` 约 120ms+
- `drawContextBasePass` 约 128ms+
- 当前目标是不损坏视觉和功能前提下继续压缩 exact refresh 成本

## Validation after change

- 静态检查通过：
  - `node --check js/core/scenario_resources.js`
  - `node --check js/core/map_renderer.js`
  - `node --check js/main.js`
  - `node --check js/core/state.js`
- 启动复测通过：
  - 脚本入口不再卡 0%
  - `scenarioStatus` 正常为 `TNO 1962`
  - `first-visible` 保持直接 TNO
- 交互复测通过：
  - 开放水域 hover 仍为空
  - 陆地 hover 正常
- 本轮 exact 方向已落地：
  - contour 可见集缓存
  - physical exact 强刷条件收紧
  - contextBase 核心帧 / 后补帧拆分
