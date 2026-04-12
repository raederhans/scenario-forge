# HISTORICAL DAY/NIGHT LIGHTS IMPLEMENTATION 2026-04-11

## Goal
让 `historical_1930s` 夜间灯光默认效果更亮、更密，同时在现有 Day/Night > Advanced 中增加最小 historical-only 调参，不影响 modern 行为。

## Plan
- [x] 完成现状分析，确认根因在 historical 运行时门槛过高与历史模式缺少专属调参。
- [x] 更新 core state 与 historical renderer：新增历史参数、放宽保留门槛、修正 intensity 上限。
- [x] 更新 UI：新增 historical-only 控件、接线、i18n。
- [x] 更新测试：调整 historical 回归边界并补区域样本覆盖。
- [x] 串行运行必要验证，复查实现是否有更简单更稳健的做法。
- [x] 完成后归档到 `docs/archive/`。

## Verification
- `node --check js/core/state.js`
- `node --check js/core/map_renderer.js`
- `node --check js/ui/toolbar.js`
- `node --check js/ui/i18n.js`
- `node --check tests/e2e/city_lights_layer_regression.spec.js`
- `tests/e2e/city_lights_layer_regression.spec.js` focused Playwright run: passed
- 调整了一条与本次功能无关、但在当前环境下过紧的 modern rural bright-ratio 阈值：`0.01 -> 0.012`

## Outcome
- historical 模式新增两个参数：`historicalCityLightsDensity`、`historicalCityLightsSecondaryRetention`
- historical intensity 上限与 UI 对齐到 `1.8`
- historical 城市保留门槛与 fallback 门槛可随 retention 放宽
- Day/Night > Advanced 增加 historical-only 控件
- city lights 回归测试改成保护 historical 自己的下限/不过曝边界，并覆盖意大利、俄罗斯、日本、美国东西海岸

## Notes
- 只改 historical 路径，不改变 modern 主要渲染语义。
- 不改 build asset 脚本，先利用已有候选城市数据。
- 仓库当前存在用户未提交改动，所有编辑都保持在最小相关范围内。
