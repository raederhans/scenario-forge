# refactor_and_perf_2026-04-20

先读 `context.md`，再读 `plan.md`，然后看 `task.md` 和 `step0_perf_probe_skeleton.md`。

这轮计划已经修正为两条主线：

1. 文档与工作区收口，先把旧口径清干净。
2. 代码实现按 `public.js` facade、importer 迁移、perf baseline、低风险性能修复、CI gate 顺序推进。

本轮约束：

- `docs/archive/further_split/` 是 Batch 1-5 的历史真源。
- `js/core/scenario/scenario_renderer_bridge.js` 本轮继续保留内部 bridge。
- `runtime_hooks` 结构化改造后移；文档里统一目标名称为 `state.runtimeHooks.*`。
- perf 基线真源是 `docs/perf/baseline_2026-04-20.json`，Markdown 只做人工阅读。
