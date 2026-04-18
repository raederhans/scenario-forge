# REFACTOR_ARCHITECTURE_SPLIT_2026-04-17

## 目标
- 提升可维护性与可读性
- 保持现有功能与性能稳定
- 用渐进式拆分替代大爆炸重写

## 当前结论
- 先恢复当前红测与首帧契约，再开始拆分
- 主线顺序：scenario 边界 -> UI 控制器 -> map_renderer helper -> main/state 收口
- 兼容策略：前两波保留 `map_renderer.js`、`scenario_resources.js`、`state.js` 的对外 export 形状，内部代码逐步下沉

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
- [ ] `toolbar.js` -> `transport_workbench_controller.js`
- [ ] `toolbar.js` -> `workspace_chrome_support_surface_controller.js`
- [ ] `toolbar.js` -> `export_workbench_controller.js`
- [ ] `toolbar.js` -> `appearance_controls_controller.js`
- [ ] `sidebar.js` -> `country_inspector_controller.js`
- [ ] `sidebar.js` -> `strategic_overlay_controller.js`
- [ ] `sidebar.js` -> `water_special_region_controller.js`
- [ ] `sidebar.js` -> `project_support_diagnostics_controller.js`
- [ ] `dev_workspace.js` -> `scenario_tag_creator_controller.js`
- [ ] `dev_workspace.js` -> `selection_ownership_controller.js`
- [ ] `dev_workspace.js` -> `scenario_text_editors_controller.js`
- [ ] `dev_workspace.js` -> `district_editor_controller.js`
- [ ] `dev_workspace.js` -> `dev_workspace_shell_builder.js`
- [ ] 新建 `js/ui/ui_surface_url_state.js`

### Wave 3: 渐进抽离 `map_renderer.js`
- [ ] 保持 `map_renderer.js` 为稳定 facade 与 render transaction owner
- [ ] 新建 `js/core/renderer/urban_city_policy.js`
- [ ] 新建 `js/core/renderer/strategic_overlay_helpers.js`
- [ ] 抽 strategic overlay draw helper：special zones / operational lines / operation graphics / unit counters
- [ ] 保持 render kernel、scenario refresh、hit canvas、zoom/init/bindEvents、facility info card 原位

### Wave 4: 收口入口与全局状态
- [ ] `main.js` 按启动生命周期拆为 boot 模块
- [ ] 新建 `bootstrap/startup_boot_overlay.js`
- [ ] 新建 `bootstrap/startup_data_pipeline.js`
- [ ] 新建 `bootstrap/startup_scenario_boot.js`
- [ ] 新建 `bootstrap/deferred_detail_promotion.js`
- [ ] `state.js` 拆为 `state_catalog.js`、`state_defaults.js`、保留兼容 facade
- [ ] 新建 `core/runtime_hooks.js`

## 验证矩阵

### 静态边界门
- [ ] `tests/test_frontend_render_boundary_contract.py`
- [ ] `tests/test_scenario_manager_boundary_contract.py`
- [ ] `tests/test_scenario_resources_boundary_contract.py`
- [ ] `tests/test_scenario_shell_boundary_contract.py`
- [ ] `tests/test_scenario_data_health_boundary_contract.py`
- [ ] `tests/test_scenario_rollback_boundary_contract.py`
- [ ] `tests/test_startup_shell.py`
- [ ] `tests/test_startup_bootstrap_assets.py`
- [ ] `tests/test_scenario_chunk_refresh_contracts.py`
- [ ] `tests/test_scenario_contracts.py`
- [ ] `tests/test_check_hoi4_scenario_bundle.py`
- [ ] `tests/test_scenario_bundle_platform.py`

### UI / dispatcher / render boundary 门
- [ ] `tests/test_ui_rework_plan01_foundation_contract.py`
- [ ] `tests/test_ui_rework_plan02_mainline_contract.py`
- [ ] `tests/test_ui_rework_plan03_support_transport_contract.py`
- [ ] `tests/e2e/ui_contract_foundation.spec.js`
- [ ] `tests/e2e/ui_rework_mainline_shell_sidebar.spec.js`
- [ ] `tests/e2e/ui_rework_support_transport_hardening.spec.js`
- [ ] `tests/e2e/interaction_funnel_contract.spec.js`
- [ ] `tests/e2e/dev_workspace_render_boundary.spec.js`
- [ ] `tests/e2e/shortcut_history_render_boundary.spec.js`
- [ ] `tests/e2e/scenario_controls_dispatcher_contract.spec.js`
- [ ] `tests/e2e/scenario_shell_overlay_contract.spec.js`

### startup / apply / recovery 门
- [ ] `tests/e2e/startup_bundle_recovery_contract.spec.js`
- [ ] `tests/e2e/tno_ready_state_contract.spec.js`
- [ ] `tests/e2e/tno_startup_visible_context_layers_contract.spec.js`
- [ ] `tests/e2e/scenario_apply_resilience.spec.js`
- [ ] `tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js`
- [ ] 新增：TNO fast startup 零 `pageerror` / 零 unexpected console error gate
- [ ] 新增：root 与 `/app/` 双入口 smoke

### 性能门
- [ ] `ops/browser-mcp/editor-performance-benchmark.py`
- [ ] `tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js`
- [ ] `tests/e2e/water_cache_strategy_regression.spec.js`
- [ ] 校验 `.runtime/output/perf/editor-performance-benchmark.json`
- [ ] 校验 `.runtime/reports/generated/editor-performance-water-cache-summary.json`

## 当前状态
- [x] 计划已留档
- [x] 开始实施

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
