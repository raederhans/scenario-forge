# 现状快照

## 当前工作区

- `js/bootstrap/startup_boot_overlay.js` 的旧 hotfix 已经脱离当前工作区，不再是前置阻塞。
- 当前需要忽略的本地运行态文件主要是 `.omx/*`。
- 开工前已经清掉越界生成的 `lessons learned.md` 修改和 `docs/archive/validation_audit_refactor_and_perf_2026-04-20/` 草稿目录。

## 历史计划真源

- Batch 1-5 历史材料在 `docs/archive/further_split/`。
- 旧的 active further_split 路径已经失效；后续引用统一改成 `docs/archive/further_split/`。

## 当前代码结构事实

- `js/core/map_renderer.js` 仍是外部 importer 最多的渲染核心。
- `js/core/map_renderer/public.js` 已新增并冻结第一版 app/UI facade。
- 当前直接 import `map_renderer.js` 的 12 个文件里，本轮迁移范围只覆盖 app/UI importer：
  - `js/main.js`
  - `js/bootstrap/deferred_detail_promotion.js`
  - `js/ui/toolbar.js`
  - `js/ui/shortcuts.js`
  - `js/ui/dev_workspace.js`
  - `js/ui/dev_workspace/district_editor_controller.js`
  - `js/ui/dev_workspace/scenario_tag_creator_controller.js`
  - `js/ui/dev_workspace/scenario_text_editors_controller.js`
  - `js/ui/sidebar.js`
- 本轮继续保留内部 bridge / core helper 直连：
  - `js/core/logic.js`
  - `js/core/scenario_ownership_editor.js`
  - `js/core/scenario/scenario_renderer_bridge.js`

## perf 真源

仓库已经有三条现成指标链：

- `state.bootMetrics`
- `state.renderPerfMetrics`
- `state.scenarioPerfMetrics`

当前还已有运行态暴露：

- `globalThis.__renderPerfMetrics`
- `globalThis.__scenarioPerfMetrics`

本轮 Step 0 采用“适配现有指标 + 补缺口”的方案：

- 复用现有 metrics schema。
- 只补 `globalThis.__bootMetrics` 暴露、render 样本分布、少量缺口 span。
- 统一对外暴露 `globalThis.__mc_perf__.snapshot()`。

## 基线场景

- `blank_base`：空白基线场景。
- `tno_1962`：默认启动路径，也是主要优化目标；`feature_count = 12798`。
- `hoi4_1939`：最大几何压力场景；`feature_count = 22502`。

## 产物约束

- raw 运行产物写入 `.runtime/output/perf/`。
- 基线真源写入 `docs/perf/baseline_2026-04-20.json`。
- 人工阅读版写入 `docs/perf/baseline_2026-04-20.md`。
- 本轮不改 README / CONTRIBUTING。

## 当前执行结果（2026-04-21）

- 文档收口完成：Step 0 口径、路径引用、Step 4 后移、`state.runtimeHooks.*` 目标命名已同步。
- facade 与 importer 迁移完成：
  - `js/core/map_renderer/public.js` 已落地。
  - app/UI 9 个 importer 已切到 `map_renderer/public.js`。
  - `scenario_renderer_bridge`、`logic.js`、`scenario_ownership_editor.js` 继续走内部 lane。
- Step 0 baseline 已产出：
  - `docs/perf/baseline_2026-04-20.json`
  - `docs/perf/baseline_2026-04-20.md`
- Step 5 gate 已落地：
  - `.github/workflows/perf-pr-gate.yml`
  - `npm run perf:gate` 本地跑通。
- Step 1 triage 当前结论：
  - `strategic_overlay_editing.spec.js` 7 条中 5 条失败。
  - 失败集中在 strategic overlay 入口控件可见性 / 可用状态与 counter 交互链。
