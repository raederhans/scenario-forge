# ROAD_RUNTIME_INTEGRATION_2026-04-15

## Plan
- 接 global road catalog 的 deferred loader，不回到 eager packs。
- 打通主地图 road preview 线网渲染和 Road 开关。
- road_labels / save-load 继续关闭。
- 补静态与契约测试，守住边界。

## Progress
- [x] 复核现有 loader / renderer / toolbar / state 链路。
- [x] 修改 runtime loader、renderer、toolbar、state 和页面结构。
- [x] 运行静态与单元验证。
- [x] 收尾复核、记录 lessons、归档文档。

## Verification
- `node --check js/core/data_loader.js`
- `node --check js/main.js`
- `node --check js/core/state.js`
- `node --check js/core/map_renderer.js`
- `node --check js/ui/toolbar.js`
- `node --check js/ui/i18n.js`
- `python -m unittest tests.test_global_transport_builder_contracts tests.test_transport_manifest_contracts tests.test_transport_workbench_manifest_runtime_contract -q`

## Notes
- 当前 road runtime 已接：preview roads、Road 开关、基础样式控制、主地图线网渲染。
- road_labels 这波仍然不接主地图，也不接 project save/load。
- 当前 global road preview 全部 shard 总量约 15.66 MB，因此本轮仍采用“首次打开时一次性 lazy load 全部 preview shards”的最短路径。
