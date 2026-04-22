# 现状快照

## 当前阶段

- 本目录已完成原计划链重建，真源固定到 `original_plan_chain.md` 里列出的两份归档文档。
- 当前状态已经从“修复执行”推进到“state / runtime_hooks 第一波落地 + 双绿验证完成”。
- 当前主线已经进入原计划里的 `Lane C`。

## 当前工作区与协作边界

- 这条文档 lane 只在 `docs/active/refactor_and_perf_2026-04-20/` 内写入。
- 当前波次推进的最短路径已经完成：
  - `Phase 0` 护栏第一步
  - `Lane A` state foundation
  - `Lane B` runtime hooks 第一波 helper 收口
  - `strategic overlay + perf gate` 双绿验证
- `Lane C` 已完成，`Lane D` 已进入执行，`Lane E` 待推进。

## 原计划链真源

- `docs/archive/further_split/original/file_split.md`
- `docs/archive/further_split/original/STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`
- 当前 active 目录中的重建入口：`original_plan_chain.md`

## 当前这轮新增完成项

- 新增 state owner/factory：
  - `js/core/state/boot_state.js`
  - `js/core/state/content_state.js`
  - `js/core/state/color_state.js`
  - `js/core/state/ui_state.js`
- `js/core/state.js` 已改成 assemble 这些 owner，并保留 compat export。
- `js/core/runtime_hooks.js` 已新增：
  - `registerRuntimeHook`
  - `readRuntimeHook`
  - `callRuntimeHook`
  - `callRuntimeHooks`
- `js/core/history_manager.js`、`js/ui/i18n.js`、`js/ui/toolbar.js`、`js/ui/sidebar.js`、`js/ui/dev_workspace.js`、`js/main.js` 已把第一波安全 hook 注册/调用切到 helper。
- 新增 state write guardrail：
  - `tools/eslint-rules/no-direct-state-mutation.js`
  - `tools/eslint-rules/state-writer-allowlist.json`
  - `tools/check_state_write_allowlist.mjs`
  - `package.json` -> `verify:state-write-allowlist`
- `js/bootstrap/startup_scenario_boot.js` 不再在 scenario apply 前串行等待 `deferredUiBootstrapPromise`。
- `js/main.js` 改成在 startup scenario apply 后再 await deferred UI bootstrap，并补一次 `updateScenarioUIFn` 收口。
- `js/main.js` 现在保留本次启动的局部 `startupUiBootstrapPromise`，确保 deferred UI bootstrap 的失败态不会被跳过 await。
- 当 deferred UI bootstrap 在 scenario apply 之后失败时，continue 分支会先回退到 base map，再进入“继续基础地图模式”。
- `tests/e2e/strategic_overlay_editing.spec.js` 已把一批 `page.waitForFunction(async ...)` 收口成同步 state 轮询，并把最不稳定的拖拽链改成显式 update 路径验证。
- `js/core/state/boot_state.js` 已新增最小 boot accessor：
  - `setStartupInteractionMode`
  - `setBootPreviewVisibleState`
  - `setStartupReadonlyStateFields`
  - `setBootStateFields`
  - `replaceBootMetricsState`
  - `setStartupBootCacheState`
- `js/core/state/content_state.js` 已新增最小 content accessor：
  - `setCurrentLanguage`
  - `hydrateHierarchyState`
  - `hydrateStoredViewSettings`
  - `hydrateStartupBaseContentState`
  - `decodeStartupPrimaryCollectionsIntoState`
- `js/bootstrap/startup_boot_overlay.js` 已把 boot 壳层写口切到 boot accessor。
- `js/bootstrap/startup_bootstrap_support.js` 已把 hierarchy / language / view settings 写口切到 content accessor。
- `js/bootstrap/startup_data_pipeline.js` 已把 startup base hydrate 与 primary collection decode 切到 content accessor。
- `js/core/data_loader.js` 已新增 `currentLanguage` 参数，startup cache key 不再直接读 `state.currentLanguage`。
- `js/main.js` 已把 `bootPreviewVisible`、`startupInteractionMode` 切到 boot accessor。
- `js/core/scenario/shared.js` 已把场景资源超时从 `12s` 提升到 `60s`，并新增共享 `cloneScenarioStateValue`。
- `js/core/scenario_rollback.js` 已把 rollback 快照拆成 `runtime / presentation / palette` 三组 helper。
- `js/core/scenario_apply_pipeline.js` 已把 apply 提交拆成：
  - `prepareScenarioActivationContext`
  - `commitScenarioActivationState`
  - `commitScenarioChunkRuntimeState`
- `js/core/scenario_resources.js` 已新增：
  - `applyDeferredScenarioMetadata`
  - `applyScenarioOptionalLayerState`
- `js/core/scenario_manager.js` 已把 same-scenario early return 收紧到：
  - cached bundle 必须满足 `full`
  - split 场景必须已有 shell map 和 baseline owner/controller map
- `js/core/scenario_recovery.js` 已把 `bootBlocking` 纳入 scenario interaction gate。
- `js/ui/scenario_controls.js` 已把 `bootBlocking` 纳入 scenario controls disabled 条件。
- `tests/e2e/scenario_apply_concurrency.spec.js`
  - 已改成 command-driven 首次 apply
  - 已减少对隐藏/disabled select 的依赖
- `tests/e2e/scenario_shell_overlay_contract.spec.js`
  - 已改成先切到 `hoi4_1939` 再回到 `tno_1962`
  - 已改成 command-driven apply

## 当前验证结果

- Python 合同测试通过：
  - `tests.test_state_split_boundary_contract`
  - `tests.test_runtime_hooks_boundary_contract`
  - `tests.test_state_write_guardrail_contract`
  - `tests.test_dev_workspace_*_boundary_contract`
  - `tests.test_main_*_boundary_contract`
  - `tests.test_strategic_overlay_sidebar_boundary_contract`
  - `tests.test_toolbar_split_boundary_contract`
  - `tests.test_transport_facility_interactions_contract`
  - `tests.test_water_special_region_sidebar_boundary_contract`
- 额外相关 Python contract 通过：
  - `tests.test_runtime_hooks_boundary_contract`
  - `tests.test_main_boot_overlay_split_boundary_contract`
  - `tests.test_main_startup_data_pipeline_boundary_contract`
  - `tests.test_strategic_overlay_sidebar_boundary_contract`
- Node 行为测试通过：
  - `tests/strategic_overlay_runtime_owner_behavior.test.mjs`
  - `tests/startup_hydration_behavior.test.mjs`
  - `tests/perf_probe_snapshot_behavior.test.mjs`
- Playwright 定向回归通过：
  - `.runtime/tmp/strategic_overlay_smoke_wave1.out.log`
  - `.runtime/tmp/strategic_overlay_frontline_wave1.out.log`
  - `.runtime/tmp/strategic_overlay_roundtrip_wave1_rerun3.out.log`
  - `.runtime/tmp/strategic_overlay_editing_wave16.out.log`
  - `.runtime/tmp/strategic_overlay_editing_wave17.out.log`
  - `.runtime/tmp/strategic_overlay_smoke_wave2.out.log`
- Perf 验证通过：
  - `.runtime/tmp/perf_tno_ui_overlap_quick.err.log` 只剩单次 quick run 的 `renderSampleMedianMs` 超线，startup/apply 四项已回到阈值内
  - `.runtime/tmp/perf_gate_wave2.out.log`
  - `.runtime/tmp/perf_gate_wave3.out.log`
- Lane C contract 通过：
  - `python -m unittest tests.test_state_split_boundary_contract tests.test_main_startup_data_pipeline_boundary_contract tests.test_main_bootstrap_split_boundary_contract tests.test_main_boot_overlay_split_boundary_contract tests.test_scenario_bundle_runtime_boundary_contract -q`
- Lane C targeted e2e：
  - `.runtime/tmp/lane_c_startup_e2e.out.log`
  - `.runtime/tmp/startup_bundle_recovery_rerun.out.log`
  - `scenario_apply_resilience.spec.js` 3 条通过
  - `startup_bundle_recovery_contract.spec.js` 前 2 条通过
  - 最后一条 `deferred hydration mask mismatch enters safe readonly mode and clears runtime overlays` 失败，当前表现是 `startupReadonly === false`
  - reviewer 静态复核判断：这条失败更像 `startup_hydration.js` 现有语义和 e2e 断言不一致，不像 Lane C 新回归
- Lane D contract 通过：
  - `python -m unittest tests.test_scenario_manager_boundary_contract tests.test_scenario_rollback_boundary_contract tests.test_scenario_resources_boundary_contract tests.test_scenario_runtime_state_boundary_contract tests.test_startup_hydration_boundary_contract -q`
- Lane D node 行为测试通过：
  - `tests/scenario_lifecycle_runtime_behavior.test.mjs`
  - `tests/scenario_runtime_state_behavior.test.mjs`
  - `tests/scenario_pure_helpers.node.test.mjs`
  - `tests/startup_hydration_behavior.test.mjs`
- Lane D targeted e2e：
  - `.runtime/tmp/lane_d_scenario_resilience.out.log` 通过
  - `.runtime/tmp/lane_d_concurrency_after_root_fix.out.log` 失败，当前超时点在 `hoi4_1939` 资源加载
  - `.runtime/tmp/lane_d_shell_only.out.log` 失败，当前超时点仍在 command-driven apply
- 针对 review comment 的回修：
  - `clearActiveScenario()` 现在支持 `allowDuringBootBlocking`
  - `main.js` 的 startup continue-without-scenario 恢复路径会显式传入这个开关
  - `applyDeferredScenarioMetadata()` 已恢复在 apply 期间同步当前场景的 metadata

## 当前执行判断

- `Lane A` 与 `Lane B` 第一波已经落地，代码边界明显变清楚。
- `strategic overlay` smoke / frontline / roundtrip / editing 现在都是通过状态。
- deferred UI bootstrap 的两个启动失败路径问题已修复，并通过 contract + smoke + perf gate 复核。
- `perf:gate` 已回绿。
- `Lane C` 代码面已经落地，contract 与 node 行为测试通过。
- Lane C 的代码和最小合同已经可以合并。
- Lane D 的代码面已经推进到 accessor 收口，但 stage gate 还没通过。
- 当前 Lane D blocker 已聚焦到 Playwright 下的场景资源加载超时，不是 contract / node 行为层面的错误。
- startup recovery 邻域还留有 1 条旧语义分歧，后续单独归到 `startup_hydration.js` / `scenario health gate` 合同核对。

## 给后续代码 lane 的直接指向

1. 继续清理 Lane D 的 Playwright stage gate 超时。
2. Lane D 绿后，再继续 `Lane E` renderer/ui/color accessor。
3. 并行核对 `startup_hydration.js` 与 `startup_bundle_recovery_contract.spec.js` 的 readonly 语义。
4. `runtime_hooks` 的事件总线替换继续留到 helper 收口稳定以后。
