# CONTOUR_IMPLEMENTATION_2026-04-09

## Plan
- [x] 修 contour source 生成参数与失败策略，避免静默空产物。
- [x] 修 renderer 的 contour 可见集/批量 stroke/精确刷新逻辑，不改错误的 lineWidth 公式。
- [x] 补 builder/contract/renderer 的针对性测试与静态检查。
- [x] 复核、记录 lessons learned（如有必要）、归档本文件。

## Progress
- 2026-04-09 22:20 已建档，开始执行。
- 已改 `map_builder/config.py`：把 contour 处理步长改为 `0.0625`，major/minor simplify 改为 `0.025 / 0.015`。
- 已改 `map_builder/processors/physical_context.py`：删除 contour 失败后写空 topo 的兜底，空 contour 或生成异常都会直接失败。
- 已重建 `data/global_contours.major.topo.json` 与 `data/global_contours.minor.topo.json`；重建后 feature 数分别为 `15257 / 74861`。
- 已改 `js/core/map_renderer.js`：接上 contour 可见集缓存、按颜色批量 stroke、在 zoom bucket 变化时优先打回 exact pass，并保留 `lineWidth = width / scale`。
- 已改 `tests/e2e/physical_layer_regression.spec.js`：把源码断言更新到 visible-set cache / batching / exact refresh 新逻辑，并锁定 inverse-scale width 仍保留。
- 已新增 `tests/test_physical_context_contours.py`：覆盖 contour 参数、major/minor 分层、空 contour 拒绝写文件、构建失败直抛、已发布 topo 的非空与层级契约。
- 已验证：
  - `python -m py_compile map_builder\config.py map_builder\processors\physical_context.py tests\test_physical_context_contours.py`
  - `node --check js/core/map_renderer.js`
  - `node --check tests/e2e/physical_layer_regression.spec.js`
  - `python -m unittest tests.test_physical_context_contours -v`
  - `node node_modules/@playwright/test/cli.js test tests/e2e/physical_layer_regression.spec.js --reporter=list --workers=1 --retries=0`
- 复核结论：这次最该修的是 source 数据精度、失败策略和 contour 渲染热路径；不该上的 Catmull-Rom 和 runtime arc-length 已保持不做。
