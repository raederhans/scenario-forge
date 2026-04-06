# Agent Tiers

这个文件只做一件事：给仓库里的多代理执行一个统一 tier 口径，避免每轮都临时猜。

## LOW
- 用途：只读查找、路径定位、单点 grep、轻量事实核对
- 典型任务：
  - 某个符号在哪
  - 某段逻辑是不是还在
  - 某个测试文件覆盖了什么
- 默认要求：
  - 不跑长测试
  - 不做跨文件设计决策

## STANDARD
- 用途：常规实现、局部重构、定向测试补齐、普通 code review
- 典型任务：
  - 改一组明确拥有权文件
  - 补一个 targeted test
  - 做一轮中等复杂度的功能收口
- 默认要求：
  - 改动范围明确
  - 先守住现有 contract
  - 有对应验证命令

## THOROUGH
- 用途：跨模块收口、架构边界判断、复杂回归分析、最终验收
- 典型任务：
  - 多阶段 UI / 数据 /状态收口
  - 验证是否越界到别的 phase
  - architect / reviewer 最终复核
- 默认要求：
  - 明确写出边界
  - 分清已证实事实与推断
  - 验证必须基于新鲜证据

## 选用规则
- 只读路径/符号/关系查找：`LOW`
- 单拥有者文件实现、补测试、普通修复：`STANDARD`
- 跨文件收口、复杂验证、最终验收：`THOROUGH`

## Ralph 默认 tier 口径
- 普通实现 lane：默认 `STANDARD`
- 验证 / 验收 lane：默认至少 `STANDARD`
- 跨 phase 边界判断、架构复核、最终 sign-off：必须 `THOROUGH`

## 当前仓库补充规则
- 父子代理不得同时跑 live test
- 长测试只由主线程独占执行
- 共享文件 `index.html`、`css/style.css`、`js/ui/toolbar.js` 默认按单拥有者串行集成

## 共享文件最终集成规则
- `index.html`、`css/style.css`、`js/ui/toolbar.js` 只能由主线程或明确单拥有者做最终串行集成
- 子代理可以各自改独占文件，但不能同时改这 3 个共享文件

## leader / worker handoff 规则
- worker 完成后必须回传：
  - 修改文件
  - 目标是否完成
  - 剩余阻塞点
  - 建议验证命令
- leader 负责：
  - 读取 worker 结果
  - 做共享文件串行合并
  - 统一跑 live tests
  - 做最终 architect / reviewer 验收

## 多代理启动前必看文件
- `lessons learned.md`
- 当前任务对应的执行计划文档
- 如果是 UI rework：
  - `docs/UI_REWORK_EXECUTION_PLAN_01_FOUNDATION_AND_CONTRACTS_2026-04-05.md`
  - `docs/UI_REWORK_EXECUTION_PLAN_02_MAINLINE_SHELL_AND_SIDEBAR_2026-04-05.md`
  - `docs/UI_REWORK_EXECUTION_PLAN_03_SUPPORT_SURFACES_TRANSPORT_AND_HARDENING_2026-04-05.md`

## 收尾前最低验证要求
- 相关改动文件 `lsp_diagnostics` 为 0
- 当前 phase 对应的 Python unittest 通过
- 当前 phase 对应的 targeted e2e 通过
- 如果改动碰到共享 contract，前序 phase 的 contract / mainline 回归也要一起过

## 必须升级到 THOROUGH 的情况
- 改动跨两个以上 phase 的边界
- 改动共享 contract
- 改动共享文件 `index.html`、`css/style.css`、`js/ui/toolbar.js`
- 做最终收尾验收

## 什么算真正收尾
- 当前 phase 的目标已完成
- 没有把下一 phase 的内容提前拉进来
- 没有留下当前仓库内本轮可立即修掉的风险
- 文档进度、测试、实现边界三者一致
