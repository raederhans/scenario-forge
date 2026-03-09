# 前 UI 已实现功能总账 B：渲染稳定化、边界修复、交互工具与编辑功能

## 1. 文档定位

这份文档总结前 UI 阶段已经稳定落地的渲染、交互和编辑能力，时间范围覆盖 2026-02-06 到 2026-02-26 的关键修复与执行切片。它不是“未来要做什么”的路线图，而是“现在已经做成了什么”的总账。

原始过程文档已移入归档：
- [qa/archive/pre_ui_plans](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans)
- [qa/archive/pre_ui_execution](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_execution)

## 2. 渲染架构演进中已经落地的部分

前 UI 阶段完成的不是一次单点修补，而是一次连续的渲染链路重构：

- 从静态 GeoJSON/固定线层，演进到以 TopoJSON 与 runtime mesh 为基础的渲染方式
- 从单一政治层，演进到 `primary + detail` 的组合政治层
- 从单一颜色映射，演进到 `feature -> country -> default` 的统一 resolved color 模型
- 从“缩放/点击即全量无差别处理”，演进到有 phase、有 LOD、有边界缓存的运行链路

## 3. 命中测试与点击一致性修复

已落地能力包括：

- spatial grid 命中索引替代 quadtree 主路径
- `strict land hit`，海洋不再吸附到国家
- snap 半径、bboxArea、bboxDistance、detail 优先级统一进入候选排序
- `getHitFromEvent()` 形成统一命中入口
- 组合政治层下，detail 与 primary 的 pick 行为更加一致

这使得点击上色、吸管取色、国家命中与 hover 行为不再各走一套逻辑。

## 4. 边界、海岸线与投影相关修复

这部分是前 UI 阶段最集中的稳定化收益来源之一。

### 已落地项

- 国界、海岸线、parent/province/local 边界从 source 分裂路径中拆开，改为更清晰的全局/分层 mesh 策略
- `country / coastline` 改为以 primary 全局 mesh 为主，减少接缝断裂
- `province / local` 保持 detail+primary 分源构建
- 缩放联动下的 alpha/width 公式升级，线层层级更加清晰
- coastline 新增 LOD 缓存与按缩放切换
- 投影异常 geometry 过滤进入统一链路，避免 wrap artifact 拉坏 fit、绘制和命中

### 直接解决的问题

- detail / primary 接缝处国界断裂
- 海岸线被误当成陆地边界
- projection wrap artifact 导致的白/蓝遮罩
- 低缩放下 subdivision 看似“消失”

## 5. 上下文层、Ocean、Coastline、Parent Border 已实现能力

### Context Layers

以下上下文层已真正进入可切换、可绘制、可调样式的状态：

- Physical
- Urban
- Rivers
- Special Zones

已落地能力包括：

- layer source coverage 诊断
- primary/detail 按层选源
- per-layer style config
- 绘制顺序明确进入 `drawCanvas()`

### Ocean

Ocean 相关已落地能力包括：

- 全画布 base fill，避免背景/遮罩污染视觉
- ocean mask quality 评估与自动 fallback
- `topology_ocean` 与 `sphere_minus_land` 两种 mask 模式
- 海洋视觉样式预设与后续临时 kill-switch
- 可配置 ocean fill color

### Parent Unit Borders

已落地能力包括：

- 运行时自动发现支持国家
- 按国家独立开关显示 parent border
- DE / GB 专项分组质量门槛
- parent border 缓存与绘制顺序整合
- 项目文件持久化

## 6. subdivision 可见性与工具绑定修复

在前 UI 阶段，地图“能不能看清细分地块”和“工具能不能真正切换”都已经被修正。

已落地项：

- subdivision 内边界在低缩放下的最小 alpha / width 提升
- low zoom declutter / width scale / internal boost 调整
- 工具按钮 class 兼容修复，Eraser / Eyedropper 不再失效
- D3 / topojson vendor 本地化，避免 CDN 阻断误伤运行判断

## 7. Special Zone 手工编辑器已实现能力

前 UI 阶段已经完成第一版 project-local special zone editor：

- `Start / Undo / Finish / Cancel / Delete` 全流程
- 地图双击完成绘制
- 绘制过程的 SVG 预览线/面/顶点
- `manualSpecialZones` 进入运行时 state
- `effectiveSpecialZones = topology + manual`
- 项目文件保存/加载 special zone 手工区域

这意味着 special zone 已经不只是后端静态数据层，而是运行时可编辑功能。

## 8. 性能止血型改动中已落地部分

在更大规模架构治理前，前 UI 阶段已经落地一批低风险止血措施。

### 已实现

- render phase：`idle | interacting | settling`
- 交互阶段降级绘制
  - 跳过部分内部边界
  - legend 只在 idle 刷新
  - hover 在非 idle 阶段降级
- `projectedBoundsById` 缓存
- 开发快速启动档位
  - `start_dev_fast.bat`
  - `detail_layer=off` 友好路径

这些改动没有改变数据 schema，但显著改善了缩放、平移和大图层下的交互稳定性。

## 9. 当前遗留限制

以下限制在前 UI 阶段仍然保留，应视为“已知现实”，不是遗漏：

- 大规模 detail / ADM2 仍然会对每帧几何遍历施压
- brush、HUD、utility popover 等更晚期 UI shell 能力不属于本阶段总结
- ocean advanced presets 已临时关闭，不代表海洋样式架构被移除
- hidden color map picking 在早期 roadmap 中已明确，但不是这一批总结的核心落地项
- 某些 parent grouping / hierarchy 质量仍依赖数据侧覆盖率与字段质量

## 10. 源文档映射表

| 主题 | 主要原始文档 |
| --- | --- |
| 诊断与渲染链问题定位 | [017_hybrid_renderer_diagnostic.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/017_hybrid_renderer_diagnostic.md), [020_canvas_color_pipeline_stability_fix.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/020_canvas_color_pipeline_stability_fix.md) |
| auto-fill / topology / picking 修复 | [018_autofill_color_fix.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/018_autofill_color_fix.md), [019_topology_pipeline_fix.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/019_topology_pipeline_fix.md), [024_hit_selection_consistency_and_country_pick_fix.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/024_hit_selection_consistency_and_country_pick_fix.md) |
| projection / border / coastline / source alignment | [021_projection_wrap_artifact_regression.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/021_projection_wrap_artifact_regression.md), [022_projection_wrap_artifact_fix_and_sidebar_ui_alignment.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/022_projection_wrap_artifact_fix_and_sidebar_ui_alignment.md), [023_subdivision_restore_and_hierarchical_border_strategy.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/023_subdivision_restore_and_hierarchical_border_strategy.md), [025_border_completeness_and_coastline_render_fix.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/025_border_completeness_and_coastline_render_fix.md) |
| ocean / context layers | [026_ocean_hit_and_ocean_style_upgrade.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/026_ocean_hit_and_ocean_style_upgrade.md), [027_ocean_mask_fallback_and_visual_delta.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/027_ocean_mask_fallback_and_visual_delta.md), [028_ocean_styles_temp_disabled_and_ocean_fill_color.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/028_ocean_styles_temp_disabled_and_ocean_fill_color.md), [QA-032_context_layers_toggle_and_styles_global_fix.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_execution/QA-032_context_layers_toggle_and_styles_global_fix.md) |
| subdivision 可见性、工具绑定、本地 vendor | [QA-029_subdivision_visibility_and_tool_binding_fix_2026-02-25.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_execution/QA-029_subdivision_visibility_and_tool_binding_fix_2026-02-25.md) |
| parent border 动态分组 | [QA-031_parent_border_country_toggle_de_gb_dynamic_2026-02-25.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_execution/QA-031_parent_border_country_toggle_de_gb_dynamic_2026-02-25.md) |
| Special Zone 编辑器 | [015_special_zones_design.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/015_special_zones_design.md), [QA-033_special_zone_manual_editor_project_local.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_execution/QA-033_special_zone_manual_editor_project_local.md) |
| 性能止血执行切片 | [011_performance_plan.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/011_performance_plan.md), [016_global_admin2_performance_roadmap.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_plans/016_global_admin2_performance_roadmap.md), [PERF_PLAN_A_PROGRESS_2026-02-25.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa/archive/pre_ui_execution/PERF_PLAN_A_PROGRESS_2026-02-25.md) |

## 11. 使用建议

如果你关心的是“前 UI 阶段地图渲染和交互已经做成了什么”，优先读这份文档；如果你要追具体问题的诊断过程，再回看 archive。历史截图、临时证据与自动生成报表已经从主阅读路径中移除。
