# 011 Performance Optimization Plan — Feasibility Review

Date: 2026-01-28

## 1) 现状检查（代码与数据）

### 当前规模
- `data/europe_topology.json` 政治面数量：**4849**。
- 若引入 RU/UA ADM2，预计会显著超出 5000 面。

### 已有优化（计划中多项已落地）
- ✅ **视窗裁剪（Viewport Culling）**：`pathBoundsInScreen()` + `TINY_AREA` 已在 land/physical/urban 绘制时生效。
- ✅ **Quadtree 命中检测**：`spatialIndex` + `geoContains` 已实现 O(log n) 级别候选过滤。
- ✅ **双画布渲染**：`colorCanvas` + `lineCanvas` 分离填充与线条。
- ✅ **缩放节流**：Zoom 事件使用 `requestAnimationFrame` 聚合渲染。

### 尚未实现或未完全使用的优化
- ❌ **离屏静态缓存（Off‑screen Cache）**：
  - `renderLineLayer()` 每次都重绘地形/城市/河流层。
  - `topojson.mesh()` 在每次 render 中重新计算 coastlines/gridlines/dynamic borders。
- ⚠️ **边界缓存函数已存在但未被调用**：
  - `getCoastlines()` 与 `cachedBorders` 逻辑存在，但 `renderLineLayer()` 仍直接调用 `topojson.mesh()`。
- ⚠️ **HitCanvas 未实际参与命中检测**：`drawHidden()` 定义了彩色命中层，但鼠标检测仍基于 quadtree + `geoContains`。

## 2) 计划要点可行性评估

### 1. Render Culling（视窗裁剪）
- **已实现**，核心逻辑在 `pathBoundsInScreen()`。
- 但**仅覆盖 feature 绘制**，对 `topojson.mesh()` 生成的边界线条仍是全量绘制。

### 2. Off‑Screen Canvas Caching（分层缓存）
- **尚未实现**。
- 适用范围：
  - 物理地貌/城市/河流层（静态，可缓存）。
  - Coastlines / 内部边界（可预计算并缓存，不必每次 mesh）。
- 可行性高，预计收益大（减少每帧复杂 path 生成）。

### 3. Spatial Indexing（Quadtree）
- **已完成**。
- 当前实现已覆盖 hover/click，命中检测不再线性扫描。

## 3) 结论与建议补充

- 性能优化计划中 **1/3 已完成**（culling + quadtree），**1/3 部分存在但未启用**（边界缓存），**1/3 仍需实施**（离屏缓存）。
- 后续优化重点应放在：
  - **缓存 topojson.mesh 结果**（按颜色 hash 或仅在配色变更时重新计算）。
  - **将 physical/urban/rivers 移至离屏缓存层**，减少每帧重绘。
- 若 RU/UA ADM2 导入使 polygon 数超 5000，上述缓存将是瓶颈突破关键。

---

建议下一步：
- 优先实现 `getCoastlines()` / `getBorders()` 缓存落地。
- 再加入 offscreen static layer（至少 physical + urban），验证 FPS 提升。
