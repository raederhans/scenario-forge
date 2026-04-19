# REFACTOR_ARCHITECTURE_SPLIT_AUDIT_2026-04-19

## 目标
- 核对主计划文档与仓库真实进展是否一致
- 标出已经完成但留档未更新的项目
- 按原计划宗旨整理后续验收和推进顺序

## 本次执行计划
- [x] 锁定主计划文件与相关范围
- [x] 核对 Wave 2 / Wave 3 / Wave 4 勾选项与实际文件、测试、提交痕迹
- [x] 核对验证矩阵与当前测试文件清单是否一致
- [x] 形成后续验收优先级和继续拆分顺序
- [x] 完成审计结论后回填本文件进度

## 审计结论
- 主计划方向仍然对，留档状态明显滞后。
- 当前最适合的动作是先做一次“重基线 gate”，把计划文档、真实代码、验证口径对齐，再进入 `Wave 3`。
- `Wave 3` 继续按原宗旨推进：先 `urban_city_policy`，再 `strategic_overlay_helpers`。

## 已确认的不一致

### 已完成但主计划未同步
- `docs/REFACTOR_ARCHITECTURE_SPLIT_2026-04-17.md:41`
  - `dev_workspace.js -> district_editor_controller.js` 仍未勾选。
  - 证据：
    - `js/ui/dev_workspace/district_editor_controller.js`
    - `js/ui/dev_workspace.js:17-22`
    - `tests/test_dev_workspace_district_editor_boundary_contract.py`
- `docs/REFACTOR_ARCHITECTURE_SPLIT_2026-04-17.md:42`
  - `dev_workspace.js -> dev_workspace_shell_builder.js` 仍未勾选。
  - 证据：
    - `js/ui/dev_workspace/dev_workspace_shell_builder.js`
    - `js/ui/dev_workspace.js:18-22`
    - `tests/test_dev_workspace_shell_builder_boundary_contract.py`
- `docs/REFACTOR_ARCHITECTURE_SPLIT_2026-04-17.md:54`
  - `bootstrap/startup_boot_overlay.js` 仍未勾选。
  - 证据：
    - `js/bootstrap/startup_boot_overlay.js`
    - `js/main.js:3-24,95-112`
    - `tests/test_main_boot_overlay_split_boundary_contract.py`

### 波次归属漂移
- `state_defaults.js`、`startup_bootstrap_support.js`、`startup_boot_overlay.js` 已经落地并接线。
- 它们出现在进度记录里，却没有被主 Wave 清单准确表达。
- 其中：
  - `state_defaults.js` 属于 `Wave 4` 的部分完成
  - `startup_bootstrap_support.js` 应明确归到 `Wave 4`
  - `startup_boot_overlay.js` 应明确归到 `Wave 4`
- `state_catalog.js` 仍未存在，所以 `state.js` 拆分仍是部分完成状态。

### 验证矩阵口径混在一起
- 主计划里的具名测试和脚本路径大多已经存在。
- 当前文档把“文件已落地”和“已经实际跑通”混在同一层，导致验证矩阵长期停在全未勾状态。
- 现阶段更稳的口径是拆成两层：
  - 文件存在
  - 已跑通

### 日期记录混写
- 进度记录只有 `2026-04-17` 一个日期块。
- 实际内容已经混入 `2026-04-18` 和 `2026-04-19` 的提交进展。
- 后续需要按自然日期拆开，避免“当天完成量”失真。

## 当前仍然开放的项
- `js/ui/ui_surface_url_state.js`
- `js/core/renderer/urban_city_policy.js`
- `js/core/renderer/strategic_overlay_helpers.js`
- `js/bootstrap/startup_data_pipeline.js`
- `js/bootstrap/startup_scenario_boot.js`
- `js/bootstrap/deferred_detail_promotion.js`
- `js/core/runtime_hooks.js`
- `js/core/state_catalog.js`
- `.runtime/reports/generated/editor-performance-water-cache-summary.json`

## 已知前置红线
- `js/core/history_manager.js` 的 strategic overlay history 还没覆盖 `operationalLines`。
- 当前 `captureHistoryState(...)` 和 `applyHistorySnapshot(...)` 只覆盖：
  - `annotationView`
  - `operationGraphics`
  - `unitCounters`
- 继续拆 `strategic_overlay_helpers` 前，要先把下面这组合同写清并补齐：
  - `state.operationalLines`
  - 对应 dirty 状态
  - undo/redo 后的 UI refresh 链

## 已批准的后续推进方案

### 重基线 gate
1. 核对并回填已落地项
   - `district_editor_controller.js`
   - `dev_workspace_shell_builder.js`
   - `startup_bootstrap_support.js`
   - `startup_boot_overlay.js`
   - `state_defaults.js`
2. 更新主计划的这 5 个部分
   - `当前结论`
   - `实施计划与进度`
   - `验证矩阵`
   - `当前状态`
   - `进度记录`
3. 明确波次归属
   - `startup_bootstrap_support.js` -> `Wave 4`
   - `startup_boot_overlay.js` -> `Wave 4`
   - `state_defaults.js` -> `Wave 4` 的已完成子项
   - `state_catalog.js` -> 保持未完成
4. 明确未完成项
   - `ui_surface_url_state.js` 当前继续由 `workspace_chrome_support_surface_controller.js` 持有 URL restore 逻辑
   - `operationalLines` history 合同是继续拆分前的前置项

### 验证矩阵新口径
- 文件存在
  - owner 文件存在
  - donor 已接线
  - 对应 boundary / e2e 文件存在
  - 主计划已登记
- 已跑通
  - 写明测试名
  - 写明执行日期
  - 写明结果证据或产物路径

### Wave 3 顺序
1. `urban_city_policy`
   - 先拆城市 / urban 相关策略与 helper
   - 继续让 `map_renderer.js` 保留 facade 与 render transaction owner
2. `strategic_overlay_helpers`
   - 在 `operationalLines` history 合同补齐后再拆
   - 先收 `special zones / operational lines / operation graphics / unit counters` 四类 draw helper

## 进度记录
- 2026-04-19：
  - 已完成静态审计，主计划文件锁定为 `docs/REFACTOR_ARCHITECTURE_SPLIT_2026-04-17.md`。
  - 已确认主计划方向仍然成立，主要问题是勾选、波次归属、验证口径、日期记录漂移。
  - 已形成并通过一轮 ralplan 审核的推进方案：先过重基线 gate，再进入 `Wave 3`。
