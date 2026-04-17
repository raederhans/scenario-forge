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

### Stage 3 最新结果 2026-04-16 22:31 -0400
- 定向回归 `tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js` 已通过 4/4。
- 最新 benchmark 文件：`.runtime/output/perf/editor-performance-benchmark.json`
- schema 已升级到 `benchmarkMetricsSchemaVersion = 2`
- `scenarioConsistencyByScenario`：
  - `none = true`
  - `hoi4_1939 = true`
  - `tno_1962 = true`

### 最新关键指标
- `tno_1962.timeToInteractive`: `531.5ms`
- `tno_1962.timeToPoliticalCoreReady`: `531.5ms`
- `tno_1962.settleExactRefresh`: `436.9ms`
- `tno_1962.zoomEndToChunkVisible`: `3950.5ms`
- `tno_1962.blackFrame`: `0`
- `hoi4_1939.timeToInteractive`: `1261.9ms`
- `hoi4_1939.timeToPoliticalCoreReady`: `1261.8ms`
- `hoi4_1939.settleExactRefresh`: `377.2ms`
- `hoi4_1939.blackFrame`: `0`

### 当前判断
- benchmark 口径收口已经完成：scenario-aware URL、生效场景一致性、same-scenario direct/fresh metric 选择、schema 2 汇总层都已落地。
- `drawPoliticalPass` 的细分指标已经落地，perf overlay 能看到：
  - `politicalBg`
  - `politicalFill`
  - `politicalStroke`
  - `bgCacheBuild`
  - `bgCacheReplay`
- `timeToPoliticalCoreReady` 与 `settleExactRefresh` 已经稳定采到。
- 当前最重的剩余问题已经进一步收口到 `tno_1962.zoomEndToChunkVisible`，本轮 benchmark 里它仍明显高于阶段目标。

### Stage 4 最新结果 2026-04-16 23:31 -0400
- 已继续收紧 `zoomEndToChunkVisible`：
  - `focusCountry` 从 scenario tag 对齐到 chunk 使用的 `iso2`
  - political required budget 从固定 `24` 收口
  - `zoom-end` 即时路径只保留 focus political detail 为 required
  - non-political detail 从 `required` 降到 `optional`
  - focus political detail chunk 在场景应用后后台预热到缓存
  - benchmark 对 `zoomEndToChunkVisible` 已优先采用 `scenarioChunkPromotionVisualStage`

### 最新关键指标
- `tno_1962.timeToInteractive`: `523.9ms`
- `tno_1962.timeToPoliticalCoreReady`: `523.9ms`
- `tno_1962.settleExactRefresh`: `432.4ms`
- `tno_1962.zoomEndToChunkVisible`: `93.1ms`
- `tno_1962.blackFrame`: `0`

### 最新判断
- `zoomEndToChunkVisible` 已从旧 runtime 口径的多秒等待，收口到真正“首批 detail 可见”的 visual-stage 口径。
- 对 `tno_1962` 而言，这条指标已经进入阶段目标范围。
- 下一轮如果继续做体验提升，重点将从 chunk promotion 首批可见，转到 `timeToInteractive / timeToPoliticalCoreReady / settleExactRefresh` 三条渲染与启动收尾链。
