# 前 UI 已实现功能总账 A：数据构建、加载链路、区域扩展与输入资产

## 1. 文档定位

这份文档是前 UI 阶段的数据与构建链路总结，覆盖 2026-01-25 到 2026-02-26 之间已经确定落地的能力。它替代了早期散落在 `qa_reports/001-028` 与 `qa/QA-029..033` 里的阅读入口，用于回答两个问题：

1. 数据侧到底已经实现了什么。
2. 现有运行链路和构建产物是怎样形成的。

原始过程文档已移入归档：
- [qa/archive/pre_ui_plans](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans)
- [qa/archive/pre_ui_execution](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_execution)

## 2. 已落地的数据资产与输入来源

前 UI 阶段已经把单一欧洲底图推进到了“多源拼接、分层构建、可持续扩展”的数据链路。已确认接入或建立过稳定接入方案的输入资产包括：

- Natural Earth：
  - `admin_0` / `admin_1`
  - land / ocean / rivers / urban / physical
- NUTS 系列欧洲细分数据
- 法国 arrondissement 数据
- 波兰 powiaty 数据
- 中国 ADM2 替换数据
- 俄罗斯城市级覆盖数据
- 特殊区域手工/程序化生成数据

这些输入已经不再只是“下载后手工试验”，而是被纳入 `init_map_data.py` 与 `map_builder/` 处理器链路，最终汇总为 TopoJSON、层级信息、别名和本地化输出。

## 3. 区域扩展成果

### 3.1 从西欧到欧亚大区

前 UI 阶段最重要的成果之一，是把地图范围从“西欧可用”推进到“欧洲 + 俄罗斯 + 中亚 + 东亚”的可运行状态。

已完成或已稳定接入的区域扩展包括：

- 俄罗斯与中亚扩展
  - 去除乌拉尔以西硬截断
  - 把 RU / KZ / UZ / TM / KG / TJ 纳入 admin-1 扩展链路
- 高加索与蒙古扩展
  - GE / AM / AZ / MN 加入扩展国家集合
- 东亚扩展
  - JP / KR / KP / TW 进入 admin-1 扩展路径
  - 中国单独走 ADM2 替换路径，避免与 admin-1 重叠
- 法国、波兰、乌克兰等高细节替换策略明确并在部分国家落地

### 3.2 重点国家/地区专项

- 法国：从 départements 进一步支持 arrondissement 级替换与历史边界方案。
- 波兰：确认 NUTS-3 已能直接支撑 powiat 级分组。
- 乌克兰：纳入混合替换与后续精细化路线图。
- 俄罗斯：补上 Moscow / Saint Petersburg / Volgograd / Arkhangelsk 四个城市级稳定覆盖。
- 波黑 / 科索沃：补齐 Balkan 数据缺口方案。

## 4. 层级、别名与本地化协同

前 UI 阶段不只是把 geometry 接进来，还建立了围绕运行时编辑所需的辅助数据链路。

### 4.1 hierarchy 分组能力

已落地能力：

- 法国可按 department 推导父级
- 波兰可按 voivodeship 推导父级
- 中国分组可行性审计完成，并形成外部 linkage / spatial join 路线
- 俄罗斯城市级覆盖写入 hierarchy
- DE / GB 等后续 parent border 分组依赖的数据基础已形成

### 4.2 alias 与 locale

已落地能力：

- `data/locales.json` 成为地理名称与 UI 文案的统一入口
- `tools/translate_manager.py` 能从拓扑结果继续生成/补齐翻译
- `geo alias -> stable key` 链路被纳入运行时
- 运行时 country list、preset、search、hierarchy 不再完全依赖硬编码英文名

## 5. 数据构建链与运行加载链

### 5.1 构建链

前 UI 阶段已经形成这条主路径：

1. 原始数据抓取 / 缓存
2. 裁剪、清洗、简化、替换
3. 政治层与上下文层汇总
4. TopoJSON 构建
5. hierarchy / locale / alias 生成或同步
6. 输出到 `data/` 供前端运行时加载

核心文件与模块：

- `init_map_data.py`
- `map_builder/config.py`
- `map_builder/geo/topology.py`
- `map_builder/processors/*`
- `tools/generate_hierarchy.py`
- `tools/translate_manager.py`

### 5.2 运行时加载链

已落地的运行时数据加载特征包括：

- 从单拓扑过渡到 `primary + detail` 的 bundle/composite 模式
- `detail_layer=off` / `detail_source=...` 等显式参数控制
- topology variant 显式选择，移除隐式 `.bak` 自动回退
- 背景层与政治层来源分离，避免 composite 模式下底图缺层
- hierarchy / locales / aliases 与 topology 一起进入运行时状态

## 6. 已解决的 pipeline 问题

前 UI 阶段已经实质解决或建立稳定修复路径的问题包括：

- bounding box 只筛选不裁剪导致的“全球杂质露出”
- 过度简化造成的拓扑破碎与边界撕裂
- `cntr_code` 缺失或推导脆弱导致的 country-level 配色失效
- geometry 顶层 `id` 为数字索引导致的运行时 lookup 不稳定
- 邻接图仅依赖 shared arcs 导致的 country neighbor graph 缺边
- auto-fill 与 topology / hierarchy / locale 不一致
- 俄罗斯城市 detail 缺失与命名不稳定
- China / France / Poland 等多源替换后的分组与标识协同问题

## 7. 当前保留的运行方式与限制

这些是前 UI 阶段总结后仍然保留的现实约束，不应被误读为“已经彻底解决”：

- 构建链仍然较重，`init_map_data.py` 与 `map_builder/` 仍承载大量流程责任
- 数据缓存与源站 schema 漂移仍有维护成本
- 不同国家/地区的 granularity 仍是混合档位，不是全局一致 ADM2
- 部分 hierarchy 能力依赖外部 linkage 或后处理，不是所有国家都天然具备
- 运行时的 composite/detail 策略已经可控，但仍需要在性能与细节之间取舍

## 8. 源文档映射表

| 主题 | 主要原始文档 |
| --- | --- |
| 初始审计与修复范围 | [001_audit_and_repair_plan.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/001_audit_and_repair_plan.md), [002_feature_spec.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/002_feature_spec.md), [003_topojson_migration_plan.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/003_topojson_migration_plan.md) |
| 法国/波兰/乌克兰/中国等替换策略 | [004_refinement_france.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/004_refinement_france.md), [005_holistic_replacement_strategy.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/005_holistic_replacement_strategy.md), [008_east_asia_plan.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/008_east_asia_plan.md), [010_russia_hybrid_plan.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/010_russia_hybrid_plan.md) |
| 区域扩展 | [006_russia_expansion_plan.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/006_russia_expansion_plan.md), [007_caucasus_mongolia_plan.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/007_caucasus_mongolia_plan.md), [014_south_asia_survey.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/014_south_asia_survey.md) |
| hierarchy / grouping | [009_hierarchy_plan.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/009_hierarchy_plan.md) |
| 构建架构与性能路线 | [011_performance_plan.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/011_performance_plan.md), [012_architecture_audit.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/012_architecture_audit.md), [013_refactoring_blueprint.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/013_refactoring_blueprint.md), [016_global_admin2_performance_roadmap.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/016_global_admin2_performance_roadmap.md) |
| auto-fill / topology / color pipeline 修复 | [018_autofill_color_fix.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/018_autofill_color_fix.md), [019_topology_pipeline_fix.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/019_topology_pipeline_fix.md), [020_canvas_color_pipeline_stability_fix.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/020_canvas_color_pipeline_stability_fix.md) |
| RU 城市覆盖执行 | [QA-030_ru_city_detail_repair_2026-02-25.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_execution/QA-030_ru_city_detail_repair_2026-02-25.md) |

## 9. 使用建议

如果你要快速判断“数据侧现在已经有什么”，先读这份文档；如果你要追具体实现背景，再顺着映射表回 archive。原始截图、临时证据与自动生成报表已经在文档清理阶段移出主阅读路径。
