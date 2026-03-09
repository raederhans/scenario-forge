# QA-HGO-002: 亚特兰托帕与地中海复用专题报告

**日期**: 2026-03-08
**范围**: HGO 中与地中海、亚特兰托帕、海盆重构、海峡工程直接相关的资源
**目标**: 评估 HGO 对当前 `tno_1962` 方案的已接入价值与剩余潜力
**状态**: 分析完成

---

## Executive Summary

从当前仓库状态看，HGO 已经不是“未来可考虑接入”的候选资源，而是 `tno_1962` 亚特兰托帕管线的现役 donor。

这一点在 [tools/patch_tno_1962_bundle.py](C:\Users\raede\Desktop\dev\mapcreator\tools\patch_tno_1962_bundle.py) 中可以直接确认：

- 存在 `HGO_ROOT`
- donor context 明确从 HGO 加载
- `build_atlantropa_from_hgo(...)`
- `build_atl_sea_from_hgo(...)`

同时，当前 scenario 审计也已经记录：

- `atlantropa_geometry_source = hgo_donor_provinces`
- `mediterranean_water_mode = atl_sea_tiles_from_hgo_donor`

因此，本专题的重点不是“能不能用”，而是“还能继续复用哪些 HGO 层”。

---

## 1. 当前项目已经吃掉了 HGO 的哪些内容

### 1.1 几何 donor

当前 `tno_1962` 已将 HGO 用作亚特兰托帕地块 donor，主要用于：

- donor land
- donor sea
- donor island
- shore seal
- causeway

这些逻辑可在 [tools/patch_tno_1962_bundle.py](C:\Users\raede\Desktop\dev\mapcreator\tools\patch_tno_1962_bundle.py) 中看到。

### 1.2 scenario 表现层

当前项目还已经具备亚特兰托帕专题的 runtime 支撑：

- [data/scenarios/tno_1962/manifest.json](C:\Users\raede\Desktop\dev\mapcreator\data\scenarios\tno_1962\manifest.json)
- [data/scenarios/tno_1962/audit.json](C:\Users\raede\Desktop\dev\mapcreator\data\scenarios\tno_1962\audit.json)
- [data/scenarios/tno_1962/relief_overlays.geojson](C:\Users\raede\Desktop\dev\mapcreator\data\scenarios\tno_1962\relief_overlays.geojson)
- [data/scenarios/tno_1962/water_regions.geojson](C:\Users\raede\Desktop\dev\mapcreator\data\scenarios\tno_1962\water_regions.geojson)

UI 层也已经预留了场景展示入口：

- [js/core/map_renderer.js](C:\Users\raede\Desktop\dev\mapcreator\js\core\map_renderer.js)

---

## 2. HGO 中仍未充分利用的亚特兰托帕资源

### 2.1 完整的亚特兰托帕州命名体系

HGO 的 [state_names_l_english.yml](C:\Users\raede\Desktop\dev\mapcreator\historic geographic overhaul\localisation\state_names_l_english.yml) 中，已经存在大量完整命名：

- `Algeria Atlantropa Zone`
- `Attica Atlantropa Zone`
- `Crete Atlantropa Zone`
- `North Cyprus Atlantropa Zone`
- `Cyprus Atlantropa Zone`
- `North Sicily Atlantropa Zone`
- `New Sicily Atlantropa Zone`
- `Tunisian Mediterranean`
- `Libyan Mediterranean`
- `Corsica-Elba Atlantropa Landbridge Site`

这类命名非常重要，因为它们不是泛泛的“区域名”，而是已经带有工程语义：

- `Zone`
- `Mediterranean`
- `Landbridge Site`
- `Canal Site`
- `Reclamation Zone`

这些后缀正是当前项目未来继续完善 scenario legend、feature metadata、tooltip 和开发用诊断标签时最需要的。

### 2.2 人工划分过的海盆区

HGO 不只是把地中海抽象成一个干涸海，而是细分为多个盆地与海域单元，例如：

- `West Algerian Mediterranean`
- `Central West Algerian Mediterranean`
- `Central East Algerian Mediterranean`
- `East Algerian Mediterranean`
- `Tunisian Mediterranean`
- `Tripoltanian Mediterranean`
- `Maltese Mediterranean`
- `Ionian Mediterranean`
- `Barian Mediterranean`
- `Cretan Mediterranean`
- `Lebanese Mediterranean`
- `Palestinian Mediterranean`
- `Alexandrian Mediterranean`
- `Egyptian Mediterranean`
- `West Cyrenaican Mediterranean`
- `Libyan Mediterranean`
- `East Cyrenaican Mediterranean`

这批命名意味着 HGO 已经把西地中海、中地中海、东地中海进一步切成工程可用片区。当前项目如果继续追求“视觉上 drained 了”和“语义上也能说清是哪一块”同时成立，这些片区非常值得接入。

### 2.3 工程位点

HGO 中的工程位点远不止主坝体。

已确认存在：

- `Gibraltar Dam Site`
- `Sicilian Dam Site`
- `West Adriatic Dam Site`
- `East Adriatic Dam Site`
- `West Cretan Dam Site`
- `East Cretan Dam Site`
- `West Rhodean Dam Site`
- `East Rhodean Dam Site`
- `Marmaran Dam Site`
- `Patras Atlantropa Site`
- `Qattara Canal Site`
- `West Suez Atlantropa Canal Site`
- `East Suez Atlantropa Canal Site`

这些内容说明：

- HGO 的工程构想不是“一条坝”这么简单
- 它已经具备“工程链条拆分”的思路
- 这正适合你以后做更完整的建设阶段、施工节点、战略 chokepoint 可视化

### 2.4 回填阶段区

在 HGO 中，部分区域不只是一块最终成品地块，而是有阶段性的回填表达。

例如：

- `West Baku-Bekdas Landbridge Site -50 meters`
- `West Baku-Bekdas Landbridge Site -100 meters`
- `West Baku-Bekdas Landbridge Site -200 meters`
- `East Baku-Bekdas Landbridge Site -50 meters`

这一设计说明 HGO 作者已经把“工程推进中的海平面阶段”做成了地块层。虽然当前你主要关注地中海，但这个设计思想本身非常宝贵，未来完全可以迁移到：

- 亚特兰托帕分期剧本
- 蓄水/回填切换
- 分阶段解锁地块

---

## 3. 与当前项目最契合的接入方向

### 3.1 命名层接入

这是最容易、收益最高的扩展方向。

建议把 HGO 的以下层拆进当前 scenario 数据：

- 地中海子盆地名
- 各类 Atlantropa Zone 名
- 各类 Dam/Canal/Landbridge Site 名
- 各类 Reclamation Zone 名

接入后可以用于：

- 图层说明
- tooltip
- debug overlay
- legend
- future scenario export

### 3.2 special regions 语义增强

当前项目已经有：

- [data/scenarios/tno_1962/special_regions.geojson](C:\Users\raede\Desktop\dev\mapcreator\data\scenarios\tno_1962\special_regions.geojson)

建议将 HGO 的工程位点和回填区继续映射到 special region 分类体系中，例如：

- `macroengineering_dam_site`
- `macroengineering_canal_site`
- `macroengineering_landbridge_site`
- `reclamation_stage_zone`
- `exposed_mediterranean_basin`

这样你后面做任何替代地理 scenario，都不必重新设计分类法。

### 3.3 水域替换规则精细化

当前项目已经把 baseline `mediterranean` 水域组从 scenario 中排除。

接下来还可以继续做：

- 把 HGO 的海盆名称映射成更细的 `water_region_group`
- 让大地块改造不仅表现为“水没了”，而是表现为“哪一块水没了、哪一块变浅、哪一块变盐盆”

这会显著增强场景说服力。

---

## 4. 风险与限制

### 4.1 不能把 HGO 当权威地理真值

HGO 的亚特兰托帕是人为构造的 alternate geography，不是现实地理数据。因此：

- 它适合作为剧本 donor
- 不适合作为现实主义地理基准

### 4.2 donor 几何仍然受老 HOI4 光栅工程限制

HGO 的 donor 来源仍然基于：

- province raster
- definition csv
- state txt

因此任何新增接入都应尽量经过当前项目现有的 vector 化和 scenario 编译管线，而不是直接读取光栅结果作为最终输出。

---

## 5. 结论

HGO 对亚特兰托帕的最大价值，不只是提供几何，而是提供了一整套已经过人工设计的工程语义层：

- 海盆分块
- 工程节点
- 陆桥位点
- 分阶段回填
- 命名标准

当前项目已经吃掉了其中最基础的 donor 几何层，下一步最值得做的是继续吸收：

1. 命名层
2. 工程位点层
3. 海盆语义层
4. 分阶段工程表达层

这样你的亚特兰托帕开发会从“有图”升级为“有完整区域语义”。
