# QA-026: Ocean Hit Drift Fix + Coastline LOD + Ocean Style Upgrade

**Date:** 2026-02-24  
**Environment:** `http://localhost:8000/` (Playwright CLI + profile quick smoke)  
**Related:** `qa_reports/024_hit_selection_consistency_and_country_pick_fix.md`, `qa_reports/025_border_completeness_and_coastline_render_fix.md`

---

## 1) 修复点清单（按文件）

### `js/core/map_renderer.js`
- 命中策略升级为严格陆地命中（strict land hit）：
  - `getHitFromEvent()` 在 strict 与 snap 阶段都要求 `candidate.containsGeo === true` 才返回命中。
  - 移除 `containsGeo=false` 候选回退命中路径，海洋不会再“吸附命中”到国家。
- 海岸线 LOD 新增：
  - 新增 `cachedCoastlinesHigh/Mid/Low`。
  - 在 `rebuildStaticMeshes()` 基于全局海岸线 mesh 生成 Mid/Low（RDP 简化 + 短线段过滤）。
  - `drawHierarchicalBorders(k)` 按缩放选择 LOD：
    - `k < 1.8 -> low`
    - `1.8 <= k < 3.2 -> mid`
    - `k >= 3.2 -> high`
  - 低缩放下同步减弱 `local/province` 内边界 alpha/width，降低高纬挤线感。
- 海洋视觉样式新增：
  - 新增 `drawOceanStyle()`，在 ocean base fill 后叠加海洋专属样式。
  - 新增预设：
    - `flat`
    - `bathymetry_soft`
    - `bathymetry_contours`
    - `wave_hachure`
  - 使用 ocean clip + 程序化 pattern（offscreen tile）实现“视觉版测深渐变 + 等深线”。

### `js/core/state.js`
- 新增海岸线 LOD 缓存状态：
  - `cachedCoastlinesHigh`
  - `cachedCoastlinesMid`
  - `cachedCoastlinesLow`
- `styleConfig` 新增 `ocean`：
  - `preset`
  - `opacity`
  - `scale`
  - `contourStrength`

### `index.html`
- Map Style 面板新增 Ocean 分组控件：
  - `#oceanStyleSelect`
  - `#oceanTextureOpacity`
  - `#oceanTextureScale`
  - `#oceanContourStrength`

### `js/ui/toolbar.js`
- 绑定 Ocean 控件到 `state.styleConfig.ocean`，支持实时重绘与参数合法化（clamp + preset normalize）。

### `js/ui/i18n.js`
- 新增 Ocean 相关 UI 文案键，避免语言切换时新控件文案缺失。

### `docs/ARCH_SYSTEM_REFERENCE.md`
- 更新命中策略说明为 strict land hit。
- 增补 coastline LOD 与 ocean style 渲染链路说明。

---

## 2) 证据（按要求顺序）

## Console
- Quick smoke（`2026-02-24 21:16:04 UTC`）未出现首页地图渲染错误。
- 仅文档/README 路由噪音（历史已知）：
  - `GET /data/favicon.ico 404`
  - `TypeError: $(...).ready is not a function`

## Network
- Quick smoke network summary：未发现首页关键地图资源 4xx/5xx。

## Screenshots
- `.mcp-artifacts/screenshots/route-home-quick-20260224-161316.png`
- `.mcp-artifacts/screenshots/section-left_sidebar-quick-20260224-161316.png`
- `.mcp-artifacts/screenshots/section-right_sidebar-quick-20260224-161316.png`
- `.mcp-artifacts/screenshots/qa026-ocean-flat.png`
- `.mcp-artifacts/screenshots/qa026-ocean-soft.png`
- `.mcp-artifacts/screenshots/qa026-ocean-contours.png`
- `.mcp-artifacts/screenshots/qa026-ocean-wave.png`
- `.mcp-artifacts/screenshots/qa026-coastline-low-zoom.png`
- `.mcp-artifacts/screenshots/qa026-coastline-high-zoom.png`

## Reproduction / Verification
1. 启动服务：`python3 tools/dev_server.py`
2. 打开：`http://localhost:8000/`
3. 命中验证（海洋不应命中国家）：
   - 在海洋蓝色区域 hover：tooltip 不显示（opacity=0）。
   - 在同海域 click：不会触发国家上色写入。
4. 正向验证（美国本土仍可命中）：
   - 在美国本土 click，像素颜色由 `240,240,240` 变为 `135,24,24`（上色成功）。
5. 海洋样式验证：
   - 切换 `flat / bathymetry_soft / bathymetry_contours / wave_hachure`，样式仅作用海域。
6. 海岸线 LOD 验证：
   - 缩放低倍率截图与高倍率截图对比，低倍率线条拥挤度下降，高倍率细节回归。

## Minimal Patch Direction
- 根因是命中链路允许 `containsGeo=false` 的 bbox 候选回退命中；本次改为 contains-only。
- 海岸线由单一 mesh 直绘升级为 LOD 级联，低缩放优先“可读性”而非几何细节。
- 海洋材质从全图纹理叠层补足为“海洋专属样式层”（clip 到 ocean geometry）。

---

## 3) 关键断言结果（自动化脚本采样）

- 海洋 click 不再污染美国：
  - `beforeUS = [240,240,240,255]`
  - `afterUS = [240,240,240,255]`
  - `usColorChanged = false`
- 美国本土 click 仍有效：
  - `before = [240,240,240,255]`
  - `after = [135,24,24,255]`
  - `changed = true`

---

## 4) 风险与后续

1. 当前 bathymetry 为视觉近似（程序化），非真实深度栅格；后续可接 GEBCO/NOAA 数据管线。
2. coastline LOD 参数（epsilon/minLength）仍可按目标国家区域进一步精调。
3. README/doc 路由的控制台噪音不影响地图主功能，可独立清理以降低巡检误报。
