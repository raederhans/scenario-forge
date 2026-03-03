# QA-025: Border Completeness + Coastline Render Consistency Fix

**Date:** 2026-02-24  
**Environment:** `http://localhost:8000/` (Edge via Playwright MCP quick smoke)  
**Related:** `./024_hit_selection_consistency_and_country_pick_fix.md`

---

## 1) 修复点清单（按文件）

### `js/core/map_renderer.js`
- 边界来源重构：
  - 新增 `buildGlobalCountryBorderMesh(primaryTopology)`：
    - 使用 primary `political` 全局生成国界，不再按 source 分裂。
  - 新增 `buildGlobalCoastlineMesh(primaryTopology)`：
    - 优先使用 primary `land` 生成海岸线；
    - 若 `land` 缺失，回退 `political (a && !b)`。
- `buildSourceBorderMeshes()` 调整：
  - 仅生成并返回 `provinceMesh`、`localMesh`。
  - `country/coastline` 从 source 分层构建中拆出。
- `rebuildStaticMeshes()` 调整：
  - `cachedCountryBorders` 仅写入 primary 全局国界 mesh。
  - `cachedCoastlines` 仅写入 primary 全局海岸线 mesh。
  - `cachedProvinceBorders`、`cachedLocalBorders` 保持 detail+primary 分源构建。
- `drawHierarchicalBorders(k)` 缩放联动升级（中等增强）：
  - `kEff = clamp(k, 1, 8)`, `t = (kEff - 1) / 7`
  - 国界/省界/下级/海岸线 alpha 与 width 公式按 QA-025 方案更新
  - 绘制顺序保持：`local -> province -> country -> coastline`

---

## 2) 前后行为对比

### Before
- 国界在 detail/primary 接缝处出现断裂。
- partial detail 区域出现“陆地边界被误绘为海岸线”。
- 海岸线控件有时看起来无效（根因是 coast mesh 数据不正确/不完整）。
- 缩放时线条层级变化不明显，体感接近“无联动”。

### After
- 国界由 primary 全局统一生成，跨 source 邻接边界连续可见。
- 海岸线由 primary `land` 全局生成，陆海边界连续且稳定。
- 海岸线样式控件作用对象正确（`cachedCoastlines` 全局 mesh）。
- 缩放联动变化幅度增强，仍保持 `country > province > local` 层级关系。

---

## 3) 回归测试结果

## Console
- quick smoke（2026-02-24 20:42 UTC）无首页渲染报错。
- 仅文档页噪音：
  - `GET /data/favicon.ico 404`
  - `TypeError: $(...).ready is not a function`

## Network
- quick smoke 未发现首页关键地图资源 4xx/5xx。

## Screenshots

历史截图与临时证据文件已在文档清理阶段移除；结论以 canonical summary 为准。

## Repro
1. 启动：`python3 tools/dev_server.py`
2. 打开：`http://localhost:8000/`
3. 观察全图（尤其欧洲-中东-北非）：
  - 国界连续，无跨 source 断裂
  - 陆海交界海岸线连续
4. 调整左侧 `Map Style` 中 `Coastlines` 颜色/宽度，观察实时生效
5. 缩放到 `k≈1/3/6` 检查线条层级强弱变化

## Patch note
- 国界/海岸线从“分源政治层推导”迁移为“primary 全局权威来源”。
- 保留细分边界（province/local）分源构建，实现完整性与细节兼顾。
- 缩放联动按中等增强公式重标定。

---

## 4) 残余风险与后续建议

1. primary 与 detail 的局部几何边缘可能存在轻微不贴合（视觉可接受，优先保证边界完整性）。
2. quick smoke 不覆盖全部手工滑条交互路径；建议补一轮定向手测（coastline color/width 在多缩放等级下的视觉确认）。

> 历史截图与临时证据文件已在文档清理阶段移除；结论以 canonical summary 为准。
