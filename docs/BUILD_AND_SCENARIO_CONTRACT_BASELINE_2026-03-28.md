# Build And Scenario Contract Baseline

日期：2026-03-28

这份文档是本轮“验证链 + 契约边界优先”治理的只读基线。

约束：

- 本轮不做 `data/` 物理目录重排。
- 本轮不修改前端运行时代码。
- 本轮先把共享契约和治理表立住，再逐步替换入口脚本中的硬编码。

共享契约实现位置：

- `map_builder/contracts.py`

## 审计结论校正

以下结论当前仍然成立：

- `init_map_data.py` 仍是 Python 构建总控入口，承担过多编排职责。
- `tools/patch_tno_1962_bundle.py` 仍把场景业务和平台职责混在一起。
- `data/` 仍混放原始资产、手工规则、派生产物和发布物。

以下结论已部分过时，后续不再按旧说法执行：

- `README.md` 已补上 Python 测试入口和开发入口，不能再把“入口未显式记录”当作当前问题。
- `init_map_data.py` 和 `patch_tno_1962_bundle.py` 不是“完全没 stage”，而是“stage 已存在，但契约未独立”。

## 治理表一：资产分类基线

| 类别 | 含义 | 当前代表路径 | 当前 owner | Git 策略 |
| --- | --- | --- | --- | --- |
| `source` | 外部或基础输入，构建链读取但不应被派生脚本改写 | `data/ne_10m_admin_1_states_provinces.shp` `data/world_cities.geojson` | 原始数据导入链 | 入库 |
| `manual` | 人工维护规则或映射，必须保留人为编辑权威性 | `data/scenario-rules/*.manual.json` `data/scenarios/tno_1962/geo_name_overrides.manual.json` `data/palette-maps/*.manual.json` | 规则维护者 / 场景维护者 | 入库 |
| `derived` | 可重建中间产物或审计产物 | `data/europe_topology.na_v2.json` `data/palette-maps/*.audit.json` | `init_map_data.py` 或场景构建脚本 | 入库，但必须可重建 |
| `publish` | 运行时直接消费的正式产物 | `data/europe_topology.runtime_political_v1.json` `data/scenarios/*/manifest.json` `data/locales.json` | 构建/发布编排层 | 入库 |
| `runtime-cache` | 运行时或本地临时缓存，不是权威输入 | `.runtime/**` | 本地工具链 | 不入库 |

执行规则：

- 手工规则永远不被派生脚本静默覆盖。
- 可重建产物必须有明确 owner 和重建入口。
- 发布物允许依赖派生产物，但不能反向成为手工规则的来源。

## 治理表二：构建与场景阶段基线

| Stage | 当前 owner | 主要输入 | 主要输出 | 失败面 |
| --- | --- | --- | --- | --- |
| `primary_topology_bundle` | `init_map_data.py` | 原始 geodata、processor rules | `europe_topology.json` | 原始几何损坏、拓扑契约漂移 |
| `detail_topology` | `init_map_data.py` | `europe_topology.json`、detail patch 脚本 | `europe_topology.na_v2.json` | detail patch 失败、country gate 回退 |
| `runtime_political_topology` | `init_map_data.py` | primary/detail topology、override collections | `europe_topology.runtime_political_v1.json` | runtime id drift、shell coverage 回退 |
| `hierarchy_locales` | `init_map_data.py` | runtime topology、scenario roots、locale sync rules | `hierarchy.json` `geo_aliases.json` `locales.json` | 缺失 runtime id、翻译同步漂移 |
| `palette_assets` | `init_map_data.py` | topology、HOI4 family source roots、palette manual maps | `palettes/*.json` `palette-maps/*.json` | 缺失源数据、palette 覆盖率回退 |
| `world_cities` | `init_map_data.py` | city source datasets、runtime topology | `world_cities.geojson` `city_aliases.json` | 重复 city id、缺失 political link |
| `derived_hoi4_assets` | `init_map_data.py` | runtime topology、scenario rules、HOI4/TNO source roots | `data/scenarios/hoi4_*` `data/scenarios/tno_1962` | scenario builder 失败、scenario contract 漂移 |
| `countries` | `tools/patch_tno_1962_bundle.py` | scenario dir、runtime topology、manual rule packs | country state checkpoints | ownership/controller/core 漂移 |
| `runtime_topology` | `tools/patch_tno_1962_bundle.py` | countries checkpoints | runtime topology checkpoint bundle | water/special/runtime topology 不一致 |
| `geo_locale` | `tools/patch_tno_1962_bundle.py` | runtime checkpoints、manual geo overrides | geo locale checkpoints、startup bootstrap | manual override 不一致 |
| `write_bundle` | `tools/patch_tno_1962_bundle.py` | checkpoint bundle、publish scope、manual sync policy | 发布后的 scenario bundle | strict validation 失败、手工修改漂移 |

执行规则：

- 任何 stage 的输入输出都必须能从共享契约层解释，不能只靠脚本内部字符串约定。
- 主入口负责编排，不再新增新的文件契约常量。

## 治理表三：前端状态 ownership 基线

这张表当前只做只读基线，不伴随前端代码改动。

| 状态切片 / 边界 | 当前 owner | 允许写入口 | 当前高风险点 |
| --- | --- | --- | --- |
| 场景事务 | `js/core/scenario_manager.js` | `applyScenarioBundle` `resetToScenarioBaseline` `clearActiveScenario` `setScenarioViewMode` | 一次性重写大量 state 字段，爆炸半径最大 |
| 渲染请求 | `js/core/map_renderer.js` + `state.renderNowFn` 回调槽位 | 通过显式 render request / dirty path 触发 | 渲染请求、数据补载、UI 同步现在仍纠缠 |
| 交互分发 | `js/core/map_renderer.js` click/dblclick 分支 | 地图交互入口 | tool / paintMode / granularity / detail readiness 多重分支叠加 |
| UI 同步 | `js/ui/sidebar.js` `js/ui/toolbar.js` | 视图层回调和当前直接 state 写入 | 视图层仍会直接改业务状态 |

执行规则：

- 后续前端止血边界阶段，只允许围绕这四块做 ownership 收束。
- 本轮 Python/契约治理不直接改前端文件，只把 owner baseline 留档。

## 持续追踪表

| 问题编号 | 当前状态 | 权威文件 | 验收命令 | 下一步负责人 |
| --- | --- | --- | --- | --- |
| `TRACK-DATA-001` | `data/` 资产分类基线已冻结；`source/manual/derived/publish/runtime-cache` 只读规则已落档，但默认验证链还没有逐项覆盖全部资产类型。 | `docs/BUILD_AND_SCENARIO_CONTRACT_BASELINE_2026-03-28.md` `map_builder/contracts.py` | `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962` | 主线 A：契约/构建治理 |
| `TRACK-STAGE-001` | build/scenario stage owner 已明确；`init_map_data.py` 与 `tools/patch_tno_1962_bundle.py` 仍偏重，但新的 stage/file 契约不再允许继续散落。 | `map_builder/contracts.py` `init_map_data.py` `tools/patch_tno_1962_bundle.py` | `python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962` | 主线 A：Python 编排 seam |
| `TRACK-FRONTEND-001` | 前端高风险 ownership 已冻结成只读基线；场景事务和渲染边界已起步，但点击/双击/导入恢复仍未全部 funnel 化。 | `docs/BUILD_AND_SCENARIO_CONTRACT_BASELINE_2026-03-28.md` `js/core/scenario_dispatcher.js` `js/core/render_boundary.js` | `npm run test:e2e:smoke` | 主线 B：交互入口收口 |

## 当前共享契约落点

本轮新增共享契约，不改现有输出路径：

- 数据产物角色与分类：`map_builder/contracts.py`
- 构建 stage 基线：`map_builder/contracts.py`
- TNO checkpoint / publish scope 文件契约：`map_builder/contracts.py`

当前入口脚本已开始读取共享契约的地方：

- `init_map_data.py` 的 `write_data_manifest()`
- `tools/patch_tno_1962_bundle.py` 的 checkpoint / publish 文件清单
- `tools/check_scenario_contracts.py` 的 strict contract 必要文件清单

## 本轮完成定义

如果后续改动满足以下条件，就视为没有偏离本轮方向：

- 不新增新的“脚本内部独占文件清单”
- 不改 `data/` 现有路径语义
- 不把前端深拆混进 Python 契约层改造
- 任何新增 stage 或产物，都先落到共享契约模块，再接入入口脚本
