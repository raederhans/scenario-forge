# QA-033: Special Zone Manual Editor (Project-local) (2026-02-26)

## Scope
- 新增手工 `Vertex Polygon` 特殊区域编辑能力。
- 支持 `Start/Undo/Finish/Cancel/Delete` 全流程。
- 手工区域随项目文件保存/加载。

## Implementation Summary
1. Runtime State (`js/core/state.js`)
- `manualSpecialZones: FeatureCollection`
- `specialZoneEditor: { active, vertices, zoneType, label, selectedId, counter }`

2. Renderer (`js/core/map_renderer.js`)
- 新增编辑 API：
  - `startSpecialZoneDraw`
  - `undoSpecialZoneVertex`
  - `finishSpecialZoneDraw`
  - `cancelSpecialZoneDraw`
  - `deleteSelectedManualSpecialZone`
  - `selectSpecialZoneById`
- 双击地图完成绘制；绘制中显示 SVG 预览线/面/顶点。
- `effectiveSpecialZones = topology + manual` 合并渲染。

3. UI (`index.html`, `js/ui/toolbar.js`)
- Map Style 中新增 Special Zone Editor 控件：
  - 类型、标签、开始/撤销/完成/取消、列表选择、删除。
- 工具栏自动同步编辑状态与手工区域列表。

4. Persistence (`js/core/file_manager.js`, `js/ui/sidebar.js`)
- schema v4：
  - `manualSpecialZones`
  - `styleConfig.specialZones`
  - layer visibility

## Validation Checklist
1. 绘制流程
- 点击 Start 后，地图点击可加点；双击可完成闭合。
- 少于 3 点时 Finish 不生成有效区域。

2. 编辑器操作
- Undo 可回退最后一个顶点。
- Cancel 清空当前草稿但不影响已保存手工区域。
- 从列表选择手工区域后可 Delete。

3. 持久化
- 保存项目后重开，手工区域与样式仍存在。

4. 渲染隔离
- 特殊区域样式变化不污染国家填色或边界线样式。

## Known Limits
- 当前为项目内持久化，不回写数据管线资产文件。
- 手工区域暂不提供顶点级二次编辑（仅重画/删除）。
