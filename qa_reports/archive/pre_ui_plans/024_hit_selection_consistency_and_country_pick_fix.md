# QA-024: Hit Selection Consistency + Country Pick Reliability

**Date:** 2026-02-24  
**Environment:** `http://localhost:8000/` (Edge via Playwright MCP quick smoke)  
**Related:** `./023_subdivision_restore_and_hierarchical_border_strategy.md`

---

## 1) 修复点清单（按文件）

### `js/core/state.js`
- 新增命中索引状态字段：
  - `spatialGrid: Map<string, SpatialItem[]>`
  - `spatialGridMeta: { cellSize, cols, rows, width, height, globals }`
  - `spatialItemsById: Map<string, SpatialItem>`
- 保留 `spatialIndex` 兼容字段，但不再作为主命中通道。

### `js/core/map_renderer.js`
- 命中参数常量化：
  - `HIT_GRID_TARGET_COLS = 24`
  - `HIT_GRID_MIN_CELL_PX = 32`
  - `HIT_GRID_MAX_CELL_PX = 96`
  - `HIT_SNAP_RADIUS_PX = 8`
  - `HIT_MAX_CELLS_PER_ITEM = 400`
- 新增网格索引构建：
  - `buildSpatialGrid(items, canvasWidth, canvasHeight)`
  - 超大 bbox 进入 `globals` 桶，避免网格爆炸。
- `buildSpatialIndex()` 重构：
  - 继续生成 `spatialItems`
  - 主命中索引改为 `spatialGrid`
  - `state.spatialIndex = null`（停用 quadtree 主路径）
- 新增统一命中链路：
  - `collectGridCandidates(px, py, radiusProj)`
  - `rankCandidates(candidates, lonLat)`，排序规则：
    1. `geoContains=true` 优先
    2. `detail` 源优先于 `primary`
    3. `bboxArea` 小优先
    4. `bboxDistance` 小优先
  - `getHitFromEvent(event, { enableSnap, snapPx, eventType })`
  - 返回内部统一结果对象：
    - `{ id, countryCode, viaSnap, strict, distancePx }`
- Hover/Click 统一改造：
  - `handleMouseMove()` 改用 `getHitFromEvent(..., snapPx=8)`
  - `handleClick()` 改用同一命中入口，优先使用命中结果中的 `countryCode`
- 颜色与交互语义保持不变：
  - `countryBaseColors + featureOverrides`
  - `resolveInteractionTargetIds()` 国家扩展逻辑不变。

---

## 2) 前后行为对比

### Before
- 命中候选来自“中心点 quadtree + bbox contains + geoContains”。
- 大范围/离散国家（含海外领土）易出现“点本土 miss，点边/近质心才中”。

### After
- 命中候选来自“bbox 网格索引 + geoContains 优先排序 + 8px 吸附兜底”。
- Click/Hover 共用同一命中路径，行为一致性提升。
- 对海外领土国家，本土区域命中稳定性明显提升。

---

## 3) 回归测试结果

## Console
- 最新 quick smoke（`2026-02-24 15:26:33 UTC`）无首页命中链路相关报错。
- 保留文档页低优先级噪音：
  - `GET /data/favicon.ico 404`
  - `TypeError: $(...).ready is not a function`

## Network
- 最新 quick smoke 的 network summary 未出现首页关键资源 4xx/5xx。

## Screenshots

历史截图与临时证据文件已在文档清理阶段移除；结论以 canonical summary 为准。

## Repro
1. 启动：`python3 tools/dev_server.py`
2. 打开：`http://localhost:8000/`
3. 切换到国家模式（`Paint Granularity -> By Country`）
4. 在多岛/海外领土国家的本土区域点击（如 US/FR/RU）
5. 期望：
   - 命中不再依赖“点边框”或“近质心”
   - Hover 与 Click 命中对象一致
   - 海岸线附近轻微 miss 能在 8px 半径内吸附到最近合法候选

## Patch note
- 命中内核由 quadtree 中心点路径迁移到 bbox 网格索引。
- 吸附半径固定 8px（屏幕像素），按当前缩放 `k` 映射到投影坐标。
- 未引入第三方依赖，未变更数据加载和配色语义。

---

## 4) 兼容性与风险

1. `spatialIndex` 字段仍保留，但已退化为兼容占位（主命中不再使用）。
2. 在极端稀疏海域，8px 吸附可能带来“边缘点选到近邻岛屿”的少量主观差异；当前通过 `geoContains` 优先排序与距离排序压制误选。
3. 本次未启用 hidden hit-canvas 路径；如后续几何量继续上升，可再评估像素拾取架构。

> 历史截图与临时证据文件已在文档清理阶段移除；结论以 canonical summary 为准。
