# 现状快照

## 当前阶段

- 当前文档波次已经完成重基线。
- 原计划真源继续指向 `docs/archive/further_split/original/file_split.md` 与 `docs/archive/further_split/original/STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`，当前目录里的 `original_plan_chain.md` 负责把这条真源链串起来。
- 当前执行主线已经切换成：文档重基线、验证入口收口、第二阶段拆分 lane。

## 仓库真实现状

- `js/core/runtime_hooks.js` 删除完成。
- `js/core/state/index.js` 已落地，负责 compat surface 与 hook/bus 组合。
- `js/core/state/config.js` 已落地，负责 hook 名称与事件名常量。
- `js/core/state/bus.js` 已落地，负责事件总线能力。
- `js/core/state_catalog.js` 已存在，`js/core/state.js` 继续作为 compat facade。
- `js/core/map_renderer/public.js` 继续只接 app / UI 入口。

## 验证入口收口

- 当前文档口径把验证入口收口到三类主入口：
  - contract
  - node
  - targeted e2e
- 当前阶段的验证记录继续跟随真实执行结果回填到这里。

## 第二阶段 lane

- `interaction_funnel`：`js/core/interaction_funnel.js`
- `strategic_overlay_runtime_owner`：`js/core/renderer/strategic_overlay_runtime_owner.js`
- `sidebar strategic overlay controller`：`js/ui/sidebar/strategic_overlay_controller.js`
- `spatial_index_runtime_owner`：`js/core/renderer/spatial_index_runtime_owner.js`
- `border_mesh_owner`：`js/core/renderer/border_mesh_owner.js`
- `scenario presentation/runtime`：`js/core/scenario/presentation_runtime.js`、`js/core/scenario_manager.js`、`js/core/scenario_resources.js`

## 当前记录

- 当前这轮已经完成：
  - 文档重基线
  - 验证入口收口
  - 第二阶段 6 条 lane 的第一轮拆分
- 本轮新增拆分结果：
  - `interaction_funnel` -> `import_apply_orchestration.js` / `wait_readiness.js` / `ui_sync.js`
  - `strategic_overlay_runtime_owner` -> `special_zones_runtime_domain.js` / `operation_graphics_runtime_domain.js`
  - `spatial_index_runtime_owner` -> `spatial_index_runtime_builders.js`
  - `border_mesh_owner` -> `border_mesh_source_selection.js` / `border_mesh_diagnostics.js`
  - `presentation_runtime` -> `presentation_hint_helpers.js` / `presentation_display_restore.js` / `presentation_ocean_fill_restore.js`
  - `strategic_overlay_controller` -> `unit_counter_modal_helper.js` / `unit_counter_render_helpers.js` / `unit_counter_catalog_helper.js`
- 本轮新增验证入口：
  - Node：`test:node:scenario-lifecycle-runtime-behavior`、`test:node:scenario-runtime-state-behavior`、`test:node:startup-hydration-behavior`、`test:node:palette-runtime-bridge`、`test:node:renderer-runtime-state-behavior`、`test:node:border-mesh-owner-behavior`、`test:node:perf-probe-snapshot-behavior`
  - E2E：`test:e2e:scenario-apply-concurrency`、`test:e2e:startup-bundle-recovery-contract`、`test:e2e:tno-ready-state-contract`、`test:e2e:scenario-chunk-exact-after-settle-regression`、`test:e2e:scenario-shell-overlay-contract`
- 本轮 fresh 证据：
  - Python contract 100 tests：通过
  - Node 8 组脚本：通过
  - `interaction_funnel`、`strategic_overlay_smoke`、`scenario_apply_concurrency`、`startup_bundle_recovery_contract`、`tno_ready_state_contract`、`scenario_chunk_exact_after_settle_regression`、`scenario_shell_overlay_contract`：通过
  - `perf:gate`：通过
- 当前已通过架构验收和 correctness review。
- 下一轮最短路径：继续拆 `strategic overlay unit counter lane`。
