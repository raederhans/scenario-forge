# QA-047 海洋海块划分标准与互动方案研究

**Date:** 2026-03-04  
**Scope:** 面向当前地图填色 app 的海洋区域切块标准、地中海试点分区、交互层设计建议  
**Method:** 本地代码与数据结构审阅 + TNO/HOI4 地图资产对照 + 网络资料检索与交叉比对  
**Deliverable Type:** 只读型 QA / 研究与落地建议文档，不修改代码、不生成 GeoJSON、不改现有地图资产

## Evidence

### Local evidence

- 当前前端把海洋当作绘制层而非交互层处理：
  - `js/core/map_renderer.js:1344` 将 `ocean` 解析为上下文绘制层。
  - `js/core/map_renderer.js:2601` 的 `getHitFromEvent()` 只从 `state.landData` 与 `state.spatialItems` 走命中逻辑。
- 当前特殊区域机制本质上是覆盖层：
  - `js/core/data_loader.js:17` 从 `data/special_zones.geojson` 加载静态 special zones。
  - `js/core/map_renderer.js:3950` 将 topology special zones 与 `manualSpecialZones` 合并渲染。
  - `js/core/state.js:560`, `js/core/state.js:564`, `js/core/state.js:640` 显示当前已有 `specialZonesData`、`oceanData`、`manualSpecialZones` 三条并列状态，但只有陆地进入主命中链。
- 当前 special zones 适合做“视觉型覆盖区”，不等于“像国家一样的主交互图层”。

### Web evidence

- IHO S-23 / S-130 说明“海域命名与边界”是一个独立的国际标准体系，而不是政治海权体系：  
  https://iho.int/standards-and-specifications  
  https://iho.int/iho_pubs/IHO-Catalogue.htm
- GFCM/FAO 已经把地中海拆成稳定、可命名、可下载 shape 的渔业地理分区（Western / Central / Eastern Mediterranean，再细分 Adriatic / Ionian / Aegean / Levant 等）：  
  https://www.fao.org/gfcm/data/maps/gsas/en/
- GEBCO 与 IBCM 分别提供全球与地中海尺度的权威浴深框架，适合做“海盆/坡折/深槽”的几何参考：  
  https://www.gebco.net/  
  https://www.gebco.net/about-us/committees-groups/scrum/ibcm  
  https://www.ngdc.noaa.gov/mgg/ibcm/ibcmbath.html
- EMODnet 说明欧洲海洋数据体系在 Mediterranean sea-basin 下组织 bathymetry、chemistry、physics 等专题数据，证明“海盆/海区”是成熟的数据组织单位：  
  https://emodnet.ec.europa.eu/en/mediterranean

## Executive Summary

对你的 app 来说，海洋不应该按领海或 EEZ 划分，也不应该直接照搬 HOI4 的海军战略海区。最合适的做法是采用双层标准：

1. **语义父层** 用 IHO/S-130 一类的“命名海域”来定义大块水体。
2. **可交互子层** 用 GFCM 渔业分区、GEBCO/IBCM 海盆结构、海峡 chokepoint 来做适度粗化。

这套方案的优势是：

- 名称稳定，玩家和普通用户都看得懂。
- 几何上能解释为什么某些地方必须单独成块，例如直布罗陀、苏伊士入口、博斯普鲁斯。
- 将来做全球扩展时，不会陷入“每张海图都重新 invent 一套切法”。
- 和你当前前端架构最兼容，因为它天然适合新增一层 `water_regions`，而不是强行改造现有 `ocean` 掩膜。

我的结论是：

- **推荐标准：** `macro waterbody -> playable sector -> chokepoint micro-region`
- **不推荐：** `territorial waters / EEZ`, `random Voronoi`, `直接复用 HOI4 strategic regions`, `把海洋并入国家政治层`

## 1. 背景与目标

你的目标不是表达国际法意义上的海权边界，而是做“海块区域互动”。这意味着切分标准必须优先回答以下问题：

- 用户能不能一眼看懂这块海是什么。
- 这块海有没有稳定名称。
- 这块海是否值得单独 hover / click / 填色。
- 将来扩展到全球时，这套标准是否还能复用。

因此，政治法理标准只能是反例，不应成为主标准。

## 2. 标准候选对比

### 2.1 IHO S-23 / S-130：命名海域与海界

IHO 的 S-23 是经典的“海洋与海域名称、界线”标准；IHO 官网同时显示 S-130 已经作为数字化海域多边形标准上线。它的优势不是“几何最适合游戏”，而是：

- 有稳定命名。
- 国际通用。
- 适合做父层和 label 体系。

对你的 app 来说，IHO 层最适合回答“这片水体应该叫什么”，不最适合直接回答“这片区域点起来是否好用”。

### 2.2 GFCM / FAO：渔业与海洋管理区

GFCM 页面把 FAO 37 区拆成：

- Western Mediterranean
- Central Mediterranean
- Eastern Mediterranean
- Adriatic
- Ionian
- Aegean
- Levant

这类分区的优点是：

- 天生就是多边形边界。
- 已经是“可管理的海区单元”。
- 比 IHO 的纯命名界线更接近“可交互 sector”。

缺点是它是行业管理逻辑，放到全球时并不总有同一层级的对应物。

### 2.3 GEBCO / IBCM / EMODnet Bathymetry：海盆与地形结构

GEBCO 的全球 bathymetry 与 IBCM 的地中海尺度 bathymetry 适合回答：

- 这里是不是一个独立海盆。
- 这里是不是有明显的陆架、坡折、深槽、门槛。
- 这块海是否在地形上天然应该分开。

它非常适合做 geometry refinement，但不适合单独拿来命名和交互，因为：

- 海底地形线不是天然的人类认知边界。
- 单靠等深线切块会得到很多“科学上合理、交互上难懂”的形状。

### 2.4 生态区 / 生物地理区

这类标准对保护、渔业和环境评价有价值，但不适合做你的主交互标准。原因很直接：

- 名称通常不够直观。
- 边界会随指标与专题变化。
- 用户很难从地图上直觉理解。

它适合以后做 overlay，不适合做底层点击区。

## 3. 评估维度

| 标准 | 读图直觉 | 可命名性 | 可维护性 | 全球扩展性 | 与当前前端兼容性 | 结论 |
|---|---:|---:|---:|---:|---:|---|
| IHO S-23 / S-130 | 4 | 5 | 5 | 5 | 4 | 最适合做父层命名与标签体系 |
| GFCM / FAO 海区 | 4 | 4 | 4 | 2 | 4 | 最适合做地中海 playable sector 试点 |
| GEBCO / IBCM bathymetry | 2 | 2 | 3 | 5 | 3 | 最适合做几何修正与海盆分界参考 |
| 生态区 / 生物地理区 | 2 | 2 | 2 | 4 | 2 | 适合做 overlay，不适合做主交互层 |

**判断：** 对你当前目标而言，最稳妥的不是“选一个标准”，而是把它们分工使用。

## 4. 推荐总方案

### 4.1 推荐模型

推荐采用三层结构：

- **Macro waterbody**  
  采用 IHO/S-130 语义，例如 Mediterranean Sea、Black Sea、Red Sea、Arabian Sea。
- **Playable sector**  
  采用 GFCM 分区为主、bathymetry 为辅，例如 Western Mediterranean、Ionian、Levantine、Adriatic Basin。
- **Chokepoint micro-region**  
  对直布罗陀、苏伊士入口、达达尼尔/博斯普鲁斯、巴拿马、马六甲这类位置单独成块。

### 4.2 为什么这是最适合你项目的方案

这是一个**工程上和认知上同时成立**的方案：

- 认知层面：用户知道 Mediterranean、Adriatic、Aegean 是什么。
- 几何层面：bathymetry 和海峡门槛能解释为什么需要拆。
- 交互层面：块数不会爆炸，不会像国家级陆地那样极度细碎。
- 扩展层面：地中海试点成功后，全球海块也能按相同原则推广。

### 4.3 明确不推荐的四类方案

#### A. 直接按领海/EEZ 划分

不符合你的目标，因为它表达的是主权法理，而不是海块区域。

#### B. 直接按随机 Voronoi 切海

几何上容易做，但完全失去语义，一眼看不懂，后续也难命名和维护。

#### C. 直接把海洋并入国家政治层

会把海区逻辑和国家逻辑耦死；同时会让海区颜色、邻接、列表、图例全部变脏。

#### D. 直接照搬 HOI4 strategic regions

不推荐。原因不是“HOI4 不好”，而是它服务的是海军 AI、空军覆盖和 supply / mission logic，不是前端 Equal Earth 全图交互。  
而且 HOI4 strategic region 在文件层面并不总是纯海区，常常混入沿岸陆地 province。

## 5. 地中海试点分块建议

下表是我建议你在地中海先做的一版**可交互 sector**。这不是唯一正确答案，但它是最适合当前项目的第一版。

| Sector ID | 推荐名称 | 父层 | 划分依据 | 推荐用途 |
|---|---|---|---|---|
| `med_west` | Western Mediterranean | Mediterranean Sea | 对应 GFCM Western Med，保留巴利阿里-阿尔沃兰方向的大块认知 | 主海块 |
| `med_tyrr_lig` | Tyrrhenian-Ligurian | Mediterranean Sea | 意大利西岸海盆 + 航运与地形独立性 | 主海块 |
| `med_central_corridor` | Central Mediterranean / Sicily-Tunis Corridor | Mediterranean Sea | 西东地中海之间的门槛与通道 | 高优先交互块 |
| `med_adriatic` | Adriatic Basin | Mediterranean Sea | 封闭性强、长条海盆、认知稳定 | 主海块 |
| `med_ionian` | Ionian | Mediterranean Sea | 与 Adriatic / Aegean 之间有天然转换区 | 主海块 |
| `med_aegean` | Aegean | Mediterranean Sea | 岛链密集、海域识别度高 | 主海块 |
| `med_levantine` | Levantine | Mediterranean Sea | 东地中海东端深盆与近东海岸带 | 主海块 |
| `med_gibraltar` | Gibraltar Chokepoint | Mediterranean Sea | 海峡瓶颈，必须单独命名 | 微区 / choke |
| `med_bosporus_dardanelles` | Bosporus-Dardanelles Chokepoint | Mediterranean Sea | 地中海与黑海转换瓶颈 | 微区 / choke |
| `med_suez_approach` | Suez Approach | Mediterranean Sea | 东南出口语义和航线价值强 | 微区 / choke |

### 5.1 关于 Adriatic 的特殊说明

如果你同时准备做 Atlantropa 盐碱地，那么 `med_adriatic` 在未来会分成两种不同语义：

- 常规世界下：它是海块。
- TNO / alt-history 世界下：它可能被 `special_regions` 的盐碱地 / drained basin 替代。

这恰恰说明海块体系和特殊区域体系应当分层，而不是写死在同一套 country polygon 里。

## 6. 全图推广规则

建议你未来的全球海块划分遵守以下规则：

1. **优先命名海域，而不是先画网格。**
2. **优先封闭海、半封闭海、海湾、海峡。**
3. **外洋尽量保持粗块，不做国家级密度。**
4. **狭长 bottleneck 一律单独成块。**
5. **没有稳定名称的地方，不要切成一级交互块。**
6. **一块海域至少要满足屏幕可点性阈值。**
7. **单块若跨越多个明显海盆或多个 choke，则优先再拆。**
8. **将 bathymetry 用作几何修正，而不是主命名依据。**

## 7. 对你项目的落地建议

## 7.1 不要改造现有 `ocean` 掩膜去承担主交互

从本地代码看，`ocean` 当前职责是：

- 画底色
- 参与 ocean mask
- 作为上下文层提供视觉信息

它不是主交互图层。继续在 `oceanData` 上堆逻辑，会把“海洋底图职责”和“海区业务职责”绑死。

## 7.2 新增独立 `water_regions` 层

建议未来新增一层与 `political`、`special_zones` 并列的 `water_regions`：

```json
{
  "id": "med_ionian",
  "name": "Ionian Sea",
  "label": "Ionian",
  "water_type": "sea",
  "region_group": "mediterranean",
  "parent_id": "mediterranean_sea",
  "neighbors": ["med_adriatic", "med_central_corridor", "med_aegean"],
  "is_chokepoint": false,
  "interactive": true,
  "source_standard": "IHO+GFCM+Bathymetry"
}
```

### 适配点

- `data_loader`: 新增 `water_regions` URL 和加载分支
- `state.js`: 新增 `waterRegionsData`、`waterRegionsById`
- `map_renderer.js`: 单独建 spatial index / 命中逻辑
- `sidebar`: 新增海域列表，不混进国家列表
- `legend`: 支持图层级海域着色，而不是 country legend

## 7.3 `special_zones` 保留，但只做补充层

`special_zones` 更适合：

- 争议区
- 废土区
- 盐碱地
- 人工改造区

不适合承担常规海洋 sector 的主交互职责。

## 8. 为什么 HOI4 海区只能当参考，不能直接复用

本地 TNO mod 证据表明：

- `map/strategicregions/68-Western Mediterranean Sea.txt`
- `map/strategicregions/69-Eastern mediterranean Sea.txt`
- `map/strategicregions/29-Central Mediterranean Sea.txt`

虽然名字是海区，但其中并不总是纯 `sea` province；样本里可见混入 `land` province。  
这说明 HOI4 strategic region 更像“作战与任务管理区”，不是适合直接拿来当 web 前端点击 polygon 的纯净海块数据。

因此，我的建议是：

- **参考它的块级粗细，不直接复用它的边界。**
- **借它的 choke 观念，不借它的文件结构。**

## Recommendation

### 结论性建议

对你的地图填色 app，海洋区域应当按以下方法划分：

- **父层标准：** IHO/S-130 命名海域
- **交互标准：** GFCM/FAO 海区 + GEBCO/IBCM 海盆修正
- **特殊处理：** chokepoint 独立成微区

### 最小可落地版本

先做地中海 10 块试点：

1. Western Mediterranean
2. Tyrrhenian-Ligurian
3. Central Mediterranean / Sicily-Tunis Corridor
4. Adriatic Basin
5. Ionian
6. Aegean
7. Levantine
8. Gibraltar Chokepoint
9. Bosporus-Dardanelles Chokepoint
10. Suez Approach

### 工程方向

不要在现有 `ocean` 或 `special_zones` 上硬堆，直接把长期方向定为：

- 新增 `water_regions`
- 海域列表单独 UI
- 海域 hit-testing 单独索引
- 海域图例单独分层

## Risks

### 风险 1：一开始切太细

如果一上来就把海块做成近似“海上行政区”，会很快失去可读性和可维护性。

### 风险 2：完全依赖 bathymetry

科学上漂亮，交互上会很别扭，命名也困难。

### 风险 3：完全依赖渔业区

地中海阶段很好用，但全球扩展时层级会不一致。

### 风险 4：复用 HOI4 strategic region

会把 AI / 战略任务区逻辑直接导入前端，造成“名字像海区、几何不像交互区”的问题。

## Next Step

建议后续按这个顺序推进：

1. 先定义 `water_regions` 数据契约。
2. 先做 Mediterranean pilot，而不是全球一次性开工。
3. 先验证 hover / click / list / legend 的完整交互链。
4. 试点稳定后，再扩展黑海、红海、波罗的海、加勒比、马六甲与外洋粗块。

## Sources

- IHO Standards and Specifications: https://iho.int/standards-and-specifications
- IHO Catalogue (S-23 description): https://iho.int/iho_pubs/IHO-Catalogue.htm
- GFCM Geographical Subareas: https://www.fao.org/gfcm/data/maps/gsas/en/
- GEBCO: https://www.gebco.net/
- IBCM (GEBCO): https://www.gebco.net/about-us/committees-groups/scrum/ibcm
- NOAA NCEI IBCM summary: https://www.ngdc.noaa.gov/mgg/ibcm/ibcmbath.html
- EMODnet Mediterranean: https://emodnet.ec.europa.eu/en/mediterranean
