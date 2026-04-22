# refactor_and_perf_2026-04-20 推进计划

## 当前阶段

- 当前阶段：任务包 A 已完成，下一步进入 `runtime_hooks.js` 到事件总线的完整替换。
- 原计划链真源：见 `original_plan_chain.md`。
- 当前任务目标：按 `Lane C -> Lane D -> Lane E` 顺序推进 accessor 迁移，并把日常验证压到 contract + node + targeted e2e。

## 已完成前置

1. 文档与工作区收口已完成。
2. `map_renderer/public.js` facade 与 app/UI importer 迁移已完成。
3. Step 0 perf baseline 已完成。
4. Step 1 triage 已完成，问题面已经定位。
5. Step 2、Step 3、Step 5 的首版实现已落地。

## 当前主线

### 主线 A：state / runtime_hooks 第一波

1. `Lane A` state owner/factory 收口。已完成。
2. `Lane B` runtime hook helper 收口。已完成。
3. 合同测试与 targeted 回归。已完成，并已补齐 `editing` 全量新日志。

### 主线 B：Lane C / Lane D 已收口

1. `C1` boot accessor：已实现首版。
2. `C2` content accessor：已实现首版。
3. `data_loader.js` 已改成显式接收 `currentLanguage`，切断 startup cache key 对全局 state 的直连。
4. `Lane D` scenario accessor 已完成，stage gate 已通过。

### 主线 C：Lane E1 renderer 低耦合 seam

1. 先做 `refreshResolvedColorsForFeatures` / `refreshColorState`。已实现首版 state 写口收口。
2. 再做 `spatial index` owner 与 `renderer runtime state`。已完成首版收口。
3. `startup_hydration` readonly 语义尾项已统一到 editable fallback 口径。

## 执行顺序

1. 已完成 `state.js` 的 4 个 owner/factory 收口。
2. 已完成 `runtime_hooks.js` helper 收口与第一波注册/调用迁移。
3. 已完成 Python contract、Node test、strategic overlay smoke/frontline/roundtrip。
4. 已完成 `strategic_overlay_editing.spec.js` fresh green。
5. 已完成 `perf:gate` 回绿。
6. 已完成 `Lane C` 首版落地。
7. 已完成 `Lane D` runtime bug 修复与 stage gate 收口。
8. `Lane E` 三点已完成，下一步进入 `runtime_hooks.js` 到事件总线的完整替换。

## 暂缓事项

1. `runtime_hooks.js` 到事件总线的完整替换。
2. `state/index.js` / `config.js` / `bus.js` / Proxy 门面收口。
3. 剩余 `import { state }` 与 `state.*Fn` / `*DataFn` 清零。

## 完成标准

- `state.js` 新 owner/factory 收口稳定。
- runtime hook 注册/调用已集中到 helper。
- `strategic_overlay_editing.spec.js` fresh green。
- `perf:gate` 绿色。
- 可以继续更深的 lane。

## 2026-04-22 任务包 B 实施补记

- 本轮直接按既有批准计划推进 `B1 -> B2 -> B3`，不再重开方案讨论。
- 实施策略：保留最小 compat surface，删除 `runtime_hooks.js` 文件本体，把 helper/compat 收口到 `js/core/state/index.js`，`bus.js` 只保留纯事件总线能力，`config.js` 收口 hook 名称与事件名常量。
- 生产代码目标：
  1. `js/` 下清零 `runtime_hooks.js` import
  2. `js/` 下清零 `import { state }`
  3. `js/` 下清零 `state.*Fn / *DataFn`
- 外部兼容目标：保留 state compat 属性 setter/getter，让现有 e2e 里直接读写 `window.state.*Fn` 的用法还能工作一轮。


## 2026-04-22 后续推进补记

- 任务包 B 主实现已经完成，当前阶段改成“guardrail 收紧 + 合同跟真源”。
- 本轮目标：
  1. 缩小 `state-writer-allowlist.json`
  2. 让扫描器识别 `state[key] = ...`
  3. 把 sidebar / presentation / scenario resource 相关 contract 跟到 helper/bus/runtimeState 真源
- 本轮完成后，下一步顺序固定为：
  1. 用真实环境复核 `scenario_shell_overlay_contract.spec.js`
  2. 用真实环境复核 `npm run perf:gate`
  3. 再开下一轮，处理 `interaction_funnel` / `startup_data_pipeline` / `startup_hydration` 这三个 direct state write 大头


## 2026-04-22 autopilot 进度补记

- environment gate 当前状态：
  1. `scenario_shell_overlay_contract.spec.js` 已从代码启动回归推进到 runner/harness 结构问题排查态
  2. `npm run perf:gate` 已回绿
- direct state write 大头推进已完成一轮：
  1. `interaction_funnel.js` 大幅减量
  2. `startup_data_pipeline.js` 清零
  3. `startup_hydration.js` 压到 1 处残余
- 下一步收尾顺序：
  1. 完成多视角 review
  2. 文档收口
  3. 若确认 shell gate 仍属 runner 结构问题，则把本轮代码部分按已完成收口，单列后续问题单


## 2026-04-22 autopilot 最终状态

- 代码主线已完成：
  1. `interaction_funnel` 第一轮 owner/helper 收口
  2. `startup_data_pipeline` direct write 清零
  3. `startup_hydration` 压到 1 处残余
- 验证主线：
  1. `perf:gate` 已通过
  2. `startup_bundle_recovery_contract.spec.js` 已通过
  3. `tno_ready_state_contract.spec.js` 已通过
  4. `scenario_shell_overlay_contract.spec.js` full-file runner 仍未收口，当前单列 follow-up
- 下一步最短路径已经收敛成两件事：
  1. `interaction_funnel` 继续做最终 owner 化
  2. Playwright shared helper / shell gate runner follow-up
