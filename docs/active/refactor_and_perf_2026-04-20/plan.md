# refactor_and_perf_2026-04-20 修正版执行计划

## Summary

- 先修计划口径，再开代码改动。
- 本轮主线分成两条：
  - API 冻结线：`js/core/map_renderer/public.js` → app/UI importer 迁移。
  - 性能线：修 Step 0 基线方案 → Step 1 / 2 / 3 / 5；Step 6 只在证据足够时开启。
- `runtime_hooks` Step 4 后移到下一轮；本轮只统一命名目标为 `state.runtimeHooks.*`。

## Execution order

1. 文档与工作区收口
   - 失效引用统一改到 `docs/archive/further_split/`
   - Step 0 URL 参数统一为 `default_scenario`
   - Step 0 方案改为“适配现有 metrics + 补缺口”
   - Step 4 标记为下一轮
2. `map_renderer/public.js`
   - 从 `js/core/map_renderer.js` 现有 export 分组里提取第一版 facade
   - 只覆盖当前真实 app/UI importer 需求
3. importer 迁移
   - 批次 1：`js/main.js`、`js/bootstrap/deferred_detail_promotion.js`
   - 批次 2：`js/ui/toolbar.js`、`js/ui/shortcuts.js`、`js/ui/dev_workspace.js` 及其直接家族
   - 批次 3：`js/ui/sidebar.js`
4. Step 0 baseline
   - 每场景 1 次 warm-up + 5 次 measured run
   - 每次 measured run 使用全新 browser context
   - cold baseline，显式锁 cache 参数
   - 先写 JSON，再写 Markdown
5. Step 1 strategic overlay triage
   - 先过 ready-gate contract
   - 再单独跑 `strategic_overlay_editing.spec.js`
6. Step 2 双 render 修复
   - 只处理真实测到的 `applyScenarioById()` 直接路径
7. Step 3 color clone 优化
   - 只改 `refreshColorState()` 热路径里的 clone 成本
   - 保持 plain object 模型
   - `autoFillMap()` 拷贝点留到下一轮
8. Step 5 CI perf gate
   - PR gate 只跑 `blank_base + tno_1962`
   - 对比 JSON baseline median
   - `hoi4_1939` 放到 nightly 或 manual benchmark
9. Step 6 条件触发
   - 只有 Step 0 / 5 证明仍是主要瓶颈时才开
   - 本轮只允许基于几何不变证据 gate 掉 spatial / secondary spatial 相关重建

## Success criteria

- `js/core/map_renderer/public.js` 存在并通过 whitelist contract test。
- app/UI importer 全部走 `map_renderer/public.js`。
- `docs/perf/baseline_2026-04-20.json` 和 `.md` 同步存在。
- `globalThis.__mc_perf__.snapshot()` 可以汇总 boot / render / scenario 三类指标。
- `scenario_renderer_bridge` 继续保留内部 lane。
- PR perf gate 能拿 `blank_base + tno_1962` 对比 baseline median。

## Progress snapshot（2026-04-21）

- 已完成：
  - Execution order 1, 2, 3, 4, 6, 7, 8
  - Success criteria 除 Step 1 triage 问题收口外均已满足
- 当前阻塞点：
  - Step 1 triage 显示 `strategic_overlay_editing.spec.js` 5/7 失败，需要单独决定下一轮修复路径
- 下一步：
  - 固化 triage 证据并拆分 strategic overlay 回归修复任务
