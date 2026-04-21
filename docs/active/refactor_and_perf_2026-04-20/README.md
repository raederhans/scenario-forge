# refactor_and_perf_2026-04-20

当前阶段已经进入修复执行。

先读 `original_plan_chain.md`，再读 `context.md`、`plan.md`、`task.md`。`step0_perf_probe_skeleton.md` 继续作为 perf 基线实现附录。

当前剩余主线只有两条：

1. `strategic overlay` 稳定化
2. `perf gate` 收口

本目录约束：

- 原计划链真源固定为 `docs/archive/further_split/original/file_split.md` 与 `docs/archive/further_split/original/STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`
- 当前 active 文档负责把阶段从 triage 后推进到修复执行
- Step 4 后移到下一轮，当前只保留 `state.runtimeHooks.*` 命名目标
- `runtime_hooks` 深改、全量 state slice 迁移、更大范围架构切分留到下一阶段
