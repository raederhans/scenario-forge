# QA-020: TNO 1962 剧本加载性能审计

**日期:** 2026-03-19
**状态:** 审计完成，待实施优化
**问题:** 启动 1962 剧本后，页面阻塞约 10 秒无法操作，用户体验差

---

## 一、数据文件概览（总计 ~22MB）

| 文件 | 大小 | 用途 | 阻塞影响 |
|------|------|------|----------|
| **runtime_topology.topo.json** | **16 MB** | 13,230 个政治地块的拓扑几何 | **致命** — JSON解析 + topojson解码 |
| audit.json | 2.5 MB | 审计元数据 | 中 — 可延迟 |
| relief_overlays.geojson | 1.4 MB | 地形浮雕 | 中 — 默认关闭但可能eager加载 |
| geo_locale_patch.json | 1.4 MB | 本地化名称覆盖 | 中 — 首屏非必需 |
| cores.by_feature.json | 440 KB | 核心州映射 | 低 — 但同步处理 |
| controllers.by_feature.json | 385 KB | 控制者映射 | 低 — 但同步处理 |
| owners.by_feature.json | 385 KB | 所有权映射 | 低 — 但同步处理 |
| countries.json | 179 KB | 国家元数据 | 低 |
| city_overrides.json | 110 KB | 城市覆盖 | 低 |
| capital_hints.json | 109 KB | 首都提示 | 低 |

---

## 二、关键瓶颈分析

### 瓶颈 1：16MB 拓扑文件的 JSON 解析（预估 ~2-3秒）

`scenario_manager.js:1310-1312` 通过 `d3.json()` 加载 `runtime_topology.topo.json`。虽然网络请求是异步的，但浏览器对 16MB JSON 的 `JSON.parse()` 在**主线程同步执行**，仅这一步就会阻塞约 2-3 秒。

### 瓶颈 2：`topojson.feature()` 被重复调用（预估 ~2-3秒）

16MB 的拓扑数据在加载流程中被多次解码为 GeoJSON features：

1. **`map_renderer.js:2086`** — `getPoliticalFeatureCollection()` 对 runtime topology 调用 `topojson.feature()`，遍历 13,230 个几何体并逐一 `normalizeFeatureGeometry()`
2. **`map_renderer.js:3055`** — `ensureLayerDataFromTopology()` 在缓存失效时可能再次调用
3. **`map_renderer.js:2833`** — `resolveContextLayerData()` 对 water_regions、special_zones 等子对象分别调用
4. **`map_renderer.js:3915`** — 另一个 feature 提取路径

每次 `topojson.feature()` 调用都会解压整个 arc 数组来重建几何体。

### 瓶颈 3：`setMapData()` 的同步重计算链（预估 ~4-5秒）

`map_renderer.js:12496-12588` 是最大的单点阻塞。以下操作**全部同步串行执行**：

```
setMapData()                              // 总入口 (line 12496)
  ├─ ensureLayerDataFromTopology()        // topojson.feature() × N (line 12525)
  ├─ rebuildPoliticalLandCollections()    // 再次 topojson.feature() + 13230次 normalize (line 12526)
  ├─ buildRuntimePoliticalMeta()          // 遍历 13,230 个 geometries (line 12545)
  ├─ buildIndex()                         // 遍历 13,230 features + 触发4个UI回调 (line 12554)
  ├─ ensureSovereigntyState()             // 重建所有权索引 (line 12555)
  ├─ rebuildProjectedBoundsCache()        // 为 13,230 features 计算投影边界 (line 12556)
  ├─ rebuildStaticMeshes()                // topojson.mesh() × 6+ 构建国界/省界/海岸线 (line 12557)
  ├─ rebuildResolvedColors()              // 遍历所有 features 计算颜色 (line 12560)
  └─ render()                             // 最终绘制 (line 12576)
```

13,230 个 features 被遍历了**至少 5-6 次**，每次做不同的计算。

### 瓶颈 4：`topojson.mesh()` 边界构建（预估 ~1-2秒）

`map_renderer.js:4229-4331` 中 `rebuildStaticMeshes()` 调用了多次 `topojson.mesh()`：

- `buildSourceBorderMeshes()` — 省界 + 地方边界 (line 4269)
- `buildDetailAdmBorderMesh()` — 详细行政边界 (line 4277)
- `buildGlobalCountryBorderMesh()` — 全局国界 (line 4286)
- `buildGlobalCoastlineMesh()` — 海岸线 + 2级简化 (line 4292)

每次 `topojson.mesh()` 都需要遍历整个 arc 数组来找到共享边界。

### 瓶颈 5：`buildIndex()` 中的同步 UI 回调（预估 ~0.5-1秒）

`map_renderer.js:5030-5041` 在索引构建过程中同步触发 4 个 UI 渲染回调：

- `renderCountryListFn()` — 重建国家列表 (line 5030)
- `renderWaterRegionListFn()` — 重建水域列表 (line 5033)
- `renderSpecialRegionListFn()` — 重建特殊区域列表 (line 5036)
- `renderPresetTreeFn()` — 重建预设树 (line 5039)

这些涉及 DOM 操作，会触发 layout/reflow。

### 瓶颈 6：`applyScenarioBundle()` 中的重复工作（预估 ~0.3-0.5秒）

`scenario_manager.js:2151` 在调用 `setMapData()` **之前**就已经调用了 `ensureSovereigntyState({ force: true })`，而 `setMapData()` 内部 (line 12555) 会**再次调用**。`refreshScenarioOpeningOwnerBorders()` (line 2158) 也做了部分重叠的边界计算。

---

## 三、完整调用链（从用户点击到渲染完成）

```
applyScenarioById()
  └─ loadScenarioBundle()                     [async, 但 JSON.parse 同步]
      └─ Promise.all([
           owners (385KB),
           controllers (385KB),
           cores (440KB),
           runtime_topology (16MB),            ← 关键瓶颈
           geo_locale_patch (1.4MB),
           releasable_catalog
         ])
      └─ eagerOptionalLayers.map(load...)      [water_regions, special_regions等]
  └─ applyScenarioBundle()                     [async 但内部严重阻塞]
      ├─ prepareScenarioApplyState()           [构建 ownership/core 索引]
      ├─ 大量 state 赋值                       [拷贝 owners/controllers/cores]
      ├─ ensureSovereigntyState({ force })     ← 重复调用 #1
      ├─ refreshScenarioOpeningOwnerBorders()  [边界计算]
      ├─ setMapData()                          ← 最大阻塞点（见瓶颈3）
      │   ├─ ensureLayerDataFromTopology()
      │   ├─ rebuildPoliticalLandCollections() ← topojson.feature() 再次调用
      │   ├─ buildRuntimePoliticalMeta()       ← 遍历 13,230 geometries
      │   ├─ buildIndex()                      ← 遍历 13,230 features + 4个UI回调
      │   ├─ ensureSovereigntyState()          ← 重复调用 #2
      │   ├─ rebuildProjectedBoundsCache()     ← 遍历 13,230 features
      │   ├─ rebuildStaticMeshes()             ← topojson.mesh() × 6+
      │   ├─ rebuildResolvedColors()           ← 遍历所有 features
      │   └─ render()
      ├─ rebuildPresetState()
      ├─ refreshScenarioShellOverlays()
      └─ ensureActiveScenarioOptionalLayersForVisibility()
```

---

## 四、现有优化机制

代码中已存在一些优化基础设施：

1. **`beginStagedMapDataWarmup()`** (`map_renderer.js:9917`) — 当 features > 12,000 时延迟 contextBase 渲染和 hitCanvas 构建。但仅在 `setMapData()` **末尾**触发，之前的所有重计算仍然阻塞。
2. **`performance_hints`** 在 manifest 中配置：`render_profile_default: "balanced"`, `dynamic_borders_default: false`, `scenario_relief_overlays_default: true`。当前 TNO 将 relief overlays 视为默认地理表达，不再依赖“默认关闭”来换取首屏成本。
3. **`layerResolverCache`** — `ensureLayerDataFromTopology()` 有缓存避免重复解码，但场景切换时缓存被清空。
4. **性能指标记录** — `recordRenderPerfMetric()` 和 `recordScenarioPerfMetric()` 已存在，可用于验证优化效果。

---

## 五、优化建议（按投入产出比排序）

### 优先级 1：缓存 `topojson.feature()` 结果

- **预计节省:** 2-3秒
- **复杂度:** 低
- **风险:** 低
- **方案:** 在 `loadScenarioBundle()` 或 `prepareScenarioApplyState()` 阶段一次性解码 political features 并缓存。对 `getPoliticalFeatureCollection()` 添加拓扑引用检查，相同拓扑直接返回缓存结果。避免 `rebuildPoliticalLandCollections()` → `ensureLayerDataFromTopology()` 路径中的重复解码。

### 优先级 2：合并多次 feature 遍历为单 pass

- **预计节省:** 1-2秒
- **复杂度:** 中
- **风险:** 中
- **方案:** 将 `buildRuntimePoliticalMeta()` + `buildIndex()` + `rebuildProjectedBoundsCache()` + `rebuildResolvedColors()` 合并为一个 `buildAllIndexes()` 函数，在单次遍历中完成 ID 索引、国家映射、投影边界缓存和颜色计算。

### 优先级 3：将 UI 回调延迟到下一帧

- **预计节省:** 0.5-1秒
- **复杂度:** 低
- **风险:** 低
- **方案:** 用 `requestAnimationFrame()` 或 `queueMicrotask()` 将 `buildIndex()` 中的 4 个 UI 回调 (`renderCountryListFn`, `renderWaterRegionListFn`, `renderSpecialRegionListFn`, `renderPresetTreeFn`) 推迟到索引构建完成后的下一帧执行。

### 优先级 4：移除 `applyScenarioBundle()` 中的重复调用

- **预计节省:** 0.3-0.5秒
- **复杂度:** 低
- **风险:** 低
- **方案:** 移除 `scenario_manager.js:2151` 的 `ensureSovereigntyState({ force: true })` 调用（`setMapData()` 内部会再次执行）。或传入参数让 `setMapData()` 跳过已完成的步骤。

### 优先级 5：延迟加载非首屏数据

- **预计节省:** 1-2秒（网络 + 解析时间）
- **复杂度:** 低
- **风险:** 低
- **方案:** `audit.json` (2.5MB) 和 `geo_locale_patch.json` (1.4MB) 改为懒加载——先渲染地图，用户需要时再加载。可在 manifest 的 `performance_hints` 中扩展 `defer_audit: true` 等标记。

### 优先级 6：Web Worker 处理 JSON 解析

- **预计节省:** 2-3秒（主线程释放，非总时间减少）
- **复杂度:** 中
- **风险:** 低
- **方案:** 在 Worker 中 fetch + parse 16MB JSON，通过 `postMessage` 传回解析后的对象（structured clone）。UI 在解析期间保持响应，可显示加载进度条。

### 优先级 7：预计算 border meshes

- **预计节省:** 1-2秒
- **复杂度:** 高
- **风险:** 中
- **方案:** 在构建工具 (`patch_tno_1962_bundle.py`) 中预计算 border meshes 并存为独立文件，运行时直接加载使用而非实时计算。

---

## 六、预期效果总结

| 优化措施 | 预计节省 | 复杂度 | 风险 |
|---------|---------|--------|------|
| 缓存 topojson.feature() | 2-3秒 | 低 | 低 |
| 合并 feature 遍历 | 1-2秒 | 中 | 中 |
| 延迟 UI 回调 | 0.5-1秒 | 低 | 低 |
| 去重复 sovereignty 调用 | 0.3-0.5秒 | 低 | 低 |
| 延迟非必需数据 | 1-2秒 | 低 | 低 |
| Web Worker JSON 解析 | 2-3秒(主线程) | 中 | 低 |
| 预计算 border meshes | 1-2秒 | 高 | 中 |

**建议实施顺序：**

- **第一阶段**（优先级 1+3+4）：缓存 feature 结果 + 延迟 UI 回调 + 去重复调用 → 预计从 ~10秒降至 ~6-7秒
- **第二阶段**（优先级 2+5）：合并遍历 + 懒加载非必需数据 → 预计降至 ~4-5秒
- **第三阶段**（优先级 6+7）：Worker + 预计算 → 用户感知阻塞降至 ~2-3秒，且期间 UI 可响应
