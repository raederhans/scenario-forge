# QA-023: Subdivision Restore + Country/Subdivision Switching + Hierarchical Borders

**Date:** 2026-02-24  
**Environment:** `http://localhost:8000/` (Playwright MCP Edge quick smoke + local code/runtime inspection)  
**Related:** `qa_reports/021_projection_wrap_artifact_regression.md`, `qa_reports/022_projection_wrap_artifact_fix_and_sidebar_ui_alignment.md`

---

## 1) 修复点清单（按文件）

### `js/core/data_loader.js`
- 保留显式单拓扑开关：`topology_variant=highres|legacy_bak`（单层模式）。
- 新增细分层参数：
  - `detail_layer=off`：关闭细分覆盖，强制 primary-only。
  - `detail_source=legacy_bak|highres`：细分来源选择（默认 `legacy_bak`）。
- 默认行为改为 bundle 加载：
  - `topologyPrimary = data/europe_topology.json`
  - `topologyDetail = detail_source`（失败仅告警，不阻断）
  - 有 detail 则 `topologyBundleMode=composite`，否则 `single`。

### `js/core/state.js`
- 新增状态字段：
  - `topologyPrimary`, `topologyDetail`, `topologyBundleMode`
  - `interactionGranularity`
  - `countryBaseColors`, `featureOverrides`
  - `countryToFeatureIds`
  - `cachedCountryBorders`, `cachedProvinceBorders`, `cachedLocalBorders`

### `js/main.js`
- 启动时接入 topology bundle，并下发到 renderer。
- 背景层（ocean/land/rivers/physical/urban/special_zones）固定从 primary 读取，避免 composite 下底图缺层。

### `js/core/map_renderer.js`
- 新增组合政治层：
  - `composePoliticalFeatures(primary, detail)`（detail 覆盖对应国家，primary 补齐未覆盖国家）。
  - feature 增加 `properties.__source`（`detail|primary`）用于后续边界分层。
- 新增颜色语义重构：
  - `featureOverrides[id] > countryBaseColors[country] > default`
  - `rebuildResolvedColors()/refreshColorState()` 统一生成渲染态 `state.colors`。
- 新增交互粒度：
  - `subdivision`：写 `featureOverrides[id]`
  - `country`：写 `countryBaseColors[country]`
  - 切换模式不清空历史颜色。
- `autoFillMap()` 改为“重建国家基色”语义：
  - 写入 `countryBaseColors`
  - 清空 `featureOverrides`
- 新增分层边界缓存与绘制：
  - local -> province -> country -> coastline
  - 带轻度缩放联动（细边界全图弱化，放大后增强）
- 保留并复用 QA-022 的遮罩防线：
  - `shouldSkipFeature()` 继续应用于 `fitProjection/drawCanvas/buildSpatialIndex/autoFillMap`。
- 新增 composite 覆盖统计日志，便于诊断“为什么某些国家没有细分层”。

### `js/core/logic.js`
- `applyCountryColor()/resetCountryColors()/applyPaletteToMap()` 全量切换到 `countryBaseColors`。
- 国家码 canonical 化（`UK->GB`, `EL->GR`）保持一致性。

### `js/core/file_manager.js`
- 导出 schema 升级为 v2：
  - `countryBaseColors`
  - `featureOverrides`
  - `specialZones`
- 导入兼容 v1：
  - 旧 `colors` 自动映射到 `featureOverrides`。

### `index.html`, `js/ui/toolbar.js`, `js/ui/i18n.js`
- 新增 `Paint Granularity` 下拉：
  - `By Subdivision`
  - `By Country`
- `colorModeSelect` 不再隐式触发 `autoFill`。

### `js/ui/sidebar.js`, `css/style.css`
- 已沿用 QA-022 的右栏底部统一风格（Project Management / Legend / Debug）。

---

## 2) 前后行为对比

### 颜色语义与模式切换
- **Before:** 基本只有单层 `state.colors` 直写，国家与细分语义混杂，切换策略不清晰。
- **After:** 真源拆分为 `countryBaseColors + featureOverrides`，并固定解析优先级：
  - 细分覆盖永远优先于国家基色。
  - 国家模式填色不会清掉已有细分覆盖。
  - 切回细分模式不会丢历史编辑。

### 细分恢复方式
- **Before:** 为了止血遮罩问题，默认仅 primary（199）会导致明显国家级交互。
- **After:** 默认 composite（primary + detail），细分国家优先 detail，其他国家保留 primary 兜底。

### 边界观感
- **Before:** 统一描边容易让省界/细边界与国界抢主视觉。
- **After:** 国界 > 省界 > 下级边界固定分层，且缩放时细边界按比例弱化/增强。

---

## 3) 数据覆盖诊断结论（本次关键）

本次对实际数据做了结构核验（本地 `python3` 读取 TopoJSON）：

- `data/europe_topology.json`（primary）
  - `199` features
  - `197` countries
  - 基本国家级（仅极少多片国家）
- `data/europe_topology.json.bak`（detail）
  - `8305` features
  - `91` countries（全部属于 primary 国家子集）

**结论：** 当前“并非全球都显示细分省份”主要是 detail 数据覆盖边界，不是渲染逻辑把省份删掉。  
即：全球表现为“91 国细分 + 106 国国家级兜底”。

---

## 4) 回归测试结果

## Console
- Quick smoke（2026-02-24 14:55 UTC）未出现首页 `topology.highres` 404 或“primary too coarse -> .bak fallback”旧日志。
- 当前可见控制台问题为文档路由噪音：
  - `http://localhost:8000/data/favicon.ico` 404
  - README 页面脚本兼容告警 `$(...).ready is not a function`

## Network
- Quick smoke 的 network summary 未出现首页地图关键资源 4xx/5xx。
- 与 QA-021 对比：不再出现默认路径 `europe_topology.highres.json` 的请求失败链路。

## Screenshots
- `.mcp-artifacts/screenshots/route-home-quick-20260224-095322.png`
- `.mcp-artifacts/screenshots/gesture-map_pan_zoom-quick-20260224-095322.png`
- `.mcp-artifacts/screenshots/section-left_sidebar-quick-20260224-095322.png`
- `.mcp-artifacts/screenshots/section-right_sidebar-quick-20260224-095322.png`

## Repro
1. 启动：`python3 tools/dev_server.py`
2. 打开：`http://localhost:8000/`
3. 默认应进入 composite（无 `topology_variant` 且未设置 `detail_layer=off`）。
4. 观察：
   - 无白/蓝巨型遮罩；
   - Eurasia 等 detail 覆盖区可见细分边界；
   - 未覆盖国家为国家级轮廓。
5. 切换 `Paint Granularity`：
   - `By Subdivision`：单地块写入覆盖色；
   - `By Country`：写国家基色，不清除已有细分覆盖。

## Patch note
- 遮罩回归防线保持。
- 细分恢复采用 composite 策略而不是回退“全局 `.bak` 自动覆盖”。
- 颜色模型改为可组合继承，支持国家/细分无刷新切换。
- 边界绘制由单层描边升级为层级 mesh 绘制。

---

## 5) 未解决风险与后续建议

1. `legacy_bak` 仅覆盖 91 国，若目标是“全球细分一致”，需要补充/重建 detail 数据源（pipeline 侧治理）。
2. README 路由脚本告警与 favicon 404 为低优先级噪音，建议独立清理以减少巡检误报。
3. 当前边界分层使用 `admin1_group` 作为省界判定主信号，后续可按国家扩展更稳的 admin 层级字段映射。
