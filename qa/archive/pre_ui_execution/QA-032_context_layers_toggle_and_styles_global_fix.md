# QA-032: Context Layers Toggle + Global Source Fallback (2026-02-26)

## Scope
- 修复 `Urban/Physical/Rivers/Special Zones` 开关“可交互但无图面变化”。
- 增加 context layer 样式系统（Atlas Classic physical + rivers casing + urban blend）。
- 验证 primary/detail 图层选源与 coverage 诊断日志。

## Implementation Summary
1. Renderer (`js/core/map_renderer.js`)
- 新增 layer 解析接口：
  - `computeLayerCoverageScore(collection)`
  - `pickBestLayerSource(primary, detail, policy)`
  - `resolveContextLayerData(layerName)`
- `ensureLayerDataFromTopology()` 改为按层智能选源（含 `special_zones` detail fallback）。
- `drawCanvas()` 新顺序：
  - `ocean -> political fill -> physical -> urban -> rivers -> hierarchical borders`.
- 新增 context layer 绘制器：
  - `drawPhysicalLayer`
  - `drawUrbanLayer`
  - `drawRiversLayer`

2. Toolbar + UI (`index.html`, `js/ui/toolbar.js`)
- Layer Toggles 并入左侧 `Map Style`。
- 新增样式控件：
  - physical: preset/tint/opacity/contour/blend
  - urban: color/opacity/blend/min area
  - rivers: color/opacity/width/outline/dash
  - special zones: per-type fill&stroke + opacity/stroke width/dash

3. Pipeline (`init_map_data.py`, `map_builder/geo/topology.py`)
- `special_zones` 生成不再仅限非 skeleton 分支。
- `prune_columns` 支持 layer-specific 字段保留（urban/physical/rivers）。
- 增加构建期 `[Layer Coverage]` 诊断日志。

## Validation Checklist
1. Toggle 回归
- 关闭任一层后，画布中对应层立刻消失；重新开启立即恢复。

2. 可辨识度
- `physical` 默认 `atlas_soft` 与 `off` 有明显差异。
- 河流 `outlineWidth` 与 `dashStyle` 可实时观察到变化。

3. 选源与覆盖
- 控制台输出 `[layer-resolver]` 与 `state.layerDataDiagnostics`。
- 当 primary 缺失 `special_zones` 时，source 自动落到 detail。

4. 导出一致性
- PNG/JPG 与当前画布一致，context layers 状态一致。

## Known Limits
- 当前 primary ocean 仍偏稀疏，视觉掩膜依赖 ocean fallback 机制（已内置）。
- urban/physical 大规模开启时在低端设备可能有可感知性能下降。
