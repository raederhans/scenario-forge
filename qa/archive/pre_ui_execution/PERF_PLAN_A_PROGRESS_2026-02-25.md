# Plan A Implementation Progress (2026-02-25)

## Scope
执行目标：按 `方案 A（低风险止血）` 推进渲染交互稳定化，不改导入/导出 schema，不触及 B/C 架构改造。

## Completed
1. 渲染阶段状态机（`idle | interacting | settling`）已接入。
- 文件：`js/core/map_renderer.js`
- 行为：`zoom start -> interacting`，`zoom end -> settling`，`200ms` 后自动回到 `idle`。

2. `interacting` 阶段降级绘制已落地。
- 仅绘制：政治填充 + 国家边界 + 低 LOD 海岸线。
- 跳过：`province/local` 边界绘制。
- Legend：仅在 `idle` 阶段重建/刷新。
- Hover：非 `idle` 阶段不刷新 hover path，仅保留 tooltip 文本更新。

3. 投影边界缓存（`state.projectedBoundsById`）已落地并统一复用。
- 缓存结构：`Map<featureId, {minX,minY,maxX,maxY,width,height,area}>`
- 重建时机：`fitProjection()`、`setMapData()`（数据切换时）、`setCanvasSize()`（尺寸变化时清空，后续 `fitProjection` 重建）。
- 热路径已改读缓存：
  - `shouldSkipFeature`
  - `pathBoundsInScreen`
  - `buildSpatialIndex`
  - `calculatePanExtent`

4. 快速开发启动档位已新增。
- 新增：`start_dev_fast.bat`
- 行为：不跑 `build_data.bat`，默认以 `/?detail_layer=off` 打开。
- 为此扩展了 `tools/dev_server.py`：支持从 `MAPCREATOR_OPEN_PATH` 或 CLI 参数决定浏览器打开路径。

5. 状态字段补齐。
- 文件：`js/core/state.js`
- 新增：`renderPhase`、`phaseEnteredAt`、`renderPhaseTimerId`、`projectedBoundsById`。

## Validation Performed
1. `python -m py_compile tools/dev_server.py` 通过。
2. 代码级检查：关键路径调用关系与字段初始化已对齐。

## Issues / Constraints
1. 当前仓库没有自动化前端性能基准脚本（FPS/P95）可直接在 CLI 内复现实测。
2. 本次为代码级止血改造，真实性能收益需要在浏览器按既定矩阵跑实测。
3. 仍有边缘风险：如果未来存在无稳定 `featureId` 的新数据，缓存命中率会下降（当前逻辑有回退，但会退化为现算）。

## Next Steps
1. 先跑方案 A 验收矩阵（`detail_off` / `composite` 各 3 轮），记录：平均 FPS、填色 P95。
2. 重点回归：QA-023 / QA-024 / QA-025 / QA-028。
3. 若未达门槛（特别是 composite < 30 FPS），按原计划进入方案 B 的离屏缓存 + dirty rect。
