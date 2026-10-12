# Plan

## Goal

完成用户于 2026-10-10 授权的三个目标：事件接口依赖收窄、chunk runtime 事务边界整理、启动缓存并行读取验证。保持产品功能、视觉结果、保存格式及异步安全语义。

后续授权：查清并修复 13 条既有状态策略 schema 错误。保留严格检查、历史 provenance、权限与预算，避开并行栅格工作；完成后给出下一阶段方向。

继续授权：依次完成状态策略整体一致性、一个启动资源领域的状态输入收窄、缓存/解码/worker 分段测量与有证据支持的优化。保留已有 78 路径 WIP；不扩展到栅格、数据或部署。

最新范围选择：先修独立模块，栅格对话收尾后统一验收。先完成 content readiness 和 quick-fill 依赖边界；共享 renderer／栅格写入与资源证明留到最终 diff 确定后处理，不在当前阶段重跑全仓 gate。

## Scope

- 基于 `codex/architecture-simplification-20261010` 继续工作，保留首轮 20 文件 import 整理。
- 事件实现从领域 re-export 中分离；旧 `state/index.js` API 与注册表身份保留。
- 只整理 chunk 的 continuation、提交与回滚权限和重复判断，不改栅格、renderer 实现或地理数据。
- topology/localization cache 独立读取并行；保留所有状态、错误、worker 与 fallback 行为。
- 同步实际受影响的验证路由与源码边界契约，不放宽状态规则或历史预算。

## Sources of truth

- [首轮审查](../../architecture-simplification-20261010.zh-CN.md)。
- `js/core/state/index.js`、`js/core/scenario/chunk_runtime.js`、`js/core/data_loader.js`。
- 原有 runtime hook、chunk promotion、startup cache 行为测试与源码契约。

## Stages

- [x] 事件轻量入口、调用方迁移、兼容与生命周期验证。
- [x] chunk 事务读写/await 边界明确，收敛重复判断，验证过期、回滚与锁归属。
- [x] cache 两路读取并行、独立失败测试、真实浏览器缓存测量。
- [x] 主代理串行运行聚焦浏览器验证、架构/源码图/路由检查，核对与栅格工作边界。
- [x] 修复 12 条 successor 契约身份失配和 1 条 urban callback 迁移未落账；同时同步共用 hover 调用的记录，验证真实调用链、历史保护及篡改拒绝。
- [x] 更新交付计划与后续架构方向。
- [x] 第四批局部修复：恢复 7 文件的 8 条 import，58 个 capability 退役契约及拒绝测试通过，取得官方全仓失败报告并查明主要遗留来源。
- [ ] 第四批完整 gate：首轮官方 checker 有 3,978 条诊断；已继续处理必要历史元数据，不能据此宣称整体一致性完成。
- [x] 第五批：复用已有城市本地化合并边界，完成改前/改后行为与策略增量对照；不新增整 state query 或权限。
- [x] 第六批：完成真实 IDB、解码和 worker 分段测量与结果等价性检查；确认跨线程路径成本，暂不改变 worker 调度。
- [x] 第七批前置修复：7 个 action 精确借用证明与返回别名跟踪、41 个标量断言入参收窄；冻结预算和产品源码不变。
- [x] 第二轮只读重建退出并完成诊断分类：895 条、457 个唯一语义签名；未生成候选，不能更新冻结准入。
- [x] 第八批独立模块：content readiness canonical action、quick-fill 实时窄输入和精确 reader 证明。
- [x] 导出预览私有 reader 精确证明，以及 checker 自模块源码绑定漏检的修复和反例验证。
- [ ] 栅格收尾后收敛共享写入/资源契约，运行统一 builder、checker 与目标行为验收。

## Acceptance criteria

旧入口和新入口共享同一 bus、hook 注册表与对象身份；必需命令、可选通知和 owned hook 释放不变。Chunk 保留各异步边界原有的场景/请求/代际/选择身份判断；旧任务不能发布、回滚或解锁新任务。缓存读取必须在两路完成后进入解码，各路失败互不吞并。性能只报告测量区间的结果，未提升也如实记录。

## Non-goals

全局状态框架替换、栅格交互/资产/缩放画质、数据重建、生产发布。最新授权的整体策略一致性包含必要的历史元数据修复，不包含回退已提交产品功能或绕过历史证明。

## Risks and constraints

另一对话在 `C:/Users/raede/.codex/worktrees/political-raster-integration/mapcreator` 修改栅格；不写其工作区，也不改本分支 `map_renderer.js`。Root 独占共享工具、文档、Git、浏览器/服务/长检查；子代理只能运行自己的短目标测试。最终分支整合尚未进行，不能宣称与未完成栅格分支联合验收。
