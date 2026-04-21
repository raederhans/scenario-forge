# 现状快照

## 当前阶段

- 本目录已完成原计划链重建，真源固定到 `original_plan_chain.md` 里列出的两份归档文档。
- 当前状态已经从“修复执行”继续推进到“state / runtime_hooks 第一波落地 + 回归验证”。
- 当前主线重新回到原计划里最值钱的入口：`state.js` owner/factory 收口与 `runtime_hooks.js` helper 收口。

## 当前工作区与协作边界

- 这条文档 lane 只在 `docs/active/refactor_and_perf_2026-04-20/` 内写入。
- 当前波次只推进最短路径：
  - `Phase 0` 护栏第一步
  - `Lane A` state foundation
  - `Lane B` runtime hooks 第一波 helper 收口
- `Lane C-E` 继续留到下一轮。

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
- `tests/e2e/support/playwright-app.js` 已把 project import 完成等待改成轮询版 helper，避开旧的 `waitForFunction` 连接句柄问题。
- `tests/e2e/strategic_overlay_roundtrip.spec.js` 已去掉 roundtrip 数据验证里多余的 render 依赖，避免测试自己卡死。

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
- Node 行为测试通过：
  - `tests/strategic_overlay_runtime_owner_behavior.test.mjs`
- Playwright 定向回归通过：
  - `.runtime/tmp/strategic_overlay_smoke_wave1.out.log`
  - `.runtime/tmp/strategic_overlay_frontline_wave1.out.log`
  - `.runtime/tmp/strategic_overlay_roundtrip_wave1_rerun3.out.log`
- 需要单独说明：
  - `.runtime/tmp/strategic_overlay_roundtrip_wave1.out.log` 与 `...rerun.out.log` 暴露了 test helper 自身的问题，现已修到 `rerun3` 通过。
  - `.runtime/tmp/strategic_overlay_editing_wave1.exit.txt = 143`，这轮没有拿到新的全量 green 日志，仍沿用上一轮已有证据。
  - `.runtime/tmp/perf_gate_wave1.err.log` 与 `...perf_gate_wave1_rerun.err.log` 显示 `perf:gate` 复跑失败，当前阻塞点集中在 `tno_1962` 的 startup / scenario apply 指标。

## 当前执行判断

- `Lane A` 与 `Lane B` 第一波已经落地，代码边界明显变清楚。
- `strategic overlay` smoke / frontline / roundtrip 现在都是通过状态。
- 当前新 blocker 是 `perf:gate` 回归。先把 perf 回到 gate 线以内，再继续 `Lane C-E` 更稳。

## 给后续代码 lane 的直接指向

1. 先调查 `perf:gate` 回归，重点看 `tno_1962.totalStartupMs`、`scenarioAppliedMs`、`applyScenarioBundleMs`、`refreshScenarioApplyMs`。
2. perf 回绿后，再继续：
   - `Lane C` boot/content accessor
   - `Lane D` scenario rollback/apply accessor
   - `Lane E` renderer/ui/color accessor
3. `runtime_hooks` 的事件总线替换继续留到 helper 收口稳定以后。
