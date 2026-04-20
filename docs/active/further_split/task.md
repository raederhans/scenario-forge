# further_split execution task

## 任务清单
- [x] 新建 `plan.md`
- [x] 新建 `context.md`
- [x] 新建 `task.md`
- [x] 修正 `STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`
- [x] 修正 `file_split.md`
- [x] 对齐下一步顺序：`scenario -> runtime_hooks/state ownership -> renderer API`
- [x] 把验证矩阵改成“结构合同 / 静态检查 / 定向 smoke / 日期和证据路径”
- [x] 新增 `js/core/scenario/presentation_runtime.js`
- [x] 调整 `js/core/scenario_manager.js`
- [x] 调整 `js/core/scenario_resources.js`
- [x] 新增 `tests/test_scenario_presentation_runtime_boundary_contract.py`
- [x] 更新 `tests/test_scenario_manager_boundary_contract.py`
- [x] 更新 `tests/test_scenario_resources_boundary_contract.py`
- [x] 新增 `js/core/scenario/lifecycle_runtime.js`
- [x] 调整 `js/core/scenario_apply_pipeline.js`
- [x] 新增 `tests/test_scenario_lifecycle_runtime_boundary_contract.py`
- [x] 更新 `tests/e2e/scenario_shell_overlay_contract.spec.js`
- [x] 跑定向 Python 合同测试
- [x] 跑 `node --check`
- [x] 跑 Batch 2 scenario lifecycle smoke
- [x] 最终复核
- [x] 修复 Batch 2 review follow-up：clear 后 deferred detail 状态回归
- [x] 修复 Batch 2 review follow-up：reset 时 context bar split count 刷新顺序
- [x] 新增 lifecycle runtime 行为级定向测试
- [x] 新增 `js/core/scenario/bundle_runtime.js`
- [x] 让 `scenario_resources.js` 的 bundle/cache 装配链改成 owner + facade
- [x] 新增 `tests/test_scenario_bundle_runtime_boundary_contract.py`
- [x] 更新 `tests/test_scenario_resources_boundary_contract.py`
- [x] 跑 Batch 3 bundle/cache 定向验证
- [x] 新增 `js/core/state/history_state.js`
- [x] 新增 `js/core/state/dev_state.js`
- [x] 让 `state.js` 通过 history/dev owner 注入默认 shape
- [x] 让 `runtime_hooks.js` 按 UI / command / data / render 分组收口
- [x] 新增 `js/core/state/strategic_overlay_state.js`
- [x] 统一 `state.js` / `interaction_funnel.js` / `map_renderer.js` 的 strategic overlay 默认形状
- [x] 新增 strategic overlay owner 合同与行为测试
- [x] 跑 Batch 4 定向验证
- [x] 新增 `js/core/state/scenario_runtime_state.js`
- [x] 让 `state.js` 通过 scenario runtime owner 注入默认 shape
- [x] 让 `chunk_runtime.js` / `lifecycle_runtime.js` / `scenario_rollback.js` / `scenario_data_health.js` 复用 scenario runtime factory
- [x] 新增 scenario runtime owner 合同测试
- [x] 跑 Batch 4 scenario runtime 定向验证

## 本轮交付
- 文档基线已经补齐。
- 旧文档里的过时大计划已改成当前 approved plan 口径。
- 验证矩阵已统一为同一套结构。
- `scenario` presentation 共享 owner 已落地。
- `scenario` lifecycle 共享 owner 已落地。
- Batch 1 和 Batch 2 的最小运行证据已经补齐。
- Batch 2 review follow-up 两条回归已经修复并补上行为级验证。
- Batch 3 的 bundle/cache owner 已落地，`scenario_resources.js` 继续保留稳定 facade。
- Batch 4 的 history/dev/runtime_hooks 内部 owner 已落地。
- Batch 4 的 strategic overlay 默认形状已经统一成单一真源。
- Batch 4 的 scenario runtime 默认 shape 已经统一成单一真源。

## 复核清单
- 文档与代码口径一致
- `scenario` facade 仍然保留在原文件
- 只有一条 live smoke
- `scenario_manager.js` 继续只保留 facade / 协调职责
- clear 后 blank baseline 会回到 startup topology
- clear 后 startup deferred detail baseline 会继续保留 promotion 资格
- reset 首次 context bar 刷新就会拿到新的 owner/controller split 数
- `loadScenarioBundle` 主交易、bootstrap cache probe/write、cache-hit restore 已下沉到独立 owner
- `scenario_resources.js` 对外 import 面保持不变
- `state.js` 继续是唯一公开 state 入口
- strategic overlay editor 默认 shape 在 cold init / import reset / renderer fallback 三条路径对齐
- scenario chunk/runtime health/reset/rollback 的默认 shape 已统一复用
- 汇报里列出修改文件、验证和剩余风险

