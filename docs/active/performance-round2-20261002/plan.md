# Plan

## Goal
继续完成用户授权的第二轮大幅性能优化，优先降低首屏基础数据处理与精确恢复的大块工作量；保留第一轮未提交实现。

## Scope
- 启动 pipeline、worker、资源缓存中的重复 fetch/decode/clone。
- 大几何精确恢复的重复计算和主线程长任务。
- 公共 base 拓扑共享方案：只有确有总成本收益且合同完整时才落地。

## Sources of truth
当前隔离工作区源码、实际数据、目标测试与同条件 localhost 测量。第一轮结论见 .runtime/reports/generated/performance-round/results.md。

## Stages
- [x] 以第一轮源码快照建立可重放基线，三个只读方向找到大成本与安全边界。
- [x] 按收益与合同分配明确文件所有权，实施选中的方案。
- [x] 目标测试、受影响共享合同以及基线/候选 localhost 比较。
- [x] 审查最终差异，记录实测收益、未改善指标和剩余问题。

## Acceptance criteria
- 能用真实调用、确定性工作量或重复运行的时序证明确实减少工作。
- 几何精度、颜色、覆盖、编辑、取消、数据身份、失败恢复不回退。
- 功能验证与性能测量分别报告，未量化部分不夸为整体加速。
- 若改数据资产，遵守 data/AGENTS.md，保持生成链、manifest、catalog 一致。

## Non-goals
不放宽预算或测试门槛，不删图层/降低精度，不提交推送或发布，不改主 checkout 的未归属 WIP。

## Risks and constraints
跨异步缓存必须有生命周期与失效证明。拆包不能用单文件变小冒充冷启动总下载量变少。测试/服务/浏览器由 root 单一协调，避免 CPU 争用污染测量。
