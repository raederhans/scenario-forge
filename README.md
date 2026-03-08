# 🗺️ Map Creator

Map Creator 是一个面向历史/架空地图创作的网页制图工具。  
它支持全球范围的政治填色、分区编辑、预设批量上色、参考图描图和快照导出，适合做世界观设定图、mod 地图草案和教学演示图。

## ✨ 核心功能

- 🎨 **交互式填色**
  - `Fill / Eraser / Eyedropper` 三种工具
  - 底部 dock 提供快速色板、最近颜色和当前选中色预览
  - 左侧保留完整颜色库搜索和自定义颜色
  - 支持按 **Subdivision** 或按 **Country** 上色
  - 支持 `Undo / Redo`、缩放控件和常用快捷键

- ⚡ **快速上色**
  - `Auto-Fill Countries` 一键自动配色
  - `By Region` / `By Neighbor (Political)` 两种配色模式
  - `Clear Map` 快速清空当前着色
  - `Palette Source` 现在是唯一来源入口，同时驱动快速色板、自动填色和 mod 海洋填色

- 🌊 **海洋样式**
  - 可直接选择海洋填充颜色（不再固定淡蓝）
  - 海洋高级样式（Bathymetry / Hachure）**目前保留 UI 但暂时禁用**（性能稳定优先）

- 🧭 **地图视觉控制**
  - 内部边界、国家边界、海岸线样式独立调节
  - 纹理叠层（纸张 / 画布 / 网格）
  - 图层开关（Urban / Physical / Rivers / Special Zones）

- 🖼️ **参考图描图**
  - 上传本地参考图
  - 调整透明度、缩放、X/Y 偏移用于对齐描绘

- 🧩 **预设与分组编辑**
  - 国家/地区预设一键应用
  - 预设编辑模式可直接点选区域并复制 ID
  - 右侧检查器支持搜索、预设树、单国调色、项目管理和图例编辑

- 🎛️ **国家色板资产**
  - 内置 `HOI4 Vanilla` 国家色板，不依赖用户本地游戏目录
  - 底部 dock 提供 `快速色块 + 最近颜色`
  - 左侧提供 `全量颜色库搜索 + 自定义颜色`
  - 后续可继续接入其他 mod 色板 pack

- 💾 **项目与导出**
  - 项目状态导出/导入（JSON）
  - 地图快照导出（PNG / JPG）
  - `Ctrl/Cmd+S` 可直接下载项目 JSON
  - 导入/导出与快照操作使用 toast 提示结果

- 🌐 **双语界面**
  - 支持 `EN / 中文` 一键切换

## 🚀 怎么用（面向使用）

1. 进入页面后先在底部 dock 选择工具（默认 `Fill`）、快速颜色和 `Palette Source`。  
2. 点击地图区域上色；滚轮缩放、拖拽平移。  
3. 需要快速出图时，在底部 dock 选择 `By Region` 或 `By Neighbor (Political)`，再点击 `Auto-Fill Countries`。  
4. 在左侧 `Editing Rules` / `Appearance` 中调边界、海洋、纹理和图层可见性。  
5. 需要对照历史图时，上传 `Reference Image` 进行描图。  
6. 完成后导出快照，或用 `Ctrl/Cmd+S` / 项目导出保存 JSON 以便下次继续。  

## 🎨 国家色板

- 当前内置 4 套 palette source：
  - `HOI4 Vanilla`
  - `Kaiserreich`
  - `The New Order`
  - `Red Flood`
- `Palette Source` 现在集中在底部 dock，作为唯一入口
- 已能映射到项目 ISO-2 国家码的国家，会在 `Auto-Fill Countries` 和 `Reset Country Colors` 中优先使用当前来源的地图色
- 未映射国家继续使用现有稳定避色逻辑，不会退化成每次真随机
- 左侧 `Browse All Colors` 可按国家名、ISO-2 或来源 tag 搜索完整色库
- 底部 quick palette 会按当前来源切换，并与 `Recent` 分层显示在 dock 托盘里
- `Auto-Fill Countries` 固定走政治填色；若来源为 mod，还会同步应用该 mod 的海洋填色

色板资产位于：

- `data/palettes/index.json`
- `data/palettes/hoi4_vanilla.palette.json`
- `data/palettes/kaiserreich.palette.json`
- `data/palettes/tno.palette.json`
- `data/palettes/red_flood.palette.json`
- `data/palette-maps/hoi4_vanilla.map.json`
- `data/palette-maps/hoi4_vanilla.audit.json`
- `data/palette-maps/kaiserreich.map.json`
- `data/palette-maps/tno.map.json`
- `data/palette-maps/red_flood.map.json`

如需重建全部 palette 资产：

```bash
python3 init_map_data.py --mode palettes
```

如需单独从本地 HOI4 / mod 文件重新导入：

```bash
python3 tools/import_country_palette.py
```

当前运行时固定色优先读取：

1. `colors.txt:color`
2. `country file color`
3. `color_ui` 仅作元数据和兜底

详细规则见 `docs/COUNTRY_PALETTE_ASSETS.md`。

## Raw Raster Cache

- `data/ETOPO_2022_v1_60s_N90W180_surface.tif`
- `data/PROBAV_LC100_global_v3.0.1_2019_forest_type.tif`
- `data/PROBAV_LC100_global_v3.0.1_2019_discrete.tif`

这些 `.tif` 文件只用于 `init_map_data.py` 的离线物理语义/等高线构建，不属于网站运行时必需资产。
前端页面实际依赖的是仓库中已经生成好的 JSON / TopoJSON 结果，因此仓库默认将这些原始栅格当作本地缓存处理，不再纳入 Git 版本管理。

当你在本地重新跑数据构建时，如果这些文件不存在，构建脚本会按需下载并缓存到 `data/` 目录。

## 🌍 数据来源

本项目数据由公开地理数据源抓取、清洗并生成前端可用拓扑数据，主要包括：

- **Natural Earth**（国家边界、海洋、陆地、河流、城市区、物理区域、Admin-1）
- **Eurostat / GISCO NUTS**
- **geoBoundaries**（中国 / 俄罗斯 / 乌克兰 / 印度的 ADM2）
- **France GeoJSON（arrondissements）**
- **PolandGeoJson（powiaty）**

说明：不同数据源各自遵循其原始许可与使用条款。

## 📄 开源协议

- 项目当前按 **MIT License** 使用（以仓库声明为准）。
- 第三方地理数据不自动转为 MIT，请同时遵守对应数据源许可证。
