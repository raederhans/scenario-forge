# Plan

## Goal

用户在 Palette Library 迁移后授权“继续工作，优化全局状态这一块”。完成上一轮暴露的状态借用/写入归属和契约基线缺口，生成并验证新的全局策略，同时保留已有上色行为。

## Scope

- static-border：分离运行身份借用与可变工作进度，保留取消、过期执行、分片及 worker 语义。
- 有限 renderer 只读/owner 契约：city labels、urban paint、render-pass signature、scenario coverage、political path cache、static border；逐项核对实际源码后准确登记。
- 全局写入 allowlist：区分 app singleton、独立 worker 状态和测试 fixture，修复真实越界或扫描误识别。
- 沿用现有 builder/checker 同步策略和 Palette 写入归属；补对应局部路由与 dist。
- 对整合预检确认的旧 hook 漏扫，使用显式兼容调用 API 保留既有 receiver/异常语义；扫描器只登记该精确来源 API，不放宽预算或名称信任。

## Sources of truth

当前源码和 AGENTS.md；引用对话 6aa3d8d8-54e8-83ec-99b3-13c528ac9eda；上一轮 `.runtime/reports/generated/palette-library-operation-result.md`；现有 state writer contract、policy 和测试。

## Stages

- [x] Stage 1: 恢复状态并分派互斥所有权。
- [x] Stage 2: 修复 static-border 的借用结构；同步有证据的 reader/owner 契约；收紧全局写入识别。
- [x] Stage 3: 窄检查收敛后单 owner 生成策略并运行真实 checker，处理实际诊断。
- [x] Stage 4: 验证相关行为、路由及 dist，记录准确的本地结果。

上轮Stage 3未完成的36个定向权限签名已在本次continuation继续处理。最终正式builder和checker均exit0；215 writers、610 bindings，violations/unknown/stale均0，八组冻结基线与可信HEAD一致。最终allowlist通过，原计划本轮剩余项已闭合。此结论为本地验收，不代表远端CI或发布。

## Acceptance criteria

- 不新增全局状态直接写入，不把本地工作进度混入借用状态对象。
- 陈旧执行不能发布，原有取消/worker fallback/分片行为保持。
- 只读声明由对应源码和负例支持；禁止扩大诊断预算或粗放 allowlist。
- 状态策略成功生成，checker 无未知/陈旧 binding 或未解决 violation；历史基线保持冻结，previous authority 来自可信 HEAD。
- Palette 定向回归、受影响 owner 测试、allowlist 检查及必要共享契约检查通过。

## Non-goals

不替换单一 state 对象、不全量迁移 runtime hooks、不改 renderer 产品功能、不推送或发布、不丢弃已有 WIP。

## 2026-09-12 continuation authorized by user

用户要求分派子代理完成原对话剩余批次及未闭合项。保留上述历史计划基线，追加本次范围：

- 一个真实 UI owner 的 hook 注册、替换、释放及必需命令语义；行为测试覆盖旧 owner 清理不能移除新注册。
- 等高线可见集的规则、缓存与失效生命周期整体迁移；维持刷新范围、缓存身份及渲染输出语义。
- 收窄 Palette operation 的状态输入，并以行为和非法依赖/写入负例检验边界。
- 完成既有全局策略的真实生成与检查，保留冻结历史权限；随上述迁移同步精确契约，不新增豁免。
- 比较其他上色入口，只复用实际相同的规则；不同历史/主权/基础色语义保持独立。

并发约束：同目录任务“调查政治地块放大露底问题”正在进行法德高精度试点，使用固定前端快照与独立运行目录。本次不写 data/、map_builder/ 或其 precision 试点输出，不启动性能测量，不操作对方服务。dist 与浏览器检查由主代理在确认资源隔离后统一安排。

## Risks and constraints

共享 contract/policy 仅由 policy 分工修改；完整 builder/checker 只能由该 owner 执行。主代理负责 dist、整合、任务记录及最终声明。已有 `.playwright-mcp/` 保留。
