# refactor_and_perf_2026-04-20 推进计划

## 当前阶段

- 当前阶段：第二阶段 lane 第一轮已完成，当前进入收尾验收与下一轮指向确认。
- 原计划真源：`docs/archive/further_split/original/file_split.md` 与 `docs/archive/further_split/original/STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`。
- 当前目录承担执行编排，真源原意继续由上面两份归档文档维护。

## 仓库真实现状

- `js/core/runtime_hooks.js` 已删除。
- `js/core/state/index.js`、`js/core/state/config.js`、`js/core/state/bus.js` 已落地。
- `js/core/state_catalog.js` 已存在。
- `js/core/state.js` 继续充当 compat facade。
- `js/core/map_renderer/public.js` 继续承担 app / UI 入口。

## 当前主线

1. 文档重基线：已完成。
2. 验证入口收口：已完成，`package.json` 已补齐 node / e2e 具名入口。
3. 第二阶段拆分 lane：第一轮已完成。

## 本轮已完成的第二阶段 lane

1. `interaction_funnel`
2. `strategic_overlay_runtime_owner`
3. `sidebar strategic overlay controller`
4. `spatial_index_runtime_owner`
5. `border_mesh_owner`
6. `scenario presentation/runtime`

## 当前阶段验证结果

- Python contract：
  - `python -m unittest tests.test_refactor_and_perf_plan_contract tests.test_state_split_boundary_contract tests.test_state_write_guardrail_contract tests.test_scenario_resources_boundary_contract tests.test_scenario_presentation_runtime_boundary_contract tests.test_project_support_diagnostics_sidebar_boundary_contract tests.test_sidebar_split_boundary_contract tests.test_strategic_overlay_sidebar_boundary_contract tests.test_water_special_region_sidebar_boundary_contract tests.test_map_renderer_spatial_index_runtime_owner_boundary_contract tests.test_map_renderer_border_mesh_owner_boundary_contract tests.test_map_renderer_strategic_overlay_runtime_owner_boundary_contract tests.test_renderer_runtime_state_boundary_contract tests.test_toolbar_split_boundary_contract -q`
  - 结果：`Ran 100 tests ... OK`
- Node：
  - `test:node:scenario-lifecycle-runtime-behavior`
  - `test:node:scenario-runtime-state-behavior`
  - `test:node:startup-hydration-behavior`
  - `test:node:palette-runtime-bridge`
  - `test:node:renderer-runtime-state-behavior`
  - `test:node:border-mesh-owner-behavior`
  - `test:node:perf-probe-snapshot-behavior`
  - `test:node:renderer-splits`
  - 结果：全部通过
- Playwright：
  - `test:e2e:interaction-funnel`
  - `test:e2e:strategic-overlay-smoke`
  - `test:e2e:scenario-apply-concurrency`
  - `test:e2e:startup-bundle-recovery-contract`
  - `test:e2e:tno-ready-state-contract`
  - `test:e2e:scenario-chunk-exact-after-settle-regression`
  - `test:e2e:scenario-shell-overlay-contract`
  - 结果：全部通过
- Perf：
  - `npm run perf:gate`
  - 结果：`Perf gate passed against docs\perf\baseline_2026-04-20.json`

## 下一轮最短路径

- 优先继续拆 `strategic overlay` 的 `unit counter lane`
- UI 入口：`js/ui/sidebar/strategic_overlay_controller.js`
- runtime 入口：`js/core/renderer/strategic_overlay_runtime_owner.js`

## 当前阶段完成标准

- 文档三件套与仓库真实状态保持一致。
- 验证入口与当前 owner / facade 边界保持一致。
- 第二阶段第一轮拆分、验证、验收已经闭环。
