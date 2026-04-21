# 执行 checklist

## PR1 文档与工作区收口

- [x] 失效引用统一改到 `docs/archive/further_split/`
- [x] Step 0 文档口径改成“现有 metrics 适配层 + 少量补点”
- [x] Step 0 URL 参数统一改成 `default_scenario`
- [x] Step 4 标记为下一轮
- [x] `state.runtimeHooks.*` 作为后续命名目标写入文档

## PR2 `map_renderer/public.js`

- [x] 新建 `js/core/map_renderer/public.js`
- [x] 只导出当前 app/UI importer 真实需要的 surface
- [x] 新增 whitelist contract test

## PR3-PR5 importer 迁移

- [x] 批次 1：`js/main.js`、`js/bootstrap/deferred_detail_promotion.js`
- [x] 批次 2：`js/ui/toolbar.js`、`js/ui/shortcuts.js`、`js/ui/dev_workspace.js`、`js/ui/dev_workspace/district_editor_controller.js`、`js/ui/dev_workspace/scenario_tag_creator_controller.js`、`js/ui/dev_workspace/scenario_text_editors_controller.js`
- [x] 批次 3：`js/ui/sidebar.js`
- [x] `js/core/scenario/scenario_renderer_bridge.js` 保持内部 bridge

## PR6 Step 0 baseline

- [x] 新建 `js/core/perf_probe.js`
- [x] 复用 `state.bootMetrics`
- [x] 复用 `state.renderPerfMetrics`
- [x] 复用 `state.scenarioPerfMetrics`
- [x] 补 `globalThis.__bootMetrics`
- [x] 补 render 样本分布
- [x] 暴露 `globalThis.__mc_perf__.snapshot()`
- [x] 新建 `tools/perf/run_baseline.mjs`
- [x] 产出 `docs/perf/baseline_2026-04-20.json`
- [x] 产出 `docs/perf/baseline_2026-04-20.md`

## PR7 Step 1 strategic overlay triage

- [x] ready-gate contract 先过
- [x] 单独跑 `tests/e2e/strategic_overlay_editing.spec.js`
- [x] 记录定性结果（当前结果：7 条里 5 条失败，失败点集中在 strategic overlay 入口控件可见性/可用状态与 counter 交互链）

## PR8 Step 2 双 render 修复

- [x] `runPostScenarioApplyEffects()` 里把直接路径收敛成单次最终 render
- [x] direct scenario apply smoke 通过
- [x] `scenario_boundary_regression` 通过

## PR9 Step 3 color clone 优化

- [x] 测量 `refreshColorState()` 热路径 clone 成本
- [x] 用 plain object 增量同步替代整图 spread
- [x] palette / legend / hover smoke 通过

## PR10 Step 5 CI perf gate

- [x] 新增 PR workflow
- [x] gate 使用 `blank_base + tno_1962`
- [x] 对比 `docs/perf/baseline_2026-04-20.json`

## PR11 Step 6 条件触发

- [ ] 只有 baseline 证据支持时才做 spatial / secondary spatial gate
