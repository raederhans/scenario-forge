# REFACTOR_ARCHITECTURE_SPLIT_2026-04-17

## 目标
- 提升可维护性与可读性
- 保持现有功能与性能稳定
- 用渐进式拆分替代大爆炸重写

## 当前结论
- 计划内拆分项已完成，当前进入最终 review 与收尾留档阶段
- 实际落地顺序与原宗旨一致：scenario 边界 -> UI 控制器 -> map_renderer helper -> main/state 收口
- donor 稳定 facade 仍保留在 `map_renderer.js`、`scenario_resources.js`、`state.js`，owner 逻辑已按波次下沉

## 实施计划与进度

### Wave 0: 恢复绿线与首帧合同
- [x] 修复 `tests/test_scenario_resources_boundary_contract.py` 当前红测
- [x] 将首帧等待与 post-frame prewarm 的合同写清并落到代码
- [x] 相关 boundary test 全绿

### Wave 1: 收口 scenario 边界
- [x] 新建 `js/core/scenario/` 内部目录
- [x] 抽 `shared.js`：`cacheBust`、`normalizeScenarioId`、timeout loader 等纯 helper
- [x] 抽第一版 `bundle_loader.js`：registry、audit、bundle metadata、import baseline 校验
- [x] 抽 `chunk_runtime.js`：chunk state、promotion、refresh、schedule
- [x] 抽 `startup_hydration.js`：startup bundle、hydrate、health gate
- [x] `scenario_resources.js` 保持资源 facade
- [x] `scenario_manager.js` 收成事务协调器，仅保留 apply/reset/clear/view-mode 与状态文案

### Wave 2: 按工作台拆 UI 控制器
- [x] `toolbar.js` -> `transport_workbench_controller.js`
- [x] `toolbar.js` -> `workspace_chrome_support_surface_controller.js`（guide / dock support surface / URL restore owner）
- [x] `toolbar.js` -> `export_workbench_controller.js`
- [x] `toolbar.js` -> `appearance_controls_controller.js`
- [x] `sidebar.js` -> `country_inspector_controller.js`
- [x] `sidebar.js` -> `strategic_overlay_controller.js`
- [x] `sidebar.js` -> `water_special_region_controller.js`
- [x] `sidebar.js` -> `project_support_diagnostics_controller.js`
- [x] `dev_workspace.js` -> `scenario_tag_creator_controller.js`
- [x] `dev_workspace.js` -> `selection_ownership_controller.js`
- [x] `dev_workspace.js` -> `scenario_text_editors_controller.js`
- [x] `dev_workspace.js` -> `district_editor_controller.js`
- [x] `dev_workspace.js` -> `dev_workspace_shell_builder.js`
- [x] 新建 `js/ui/ui_surface_url_state.js`（URL query helper owner；support surface restore 编排继续留在 `js/ui/toolbar/workspace_chrome_support_surface_controller.js`）

### Wave 3: 渐进抽离 `map_renderer.js`
- [x] 保持 `map_renderer.js` 为稳定 facade 与 render transaction owner
- [x] 新建 `js/core/renderer/urban_city_policy.js`
- [x] 新建 `js/core/renderer/strategic_overlay_helpers.js`
- [x] 抽 strategic overlay draw helper：special zones / operational lines / operation graphics / unit counters
- [x] 保持 render kernel、scenario refresh、hit canvas、zoom/init/bindEvents、facility info card 原位

### Wave 4: 收口入口与全局状态
- [x] `main.js` -> `js/bootstrap/startup_bootstrap_support.js`（默认场景解析 / startup bundle URL / startup diagnostics helper owner）
- [x] `main.js` -> `js/bootstrap/startup_boot_overlay.js`（boot overlay / readonly / boot metric owner）
- [x] `main.js` -> `js/bootstrap/startup_data_pipeline.js`
- [x] `main.js` -> `js/bootstrap/startup_scenario_boot.js`
- [x] `main.js` -> `js/bootstrap/deferred_detail_promotion.js`
- [x] `state.js` -> `js/core/state_defaults.js`（defaults / normalizer owner；`state.js` 保留 compat facade）
- [x] `state.js` -> `js/core/state_catalog.js`
- [x] 新建 `js/core/runtime_hooks.js`

## 验证矩阵

### 静态边界门
- 文件存在：`tests/test_frontend_render_boundary_contract.py`、`tests/test_scenario_manager_boundary_contract.py`、`tests/test_scenario_resources_boundary_contract.py`、`tests/test_scenario_shell_boundary_contract.py`、`tests/test_scenario_data_health_boundary_contract.py`、`tests/test_scenario_rollback_boundary_contract.py`、`tests/test_startup_shell.py`、`tests/test_startup_bootstrap_assets.py`、`tests/test_scenario_chunk_refresh_contracts.py`、`tests/test_scenario_contracts.py`、`tests/test_check_hoi4_scenario_bundle.py`、`tests/test_scenario_bundle_platform.py`
- 已跑通：2026-04-17 记录 80 条静态边界 / startup Python tests 全绿；2026-04-18 记录 183 条静态边界 / UI contract tests 全绿

### UI / dispatcher / render boundary 门
- 文件存在：`tests/test_ui_rework_plan01_foundation_contract.py`、`tests/test_ui_rework_plan02_mainline_contract.py`、`tests/test_ui_rework_plan03_support_transport_contract.py`、`tests/e2e/ui_contract_foundation.spec.js`、`tests/e2e/ui_rework_mainline_shell_sidebar.spec.js`、`tests/e2e/ui_rework_support_transport_hardening.spec.js`、`tests/e2e/interaction_funnel_contract.spec.js`、`tests/e2e/dev_workspace_render_boundary.spec.js`、`tests/e2e/shortcut_history_render_boundary.spec.js`、`tests/e2e/scenario_controls_dispatcher_contract.spec.js`、`tests/e2e/scenario_shell_overlay_contract.spec.js`
- 已跑通：并入 2026-04-18 的 183 条静态边界 / UI contract tests 记录；单项命令与产物还没单独补记

### startup / apply / recovery 门
- 文件存在：`tests/e2e/startup_bundle_recovery_contract.spec.js`、`tests/e2e/tno_ready_state_contract.spec.js`、`tests/e2e/tno_startup_visible_context_layers_contract.spec.js`、`tests/e2e/scenario_apply_resilience.spec.js`、`tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js`；TNO fast startup console gate 与 root / `/app/` 双入口 smoke 还没落独立 gate 文件
- 已跑通：当前文档还没有这组 e2e 的独立跑通记录

### 性能门
- 文件存在：`ops/browser-mcp/editor-performance-benchmark.py`、`tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js`、`tests/e2e/water_cache_strategy_regression.spec.js`；`.runtime/output/perf/editor-performance-benchmark.json` 已存在；`.runtime/reports/generated/editor-performance-water-cache-summary.json` 未见
- 已跑通：benchmark 产物只收到了首份 JSON，water cache summary 还没收齐，整组 gate 继续待验

## 当前状态
- [x] 计划已留档
- [x] 开始实施
- [x] 计划内拆分项已完成
- [ ] 最终 review 完成
- [ ] 归档迁移完成

## w1 场景模块拆分后 helper 归属规则
- `js/core/scenario/shared.js` 负责跨模块通用且与场景业务语义弱耦合的纯 helper（URL/cache-bust、id/language/core normalizer、timeout/resource loader、required/optional 校验）。
- `js/core/scenario/pure_helpers.js` 负责场景业务语义强相关、同时被 `scenario_manager.js` 与 `scenario_resources.js` 复用的纯函数（owner backfill、render/ocean normalizer、perf metric 记录协议）。
- `scenario_manager.js` 与 `scenario_resources.js` 保留 facade/wrapper 和交易编排，新增同类 helper 时先落 owner 文件，再由 facade import 复用。
- 涉及 topology identity 的扫描逻辑统一采用 `WeakMap` 缓存并配套回归断言，确保重复调用同一 topology 命中缓存路径。

## 进度记录
- 2026-04-17：
  - `js/core/scenario_post_apply_effects.js` 已修复“首帧 coarse prewarm 需要被调用方真正等待”的合同漂移。
  - async detail prewarm 现在会在成功后补一次 `scheduleScenarioChunkRefresh(...)`，并增加场景切换后的二次校验，避免旧任务污染当前 metric。
  - `js/core/scenario/shared.js` 已落地，先收口 `cacheBust`、scenario id/language/core map、timeout loader、required/optional resource 校验等共享 helper。
  - `scenario_manager.js` 与 `scenario_resources.js` 已切到 `shared.js`，完成第一批重复逻辑下沉。
  - `js/core/scenario/bundle_loader.js` 已落地，先收口 registry、display/meta、baseline compare、audit loader，并让 `scenario_resources.js` 继续做稳定 facade 转发。
  - `bundle_loader.js` 进一步接管了 runtime shell / contract / chunked-runtime 判定 helper，`scenario_manager.js` 与 `scenario_resources.js` 已开始复用同一组 bundle metadata helper。
  - 已验证：80 条静态边界与 startup 相关 Python tests 全绿。
  - `bundle_loader.js` 已继续接管 chunk 文件读取、chunk registry ensurer、bootstrap bundle 组装、startup bundle 组装、runtime topology 读取。
  - `bundle_loader.js` 新增 `createScenarioBundleAssembler(...)`，继续承接 fresh bundle 的纯读取与纯组装主链。
  - `scenario_resources.js` 继续保留 facade，对外 export 形状未变，内部通过 `createScenarioChunkRegistryEnsurer(...)` 装配运行态 registry 更新，并继续持有 startup cache state、perf metric、deferred metadata scheduling。
  - `tests/test_scenario_resources_boundary_contract.py` 已补 facade factory wiring、fresh bundle assembler 边界和 startup cache writeback 保护。
  - 新增 `js/core/scenario/chunk_runtime.js`，把 chunk runtime 的 state、selection、promotion、refresh/schedule 整体下沉成 `createScenarioChunkRuntimeController(...)`。
  - `scenario_resources.js` 继续保留 facade 和 hydrate 主交易，只通过 late-bound `ensureScenarioChunkRegistryLoaded(...)` 把 runtime controller 与 registry loader 接起来。
  - `tests/test_scenario_chunk_refresh_contracts.py` 与 `tests/test_scenario_resources_boundary_contract.py` 已同步迁到新的 owner 文件边界，chunk runtime 相关 contract 继续受保护。
  - 新增 `js/core/scenario/startup_hydration.js`，把 topology decode、geo locale patch、hydrate、health gate 下沉成 `createScenarioStartupHydrationController(...)`。
  - `scenario_resources.js` 继续保留 facade，只通过 late-bound `loadScenarioBundle` 把 startup hydration controller 与 bundle facade 接起来。
  - 新增 `tests/test_startup_hydration_boundary_contract.py`，把 hydrate 布尔合同、health gate retry、merged payload fallback、geo locale patch 与 blank defaults 都钉在新的 owner 文件上。
  - 新增 `js/core/scenario_apply_pipeline.js`，把 `prepareScenarioApplyState()` 与 staged state commit 从 `scenario_manager.js` 下沉出来。
  - `scenario_manager.js` 继续保留事务入口、single-flight、rollback/fatal recovery、post-apply 与用户可见入口。
  - `tests/test_scenario_manager_boundary_contract.py` 与 `tests/test_startup_shell.py` 已同步到新的 owner 边界，scenario apply pipeline contract 继续受保护。
  - 已修复一轮 review 暴露的 3 个收口问题：`scenario_manager.js` 的 import/wrapper 重名、`scenario_resources.js` 的 startup hydration 解构重名、`startup_hydration.js` 缺失 `areScenarioFeatureCollectionsEquivalent` 依赖。
  - 已补针对性边界断言，并重新验证 `node --check` 与 80 条静态边界 / startup tests 全绿。
  - Wave 2 已开始：新增 `js/ui/toolbar/export_failure_handler.js`，把 export error 分类与 toast 提示从 `toolbar.js` 下沉出去。
  - Wave 2 已开始：新增 `js/ui/toolbar/palette_library_panel.js`，把 palette library 的分组、筛选、source tab、toggle 和 panel DOM 更新下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/toolbar/scenario_guide_popover.js`，把 scenario guide 的 section/status 渲染、trigger 同步和 guide 自己的事件绑定下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/toolbar/special_zone_editor.js`，把 special zone 的 state 归一、面板渲染和 editor 自己的事件绑定下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/toolbar/export_workbench_controller.js`，把 export workbench 的状态归一、layer/text list 渲染、preview、bake/export 动作和 workbench 内部事件绑定下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/toolbar/transport_workbench_controller.js`，把 transport workbench 的状态归一、内部渲染、preview 联动、manifest/runtime 读取和面板内部事件绑定下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/toolbar/workspace_chrome_support_surface_controller.js`，把 guide / dock support surface / URL restore / 全局 dismiss 这层外壳协调从 `toolbar.js` 下沉成独立 controller。
  - 已修复一轮 review 暴露的 facade 回归：`syncPanelToggleButtons`、`toggleLeftPanel`、`toggleRightPanel`、`toggleDock`、`state.toggle*` 与 `state.syncDeveloperModeUiFn` 继续保留在 `toolbar.js`，support-surface split 只下沉 owner 逻辑，不动这些运行链 facade。
  - `toolbar.js` 继续保留 facade：仍负责 `state.updatePaletteSourceUIFn / state.updatePaletteLibraryUIFn / state.renderPaletteFn` 注册，以及 `renderPalette()` 与主初始化编排。
  - `toolbar.js` 继续保留 scenario guide 的 facade：仍负责跨面板仲裁、URL restore、shared dismiss 与总入口 `toggleScenarioGuidePopover / closeScenarioGuidePopover`。
  - `toolbar.js` 继续保留 special zone 的 facade：仍负责 popover 打开关闭、全局 dismiss 和跨 overlay 的互斥仲裁。
  - `toolbar.js` 继续保留 export workbench 的 facade：仍负责 overlay open/close、focus return、URL restore、以及与 dock/guide/transport 的互斥协调。
  - `toolbar.js` 继续保留 transport workbench 的 facade：仍负责 `state.openTransportWorkbenchFn / closeTransportWorkbenchFn / refreshTransportWorkbenchUiFn` 注册，以及 support surface 总体协调。
  - 新增 `tests/test_toolbar_split_boundary_contract.py` 的 transport / support-surface owner/facade 断言，并把 transport manifest/runtime、support surface URL 合同测试切到新的 owner 文件。
- 2026-04-18：
  - Wave 2 已继续推进：新增 `js/ui/toolbar/appearance_controls_controller.js`，先把 appearance shell 的 tab/filter、transport appearance、recent colors、parent border country list 从 `toolbar.js` 下沉成独立 controller。
  - Wave 2 已继续推进：把 `texture / dayNight` 的 state 归一、history、UI 渲染和事件绑定继续下沉到 `js/ui/toolbar/appearance_controls_controller.js`。
  - Wave 2 已继续推进：把 `city / urban / physical / rivers` 的 state 归一、UI 渲染和事件绑定继续下沉到 `js/ui/toolbar/appearance_controls_controller.js`。
  - Wave 2 已继续推进：把 `reference overlay` 的 UI 渲染和事件绑定继续下沉到 `js/ui/toolbar/appearance_controls_controller.js`。
  - Wave 2 已继续推进：新增 `js/ui/toolbar/ocean_lake_controls_controller.js`，把 ocean / lake 的 visual invalidation、bathymetry preset UI、lake history、render 和事件绑定从 `toolbar.js` 下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/sidebar/country_inspector_controller.js`，把 country inspector 的 explorer list、search、selection、detail card、active owner / color picker 事件闭环从 `sidebar.js` 下沉成独立 controller。
  - `toolbar.js` 继续保留 appearance facade：仍负责 `state.updateTransportAppearanceUIFn / updateRecentUI / updateParentBorderCountryListFn` 注册，以及 `updateToolbarInputsFn`、special zone popover 外壳和主初始化编排。
  - `toolbar.js` 继续保留 texture/dayNight facade：仍负责 `state.updateTextureUIFn` 注册，以及 `state.updateToolbarInputsFn` 里的总刷新编排。
  - `toolbar.js` 继续保留 city/urban/physical facade：仍负责 `renderSpecialZoneEditorUI` 这层 host wrapper、`state.updateSpecialZoneEditorUIFn` 注册，以及 special zone editor 和 appearance owner 的组合编排。
  - `toolbar.js` 继续保留 reference 刷新 facade：仍通过 `state.updateToolbarInputsFn` 触发 `renderReferenceOverlayUi()`，project import / startup / scenario 回填链保持原样。
  - `toolbar.js` 继续保留 water facade：仍负责 `refreshWorkspaceStatus()` 里的 coastal accent 刷新、`state.updateToolbarInputsFn` 里的 water 总刷新，以及 auto-fill 工作流里的 ocean color handoff。
  - `sidebar.js` 继续保留 country inspector facade：仍负责 `state.renderCountryListFn / refreshCountryListRowsFn / refreshCountryInspectorDetailFn` 注册，以及 preset tree、scenario actions、宿主级 layout / scroll 关闭链。
  - Wave 2 已继续推进：新增 `js/ui/sidebar/strategic_overlay_controller.js`，把 frontline overlay controls、strategic workspace chrome、operational line / operation graphic / unit counter 编辑器的 refresh、modal、event binding 和 perf 计数从 `sidebar.js` 下沉成独立 controller。
  - `sidebar.js` 继续保留 strategic overlay facade：仍负责 `setRightSidebarTab()` 里的 tab/url 外壳、`state.updateStrategicOverlayUIFn / getStrategicOverlayPerfCountersFn` 注册、startup URL restore 顺序、以及 `importProjectThroughFunnel(... hooks.invalidateFrontlineOverlayState)` 这条导入 hook。
  - 新增 `tests/test_strategic_overlay_sidebar_boundary_contract.py`，继续钉住 strategic overlay owner / facade、DOM surface、renderer/import funnel callback 合同。
  - Wave 2 已继续推进：新增 `js/ui/sidebar/water_special_region_controller.js`，把 water inspector 与 special region inspector 的过滤、详情、legend、color picker、batch action、visibility toggle 和本面板事件绑定从 `sidebar.js` 下沉成独立 controller。
  - `sidebar.js` 继续保留 water / special facade：仍负责 `state.renderWaterRegionListFn / updateWaterInteractionUIFn / renderSpecialRegionListFn / updateScenarioSpecialRegionUIFn / updateScenarioReliefOverlayUIFn` 注册，以及 shared layout 调度、scroll/wheel 关闭 picker、主初始化编排。
  - 新增 `tests/test_water_special_region_sidebar_boundary_contract.py`，继续钉住 water/special owner / facade、history snapshot、renderer/history/import funnel callback 合同。
  - Wave 2 已继续推进：新增 `js/ui/sidebar/project_support_diagnostics_controller.js`，把 scenario audit panel、legend editor、project import/export、debug mode 的渲染与事件绑定从 `sidebar.js` 下沉成独立 controller。
  - `sidebar.js` 继续保留 project support / diagnostics facade：仍负责 `state.updateLegendUI / renderScenarioAuditPanelFn` 注册、启动阶段首轮 `refreshLegendEditor() / renderScenarioAuditPanel()`、以及右侧栏宿主编排。
  - 新增 `tests/test_project_support_diagnostics_sidebar_boundary_contract.py`，继续钉住 project support owner / facade、LegendManager/FileManager/helper 注入、interaction_funnel / map_renderer callback 合同。
  - `tests/test_toolbar_split_boundary_contract.py` 与 `tests/test_transport_facility_interactions_contract.py` 已同步切到新的 appearance owner 文件，transport appearance 的 filtered count、primary color、facility info card visibility 合同继续受保护。
  - `tests/test_toolbar_split_boundary_contract.py` 已补 texture/dayNight owner 与 facade 断言，继续钉住 `state.updateTextureUIFn` 和 `state.updateToolbarInputsFn` 的合同。
  - `tests/test_toolbar_split_boundary_contract.py` 已补 city/urban/physical/rivers owner 与 facade 断言，继续钉住 `state.updateSpecialZoneEditorUIFn` 的 host contract。
  - `tests/test_toolbar_split_boundary_contract.py` 已补 reference overlay owner 与 facade 断言，继续钉住 `state.updateToolbarInputsFn` 的 reference 刷新链。
  - `tests/test_toolbar_split_boundary_contract.py` 已补 ocean/lake owner 与 facade 断言，继续钉住 water controller 的 history、refresh 和 auto-fill handoff 合同。
  - 新增 `tests/test_sidebar_split_boundary_contract.py`，继续钉住 country inspector owner 与 facade 合同。
  - Wave 2 已继续推进：新增 `js/ui/dev_workspace/scenario_tag_creator_controller.js`，把 Scenario Tag Creator 的表单 state、颜色面板、payload 校验、创建提交、局部 render 和局部事件绑定从 `dev_workspace.js` 下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/dev_workspace/selection_ownership_controller.js`，把 ownership panel、quick ownership controls、apply/reset/save owners 和对应输入事件从 `dev_workspace.js` 下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/dev_workspace/scenario_text_editors_controller.js`，把 country / capital / locale 三块编辑器的局部 render、保存链、search 交互和输入事件从 `dev_workspace.js` 下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/dev_workspace/district_editor_controller.js`，把 district editor 的局部 state、draft model、保存链、shared template 链、局部 render 和输入/按钮事件绑定从 `dev_workspace.js` 下沉成独立 controller。
  - Wave 2 已继续推进：新增 `js/ui/dev_workspace/dev_workspace_shell_builder.js`，把 dev workspace 的 panel / quickbar DOM 搭建和展开态 dock chrome 同步从 `dev_workspace.js` 下沉成独立宿主模块。
  - `dev_workspace.js` 继续保留 dev workspace facade：仍负责 `initDevWorkspace`、`renderWorkspace`、`state.updateDevWorkspaceUIFn / setDevWorkspaceExpandedFn` 注册、panel 宿主编排，以及共享 runtime 回写 helper。
  - Wave 4 已开始：新增 `js/core/state_defaults.js`，把 `state.js` 里的 palette 常量、style defaults、transport/export workbench normalizer 和纯配置 helper 下沉成独立模块。
  - `state.js` 继续保留运行态 singleton：仍负责 `state` 对象本体，并继续通过 re-export 维持 `PALETTE_THEMES`、`normalize*`、transport/export workbench helper 的兼容出口。
  - Wave 4 已开始：新增 `js/bootstrap/startup_bootstrap_support.js`，把 `main.js` 里的默认场景解析、startup bundle URL 组装、启动审计辅助、视图设置持久化和 startup diagnostics helper 下沉成独立 bootstrap 模块。
  - Wave 4 已开始：新增 `js/bootstrap/startup_boot_overlay.js`，把 `main.js` 里的 boot overlay copy、readonly banner、boot metrics、progress 动画和 continue/retry handler 收口成独立 startup overlay controller。
  - `main.js` 继续保留启动编排：仍负责 boot overlay、phase 进度、startup readonly、deferred promotion 和最终 `bootstrap()` 入口。
  - 已修复一轮 review 暴露的启动阻塞问题：`state.js` 现在重新显式 import `defaultZoom`，`state_defaults.js` 也继续导出它，`zoomTransform: defaultZoom` 的模块初始化链已恢复正常。
  - 已修复一轮 review 暴露的 overlay 收口问题：`startup_boot_overlay.js` 已恢复 `body.app-booting / body.app-startup-readonly` class 同步，checkpoint metric 重新基于 `bootMetrics.total.startedAt`，`main.js` 也已改成通过 controller 提供的 `getBootProgressWindow(...)` 取 phase window，不再直接读取 donor 内部常量。
  - 新增 `tests/test_dev_workspace_split_boundary_contract.py`，继续钉住 Scenario Tag Creator owner / facade、tag create endpoint、color popover dismiss handler 与 render boundary flush 合同。
  - 新增 `tests/test_dev_workspace_selection_ownership_boundary_contract.py`，继续钉住 ownership owner / facade、quick ownership bridge、owners save endpoint 与 donor render facade 合同。
  - 新增 `tests/test_dev_workspace_scenario_text_editors_boundary_contract.py`，继续钉住 text editors owner / facade、country/capital/locale 保存链、`getScenarioGeoLocaleEntry` 导出合同。
  - 新增 `tests/test_dev_workspace_district_editor_boundary_contract.py`，继续钉住 district editor owner / facade、district save/template apply 路径、mesh rebuild 与 manifest `district_groups_url` 回写合同。
  - 新增 `tests/test_dev_workspace_shell_builder_boundary_contract.py`，继续钉住 dev workspace shell builder 的 panel / quickbar / dock chrome owner，以及 `dev_workspace.js` 的宿主 facade 合同。
  - Wave 4 已补 `tests/test_state_split_boundary_contract.py`，继续钉住 `state_defaults.js` 的 pure helper owner，以及 `state.js` 的 compat re-export 和 singleton 合同。
  - Wave 4 已补 `tests/test_main_bootstrap_split_boundary_contract.py`，继续钉住 `startup_bootstrap_support.js` 的 startup helper owner，以及 `main.js` 的 boot overlay / bootstrap facade 合同。
  - Wave 4 已补 `tests/test_main_boot_overlay_split_boundary_contract.py`，继续钉住 `startup_boot_overlay.js` 的 overlay owner，以及 `main.js` 的 controller 装配和 facade 合同。
  - 当前已重新验证 183 条静态边界 / UI contract tests 全绿。
- 2026-04-19：
  - 补记 `js/core/scenario/shared.js` / `js/core/scenario/pure_helpers.js` 的 helper 归属规则，明确新增纯 helper 先落 owner 文件，再由 facade 复用。
  - 涉及 topology identity 的扫描逻辑继续统一采用 `WeakMap` 缓存，并配套回归断言守住重复调用合同。
  - `history_manager.js` 补上 strategic overlay 的 `operationalLines` capture / apply 合同。
  - 新增 `tests/test_history_manager_strategic_overlay_contract.py`。
  - 已验证命令：`python -m unittest tests.test_history_manager_strategic_overlay_contract tests.test_strategic_overlay_sidebar_boundary_contract tests.test_state_split_boundary_contract tests.test_main_bootstrap_split_boundary_contract tests.test_main_boot_overlay_split_boundary_contract`
  - Wave 3 第一刀已落地：新增 `js/core/renderer/urban_city_policy.js`，把 `getEffectiveCityCollection()`、`buildCityRevealPlan()`、`getUrbanFeatureIndex()`、`getCityUrbanRuntimeInfo()`、`getCityScenarioTag()`、`doesScenarioCountryHideCityPoints()` 与对应 scenario merge helper 下沉成 owner。
  - `js/core/map_renderer.js` 继续保留 facade 和 render transaction owner，本轮通过 wrapper 转发 `urban_city_policy` 的公开入口，保留 `getCityLayerRenderState()`、`drawCityPointsLayer()`、`drawLabelsPass()` 与 donor 侧 shared helper/cache。
  - 新增 `tests/test_map_renderer_urban_city_policy_boundary_contract.py`，继续钉住 `urban_city_policy` owner / `map_renderer` facade 合同。
  - 已验证命令：`python -m unittest tests.test_map_renderer_urban_city_policy_boundary_contract tests.test_frontend_render_boundary_contract`
  - Wave 3 第二刀已落地：新增 `js/core/renderer/strategic_overlay_helpers.js`，把 `renderSpecialZones()`、`renderOperationalLinesOverlay()`、`renderOperationGraphicsOverlay()`、`renderUnitCountersOverlay()` 与 `syncUnitCounterScalesDuringZoom()` 下沉成 leaf draw owner。
  - `js/core/map_renderer.js` 继续保留 render kernel、`render*IfNeeded()`、overlay signature cache、dirty/history transaction owner、frontline derived overlay 与导出 facade；本轮只把 strategic overlay 的 leaf draw wiring 收口到 owner。
  - 新增 `tests/test_map_renderer_strategic_overlay_helpers_boundary_contract.py`，继续钉住 strategic overlay helper owner / `map_renderer` facade、render 编排顺序、signature cache 仍留 donor 的合同。
  - 已验证命令：`python -m unittest tests.test_map_renderer_strategic_overlay_helpers_boundary_contract tests.test_map_renderer_urban_city_policy_boundary_contract tests.test_frontend_render_boundary_contract`
  - 已验证命令：`python -m unittest tests.test_strategic_overlay_sidebar_boundary_contract tests.test_history_manager_strategic_overlay_contract`
  - `node --check` 已通过：`js/core/map_renderer.js`、`js/core/renderer/strategic_overlay_helpers.js`
  - Wave 4 已继续推进：新增 `js/bootstrap/startup_data_pipeline.js`，把 `ensureBaseCityDataReady()`、`ensureFullLocalizationDataReady()`、`ensureActiveScenarioBundleHydrated()`、`ensureContextLayerDataReady()`、startup bundle 解析、startup base data 加载、startup state hydrate 和 primary collection decode 下沉成 startup data pipeline owner。
  - `main.js` 继续保留 boot overlay、render boundary、scenario apply、ready/readonly/detail promotion 编排；本轮只把 startup 数据装配和补水逻辑收口到 owner。
  - 新增 `tests/test_main_startup_data_pipeline_boundary_contract.py`，并更新 `tests/test_main_bootstrap_split_boundary_contract.py`，继续钉住 startup data pipeline owner / `main.js` facade 与 boot 编排保留合同。
  - 已验证命令：`python -m unittest tests.test_main_bootstrap_split_boundary_contract tests.test_main_boot_overlay_split_boundary_contract tests.test_main_startup_data_pipeline_boundary_contract -v`
  - 已验证命令：`python -m unittest tests.test_startup_shell tests.test_startup_bootstrap_assets -v`
  - `node --check` 已通过：`js/main.js`、`js/bootstrap/startup_data_pipeline.js`
  - `node --check` 已通过：`js/main.js`、`js/core/scenario_resources.js`、`js/core/interaction_funnel.js`、`js/core/scenario_manager.js`、`js/core/map_renderer.js`、`js/core/renderer/urban_city_policy.js`、`js/ui/toolbar.js`、`js/ui/toolbar/transport_workbench_controller.js`、`tests/e2e/support/playwright-app.js`
  - 为恢复启动链，本轮顺手修掉了 6 个既有阻塞点：`js/main.js` 语法错误、`js/core/scenario_resources.js` 重复声明、`js/core/interaction_funnel.js` 启动期循环依赖、`js/core/scenario_resources.js` 缺少 `applyScenarioPoliticalChunkPayload` 绑定、`js/core/scenario_manager.js` 缺少 `syncScenarioLocalizationState` import、`js/ui/toolbar.js` / `js/ui/toolbar/transport_workbench_controller.js` 的 export / 常量绑定缺口。
  - 浏览器直开验证已恢复：localhost app 可从 `8% -> 52% -> 100%` 进入 `Ready`，默认场景 `TNO 1962` 已加载；当前只剩 `favicon.ico` 404 和几条非阻塞 warning。
  - `tests/e2e/support/playwright-app.js` 已把 `waitForAppInteractive()` 改成基于真实 boot 完成信号判定，避免 `body.app-booting` 已移除但 overlay DOM 仍保留时的假超时。
  - 已验证命令：`node node_modules/@playwright/test/cli.js test tests/e2e/city_reveal_plan_regression.spec.js --config playwright.config.cjs --reporter=list --workers=1 --retries=0`，结果 `3 passed`。
  - `city_reveal_plan_regression` 这条 lane 现在显式允许跳过 deferred full scenario hydration warning；它继续严格校验启动可交互、`getEffectiveCityCollection()` / `buildCityRevealPlan()` 合同和 city reveal 预算，不把 post-ready full hydration 当成这条 lane 的阻断条件。
  - Wave 4 已继续推进：新增 `js/bootstrap/startup_scenario_boot.js`，把 startup scenario bundle metric 整形、scenario apply、startup bundle apply recovery 与 legacy bootstrap fallback 收口成独立 owner。
  - `main.js` 继续保留 boot overlay、render wiring、deferred UI bootstrap、warmup / ready / readonly / detail promotion 编排；本轮只把 startup scenario boot transaction 下沉到 owner。
  - 新增 `tests/test_main_startup_scenario_boot_boundary_contract.py`，并更新 `tests/test_main_bootstrap_split_boundary_contract.py`，继续钉住 startup scenario boot owner / `main.js` facade 与 ready-state 编排保留合同。
  - 已验证命令：`python -m unittest tests.test_main_bootstrap_split_boundary_contract tests.test_main_startup_scenario_boot_boundary_contract tests.test_main_boot_overlay_split_boundary_contract tests.test_main_startup_data_pipeline_boundary_contract tests.test_startup_shell tests.test_startup_bootstrap_assets -v`
  - `node --check` 已通过：`js/bootstrap/startup_scenario_boot.js`、`js/main.js`
  - Wave 4 已继续推进：新增 `js/bootstrap/deferred_detail_promotion.js`，把 detail topology promote、readonly unlock 重试、deferred detail idle promote 与相关内部句柄收口成独立 owner。
  - `main.js` 继续保留 finalizeReadyState、boot shell、render wiring、warmup / ready 编排；本轮只把 detail promotion transaction 和 startup readonly unlock transaction 下沉到 owner。
  - 新增 `tests/test_main_deferred_detail_promotion_boundary_contract.py`，并更新 `tests/test_main_bootstrap_split_boundary_contract.py`，继续钉住 deferred detail promotion owner / `main.js` ready-state facade 保留合同。
  - 已验证命令：`python -m unittest tests.test_main_bootstrap_split_boundary_contract tests.test_main_boot_overlay_split_boundary_contract tests.test_main_startup_data_pipeline_boundary_contract tests.test_main_startup_scenario_boot_boundary_contract tests.test_main_deferred_detail_promotion_boundary_contract tests.test_startup_shell tests.test_startup_bootstrap_assets -v`
  - `node --check` 已通过：`js/bootstrap/deferred_detail_promotion.js`、`js/main.js`
  - Wave 4 已继续推进：新增 `js/core/state_catalog.js`，把 releasable catalog / scenario audit 相关默认 state slice 和纯 factory 从 `state.js` 收口成独立 owner。
  - `state.js` 继续保留 singleton、本地初始化和 compat re-export；本轮只把 catalog 相关默认形状下沉到 owner。
  - 新增 `tests/test_state_catalog_boundary_contract.py`，并更新 `tests/test_state_split_boundary_contract.py`，继续钉住 state catalog owner / `state.js` singleton facade、`scenario_ui_sync.js` 与 `scenario_manager.js` 的 factory 接线合同。
  - 已验证命令：`python -m unittest tests.test_state_split_boundary_contract tests.test_state_catalog_boundary_contract tests.test_scenario_manager_boundary_contract -v`
  - `node --check` 已通过：`js/core/state_catalog.js`、`js/core/state.js`、`js/core/scenario_ui_sync.js`、`js/core/scenario_manager.js`
  - Wave 4 已继续推进：新增 `js/core/runtime_hooks.js`，把 UI / render / startup wiring 的 runtime hook 默认槽位从 `state.js` 收口成独立 owner。
  - `state.js` 继续保留 singleton、本地初始化和 compat re-export；本轮只把 hook 默认槽位和缺失的显式 hook shape 下沉到 owner。
  - 新增 `tests/test_runtime_hooks_boundary_contract.py`，并更新 `tests/test_state_split_boundary_contract.py`，继续钉住 runtime hooks owner / `state.js` singleton facade，以及 `main.js`、`toolbar.js`、`sidebar.js`、`dev_workspace.js` 的 hook 接线合同。
  - 已验证命令：`python -m unittest tests.test_state_split_boundary_contract tests.test_state_catalog_boundary_contract tests.test_runtime_hooks_boundary_contract tests.test_scenario_manager_boundary_contract -v`
  - `node --check` 已通过：`js/core/runtime_hooks.js`、`js/core/state.js`
  - Wave 2 已补完 URL query helper owner：新增 `js/ui/ui_surface_url_state.js`，把 support surface / scenario guide 的 URL 读写 helper 从 `toolbar.js` 收口成独立 owner。
  - `workspace_chrome_support_surface_controller.js` 继续保留 support surface restore 编排和 overlay 协调；本轮只把 URL query read/write helper 下沉到 owner。
  - 已更新 `tests/test_toolbar_split_boundary_contract.py` 与 `tests/test_ui_rework_plan02_mainline_contract.py`，继续钉住 `ui_surface_url_state.js` owner、`toolbar.js` wiring、support surface controller restore 合同。
  - 已验证命令：`python -m unittest tests.test_toolbar_split_boundary_contract tests.test_ui_rework_plan02_mainline_contract -v`
  - `node --check` 已通过：`js/ui/ui_surface_url_state.js`、`js/ui/toolbar.js`、`js/ui/toolbar/workspace_chrome_support_surface_controller.js`
  - 收尾审计已开始：Wave 0 ~ Wave 4 的计划内拆分项已全部落地，`map_renderer.js` donor 保留项也已按原计划显式确认。
  - 当前进入最终 review 阶段，待 review 收口后再执行归档迁移。
