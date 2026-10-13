# Task

## Current status

用户授权的后续三步正在收口：第二步局部收口和第三步分段测量完成；第一步的全仓 gate 未通过。用户最新选择先修独立模块、栅格收尾后统一验收。本批推进 content readiness 与 quick-fill，完整状态策略一致性仍以官方 checker 实际通过为验收条件。

第四批恢复 7 文件的 8 处旧 import，保留轻量事件实现和其他调用方迁移。最初 5 项之外，完整 capability 定向测试发现另外 4 文件的 18 项同类 source drift；58 项退役契约正向验证和 3 项拒绝测试现已通过。官方完整 checker 已以 exit 2 结束，共 3,978 条诊断；其中 3,475 条涉及本轮未改路径或全局检查。这是路径分组，不能据此将剩余 503 条认定为本轮新增。

历史证明 stored 259 条路径，HEAD-only 严格扫描需 454 条，工作区需 459 条；200 条缺口中 195 条已存在于提交历史。本次保留精确比较、冻结 baseline、预算和授权，依照最新整体一致性授权修复必要历史元数据，避开并行栅格工作。

三个授权目标本地实施完成。随后授权的 13 条 schema 错误已修复：464 条台账 schema 为 0 错误，相关现场调用链与完整台账历史检查通过。修复同时同步一个共用 hover 调用的记录，共改变 14 条；其他 policy 字段均不变。没有扩大权限、预算或豁免历史。完整 policy gate 仍待另项源码证明与历史验证收口。

## Checklist

- [x] 核实主目录、现有改动与栅格工作区边界。
- [x] 轻量事件入口与兼容迁移完成。
- [x] Chunk 事务边界、重复判断与回归验证完成。
- [x] 并行缓存读取、独立失败与真实缓存测量完成。
- [x] 工具来源识别、源码图、源码指纹与精确验证路由完成。
- [x] 聚焦浏览器并发切换/事务行为验证完成。
- [x] 最终 diff、pr:plan 与报告完成。
- [x] 查清并修复 13 条状态策略错误及同一 hover 调用的关联记录。
- [x] 正常迁移、早期历史冻结与篡改拒绝回归通过。
- [x] 规划状态策略整体一致性、启动资源状态边界和性能分段测量。
- [x] 修复本轮 capability 源码证明失配，取得官方全仓报告并核对遗留根因。
- [ ] 官方完整状态策略 checker 收口。
- [x] 修复完整生成器发现的 7 项 action binding 证明缺口，保留借用返回值的调用方跟踪。
- [x] 在一个测试文件内收窄 41 个标量断言入参，原有冻结预算保持不变。
- [x] 启动城市本地化合并边界实施及等价行为验证。
- [x] 分段性能测量与优化判断；本次未新增 worker 调度/传输实现。
- [x] 第二轮官方只读重建已结束并分类：895 条治理诊断、457 个唯一签名，未生成 policy 候选。
- [x] 三处 content readiness 写入迁入 canonical action，其他 findings 与既有 action 边不变。
- [x] Quick-fill 窄输入改造及精确只读 query 证明，阻止已退役 legacy writer 回流。
- [x] 导出预览私有 reader 的精确证明；修复自模块 dependency 借用磁盘旧源码的漏检。
- [ ] 等待栅格最终变更，再处理共享边界并统一验收。

## Validation evidence

- Hook 两个行为测试 15 cases、Python hook/state split 两模块 21 项通过；实现迁移后 32 个调用方使用轻量入口。
- Chunk 3 个目标 Node 文件 34 cases 通过；补充 cancellation、helpers、atomicity/lifecycle 与 startup 7 文件 132 cases 通过。
- 缓存 fixture 的并发、独立失败、缺失、禁用及回退情形通过；真实 IndexedDB 16 组交替样本的中位数 256.1 → 255.5 ms，P95 327.0 → 384.3 ms，不据此宣称性能改善。
- Python chunk refresh 38 项、toolbar split 54 项最终通过。
- 事件 scanner 新旧路径 5 个定向 cases 通过；policy 11 bindings 的原授权保留，局部 snapshot 0 violations；完整 schema 迁移前后相同 13 条 ledger 错误。
- Chunk 的两个 helper 展开后，非 import AST 与 HEAD 一致。借用源码契约只同步 18 个指纹值，77 个 borrowed-effect cases 通过；action delegation/source boundary 两个文件也通过。
- Chromium 场景并发目标测试 1 项通过（82.8 秒）。该检查与缓存 benchmark 串行，独立端口 8009 服务已停止。
- Architecture boundaries、Pages source graph（545 JS）、verification routes（736 routes）、test import graph（74 specs）、script portfolio 和两文件 verification metadata/portfolio 测试通过。
- `git diff --check` 通过；最终 `npm run pr:plan` 只读计划覆盖 75 个本地路径，无 unmatched 或 route gap。
- 完整命令、phase 边界和测量限制见 [审查与实施结果](../../architecture-simplification-20261010.zh-CN.md)。
- 第三批：soundness 24 项、官方 manifest 定向 4 项通过；9 文件现场 discovery、14 条 ledger observation、464 条 schema 与 ledger history 检查通过。最终计划为累计 78 路径，无 unmatched/route gap。
- 第四批：hook 15 项、capability 官方定向 4 项通过；完整 checker fail，3,978 条诊断。原失败报告保留，未重写成通过结果。
- 第五批：startup lifecycle + city support 共 28 项、Python startup boundary 5 项通过。新增 5 个用例在改前源码亦通过。官方参数下单文件 discovery 前后均 1 binding / 53 findings / 4 action edges，差异仅位置字段；完整局部 policy 诊断相同，新增 0，不能替代全仓 gate。
- 第六批：真实 Chromium、真实 JSON/IndexedDB、8 组主线程/worker 交替样本完成；首尾八类集合完整 JSON 相同，无页面或请求错误。warm loader 中位数 200.4 ms；主线程 decode 57.7 ms；worker decode 57.0 ms，往返 1,016.3 ms，postMessage 同步调用 459.1 ms，结果还原 141.9 ms。阶段并非都可相加，未测整页冷启动。
- 最终 `npm run pr:plan -- --json` 覆盖累计 73 路径，unmatched/route gap 为 0；它只生成计划，不证明其中 95 个 child-safe 命令或 CI 已通过。`git diff --check` 通过。
- 第八批：启动/城市/bootstrap 39 项，quick-fill/hierarchy 9 项，workspace 9 项，Python state/startup 19 项通过。action-delegation 完整文件 89 项通过；后续 checker 输入绑定修复后，22 项既有 reader 契约、8 项新边界契约通过。
- 导出预览目标扫描 4→3 bindings、50→31 findings；只移除 helper 自身 19 条，其余三个 inventory 与改前完全相同，controller 30 条仍保留。未修改导出产品代码或扫描过滤规则。
- 路由 metadata/portfolio 初跑 117 通过、1 失败；新增 quick-fill 路由的精确期望同步后，该目标 1 项重跑通过。最终计划累计 83 路径，无 unmatched/route gap；106 个 child-safe、89 个主线程命令仍是计划。`git diff --check` 通过。

## Open risks and remaining work

本轮未与正在实施的栅格分支合并或联合验收。未改 `map_renderer.js`、栅格模块、数据、依赖或发布产物。全仓 checker 已运行且失败；未运行完整 dist/CI，未提交、推送或部署。后续先按既有功能迁移历史修复 policy 元数据与来源证明，继续保留预算/冻结基线，再单独研究缓存拓扑的跨线程复制。不能通过恢复已删除功能、取消 river hover 清理、忽略 locator 或扩大预算来消除诊断。本次浏览器 context 和独立服务 PID 60144 已关闭，服务发现记录已清理。
