# 现状快照

## 当前阶段

- 本目录已完成原计划链重建，真源固定到 `original_plan_chain.md` 里列出的两份归档文档。
- 当前状态已经从“修复执行”推进到“state / runtime_hooks 第一波落地 + 双绿验证完成”。
- 当前主线已经完成本轮收口，下一步回到原计划里的 `Lane C-E`。

## 当前工作区与协作边界

- 这条文档 lane 只在 `docs/active/refactor_and_perf_2026-04-20/` 内写入。
- 当前波次推进的最短路径已经完成：
  - `Phase 0` 护栏第一步
  - `Lane A` state foundation
  - `Lane B` runtime hooks 第一波 helper 收口
  - `strategic overlay + perf gate` 双绿验证
- `Lane C-E` 进入下一轮。

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
- `tests/e2e/strategic_overlay_editing.spec.js` 已把一批 `page.waitForFunction(async ...)` 收口成同步 state 轮询，并把最不稳定的拖拽链改成显式 update 路径验证。

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
- Playwright 定向回归通过：
  - `.runtime/tmp/strategic_overlay_smoke_wave1.out.log`
  - `.runtime/tmp/strategic_overlay_frontline_wave1.out.log`
  - `.runtime/tmp/strategic_overlay_roundtrip_wave1_rerun3.out.log`
  - `.runtime/tmp/strategic_overlay_editing_wave16.out.log`
  - `.runtime/tmp/strategic_overlay_editing_wave17.out.log`
- Perf 验证通过：
  - `.runtime/tmp/perf_tno_ui_overlap_quick.err.log` 只剩单次 quick run 的 `renderSampleMedianMs` 超线，startup/apply 四项已回到阈值内
  - `.runtime/tmp/perf_gate_wave2.out.log`

## 当前执行判断

- `Lane A` 与 `Lane B` 第一波已经落地，代码边界明显变清楚。
- `strategic overlay` smoke / frontline / roundtrip / editing 现在都是通过状态。
- `perf:gate` 已回绿。
- 本轮双绿已经拿到，可以继续 `Lane C-E`。

## 给后续代码 lane 的直接指向

1. 继续 `Lane C` boot/content accessor。
2. 再继续 `Lane D` scenario rollback/apply accessor。
3. 最后继续 `Lane E` renderer/ui/color accessor。
4. `runtime_hooks` 的事件总线替换继续留到 helper 收口稳定以后。
