# QA-022: Projection Wrap Artifact Fix + Right Sidebar UI Alignment

**Date:** 2026-02-23  
**Environment:** `http://127.0.0.1:8000/` (Edge via Playwright MCP)  
**Related:** `./021_projection_wrap_artifact_regression.md`

---

## 1) 修复点清单（按文件）

### `js/core/data_loader.js`
- 移除默认 `.bak` 隐式自动回退。
- 新增 `resolveTopologyVariant()`，仅支持显式 URL 参数：
  - `?topology_variant=highres`
  - `?topology_variant=legacy_bak`
- 默认路径下仅加载 `data/europe_topology.json`，并输出禁用自动回退日志。
- 未知 `topology_variant` 值会被忽略并告警。

### `js/core/map_renderer.js`
- 新增异常几何统一过滤链路：
  - `isKnownBadFeatureId()`（内置 3 个已定位 RU 异常 ID）
  - `isProjectedWrapArtifact()`（基于 projected bbox 覆盖率/纵横比检测）
  - `shouldSkipFeature()`（统一决策入口）
- 新增 `getRenderableLandFeatures()` 供投影拟合使用。
- 将过滤逻辑统一应用到：
  - `fitProjection()`（避免异常几何拉坏投影）
  - `drawCanvas()`（避免遮罩覆盖可视层）
  - `buildSpatialIndex()`（避免异常几何参与命中）
  - `autoFillMap()`（避免异常几何污染颜色分配）
- 调整 allowlist 语义：仅在“可信 admin0 外壳”场景下豁免，不再仅凭国家码放行所有子地块。

### `js/ui/sidebar.js`
- 右栏底部动态区块改用项目内统一样式体系（不再使用未定义 utility class）：
  - `Project Management`
  - `Legend Editor`
  - `Debug Mode`
- `Project Management` 增加说明文案与“已选文件名”状态行。
- 上传流程保持原功能（按钮触发隐藏 `file` input），并在选择文件后更新文件名显示。
- `Legend Editor` 空状态改为统一卡片提示样式。

### `css/style.css`
- 新增右栏底部模块专用样式类：
  - `.sidebar-tool-card`
  - `.sidebar-tool-title`
  - `.sidebar-tool-hint`
  - `.project-file-meta`
  - `.project-file-name`
  - `.legend-empty-state`
- 新增 `.sidebar-tool-card-debug` 使 debug 区块与现有风格一致。
- 新增 `.hidden { display: none !important; }`，修复隐藏控件退化问题。

### `js/ui/i18n.js`
- 补充新增 UI 文案节点映射：
  - `lblProjectHint`
  - `lblProjectFile`
  - `lblLegendHint`

---

## 2) 前后行为对比

### 地图渲染与填色
- **Before (QA-021):**
  - 默认加载会因“主拓扑过粗”自动回退 `.bak`（8305 features）。
  - 出现大白/大蓝椭圆遮罩，地图主体被压缩，autofill 视觉失效。
- **After (QA-022):**
  - 默认加载固定主拓扑（199 features），不再触发 `.bak` 隐式回退。
  - 初始渲染不再出现巨型遮罩。
  - `Auto-Fill Countries` 后可见多色分布，视觉与交互恢复正常。

### 右栏底部 UI
- **Before:** `Project Management / Legend / Debug` 使用未定义 class，表现接近原生控件拼装，风格不一致。
- **After:** 统一为卡片体系、按钮体系、提示文本层级；上传入口为统一按钮 + 文件状态行，视觉与右栏其他块一致。

---

## 3) 回归测试结果

## Console
- `[data_loader] Topology variant auto-fallback is disabled. Loading primary topology only.`
- `[data_loader] Loaded topology data/europe_topology.json (199 features).`
- 无 `.bak` 自动回退告警。
- 仅残留 `favicon.ico 404`（低优先级噪音）。

## Network
- `GET /data/europe_topology.json -> 200`
- `GET /data/locales.json -> 200`
- `GET /data/hierarchy.json -> 200`
- 未请求 `data/europe_topology.json.bak`（默认路径）。
- 显式参数验证：`?topology_variant=legacy_bak` 时加载 `8305` features（按预期启用手动变体）。

## Runtime State (浏览器内读取)
- `topologyCount = 199`
- `Auto-Fill Countries` 后：
  - `colorCount = 199`
  - `uniqueColorCount = 24`
- 说明 autofill 正常工作且非单色。

---

## 4) 截图路径（before / after）

### Before（回归现象）

### After（修复后）

---

## 5) 未解决风险与后续建议

1. 当前默认规避了 `.bak` 路径风险，但 `legacy_bak` 显式开关依然保留，仅建议用于调试/对照，不建议生产默认。
2. 异常几何 blocklist 目前为已知 3 个 RU ID；若后续数据源变动产生新异常，建议在 pipeline 侧做几何体质检并前置清洗。
3. `favicon.ico 404` 仍存在，可补充静态资源或在服务层禁用该请求噪音。

> 历史截图与临时证据文件已在文档清理阶段移除；结论以 canonical summary 为准。
