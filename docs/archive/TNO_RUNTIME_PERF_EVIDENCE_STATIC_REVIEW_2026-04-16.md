# TNO Runtime Performance Evidence Static Review 2026-04-16

## 目标
- 只读审阅现有性能证据与验证面
- 对齐 QA-086、QA-090、benchmark 脚本、perf overlay / renderPerfMetrics / scenarioPerfMetrics 入口
- 输出四项：仍高概率有效结论、需复测结论、最该测 5 个指标、推荐验证顺序

## 执行进度
- [x] 建立审阅计划
- [x] 审阅 QA-086 文档
- [x] 审阅 QA-090 文档
- [x] 审阅 editor-performance-benchmark.py
- [x] 梳理 perf overlay / renderPerfMetrics / scenarioPerfMetrics 入口与调用链
- [x] 汇总静态结论

## 静态结论
- QA-086 里关于 fill 热路径、partial political repaint、border snapshot reuse 已落地，当前代码仍保留对应指标与入口。
- QA-090 里关于重加载阻塞的总方向仍有参考价值，但加载链在当前代码里已经引入 worker decode、bootstrap cache、persistent cache、轻量 scenario apply refresh、延后 UI 刷新，旧秒数结论需要重测。
- 当前最值得继续沿用的指标是：loadScenarioBundle、timeToInteractiveCoarseFrame、timeToPoliticalCoreReady、settleExactRefresh、zoomEndToChunkVisibleMs，并配套看 exactRefreshFrame.timings.political 与 runtimeTopologyDecodePath。
- 当前盲区集中在：benchmark 缺少 load 子阶段拆账、overlay / Dev Workspace 没展示 long-animation-frame 和 chunk runtime 明细、contextBreakdown 没纳入 roads / railways、指标只有 latest snapshot 没有序列。
