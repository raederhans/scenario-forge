# RAIL_RUNTIME_INTEGRATION_2026-04-15

## Plan
- 接 global rail catalog 的 deferred loader，不回到 eager packs。
- 打通主地图 rail preview 线网渲染和 Rail 开关。
- stations / labels / save-load 继续分阶段接入。
- 补静态与契约测试，守住边界。

## Progress
- [x] 复核现有 loader / renderer / toolbar / state / save-load 链路。
- [x] 修改 runtime loader、renderer、toolbar、state、save-load 和页面结构。
- [x] 运行静态与单元验证。
- [x] 收尾复核、记录 lessons、归档文档。

## Verification
- `node --check js/core/data_loader.js`
- `node --check js/main.js`
- `node --check js/core/state.js`
- `node --check js/core/map_renderer.js`
- `node --check js/ui/toolbar.js`
- `node --check js/core/file_manager.js`
- `node --check js/core/interaction_funnel.js`
- `node --check js/ui/i18n.js`
- `python -m unittest tests.test_global_transport_builder_contracts tests.test_transport_manifest_contracts tests.test_transport_workbench_manifest_runtime_contract -q`

## Notes
- 当前 rail runtime 已接：preview railways、stations major 空集合链路、rail line labels、showRail project save/load。
- stations major 现阶段仍没有真实 checked-in 站点数据，所以地图上链路是通的，但内容仍为空；没有伪造站点。
