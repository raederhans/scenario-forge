# Color Library 改进计划

## Summary

- 审计主体成立：颜色库默认收起、`#themeSelect` 残留、source tab DOM 缺失、搜索清空缺失、行双击缺失、颜色状态多映射并存。
- 两处修正：`paletteLibrarySources` 逻辑和 CSS 已存在，缺 DOM 接线；单点改色已有 partial invalidation，全量 refresh 主要在 reset / scenario / rebuild 路径。
- 浏览器证据：控制台有既有地图/physical/scenario warning；网络失败 0；截图在 `.runtime/browser/mcp-artifacts/color-library-plan/initial.png` 和 `open.png`。

## Key Changes

### 阶段一：Color Library shell contract

触点：`index.html`、`css/style.css`、`js/ui/toolbar.js`、`js/ui/toolbar/palette_library_panel.js`、`js/ui/toolbar/appearance_controls_controller.js`、`js/ui/i18n.*`。

- 默认展开颜色库：`paletteLibraryOpen` 改为默认打开，初始化时同步 `aria-expanded`、panel visibility、列表高度。
- 接上 source tabs：新增 `#paletteLibrarySources`；source tab 成为可见主入口；`#themeSelect` 保留并隐藏，同步 value 和 options 一个兼容周期。
- source switch 合约：tab 调 `setActivePaletteSource(..., { overwriteCountryPalette:false })`；更新 active palette、library entries、quick swatches、resolved defaults；保留 `visualOverrides` / `sovereignBaseColors` 等用户 edits；这类切源动作本身无 history / undo。
- recent / quick swatches：dock 快速色板默认可见；recent 容器保留固定位置；颜色库顶部增加 Recent 分组，读取现有 `recentColors`。
- 搜索体验：增加清空按钮、Esc 清空、空结果建议文案；新增文案进 i18n。
- 行交互：单击只选色和更新 swatch；双击先选色，再应用到当前 visual target。
  - 目标优先级：`devSelectedHit` land → `hoveredId` land → `selectedInspectorCountryCode` owner。
  - subdivision 写 `visualOverrides`，history/dirty reason 用 `palette-library-apply-color`。
  - owner 写 `sovereignBaseColors`，history/dirty reason 用 `palette-library-apply-owner-color`。
  - 无目标时只显示提示，无状态写入。
- 键盘：列表用 roving tabindex；↑↓ 移动行；Enter 等同双击应用；列表内 Esc 折叠，搜索框内 Esc 清空。
- 视觉统一：抽 `--color-swatch-size`、`--color-swatch-gap`、`--color-swatch-radius`，library 与 dock 共用。

### 阶段二：Color state contract

触点：`js/core/map_renderer.js`、`js/core/color_resolver.js`、`js/core/state/color_state.js`、`js/core/logic.js`、`js/core/file_manager.js`、`js/core/history_manager.js`、`js/core/scenario_rollback.js`、`js/core/scenario/lifecycle_runtime.js`、`js/core/scenario_apply_pipeline.js`、`js/core/interaction_funnel.js`、`js/core/sovereignty_manager.js`、`js/ui/sidebar.js`。

- 从现有 `map_renderer.js#getResolvedFeatureColor()` 抽出 `resolveFeatureColor(featureId, ctx)`，返回 `{ color, source, featureId, ownerCode }`。
- 第一批迁移读路径：renderer fill、sidebar country color、eyedropper、palette library apply preview。
- 第二批迁移写路径：集中 owner/feature 写口，保持 history、dirty、partial invalidation 语义。
- 字段真源：
  - owner base 真源：`sovereignBaseColors`
  - feature override 真源：`visualOverrides`
  - compatibility 字段：`countryBaseColors`、`featureOverrides` 保留一个兼容周期，由导入/导出/旧项目恢复层生成
  - resolved render cache：`colors`
  - palette default cache：`fixedPaletteColorsByIso2`、`resolvedDefaultCountryPalette`
  - water/special：`waterRegionOverrides`、`specialRegionOverrides` 保持独立
- 移除 render 前的 `syncPlainObjectMirror` 依赖，把镜像维护收口到兼容 normalizer。

### 阶段三：Verification / perf gate

最小验证命令按计划执行，resolver 或 invalidation 行为变更后追加 perf contract。
