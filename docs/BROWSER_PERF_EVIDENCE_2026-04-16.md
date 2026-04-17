# 浏览器性能取证计划 2026-04-16

- [x] 确认启动入口：`run_server.bat` / `start_dev.bat`，浏览器脚本：`ops/browser-mcp/editor-performance-benchmark.py`
- [x] 复用 localhost 服务，并确认可打开 `perf_overlay=1`
- [x] 采集 default 启动场景交互证据：改用 direct Playwright probe，产物 `.runtime/output/perf/direct-playwright-probe.json`
- [x] 采集 `tno_1962` 场景同类证据：截图 `.runtime/browser/mcp-artifacts/perf/tno_1962-probe.png`
- [x] benchmark 脚本已跑通并写出完整 JSON：`.runtime/output/perf/editor-performance-benchmark.json`
- [x] 汇总 console、network、截图路径、关键指标、复现步骤

## 本轮结果

### 本轮新增推进
- `scenario water` 已从 `contextScenario` 热区里拆成独立内部缓存层。
- `chunked runtime coarse prewarm` 已从 `runPostScenarioApplyEffects()` 的同步等待里移出，改成首帧后异步调度。
- benchmark 已支持：
  - wrapper open fallback
  - local `node+playwright` transport fallback
  - `/app/` URL 补齐
  - Windows screenshot 路径落盘
  - `blackFrame` implicit zero 汇总

### Benchmark 摘要
- `none.load`: `9355.0ms`
- `none.timeToInteractive`: `714.3ms`
- `hoi4_1939.timeToInteractive`: `12692.5ms`
- `tno_1962.load`: `7836.3ms`
- `tno_1962.timeToInteractive`: `731.0ms`
- `tno_1962.pageLoad`: `9446.0ms`
- `blackFrame`: 三个场景当前汇总均为 `0`

### 对比判断
- `tno_1962.timeToInteractive` 已从上一轮约 `2554ms` 降到约 `731ms`。
- `none.timeToInteractive` 也降到约 `714ms`，说明 coarse prewarm 延后确实有效。
- `hoi4_1939` 仍明显异常，当前最像 `prepareScenarioApplyState -> setActivePaletteSource -> buildHoi4FarEastSovietOwnerBackfill` 这条场景专属链过重。

### 仍缺的关键指标
- `timeToPoliticalCoreReady`
- `settleExactRefresh`
- `zoomEndToChunkVisible`

这三项在当前 benchmark 输出里仍未稳定采全，下一步继续补采样链，而不是再盲调渲染热路径。

### 最新补充判断
- hoi4_1939.timeToInteractive 已从约 12692ms 降到约 11943ms，说明 palette/backfill 热链有真实收益，但还远远不够。
- 结合静态复核和 probe，当前更像 drawPoliticalPass 对 HOI4 大量复杂 polygon 首帧真慢。
- 下一刀应先切 drawPoliticalBackgroundFills()，再看 drawPoliticalFeature 的逐要素填充/描边。

### HOI4 定向补充 probe
- hoi4_1939.timeToInteractiveCoarseFrame: 约 11943ms -> 1406ms`n- hoi4_1939.applyScenarioBundle: 约 11945ms -> 1408ms`n- hoi4_1939.scenarioApplyMapRefresh: 约 28138ms 级误报消失，当前定向 probe 下约 780ms`n- 新判断：前置链里最重的不是 palette/backfill 本身，而是『apply 前强等 detail topology』这条链；在确认 chunked political runtime 可用后跳过这段，收益最大。
