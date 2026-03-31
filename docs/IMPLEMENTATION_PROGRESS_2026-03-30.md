# 场景拆分进度留档

日期：2026-03-30

## 1. 记录范围

这份留档只记录到 2026-03-30 当前工作树中已经完成并验证过的前端场景拆分结果。

它承接：
- `docs/IMPLEMENTATION_PROGRESS_2026-03-29.md`
- 2026-03-30 当天完成的第 4 轮和第 5 阶段准备工作

这份文档不覆盖并行中的数据治理改动，也不回写旧留档。

## 2. 已完成的拆分

### 2.1 渲染写入口已经基本收口

主路径业务模块里的直接 `state.renderNowFn()` 已经基本收口，主要完成于：

- `js/main.js`
- `js/ui/sidebar.js`
- `js/core/map_renderer.js`
- `js/ui/dev_workspace.js`
- `js/core/scenario_ownership_editor.js`
- `js/core/history_manager.js`
- `js/ui/shortcuts.js`

当前做法是：

- 业务模块不再自己直接推渲染
- 刷新统一走 `render_boundary`
- 交互入口继续走 `interaction_funnel` 和 `scenario_dispatcher`

### 2.2 场景面板 UI owner 已经从 core 挪到 UI 层

`js/ui/scenario_controls.js` 已经接管场景面板 UI owner。

已完成的变化：

- `state.updateScenarioUIFn` 由 UI 层设置
- 场景下拉、状态文案、audit hint、view mode 和按钮状态由 UI 层渲染
- apply / reset / exit / view mode 切换统一走 dispatcher

这意味着 `scenario_manager` 不再直接绑定场景面板 DOM。

### 2.3 纯辅助逻辑已经拆成 leaf 模块

已经拆出的纯辅助模块：

- `js/core/scenario_owner_metrics.js`
- `js/core/scenario_localization_state.js`

它们当前承接：

- owner / controller 差异统计
- 场景城市覆盖与 geo locale 同步

外部模块不再为了这些 helper 反向依赖整个 `scenario_manager`。

### 2.4 资源入口已经从 `scenario_manager` 的对外边界抽走

已经建立：

- `js/core/scenario_ui_sync.js`
- `js/core/scenario_resources.js`

资源类 API 当前由 `scenario_resources.js` 对外提供：

- `loadScenarioRegistry`
- `loadScenarioBundle`
- `hydrateActiveScenarioBundle`
- `loadScenarioAuditPayload`
- `releaseScenarioAuditPayload`
- `ensureActiveScenarioOptionalLayerLoaded`
- `ensureActiveScenarioOptionalLayersForVisibility`
- `ensureScenarioGeoLocalePatchForLanguage`
- `validateImportedScenarioBaseline`

已经切到这个入口的外部调用面包括：

- `js/main.js`
- `js/ui/i18n.js`
- `js/ui/scenario_controls.js`
- `js/ui/sidebar.js`
- `js/ui/toolbar.js`
- `js/core/interaction_funnel.js`

### 2.5 shell overlay owner 已经拆出

`refreshScenarioShellOverlays(...)` 已经移动到：

- `js/core/scenario_shell_overlay.js`

当前 `scenario_manager` 只导入并调用这个入口，不再作为 shell overlay 逻辑 owner。

### 2.6 fatal / consistency / guard 层已经拆出

以下职责已经移动到：

- `js/core/scenario_recovery.js`

已经抽出的能力包括：

- fatal recovery state 读取与清理
- fatal recovery message 和 error 构造
- runtime consistency 校验
- startup readonly / scenario fatal guard
- resilience 测试用 hook 消费

当前 `scenario_manager` 通过导入使用这些能力，而不是继续在本地定义一份。

## 3. 2026-03-30 当天新增完成的工作

### 3.1 第 4 轮目标已经落地

今天完成了资源层和共享 UI 同步的边界收口：

- `scenario_manager` 不再对外导出资源类 API
- 外部模块已经从 `scenario_resources.js` 读取资源能力
- `scenario_ui_sync.js` 承接共享 UI 同步

### 3.2 第 5 阶段准备中的第一批内部收口已经落地

原计划里“下一步要继续推进的三块”中，已经先把第 1 块做到了可运行状态：

- `scenario_manager` 内部原本还残留一组对旧本地 helper 的直接调用
- 今天已经把启动和 apply/clear 主链路里真正还在使用的资源层 helper 显式改接到 `scenario_resources.js`
- 同时把 resilience 测试里需要的 hook 消费显式改接到 `scenario_recovery.js`

这一步没有再新增一层抽象，只是把缺失的内部依赖接回了真正 owner。

### 3.3 启动回归已经修复

第 4 轮完成后，默认启动场景一度无法激活，根因不是资源下载失败，而是：

- `scenario_manager` 内部还在调用已迁走但未重新导入的 helper
- 具体暴露过的缺失包括：
  - `getScenarioDecodedCollection`
  - `getScenarioTopologyFeatureCollection`
  - `scenarioBundleUsesChunkedLayer`
  - `scenarioBundleHasChunkedData`
  - `ensureRuntimeChunkLoadState`
  - `resetScenarioChunkRuntimeState`
  - `scheduleScenarioChunkRefresh`
  - `applyBlankScenarioPresentationDefaults`
  - `consumeScenarioTestHook`
  - `normalizeCountryCodeAlias`

这些入口现在都已经接回正确 owner，默认启动场景恢复为：

- 启动时先激活 `tno_1962`
- 之后进入 startup readonly 解锁流程
- detail topology 提升完成后正常解锁

## 4. 当前 `scenario_manager` 还剩下什么

到这个时间点，`scenario_manager` 还没有完全缩成“纯事务编排器”，剩余问题主要还有三块。

### 4.1 rollback snapshot 仍然留在事务模块

以下逻辑仍留在 `scenario_manager`：

- `captureScenarioApplyRollbackSnapshot(...)`
- `restoreScenarioApplyRollbackSnapshot(...)`

这部分仍然同时知道：

- 场景状态快照结构
- UI state 恢复
- border / preset / shell / country UI 的恢复顺序

它已经比之前清楚，但还没有成为独立恢复层 owner。

### 4.2 shell 相关的局部几何辅助仍有少量遗留

虽然 `refreshScenarioShellOverlays(...)` 本体已经拆走，但 `scenario_manager` 和 `scenario_resources` 内还残留少量历史 backfill 与邻接辅助逻辑。

这部分不是当前主阻塞，但说明 shell 语义相关工具还没有完全归并到最终 owner。

### 4.3 事务模块仍承担较多派生刷新职责

当前 `scenario_manager` 仍直接编排：

- border refresh
- country UI sync
- preset rebuild
- shell overlay refresh 调用
- 场景退出后的展示状态恢复

这些职责虽然已经比之前集中得多，但还没有继续拆成更细 owner。

## 5. 风险与推荐顺序

### 5.1 下一步最稳的是先拆 rollback snapshot

原因：

- 它是 `applyScenarioBundle(...)` 中剩余最重的一块
- 它已经有清楚的输入输出边界
- 它正好被 `scenario_apply_resilience.spec.js` 直接覆盖

建议下一轮优先把 snapshot capture / restore 收成单独恢复层模块。

### 5.2 shell 局部 helper 其次

这一步的收益是继续清理历史遗留几何工具函数，但对主业务行为的直接收益低于 rollback snapshot。

建议在 rollback 层稳定之后，再评估是否把这组 helper 彻底归并到 `scenario_shell_overlay.js`。

### 5.3 更细的派生刷新拆分放最后

把 border、preset、country UI、display restore 再继续拆开，主要收益是继续缩短事务主体。

这一步影响面更广，应放在 rollback 层独立之后。

## 6. 已验证结果

### 6.1 静态契约

以下检查已通过：

- `python -m unittest tests.test_scenario_manager_boundary_contract -q`
- `python -m unittest tests.test_scenario_resources_boundary_contract -q`
- `python -m unittest tests.test_frontend_render_boundary_contract -q`

### 6.2 关键 E2E

以下回归已通过：

- `npm run test:e2e -- tests/e2e/scenario_controls_dispatcher_contract.spec.js --reporter=list --workers=1`
- `npm run test:e2e -- tests/e2e/interaction_funnel_contract.spec.js --reporter=list --workers=1`
- `npm run test:e2e -- tests/e2e/dev_workspace_i18n.spec.js --reporter=list --workers=1`
- `npm run test:e2e -- tests/e2e/scenario_apply_resilience.spec.js --reporter=list --workers=1`

其中今天重点确认过两件事：

- 默认启动场景 `tno_1962` 能再次正常激活
- `scenario_apply_resilience.spec.js` 三条 resilience 回归继续全绿

## 7. 下一阶段进入条件

只有在以下条件都满足后，才适合继续拆下一轮：

- 当前静态契约继续全绿
- 场景相关定向 E2E 继续通过
- 不因为继续拆分而重新把资源能力塞回 `scenario_manager`
- 不触碰并行中的数据治理文件与 `data/` 产物

到 2026-03-30 为止，更准确的阶段判断是：

- 渲染写入口收口已经基本完成
- 场景面板 UI owner 拆分已经完成
- 纯辅助逻辑拆分已经完成
- 资源层对外边界拆分已经完成
- shell / fatal / consistency owner 拆分已经完成第一阶段
- `scenario_manager` 内部对新 owner 的关键接线已经补齐
- rollback snapshot 仍是下一轮最值得继续处理的核心剩余块
