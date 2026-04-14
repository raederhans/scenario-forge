# TNO political coarse 第二波实施记录 2026-04-13

## 目标

- 在不改变现有运行时 URL 和交互语义的前提下，瘦身 `chunks/political.coarse.r0c0.json`
- 保持 `feature id`、国家归属颜色、coarse prewarm、detail promotion 不退化
- 不在本轮处理 `water.coarse.r0c0.json`

## 实施清单

### 1. 生成链
- [x] 收紧 political coarse payload，只保留最小必要字段
- [x] 对 political coarse 几何做保守坐标收口
- [x] political coarse 改成 minified JSON 写出

### 2. 兼容约束
- [x] 不改 chunk id / manifest URL / runtime_meta / mesh_pack 结构
- [x] 不改 detail political chunks

### 3. 验证
- [x] 补 unit tests
- [x] 重建 `tno_1962` chunk assets
- [x] 跑定向测试并记录体积变化

## 进度记录

- 2026-04-13：`tools/scenario_chunk_assets.py` 已对 `political.coarse` 增加专用优化路径：保留 `id/name/cntr_code/__source` 四个属性、去掉顶层重复 `feature.id`、对几何坐标做 4 位小数收口，并改成 minified JSON 写出。
- 2026-04-13：已重跑 `python tools/build_scenario_chunk_assets.py --scenario-dir data/scenarios/tno_1962`，`political.coarse.r0c0.json` 从约 `70.99 MB` 降到约 `28.53 MB`。
- 2026-04-13：`water.coarse.r0c0.json` 本轮未处理，保持约 `55.45 MB`。

## 本轮验证

- `python -m py_compile tools/scenario_chunk_assets.py tests/test_scenario_chunk_assets.py`
- `python -m unittest tests.test_scenario_chunk_assets tests.test_startup_shell tests.test_scenario_resources_boundary_contract -q`
- 定向 smoke：
  - `python tools/build_scenario_chunk_assets.py --scenario-dir data/scenarios/tno_1962`
  - 产物检查：`political.coarse.r0c0.json` feature 数仍为 `13195`，属性保留 `__source/cntr_code/id/name`

## 结论

- 这一轮只靠最稳的 minify + 字段收口 + 坐标保守收口，就已经把 `political.coarse` 压到目标线以下，不需要继续对几何做更激进的 owner 聚合。
- 下一步可以继续推进 `water.coarse.r0c0.json`。
