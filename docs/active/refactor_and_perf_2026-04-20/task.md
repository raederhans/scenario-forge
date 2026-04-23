# 执行 checklist

## 文档重基线

- [x] 更新当前阶段为“文档重基线 + 验证入口收口 + 第二阶段拆分 lane”
- [x] 保留原计划真源指向 `docs/archive/further_split/original/file_split.md`
- [x] 保留原计划真源指向 `docs/archive/further_split/original/STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`
- [x] 记录仓库真实现状：`runtime_hooks.js` 删除完成
- [x] 记录仓库真实现状：`js/core/state/index.js`、`js/core/state/config.js`、`js/core/state/bus.js` 已落地
- [x] 记录仓库真实现状：`js/core/state_catalog.js` 已存在
- [x] 记录仓库真实现状：`js/core/state.js` 继续充当 compat facade
- [x] 记录仓库真实现状：`js/core/map_renderer/public.js` 继续承担 app / UI 入口

## 验证入口收口

- [x] 盘点 contract 入口清单
- [x] 盘点 node 入口清单
- [x] 盘点 targeted e2e 入口清单
- [x] 把主验证入口说明回填到 `context.md`
- [x] 把主验证入口说明回填到 `plan.md`

## 第二阶段拆分 lane

- [x] `interaction_funnel` 第一轮 owner 收口
- [x] `strategic_overlay_runtime_owner` 第一轮 owner 收口
- [x] `sidebar strategic overlay controller` 第一轮 controller 收口
- [x] `spatial_index_runtime_owner` 第一轮 owner 收口
- [x] `border_mesh_owner` 第一轮 owner 收口
- [x] `scenario presentation/runtime` 第一轮 runtime 收口

## 本轮验证

- [x] Python contract 100 tests 通过
- [x] Node 8 组脚本通过
- [x] `test:e2e:interaction-funnel` 通过
- [x] `test:e2e:strategic-overlay-smoke` 通过
- [x] `test:e2e:scenario-apply-concurrency` 通过
- [x] `test:e2e:startup-bundle-recovery-contract` 通过
- [x] `test:e2e:tno-ready-state-contract` 通过
- [x] `test:e2e:scenario-chunk-exact-after-settle-regression` 通过
- [x] `test:e2e:scenario-shell-overlay-contract` 通过
- [x] `perf:gate` 通过

## 下一轮建议

- [x] 记录下一轮最优先 lane：`strategic overlay unit counter`

## 阶段收尾

- [x] 复核 `plan.md`、`context.md`、`task.md` 三份文档口径一致
- [x] 复核下一阶段 lane 顺序与实际执行顺序一致
