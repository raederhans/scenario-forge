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
- [x] 跑定向验证并回填状态。

## 当前 approved plan 对齐
1. 先继续收紧 `scenario` 边界和事务 owner。
2. 再推进 `runtime_hooks/state ownership`，保持 `state.js` 单例 facade 稳定。
3. 最后整理 `renderer API`，让 `map_renderer.js` 保留稳定 facade 和编排面。

## 完成标准
- 三个标准留档文件已存在。
- 两份旧文档已去掉被代码证伪的陈述。
- 两份旧文档都写清下一步顺序和新验证矩阵。
- `scenario` presentation 重复事务已经收进共享 owner。
- `scenario` lifecycle reset / clear 事务已经收进共享 owner。
- 合同测试、静态检查、定向 smoke 都有对应证据。

