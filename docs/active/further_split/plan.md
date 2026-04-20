# further_split execution plan

## 目标
- 在 `docs/active/further_split/` 建立标准留档基线。
- 把 `STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md` 和 `file_split.md` 改到和当前代码、当前 approved plan 一致。
- 落地 Batch 1：把 `scenario_manager.js` / `scenario_resources.js` 的 presentation 重复事务收成共享 owner。
- 落地 Batch 2：把 scenario lifecycle reset / clear 事务收进独立 owner，让 `scenario_manager.js` 继续保留 facade 和事务协调。
- 明确下一步顺序：`scenario -> runtime_hooks/state ownership -> renderer API`。
- 验证矩阵统一成：结构合同 / 静态检查 / 定向 smoke / 日期和证据路径。

## 范围
- `docs/active/further_split/`
- `js/core/scenario_manager.js`
- `js/core/scenario_resources.js`
- `js/core/scenario/presentation_runtime.js`
- `js/core/scenario/lifecycle_runtime.js`
- `js/core/scenario_apply_pipeline.js`
- `tests/e2e/scenario_blank_exit.spec.js`
- `tests/e2e/scenario_shell_overlay_contract.spec.js`
- 命中的 boundary contract 测试

## 执行步骤
- [x] 读取当前代码和合同测试，确认 `state_catalog.js`、`runtime_hooks.js`、scenario owners、renderer owners 已落地。
- [x] 提炼已被代码证实的基线事实和过时点。
- [x] 新建 `plan.md`、`context.md`、`task.md`。
- [x] 重写 `STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`，保留文件名并改成当前基线说明。
- [x] 重写 `file_split.md`，改成当前 further split baseline。
- [x] 新增 `js/core/scenario/presentation_runtime.js`。
- [x] 让 `scenario_manager.js` 改成只做 presentation runtime 编排和调用。
- [x] 让 `scenario_resources.js` 只复用 stateless parser。
- [x] 补齐 3 组 boundary contract。
- [x] 新增 `js/core/scenario/lifecycle_runtime.js`。
- [x] 让 `scenario_manager.js` 的 reset / clear 降成 facade wrapper。
- [x] 让 `scenario_apply_pipeline.js` 继续只消费 lifecycle helper，不再污染 startup runtime baseline。
- [x] 补齐 lifecycle boundary contract。
- [x] 修正 shell overlay 定向合同，使它对齐当前 codebase 的 helper owner surface。
- [x] 新增 `js/core/scenario/bundle_runtime.js`。
- [x] 让 `scenario_resources.js` 的 `loadScenarioBundle` 主交易改成 bundle/cache owner 接线。
- [x] 补齐 bundle/cache owner boundary contract。
- [x] 新增 `js/core/state/history_state.js`。
- [x] 新增 `js/core/state/dev_state.js`。
- [x] 让 `state.js` 通过 history/dev owner 注入默认 shape。
- [x] 让 `runtime_hooks.js` 按内部分类收口但保持公开 surface 不变。
- [x] 新增 `js/core/state/strategic_overlay_state.js`。
- [x] 统一 `state.js` / `interaction_funnel.js` / `map_renderer.js` 的 strategic overlay 默认形状。
- [x] 补齐 state owner / strategic overlay owner 合同与行为测试。
- [x] 新增 `js/core/state/scenario_runtime_state.js`。
- [x] 统一 `state.js` / `chunk_runtime.js` / `lifecycle_runtime.js` / `scenario_rollback.js` / `scenario_data_health.js` 的 scenario runtime 默认形状。
- [x] 补齐 scenario runtime owner 合同与定向 smoke。
- [x] 跑定向验证并回填状态。
- [x] 新增 `js/core/state/renderer_runtime_state.js`。
- [x] 新增 `js/core/state/border_cache_state.js`。
- [x] 新增 `js/core/state/spatial_index_state.js`。
- [x] 让 `state.js` 通过 renderer/border/spatial owner 注入默认 shape。
- [x] 让 `map_renderer.js` / `sidebar.js` / `spatial_index_runtime_owner.js` 复用 renderer/spatial shared factory。
- [x] 清掉 `chunk_runtime.js` 里 `runtimeChunkLoadState` 的第二份完整默认 shape。
- [x] 补齐 renderer runtime / border cache / spatial index 合同与行为测试。
- [x] 跑 Batch 4 renderer runtime 定向验证并回填状态。
- [x] 收紧 Batch 5 的生产 consumer import 面，去掉命中的 `import * as mapRenderer`。
- [x] 新增 `js/core/scenario/scenario_renderer_bridge.js`，把 scenario/startup 刷新链从 `map_renderer.js` 的公开面里逻辑分层出去。
- [x] 给 `map_renderer.js` 的 export block 补上 facade 分组注释。
- [x] 补齐 Batch 5 的 renderer facade / scenario bridge 合同测试。
- [x] 跑 Batch 5 的静态验证和 scenario resilience smoke。
- [x] 新增 `js/core/renderer/strategic_overlay_runtime_owner.js`，收口 operation graphics / special zone 的 runtime 事务与 unit counter 读 helper。
- [x] 让 `map_renderer.js` 把命中的 strategic overlay facade 降成 owner wrapper。
- [x] 补齐 strategic overlay runtime owner 合同与行为测试。
- [ ] 继续判断 full `strategic_overlay_editing` e2e 的 startup readiness 超时是否属于现有环境问题还是本轮新回归。

## 当前 approved plan 对齐
1. 先继续收紧 `scenario` 边界和事务 owner。
2. 再推进 `runtime_hooks/state ownership`，保持 `state.js` 单例 facade 稳定。
3. 最后整理 `renderer API`，让 `map_renderer.js` 保留稳定 facade 和编排面。
4. Batch 5 当前切口：
   - 生产 consumer 改成 named import 或局部 helper bridge
   - scenario/startup 事务优先走 `scenario_renderer_bridge`
   - `map_renderer.js` 继续保留稳定 facade 和兼容 export
5. Batch 5 follow-up 当前切口：
   - 先抽 `operation graphics / special zone` runtime owner
   - `operational line + unit counter attachment` 留到下一刀整组收口

## 完成标准
- 三个标准留档文件已存在。
- 两份旧文档已去掉被代码证伪的陈述。
- 两份旧文档都写清下一步顺序和新验证矩阵。
- `scenario` presentation 重复事务已经收进共享 owner。
- `scenario` lifecycle reset / clear 事务已经收进共享 owner。
- `scenario` bundle/cache 装配链已经收进共享 owner。
- `state` 的 history/dev/strategic overlay 默认 shape 已经收进内部 owner。
- `state` 的 scenario runtime 默认 shape 已经收进内部 owner。
- `state` 的 renderer runtime / border cache / spatial index 默认 shape 已经收进内部 owner。
- Batch 5 的生产 consumer import 已从 namespace import 收紧到 named import / 局部 helper bridge。
- Batch 5 的 scenario/startup renderer 依赖已先收成内部 `scenario_renderer_bridge`。
- Batch 5 的 strategic overlay runtime 已开始从 donor 下沉到独立 owner。
- 合同测试、静态检查、定向 smoke 都有对应证据。

