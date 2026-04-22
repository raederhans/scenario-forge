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

- [ ] `runtime_hooks.js` 完整事件总线替换
- [ ] `state.js` 全量 Phase 0-4 执行
- [ ] 更大范围 renderer / scenario / UI 深层架构切分

## 当前阶段：Lane C

- [x] 在 `boot_state.js` 补最小 boot accessor
- [x] 在 `content_state.js` 补最小 content accessor
- [x] `startup_boot_overlay.js` 切到 boot accessor
- [x] `startup_bootstrap_support.js` 切到 content accessor
- [x] `startup_data_pipeline.js` 切到 content accessor
- [x] `data_loader.js` 显式接收 `currentLanguage`
- [x] `main.js` 切 `bootPreviewVisible` / `startupInteractionMode` 到 boot accessor
- [x] Lane C contract 套件通过
- [x] Lane C node 行为测试通过
- [x] 定性 `startup_bundle_recovery_contract.spec.js` 的最后 1 条失败，当前按旧语义分歧记录
- [x] 进入 `Lane D`

## 当前阶段：Lane D

- [x] `scenario_rollback.js` 拆出 runtime / presentation / palette snapshot helpers
- [x] `scenario_apply_pipeline.js` 拆出 activation / chunk commit helpers
- [x] `scenario_resources.js` 拆出 deferred metadata / optional layer state helpers
- [x] `scenario_manager.js` 收紧 same-scenario early return
- [x] rollback snapshot 补 `activeScenarioMeshPack`
- [x] rollback snapshot 补 `scheduleScenarioChunkRefreshEnabled`
- [x] same-scenario early return 补 manifest/baseline hash/mesh/shell readiness 校验
- [x] `activeScenarioApplyPromise` 提前到 `syncScenarioUi()` 之前建立
- [x] `loadScenarioBundle()` 补 `scenarioId + bundleLevel` in-flight 复用
- [x] reset 后处理改成异步帧后执行
- [x] Lane D contract 套件通过
- [x] Lane D node 行为测试通过
- [x] `scenario_apply_resilience.spec.js` 通过
- [x] `scenario_apply_concurrency.spec.js` 通过
- [x] `scenario_shell_overlay_contract.spec.js` 通过
- [x] Lane D 收口并进入 `Lane E`

## 当前阶段：Lane E1

- [x] `color_state.js` 新增 resolved color / override sanitize 最小 accessor
- [x] `color_state.js` 新增 render normalize accessor，收紧 mirror / sanitize 入口
- [x] `map_renderer.js` 的 `refreshResolvedColorsForFeatures` / `refreshColorState` 写口切到 color accessor
- [x] Lane E1 contract 套件通过
- [x] Lane E1 node 行为测试通过
- [x] 记录 `tno_open_ocean_rendering.spec.js` 当前失败点，先按阈值或运行时产物目录问题待定
- [x] 推进 `spatial index` owner
- [x] 推进 `renderer runtime state`
- [x] 统一 `startup_hydration` readonly 语义尾项
- [x] `tno_ready_state_contract.spec.js` 通过，确认 spatial rebuild + readonly fallback 主合同
- [x] `startup_bundle_recovery_contract.spec.js` 通过，确认 recovery 合同与主合同一致

## 当前阶段：任务包 A

- [x] `scenario_chunk_exact_after_settle_regression.spec.js` 切到 command-driven scenario 进入路径
- [x] `scenario_chunk_exact_after_settle_regression.spec.js` 两条红灯收口
- [x] `scenario_shell_overlay_contract.spec.js` 切到 shared `applyScenarioAndWaitIdle()` 并通过回归
- [x] `python -m unittest tests.test_state_split_boundary_contract tests.test_runtime_hooks_boundary_contract -q`
- [x] `npm run perf:gate`

## 当前阶段：任务包 B

- [ ] `runtime_hooks.js` 到事件总线的 adapter-first 迁移
- [ ] `state/index.js` / `config.js` / `bus.js` / 薄 facade
- [ ] 清理剩余 `import { state }`
- [ ] 删除 `runtime_hooks.js`
- [ ] 收紧 `state-writer-allowlist.json`

## review comment 回修

- [x] 放行 startup continue-without-scenario 里的 `clearActiveScenario`
- [x] 恢复 deferred scenario metadata 在 apply 期间同步进运行态
- [x] reset 延迟后处理补一次显式 render，请求同一轮 UI/overlay 刷新

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

- [x] deferred UI bootstrap 失败态保留到局部 promise 并显式 await
- [x] deferred UI 失败后的 continue 分支先回退 scenario 再继续 base map
- [x] strategic overlay smoke 复跑通过（.runtime/tmp/strategic_overlay_smoke_wave2.out.log）
- [x] perf:gate 复跑通过（.runtime/tmp/perf_gate_wave3.out.log）

- [ ] `js/core/state/config.js` 落地
- [ ] `js/core/state/index.js` 落地
- [ ] `js/core/state/bus.js` 收口成纯 bus + compat glue 改迁出
- [ ] `js/core/runtime_hooks.js` 删除
- [ ] `js/` 下 `runtime_hooks.js` import 清零
- [ ] `js/` 下 `import { state }` 清零
- [ ] `js/` 下 `state.*Fn / *DataFn` 清零
- [x] `js/core/state/config.js` 落地
- [x] `js/core/state/index.js` 落地
- [x] `js/core/state/bus.js` 收口成纯 bus
- [x] `js/core/runtime_hooks.js` 删除
- [x] `js/` 下 `runtime_hooks.js` import 清零
- [x] `js/` 下 `import { state }` 清零
- [x] `js/` 下 `state.*Fn / *DataFn` 清零
- [x] Python / Node 合同验证通过
- [ ] Playwright 最终 gate 复核（当前本地挂起，待单独排查）
- [ ] perf:gate 最终复核（当前本地挂起，待单独排查）
- [x] 修复 `scenario_runtime_state` 错误 import path
- [x] 修复 rollback 对 `scheduleScenarioChunkRefreshFn` 的真实状态快照
- [x] 补回 chunk/lifecycle runtime 对 `{ state }` 调用形态兼容


- [x] 任务包 B：`runtime_hooks.js` 到事件总线的 adapter-first 迁移
- [x] 任务包 B：`state/index.js` / `config.js` / `bus.js` / 薄 facade
- [x] 任务包 B：清理剩余 `import { state }`
- [x] 任务包 B：删除 `runtime_hooks.js`
- [x] 任务包 B：收紧 `state-writer-allowlist.json`
- [x] guardrail：`export_workbench_controller.js` / `workspace_chrome_support_surface_controller.js` 退出 allowlist
- [x] guardrail：`transport_workbench_manifest_preview.js` 与 3 个 node test 的本地 `state` 噪音退出 allowlist
- [x] guardrail：扫描器识别 `state[key] = ...`
- [x] guardrail：`test_state_write_guardrail_contract.py` 增加 computed write 负样例
- [x] contract：scenario resources / sidebar / presentation runtime 合同跟到 helper/bus/runtimeState 真源
- [ ] Playwright 最终 gate 复核（真实环境）
- [ ] perf:gate 最终复核（真实环境）
- [ ] 下一轮 direct state write 大头：`interaction_funnel.js`
- [ ] 下一轮 direct state write 大头：`startup_data_pipeline.js`
- [ ] 下一轮 direct state write 大头：`startup_hydration.js`


- [x] autopilot：复核 `perf:gate`，当前已回绿
- [ ] autopilot：`scenario_shell_overlay_contract.spec.js` full spec 仍存在 runner/harness 结构性挂起，已完成代码面清障与手动路径验证
- [x] 下一轮 direct state write 大头：`interaction_funnel.js` 第一轮收口完成
- [x] 下一轮 direct state write 大头：`startup_data_pipeline.js` 第一轮收口完成
- [x] 下一轮 direct state write 大头：`startup_hydration.js` 第一轮收口完成
- [x] `interaction_funnel_contract.spec.js` 唯一失败用例已补绿
- [x] `startup_bundle_recovery_contract.spec.js`
- [x] `tno_ready_state_contract.spec.js`


- [x] scanner：补 `state.foo ||= / ??= / +=` 这类 dot-member compound write 识别
- [x] shell helper：`applyScenarioAndWaitIdle()` 增加 `forceApply`
- [ ] shell gate：`scenario_shell_overlay_contract.spec.js` full-file runner follow-up
- [x] shell gate：手动路径 `apply -> reset -> clear` 已验证通过
- [x] `interaction_funnel_contract.spec.js` 失败用例 focused rerun 通过
- [x] `startup_bundle_recovery_contract.spec.js`
- [x] `tno_ready_state_contract.spec.js`
- [x] validation：security review 通过
- [x] validation：architect 代码面通过
- [x] validation：code review COMMENT 放行
