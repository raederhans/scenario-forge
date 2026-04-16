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
