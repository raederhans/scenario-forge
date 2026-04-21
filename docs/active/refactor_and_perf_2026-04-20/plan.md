# refactor_and_perf_2026-04-20 推进计划

## 当前阶段

- 当前阶段：修复执行已收口。
- 原计划链真源：见 `original_plan_chain.md`。
- 当前任务目标：在不扩 scope 的前提下，完成 `state / runtime_hooks` 第一波推进，并补齐 `strategic overlay + perf gate` 的双绿验证。

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

### 主线 B：perf 回归调查

1. 保持 `docs/perf/baseline_2026-04-20.json` 作为机器真源。
2. 复跑 gate，确认回归存在于 `startup/apply` 热路径。已完成。
3. `deferred UI bootstrap` 已从 startup scenario apply 计时窗中并行化。已完成。
4. `perf:gate` 已回绿，下一步可以继续 Lane C-E。

## 执行顺序

1. 已完成 `state.js` 的 4 个 owner/factory 收口。
2. 已完成 `runtime_hooks.js` helper 收口与第一波注册/调用迁移。
3. 已完成 Python contract、Node test、strategic overlay smoke/frontline/roundtrip。
4. 已完成 `strategic_overlay_editing.spec.js` fresh green。
5. 已完成 `perf:gate` 回绿。
6. 下一步进入 Lane C-E。

## 暂缓事项

1. `Lane C` boot/content accessor 迁移。
2. `Lane D` scenario accessor 迁移。
3. `Lane E` renderer / ui / color accessor 迁移。
4. `runtime_hooks.js` 到事件总线的完整替换。

## 完成标准

- `state.js` 新 owner/factory 收口稳定。
- runtime hook 注册/调用已集中到 helper。
- `strategic_overlay_editing.spec.js` fresh green。
- `perf:gate` 绿色。
- 可以继续更深的 lane。
