# 现状快照

## 当前阶段

- 本目录已完成原计划链重建，真源固定到 `original_plan_chain.md` 里列出的两份归档文档。
- 当前状态已从“triage 完成”推进到“修复执行已启动”。
- 本轮剩余主线已经收敛成两条：`strategic overlay` 稳定化、`perf gate` 收口。

## 当前工作区与协作边界

- 这条文档 lane 只在 `docs/active/refactor_and_perf_2026-04-20/` 内写入。
- 代码与测试会由其他代理继续推进；当前文档只负责给出真源、阶段状态和执行顺序。
- 本次更新没有运行长测试。

## 原计划链真源

- `docs/archive/further_split/original/file_split.md`
- `docs/archive/further_split/original/STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`
- 当前 active 目录中的重建入口：`original_plan_chain.md`

## 已落地基础

- `map_renderer/public.js` facade 已落地，app/UI importer 迁移已完成。
- `docs/perf/baseline_2026-04-20.json` 与 `docs/perf/baseline_2026-04-20.md` 已产出。
- `.github/workflows/perf-pr-gate.yml` 已收紧到与当前 baseline 环境一致，PR gate 场景改为 `tno_1962 + hoi4_1939`，`blank_base` 只保留 observation sample 角色。
- `strategic_overlay_editing.spec.js` 的 triage 已完成，入口状态机、counter 画布可见性契约和 placement cancel 恢复链都已修复。

## 当前这轮新增完成项

- 新增 `docs/active/refactor_and_perf_2026-04-20/original_plan_chain.md`，把原计划链重新留档。
- `js/ui/sidebar.js` 已把 `frontline-mode-active` 和右侧 tab 状态收口到同一条切换入口。
- `js/ui/sidebar/strategic_overlay_controller.js` 已把 counter modal 关闭后的焦点回退固定到 `#unitCounterDetailToggleBtn`。
- `js/core/renderer/strategic_overlay_runtime_owner.js` 已修复 placement cancel 回选旧 counter 时 `unitCounterEditor.active` 残留的问题。
- `tools/perf/run_baseline.mjs` 已增加：
  - `activeScenarioId === scenarioId` 硬断言
  - 关键子指标 gate
  - baseline / environment 一致性校验
- `tests/test_map_renderer_public_contract.py` 已升级为目录级 public facade 防直连合同。
- `tests/test_perf_gate_contract.py` 已新增并通过。

## 当前验证结果

- Python 合同测试通过：
  - `tests.test_strategic_overlay_sidebar_boundary_contract`
  - `tests.test_map_renderer_public_contract`
  - `tests.test_perf_gate_contract`
  - `tests.test_refactor_and_perf_plan_contract`
- Node 行为测试通过：
  - `tests/strategic_overlay_runtime_owner_behavior.test.mjs`
- Playwright 定向回归通过：
  - `tests/e2e/strategic_overlay_sidebar_entry_smoke.spec.js`
  - `tests/e2e/strategic_overlay_counter_canvas_smoke.spec.js`
  - `tests/e2e/strategic_overlay_smoke.spec.js`
  - `tests/e2e/strategic_overlay_editing.spec.js` 当前核心 7 条里，首次全量回归已验证 1-4、6-7；补丁后重跑覆盖了原先失败的第 5 条以及 6-7，并全部通过
- 真实 `npm run perf:gate` 已通过。

## 当前执行判断

- 当前最短主线已经从“继续做 triage”推进到“修复完成并通过定向验证”。
- `strategic overlay` 这轮主要问题已经收口，下一步可以回到更小步的后续重构或剩余 perf 观察。
- `perf gate` 已从合同级修正推进到真实命令通过，当前主要剩余事项是后续是否重生一版完全对齐新结构的 baseline JSON。

## 给后续代码 lane 的直接指向

1. 当前波次已经完成 `strategic overlay` 入口控件、counter 交互链和 perf gate 收口。
2. 下一步优先做更小范围的后续优化或剩余 perf 观察，不重新打开大范围 state / runtime_hooks 战线。
3. `runtime_hooks` 深改和全量 state slice 迁移继续留在下一阶段，不挤进当前修复波次。
