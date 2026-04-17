# TNO Runtime Interaction Performance Implementation 2026-04-16

## Goal
- 优先修复 TNO 1962 在地图拖拽、缩放、zoom end 后的强卡顿。
- 保持现有视觉效果与默认功能开关。
- 当前验收线：交互恢复时间 < 300ms。

## Execution Tracks
- [in-progress] Track A: `js/core/map_renderer.js`
  - 交互恢复与 exact-after-settle 调度收口
  - black frame / last good frame 保持
  - zoom end 后输入恢复与 exact redraw 解耦
- [pending] Track B: `js/core/scenario_resources.js`
  - chunk selection / load / merge / promotion 分阶段计时
  - zoom-end chunk promotion 收口
  - pending promotion / commit 路径减阻塞
- [pending] Track C: `js/main.js`
  - detail promotion 轻量刷新
  - 启动只读解锁与 detail promotion 衔接
  - 避免 detail promotion 回落到完整重建链
- [pending] Track D: benchmark / validation
  - 扩展现有 perf 指标与 benchmark 输出
  - 主线程串行验收

## Stage 3 Execution Plan
- [in-progress] Stage 3A: benchmark 口径收口
  - 非 `none` 场景必须走 scenario-aware URL
  - 汇总层只接收 same-scenario fresh metric
  - `timeToPoliticalCoreReady / settleExactRefresh / zoomEndToChunkVisible` 改成硬输出
  - 去掉 `timeToInteractive` 的跨场景 fallback 串味
- [in-progress] Stage 3B: political pass 热点收口
  - 给 `drawPoliticalPass` 补细分测量
  - 给 `drawPoliticalBackgroundFills` 加最小 durable cache
  - full political pass 先吃缓存，partial repaint 暂时沿用现状
- [pending] Stage 3C: regression / acceptance
  - 收紧 `scenario_chunk_exact_after_settle_regression.spec.js`
  - 补一条 `tno_1962` pan/drag 恢复约束
  - 主线程串行验证并回填同时间窗证据

## Progress Log
- 2026-04-16 18: 已确认以多子代理并行执行，主线程负责监督、整合、串行验证。
- 2026-04-16 18: 已拆成 4 条并行轨道：map_renderer / scenario_resources / main.js / benchmark。主线程只负责监督与串行验收。

- 2026-04-16 19: Track A 完成：交互恢复链不再被 deferExactAfterSettle 一起阻塞。
- 2026-04-16 19: Track B 完成：chunk promotion 改成 pending commit + 分阶段指标。
- 2026-04-16 19: Track C 完成：detail promotion 优先走轻量刷新链。
- 2026-04-16 19: Track D 完成：benchmark JSON 新增稳定汇总层。

- 2026-04-16 22: Benchmark wrapper 仍会在 Playwright open 阶段失败，已改成快速失败并列出全部 fallback 尝试。
- 2026-04-16 22: direct Playwright probe 已完成，黑屏为 0，chunk promotion 已不再是主瓶颈，当前热点收口到 contextScenario / drawScenarioRegionOverlaysPass。

- 2026-04-16 22: 第二波已启动：主线改 contextScenario，配套补 benchmark fallback 与最小回归约束。

- 2026-04-17 00: 第二波主线完成：contextScenario 内部把 scenario water 拆成独立缓存层，保留单一 pass 外壳。
- 2026-04-17 00: benchmark fallback 已跑通，整份 ditor-performance-benchmark.json 已生成。
- 2026-04-17 00: 当前 benchmark 暴露的主要剩余问题仍是 TNO 	imeToInteractive 偏高，且 	imeToPoliticalCoreReady / settleExact / zoomEndToChunkVisible / blackFrame 仍需补稳定采集。

- 2026-04-17 00: 继续推进第三步：先补齐 benchmark 缺失指标，再收紧 	imeToInteractive 过高链路。

- 2026-04-17 00: 将 chunked runtime coarse prewarm 从 unPostScenarioApplyEffects() 的同步等待里移出，改成首帧后异步调度。
- 2026-04-17 00: benchmark 已补 implicit zero blackFrame 汇总，并修复 Windows 控制台打印 Unicode 报错。
- 2026-04-17 00: 最新 benchmark 文件显示 	no_1962.timeToInteractive 已降到约 731ms，
one 约 714ms，hoi4_1939 仍偏高约 12692ms。

- 2026-04-17 01: scenario_manager 已补 palette 快路径与 HOI4 Far East SOV backfill 候选缓存，hoi4_1939.timeToInteractive 约从 12692ms 降到 11943ms。
- 2026-04-17 01: 当前剩余主瓶颈更像 drawPoliticalPass 的 HOI4 几何复杂度真慢，而不是 benchmark 串味。

- 2026-04-17 01: scenario_manager 继续收口：chunked political runtime 存在时，apply 前不再强行等 detail topology；HOI4 Far East backfill 走 runtimeTopology 候选缓存；同 palette 重复 apply 走快路径。
- 2026-04-17 01: 定向 hoi4_1939 apply probe 结果：	imeToInteractiveCoarseFrame 约从 11943ms 进一步降到 1406ms。

- 2026-04-17 01: benchmark 继续收口：suite open URL 统一补到 /app/，并开始按 scenario-aware URL 打开，避免根路径与当前激活场景串味。
- 2026-04-17 02: Stage 3A 已推进：`editor-performance-benchmark.py` 新增 `build_scenario_open_urls()`、same-scenario fresh metric gate、`scenarioConsistency` 汇总、schema version 2，并把非 `none` 的 `timeToInteractive` 回退从“静默混入口径”收紧到“缺少 fresh same-scenario metric 时显式暴露缺口”。
- 2026-04-17 02: Stage 3B 已推进：`drawPoliticalPass` 新增 `drawPoliticalBackgroundFillsPass / drawPoliticalFeatureFillLoop / drawPoliticalFeatureStrokeLoop` 细分指标；scenario political background 新增 full-pass durable cache，键已收紧到 scenario/runtime/color/transform/path cache 相关签名。
- 2026-04-17 02: Stage 3C 已推进：`scenario_chunk_exact_after_settle_regression.spec.js` 已补 benchmark 静态契约更新，并新增 `tno drag interaction settles cleanly without black-frame regression`。
- 2026-04-17 02: 本轮静态验证已完成：`node --check js/core/map_renderer.js`、`python -m py_compile ops/browser-mcp/editor-performance-benchmark.py`、`node --check tests/e2e/scenario_chunk_exact_after_settle_regression.spec.js` 全部通过。
- 2026-04-17 02: 定向 Playwright live e2e 以后台日志模式启动后长时间无 stdout/stderr 产出，已主动中止，当前 live 证据仍待下一轮单独收口。
- 2026-04-17 02: 已定位 live harness 卡住的真实根因：`map_renderer.js` 在整合 Stage 3 改动时一度丢失 `buildAdmin0MergedShapes()`，随后又暴露 `shouldUseScenarioBackgroundMerge()` 拼写错误；两处已修复。
- 2026-04-17 02: `scenario_chunk_exact_after_settle_regression.spec.js` 现已改走 fast startup query，并在复跑后通过 4/4。
- 2026-04-17 02: benchmark 已再次生成，`editor-performance-benchmark.json` 升级到 schema 2，`scenarioConsistencyByScenario` 现为 `none/hoi4_1939/tno_1962 = true/true/true`。
- 2026-04-17 02: 最新 benchmark 已稳定输出：
  - `tno_1962.timeToInteractive = 531.5ms`
  - `tno_1962.timeToPoliticalCoreReady = 531.5ms`
  - `tno_1962.settleExactRefresh = 436.9ms`
  - `tno_1962.zoomEndToChunkVisible = 3950.5ms`
  - `tno_1962.blackFrame = 0`
- 2026-04-17 02: 当前 Stage 3 实施已完成，剩余工作已经从“口径/埋点/缓存实现”切到“继续压缩 `zoomEndToChunkVisible` 真正热点”这一条新优化轨道。
