# MAP_RENDERER_FURTHER_SPLIT_IMPLEMENTATION_2026-04-19

## 目标
- 在不破坏现有功能和性能的前提下，继续缩小 `js/core/map_renderer.js`
- 保持 `map_renderer.js` 作为 render transaction owner
- 先拆纯数据 owner，再拆安全小切口，最后串行验证

## 本轮执行计划
- [x] Wave A：抽出 `political_collection_owner`
- [x] Wave B：抽出 `context_layer_resolver`
- [x] 安全小切口：抽出 `asset_url_policy`
- [x] 安全小切口：抽出 `facility_surface`
- [x] 补边界测试
- [x] 串行验证（`node --check` + 22 条 targeted unittest）
- [x] 最终 review 与留档

## 进度记录
- 2026-04-19：
  - 已开始实施。
  - 当前执行顺序：Wave A -> Wave B -> asset URL policy -> facility surface -> tests -> review。
  - 已新增 owner：`js/core/renderer/political_collection_owner.js`
  - 已新增 owner：`js/core/renderer/context_layer_resolver.js`
  - 已新增 owner：`js/core/renderer/asset_url_policy.js`
  - 已新增 owner：`js/core/renderer/facility_surface.js`
  - `map_renderer.js` 继续保留 render transaction owner，只把政治集合、context layer resolver、bathymetry URL policy、facility surface 下沉成 owner。
  - 已新增边界测试：`tests/test_map_renderer_political_collection_boundary_contract.py`
  - 已新增边界测试：`tests/test_map_renderer_context_layer_resolver_boundary_contract.py`
  - 已新增边界测试：`tests/test_map_renderer_asset_url_and_facility_surface_contract.py`
  - 已更新：`tests/test_transport_facility_interactions_contract.py`
  - 已更新：`tests/e2e/physical_layer_regression.spec.js`，把旧 donor/source 假设切到新的 owner/source of truth。
  - 已验证：
    - `node --check js/core/map_renderer.js`
    - `node --check js/core/renderer/political_collection_owner.js`
    - `node --check js/core/renderer/context_layer_resolver.js`
    - `node --check js/core/renderer/asset_url_policy.js`
    - `node --check js/core/renderer/facility_surface.js`
    - `node --check tests/e2e/physical_layer_regression.spec.js`
    - `python -m unittest tests.test_map_renderer_political_collection_boundary_contract tests.test_map_renderer_context_layer_resolver_boundary_contract tests.test_map_renderer_asset_url_and_facility_surface_contract tests.test_map_renderer_urban_city_policy_boundary_contract tests.test_map_renderer_strategic_overlay_helpers_boundary_contract tests.test_frontend_render_boundary_contract tests.test_transport_facility_interactions_contract tests.test_scenario_chunk_refresh_contracts -v`
  - 架构复核：APPROVE
  - reviewer 复核先指出 global bathymetry 仍有第二处 source of truth；已改成统一走 `getDesiredBathymetryTopologyUrl("global")`
  - review 补充指出 `tests/e2e/physical_layer_regression.spec.js` 在 remote base URL 模式下不应读取本地仓库源码；已改成“远端模式读 served app，本地默认模式读 repo 文件”。
  - Playwright 尝试结果：
    - `tests/e2e/physical_layer_regression.spec.js` 当前卡在运行时 canvas snapshot 缺失
    - `tests/e2e/tno_1962_ui_smoke.spec.js` 当前表现为长时间等待，无新的失败输出
