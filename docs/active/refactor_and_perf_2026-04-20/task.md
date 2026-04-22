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

