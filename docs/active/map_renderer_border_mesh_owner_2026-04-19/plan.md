# plan
- 目标：完成 `map_renderer.js` 最后一刀高收益拆分，并给出明确收尾结论。
- 当前边界：`render pass/cache orchestration`、`initMap/setMapData/refreshMapDataForScenarioApply`、`exact-after-settle/transformed frame` 主链继续留在 donor。
- 本轮切口：抽出 `spatial_index_runtime_owner.js`，下沉 6 个索引/空间索引构建函数；`rebuildRuntimeDerivedState()` 继续留在 donor 做 runtime transaction 编排。
- 验证：`node --check` + targeted unittest + review 式静态复核。
