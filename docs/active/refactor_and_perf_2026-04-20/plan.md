# refactor_and_perf_2026-04-20 修复执行计划

## 当前阶段

- 当前阶段：修复执行。
- 原计划链真源：见 `original_plan_chain.md`。
- 当前任务目标：在不扩 scope 的前提下，完成 `strategic overlay` 稳定化与 `perf gate` 收口。

## 已完成前置

1. 文档与工作区收口已完成。
2. `map_renderer/public.js` facade 与 app/UI importer 迁移已完成。
3. Step 0 perf baseline 已完成。
4. Step 1 triage 已完成，问题面已经定位。
5. Step 2、Step 3、Step 5 的首版实现已落地。

## 当前主线

### 主线 A：strategic overlay 稳定化

1. 修入口控件可见性与 enabled 状态。已完成。
2. 修 counter 交互链。已完成。
3. 修 strategic-only roundtrip / 导入导出相关断言漂移。已完成。
4. 用定向回归证据确认编辑链恢复。已完成。

### 主线 B：perf gate 收口

1. 保持 `docs/perf/baseline_2026-04-20.json` 作为机器真源。
2. 确认 perf 脚本、PR workflow、场景集合仍与 baseline 一致。
3. 调整 PR gate 为 `tno_1962 + hoi4_1939`。
4. 将 `blank_base` 下调为 observation sample。
5. 只在证据明确时再开启更深的 perf 优化支线。

## 执行顺序

1. 已完成 `strategic overlay` 入口控件状态修复。
2. 已完成 counter 交互与 roundtrip 链修复。
3. 已完成定向回归，确认 strategic overlay 恢复。
4. 已完成 perf baseline、脚本、workflow 口径复核，并通过真实 `perf:gate`。
5. 下一步只在 gate 证据显示新瓶颈时，再决定是否追加 perf 修补。

## 暂缓事项

1. `state.js` 全量 Phase 0-4 迁移。
2. `runtime_hooks.js` 到事件总线的完整替换。
3. 更大范围的 renderer / scenario / UI 深层架构切分。

## 完成标准

- `strategic overlay` 入口控件、counter 交互、roundtrip 主链恢复。
- perf baseline 真源、PR gate、场景口径保持一致，并已通过真实 gate。
- 当前 active 文档始终能反映真实阶段：当前是修复执行，不再停留在 triage。
