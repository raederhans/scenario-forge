# QA-031: Parent Border Country Toggle + DE/GB Dynamic Grouping (2026-02-25)

## Scope
- 新增“上级地块边界”按国家独立开关（左侧 Map Style）。
- 国家列表自动发现，不硬编码白名单。
- DE/GB 做数据质量专项：
  - DE 必须按联邦州/城市州分组。
  - GB 不可退化为 4 个加盟国分组，需自动回退到更细层级。

## Implementation Summary
1. Renderer (`js/core/map_renderer.js`)
- 增加 parent border 自动发现与缓存：
  - `parentBorderSupportedCountries`
  - `parentBorderEnabledByCountry`
  - `parentBorderMetaByCountry`
  - `parentGroupByFeatureId`
  - `cachedParentBordersByCountry`
- 分组来源策略：
  - 通用：`hierarchy` -> `admin1_group`
  - GB：`hierarchy` 不够细时，自动改用 `id` 前缀分组（4 位优先，其次 3 位）
  - DE：强制 `admin1_group`，并校验存在 Berlin/Hamburg/Bremen
- 质量门槛：
  - 覆盖率 `>= 0.70`
  - 最大组占比 `<= 0.90`
  - 可绘制分组数（组内>=2）`>= 2`
- 绘制顺序升级：
  - `local -> province -> parent -> country -> coastline`
- 交互阶段（拖拽/缩放）跳过 parent 边界，避免卡顿。

2. UI (`index.html`, `js/ui/toolbar.js`, `css/style.css`)
- 新增 Parent Unit Borders 分组：
  - Color / Opacity / Width
  - 国家复选列表
  - Enable All / Clear All
- 列表按运行时支持国家动态渲染。

3. Project persistence (`js/core/file_manager.js`, `js/ui/sidebar.js`)
- 项目文件 schema 升级到 v3。
- 导出新增：
  - `parentBorderEnabledByCountry`
  - `styleConfig.parentBorders`
- 导入时兼容旧版本并做默认回退。

## Validation Checklist
1. 国家列表自动发现
- 启动后在 Parent Unit Borders 中可看到动态国家列表（不支持国家不显示）。

2. DE 质量验证
- 启用 DE 后显示州级边界（含 Berlin/Hamburg/Bremen 城市州分界）。
- `state.parentBorderMetaByCountry.DE.source === "admin1_group"`。

3. GB 质量验证
- 启用 GB 后不再仅显示 England/Scotland/Wales/NI 四分界。
- 英格兰内部可见更细上级边界。
- `state.parentBorderMetaByCountry.GB.source === "id_prefix"`（在当前数据条件下）。

4. 回归
- 海洋 hover/click 不命中国家。
- 国家/子地块上色与擦除逻辑正常。
- 导出 PNG/JPG 与画布一致。

## Known Limits
- RU city override 注入到 `state.landData` 后，parent mesh 仍基于 TopoJSON 拓扑边构建；极少数 override 替换单元可能在 parent 线条上存在细微不一致（不影响主功能）。
