# 执行 checklist

## 文档留档与阶段推进

- [x] 原计划链已在 `original_plan_chain.md` 重建
- [x] 真源固定为 `docs/archive/further_split/original/file_split.md`
- [x] 真源固定为 `docs/archive/further_split/original/STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md`
- [x] `README.md` / `plan.md` / `context.md` / `task.md` 已同步切到“修复执行”状态

## 主线 A：strategic overlay 稳定化

- [x] 修 strategic overlay 入口控件可见性
- [x] 修 strategic overlay 入口控件 enabled 状态
- [x] 修 counter 交互链
- [x] 修 strategic-only roundtrip / 导入导出断言漂移
- [x] 补定向回归证据并回填到 active 文档

## 主线 B：perf gate 收口

- [x] 复核 `docs/perf/baseline_2026-04-20.json` 与当前 perf 脚本输入一致
- [x] 复核 `.github/workflows/perf-pr-gate.yml` 与 baseline 场景口径一致
- [x] 调整 PR gate 为 `tno_1962 + hoi4_1939`
- [x] 将 `blank_base` 下调为 observation sample
- [x] 只有证据明确时才追加更深的 perf 修补
- [x] startup scenario apply 与 deferred UI bootstrap 改成并行
- [x] `perf:gate` 回绿（`.runtime/tmp/perf_gate_wave2.out.log`）

## 暂缓到下一阶段

- [ ] `state.js` 全量 Phase 0-4 执行
- [ ] `runtime_hooks.js` 完整事件总线替换
- [ ] 更大范围 renderer / scenario / UI 深层架构切分

## 本轮新增推进

- [x] 新增 `boot_state.js`
- [x] 新增 `content_state.js`
- [x] 新增 `color_state.js`
- [x] 新增 `ui_state.js`
- [x] `state.js` 接入 4 个新 owner/factory
- [x] 新增 runtime hook helper：register/read/call/callMany
- [x] 第一波 hook 注册/调用迁移到 helper
- [x] 新增 state write allowlist guardrail
- [x] Python contract 套件通过
- [x] Node strategic overlay runtime owner test 通过
- [x] strategic overlay smoke 通过
- [x] strategic overlay frontline 通过
- [x] strategic overlay roundtrip 通过
- [x] strategic overlay editing 第一波 `waitForFunction(async ...)` 清理
- [x] strategic overlay editing 稳定化：显式 move update / preset 断言修正 / 可见性等待加固
- [x] strategic overlay editing 全量新日志（`.runtime/tmp/strategic_overlay_editing_wave17.out.log`）
