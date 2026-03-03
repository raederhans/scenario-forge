# 🗺️ Map Creator

Map Creator 是一个面向历史/架空地图创作的网页制图工具。  
它支持全球范围的政治填色、分区编辑、预设批量上色、参考图描图和快照导出，适合做世界观设定图、mod 地图草案和教学演示图。

## ✨ 核心功能

- 🎨 **交互式填色**
  - `Fill / Eraser / Eyedropper` 三种工具
  - 主题色板 + 自定义颜色 + 最近使用颜色
  - 支持按 **Subdivision** 或按 **Country** 上色

- ⚡ **快速上色**
  - `Auto-Fill Countries` 一键自动配色
  - `By Region` / `By Neighbor (Political)` 两种配色模式
  - `Clear Map` 快速清空当前着色

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
  - 右侧国家列表支持搜索和单国调色

- 🎛️ **国家色板资产**
  - 内置 `HOI4 Vanilla` 国家色板，不依赖用户本地游戏目录
  - 左侧色板升级为 `快速色块 + 全量颜色库搜索`
  - 后续可继续接入其他 mod 色板 pack

- 💾 **项目与导出**
  - 项目状态导出/导入（JSON）
  - 地图快照导出（PNG / JPG）

- 🌐 **双语界面**
  - 支持 `EN / 中文` 一键切换

## 🚀 怎么用（面向使用）

1. 进入页面后先选工具（默认 `Fill`）和颜色。  
2. 点击地图区域上色；滚轮缩放、拖拽平移。  
3. 需要快速出图时，点击 `Auto-Fill Countries`。  
4. 在 `Map Style` 里调边界、海洋、纹理和图层可见性。  
5. 需要对照历史图时，上传 `Reference Image` 进行描图。  
6. 完成后导出快照，或保存项目 JSON 以便下次继续。  

## 🎨 国家色板

- 当前内置 4 套 palette source：
  - `HOI4 Vanilla`
  - `Kaiserreich`
  - `The New Order`
  - `Red Flood`
- 左侧 `Palette Source` 与 `Map Style -> Auto-Fill Style` 同步联动
- 已能映射到项目 ISO-2 国家码的国家，会在 `Auto-Fill Countries` 和 `Reset Country Colors` 中优先使用当前来源的地图色
- 未映射国家继续使用现有稳定避色逻辑，不会退化成每次真随机
- 左侧 `Browse All Colors` 可按国家名、ISO-2 或来源 tag 搜索完整色库
- 左侧主色板会按当前来源切换为各自的 quick palette，不再与 `Recent` 混排
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
