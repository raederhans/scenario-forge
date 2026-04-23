# strategic_overlay_unit_counter_runtime_lane 推进计划

## 任务目标

- 把 `js/core/renderer/strategic_overlay_runtime_owner.js` 里的 unit counter 事务链继续下沉到独立 runtime domain/helper。
- 主 owner 只保留 orchestration、domain wiring、跨 lane 协调。
- 本轮覆盖 `preview`、`nation resolution`、`place/start/cancel/select/update/delete`。
- 保持行为不变，边界合同跟随真实 owner。

## 指导性材料

- 上游阶段计划：`docs/active/refactor_and_perf_2026-04-20/plan.md`
- 上游阶段上下文：`docs/active/refactor_and_perf_2026-04-20/context.md`
- 当前代码真相：`js/core/renderer/strategic_overlay_runtime_owner.js`
- 当前合同：`tests/test_map_renderer_strategic_overlay_runtime_owner_boundary_contract.py`

## 本轮最短路径

1. 盘点 unit counter 链的真实输入、事务边界、与 operational line 的共享点。
2. 新建 unit counter helper/runtime domain，owner 改成只做接线和少量编排。
3. 更新 boundary contract，让 facade、owner、unit counter domain/helper 的边界表达真实代码。
4. 做静态自检，整理建议验证命令；本轮不跑 live test。
