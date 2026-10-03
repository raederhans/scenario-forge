# Context

## Current truth
- 工作区 C:/Users/raede/.codex/worktrees/performance-round-20261002/mapcreator，branch codex/performance-round-20261002，HEAD faabcf81。
- 主 checkout 与其他工作树不在写入范围内。
- 第一轮 JS 快照：.runtime/tmp/performance-round2/baseline/js（499文件，7,878,121 bytes）。
- 第一轮补丁：.runtime/tmp/performance-round2/round1.patch。
- 第一轮性能证据：.runtime/browser/performance-round/。
- 三个只读子代理已完成：round2_startup_runtime、round2_exact_render、round2_shared_base_design；round2_review 正在审查。主代理是生产文件与测试的写入 owner。

## Decisions and deviations
| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-10-02 | 用户要求继续下一轮大幅优化 | 将重心从局部扫描/校验转向完整拓扑处理与大几何恢复 |
| 2026-10-02 | 公共base已超过5MB；gzip9和字段裁剪已使用 | 不调整预算或删精度；共享拆包需评估总成本与身份合同 |
| 2026-10-02 | 拆分公共base对1939冷总量仅少683B，TNO仅少107B | 本轮不实施共享资产迁移 |
| 2026-10-02 | 精确渲染存在alias重复归一化和边界重复投影 | 实施规范码快路径、删除重复调用、复用同次投影 |
| 2026-10-02 | 既有topology解包每点subarray+Array.from很慢 | classic shared codec复用原协议；定长数组索引解包；启动只传大型base原arcs，新buffer合并旧geometry transfer |
| 2026-10-02 | 真实资产3次深相等；当前Node clone425–770ms，优化完整链141–192ms | 仅为隔离CPU证据，浏览器端到端仍在测量 |

## Live process ownership
root 是所有本地服务器、浏览器及长测试的唯一 owner。临时产物均使用 .runtime/。

| Process | Owner | Command and resources | Completion and stop |
| --- | --- | --- | --- |
| baseline localhost:8009 | root | python .runtime/tmp/performance-round2/baseline_server.py；读取baseline/js和当前未改变数据；日志 .runtime/tmp/performance-round2/baseline.stdout.log / baseline.stderr.log；PID文件baseline.pid | 仅限本轮A/B。读到对应HTML即就绪；端口失败停止；采样结束按PID及commandline核对后关闭 |
| candidate localhost:8008 | root | python tools/dev_server.py --port 8008；当前工作树；日志同目录candidate.stdout.log / candidate.stderr.log；PID文件candidate.pid | 同上 |

两个进程cwd均为当前工作区；缓存模式nostore，metadata目录分开。其他代理只能读取已完成快照，不启动、轮询或停止这两个服务。浏览器只串行测试一个页面，日志与性能文件写.runtime/browser/performance-round2。

## Handoff
A/B baseline必须是本轮开始的源码快照，不是HEAD（HEAD没有第一轮补丁）。本轮未改data，因此baseline服务器静态数据未漂移。

## Next step
本轮完成。所有本轮浏览器页已关闭，PID24964/21964已核对命令后停止。两组TNO热点alias self93–101→33–40ms，边界inclusive150–159→98–102ms；整段settle基线882–999ms、候选886–1018ms，未证实稳定下降。结果和限制见 `.runtime/reports/generated/performance-round2/results.md`。下一轮若继续，应沿剩余精确绘制和严格SHA约束的runtime hydration复用调查，不把共享拆包作为冷下载优化；不要混用HEAD与本轮快照。
