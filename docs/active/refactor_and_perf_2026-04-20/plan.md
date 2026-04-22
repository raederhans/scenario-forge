# refactor_and_perf_2026-04-20 推进计划

## 当前阶段

- 当前阶段：进入 `Lane C` 执行。
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

### 主线 B：Lane C boot/content accessor

1. `C1` boot accessor：已实现首版。
2. `C2` content accessor：已实现首版。
3. `data_loader.js` 已改成显式接收 `currentLanguage`，切断 startup cache key 对全局 state 的直连。
4. 下一步进入 `Lane D` scenario accessor。

## 执行顺序

1. 已完成 `state.js` 的 4 个 owner/factory 收口。
2. 已完成 `runtime_hooks.js` helper 收口与第一波注册/调用迁移。
3. 已完成 Python contract、Node test、strategic overlay smoke/frontline/roundtrip。
4. 已完成 `strategic_overlay_editing.spec.js` fresh green。
5. 已完成 `perf:gate` 回绿。
6. 已完成 `Lane C` 首版落地，下一步进入 `Lane D`。

## 暂缓事项

1. `Lane D` scenario accessor 迁移。
2. `Lane E` renderer / ui / color accessor 迁移。
3. `runtime_hooks.js` 到事件总线的完整替换。
4. `state/index.js` / `config.js` / `bus.js` / Proxy 门面收口。

## 完成标准

- `state.js` 新 owner/factory 收口稳定。
- runtime hook 注册/调用已集中到 helper。
- `strategic_overlay_editing.spec.js` fresh green。
- `perf:gate` 绿色。
- 可以继续更深的 lane。
