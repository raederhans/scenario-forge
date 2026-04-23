# strategic_overlay_unit_counter_runtime_lane 上下文

## 2026-04-22 初始记录

- 用户限定写入范围：
  - `js/core/renderer/strategic_overlay_runtime_owner.js`
  - `js/core/renderer/strategic_overlay_runtime/*.js`
  - `tests/test_map_renderer_strategic_overlay_runtime_owner_boundary_contract.py`
- 本轮不跑任何 live test。
- 不能回退他人改动，只做 runtime lane 最小改动。
- 当前 owner 里 unit counter 仍包含 preview、nation resolution、place/start/cancel/select/update/delete，以及 `syncOperationalLineAttachedCounterIds()`。
- 目标边界：把 unit counter 事务链下沉成独立 domain/helper，owner 留 orchestration 和 facade wiring。

## 2026-04-22 实施进展

- 新增 `js/core/renderer/strategic_overlay_runtime/unit_counter_runtime_helpers.js`：承接 `getUnitCounterPreviewData()` 与 `resolveUnitCounterNationForPlacement()`。
- 新增 `js/core/renderer/strategic_overlay_runtime/unit_counter_runtime_domain.js`：承接 `syncOperationalLineAttachedCounterIds()` 与 unit counter 的 place/start/cancel/select/update/delete 事务。
- `strategic_overlay_runtime_owner.js` 改成：
  - 组装 `unitCounterHelpers` 与 `unitCounterDomain`
  - `deleteSelectedOperationalLine()` 通过 domain 做 attachment 同步
  - `cancelActiveStrategicInteractionModes()` 继续保留跨域编排
  - return surface 继续从 owner 暴露稳定 facade
- boundary contract 已改成真实边界：renderer facade 继续钉在 `map_renderer.js`，owner 检查 domain/helper wiring，新 unit counter domain/helper 检查各自 owner 符号。
- review 子代理补充发现：合同还需锁住 helper -> domain 接线。
- 已补合同断言：
  - `resolveUnitCounterNationForPlacement: unitCounterHelpers.resolveUnitCounterNationForPlacement,`
- 已完成静态自检：
  - `node --check js/core/renderer/strategic_overlay_runtime_owner.js`
  - `node --check js/core/renderer/strategic_overlay_runtime/unit_counter_runtime_domain.js`
  - `node --check js/core/renderer/strategic_overlay_runtime/unit_counter_runtime_helpers.js`
  - `python -m py_compile tests/test_map_renderer_strategic_overlay_runtime_owner_boundary_contract.py`
