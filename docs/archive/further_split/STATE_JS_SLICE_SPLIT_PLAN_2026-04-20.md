# STATE_JS_SLICE_SPLIT_PLAN_2026-04-20

结论：当前更稳的落地方向是先做 `scenario`，再做 `runtime_hooks/state ownership`，最后做 `renderer API`。`state_catalog.js` 和 `runtime_hooks.js` 已经落地，这份文件现在记录的是 2026-04-20 的 docs baseline，不再把“大规模 8 slices + Proxy + bus”写成眼前执行清单。

## 当前基线
- `state.js` 继续承担 singleton facade 和 compat re-export。
  - 证据：`js/core/state.js:23-31`
- `state_catalog.js` 已承接 catalog / audit 默认 shape，并由 `scenario_manager.js`、`scenario_ui_sync.js` 消费。
  - 证据：`js/core/state.js:23,108`、`js/core/state_catalog.js:1-27`、`js/core/scenario_manager.js:1,1274`、`js/core/scenario_ui_sync.js:1,6`
- `runtime_hooks.js` 已承接 runtime hook 默认槽位，启动、toolbar、sidebar、dev workspace 仍通过 `state.*Fn` 接线。
  - 证据：`js/core/state.js:26,649`、`js/core/runtime_hooks.js:1-76`、`js/main.js:59,219`、`js/ui/toolbar.js:988,1071,1074,1140`、`js/ui/sidebar.js:5362`、`js/ui/dev_workspace.js:1051`

## 已修正的过时表述
- `state_catalog.js` 已存在。
- `runtime_hooks.js` 已存在。
- 当前阶段的主线不是新开 `Phase 0` 护栏、Proxy facade 和视觉基线大迁移。
- 当前阶段也没有把“删除 `runtime_hooks.js`、统一切到 bus”列为已批准动作。

## 当前 approved plan
1. `scenario`
   - 继续把 scenario 事务和资源 owner 收紧在 `js/core/scenario/` 及相关 facade。
   - 目标是让 `scenario_manager.js`、`scenario_resources.js` 的边界继续稳定。
   - 证据：`js/core/scenario_manager.js:143`、`js/core/scenario_resources.js:81,84,116`
2. `runtime_hooks/state ownership`
   - 继续沿用 owner + singleton facade 模式，收口默认 shape、hook surface 和 wiring 合同。
   - 目标是让 `state.js` 更像稳定壳，owner 文件承担默认值和明确职责。
3. `renderer API`
   - 继续让 `map_renderer.js` 保留稳定 facade 与 render orchestration。
   - owner 侧已经有 `urban_city_policy.js` 和 `strategic_overlay_helpers.js`，下一步重点放在 API 面和接线合同。
   - 证据：`js/core/map_renderer.js:65-66`、`docs/REFACTOR_ARCHITECTURE_SPLIT_2026-04-17.md:5-9`

## 验证矩阵

### 结构合同
- `tests/test_state_split_boundary_contract.py`
- `tests/test_state_catalog_boundary_contract.py`
- `tests/test_runtime_hooks_boundary_contract.py`
- 需要时补充 scenario / renderer 对应 boundary contract

### 静态检查
- `node --check` 覆盖变更涉及的 JS 文件
- Python 合同测试用 `python -m unittest ...` 做定向静态门
- 文档里只登记已经执行过且能对应到具体文件的静态检查

### 定向 smoke
- 只记录和当前 owner 变更直接相关的短链路 smoke
- 当前顺序下优先记录：scenario apply / startup wiring / renderer facade 相关 smoke
- 本轮 docs baseline 本身没有新增 smoke 执行

### 日期和证据路径
- 每条验证记录都写绝对日期，例如 `2026-04-20`
- 每条记录都附证据路径或命令来源，例如：
  - 代码证据：`js/core/state.js:23-31,108,649`
  - 合同证据：`tests/test_state_split_boundary_contract.py`
  - 历史批准口径：`docs/REFACTOR_ARCHITECTURE_SPLIT_2026-04-17.md`

## 下一步留档要求
- 新增或回填记录时，直接按“结构合同 / 静态检查 / 定向 smoke / 日期和证据路径”追加。
- 只有进入正式批准清单的动作，才写进这份文件的主顺序。
