# TNO water coarse 第二波实施记录 2026-04-13

## 目标

- 在不改变现有运行时 URL、字段语义、层级关系和 inspector 行为的前提下，瘦身 `chunks/water.coarse.r0c0.json`
- 保持 `water inspector` 的筛选、层级跳转、batch scope apply、open ocean 过滤不退化
- 不在本轮处理 `water.detail.*`、`runtime_topology.topo.json`、`startup bundle`

## 实施清单

### 1. 生成链
- [x] `water.coarse` 改成 minified JSON 写出
- [x] 不裁 water coarse 字段
- [x] 不改几何和 feature id

### 2. 兼容约束
- [x] 不改 chunk id / manifest URL / runtime_meta / mesh_pack 结构
- [x] 不改 detail water chunks
- [x] 不改前端读取逻辑

### 3. 验证
- [x] 补 unit tests，锁住 `water.coarse` 自己的契约
- [x] 重建 `tno_1962` chunk assets
- [x] 跑定向测试并记录体积变化

## 进度记录

- 2026-04-13：静态审计确认 `water.coarse.r0c0.json` 与 `water_regions.geojson` 的 feature 内容一致，当前 55MB 主要来自 pretty JSON 写法；minify 后同内容约 16MB。
- 2026-04-13：`tools/scenario_chunk_assets.py` 已对 `water.coarse` 单独切到 minified JSON 写出；没有裁字段、没有改 geometry、没有改 feature id。
- 2026-04-13：已补 `tests/test_scenario_chunk_assets.py::test_water_coarse_is_minified_without_trimming_runtime_fields`，直接锁住 `water.coarse` 的字段集、feature 数和 minified 文本形态。
- 2026-04-13：已重跑 `python tools/build_scenario_chunk_assets.py --scenario-dir data/scenarios/tno_1962`，`water.coarse.r0c0.json` 从约 `55.45 MB` 降到约 `15.99 MB`。

## 本轮验证

- `python -m py_compile tools/scenario_chunk_assets.py tests/test_scenario_chunk_assets.py`
- `python -m unittest tests.test_scenario_chunk_assets -q`
- `python tools/build_scenario_chunk_assets.py --scenario-dir data/scenarios/tno_1962`
- `python -m unittest tests.test_scenario_chunk_assets tests.test_tno_water_geometries tests.test_startup_shell tests.test_scenario_resources_boundary_contract -q`
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962`

## 结论

- 这一轮不需要动 `water` 的字段语义和几何规则，只靠 minified JSON 写出就已经拿到大头收益。
- 下一轮如果还要继续压 `water.coarse`，就必须单独审 `startup readonly / water inspector / hierarchy / same-parent batch scope` 这些运行时职责，不能像 `political.coarse` 那样直接做字段收口。
