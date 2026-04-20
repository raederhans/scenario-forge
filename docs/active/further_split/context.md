# further_split execution context

## 当前代码事实
- `js/core/state.js` 已经接入 `state_catalog.js` 和 `runtime_hooks.js`，并继续导出 compat surface。
  - 证据：`js/core/state.js:23-31,108,649`
- `js/core/state_catalog.js` 已存在，当前只承接 releasable catalog / scenario audit 默认 shape。
  - 证据：`js/core/state_catalog.js:1-27`
- `js/core/runtime_hooks.js` 已存在，当前只承接显式 runtime hook 默认槽位。
  - 证据：`js/core/runtime_hooks.js:1-76`
- `scenario_manager.js` 和 `scenario_ui_sync.js` 已经消费 `state_catalog` factory。
  - 证据：`js/core/scenario_manager.js:1,1274`、`js/core/scenario_ui_sync.js:1,6`
- `main.js`、`toolbar.js`、`sidebar.js`、`dev_workspace.js` 仍通过 `state.*Fn` 挂接 runtime hooks。
  - 证据：`js/main.js:59,219`、`js/ui/toolbar.js:988,1071,1074,1140`、`js/ui/sidebar.js:5362`、`js/ui/dev_workspace.js:1051`
- `scenario` owner 已落地，`scenario_manager.js` / `scenario_resources.js` 已改为 owner + facade 结构。
  - 证据：`js/core/scenario_manager.js:143`、`js/core/scenario_resources.js:81,84,116`
- `map_renderer.js` 已接入 `urban_city_policy.js` 和 `strategic_overlay_helpers.js` owner。
  - 证据：`js/core/map_renderer.js:65-66`

## 已被旧文档证伪的点
- `state_catalog.js` 和 `runtime_hooks.js` 早已存在。
- “当前第一步是 Phase 0 护栏 + Proxy + 视觉基线” 已经和当前 approved plan 脱节。
- “最终删除 runtime_hooks.js，统一改 bus” 目前没有进入已批准执行清单。
- “直接按 8 slices + Proxy facade + bus 推进” 目前属于远期候选，不是眼前顺序。
- 验证口径已经以结构合同和静态边界为主，文档里原来的 Phase / E2E 基线表述过重。

## 当前留档应表达的方向
1. `scenario` 继续作为最前面的进一步拆分入口。
2. `runtime_hooks/state ownership` 继续沿着 owner + singleton facade 收口。
3. `renderer API` 作为后续一层，围绕稳定 facade 和 owner 接线合同推进。

## 本次改动注意点
- Batch 1 已完成，当前已经接上 Batch 2。
- `scenario` presentation 重复事务现在由 `js/core/scenario/presentation_runtime.js` 统一承接。
- `scenario` lifecycle reset / clear 事务现在由 `js/core/scenario/lifecycle_runtime.js` 统一承接。
- `scenario_manager.js` 继续保留 facade、single-flight、rollback、fatal recovery 和对外导出。
- `scenario_resources.js` 继续保留 stateless parser consumer。

## 2026-04-20 Batch 1 落地结果
- 新增 `js/core/scenario/presentation_runtime.js`
  - 导出 `normalizeScenarioPerformanceHints`
  - 导出 `createScenarioPresentationRuntime`
- `scenario_manager.js` 已删除本地重复的 presentation helper，改成：
  - `createScenarioPresentationRuntime({ state, invalidateOceanBackgroundVisualState })`
  - 解构得到 `applyScenarioPerformanceHints`
  - 解构得到 `restoreScenarioDisplaySettingsAfterExit`
  - 解构得到 `restoreScenarioOceanFillAfterExit`
  - 解构得到 `syncScenarioOceanFillForActivation`
- `scenario_resources.js` 已删除本地重复 helper，只保留对 `normalizeScenarioPerformanceHints` 的 stateless 复用。

## 2026-04-20 Batch 2 落地结果
- 新增 `js/core/scenario/lifecycle_runtime.js`
  - 导出 `createScenarioLifecycleRuntime`
  - owner 内部承接：
    - `syncScenarioInspectorSelection`
    - `disableScenarioParentBorders`
    - `restoreParentBordersAfterScenario`
    - `applyScenarioPaintMode`
    - `restorePaintModeAfterScenario`
    - `resetToScenarioBaseline`
    - `clearActiveScenario`
- `scenario_manager.js` 已把 reset / clear 收成 facade wrapper：
  - 继续保留 `assertScenarioInteractionsAllowed(...)`
  - 继续保留 `showToast` / `t` 注入
  - 继续保留 apply single-flight、rollback、fatal recovery、bundle load 编排
- `scenario_apply_pipeline.js` 继续只消费 lifecycle helper：
  - `syncScenarioInspectorSelection`
  - `disableScenarioParentBorders`
  - `applyScenarioPaintMode`
- `scenario_apply_pipeline.js` 不再重写 `state.defaultRuntimePoliticalTopology`
  - 这样 clear 后的 blank baseline 不会被场景 runtime topology 污染
- `scenario_resources.js` 已删除死副本 `syncScenarioInspectorSelection`
- `tests/e2e/scenario_shell_overlay_contract.spec.js` 已按当前 codebase truth 修正：
  - shell helper id 从 `scenarioAutoShell*` map 读取
  - 不再从 `state.landData` 读取 `RU_ARCTIC_FB_*`
  - 这和 `scenario_boundary_regression.spec.js` 里 “interactive land 不含 helper features” 的合同一致

## 2026-04-20 验证证据
- 结构合同
  - `python -m unittest tests.test_scenario_manager_boundary_contract tests.test_scenario_resources_boundary_contract tests.test_scenario_presentation_runtime_boundary_contract`
  - 结果：`Ran 21 tests in 0.019s / OK`
- 静态检查
  - `node --check js/core/scenario/presentation_runtime.js`
  - `node --check js/core/scenario_manager.js`
  - `node --check js/core/scenario_resources.js`
  - 结果：3 个文件全部通过
- 定向 smoke
  - `npm run test:e2e:scenario-resilience`
  - 结果：`3 passed (58.7s)`
  - 日志：
    - `.runtime/tmp/scenario_presentation_batch1.smoke.out.log`
    - `.runtime/tmp/scenario_presentation_batch1.smoke.err.log`
    - `.runtime/tmp/scenario_presentation_batch1.smoke.exit.txt`

## 2026-04-20 Batch 2 验证证据
- 结构合同
  - `python -m unittest tests.test_scenario_manager_boundary_contract tests.test_scenario_resources_boundary_contract tests.test_scenario_presentation_runtime_boundary_contract tests.test_scenario_lifecycle_runtime_boundary_contract`
  - 结果：`Ran 24 tests in 0.025s / OK`
- 静态检查
  - `node --check js/core/scenario/lifecycle_runtime.js`
  - `node --check js/core/scenario_manager.js`
  - `node --check js/core/scenario_resources.js`
  - `node --check js/core/scenario_apply_pipeline.js`
  - `node --check tests/e2e/scenario_shell_overlay_contract.spec.js`
  - 结果：全部通过
- 定向 smoke
  - `node node_modules/@playwright/test/cli.js test tests/e2e/scenario_blank_exit.spec.js tests/e2e/scenario_shell_overlay_contract.spec.js --reporter=list --workers=1 --retries=0`
  - 结果：`2 passed (2.7m)`
  - 日志：
    - `.runtime/tmp/scenario_lifecycle_batch2_green.smoke.out.log`
    - `.runtime/tmp/scenario_lifecycle_batch2_green.smoke.err.log`
    - `.runtime/tmp/scenario_lifecycle_batch2_green.smoke.exit.txt`
- 诊断辅助证据
  - `.runtime/tmp/inspect_scenario_shell.spec.js`
  - `.runtime/tmp/inspect_blank_exit.spec.js`
  - `.runtime/tmp/playwright.inspect.config.cjs`

## 2026-04-20 Batch 2 review follow-up 修复
- review 暴露两条真实回归，已按当前代码最短路径修复。
- `js/core/scenario/lifecycle_runtime.js`
  - clear 路径恢复 base map detail 状态时，改成按 `state.topologyDetail` 是否已就绪决定：
    - `topologyBundleMode`
    - `detailDeferred`
    - `detailPromotionCompleted`
  - 这样 startup coarse + deferred baseline 在退出 scenario 后会继续保留 deferred promotion 资格。
- `js/core/scenario/lifecycle_runtime.js`
  - reset 路径在 `runPostScenarioResetEffects()` 前先执行 `recalculateScenarioOwnerControllerDiffCount()`。
  - 这样 `syncCountryUi()` 首次刷 `updateScenarioContextBarFn()` 时就会拿到新的 split count。
- `js/core/scenario_manager.js`
  - reset facade 不再在 runtime 返回后补算 split count；计算顺序已经下沉到 lifecycle owner。
- 新增行为验证
  - `tests/scenario_lifecycle_runtime_behavior.test.mjs`
  - 覆盖：
    - deferred coarse baseline clear 后继续保留 `detailDeferred=true`
    - 已加载 detail baseline clear 后继续保持 `composite`
    - reset 首次 UI side effect 前已完成 split count 重算
