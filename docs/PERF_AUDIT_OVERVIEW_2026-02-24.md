# 性能评估总览（2026-02-24）

## 1. 结论摘要

这次卡顿不是单点问题，而是“**数据规模切换 + 渲染主循环复杂度**”叠加：

- 当前默认运行路径会加载 `composite`（primary + detail）并使用 `detail_source=legacy_bak`，在前端形成约 **8415** 个政治要素（`8305 detail + 110 primary fallback`）。
- 渲染主路径在缩放/平移/填色时都会走全量绘制（每次 `render()` 都重画大部分政治层 + 边界层）。
- 点击填色会触发 `refreshColorState -> render -> drawCanvas`，即单次操作也会走全量画布路径。

你之前的架构切换确实把“DOM path 性能灾难”转成了 Canvas 路径，但在 detail 规模下，CPU 端几何遍历和 path 构建仍然成为瓶颈。

## 2. 核心证据（代码与数据）

### 2.1 默认会加载重 detail 数据

- `js/core/data_loader.js:51-70`：`detail_source` 默认 `legacy_bak`。
- `js/core/data_loader.js:137-170`：未显式关掉 `detail_layer` 时会尝试 composite。
- 当前数据规模：
  - `data/europe_topology.json`：199 political 几何。
  - `data/europe_topology.json.bak`：8305 political 几何。
  - 组合后预测前端特征数：**8415**（本地脚本核算）。

### 2.2 渲染主循环是“每帧全量路径”

- `js/core/map_renderer.js:1283-1362`：`drawCanvas()` 每次清屏后遍历 `state.landData.features` 进行 fill。
- `js/core/map_renderer.js:1238-1281`：每次还会描边（local/province/country/coast）mesh。
- `js/core/map_renderer.js:1333-1368`：`buildSpatialIndex` 在数据/投影重建时计算每个 feature 的 bounds。

### 2.3 交互会频繁触发重绘

- 缩放：`js/core/map_renderer.js:1669-1688`，zoom 事件用 rAF 包裹，但每帧仍执行 `drawCanvas()` 全路径。
- 填色：`js/core/map_renderer.js:1570-1618`，点击后走 `refreshColorState({renderNow:true})`，触发全量重绘。
- 悬浮命中：`js/core/map_renderer.js:1170-1211`，包含候选排序和 `geoContains` 计算，数据大时 hover 开销上升。

### 2.4 一些“状态/开关”和实际渲染链路存在偏差

- `showUrban/showPhysical/showRivers` 目前有 UI 开关（`js/ui/toolbar.js`），但 `drawCanvas()` 主路径未绘制这些层。
- `pathBoundsInScreen` 已定义（`js/core/map_renderer.js:544`）但未进入当前主绘制循环。
- `hitCanvasDirty` 状态字段存在（`js/core/state.js:505`），但当前命中主路径使用 spatial grid，不是 color-picking。

## 3. 屎山/性能负担清单（按优先级）

### P0（立即影响流畅度）

1. **默认 composite 过重**
- 运行默认进入 8k+ feature 路径，导致填色和缩放都落在高复杂度分支。

2. **渲染路径缺少“按视口/缩放层级的 feature draw-list”**
- 当前以“全量 feature 遍历 + runtime skip”为主，不是预计算可见集。

3. **单次交互即触发全量重绘**
- 点击/擦除/滴管都和全量 draw 耦合，缺少脏矩形或分层缓存策略。

### P1（中期必须处理）

1. **数据运行档位和开发档位未分离**
- `start_dev.bat` -> `build_data.bat` -> `init_map_data.py`，每次开发启动都可能跑完整构建。

2. **命中测试仍在 CPU 复杂几何路径上**
- 当前 spatial grid 已比全量 `geoContains` 好，但在高密度区域仍有抖动风险。

3. **countryNames/preset 仍是部分国家覆盖**
- `js/core/state.js` 仅 60 个国家名，和主数据 197 国不一致，导致 UI 辅助能力和数据规模错位。

### P2（可和重构并行）

1. **历史兼容状态字段未清理**
- 增加维护负担和误判（例如 hitCanvas 相关状态）。

2. **可选层（urban/physical/rivers）数据加载与渲染策略不一致**
- 目前更像“加载了但没完整进入可控渲染管线”。

## 4. 你现在“为什么会卡”

直白版：

- 你现在虽然没加载“未来计划中的更多地区”，但**默认已经加载了 detail 档（8k+ 几何）**。
- 填色操作不是“局部更新”，而是全图再绘。
- 缩放期间同样走全量 drawCanvas。

所以卡顿不是偶发 bug，而是当前架构在该数据档位下的必然表现。

## 5. 性能极限（推算，不是实测帧）

### 5.1 当前架构可接受区间（高端机器）

- `single/admin0`（约 199 feature）：可接近流畅（目标 50-60fps 可期）。
- `composite`（约 8415 feature）：交互期更可能在 **18-35fps** 区间波动（高端机），中端机会更低。

### 5.2 当前架构不可扩展区间

- 如果继续走“每次交互全量重绘”并扩大到更高密度 ADM2（>20k/50k+ feature），当前策略会迅速跌到不可用（明显 <15fps，甚至个位数）。

### 5.3 极限约束本质

约束不在 GPU 填充率，而在：

- JS 主线程几何遍历
- geoPath/path 构建
- 多层边界 stroke
- 交互期间重复全量执行

## 6. 优化优先级建议（不改代码版本）

1. 先把运行默认模式改为“轻量档位”策略（single 或 detail_layer=off 作为开发默认）。
2. 再做渲染管线的“可见集 + 分层缓存 + 交互降级绘制”。
3. 最后再扩数据范围；否则只会把卡顿提前放大。

## 7. 重构冲突评估

你当前在做显示/缩放/填色重构，这和性能治理是同一层，**会互相影响**：

- 如果先继续功能重构但不设性能 guardrail，后续会反复返工。
- 最稳妥是先定义性能预算和运行档位，再推进交互与填色逻辑重构。

建议把性能约束前置成“架构约束”，不要当收尾优化项。
