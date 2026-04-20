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

## 本轮交付
- 文档基线已经补齐。
- 旧文档里的过时大计划已改成当前 approved plan 口径。
- 验证矩阵已统一为同一套结构。
- `scenario` presentation 共享 owner 已落地。
- `scenario` lifecycle 共享 owner 已落地。
- Batch 1 和 Batch 2 的最小运行证据已经补齐。
- Batch 2 review follow-up 两条回归已经修复并补上行为级验证。

## 复核清单
- 文档与代码口径一致
- `scenario` facade 仍然保留在原文件
- 只有一条 live smoke
- `scenario_manager.js` 继续只保留 facade / 协调职责
- clear 后 blank baseline 会回到 startup topology
- clear 后 startup deferred detail baseline 会继续保留 promotion 资格
- reset 首次 context bar 刷新就会拿到新的 owner/controller split 数
- 汇报里列出修改文件、验证和剩余风险

