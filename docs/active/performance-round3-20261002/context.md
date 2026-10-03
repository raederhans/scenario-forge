# 当前上下文

- 工作区：C:/Users/raede/.codex/worktrees/performance-round-20261002/mapcreator，codex/performance-round-20261002。
- 保留前两轮未提交修改；第二轮 JS 快照 `.runtime/tmp/performance-round3/baseline/js`，数据未改变。
- round3_tail_profile 分析单次 exact CPU；round2_shared_base_design 转向政治背景/cache 结构；round2_exact_render 转向 bootstrap→full runtime 复用。
- 所有生产/测试写入由 root 负责。子代理只读，不能启动浏览器、服务器、长测试或争用测量 CPU。

## 已选方案与边界

- deferred paths 复用完整背景保留的 Path2D；不回填有预算的 LRU。允许该同步单几何查询跨 chunk data generation，但仍校验 scenario、scene、projection/topology signature 和 ID + geometry 引用。旧异步任务与完整缓存发布仍严格匹配 data generation。
- exact political invalidation 移至异步 preparation 之前；失效后的 plan 随 Promise retry 传递，避免 prepare 和 draw 之间再次改变 snapshot epoch。
- 首次候选发现真实 chunk promotion 的 data generation 2→3 阻断 retained 命中；已修复，并改正测试 fixture 将 data generation 错拼入 path signature 的模拟偏差。该候选不是最终性能结果。
- 原始 exact 约一秒主要跨 Worker Promise 等待；main-thread CPU 采样不能解释 Worker 内部分项。不改时间预算、精度或 Worker 算法。
- bootstrap→full hydration 复用已有只读候选设计，本轮不扩大实施范围；当前重点是已复现的渲染尾部。

## Live process ownership

状态：测量完成，浏览器页面及以下两服务已关闭。记录保留供复现。

root 唯一拥有下列进程，cwd 均为当前工作区。成功条件是服务提供预期 app，失败时检查日志而非另起重复实例；A/B 结束后核对 PID 与命令并停止。两个服务 cache_mode=nostore，runtime metadata 目录分离。非 owner 只读已完成产物。

| 服务 | 命令 | 资源/日志 |
| --- | --- | --- |
| baseline | python .runtime/tmp/performance-round3/baseline_server.py | localhost:8009；同目录 baseline.stdout.log、baseline.stderr.log、baseline.pid |
| candidate | python tools/dev_server.py --port 8008 | localhost:8008；同目录 candidate.stdout.log、candidate.stderr.log、candidate.pid |

浏览器使用 Codex 内置浏览器，localhost，串行；输出 `.runtime/browser/performance-round3`。测量期间不执行测试或资产构建。基线必须用第二轮快照，不用没有前两轮补丁的 HEAD。
