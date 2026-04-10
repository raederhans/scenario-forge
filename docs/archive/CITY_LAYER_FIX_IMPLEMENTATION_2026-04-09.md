# 城市图层修复实施记录（2026-04-09）

## 目标
- 修复城市点在拖动时同视口内忽隐忽现的问题
- 修复深色国家底色下 city marker 对比度不足的问题
- 补上最小但够用的回归验证

## 执行计划
- [x] 重构 `buildCityRevealPlan`，改成国家 capital 保底 + 剩余预算补点
- [x] 给 city marker 接入背景自适应，并补上 sprite cache 失效
- [x] 新增回归测试覆盖可见性与对比度
- [x] 运行相关验证
- [x] 完成 review / 查 bug / 第一性原理复核

## 进度记录
- 2026-04-09：复核报告与代码，确认 issue 1 的主因是单次全局 budget 截断；issue 2 的主因是 marker 未接背景自适应且 sprite cache 不看背景。
- 2026-04-09：`getCityMarkerSprite()` 改为走 `getCityMarkerRenderStyle()`，sprite key 增加背景色，并按 `state.colorRevision` 自动清空 marker sprite cache。
- 2026-04-09：`buildCityRevealPlan()` 改为先按 `countryKey` 选每国最优 capital，再用剩余预算补其它城市，同时保留 `candidateEntries` 供回归测试直接验算。
- 2026-04-09：新增 `tests/e2e/city_reveal_plan_regression.spec.js`，覆盖低倍平移下 capital 保底与深色背景 marker 自适应。

## 验证
- `node --check js/core/map_renderer.js`
- `node --check tests/e2e/city_reveal_plan_regression.spec.js`
- `node --check tests/e2e/city_points_urban_runtime.spec.js`
- `node node_modules/@playwright/test/cli.js test tests/e2e/city_reveal_plan_regression.spec.js --reporter=list --workers=1 --retries=0`
